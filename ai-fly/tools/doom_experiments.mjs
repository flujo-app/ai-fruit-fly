// What does the complete brain do with simple pictures on the fly's screen?
//   node tools/doom_experiments.mjs
// The pictures go through the same eyes as Doom does (js/doom/eye.js) into all 138,639 neurons.
// Prints the cells that biologists know well (do they behave like in a real fly?), the output cells
// the game controller reads, and how much of the learning centre the screen reaches.
import { loadRig, loadWiring, makeFly } from '../js/doom/load.js';
import { FRAME_W as W, FRAME_H as H } from '../js/doom/game.js';

const rig = await loadRig();
const { brain, eye } = makeFly(rig, await loadWiring(false), false);
eye.setPalette(Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)));      // palette entry i = grey level i
const G = rig.groups;
const names = ['HSN_L', 'HSN_R', 'HSE_L', 'HSE_R', 'HSS_L', 'HSS_R', 'H2_L', 'H2_R', 'LC4_L', 'LC4_R', 'LPLC2_L', 'LPLC2_R', 'LC11_L', 'LC11_R',
  'DNp01_L', 'DNp01_R', 'DNp02_L', 'DNp02_R', 'DNp04_L', 'DNp04_R', 'DNa01_L', 'DNa01_R', 'DNa02_L', 'DNa02_R', 'DNg100_L', 'DNg100_R', 'DNg97_L', 'DNg97_R', 'MDN_L', 'MDN_R', 'MN9_L', 'MN9_R',
  'KC', 'PAM', 'PPL1', 'eyeToKC'];
const span = {}; const idx = [];
for (const nm of names) { span[nm] = [idx.length, G[nm].length]; idx.push(...G[nm]); }
const count = brain.watch(Int32Array.from(idx));

// draw(frame, t): t in seconds. extra: [[group, Hz]] cells driven directly (taste, or forcing the eye-to-learning-centre cells).
// blue: strength of the blue-light signal for the learning centre (0 = off, as in the standard game).
// noKC: all Kenyon cells switched off, to see what the learning centre itself adds.
function run(label, draw, { seconds = 0.5, extra = [], screen = 120, blue = 0, maxBlue = 150, noKC = false } = {}) {
  brain.reset(); brain.seed(11); brain.spikesTotal = 0; count.fill(0);
  brain.silenced.fill(0); if (noKC) for (const i of G.KC) brain.silenced[i] = 1;
  eye.o.gBlue = blue; eye.o.maxBlue = maxBlue;
  eye.setScreen(screen, W, H);
  const frame = new Uint8Array(W * H).fill(128);
  const tics = Math.round(seconds * 35);
  const xi = extra.flatMap(([g]) => G[g]), xr = extra.flatMap(([g, hz]) => G[g].map(() => hz));
  const di = new Int32Array(eye.N + xi.length), dr = new Float32Array(eye.N + xi.length);
  di.set(eye.cellIdx); di.set(xi, eye.N);
  for (let k = 0; k < 8; k++) eye.see(frame);              // let the eye get used to the grey screen first
  for (let tic = 0; tic < tics; tic++) {
    if (draw) { frame.fill(128); draw(frame, tic / 35); }
    dr.set(eye.see(frame)); dr.set(xr, eye.N);
    const steps = tic % 7 === 6 ? 58 : 57;
    brain.drive(di, dr, di.length, steps); brain.run(steps);
  }
  const hz = (nm) => { const [o, n] = span[nm]; let s = 0; for (let k = 0; k < n; k++) s += count[o + k]; return s / n / seconds; };
  const firing = (nm) => { const [o, n] = span[nm]; let c = 0; for (let k = 0; k < n; k++) if (count[o + k]) c++; return c; };
  const pair = (nm) => `${nm} ${hz(nm + '_L').toFixed(0)}|${hz(nm + '_R').toFixed(0)}`;
  console.log(`\n== ${label}: ${brain.spikesTotal.toLocaleString('en')} impulses in ${seconds} s`);
  console.log('   eye (left|right, impulses/s): ' + ['HSN', 'HSE', 'HSS', 'H2', 'LC4', 'LPLC2', 'LC11'].map(pair).join('  '));
  console.log('   controller cells:             ' + ['DNa01', 'DNa02', 'DNg100', 'DNg97', 'MDN', 'DNp01', 'DNp02', 'DNp04', 'MN9'].map(pair).join('  '));
  console.log(`   learning centre: ${firing('KC')} of ${G.KC.length} Kenyon cells fired; eye cells that project to them ${hz('eyeToKC').toFixed(1)}/s; dopamine cells: reward (PAM) ${hz('PAM').toFixed(1)}/s, punishment (PPL1) ${hz('PPL1').toFixed(1)}/s`);
  const out = Object.fromEntries(names.map((nm) => [nm, hz(nm)]));     // a snapshot: the counters are reused by the next run
  out.kcSet = new Set(G.KC.filter((_, k) => count[span.KC[0] + k] > 0));
  return out;
}
const px = (f, x, y, v) => { if (x >= 0 && x < W && y >= 0 && y < H) f[y * W + x] = v; };
const grating = (dir) => (f, t) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 128 + 100 * Math.sin(2 * Math.PI * (x - dir * 60 * t) / 24); };
const disc = (cx, r0, r1, T = 0.4) => (f, t) => { const r = r0 + (r1 - r0) * Math.min(1, t / T); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - H / 2) ** 2 < r * r) px(f, x, y, 15); };
const spot = (x0, v) => (f, t) => { const cx = Math.round(x0 + v * t); for (let y = H / 2 - 3; y < H / 2 + 3; y++) for (let x = cx - 3; x < cx + 3; x++) px(f, x, y, 15); };

console.log('The complete brain in front of simple pictures. A real fly\'s HS cells fire for front-to-back motion on their own side, its H2 cell for back-to-front.');
run('grey screen, nothing happens', null);
const r = run('the world turns to the right', grating(1));
run('the world turns to the left', grating(-1));
run('a dark disc grows quickly, straight ahead', disc(W / 2, 2, 26));
run('a dark disc grows quickly, on the left', disc(W * 0.27, 2, 22));
run('a dark disc grows quickly, on the right', disc(W * 0.73, 2, 22));
run('a dark disc shrinks, on the left', disc(W * 0.27, 22, 2));
run('a small dark spot moves to the left, on the left half', spot(W * 0.45, -60));
console.log('\nThe learning centre: can anything reach it?');
run('sugar on the tongue (the 20 sugar cells of the paper, 150/s)', null, { extra: [['sugar', 150]], seconds: 1 });
run('bitter on the tongue', null, { extra: [['bitter', 150]], seconds: 1 });
run('best case: every eye cell that projects to Kenyon cells is forced to fire 200 times a second', null, { extra: [['eyeToKC', 200]] });

console.log('\nThe learning centre with the blue-light signal switched on (the aMe12 cells get the blue light of their own facets):');
const level = (v) => (f) => f.fill(v), halves = (l, rr) => (f) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = x < W / 2 ? l : rr; };
const B = 300;
run('a dark screen', level(25), { blue: B, seconds: 1 });
const bright = run('a bright screen', level(235), { blue: B, seconds: 1 });
const left = run('left half bright, right half dark', halves(235, 25), { blue: B, seconds: 1 });
const right = run('right half bright, left half dark', halves(25, 235), { blue: B, seconds: 1 });
const off = run('a bright screen, all Kenyon cells switched off', level(235), { blue: B, seconds: 1, noKC: true });
run('a bright screen, signal twice as strong and without its upper limit', level(235), { blue: 2 * B, seconds: 0.5, maxBlue: 1e9 });
let both = 0; for (const i of left.kcSet) if (right.kcSet.has(i)) both++;
console.log(`\nKenyon cells: bright screen ${bright.kcSet.size}, left half bright ${left.kcSet.size}, right half bright ${right.kcSet.size}, in both of the last two ${both}`);
const say = (o) => ['DNa01', 'DNa02', 'DNg100', 'DNg97'].map((d) => `${d} ${o[d + '_L'].toFixed(0)}|${o[d + '_R'].toFixed(0)}`).join('  ');
console.log(`steering and walking cells with the bright screen: ${say(bright)}`);
console.log(`                 the same, Kenyon cells switched off: ${say(off)}`);
const ok = r.HSE_R > 50 && r.HSE_L < 5 && r.H2_L > 50 && r.H2_R < 5;
console.log(`\n${ok ? 'ok  ' : 'FAIL'} world turning right: right HS cell ${r.HSE_R.toFixed(0)}/s, left HS cell ${r.HSE_L.toFixed(0)}/s; left H2 cell ${r.H2_L.toFixed(0)}/s, right H2 cell ${r.H2_R.toFixed(0)}/s (as in a real fly)`);
process.exit(ok ? 0 : 1);
