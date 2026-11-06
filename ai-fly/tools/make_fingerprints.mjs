// Precompute, with the real spiking learning-centre model, which Kenyon cells fire for every smell the
// Fly Gym can produce. A smell = where the fly is in the code (line + kind of blank) + the token it
// considers. Runs on all CPU cores.  Output: data/gym.bin + data/gym.json
//   node tools/make_fingerprints.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { MushroomBody } from '../js/mushroom-body.js';
import { allCombos } from '../js/gym/grammar.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = () => {
  const raw = readFileSync(join(root, 'data/mb.bin'));
  const meta = JSON.parse(readFileSync(join(root, 'data/mb.json'), 'utf8'));
  return new MushroomBody(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), meta);
};

function hashPick(str, n, pool) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [];
  const p = pool.slice();
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out.push(p.splice(h % p.length, 1)[0]);
  }
  return out;
}
// 2 glomeruli for where the fly is (line or object), 2 for the kind of blank, 5 for the token. For
// decisions about an object, the blank and the token are smelled together with the object, so
// "height 2" smells different for the döner and for the bread (otherwise learning "the döner must be
// tall" also makes the bread tall).
export function smellOf(key, glomNames) {
  const [where, state, token] = key.split('|');
  const tag = where.startsWith('L') ? '' : `${where}:`;
  return [...new Set([...hashPick(`ctx:${where}`, 2, glomNames), ...hashPick(`state:${tag}${state}`, 2, glomNames), ...hashPick(`token:${tag}${token}`, 5, glomNames)])];
}

if (isMainThread) {
  const combos = allCombos();
  const mb = load();
  const kcIndex = new Map(mb.meta.kc.map((l, i) => [l, i]));
  const t0 = performance.now();
  const n = Math.min(cpus().length, 8);
  const chunks = Array.from({ length: n }, (_, w) => combos.filter((_, i) => i % n === w));
  const results = new Map();
  await Promise.all(chunks.map((keys) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { keys } });
    w.on('message', (m) => { for (const [k, kcs, counts] of m) results.set(k, [kcs, counts]); resolve(); });
    w.on('error', reject);
  })));
  // per Kenyon cell: its total push onto "approach" and "avoid" outputs (the innate wiring)
  const nKC = mb.meta.kc.length;
  const a0 = new Float32Array(nKC), v0 = new Float32Array(nKC);
  const { rowptr, edges, mask, weights } = mb.brain;
  mb.meta.kc.forEach((kc, i) => {
    for (let e = rowptr[kc]; e < rowptr[kc + 1]; e++) {
      const t = edges[e] & mask;
      if (mb.approachSet.has(t)) a0[i] += weights[e] / mb.approach.length;
      else if (mb.avoidSet.has(t)) v0[i] += weights[e] / mb.avoid.length;
    }
  });
  let total = 0;
  for (const k of combos) total += results.get(k)[0].length;
  const offsets = new Uint32Array(combos.length + 1);
  const idx = new Uint16Array(total), cnt = new Uint8Array(total);
  let o = 0;
  combos.forEach((k, i) => {
    offsets[i] = o;
    const [kcs, counts] = results.get(k);
    kcs.forEach((l, j) => { idx[o] = kcIndex.get(l); cnt[o] = Math.min(255, counts[j]); o++; });
  });
  offsets[combos.length] = o;
  const header = new Uint32Array([0x314d5947, combos.length, nKC, total]);   // 'GYM1'
  const parts = [header, offsets, a0, v0, idx, cnt];
  const size = parts.reduce((a, p) => a + p.byteLength, 0);
  const buf = Buffer.alloc(size + 8);
  let p = 0;
  for (const part of parts) { Buffer.from(part.buffer, part.byteOffset, part.byteLength).copy(buf, p); p += part.byteLength; p = (p + 3) & ~3; }
  writeFileSync(join(root, `data/${process.env.GYM_DATA || 'gym'}.bin`), buf.subarray(0, p));
  writeFileSync(join(root, `data/${process.env.GYM_DATA || 'gym'}.json`), JSON.stringify({ version: 1, keys: combos, kcs: nKC }));
  const avg = total / combos.length;
  console.log(`${combos.length} smells, ${avg.toFixed(0)} Kenyon cells each on average (${(100 * avg / nKC).toFixed(1)}%), ${((performance.now() - t0) / 1000).toFixed(1)} s on ${n} cores, ${(p / 1024).toFixed(0)} KB`);
} else {
  const mb = load();
  const out = [];
  for (const key of workerData.keys) {
    const r = mb.sniff(smellOf(key, mb.glomNames));
    const counts = new Map();
    for (const s of r.spikes) if (mb.kcSet.has(s)) counts.set(s, (counts.get(s) || 0) + 1);
    out.push([key, r.kcs, r.kcs.map((k) => counts.get(k))]);
  }
  parentPort.postMessage(out);
}
