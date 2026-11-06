// Simulate the kebab-coding rounds in Node (the first block of every slot is the one that passes its
// test) and report how many rounds the fly's learning centre needs to pass all tests.
//   node tools/test_doener_learning.mjs [runs] [temperature]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MushroomBody } from '../js/mushroom-body.js';
import { SLOTS } from '../js/doener/blocks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'data/mb.bin'));
const meta = JSON.parse(readFileSync(join(root, 'data/mb.json'), 'utf8'));
const runs = Number(process.argv[2] || 5), T = Number(process.argv[3] || 0.05);
const softmax = (v) => { const m = Math.max(...v); const e = v.map((x) => Math.exp((x - m) / T)); const s = e.reduce((a, b) => a + b); return e.map((x) => x / s); };

const results = [];
for (let run = 0; run < runs; run++) {
  const mb = new MushroomBody(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), meta);
  const trace = [];
  let solved = 0;
  for (let round = 1; round <= 30 && !solved; round++) {
    let passed = 0;
    for (const slot of SLOTS) {
      const sn = slot.options.map((o) => mb.sniff(mb.smellFor(`${slot.id}:${o.id}`)));
      const p = softmax(sn.map((r) => r.valence));
      let x = Math.random(), k = 0;
      while (k < p.length - 1 && (x -= p[k]) > 0) k++;
      const ok = k === 0;
      passed += ok;
      mb.learn(sn[k].kcs, ok ? 'sugar' : 'bitter');
    }
    trace.push(passed);
    if (passed === SLOTS.length) solved = round;
  }
  results.push(solved || Infinity);
  console.log(`run ${run + 1}: tests passed per round ${trace.join(' ')} -> ${solved ? `solved in round ${solved}` : 'not solved in 30 rounds'}`);
}
const ok = results.filter(Number.isFinite);
console.log(`temperature ${T}: solved ${ok.length}/${runs}, median round ${ok.sort((a, b) => a - b)[Math.floor(ok.length / 2)]}`);
