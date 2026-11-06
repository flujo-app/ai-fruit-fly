// Train a population headless and report which tests are still failing, plus the best program.
//   node tools/inspect_gym.mjs [flies=512] [generations=200] [key=value overrides...]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseGym, FlyPopulation } from '../js/gym/population.js';
import { judge } from '../js/gym/judge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, `data/${process.env.GYM_DATA || 'gym'}.bin`));
const gym = parseGym(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), JSON.parse(readFileSync(join(root, `data/${process.env.GYM_DATA || 'gym'}.json`), 'utf8')));
const n = Number(process.argv[2] || 512), gens = Number(process.argv[3] || 200);
const opts = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
const pop = new FlyPopulation(gym, n, opts);
for (let g = 0; g < gens; g++) pop.generation();
const failing = {}, avg = {}, reasons = {};
for (let f = 0; f < n; f++) {
  const r = pop.results[f];
  for (const [k, v] of Object.entries(r.part)) {
    avg[k] = (avg[k] || 0) + v / n;
    if (v < 0.99) { failing[k] = (failing[k] || 0) + 1; reasons[`${k}: ${r.why[k]}`] = (reasons[`${k}: ${r.why[k]}`] || 0) + 1; }
  }
}
console.log('flies failing each test:', failing);
console.log('average part score:', Object.fromEntries(Object.entries(avg).map(([k, v]) => [k, +v.toFixed(2)])));
console.log('reasons:', Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8));
let b = 0;
for (let f = 1; f < n; f++) if (pop.score[f] > pop.score[b]) b = f;
const r = judge(pop.shown[b].code);
console.log(`\nbest program (${r.score.toFixed(2)}, ${r.passed}/8):\n${pop.shown[b].code}\n`, r.part);
