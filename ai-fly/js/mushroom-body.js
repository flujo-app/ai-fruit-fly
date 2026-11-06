// The fly's learning centre (mushroom body), cut from the real FlyWire wiring, with a simple
// dopamine learning rule. Used by the kebab coding studio: each code block gets its own "smell";
// the fly smells the options, prefers the ones its learning centre says are good, and learns from
// sugar (test passed) and bitter (test failed).
import { Brain, parseConnectome } from './brain-engine.js';

export const SMELL_MS = 300;        // how long the fly sniffs each option
export const SMELL_RATE = 120;      // firing rate of the projection neurons for an active glomerulus (Hz)
export const GLOMERULI_PER_SMELL = 9;
export const LEARN_FACTOR = 0.35;   // a dopamine burst weakens Kenyon cell -> MBON connections to 35%

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MushroomBody {
  constructor(buf, meta, params = {}) {
    this.meta = meta;
    this.brain = new Brain(parseConnectome(buf), params);
    this.brain.enableLearning();
    this.glomNames = Object.keys(meta.glomeruli).sort();
    this.kcSet = new Set(meta.kc);
    this.avoid = meta.mbon.filter(m => m.kind === 'avoid').map(m => m.local);
    this.approach = meta.mbon.filter(m => m.kind === 'approach').map(m => m.local);
    this.avoidSet = new Set(this.avoid);
    this.approachSet = new Set(this.approach);
    this.mbonSet = new Set([...this.avoid, ...this.approach]);
    this.gain = params.pnGain || 1;
  }

  // a made-up but fixed smell for a code block: a handful of glomeruli
  smellFor(key) {
    let h = 2166136261;
    for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = mulberry32(h);
    const pool = this.glomNames.slice();
    const out = [];
    while (out.length < GLOMERULI_PER_SMELL) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  }

  // let the fly sniff a smell; returns which Kenyon cells fired and how the output neurons responded
  sniff(glomeruli, ms = SMELL_MS) {
    const b = this.brain;
    b.reset();
    b.drive.clear();
    for (const g of glomeruli) b.setDrive(this.meta.glomeruli[g], SMELL_RATE);
    const counts = new Map();
    const spikes = [];
    const steps = Math.round(ms / b.p.dt);
    for (let s = 0; s < steps; s += 20) {
      b.logLen = 0;
      b.run(Math.min(20, steps - s));
      for (let k = 0; k < b.logLen; k++) {
        const i = b.log[k];
        counts.set(i, (counts.get(i) || 0) + 1);
        spikes.push(i);
      }
    }
    b.drive.clear();
    // How hard the active Kenyon cells push the two kinds of output neuron: spikes x connection
    // strength. (In this simple model the outputs also receive strong inhibition and rarely fire,
    // so we read their excitatory input, which is exactly what learning changes.)
    const kcs = [];
    let avoid = 0, approach = 0;
    const { rowptr, edges, mask, weights } = b;
    for (const [i, c] of counts) {
      if (!this.kcSet.has(i)) continue;
      kcs.push(i);
      for (let e = rowptr[i]; e < rowptr[i + 1]; e++) {
        const t = edges[e] & mask;
        if (this.avoidSet.has(t)) avoid += c * weights[e];
        else if (this.approachSet.has(t)) approach += c * weights[e];
      }
    }
    avoid /= this.avoid.length;
    approach /= this.approach.length;
    const valence = (approach - avoid) / Math.max(1e-6, approach + avoid);   // -1 (avoid) .. +1 (approach)
    return { kcs, avoid, approach, valence, spikes, kcFraction: kcs.length / this.kcSet.size };
  }

  // dopamine: sugar weakens the active Kenyon cells' drive onto "avoid" outputs (PAM zones),
  // bitter weakens their drive onto "approach" outputs (PPL1 zones)
  learn(kcs, kind, factor = LEARN_FACTOR) {
    return this.brain.scaleConnections(kcs, kind === 'sugar' ? this.avoidSet : this.approachSet, factor);
  }

  forget() { this.brain.resetLearning(); }
}
