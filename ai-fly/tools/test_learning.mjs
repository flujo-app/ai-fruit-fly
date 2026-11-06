// Check that the fly's learning centre responds sparsely to smells and learns from sugar and bitter.
//   node tools/test_learning.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MushroomBody } from '../js/mushroom-body.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'data/mb.bin'));
const meta = JSON.parse(readFileSync(join(root, 'data/mb.json'), 'utf8'));
const mb = new MushroomBody(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), meta);

const smells = ['shape:cone', 'shape:cube', 'colour:brown', 'colour:blue'].map(k => [k, mb.smellFor(k)]);
const show = (label, r) => console.log(`${label.padEnd(30)} KCs ${(100 * r.kcFraction).toFixed(1)}%  approach push ${r.approach.toFixed(1)}  avoid push ${r.avoid.toFixed(1)}  valence ${r.valence.toFixed(2)}`);

const t0 = performance.now();
const before = {};
for (const [k, s] of smells) { const r = mb.sniff(s); before[k] = r; show(`${k} (${s.join(',')})`, r); }
console.log(`4 sniffs took ${(performance.now() - t0).toFixed(0)} ms`);

// repeatability: same smell twice
show('shape:cone again', mb.sniff(smells[0][1]));

// reward the cone, punish the cube
mb.learn(before['shape:cone'].kcs, 'sugar');
mb.learn(before['shape:cube'].kcs, 'bitter');
console.log('\nafter sugar for cone, bitter for cube:');
for (const [k, s] of smells) show(k, mb.sniff(s));

// overlap between smells
const a = new Set(before['shape:cone'].kcs);
const overlap = before['shape:cube'].kcs.filter(i => a.has(i)).length;
console.log(`\nKenyon cells shared by cone and cube smells: ${overlap} of ${a.size}`);
