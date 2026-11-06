// Run the whole-brain model in Node on a few stimuli and print which output neurons respond.
// Used to check the model and to choose the read-outs the 3D fly uses.
//   node tools/experiments.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Brain, parseConnectome } from '../js/brain-engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'data/connectome.bin'));
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const meta = JSON.parse(readFileSync(join(root, 'data/circuits.json'), 'utf8'));
const G = meta.groups;
const brain = new Brain(parseConnectome(buf));

const dns = [...G.descending_L, ...G.descending_R];
const named = ['DNp01_L', 'DNp01_R', 'DNa02_L', 'DNa02_R', 'DNa01_L', 'DNa01_R', 'MDN_L', 'MDN_R', 'MN9_L', 'MN9_R'];
brain.watchNeurons(dns);
for (const k of named) brain.watchNeurons(G[k]);

function trial(label, stim, ms = 1000, rate = 150) {
  brain.reset();
  brain.drive.clear();
  for (const k of stim) brain.setDrive(G[k], rate);
  // count spikes per DN over the trial
  const counts = new Map(dns.map(i => [i, 0]));
  const t0 = performance.now();
  const steps = Math.round(ms / brain.p.dt);
  let total = 0;
  for (let s = 0; s < steps; s += 20) {
    brain.logLen = 0;
    brain.run(20);
    total += brain.logLen;
    for (let k = 0; k < brain.logLen; k++) {
      const i = brain.log[k];
      if (counts.has(i)) counts.set(i, counts.get(i) + 1);
    }
  }
  const wall = performance.now() - t0;
  const hz = i => counts.get(i) * 1000 / ms;
  const nm = Object.fromEntries(named.map(k => [k, +(G[k].reduce((a, i) => a + (counts.has(i) ? hz(i) : 0), 0) / G[k].length).toFixed(1)]));
  const top = [...counts].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([i, c]) => `${meta.cell_types[i] || i}${G.descending_L.includes(i) ? 'L' : 'R'}:${(c * 1000 / ms).toFixed(0)}`);
  console.log(`\n== ${label}: ${total.toLocaleString()} spikes, ${wall.toFixed(0)} ms wall for ${ms} ms brain time (${(ms / wall).toFixed(2)}x real time)`);
  console.log('   named:', JSON.stringify(nm));
  console.log('   top DNs (Hz):', top.join('  '));
  return counts;
}

trial('nothing', []);
trial('sugar (both sides)', ['sugar_L', 'sugar_R']);
trial('sugar + bitter', ['sugar_L', 'sugar_R', 'bitter_L', 'bitter_R']);
const oL = trial('fruit smell, left antenna', ['odor_L'], 1000, 100);
const oR = trial('fruit smell, right antenna', ['odor_R'], 1000, 100);
trial('looming, left eye', ['loom_L']);
trial('looming, right eye', ['loom_R']);
trial('antenna touch, both', ['antenna_touch_L', 'antenna_touch_R']);
trial('water taste', ['water_L', 'water_R']);

// which DNs best tell left smell from right smell?
const asym = dns.map(i => [i, oL.get(i) - oR.get(i)]).filter(([, d]) => d !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 15);
console.log('\nsmell left-minus-right (spikes):', asym.map(([i, d]) => `${meta.cell_types[i] || i}${G.descending_L.includes(i) ? 'L' : 'R'}:${d}`).join('  '));
