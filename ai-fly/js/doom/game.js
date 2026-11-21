// One fly plays one game of Doom.
//
// Every game tic (1/35 s): the picture goes into the fly's eyes (eye.js), the brain runs for the same
// 1/35 s (the complete brain by default), and the impulses of its output cells during that time become
// the game input for the next tic. Nothing else reaches the brain: no positions, no health, no score.
// The same seed and setup always give the same game, so a game can be replayed from its recorded input.
import { DOOM } from './engine.js';
import { KEY, rng } from './setup.js';

const { S, MT, WP, BT } = DOOM;

// The task: the arena. The fly stands in a big round room with a shotgun; 8 monsters come for it.
export const ARENA = {
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
export const HEALTH_OF = { [MT.ZOMBIEMAN]: 20, [MT.SHOTGUNGUY]: 30, [MT.IMP]: 60, [MT.DEMON]: 150 };
export const NAME_OF = { [MT.ZOMBIEMAN]: 'zombie', [MT.SHOTGUNGUY]: 'shotgun zombie', [MT.IMP]: 'imp', [MT.DEMON]: 'demon' };
export const FRAME_W = 96, FRAME_H = 60;        // the picture the eyes get (a fly sees far fewer points than that)
const TURN_UNITS = 65536 / 360 / 35;            // degrees per second -> Doom's turn units per tic
const SMOOTH = 1 - Math.exp(-(1000 / 35) / 100); // the ball's inertia: about a tenth of a second

// the output cells whose impulses are counted, in this order
export function readoutCells(rig, remap = null) {
  const g = rig.groups, names = ['DNa01_L', 'DNa02_L', 'DNa01_R', 'DNa02_R', 'DNg100_L', 'DNg97_L', 'DNg100_R', 'DNg97_R', 'MDN_L', 'MDN_R', 'DNp01_L', 'DNp01_R',
    'DNp09_L', 'DNp09_R', 'DNp02_L', 'DNp02_R', 'DNp04_L', 'DNp04_R', 'DNp15_L', 'DNp15_R', 'DNb05_L', 'DNb05_R', 'DNg13_L', 'DNg13_R', 'DNa03_L', 'DNa03_R', 'MN9_L', 'MN9_R'];
  const idx = [], span = {};
  for (const nm of names) {
    const cells = g[nm].map((i) => remap ? remap(i) : i).filter((i) => i >= 0);
    span[nm] = [idx.length, cells.length];
    idx.push(...cells);
  }
  return { idx: Int32Array.from(idx), span, names };
}

export class Game {
  constructor({ doom, brain, eye, rig, remap = null, task = ARENA }) {
    this.doom = doom; this.brain = brain; this.eye = eye; this.task = task;
    this.read = readoutCells(rig, remap);
    this.count = brain.watch(this.read.idx);
    this.maxTics = task.seconds * 35;
    this.cmds = new Int16Array(this.maxTics * 3);        // per tic: forward, turn, buttons
    this.rates = {};                                      // last tic's read-outs in impulses per second, for display
    this.palette = -1;
  }

  // impulses of a group of output cells during the last tic
  _n(name) { const [o, n] = this.read.span[name]; let s = 0; for (let k = 0; k < n; k++) s += this.count[o + k]; return s; }

  // start a game: `setup` is the desk's setup (see setup.js), `seed` decides where the monsters appear,
  // and `fly` (the desk's number) gives each fly its own run of chance in when exactly its eye cells fire
  start(setup, seed, fly = 0) {
    const { doom, brain, eye, task } = this;
    this.setup = setup; this.seed = seed;
    doom.newGame({ skill: task.skill, map: task.map, seed });
    doom.give(task.weapon, task.ammo, task.health);
    brain.reset(); brain.seed((Math.imul(seed + 1, 2654435761) ^ Math.imul(fly + 1, 40503)) >>> 0);
    eye.o.gMotion = setup[KEY.gMotion]; eye.o.gContrast = setup[KEY.gContrast]; eye.o.gObject = setup[KEY.gObject]; eye.o.gDark = setup[KEY.gDark];
    if (eye.widthDeg !== setup[KEY.screen] || eye.w !== FRAME_W) eye.setScreen(setup[KEY.screen], FRAME_W, FRAME_H); else eye.reset();
    this.palette = -1;
    this.rand = rng(seed * 7919 + 13);
    this.tic = 0; this.over = false; this.why = '';
    this.queue = task.monsters.map((m) => ({ ...m })).sort((a, b) => a.t - b.t);
    this.alive = new Map();              // id -> type, of the monsters now in the room
    this.spawned = 0; this.byOthers = 0; this.killedHealth = 0;
    this.sTurn = 0; this.sWalk = 0; this.sBack = 0;
    this.trig = new Uint8Array(4); this.spikes = 0; this.fired = 0;
    this.frame = null;
    return this;
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
    brain.drive(eye.cellIdx, rate, eye.N, steps);
    brain.run(steps);
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
    const buttons = fire ? BT.FIRE : 0;
    this.rates = { left, right, walk, back, jump: jump * hz / 2, fire, turn, fwd };
    this.cmds[this.tic * 3] = fwd; this.cmds[this.tic * 3 + 1] = turn; this.cmds[this.tic * 3 + 2] = buttons;
    doom.setCmd(fwd, 0, turn, buttons);
    doom.tick(1);
    this.tic++;
    // 4. keep the books (the fly never sees any of this)
    const others = st[S.KILLS] - st[S.PLAYER_KILLS];
    if (others > this.byOthers || st[S.MONSTERS] < this.alive.size) {
      const now = new Set(doom.things().map((t) => t.id));
      for (const [id, type] of this.alive) {
        if (now.has(id)) continue;
        this.alive.delete(id);
        if (others > this.byOthers) { this.byOthers++; this.queue.unshift({ t: 0, type }); }   // killed by another monster: it is replaced
        else this.killedHealth += HEALTH_OF[type] || 0;                                         // killed by the fly
      }
      this.byOthers = others;
    }
    if (st[S.DEAD]) { this.over = true; this.why = 'the fly died'; }
    else if (st[S.PLAYER_KILLS] >= task.monsters.length) { this.over = true; this.why = 'all monsters dead'; }
    else if (this.tic >= this.maxTics) { this.over = true; this.why = 'time is up'; }
    return !this.over;
  }

  // the result: a score out of 8. One point per monster the fly killed, plus a part of a point for the
  // damage it did to monsters it did not kill (damage that monsters do to each other does not count)
  result() {
    const { doom, task } = this, st = doom.state;
    const kills = st[S.PLAYER_KILLS];
    const wounded = Math.max(0, st[S.DAMAGE_DEALT] - this.killedHealth) / 120;
    const score = Math.min(task.monsters.length, kills + (kills >= task.monsters.length ? 0 : Math.min(0.9, wounded)));
    return {
      score, kills, perfect: kills >= task.monsters.length && !st[S.DEAD], dead: !!st[S.DEAD], why: this.why,
      tics: this.tic, health: Math.max(0, st[S.HEALTH]), shots: st[S.SHOTS], hits: st[S.HITS], dealt: st[S.DAMAGE_DEALT], taken: st[S.DAMAGE_TAKEN],
      seed: this.seed, cmds: this.cmds.slice(0, this.tic * 3),
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
