// The Doom gym's training loop without any page around it. The Doom Gym page and the Doom Cubicles
// office both use it.
//
// Every lab (one background worker, so one CPU core) has one fly brain and plays its desks one after
// the other: a complete brain keeps a core busy, so only as many flies as there are cores can play
// at the same moment. A round is over when every desk has played once. Then, inside each lab, the
// setups of the best desks are copied (with small random changes) over the setups of the worst, and
// each lab passes its best setup on to the next lab. The flies' brains are all the same and never change.
import { compileDoom, fetchDoomFiles } from './engine.js';
import { readData, loadWiring } from './load.js';
import { NSETUP, defaultSetup, randomSetup, rng } from './setup.js';
import { evolve } from './evolve.js';
import { ARENA } from './game.js';

export class DoomRunner {
  constructor({ labs = 8, perLab = 128, fast = false, seconds = ARENA.seconds, elite = 0.3, onFrame = null, onGame = null, onRound = null, onStatus = null } = {}) {
    Object.assign(this, { labs, perLab, fast, seconds, elite, onFrame, onGame, onRound, onStatus });
    this.workers = []; this.pending = new Map(); this.nextId = 1;
    this.running = false; this.loopBusy = false; this.watched = -1;
    this.info = null; this.palettes = null;
    this.reset(1);
  }

  get desks() { return this.labs * this.perLab; }

  // fresh desks: the first desk of every lab gets the standard setup, all others a random one
  reset(seed = (Math.random() * 1e9) | 0) {
    const n = this.desks;
    this.rand = rng(seed);
    this.setups = Array.from({ length: n }, (_, i) => i % this.perLab === 0 ? defaultSetup() : randomSetup(this.rand));
    this.fitness = new Float32Array(n);          // how well this desk's setup has done so far
    this.score = new Float32Array(n).fill(-1);   // this round's score (-1 = has not played yet)
    this.last = new Array(n).fill(null);         // each desk's latest game
    this.records = new Array(n).fill(null);      // ...and its recorded input, for replays
    this.round = 0; this.games = 0; this.history = []; this.perfect = 0; this.firstPerfect = null;
    this.best = null;                            // the best game so far: { score, lab, desk, round, setup, record }
    this.gameSeconds = 0; this.wallSeconds = 0; this.impulses = 0; this.speeds = [];
  }

  call(w, msg, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); w.postMessage({ ...msg, id }, transfer); });
  }

  // load the game, the brain's wiring and the eye map, and start one worker per lab
  async init() {
    this.terminate();
    const say = (t) => this.onStatus && this.onStatus(t);
    say('loading Doom');
    const { wasm, wad } = await fetchDoomFiles();
    const module = await compileDoom(wasm);
    say(this.fast ? 'loading the reduced circuit' : 'loading the brain (61 MB)');
    const [wiring, rigMetaBuf, rigBin] = await Promise.all([loadWiring(this.fast), readData('doom/rig.json'), readData('doom/rig.bin')]);
    const rigMeta = JSON.parse(new TextDecoder().decode(rigMetaBuf));
    this.rigMeta = rigMeta; this.rigBin = rigBin; this.wasm = module; this.wad = wad;
    this.shared = typeof SharedArrayBuffer !== 'undefined' && wiring instanceof SharedArrayBuffer;
    say(`starting ${this.labs} brains`);
    // a worker whose files did not arrive (a busy local server now and then refuses a connection) is started again
    const spawn = async (lab) => {
      for (let attempt = 0; ; attempt++) {
        const w = new Worker(new URL('./doom-worker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._message(e.data);
        // without shared memory every lab needs its own copy of the wiring
        const mine = this.shared ? wiring : wiring.slice(0);
        const failed = new Promise((_, reject) => { w.onerror = (e) => reject(new Error(e.message || 'the lab did not load')); });
        try {
          const ready = await Promise.race([failed, this.call(w, { type: 'init', lab, fast: this.fast, wasm: module, wad: wad.slice(0), wiring: mine, rigBin: rigBin.slice(0), rigMeta, task: { seconds: this.seconds } }, this.shared ? [] : [mine])]);
          w.onerror = (e) => { console.error(e); say(`lab ${lab + 1} stopped: ${e.message || 'unknown reason'}`); };
          this.workers[lab] = w;
          return ready;
        } catch (err) {
          w.terminate();
          if (attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    };
    this.workers = new Array(this.labs);
    const ready = await Promise.all(Array.from({ length: this.labs }, (_, lab) => spawn(lab)));
    this.info = { neurons: ready[0].neurons, connections: ready[0].connections, driven: ready[0].driven };
    this.palettes = ready[0].palettes;
    say('');
    return this.info;
  }

  terminate() {
    for (const w of this.workers) if (w) w.terminate();
    this.workers = []; this.pending.clear(); this.loopBusy = false;
  }

  _message(m) {
    if (m.type === 'frame') { if (this.onFrame) this.onFrame(m); return; }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
  }

  // which lab sends the details of its game (the facets and the firing neurons); -1 = none
  watch(lab) {
    if (lab === this.watched) return;
    if (this.watched >= 0 && this.workers[this.watched]) this.workers[this.watched].postMessage({ type: 'watch', on: false });
    this.watched = lab;
    if (lab >= 0 && this.workers[lab]) this.workers[lab].postMessage({ type: 'watch', on: true });
  }

  // every desk in a round faces the same monsters at the same places
  seedOf(round) { return (round * 7 + 3) % 256 + 256 * round; }

  async _labRound(lab) {
    const w = this.workers[lab], seed = this.seedOf(this.round);
    for (let d = 0; d < this.perLab && this.running; d++) {
      const i = lab * this.perLab + d;
      if (this.score[i] >= 0) continue;                       // already played this round (after a reload)
      const m = await this.call(w, { type: 'play', lab, desk: d, setup: this.setups[i], seed, live: true });
      if (m.aborted) return;
      this._gameDone(i, lab, d, m);
    }
  }

  _gameDone(i, lab, desk, m) {
    const r = m.result;
    this.score[i] = r.score;
    this.fitness[i] = this.last[i] && this.last[i].sameSetup ? 0.5 * this.fitness[i] + 0.5 * r.score : r.score;
    this.records[i] = { seed: r.seed, cmds: r.cmds };
    this.last[i] = { score: r.score, kills: r.kills, perfect: r.perfect, dead: r.dead, why: r.why, seconds: r.tics / 35, shots: r.shots, hits: r.hits, health: r.health, thumb: m.thumb, pal: m.pal, round: this.round, sameSetup: true };
    this.games++; this.gameSeconds += r.tics / 35; this.wallSeconds += m.ms / 1000; this.impulses += m.impulses;
    this.speeds.push(m.speed); if (this.speeds.length > 24) this.speeds.shift();
    if (r.perfect) { this.perfect++; if (!this.firstPerfect) this.firstPerfect = { round: this.round + 1, lab, desk, game: this.games }; }
    const better = !this.best || r.score > this.best.score + 1e-6 || (r.perfect && this.best.perfect && r.tics < this.best.tics);
    if (better) this.best = { score: r.score, kills: r.kills, perfect: r.perfect, tics: r.tics, lab, desk, round: this.round + 1, setup: Float32Array.from(this.setups[i]), record: this.records[i] };
    if (this.onGame) this.onGame({ index: i, lab, desk, result: r, first: r.perfect && this.perfect === 1, better });
  }

  // how fast one brain runs, compared with real time (average of the latest games)
  get speed() { return this.speeds.length ? this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length : 0; }
  get playedThisRound() { let n = 0; for (let i = 0; i < this.score.length; i++) if (this.score[i] >= 0) n++; return n; }

  // after a round: the desks' setups are passed on (see evolve.js)
  _evolve() {
    const n = this.desks;
    let best = 0, sum = 0, perfect = 0;
    for (let i = 0; i < n; i++) { sum += this.score[i]; if (this.score[i] > best) best = this.score[i]; if (this.last[i] && this.last[i].perfect && this.last[i].round === this.round) perfect++; }
    const stat = { round: this.round + 1, best, mean: sum / n, perfect: perfect / n };
    this.history.push(stat);
    for (const dst of evolve(this)) if (this.last[dst]) this.last[dst].sameSetup = false;
    this.score.fill(-1);
    this.round++;
    return stat;
  }

  // promotion: one desk's setup is copied over the `perLab` weakest desks of every lab
  promote(index, perLab = 8) {
    let n = 0;
    for (let lab = 0; lab < this.labs; lab++) {
      const order = Array.from({ length: this.perLab }, (_, d) => lab * this.perLab + d).filter((i) => i !== index).sort((a, b) => this.fitness[a] - this.fitness[b]);
      for (const i of order.slice(0, perLab)) { this.setups[i] = Float32Array.from(this.setups[index]); this.fitness[i] = this.fitness[index]; if (this.last[i]) this.last[i].sameSetup = false; n++; }
    }
    return n;
  }

  // per lab: the best score of its desks' latest games, and how many of those were perfect
  get labStats() {
    return Array.from({ length: this.labs }, (_, lab) => {
      let best = 0, solved = 0, played = 0;
      for (let d = 0; d < this.perLab; d++) { const l = this.last[lab * this.perLab + d]; if (l) { played++; best = Math.max(best, l.score); if (l.perfect) solved++; } }
      return played ? { best, solved, played } : null;
    });
  }

  // keeps playing rounds until pause()
  async start() {
    if (this.running || this.loopBusy) { this.running = true; return; }
    this.running = true; this.loopBusy = true;
    try {
      while (this.running) {
        await Promise.all(this.workers.map((_, lab) => this._labRound(lab)));
        if (!this.running) break;
        const stat = this._evolve();
        if (this.onRound) this.onRound(stat);
      }
    } finally { this.loopBusy = false; }
  }

  // the games that are running are finished first
  pause() { this.running = false; }

  // ---- saving and continuing (a round with complete brains takes a long time) ----
  snapshot() {
    return {
      v: 1, labs: this.labs, perLab: this.perLab, fast: this.fast, seconds: this.seconds, round: this.round, games: this.games, perfect: this.perfect,
      firstPerfect: this.firstPerfect, history: this.history, gameSeconds: this.gameSeconds, wallSeconds: this.wallSeconds, impulses: this.impulses,
      setups: this.setups.map((s) => Array.from(s, (x) => +x.toFixed(4))), fitness: Array.from(this.fitness, (x) => +x.toFixed(3)), score: Array.from(this.score, (x) => +x.toFixed(3)),
      last: this.last.map((l) => l && { score: +l.score.toFixed(3), kills: l.kills, perfect: l.perfect, dead: l.dead, seconds: +l.seconds.toFixed(1), shots: l.shots, hits: l.hits, health: l.health, round: l.round, sameSetup: l.sameSetup }),
      best: this.best && { ...this.best, setup: Array.from(this.best.setup), record: { seed: this.best.record.seed, cmds: Array.from(this.best.record.cmds) } },
    };
  }

  restore(s) {
    if (!s || s.v !== 1 || s.labs !== this.labs || s.perLab !== this.perLab || !!s.fast !== !!this.fast || s.seconds !== this.seconds || s.setups[0].length !== NSETUP) return false;
    this.round = s.round; this.games = s.games; this.perfect = s.perfect; this.firstPerfect = s.firstPerfect; this.history = s.history;
    this.gameSeconds = s.gameSeconds; this.wallSeconds = s.wallSeconds; this.impulses = s.impulses;
    this.setups = s.setups.map((a) => Float32Array.from(a)); this.fitness = Float32Array.from(s.fitness); this.score = Float32Array.from(s.score);
    this.last = s.last.map((l) => l && { ...l, thumb: null, pal: 0 });
    this.best = s.best && { ...s.best, setup: Float32Array.from(s.best.setup), record: { seed: s.best.record.seed, cmds: Int16Array.from(s.best.record.cmds) } };
    return true;
  }

  async save(url) {
    const body = new TextEncoder().encode(JSON.stringify(this.snapshot()));
    await fetch(`${url}?round=${this.round}&games=${this.games}`, { method: 'POST', body }).catch(() => {});
  }

  async load(url) {
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) return false;
    try { return this.restore(JSON.parse(await r.text())); } catch { return false; }
  }
}
