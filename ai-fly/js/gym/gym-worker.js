// One lab of the Fly Gym: a group of flies that learn together. The page runs one lab per CPU core.
import { parseGym, FlyPopulation } from './population.js';

let pop = null;
const SLOTS = 6, PER = 11;   // up to 6 objects per fly, 11 numbers each
// each fly's first program that passed all 8 tests (its choices), for the sugar-cube reward
const perfect = new Map();

// compact description of each fly's döner shop, for the wall of thumbnails
function summarise() {
  const n = pop.n;
  const out = new Float32Array(n * (2 + SLOTS * PER));
  for (let f = 0; f < n; f++) {
    const r = pop.results[f];
    const o = f * (2 + SLOTS * PER);
    const w = r.world;
    out[o] = r.score;
    out[o + 1] = w && !w.error ? Math.min(3, w.lights.reduce((a, l) => a + l.intensity * l.color.luminance, 0)) : 0;
    if (!w || w.error) continue;
    w.meshes.slice(0, SLOTS).forEach((m, i) => {
      const p = m.geometry.parameters, j = o + 2 + i * PER;
      const type = m.geometry.type === 'BoxGeometry' ? 1 : m.geometry.type === 'CylinderGeometry' ? 2 : 3;
      out[j] = type;
      out[j + 1] = type === 1 ? p.width : type === 2 ? p.radiusTop : p.radius;
      out[j + 2] = type === 1 ? p.height : type === 2 ? p.radiusBottom : p.radius;
      out[j + 3] = type === 1 ? p.depth : type === 2 ? p.height : p.radius;
      out[j + 4] = m.position.x; out[j + 5] = m.position.y; out[j + 6] = m.position.z;
      out[j + 7] = m.material.color.hex;
      out[j + 8] = m.material.emissive.hex;
      const t = w.turn[i];
      out[j + 9] = t ? t.y : 0;
      out[j + 10] = m === r.meat ? 1 : 0;
    });
  }
  return out;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const [meta, buf] = await Promise.all([
        fetch(new URL('../../data/gym.json', import.meta.url)).then((r) => r.json()),
        fetch(new URL('../../data/gym.bin', import.meta.url)).then((r) => r.arrayBuffer()),
      ]);
      pop = new FlyPopulation(parseGym(buf, meta), m.flies, m.opts);
      perfect.clear();
      postMessage({ type: 'ready', id: m.id, lab: m.lab });
    } else if (m.type === 'step') {
      const t0 = performance.now();
      const stat = pop.generation();
      for (const [, dst] of pop.lastCopies || []) perfect.delete(dst);   // that desk got someone else's memory
      for (let f = 0; f < pop.n; f++) if (pop.passed[f] === 8 && !perfect.has(f)) perfect.set(f, pop.shown[f].decisions.slice());
      const best = stat.bestFly;
      const summary = summarise();
      postMessage({
        type: 'stepped', id: m.id, lab: m.lab, stat, ms: performance.now() - t0,
        scores: Float32Array.from(pop.score), passed: Uint8Array.from(pop.passed), summary,
        best: { fly: best, score: pop.score[best], passed: pop.passed[best], tokens: pop.shown[best].tokens, code: pop.shown[best].code, why: pop.results[best].why, part: pop.results[best].part },
        decisions: pop.shown.reduce((a, p) => a + p.decisions.length, 0),
        tokens: pop.shown.reduce((a, p) => a + p.tokens.length, 0),
      }, [summary.buffer]);
    } else if (m.type === 'code') {
      const f = m.fly;
      postMessage({ type: 'code', id: m.id, code: pop.shown[f].code, tokens: pop.shown[f].tokens, score: pop.score[f], passed: pop.passed[f], why: pop.results[f].why, part: pop.results[f].part });
    } else if (m.type === 'codes') {
      // what several flies are typing right now (for the screens near the visitor)
      const list = m.flies.filter((f) => pop.shown && pop.shown[f]).map((f) => ({ fly: f, tokens: pop.shown[f].tokens, score: pop.score[f], passed: pop.passed[f] }));
      postMessage({ type: 'codes', id: m.id, list });
    } else if (m.type === 'reward') {
      // a sugar cube: dopamine for every choice in the fly's (first) perfect program
      const f = m.fly, d = perfect.get(f) || (pop.shown && pop.shown[f] ? pop.shown[f].decisions : []);
      pop.learn(f, d, 'sugar', m.strength);
      postMessage({ type: 'rewarded', id: m.id, choices: d.length });
    } else if (m.type === 'hire') {
      // a new intern at this desk: the memory goes back to the innate wiring
      const K = pop.K, b = m.fly * 2 * K, { a0, v0 } = pop.g;
      for (let k = 0; k < K; k++) { pop.W[b + 2 * k] = a0[k]; pop.W[b + 2 * k + 1] = v0[k]; }
      pop.baseline[m.fly] = 0;
      perfect.delete(m.fly);
      postMessage({ type: 'hired', id: m.id });
    } else if (m.type === 'export') {
      // a fly's memory, so another lab can adopt it
      const L = 2 * pop.K, f = m.fly;
      const mem = pop.W.slice(f * L, (f + 1) * L);
      postMessage({ type: 'memory', id: m.id, mem, baseline: pop.baseline[f] }, [mem.buffer]);
    } else if (m.type === 'import') {
      // replace this lab's weakest fly with the incoming one
      let worst = 0;
      for (let f = 1; f < pop.n; f++) if (pop.baseline[f] < pop.baseline[worst]) worst = f;
      pop.W.set(m.mem, worst * 2 * pop.K);
      pop.baseline[worst] = m.baseline;
      perfect.delete(worst);
      postMessage({ type: 'imported', id: m.id, fly: worst });
    } else if (m.type === 'exportAll') {
      // the whole lab's memories, for saving a training run
      const W = pop.W.slice(), baseline = pop.baseline.slice();
      postMessage({ type: 'all', id: m.id, W, baseline, gen: pop.gen }, [W.buffer, baseline.buffer]);
    } else if (m.type === 'importAll') {
      pop.W.set(m.W);
      pop.baseline.set(m.baseline);
      pop.gen = m.gen;
      postMessage({ type: 'imported', id: m.id });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
  }
};
