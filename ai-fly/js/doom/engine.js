// The real Doom engine (doomgeneric, GPL-2.0) with Freedoom's game data, headless and
// deterministic, so that simulated flies can play it. Source and build: ai-fly/doom-engine/.
//
// Nothing runs by itself: no clock, no menus, no sound output. The caller starts a game,
// sets the input, runs game tics (35 per game second) and draws a frame when it wants one.
// The same seed and the same calls give the same game and the same frames, bit for bit,
// in the browser (main thread or Web Worker) and in Node.
//
//   import { loadDoom, DOOM } from './doom/engine.js';
//   const doom = await loadDoom({ wasm, wad });   // ArrayBuffer | WebAssembly.Module, ArrayBuffer | Uint8Array
//   doom.newGame({ skill: 3, map: 2, seed: 7 });
//   doom.spawn(DOOM.MT.ZOMBIEMAN, 300, 0, 180, true);
//   doom.setCmd(50, 0, 0, DOOM.BT.FIRE); doom.tick(35);
//   const view = doom.render(96, 60);              // palette indices, valid until the next call
//   doom.state[DOOM.S.HEALTH];
//
// Frames are palette indices (one byte per pixel, row by row). doom.palette(i) gives the
// 768 RGB bytes of palette i; DOOM.S.PALETTE in the state says which one Doom would show
// right now (red after damage, gold after a pickup). toRGBA() converts a frame.

// ---- names --------------------------------------------------------------------------------

// Index of each field in doom.state (an Int32Array). Positions and momentum are 16.16
// fixed point (divide by 65536 for map units), angles are binary angles (0..2^32 = 0..360
// degrees, read them with >>> 0). Counters marked "cumulative" start at 0 with each new game.
const STATE_FIELDS = [
  'TIC',           // game tics since the new game (35 per second)
  'HEALTH',
  'ARMOR',
  'AMMO',          // ammo of the current weapon (-1 for fist and chainsaw)
  'WEAPON',        // current weapon (DOOM.WP)
  'KILLS',         // Doom's kill count (also counts monsters killed by other monsters)
  'ITEMS',         // items picked up
  'X', 'Y', 'Z',   // player position, 16.16
  'ANGLE',         // player angle, binary angle
  'DEAD',          // 1 when the player is dead
  'PALETTE',       // palette index Doom would show now (0 normal, 1-8 red, 9-12 gold, 13 green)
  'DAMAGE_DEALT',  // cumulative health taken from monsters by the player (overkill not counted)
  'DAMAGE_TAKEN',  // cumulative health the player lost (after armour)
  'SHOTS',         // cumulative attacks that really fired (one per trigger pull / refire)
  'MONSTERS',      // live monsters right now
  'MOMX', 'MOMY',  // player momentum, 16.16 per tic
  'EXITED',        // 1 when the player reached a level exit (the game then stops)
  'VIEWZ',         // eye height, 16.16
  'ARMORTYPE',     // 0 none, 1 green, 2 blue
  'SECRETS',       // secret areas found
  'DAMAGECOUNT',   // Doom's red-flash counter (damage taken recently)
  'BONUSCOUNT',    // Doom's gold-flash counter (pickups recently)
  'PENDING',       // weapon being switched to (10 = none)
  'MAP', 'SKILL', 'SEED',
  'TOTAL_KILLS',   // monsters that count for the kill total (map + spawned)
  'PLAYER_KILLS',  // cumulative monsters killed by the player himself
  'HITS',          // cumulative times the player damaged a monster
];

// Doom's mobj (thing) types; values are the engine's numbers.
const MT = {
  PLAYER: 0, ZOMBIEMAN: 1, SHOTGUNGUY: 2, ARCHVILE: 3, ARCHVILE_FIRE: 4, REVENANT: 5,
  REVENANT_TRACER: 6, SMOKE: 7, MANCUBUS: 8, MANCUBUS_SHOT: 9, CHAINGUNNER: 10, IMP: 11,
  DEMON: 12, SPECTRE: 13, CACODEMON: 14, BARON: 15, BARON_SHOT: 16, HELLKNIGHT: 17,
  LOSTSOUL: 18, SPIDERMASTERMIND: 19, ARACHNOTRON: 20, CYBERDEMON: 21, PAINELEMENTAL: 22,
  WOLFSS: 23, KEEN: 24, BOSSBRAIN: 25, BOSSSPIT: 26, BOSSTARGET: 27, SPAWNSHOT: 28,
  SPAWNFIRE: 29, BARREL: 30, IMP_SHOT: 31, CACO_SHOT: 32, ROCKET: 33, PLASMA: 34,
  BFG_SHOT: 35, ARACHNO_SHOT: 36, PUFF: 37, BLOOD: 38, TELEFOG: 39, ITEMFOG: 40,
  TELEPORTMAN: 41, BFG_EXTRA: 42,
  GREEN_ARMOR: 43, BLUE_ARMOR: 44, HEALTH_BONUS: 45, ARMOR_BONUS: 46,
  BLUE_CARD: 47, RED_CARD: 48, YELLOW_CARD: 49, YELLOW_SKULL: 50, RED_SKULL: 51, BLUE_SKULL: 52,
  STIMPACK: 53, MEDIKIT: 54, SOULSPHERE: 55, INVULNERABILITY: 56, BERSERK: 57,
  INVISIBILITY: 58, RADSUIT: 59, COMPUTER_MAP: 60, LIGHT_AMP: 61, MEGASPHERE: 62,
  CLIP: 63, BULLET_BOX: 64, ROCKET_AMMO: 65, ROCKET_BOX: 66, CELL: 67, CELL_PACK: 68,
  SHELLS: 69, SHELL_BOX: 70, BACKPACK: 71,
  BFG9000: 72, CHAINGUN: 73, CHAINSAW: 74, ROCKET_LAUNCHER: 75, PLASMA_RIFLE: 76,
  SHOTGUN: 77, SUPER_SHOTGUN: 78,
  TECH_LAMP: 79, TECH_LAMP2: 80, COLUMN_LAMP: 81, TALL_GREEN_PILLAR: 82,
  SHORT_GREEN_PILLAR: 83, TALL_RED_PILLAR: 84, SHORT_RED_PILLAR: 85, TORCH_TREE: 90,
  BLUE_TORCH: 91, GREEN_TORCH: 92, RED_TORCH: 93, TECH_PILLAR: 98, CANDLE: 99,
  CANDELABRA: 100, BIG_TREE: 126, BURNING_BARREL: 127,
};

// Doom's sound effects, by id (sfx field of doom.sounds()).
const SFX = ('none pistol shotgn sgcock dshtgn dbopn dbcls dbload plasma bfg sawup sawidl sawful sawhit ' +
  'rlaunc rxplod firsht firxpl pstart pstop doropn dorcls stnmov swtchn swtchx plpain dmpain popain ' +
  'vipain mnpain pepain slop itemup wpnup oof telept posit1 posit2 posit3 bgsit1 bgsit2 sgtsit cacsit ' +
  'brssit cybsit spisit bspsit kntsit vilsit mansit pesit sklatk sgtatk skepch vilatk claw skeswg ' +
  'pldeth pdiehi podth1 podth2 podth3 bgdth1 bgdth2 sgtdth cacdth skldth brsdth cybdth spidth bspdth ' +
  'vildth kntdth pedth skedth posact bgact dmact bspact bspwlk vilact noway barexp punch hoof metal ' +
  'chgun tink bdopn bdcls itmbk flame flamst getpow bospit boscub bossit bospn bosdth manatk mandth ' +
  'sssit ssdth keenpn keendt skeact skesit skeatk radio').split(' ');

export const DOOM = Object.freeze({
  S: Object.freeze(Object.fromEntries(STATE_FIELDS.map((n, i) => [n, i]))),
  MT: Object.freeze(MT),
  MONSTERS: Object.freeze([1, 2, 3, 5, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24]),
  WP: Object.freeze({ FIST: 0, PISTOL: 1, SHOTGUN: 2, CHAINGUN: 3, ROCKET_LAUNCHER: 4, PLASMA: 5, BFG: 6, CHAINSAW: 7, SUPER_SHOTGUN: 8, NONE: 10 }),
  // ticcmd buttons: FIRE, USE; CHANGE with the weapon number in bits 3-5 switches weapon
  BT: Object.freeze({ FIRE: 1, USE: 2, CHANGE: 4, WEAPON_SHIFT: 3 }),
  SFX: Object.freeze(SFX),
  TICRATE: 35,
  FULL_W: 320, FULL_H: 200,
});

// ---- loading ----------------------------------------------------------------------------------

const DEFAULT_WASM = new URL('../../data/doom/doom.wasm', import.meta.url);
const DEFAULT_WAD = new URL('../../data/doom/flygym.wad', import.meta.url);

async function readUrl(url) {
  url = new URL(url, typeof location !== 'undefined' ? location.href : DEFAULT_WASM);
  if (url.protocol === 'file:') {   // Node (fetch cannot read files)
    const fs = await import('node:fs/promises');
    const b = await fs.readFile(url);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

// Compile the engine once (e.g. on the main thread) and post the WebAssembly.Module to
// each worker; instances made from it share nothing.
export async function compileDoom(wasm = DEFAULT_WASM) {
  if (wasm instanceof WebAssembly.Module) return wasm;
  if (typeof wasm === 'string' || wasm instanceof URL) wasm = await readUrl(wasm);
  return WebAssembly.compile(wasm);
}

// Fetch both files (defaults: ai-fly/data/doom/). Returns { wasm, wad } as ArrayBuffers.
export async function fetchDoomFiles({ wasmUrl = DEFAULT_WASM, wadUrl = DEFAULT_WAD } = {}) {
  const [wasm, wad] = await Promise.all([readUrl(wasmUrl), readUrl(wadUrl)]);
  return { wasm, wad };
}

// One call for the simple case: fetch, compile, start.
export async function loadDoomFromUrls(opts = {}) {
  const { wasm, wad } = await fetchDoomFiles(opts);
  return loadDoom({ wasm, wad, log: opts.log });
}

// wasm: ArrayBuffer | typed array | WebAssembly.Module; wad: ArrayBuffer | Uint8Array.
// log: optional function receiving the engine's start-up text.
export async function loadDoom({ wasm, wad, log = null }) {
  const module = await compileDoom(wasm);
  let memory = null, text = '';
  const decoder = new TextDecoder();
  const cstr = (p) => { const u = new Uint8Array(memory.buffer); let e = p; while (u[e]) e++; return decoder.decode(u.subarray(p, e)); };
  // the whole import object: an error hook and the three stdio calls libc needs
  const imports = {
    env: {
      fg_error(p) { throw new Error('Doom engine error: ' + cstr(p)); },
    },
    wasi_snapshot_preview1: {
      fd_write(fd, iovs, n, written) {
        const v = new DataView(memory.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const p = v.getUint32(iovs + 8 * i, true), len = v.getUint32(iovs + 8 * i + 4, true);
          if (log) text += decoder.decode(new Uint8Array(memory.buffer, p, len));
          total += len;
        }
        v.setUint32(written, total, true);
        if (log && text.includes('\n')) { const k = text.lastIndexOf('\n'); log(text.slice(0, k)); text = text.slice(k + 1); }
        return 0;
      },
      fd_close: () => 0,
      fd_seek: () => 70,   // ESPIPE: nothing here is seekable
    },
  };
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory;
  return new Doom(instance.exports, wad);
}

// ---- the engine instance ------------------------------------------------------------------------

class Doom {
  constructor(x, wad) {
    this.x = x;
    this.memory = x.memory;
    if (x._initialize) x._initialize();   // C runtime set-up of a no-main ("reactor") wasm
    const bytes = wad instanceof Uint8Array ? wad : new Uint8Array(wad);
    const p = x.fg_wad_alloc(bytes.length);
    if (!p) throw new Error('Doom: no memory for the WAD');
    this._wadPtr = p; this._wadLen = bytes.length;
    new Uint8Array(this.memory.buffer, p, bytes.length).set(bytes);
    const rc = x.fg_init();
    if (rc !== 0) throw new Error('Doom: fg_init failed (' + rc + ')');
    const buf = this.memory.buffer;
    this.state = new Int32Array(buf, x.fg_state(), x.fg_state_count());
    this._ints = x.fg_ints();
    this._intsView = new Int32Array(buf, this._ints, 4096);
    this._pal = x.fg_palettes();
    this._palettes = Array.from({ length: 14 }, (_, i) => new Uint8Array(buf, this._pal + 768 * i, 768));
    this._full = null;
    this._view = null; this._viewPtr = 0; this._viewLen = 0;
  }

  // The game file's bytes as the engine holds them (to read a level's map from, see level.js). Do not write to them.
  get wad() { return new Uint8Array(this.memory.buffer, this._wadPtr, this._wadLen); }

  // Start a new game on MAPxx (1 = Freedoom MAP01, 2 = arena, 3 = arena with pillars).
  // skill 1..5 as in Doom. The held input is cleared.
  newGame({ skill = 3, map = 2, seed = 0 } = {}) {
    const rc = this.x.fg_new_game(skill, map, seed >>> 0);
    if (rc !== 0) throw new Error(`Doom: no MAP${String(map).padStart(2, '0')} in the WAD`);
    return this;
  }

  // Put the player at (x, y) in map units, facing angleDeg (0 = east, 90 = north).
  setPlayer(x, y, angleDeg = 0) { this.x.fg_set_player(x | 0, y | 0, angleDeg | 0); }

  // Give a weapon (DOOM.WP, made ready at once), set its ammo and the health.
  // A negative weapon/ammo or a health <= 0 leaves that part as it is.
  give(weapon, ammo = -1, health = 0) { this.x.fg_give(weapon, ammo, health); }

  // Spawn a thing (DOOM.MT) on the floor; awake monsters go for the player at once.
  // Returns its id, or -1 if it does not fit there (or for the Icon of Sin parts).
  spawn(type, x, y, angleDeg = 0, awake = false) { return this.x.fg_spawn(type, x | 0, y | 0, angleDeg | 0, awake ? 1 : 0); }

  // Input held until changed: forward/side -50..50 (50 = running), turn = Doom angleturn
  // (signed 16 bit, positive = left; 65536 = full circle per tic), buttons = DOOM.BT bits.
  setCmd(forward, side, turn, buttons) { this.x.fg_set_cmd(forward, side, turn, buttons); }

  // Run n game tics with the held input. Nothing is drawn.
  tick(n = 1) { this.x.fg_tick(n); }

  // The player's 3D view at w x h (8..320 x 8..200), 90 degrees wide. opts.weapon (or
  // true) also draws the weapon. Returns a Uint8Array view of w*h palette indices that
  // stays valid until the next render call.
  render(w, h, opts) {
    if (!(w >= 8 && w <= 320 && h >= 8 && h <= 200) || (w | 0) !== w || (h | 0) !== h) throw new RangeError('render size 8..320 x 8..200');
    const flags = opts === true || (opts && opts.weapon) ? 1 : 0;
    const p = this.x.fg_render(w, h, flags), len = w * h;
    if (p !== this._viewPtr || len !== this._viewLen) {
      this._viewPtr = p; this._viewLen = len;
      this._view = new Uint8Array(this.memory.buffer, p, len);
    }
    return this._view;
  }

  // What a human player would see: 320x200 with weapon, status bar and pickup messages.
  renderFull() {
    const p = this.x.fg_render_full();
    if (!this._full) this._full = new Uint8Array(this.memory.buffer, p, 320 * 200);
    return this._full;
  }

  // Uint8Array(768): RGB of palette i (0..13), straight from Freedoom's PLAYPAL.
  palette(i = 0) { return this._palettes[i]; }

  // Live monsters (for scoring, tests and a mini-map; never meant for the fly's eyes).
  // x, y in map units. things(true) lists every thing instead (player, items, missiles,
  // bullet puffs, corpses; health as Doom keeps it, id -1 for unnamed things).
  things(all = false) {
    const n = this.x.fg_things(this._ints, 819, all ? 1 : 0), v = this._intsView, out = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      out[i] = { type: v[o], x: v[o + 1] / 65536, y: v[o + 2] / 65536, health: v[o + 3], id: v[o + 4] };
    }
    return out;
  }

  // Sounds the player could hear since the last call: sfx id (DOOM.SFX), volume 0..127,
  // stereo separation 0..255 (128 = straight ahead or behind, lower = left). Nothing plays.
  sounds() {
    const n = this.x.fg_sounds(this._ints, 1365), v = this._intsView, out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = { sfx: v[3 * i], vol: v[3 * i + 1], sep: v[3 * i + 2] };
    return out;
  }

  // Debug: fill each frame with colour c before drawing (-1 = off), to spot undrawn pixels.
  setFill(c) { this.x.fg_set_fill(c); }

  // { zoneSize, zoneFree, heapTop, memory } in bytes.
  memInfo() {
    const v = new Int32Array(this.memory.buffer, this.x.fg_mem_info(), 4);
    return { zoneSize: v[0], zoneFree: v[1], heapTop: v[2], memory: v[3] };
  }
}

// Palette indices -> RGBA bytes (e.g. for ImageData). out: Uint8Array/Uint8ClampedArray of
// 4 * pixels.length bytes (made if not given). palette: Uint8Array(768) from doom.palette().
export function toRGBA(pixels, palette, out = new Uint8ClampedArray(pixels.length * 4)) {
  for (let i = 0, o = 0; i < pixels.length; i++, o += 4) {
    const c = pixels[i] * 3;
    out[o] = palette[c]; out[o + 1] = palette[c + 1]; out[o + 2] = palette[c + 2]; out[o + 3] = 255;
  }
  return out;
}
