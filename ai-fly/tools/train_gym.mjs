// Headless Fly Gym run: many flies learn to type a rotating döner app token by token.
//   node tools/train_gym.mjs [flies=1024] [generations=300] [key=value overrides...]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseGym, FlyPopulation } from '../js/gym/population.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, `data/${process.env.GYM_DATA || 'gym'}.bin`));
const gym = parseGym(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), JSON.parse(readFileSync(join(root, `data/${process.env.GYM_DATA || 'gym'}.json`), 'utf8')));
const n = Number(process.argv[2] || 1024), gens = Number(process.argv[3] || 300);
const opts = Object.fromEntries(process.argv.slice(4).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
const pop = new FlyPopulation(gym, n, opts);
const t0 = performance.now();
let firstSolved = -1;
for (let g = 0; g < gens; g++) {
  const s = pop.generation();
  if (s.solved && firstSolved < 0) firstSolved = s.gen;
  if (g % 10 === 0 || g === gens - 1 || (s.solved && firstSolved === s.gen)) {
    console.log(`gen ${String(s.gen).padStart(4)}  best ${s.best.toFixed(2)} (${s.bestPassed}/8 tests)  mean ${s.mean.toFixed(2)}  flies with 8/8: ${s.solved}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  if (g % 100 === 0 && g > 0) {
    // which tests the flies still fail, and the customer's most common complaints
    const failing = {}, reasons = {};
    for (const r of pop.results) for (const [k, v] of Object.entries(r.part)) if (v < 0.99) { failing[k] = (failing[k] || 0) + 1; const w = `${k}: ${r.why[k]}`; reasons[w] = (reasons[w] || 0) + 1; }
    console.log(`  still failing: ${Object.entries(failing).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`  top complaints: ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} (${v})`).join(' | ')}`);
    if (process.env.SHOW_BEST) { let b = 0; for (let f = 1; f < n; f++) if (pop.score[f] > pop.score[b]) b = f; console.log(pop.shown[b].code.replace(/^/gm, '    | ')); }
  }
  if (s.solved >= n * 0.5) { console.log(`half of the flies pass all tests at gen ${s.gen}`); break; }
}
console.log(`first fly to pass all 8 tests: ${firstSolved >= 0 ? `generation ${firstSolved}` : 'none'}`);
console.log(`best program (gen ${pop.bestEver.gen}, score ${pop.bestEver.score.toFixed(2)}, ${pop.bestEver.passed}/8):\n${pop.bestEver.code}`);
