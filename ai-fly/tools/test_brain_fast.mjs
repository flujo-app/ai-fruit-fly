// Checks that js/brain-fast.js computes the same brain as the plain step-by-step method, and how
// much faster it is.   node tools/test_brain_fast.mjs
//
// 1. Exactness, on the learning centre's 5,554 neurons: the same random sensory spikes go into
//    FastBrain and into a deliberately simple reference that updates every neuron at every step.
//    Every neuron must fire the same number of spikes.
// 2. Whole brain (138,639 neurons): sugar taste and looming, compared with js/brain-engine.js
//    (that engine drops charges below a thousandth of a millivolt and draws its own random spikes,
//    so here only the firing rates can be compared), and the speed of both.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Brain, parseConnectome } from '../js/brain-engine.js';
import { FastBrain } from '../js/brain-fast.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => { const raw = readFileSync(join(root, f)); return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); };
let failed = 0;
const check = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failed++; };

// ---------- 1. exactness ----------
{
  const conn = parseConnectome(load('data/mb.bin'));
  const meta = JSON.parse(readFileSync(join(root, 'data/mb.json'), 'utf8'));
  const fast = new FastBrain(conn);
  const { n, rowptr, edges } = conn;
  const p = fast.p, mask = fast.mask, shift = fast.shift;
  const all = Int32Array.from({ length: n }, (_, i) => i);
  const fastCount = fast.watch(all);
  // the smell input: a third of the projection neurons at 120 Hz
  const pns = Object.values(meta.glomeruli).flat().filter((_, i) => i % 3 === 0);
  const idx = Int32Array.from(pns), rate = new Float32Array(pns.length).fill(120);

  // reference: every neuron, every step, nothing skipped
  const u = new Float64Array(n), g = new Float64Array(n), refUntil = new Int32Array(n), refCount = new Uint32Array(n);
  const delay = fast.delaySteps, ring = Array.from({ length: delay + 1 }, () => []);
  const Em = Math.fround(fast.Em), Es = Math.fround(fast.Es), K = Math.fround(fast.K);
  const STEPS = 57, TICS = 14;
  let s = 0, refSpikes = 0;
  for (let tic = 0; tic < TICS; tic++) {
    fast.drive(idx, rate, idx.length, STEPS);
    const sched = Array.from({ length: STEPS }, () => []);
    for (let o = 0; o < STEPS; o++) for (let d = fast.dHead[o]; d >= 0; d = fast.dNext[d]) sched[o].push(fast.dCell[d]);
    fast.run(STEPS);
    for (let o = 0; o < STEPS; o++, s++) {
      const q = ring[s % ring.length];
      for (const pre of q) for (let e = rowptr[pre]; e < rowptr[pre + 1]; e++) g[edges[e] & mask] = Math.fround(g[edges[e] & mask] + ((edges[e] >>> shift) - 4096) * p.wSyn);
      q.length = 0;
      const emit = (i) => { ring[(s + delay) % ring.length].push(i); refCount[i]++; refSpikes++; };
      for (const i of sched[o]) { u[i] = 0; g[i] = 0; refUntil[i] = s; emit(i); }
      for (let i = 0; i < n; i++) {
        if (s < refUntil[i]) continue;
        const ui = Math.fround(Math.fround(u[i] * Em) + Math.fround(g[i] * K)), gi = Math.fround(g[i] * Es);
        if (ui > p.vThresh) { u[i] = 0; g[i] = 0; refUntil[i] = s + fast.refSteps; emit(i); } else { u[i] = ui; g[i] = gi; }
      }
    }
  }
  let differ = 0, fastSpikes = 0;
  for (let i = 0; i < n; i++) { fastSpikes += fastCount[i]; if (fastCount[i] !== refCount[i]) differ++; }
  console.log(`learning centre, ${TICS * STEPS * p.dt} ms: reference ${refSpikes} spikes, FastBrain ${fastSpikes} spikes, neurons with a different count: ${differ} of ${n}`);
  check(refSpikes > 2000, 'the test network is active');
  check(differ <= n * 0.002 && Math.abs(fastSpikes - refSpikes) <= refSpikes * 0.002, 'FastBrain fires the same spikes as the step-by-step reference (0.2% slack for rounding)');
}

// ---------- 2. whole brain ----------
{
  const conn = parseConnectome(load('data/connectome.bin'));
  const G = JSON.parse(readFileSync(join(root, 'data/circuits.json'), 'utf8')).groups;
  const slow = new Brain(conn), fast = new FastBrain(conn);
  const outs = { MN9: G.MN9, DNp01: G.DNp01, steer_L: G.steer_L, steer_R: G.steer_R, groom: G.groom };
  const flat = Object.values(outs).flat();
  const cnt = fast.watch(Int32Array.from(flat));
  const trial = (label, stim, hz, ms = 1000) => {
    const cells = stim.flatMap((k) => G[k]);
    // old engine
    slow.reset(); slow.drive.clear(); slow.setDrive(cells, hz);
    const c0 = new Map(flat.map((i) => [i, 0]));
    let t0 = performance.now(), spikes0 = 0;
    for (let s = 0; s < ms / slow.p.dt; s += 20) { slow.logLen = 0; slow.run(20); spikes0 += slow.logLen; for (let k = 0; k < slow.logLen; k++) { const i = slow.log[k]; if (c0.has(i)) c0.set(i, c0.get(i) + 1); } }
    const wall0 = performance.now() - t0;
    // new engine
    fast.reset(); fast.seed(7); fast.spikesTotal = 0;
    const idx = Int32Array.from(cells), rate = new Float32Array(cells.length).fill(hz);
    t0 = performance.now();
    for (let s = 0; s < ms / fast.p.dt; s += 40) { fast.drive(idx, rate, idx.length, 40); fast.run(40); }
    const wall1 = performance.now() - t0;
    const rows = []; let k = 0, worst = 0;
    for (const [name, list] of Object.entries(outs)) {
      let a = 0, b = 0; for (const i of list) { a += c0.get(i); b += cnt[k++]; }
      a = a / list.length * 1000 / ms; b = b / list.length * 1000 / ms;
      rows.push(`${name} ${a.toFixed(0)}|${b.toFixed(0)}`);
      worst = Math.max(worst, Math.abs(a - b) - 0.15 * Math.max(a, b));
    }
    console.log(`${label}: spikes ${spikes0} | ${fast.spikesTotal}; output cells old|new Hz: ${rows.join('  ')}; speed ${(ms / wall0).toFixed(2)}x -> ${(ms / wall1).toFixed(2)}x real time`);
    check(worst < 5 && Math.abs(spikes0 - fast.spikesTotal) < 0.1 * spikes0 + 50, `${label}: both engines agree`);
    return wall0 / wall1;
  };
  trial('sugar taste (the 20 sugar cells of the paper)', ['sugar'], 150);
  trial('sugar + bitter', ['sugar', 'bitter'], 150);
  trial('looming, left eye', ['loom_L'], 150);
  trial('antenna touch', ['antenna_touch_L', 'antenna_touch_R'], 150);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
