// One fly plays one game of Doom.
//
// Every game tic (1/35 s): the picture goes into the fly's eyes (eye.js), the brain runs for the same
// 1/35 s (the complete brain by default), and the impulses of its output cells during that time become
// the game input for the next tic. Nothing else reaches the brain: no positions, no health, no score.
// The same seed and setup always give the same game, so a game can be replayed from its recorded input.
import { DOOM } from './engine.js';
import { KEY, rng } from './setup.js';
import { LearningCentre, LEARN } from './learning.js';
import { readLevel, buildNav } from './level.js';

const { S, MT, WP, BT } = DOOM;

// The task: the arena. The fly stands in a big round room with a shotgun; 8 monsters come for it.
export const ARENA = {
  name: 'arena',
  // skill 3 = "Hurt me plenty", Doom's normal difficulty. The fly starts with 200 health, the most Doom allows.
  map: 2, skill: 3, seconds: 30, weapon: WP.SHOTGUN, ammo: 50, health: 200,
  // when each monster appears (seconds) and what it is
  monsters: [
    { t: 0, type: MT.ZOMBIEMAN }, { t: 0, type: MT.IMP }, { t: 0, type: MT.ZOMBIEMAN },
    { t: 3, type: MT.IMP }, { t: 6, type: MT.SHOTGUNGUY }, { t: 9, type: MT.IMP },
    { t: 12, type: MT.ZOMBIEMAN }, { t: 15, type: MT.DEMON },
  ],
  near: 420, far: 640,          // how far from the middle they appear
};
// The other task: a real level. Freedoom's first level (MAP01) exactly as a human player starts it:
// a pistol with 50 bullets, 100 health, normal difficulty, and the level's own 18 monsters where its
// makers put them. Nothing is added and nothing is given. The way from the start to the exit switch is
// about 4,600 map units long and leads through three doors (js/doom/level.js works that out from the map).
export const LEVEL = {
  name: 'level', level: true,
  map: 1, skill: 3, seconds: 60, weapon: -1, ammo: -1, health: 0, monsters: [],
  // The score out of 8 (see Game.result): pressing the exit switch is 8. Short of that:
  wayPoints: 5,         // ...up to 5 points for the share of the way to the exit that the fly covered (walking distance, around the walls)
  groundPoints: 1.5,    // ...up to 1.5 for new ground: the squares of floor (64 x 64 units) it stood on,
  groundFull: 0.1,      //    with full marks for a tenth of the level's floor (walking straight to the exit covers a sixth)
  killPoints: 1.5,      // ...and up to 1.5 for the share of the level's monsters it killed
};
export const TASKS = { arena: ARENA, level: LEVEL };
// the task by name, with changes (for example { seconds: 90 })
export const taskOf = (name, changes = {}) => ({ ...(TASKS[name] || ARENA), ...changes });
// the "use" key (doors and switches), only in the level: see the controller in Game.step
export const USE_CELLS = ['DNp07_L', 'DNp07_R', 'DNp10_L', 'DNp10_R'];
const USE_HOLD = 8;                              // a key held down is let go for a moment after this many tics (Doom wants a new press each time)
const PATH_EVERY = 5;                            // the fly's place is noted every 5 tics, for the small map

export const HEALTH_OF = { [MT.ZOMBIEMAN]: 20, [MT.SHOTGUNGUY]: 30, [MT.IMP]: 60, [MT.DEMON]: 150 };
export const NAME_OF = { [MT.ZOMBIEMAN]: 'zombie', [MT.SHOTGUNGUY]: 'shotgun zombie', [MT.IMP]: 'imp', [MT.DEMON]: 'demon' };
export const FRAME_W = 96, FRAME_H = 60;        // the picture the eyes get (a fly sees far fewer points than that)
const TURN_UNITS = 65536 / 360 / 35;            // degrees per second -> Doom's turn units per tic
const SMOOTH = 1 - Math.exp(-(1000 / 35) / 100); // the ball's inertia: about a tenth of a second

// the output cells whose impulses are counted, in this order
export function readoutCells(rig, remap = null) {
  const g = rig.groups, names = ['DNa01_L', 'DNa02_L', 'DNa01_R', 'DNa02_R', 'DNg100_L', 'DNg97_L', 'DNg100_R', 'DNg97_R', 'MDN_L', 'MDN_R', 'DNp01_L', 'DNp01_R',
    'DNp09_L', 'DNp09_R', 'DNp02_L', 'DNp02_R', 'DNp04_L', 'DNp04_R', 'DNp15_L', 'DNp15_R', 'DNb05_L', 'DNb05_R', 'DNg13_L', 'DNg13_R', 'DNa03_L', 'DNa03_R', 'MN9_L', 'MN9_R',
    ...USE_CELLS];
  const idx = [], span = {};
  for (const nm of names) {
    const cells = (g[nm] || []).map((i) => remap ? remap(i) : i).filter((i) => i >= 0);
    span[nm] = [idx.length, cells.length];
    idx.push(...cells);
  }
  return { idx: Int32Array.from(idx), span, names };
}

export class Game {
  // learn: the learning centre may change (sugar for a kill, bitter for a hit taken), see learning.js
  constructor({ doom, brain, eye, rig, remap = null, task = ARENA, learn = false }) {
    this.doom = doom; this.brain = brain; this.eye = eye; this.task = task;
    this.read = readoutCells(rig, remap);
    // also counted, after the output cells: the Kenyon cells that get input from the eyes, then all the others
    this.lc = new LearningCentre(brain, rig, remap);
    this.learn = learn && this.lc.ok;
    const seen = new Set(this.lc.kc), others = this.lc.ok ? rig.groups.KC.filter((i) => !seen.has(i)) : [];
    this.kcFrom = this.read.idx.length; this.kcOtherFrom = this.kcFrom + this.lc.kc.length; this.kcEnd = this.kcOtherFrom + others.length;
    const watch = new Int32Array(this.kcEnd);
    watch.set(this.read.idx); watch.set(this.lc.kc, this.kcFrom); watch.set(others, this.kcOtherFrom);
    this.count = brain.watch(watch);
    // everything that is driven from outside: the eye cells, then the sugar and the bitter taste cells
    this.tasteFrom = eye.N; this.bitterFrom = eye.N + this.lc.sugarCells.length;
    this.dIdx = new Int32Array(this.bitterFrom + this.lc.bitterCells.length);
    this.dIdx.set(eye.cellIdx); this.dIdx.set(this.lc.sugarCells, this.tasteFrom); this.dIdx.set(this.lc.bitterCells, this.bitterFrom);
    this.dRate = new Float32Array(this.dIdx.length);
    this.maxTics = task.seconds * 35;
    this.cmds = new Int16Array(this.maxTics * 3);        // per tic: forward, turn, buttons
    // a real level: where one can walk in it and how far it is to the exit (for the score, never for the fly)
    this.nav = task.level ? buildNav(readLevel(doom.wad, task.map), task.skill) : null;
    this.path = new Int16Array(task.level ? 2 * (Math.ceil(this.maxTics / PATH_EVERY) + 1) : 0);
    this.seen = new Uint8Array(this.nav ? this.nav.groundSquares : 0);
    this.rates = {};                                      // last tic's read-outs in impulses per second, for display
    this.palette = -1;
  }

  // impulses of a group of output cells during the last tic
  _n(name) { const [o, n] = this.read.span[name]; let s = 0; for (let k = 0; k < n; k++) s += this.count[o + k]; return s; }

  // start a game: `setup` is the desk's setup (see setup.js), `seed` decides where the monsters appear,
  // `fly` (the desk's number) gives each fly its own run of chance in when exactly its eye cells fire,
  // and `memory` is what this fly's learning centre has learnt so far (null = nothing)
  start(setup, seed, fly = 0, memory = null) {
    const { doom, brain, eye, task } = this;
    this.setup = setup; this.seed = seed;
    doom.newGame({ skill: task.skill, map: task.map, seed });
    doom.give(task.weapon, task.ammo, task.health);
    brain.reset(); brain.seed((Math.imul(seed + 1, 2654435761) ^ Math.imul(fly + 1, 40503)) >>> 0);
    eye.o.gMotion = setup[KEY.gMotion]; eye.o.gContrast = setup[KEY.gContrast]; eye.o.gObject = setup[KEY.gObject]; eye.o.gDark = setup[KEY.gDark]; eye.o.gBlue = setup[KEY.gBlue];
    if (eye.widthDeg !== setup[KEY.screen] || eye.w !== FRAME_W) eye.setScreen(setup[KEY.screen], FRAME_W, FRAME_H); else eye.reset();
    this.palette = -1;
    this.rand = rng(seed * 7919 + 13);
    this.tic = 0; this.over = false; this.why = '';
    this.queue = task.monsters.map((m) => ({ ...m })).sort((a, b) => a.t - b.t);
    this.alive = new Map();              // id -> type, of the monsters now in the room
    this.spawned = 0; this.byOthers = 0; this.killedHealth = 0;
    this.sTurn = 0; this.sWalk = 0; this.sBack = 0;
    this.trig = new Uint8Array(4); this.spikes = 0; this.fired = 0;
    this.reach = new Uint8Array(4); this.useHeld = 0; this.uses = 0;
    this.way = 0; this.squares = 0; this.sugarDue = 0; this.pathN = 0; this.exited = false; this.seen.fill(0);
    if (this.nav) this._place();
    this.frame = null;
    this.lc.load(memory);
    this.sugarTics = 0; this.bitterTics = 0; this.lastKills = 0; this.lastTaken = 0;
    this.wasX = new Float32Array(35); this.wasY = new Float32Array(35); this.triedAt = new Float32Array(35); this.tried = 0; this.stuckAt = -99; this.stuck = 0;
    this.kcSum = 0; this.kcStorm = 0; this.kcEver = new Uint8Array(this.lc.kc.length);
    return this;
  }

  // the level's books: how far along the way to the exit the fly is, and which squares of floor it has stood on
  _place() {
    const st = this.doom.state, x = st[S.X] / 65536, y = st[S.Y] / 65536, nav = this.nav;
    const w = nav.way(x, y);
    if (w > this.way) this.way = w;
    const sq = nav.square(x, y);
    let fresh = 0;
    if (sq >= 0 && !this.seen[sq]) { this.seen[sq] = 1; this.squares++; fresh = 1; }
    if (this.tic % PATH_EVERY === 0 && this.pathN * 2 < this.path.length) { this.path[this.pathN * 2] = Math.round(x); this.path[this.pathN * 2 + 1] = Math.round(y); this.pathN++; }
    return fresh;
  }

  _spawn(type) {
    const { doom, task, rand } = this;
    for (let tries = 0; tries < 20; tries++) {
      const a = rand() * Math.PI * 2, r = task.near + rand() * (task.far - task.near);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const id = doom.spawn(type, x, y, (Math.atan2(-y, -x) * 180 / Math.PI + 360) % 360, true);
      if (id >= 0) { this.alive.set(id, type); this.spawned++; return true; }
    }
    return false;
  }

  // one game tic. Returns false when the game is over.
  step() {
    if (this.over) return false;
    const { doom, brain, eye, task, setup } = this, st = doom.state;
    // monsters that are due
    while (this.queue.length && this.queue[0].t * 35 <= this.tic) { const m = this.queue.shift(); if (!this._spawn(m.type)) { m.t += 0.5; this.queue.push(m); this.queue.sort((a, b) => a.t - b.t); } }
    // 1. the picture -> the eyes
    const frame = this.frame = doom.render(FRAME_W, FRAME_H);
    if (st[S.PALETTE] !== this.palette) { this.palette = st[S.PALETTE]; eye.setPalette(doom.palette(this.palette)); }
    const rate = eye.see(frame);
    // 2. the brain, for one tic (57 or 58 steps of half a millisecond)
    const steps = this.tic % 7 === 6 ? 58 : 57;
    this.count.fill(0);
    const dRate = this.dRate;
    dRate.set(rate);
    dRate.fill(this.sugarTics > 0 ? LEARN.tasteHz : 0, this.tasteFrom, this.bitterFrom);
    dRate.fill(this.bitterTics > 0 ? LEARN.tasteHz : 0, this.bitterFrom);
    if (this.sugarTics > 0) this.sugarTics--;
    if (this.bitterTics > 0) this.bitterTics--;
    brain.drive(this.dIdx, dRate, this.dIdx.length, steps);
    brain.run(steps);
    // the learning centre: which of its Kenyon cells fired (they are remembered as "active" for about a second)
    let kcNow = 0, kcAll = 0;
    if (this.lc.ok) {
      kcNow = this.lc.tick(this.count, this.kcFrom);
      for (let k = this.kcFrom, j = 0; k < this.kcOtherFrom; k++, j++) if (this.count[k]) this.kcEver[j] = 1;
      kcAll = kcNow; for (let k = this.kcOtherFrom; k < this.kcEnd; k++) if (this.count[k]) kcAll++;
      this.kcSum += kcNow; if (kcAll > 500) this.kcStorm++;
    }
    // 3. its output cells -> the controller
    const hz = 1000 / (steps * brain.p.dt);
    const left = (this._n('DNa01_L') + this._n('DNa02_L')) / 2 * hz, right = (this._n('DNa01_R') + this._n('DNa02_R')) / 2 * hz;
    const walk = (this._n('DNg100_L') + this._n('DNg97_L') + this._n('DNg100_R') + this._n('DNg97_R')) / 4 * hz;
    const back = (this._n('MDN_L') + this._n('MDN_R')) / 4 * hz;
    const jump = this._n('DNp01_L') + this._n('DNp01_R');
    this.sTurn += (left - right + setup[KEY.trim] - this.sTurn) * SMOOTH; this.sWalk += (walk - this.sWalk) * SMOOTH; this.sBack += (back - this.sBack) * SMOOTH;
    this.trig[this.tic & 3] = Math.min(255, jump);
    const recent = this.trig[0] + this.trig[1] + this.trig[2] + this.trig[3];
    const fire = recent >= setup[KEY.trigger];
    let turn = Math.round(setup[KEY.turn] * this.sTurn * TURN_UNITS);
    turn = Math.max(-2800, Math.min(2800, turn));                 // at most about 540 degrees per second
    const fwd = Math.max(-50, Math.min(50, Math.round(setup[KEY.walk] * this.sWalk - setup[KEY.back] * this.sBack)));
    // the "use" key, in a real level only: the fly's landing cells (DNp07 and DNp10; in a real fly they stretch
    // the legs out towards a surface that comes close). Enough of their impulses within a tenth of a second
    // press the key; while they keep firing, the key is let go for a moment now and then, because Doom
    // wants a new press for every door.
    let use = false, reach = 0;
    if (task.level) {
      for (const nm of USE_CELLS) reach += this._n(nm);
      this.reach[this.tic & 3] = Math.min(255, reach);
      if (this.reach[0] + this.reach[1] + this.reach[2] + this.reach[3] >= setup[KEY.use]) {
        if (this.useHeld < USE_HOLD) { use = true; if (!this.useHeld) this.uses++; this.useHeld++; } else this.useHeld = 0;
      } else this.useHeld = 0;
    }
    const buttons = (fire ? BT.FIRE : 0) | (use ? BT.USE : 0);
    this.rates = { left, right, walk, back, jump: jump * hz / 2, fire, turn, fwd, kc: kcNow, kcAll, sugar: this.sugarTics > 0, bitter: this.bitterTics > 0, reach: reach * hz / 4, use };
    return this.act(fwd, turn, buttons);
  }

  // The rest of a tic: the game runs for 1/35 s with this input, and the books are kept. step() ends with
  // it; the checks also call it directly, to let a hand-written player use the same keys as the fly.
  act(fwd, turn, buttons) {
    if (this.over) return false;
    const { doom, task } = this, st = doom.state;
    this.cmds[this.tic * 3] = fwd; this.cmds[this.tic * 3 + 1] = turn; this.cmds[this.tic * 3 + 2] = buttons;
    doom.setCmd(fwd, 0, turn, buttons);
    doom.tick(1);
    this.tic++;
    // 4. keep the books (the fly never sees any of this)
    const others = st[S.KILLS] - st[S.PLAYER_KILLS];
    const fresh = this.nav ? this._place() : 0;
    if (st[S.EXITED]) this.exited = true;
    if (!task.level && (others > this.byOthers || st[S.MONSTERS] < this.alive.size)) {
      const now = new Set(doom.things().map((t) => t.id));
      for (const [id, type] of this.alive) {
        if (now.has(id)) continue;
        this.alive.delete(id);
        if (others > this.byOthers) { this.byOthers++; this.queue.unshift({ t: 0, type }); }   // killed by another monster: it is replaced
        else this.killedHealth += HEALTH_OF[type] || 0;                                         // killed by the fly
      }
      this.byOthers = others;
    }
    // sugar for a monster the fly killed, bitter for a hit it took or for walking against a wall
    // (only if this fly is allowed to learn)
    if (this.learn) {
      if (st[S.PLAYER_KILLS] > this.lastKills) {
        this.sugarTics = LEARN.tasteTics;
        for (let k = !task.level && st[S.PLAYER_KILLS] >= task.monsters.length ? LEARN.clear : 1; k > 0; k--) this.lc.drop(1, 1);
      }
      // in a real level: sugar for new ground (a drop for every few squares of floor it had not stood on yet) and for the exit
      if (fresh && ++this.sugarDue >= LEARN.groundSquares) { this.sugarDue = 0; this.sugarTics = LEARN.tasteTics; this.lc.drop(1, 1); }
      if (this.exited) { this.sugarTics = LEARN.tasteTics; for (let k = LEARN.clear; k > 0; k--) this.lc.drop(1, 1); }
      if (st[S.DAMAGE_TAKEN] > this.lastTaken) { this.bitterTics = LEARN.tasteTics; this.lc.drop(2, Math.min(1, (st[S.DAMAGE_TAKEN] - this.lastTaken) / 20)); }
      // stuck: for a second it has tried to walk and got nowhere
      const slot = this.tic % 35, x = st[S.X] / 65536, y = st[S.Y] / 65536;
      this.tried += Math.abs(fwd) - this.triedAt[slot]; this.triedAt[slot] = Math.abs(fwd);
      if (this.tic >= 35 && this.tic - this.stuckAt >= 35 && this.tried / 35 >= 10 && Math.hypot(x - this.wasX[slot], y - this.wasY[slot]) < LEARN.stuckMove) {
        this.stuckAt = this.tic; this.stuck++; this.bitterTics = LEARN.tasteTics; this.lc.drop(2, LEARN.stuck);
      }
      this.wasX[slot] = x; this.wasY[slot] = y;
    }
    this.lastKills = st[S.PLAYER_KILLS]; this.lastTaken = st[S.DAMAGE_TAKEN];
    if (st[S.DEAD]) { this.over = true; this.why = 'the fly died'; }
    else if (this.exited) { this.over = true; this.why = 'the fly found the exit'; }
    else if (!task.level && st[S.PLAYER_KILLS] >= task.monsters.length) { this.over = true; this.why = 'all monsters dead'; }
    else if (this.tic >= this.maxTics) { this.over = true; this.why = 'time is up'; }
    return !this.over;
  }

  // the result: a score out of 8.
  // Arena: one point per monster the fly killed, plus a part of a point for the damage it did to monsters
  // it did not kill (damage that monsters do to each other does not count).
  // Level: 8 for pressing the exit switch. Short of that, points for the share of the way to the exit it
  // covered, for new ground and for the share of the level's monsters it killed (see LEVEL).
  result() {
    const { doom, task } = this, st = doom.state;
    const kills = st[S.PLAYER_KILLS];
    let score, perfect, level = null;
    if (task.level) {
      const nav = this.nav, ground = Math.min(1, this.squares / (task.groundFull * nav.groundTotal)), killed = nav.monsters ? Math.min(1, kills / nav.monsters) : 0;
      score = this.exited ? 8 : Math.min(7.9, task.wayPoints * this.way + task.groundPoints * ground + task.killPoints * killed);
      perfect = this.exited;
      const way = this.exited ? 1 : this.way;
      // doors: how many of the doors on the way to the exit the fly got through
      level = { way, squares: this.squares, ground, exited: this.exited, doors: nav.doors.filter((d) => way >= d.way).length, uses: this.uses, items: st[S.ITEMS], monsters: nav.monsters, path: this.path.slice(0, this.pathN * 2) };
    } else {
      const wounded = Math.max(0, st[S.DAMAGE_DEALT] - this.killedHealth) / 120;
      score = Math.min(task.monsters.length, kills + (kills >= task.monsters.length ? 0 : Math.min(0.9, wounded)));
      perfect = kills >= task.monsters.length && !st[S.DEAD];
    }
    return {
      score, kills, perfect, level, dead: !!st[S.DEAD], why: this.why,
      tics: this.tic, health: Math.max(0, st[S.HEALTH]), shots: st[S.SHOTS], hits: st[S.HITS], dealt: st[S.DAMAGE_DEALT], taken: st[S.DAMAGE_TAKEN],
      seed: this.seed, cmds: this.cmds.slice(0, this.tic * 3),
      // the learning centre: how many of its "visual" Kenyon cells fired on average per tic and at all, how often
      // the whole centre fired at once, the drops given, and the fly's memory after this game (if it may learn)
      kcPerTic: this.tic ? this.kcSum / this.tic : 0, kcEver: this.kcEver.reduce((a, b) => a + b, 0), kcStorm: this.tic ? this.kcStorm / this.tic : 0,
      sugar: this.lc.ok ? this.lc.drops.sugar : 0, bitter: this.lc.ok ? this.lc.drops.bitter : 0, stuck: this.stuck,
      memory: this.learn ? this.lc.memory() : null,
    };
  }
}

// Replays a recorded game in another Doom instance (no brain needed): same seed, same task, same input.
export class Replay {
  constructor(doom, task = ARENA) { this.doom = doom; this.task = task; }
  start(record) {
    const { doom, task } = this;
    this.rec = record; this.tic = 0; this.n = record.cmds.length / 3;
    doom.newGame({ skill: task.skill, map: task.map, seed: record.seed });
    doom.give(task.weapon, task.ammo, task.health);
    this.rand = rng(record.seed * 7919 + 13);
    this.queue = task.monsters.map((m) => ({ ...m })).sort((a, b) => a.t - b.t);
    this.alive = new Map(); this.byOthers = 0;
    return this;
  }
  step() {
    if (this.tic >= this.n) return false;
    const { doom, task, rand } = this, st = doom.state, c = this.rec.cmds;
    const spawn = (type) => {
      for (let tries = 0; tries < 20; tries++) {
        const a = rand() * Math.PI * 2, r = task.near + rand() * (task.far - task.near), x = Math.cos(a) * r, y = Math.sin(a) * r;
        const id = doom.spawn(type, x, y, (Math.atan2(-y, -x) * 180 / Math.PI + 360) % 360, true);
        if (id >= 0) { this.alive.set(id, type); return true; }
      }
      return false;
    };
    while (this.queue.length && this.queue[0].t * 35 <= this.tic) { const m = this.queue.shift(); if (!spawn(m.type)) { m.t += 0.5; this.queue.push(m); this.queue.sort((a, b) => a.t - b.t); } }
    doom.setCmd(c[this.tic * 3], 0, c[this.tic * 3 + 1], c[this.tic * 3 + 2]);
    doom.tick(1);
    this.tic++;
    const others = st[S.KILLS] - st[S.PLAYER_KILLS];
    if (others > this.byOthers || st[S.MONSTERS] < this.alive.size) {
      const now = new Set(doom.things().map((t) => t.id));
      for (const [id, type] of this.alive) if (!now.has(id)) { this.alive.delete(id); if (others > this.byOthers) { this.byOthers++; this.queue.unshift({ t: 0, type }); } }
      this.byOthers = others;
    }
    return this.tic < this.n;
  }
}
