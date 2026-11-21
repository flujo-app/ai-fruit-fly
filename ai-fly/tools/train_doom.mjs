// The Doom gym without a page: desks play rounds, the setups are passed on, and the numbers are printed.
//   node tools/train_doom.mjs [flies=64] [rounds=10] [threads=6] [seconds=20] [seed=1] [fast]
// Uses the same game, brain and round rules as the pages (js/doom/). Each thread has one complete brain.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const num = (k, d) => { const a = args.find((x) => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };

if (!isMainThread) {
  const { loadDoomFromUrls } = await import('../js/doom/engine.js');
  const { loadRig, loadWiring, makeFly } = await import('../js/doom/load.js');
  const { Game, ARENA } = await import('../js/doom/game.js');
  const { fast, seconds } = workerData;
  const [doom, rig, wiring] = await Promise.all([loadDoomFromUrls(), loadRig(), loadWiring(fast)]);
  const { brain, eye, remap } = makeFly(rig, wiring, fast);
  const game = new Game({ doom, brain, eye, rig, remap, task: { ...ARENA, seconds } });
  parentPort.on('message', (m) => {
    const t0 = performance.now();
    game.start(m.setup, m.seed, m.desk);
    while (game.step());
    const r = game.result();
    parentPort.postMessage({ desk: m.desk, score: r.score, kills: r.kills, perfect: r.perfect, dead: r.dead, tics: r.tics, shots: r.shots, hits: r.hits, ms: performance.now() - t0 });
  });
  parentPort.postMessage({ ready: true });
} else {
  const { defaultSetup, randomSetup, rng, describeSetup } = await import('../js/doom/setup.js');
  const { evolve } = await import('../js/doom/evolve.js');
  const fast = args.includes('fast'), labs = 8, flies = num('flies', 64), perLab = Math.max(1, Math.round(flies / labs)), n = labs * perLab;
  const rounds = num('rounds', 10), threads = num('threads', 6), seconds = num('seconds', 20);
  const rand = rng(num('seed', 1));
  const state = { labs, perLab, elite: 0.3, rand, setups: Array.from({ length: n }, (_, i) => i % perLab === 0 ? defaultSetup() : randomSetup(rand)), fitness: new Float32Array(n) };
  const same = new Uint8Array(n);
  const workers = await Promise.all(Array.from({ length: threads }, () => new Promise((res) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { fast, seconds }, argv: [] }); w.once('message', () => res(w)); })));
  console.log(`${n} desks (${labs} labs of ${perLab}), ${threads} brains at once, ${fast ? 'FAST MODE (reduced circuit)' : 'complete brain'}, games of up to ${seconds} s`);
  const log = [];
  let best = null;
  for (let round = 0; round < rounds; round++) {
    const seed = (round * 7 + 3) % 256 + 256 * round, t0 = performance.now();
    const res = new Array(n); let next = 0, gameMs = 0, gameTics = 0;
    await Promise.all(workers.map((w) => new Promise((done) => {
      const give = () => { if (next >= n) { w.removeAllListeners('message'); done(); return; } const d = next++; w.postMessage({ desk: d, setup: state.setups[d], seed }); };
      w.on('message', (m) => { res[m.desk] = m; gameMs += m.ms; gameTics += m.tics; give(); });
      give();
    })));
    let sum = 0, top = 0, perfect = 0, dead = 0;
    for (let i = 0; i < n; i++) {
      const r = res[i];
      state.fitness[i] = same[i] ? 0.5 * state.fitness[i] + 0.5 * r.score : r.score; same[i] = 1;
      sum += r.score; if (r.score > res[top].score) top = i; if (r.perfect) perfect++; if (r.dead) dead++;
      if (!best || r.score > best.score) best = { score: r.score, kills: r.kills, round: round + 1, desk: i, setup: Float32Array.from(state.setups[i]) };
    }
    const sorted = res.map((r) => r.score).sort((a, b) => a - b);
    const row = { round: round + 1, mean: sum / n, median: sorted[n >> 1], best: res[top].score, perfect, dead, minutes: (performance.now() - t0) / 60000, speed: (gameTics / 35 * 1000) / gameMs };
    log.push(row);
    console.log(`round ${row.round}: mean ${row.mean.toFixed(2)}, median ${row.median.toFixed(2)}, best ${row.best.toFixed(2)} of 8, perfect games ${perfect}, flies that died ${dead}/${n}; ${row.minutes.toFixed(1)} min, one brain at ${row.speed.toFixed(2)}x real time`);
    console.log('   best desk this round: ' + describeSetup(state.setups[top]).map((d) => `${d.key}=${d.shown}`).join(' '));
    for (const dst of evolve(state)) same[dst] = 0;
  }
  console.log(`best game: ${best.score.toFixed(2)} of 8 (${best.kills} killed) in round ${best.round}; setup: ` + describeSetup(best.setup).map((d) => `${d.key}=${d.shown}`).join(' '));
  const out = join(dirname(fileURLToPath(import.meta.url)), '.out');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'train_doom.json'), JSON.stringify({ flies: n, threads, seconds, fast, log, best: { ...best, setup: Array.from(best.setup) } }, null, 1));
  for (const w of workers) w.terminate();
}
