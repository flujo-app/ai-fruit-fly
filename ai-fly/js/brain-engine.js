// Whole-brain spiking model of the adult fruit fly, after Shiu et al. 2024 (Nature),
// "A Drosophila computational brain model reveals sensorimotor processing".
// Every one of the 138,639 FlyWire v783 neurons is a leaky integrate-and-fire cell and every
// one of the 15,091,983 neuron-to-neuron connections is used, weighted by its synapse count and
// signed by its predicted transmitter. Parameters are the paper's defaults.
//
// Runs in a Web Worker in the browser and in Node for testing. Only neurons that are currently
// doing something are updated, so cost follows activity rather than brain size.

export const PARAMS = {
  dt: 0.5,          // ms per step (paper: 0.1 ms; the neuron equations are integrated exactly)
  tauM: 20,         // ms membrane time constant
  tauS: 5,          // ms synaptic time constant
  vThresh: 7,       // mV above rest (-45 mV threshold, -52 mV rest)
  refractory: 2.2,  // ms
  delay: 1.8,       // ms synaptic delay
  wSyn: 0.275,      // mV per synapse
};

export function parseConnectome(buf) {
  const head = new DataView(buf, 0, 16);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== 'FLY1') throw new Error('not a connectome file');
  const n = head.getUint32(4, true);
  const e = head.getUint32(8, true);
  const targetBits = head.getUint32(12, true);
  const rowptr = new Uint32Array(buf, 16, n + 1);
  const edges = new Uint32Array(buf, 16 + 4 * (n + 1), e);
  return { n, e, targetBits, rowptr, edges };
}

export class Brain {
  constructor(conn, params = {}) {
    this.p = { ...PARAMS, ...params };
    const { n, rowptr, edges, targetBits } = conn;
    this.n = n;
    this.rowptr = rowptr;
    this.edges = edges;
    this.mask = (1 << targetBits) - 1;
    this.shift = targetBits;

    const { dt, tauM, tauS } = this.p;
    this.Em = Math.exp(-dt / tauM);
    this.Es = Math.exp(-dt / tauS);
    this.K = (tauS / (tauS - tauM)) * (this.Es - this.Em);
    this.refSteps = Math.max(1, Math.round(this.p.refractory / dt));
    this.delaySteps = Math.max(1, Math.round(this.p.delay / dt));

    this.u = new Float32Array(n);         // membrane potential above rest (mV)
    this.g = new Float32Array(n);         // synaptic input (mV)
    this.refUntil = new Int32Array(n);    // step index until which the cell is refractory
    this.isActive = new Uint8Array(n);
    this.active = new Int32Array(n);
    this.nActive = 0;
    this.silenced = new Uint8Array(n);

    // spikes waiting for the synaptic delay: ring of lists
    this.queue = Array.from({ length: this.delaySteps + 1 }, () => ({ ids: new Int32Array(1024), len: 0 }));
    this.step = 0;

    // stimulated neurons: index -> rate (Hz)
    this.drive = new Map();

    // spike log for display (cleared by the caller)
    this.log = new Int32Array(1 << 20);
    this.logLen = 0;
    this.spikesTotal = 0;

    // smoothed firing rates of watched neurons
    this.watch = new Map(); // index -> rate in Hz
    this.rateDecay = Math.exp(-dt / 150);
    this.rateKick = 1000 / 150;
  }

  // switch to editable float weights (signed synapse counts) so connections can learn
  enableLearning() {
    if (this.weights) return;
    const { edges, shift } = this;
    this.weights = new Float32Array(edges.length);
    for (let e = 0; e < edges.length; e++) this.weights[e] = (edges[e] >>> shift) - 4096;
    this.baseWeights = this.weights.slice();
  }

  resetLearning() { if (this.weights) this.weights.set(this.baseWeights); }

  // scale every connection from any of `fromSet` (Set of pre indices) onto any of `toSet` by `factor`
  scaleConnections(fromList, toSet, factor) {
    const { rowptr, edges, mask, weights } = this;
    let changed = 0;
    for (const pre of fromList) {
      for (let e = rowptr[pre]; e < rowptr[pre + 1]; e++) {
        if (toSet.has(edges[e] & mask)) { weights[e] *= factor; changed++; }
      }
    }
    return changed;
  }

  setDrive(indices, rateHz) {
    for (const i of indices) {
      if (rateHz > 0) this.drive.set(i, rateHz);
      else this.drive.delete(i);
    }
  }

  watchNeurons(indices) {
    for (const i of indices) if (!this.watch.has(i)) this.watch.set(i, 0);
  }

  rate(indices) {
    let s = 0;
    for (const i of indices) s += this.watch.get(i) || 0;
    return indices.length ? s / indices.length : 0;
  }

  reset() {
    this.u.fill(0); this.g.fill(0); this.refUntil.fill(0); this.isActive.fill(0);
    this.nActive = 0; this.step = 0;
    for (const q of this.queue) q.len = 0;
    for (const k of this.watch.keys()) this.watch.set(k, 0);
  }

  _activate(i) {
    if (!this.isActive[i]) { this.isActive[i] = 1; this.active[this.nActive++] = i; }
  }

  _emit(i) {
    const q = this.queue[(this.step + this.delaySteps) % this.queue.length];
    if (q.len === q.ids.length) { const b = new Int32Array(q.ids.length * 2); b.set(q.ids); q.ids = b; }
    q.ids[q.len++] = i;
    if (this.logLen < this.log.length) this.log[this.logLen++] = i;
    this.spikesTotal++;
    if (this.watch.has(i)) this.watch.set(i, this.watch.get(i) + this.rateKick);
  }

  // advance the brain by `steps` steps of dt
  run(steps) {
    const { u, g, refUntil, isActive, active, rowptr, edges, mask, shift, silenced } = this;
    const Em = this.Em, Es = this.Es, K = this.K, vT = this.p.vThresh, w0 = this.p.wSyn;
    const pScale = this.p.dt / 1000;
    for (let s = 0; s < steps; s++) {
      const step = this.step;

      // 1. deliver spikes whose delay has elapsed
      const q = this.queue[step % this.queue.length];
      const fw = this.weights;   // optional editable weights (used for learning)
      for (let k = 0; k < q.len; k++) {
        const pre = q.ids[k];
        if (silenced[pre]) continue;
        const a = rowptr[pre], b = rowptr[pre + 1];
        for (let e = a; e < b; e++) {
          const x = edges[e];
          const t = x & mask;
          g[t] += (fw ? fw[e] : ((x >>> shift) - 4096)) * w0;
          if (!isActive[t]) { isActive[t] = 1; active[this.nActive++] = t; }
        }
      }
      q.len = 0;

      // 2. external (sensory) drive: Poisson spikes, as in the paper
      for (const [i, r] of this.drive) {
        if (!silenced[i] && Math.random() < r * pScale) {
          u[i] = 0; g[i] = 0; refUntil[i] = step;
          this._emit(i);
        }
      }

      // 3. integrate active neurons exactly over dt, fire, and retire quiet ones
      let w = 0;
      const nA = this.nActive;
      for (let k = 0; k < nA; k++) {
        const i = active[k];
        if (silenced[i]) { u[i] = 0; g[i] = 0; isActive[i] = 0; continue; }   // a silenced cell never fires
        if (step < refUntil[i]) { active[w++] = i; continue; }
        const ui = u[i] * Em + g[i] * K;
        const gi = g[i] * Es;
        if (ui > vT) {
          u[i] = 0; g[i] = 0; refUntil[i] = step + this.refSteps;
          this._emit(i);
          active[w++] = i;
        } else if (ui < 1e-3 && ui > -1e-3 && gi < 1e-3 && gi > -1e-3) {
          u[i] = 0; g[i] = 0; isActive[i] = 0;
        } else {
          u[i] = ui; g[i] = gi; active[w++] = i;
        }
      }
      // neurons activated during delivery this step were appended after nA; keep them
      for (let k = nA; k < this.nActive; k++) active[w++] = active[k];
      this.nActive = w;

      // 4. smoothed rates of watched neurons
      const d = this.rateDecay;
      for (const [i, r] of this.watch) this.watch.set(i, r * d);

      this.step++;
    }
  }

  get timeMs() { return this.step * this.p.dt; }
}
