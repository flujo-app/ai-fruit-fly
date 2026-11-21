// The same whole-brain model as brain-engine.js (Shiu et al. 2024: every neuron a leaky
// integrate-and-fire cell, every connection used, the paper's settings), computed with less wasted work.
//
// brain-engine.js updates every neuron that holds any charge, every half millisecond. But a neuron
// that is far below its firing threshold cannot fire until new input arrives, and until then its
// charge just fades along a known curve. So here such a neuron is left alone, and when its next input
// arrives it is brought up to date in one go with the exact formula. Only the few neurons that are
// close enough to threshold to fire by themselves are stepped every half millisecond. The results
// are the same (up to rounding in the last digits); the cost now follows the number of nerve
// impulses instead of the number of charged neurons. tools/test_brain_fast.mjs compares the two.
//
// Used by the Doom pages, where the eyes keep tens of thousands of neurons busy.
import { PARAMS } from './brain-engine.js';

export class FastBrain {
  constructor(conn, params = {}) {
    this.p = { ...PARAMS, ...params };
    const { n, rowptr, edges, targetBits } = conn;
    this.n = n; this.rowptr = rowptr; this.edges = edges;
    this.mask = (1 << targetBits) - 1; this.shift = targetBits;
    const { dt, tauM, tauS } = this.p;
    this.Em = Math.exp(-dt / tauM); this.Es = Math.exp(-dt / tauS);
    this.c = tauS / (tauS - tauM);                       // negative while synapses are faster than the membrane
    this.K = this.c * (this.Es - this.Em);
    this.cAbs = Math.abs(this.c);
    this.refSteps = Math.max(1, Math.round(this.p.refractory / dt));
    this.delaySteps = Math.max(1, Math.round(this.p.delay / dt));

    // fading over k steps at once: u' = u*EmK[k] + g*KK[k], g' = g*EsK[k]
    const KMAX = this.KMAX = Math.ceil(1200 / dt);       // after 1.2 s nothing measurable is left
    this.EmK = new Float32Array(KMAX + 1); this.EsK = new Float32Array(KMAX + 1); this.KK = new Float32Array(KMAX + 1);
    for (let k = 0; k <= KMAX; k++) {
      this.EmK[k] = Math.exp(-k * dt / tauM); this.EsK[k] = Math.exp(-k * dt / tauS);
      this.KK[k] = this.c * (this.EsK[k] - this.EmK[k]);
    }

    // per neuron, side by side in memory (so one impulse touches one spot per target):
    //   F[4i] membrane potential above rest (mV), F[4i+1] synaptic input (mV),
    //   I[4i+2] the step for whose end those two are valid, I[4i+3] refractory until this step
    const buf = new ArrayBuffer(16 * n);
    this.F = new Float32Array(buf); this.I = new Int32Array(buf);
    for (let i = 0; i < n; i++) this.I[4 * i + 2] = -1;
    this.isHot = new Uint8Array(n);        // close enough to threshold to be stepped every step
    this.hot = new Int32Array(n); this.nHot = 0;
    this.silenced = new Uint8Array(n);
    this.queue = Array.from({ length: this.delaySteps + 1 }, () => ({ ids: new Int32Array(4096), len: 0 }));
    this.step = 0;
    this.spikesTotal = 0; this.eventsTotal = 0;

    // spike counters of watched neurons: slot[i] = index into `count`, or -1
    this.slot = new Int32Array(n).fill(-1);
    this.count = new Uint32Array(0);
    // optional log of every spike (for drawing the brain); the caller empties it
    this.log = null; this.logLen = 0;

    // sensory drive for the current stretch of steps: spikes[stepOffset] is a linked list of cells
    this.dHead = new Int32Array(256).fill(-1); this.dNext = new Int32Array(1 << 16); this.dCell = new Int32Array(1 << 16);
    this.dLen = 0; this.dBase = 0;
    this.seed(1);
  }

  seed(s) { this.rng = (s >>> 0) || 0x9e3779b9; }
  // xorshift32: fast, repeatable random numbers in [0, 1)
  rand() { let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0; return this.rng / 4294967296; }

  // count the spikes of these neurons; returns the counters (one per neuron, in the same order)
  watch(indices) {
    this.slot.fill(-1);
    this.count = new Uint32Array(indices.length);
    for (let k = 0; k < indices.length; k++) this.slot[indices[k]] = k;
    return this.count;
  }

  enableLog(size = 1 << 20) { this.log = new Int32Array(size); this.logLen = 0; }

  reset() {
    this.I.fill(0); for (let i = 0, I = this.I, n = this.n; i < n; i++) I[4 * i + 2] = -1;
    this.isHot.fill(0);
    this.nHot = 0; this.step = 0; this.dLen = 0; this.dHead.fill(-1); this.dBase = 0;
    for (const q of this.queue) q.len = 0;
    this.count.fill(0); this.logLen = 0;
  }

  _emit(i, s) {
    const q = this.queue[(s + this.delaySteps) % this.queue.length];
    if (q.len === q.ids.length) { const b = new Int32Array(q.ids.length * 2); b.set(q.ids); q.ids = b; }
    q.ids[q.len++] = i;
    this.spikesTotal++;
    const sl = this.slot[i]; if (sl >= 0) this.count[sl]++;
    const log = this.log; if (log !== null && this.logLen < log.length) log[this.logLen++] = i;
  }

  // Sensory input for the next `steps` steps: cell idx[k] fires random (Poisson) spikes at rate[k] Hz,
  // exactly like the drive in brain-engine.js and in the paper. Call it, then run(steps).
  drive(idx, rate, nDrive, steps) {
    if (this.dHead.length < steps) this.dHead = new Int32Array(steps);
    const head = this.dHead; head.fill(-1, 0, steps);
    this.dLen = 0; this.dBase = this.step; this.dSteps = steps;
    const perStep = this.p.dt / 1000;
    for (let k = 0; k < nDrive; k++) {
      const p = rate[k] * perStep;
      if (!(p > 0)) continue;
      // a coin flip per step with chance p is the same as waiting times with this distribution
      const lam = p < 1 ? -Math.log1p(-p) : 50;
      if (!(lam > 1e-12)) continue;                      // less than one spike in a year
      let t = Math.floor(-Math.log(1 - this.rand()) / lam);
      while (t < steps) {
        if (this.dLen === this.dCell.length) {
          const a = new Int32Array(this.dLen * 2); a.set(this.dCell); this.dCell = a;
          const b = new Int32Array(this.dLen * 2); b.set(this.dNext); this.dNext = b;
        }
        this.dCell[this.dLen] = idx[k]; this.dNext[this.dLen] = head[t]; head[t] = this.dLen++;
        t += 1 + Math.floor(-Math.log(1 - this.rand()) / lam);
      }
    }
  }

  // advance the brain by `steps` steps of dt
  run(steps) {
    const { F, I, isHot, hot, rowptr, edges, mask, shift, silenced, EmK, EsK, KK } = this;
    const Em = this.Em, Es = this.Es, K = this.K, vT = this.p.vThresh, w0 = this.p.wSyn, cAbs = this.cAbs, KMAX = this.KMAX;
    const fw = this.weights || null, qn = this.queue.length;
    let events = 0;
    for (let n = 0; n < steps; n++) {
      const s = this.step, sm1 = s - 1;

      // 1. deliver the spikes whose delay has elapsed
      const q = this.queue[s % qn];
      const ids = q.ids;
      for (let k = 0, len = q.len; k < len; k++) {
        const pre = ids[k];
        if (silenced[pre]) continue;
        const a = rowptr[pre], b = rowptr[pre + 1];
        events += b - a;
        for (let e = a; e < b; e++) {
          const x = edges[e];
          const t = (x & mask) << 2;
          const w = (fw !== null ? fw[e] : ((x >>> shift) - 4096)) * w0;
          // bring the target up to date: it has faded since its last update (but not while refractory)
          const kk = s - Math.max(I[t + 2] + 1, I[t + 3]);
          let ut = F[t], gt = F[t + 1];
          if (kk > 0) {
            if (kk > KMAX) { ut = 0; gt = w; }
            else { ut = ut * EmK[kk] + gt * KK[kk]; gt = gt * EsK[kk] + w; }
            F[t] = ut; F[t + 1] = gt; I[t + 2] = sm1;
          } else {
            gt += w; F[t + 1] = gt;
            if (kk === 0) I[t + 2] = sm1;
          }
          // could it now reach threshold without further input? then step it every step.
          // (|g| instead of "g if positive": a slightly wider net, but no hard-to-predict branch)
          if (ut + Math.abs(gt) * cAbs > vT) {
            const i = t >> 2;
            if (isHot[i] === 0) { isHot[i] = 1; hot[this.nHot++] = i; }
          }
        }
      }
      q.len = 0;

      // 2. sensory drive: the cell fires now, whatever its state was
      const off = s - this.dBase;
      if (off < this.dSteps) {
        for (let d = this.dHead[off]; d >= 0; d = this.dNext[d]) {
          const i = this.dCell[d];
          if (silenced[i]) continue;
          const t = i << 2;
          F[t] = 0; F[t + 1] = 0; I[t + 2] = s; I[t + 3] = s;
          this._emit(i, s);
        }
      }

      // 3. step the neurons that are near threshold
      let w = 0;
      for (let k = 0, nH = this.nHot; k < nH; k++) {
        const i = hot[k], t = i << 2;
        if (silenced[i]) { F[t] = 0; F[t + 1] = 0; I[t + 2] = s; isHot[i] = 0; continue; }
        if (s < I[t + 3]) { hot[w++] = i; continue; }
        if (I[t + 2] >= s) { isHot[i] = 0; continue; }        // was just reset by its sensory drive
        const ui = F[t] * Em + F[t + 1] * K, gi = F[t + 1] * Es;
        I[t + 2] = s;
        if (ui > vT) {
          F[t] = 0; F[t + 1] = 0; I[t + 3] = s + this.refSteps; isHot[i] = 0;
          this._emit(i, s);
        } else {
          F[t] = ui; F[t + 1] = gi;
          if (ui + (gi > 0 ? gi * cAbs : 0) > vT) hot[w++] = i; else isHot[i] = 0;
        }
      }
      this.nHot = w;
      this.step = s + 1;
    }
    this.eventsTotal += events;
  }

  get timeMs() { return this.step * this.p.dt; }
}
