// A population of flies, each with its own copy of the learning centre's memory (how strongly each
// of its 5,177 Kenyon cells pushes the "approach" and the "avoid" outputs). Every generation each fly
// types a program token by token, the customer scores it, and dopamine changes each fly's memory.
import { writeProgram, comboKey } from './grammar.js';
import { judge } from './judge.js';

export function parseGym(buf, meta) {
  const h = new Uint32Array(buf, 0, 4);
  if (h[0] !== 0x314d5947) throw new Error('not a Fly Gym file');
  const [, nCombos, nKC, total] = h;
  let p = 16;
  const take = (Type, n) => { const a = new Type(buf, p, n); p += n * Type.BYTES_PER_ELEMENT; p = (p + 3) & ~3; return a; };
  const offsets = take(Uint32Array, nCombos + 1);
  const a0 = take(Float32Array, nKC);
  const v0 = take(Float32Array, nKC);
  const idx = take(Uint16Array, total);
  const cnt = take(Uint8Array, total);
  // innate total push of each smell, used to put all smells on the same scale
  const norm = new Float32Array(nCombos);
  for (let c = 0; c < nCombos; c++) {
    let s = 0;
    for (let i = offsets[c]; i < offsets[c + 1]; i++) s += cnt[i] * (a0[idx[i]] + v0[idx[i]]);
    norm[c] = s + 1e-9;
  }
  return { keys: meta.keys, keyIndex: new Map(meta.keys.map((k, i) => [k, i])), nCombos, nKC, offsets, a0, v0, idx, cnt, norm };
}

export const DEFAULTS = {
  temperature: 0.04,   // choice noise
  sugar: 0.35,         // how much one sugar weakens a smell's link to "avoid"
  bitter: 0.12,        // how much one bitter weakens a smell's link to "approach"
  recover: 0.004,      // memories slowly drift back to the innate wiring
  elite: 0.3,          // top share whose memories are copied to the bottom share
  innateNorm: 0,       // 1: liking = (approach - avoid) / innate total; 0: / current total
  quantile: 0,         // 1: sugar only for the generation's best programs, bitter for its worst
  qHi: 0.8, qLo: 0.4,
  attempts: 4,         // programs per fly per generation; >1: sugar for its best, bitter for its worst
  islands: 1,          // separate labs: memories are only copied inside a lab...
  migrateEvery: 25,    // ...except that every so often a lab's best fly moves to another lab
  mutation: 0,         // random variation added to a memory when it is copied (0 = none)
  focus: 0,            // 1: the first attempt each round is written at full concentration (best guess)
  focusTemperature: 0.002,
};

export class FlyPopulation {
  constructor(gym, n, opts = {}) {
    this.g = gym;
    this.n = n;
    this.o = { ...DEFAULTS, ...opts };
    const K = gym.nKC;
    this.K = K;
    // per fly, per Kenyon cell: [approach push, avoid push], side by side for speed
    this.W = new Float32Array(n * K * 2);
    for (let f = 0; f < n; f++) for (let k = 0; k < K; k++) { this.W[(f * K + k) * 2] = gym.a0[k]; this.W[(f * K + k) * 2 + 1] = gym.v0[k]; }
    this.baseline = new Float32Array(n);
    this.score = new Float32Array(n);
    this.passed = new Uint8Array(n);
    this.programs = new Array(n);
    this.results = new Array(n);
    this.gen = 0;
    this.history = [];
    this.bestEver = { score: -1 };
  }

  valence(f, combo) {
    const { offsets, idx, cnt } = this.g;
    const base = f * 2 * this.K, W = this.W;
    let a = 0, v = 0;
    for (let i = offsets[combo]; i < offsets[combo + 1]; i++) { const j = base + 2 * idx[i], c = cnt[i]; a += c * W[j]; v += c * W[j + 1]; }
    return (a - v) / (this.o.innateNorm ? this.g.norm[combo] : a + v + 1e-9);
  }

  write(f, T = this.o.temperature) {
    const ki = this.g.keyIndex;
    return writeProgram((line, state, opts) => {
      const vals = opts.map((t) => this.valence(f, ki.get(comboKey(line, state, t))));
      const m = Math.max(...vals);
      const ex = vals.map((v) => Math.exp((v - m) / T));
      let x = Math.random() * ex.reduce((a, b) => a + b, 0), k = 0;
      while (k < ex.length - 1 && (x -= ex[k]) > 0) k++;
      return k;
    });
  }

  // dopamine: sugar weakens the active Kenyon cells' push onto "avoid", bitter onto "approach"
  learn(f, decisions, kind, strength) {
    const { offsets, idx } = this.g;
    const ki = this.g.keyIndex, W = this.W;
    const base = f * 2 * this.K + (kind === 'sugar' ? 1 : 0);
    const factor = 1 - strength;
    for (const [line, state, t] of decisions) {
      const c = ki.get(comboKey(line, state, t));
      for (let i = offsets[c]; i < offsets[c + 1]; i++) W[base + 2 * idx[i]] *= factor;
    }
  }

  copyMemory(src, dst) {
    const L = 2 * this.K, W = this.W;
    W.copyWithin(dst * L, src * L, (src + 1) * L);
    this.baseline[dst] = this.baseline[src];
    const s = this.o.mutation;
    if (s > 0) {
      for (let j = dst * L, end = j + L; j < end; j++) {
        // cheap approximately-normal noise
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 2;
        W[j] *= Math.exp(s * g);
      }
    }
  }

  generation() {
    const { n, o } = this;
    const worst = new Array(n);
    this.focused = this.focused || new Array(n);
    for (let f = 0; f < n; f++) {
      let best = null, bad = null;
      for (let a = 0; a < o.attempts; a++) {
        const focused = o.focus && a === 0;
        const p = this.write(f, focused ? o.focusTemperature : o.temperature);
        const r = judge(p.code);
        if (focused) this.focused[f] = { p, r };
        if (!best || r.score > best.r.score) best = { p, r };
        if (!bad || r.score < bad.r.score) bad = { p, r };
      }
      // what the fly shows: its concentrated attempt if it has one, else its best one
      const show = o.focus ? this.focused[f] : best;
      this.programs[f] = best.p;
      this.results[f] = show.r;
      this.shown = this.shown || new Array(n);
      this.shown[f] = show.p;
      this.score[f] = show.r.score;
      this.passed[f] = show.r.passed;
      worst[f] = bad;
      best.f = f;
      this.bestAttempt = this.bestAttempt || new Array(n);
      this.bestAttempt[f] = best;
    }
    if (o.attempts > 1) {
      // compare its own attempts: the better one earns sugar, the worse one bitter
      for (let f = 0; f < n; f++) {
        const gap = this.bestAttempt[f].r.score - worst[f].r.score;
        if (gap > 0.01) {
          this.learn(f, this.bestAttempt[f].p.decisions, 'sugar', o.sugar * Math.min(1, gap));
          this.learn(f, worst[f].p.decisions, 'bitter', o.bitter * Math.min(1, gap));
        }
        this.baseline[f] = this.gen === 0 ? this.score[f] : 0.8 * this.baseline[f] + 0.2 * this.score[f];
      }
    } else if (o.quantile) {
      // only the generation's best programs earn sugar, its worst earn bitter
      const sorted = Float32Array.from(this.score).sort();
      const hi = sorted[Math.floor(n * o.qHi)], lo = sorted[Math.floor(n * o.qLo)];
      const span = Math.max(0.5, sorted[n - 1] - hi);
      for (let f = 0; f < n; f++) {
        const s = this.score[f];
        if (s >= hi && s > 0) this.learn(f, this.programs[f].decisions, 'sugar', o.sugar * Math.min(1, 0.3 + (s - hi) / span));
        else if (s < lo) this.learn(f, this.programs[f].decisions, 'bitter', o.bitter);
        this.baseline[f] = this.gen === 0 ? s : 0.8 * this.baseline[f] + 0.2 * s;
      }
    } else {
      // each fly compares the customer's rating with what it usually gets
      for (let f = 0; f < n; f++) {
        const d = this.score[f] - this.baseline[f];
        if (this.gen > 0 && d > 0.01) this.learn(f, this.programs[f].decisions, 'sugar', o.sugar * Math.min(1, d));
        else if (this.gen > 0 && d < -0.01) this.learn(f, this.programs[f].decisions, 'bitter', o.bitter * Math.min(1, -d));
        this.baseline[f] = this.gen === 0 ? this.score[f] : 0.8 * this.baseline[f] + 0.2 * this.score[f];
      }
    }
    // memories slowly drift back toward the innate wiring
    if (o.recover > 0) {
      const { a0, v0 } = this.g, K = this.K, W = this.W, r = o.recover;
      for (let f = 0; f < n; f++) {
        const b = f * 2 * K;
        for (let k = 0; k < K; k++) { const j = b + 2 * k; W[j] += r * (a0[k] - W[j]); W[j + 1] += r * (v0[k] - W[j + 1]); }
      }
    }
    // inside each lab, the best flies' memories are copied over the worst flies' memories
    const copies = [];
    const labSize = Math.ceil(n / o.islands);
    const labs = [];
    for (let s = 0; s < n; s += labSize) {
      const order = Array.from({ length: Math.min(labSize, n - s) }, (_, i) => s + i).sort((a, b) => this.baseline[b] - this.baseline[a]);
      labs.push(order);
      const m = Math.floor(order.length * o.elite);
      for (let i = 0; i < m; i++) copies.push([order[Math.floor(Math.random() * m)], order[order.length - 1 - i]]);
    }
    // now and then a lab's best fly moves into another lab
    if (o.islands > 1 && this.gen > 0 && this.gen % o.migrateEvery === 0) {
      for (let i = 0; i < labs.length; i++) {
        const to = labs[(i + 1 + Math.floor(Math.random() * (labs.length - 1))) % labs.length];
        copies.push([labs[i][0], to[to.length - 1]]);
      }
    }
    for (const [src, dst] of copies) this.copyMemory(src, dst);
    let best = 0;
    for (let f = 1; f < n; f++) if (this.score[f] > this.score[best]) best = f;
    if (this.score[best] > this.bestEver.score) this.bestEver = { score: this.score[best], passed: this.passed[best], code: this.shown[best].code, tokens: this.shown[best].tokens, gen: this.gen, fly: best };
    const mean = this.score.reduce((a, b) => a + b, 0) / n;
    const solved = this.passed.reduce((a, p) => a + (p === 8 ? 1 : 0), 0);
    const stat = { gen: this.gen, best: this.score[best], bestPassed: this.passed[best], mean, solved, bestFly: best };
    this.history.push(stat);
    this.gen++;
    this.lastCopies = copies;
    return stat;
  }
}
