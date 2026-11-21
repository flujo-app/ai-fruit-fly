// The Doom gym without a page: desks play rounds, the setups are passed on, and the numbers are printed.
//   node tools/train_doom.mjs [level] [flies=64] [rounds=10] [threads=6] [seconds=20] [seed=1] [fast] [standard]
//   level      the real level (Freedoom's first level) instead of the arena; games then last 60 s unless seconds= says otherwise
//   standard   every desk gets the standard setup and nothing is tuned between rounds: how good is the standard desk?
//   name=x     added to the name of the file the numbers are written to (tools/.out/train_doom-....json)
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
  const { Game, taskOf } = await import('../js/doom/game.js');
  const { fast, seconds, task } = workerData;
  const [doom, rig, wiring] = await Promise.all([loadDoomFromUrls(), loadRig(), loadWiring(fast)]);
  const { brain, eye, remap } = makeFly(rig, wiring, fast);
  const game = new Game({ doom, brain, eye, rig, remap, task: taskOf(task, { seconds }) });
  parentPort.on('message', (m) => {
    const t0 = performance.now();
    game.start(m.setup, m.seed, m.desk);
    while (game.step());
    const r = game.result(), lv = r.level;
    parentPort.postMessage({ desk: m.desk, score: r.score, kills: r.kills, perfect: r.perfect, dead: r.dead, tics: r.tics, shots: r.shots, hits: r.hits, ms: performance.now() - t0,
      way: lv ? lv.way : 0, doors: lv ? lv.doors : 0, squares: lv ? lv.squares : 0, uses: lv ? lv.uses : 0, path: lv ? Array.from(lv.path) : null });
  });
  parentPort.postMessage({ ready: true, doors: game.nav ? game.nav.doors.length : 0, monsters: game.nav ? game.nav.monsters : 0 });
} else {
  const { defaultSetup, randomSetup, rng, describeSetup, KEY } = await import('../js/doom/setup.js');
  const { evolve } = await import('../js/doom/evolve.js');
  const { taskOf } = await import('../js/doom/game.js');
  const task = taskOf(args.includes('level') ? 'level' : 'arena'), level = !!task.level, standard = args.includes('standard');
  const fast = args.includes('fast'), labs = 8, flies = num('flies', 64), perLab = Math.max(1, Math.round(flies / labs)), n = labs * perLab;
  const rounds = num('rounds', 10), threads = num('threads', 6), seconds = num('seconds', level ? task.seconds : 20);
  const rand = rng(num('seed', 1));
  const isStandard = (i) => standard || i % perLab === 0;
  const state = { labs, perLab, elite: 0.3, rand, setups: Array.from({ length: n }, (_, i) => isStandard(i) ? defaultSetup() : randomSetup(rand)), fitness: new Float32Array(n) };
  // as on the pages: without learning the blue-light signal stays off, so the learning centre stays silent
  for (const s of state.setups) s[KEY.gBlue] = 0;
  const same = new Uint8Array(n);
  let info = null;
  const workers = await Promise.all(Array.from({ length: threads }, () => new Promise((res) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { fast, seconds, task: task.name }, argv: [] }); w.once('message', (m) => { info = m; res(w); }); })));
  console.log(`${level ? 'the real level' : 'the arena'}: ${n} desks (${labs} labs of ${perLab}), ${threads} brains at once, ${fast ? 'FAST MODE (reduced circuit)' : 'complete brain'}, games of up to ${seconds} s${standard ? ', every desk with the standard setup, no tuning' : ''}`);
  const log = [], all = [];
  const out = join(dirname(fileURLToPath(import.meta.url)), '.out'), file = `train_doom${level ? '-level' : ''}${standard ? '-standard' : ''}${args.find((a) => a.startsWith('name=')) ? '-' + args.find((a) => a.startsWith('name=')).slice(5) : ''}.json`;
  mkdirSync(out, { recursive: true });
  const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const sem = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length); };
  const pct = (x) => `${(100 * x).toFixed(0)}%`;
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
      if (!best || r.score > best.score) best = { score: r.score, kills: r.kills, way: r.way, doors: r.doors, round: round + 1, desk: i, seed, setup: Float32Array.from(state.setups[i]), path: r.path };
    }
    const sorted = res.map((r) => r.score).sort((a, b) => a - b);
    const row = { round: round + 1, mean: sum / n, sem: sem(res.map((r) => r.score)), median: sorted[n >> 1], best: res[top].score, perfect, dead, minutes: (performance.now() - t0) / 60000, speed: (gameTics / 35 * 1000) / gameMs };
    if (level) {
      Object.assign(row, { way: mean(res.map((r) => r.way)), bestWay: Math.max(...res.map((r) => r.way)), kills: mean(res.map((r) => r.kills)), squares: mean(res.map((r) => r.squares)), uses: mean(res.map((r) => r.uses)),
        throughDoor: Array.from({ length: info.doors }, (_, d) => res.filter((r) => r.doors > d).length) });
      if (round === 0 && !standard) {      // the first round is the only one with untouched random desks: the standard and the random desks apart
        const st = res.filter((_, i) => isStandard(i)), ra = res.filter((_, i) => !isStandard(i));
        row.standardDesks = { n: st.length, mean: mean(st.map((r) => r.score)), way: mean(st.map((r) => r.way)) };
        row.randomDesks = { n: ra.length, mean: mean(ra.map((r) => r.score)), sem: sem(ra.map((r) => r.score)), way: mean(ra.map((r) => r.way)), bestWay: Math.max(...ra.map((r) => r.way)) };
      }
    }
    log.push(row);
    all.push(res.map((r, i) => ({ desk: i, standard: isStandard(i) && same[i] === 1 && round === 0, score: +r.score.toFixed(3), way: +r.way.toFixed(4), doors: r.doors, kills: r.kills, dead: r.dead, seconds: +(r.tics / 35).toFixed(1), uses: r.uses })));
    if (level) {
      console.log(`round ${row.round}: mean ${row.mean.toFixed(2)} ± ${row.sem.toFixed(2)}, median ${row.median.toFixed(2)}, best ${row.best.toFixed(2)} of 8; way to the exit: mean ${pct(row.way)}, best ${pct(row.bestWay)}; `
        + row.throughDoor.map((c, d) => `through door ${d + 1}: ${c}`).join(', ') + `; found the exit: ${perfect}; killed ${row.kills.toFixed(1)} of ${info.monsters}; died ${dead}/${n}; ${row.minutes.toFixed(1)} min, one brain at ${row.speed.toFixed(2)}x real time`);
      if (row.randomDesks) console.log(`   the ${row.standardDesks.n} standard desks: mean ${row.standardDesks.mean.toFixed(2)}, way ${pct(row.standardDesks.way)}; the ${row.randomDesks.n} random desks: mean ${row.randomDesks.mean.toFixed(2)} ± ${row.randomDesks.sem.toFixed(2)}, way ${pct(row.randomDesks.way)} (best ${pct(row.randomDesks.bestWay)})`);
    } else {
      console.log(`round ${row.round}: mean ${row.mean.toFixed(2)}, median ${row.median.toFixed(2)}, best ${row.best.toFixed(2)} of 8, perfect games ${perfect}, flies that died ${dead}/${n}; ${row.minutes.toFixed(1)} min, one brain at ${row.speed.toFixed(2)}x real time`);
    }
    console.log('   best desk this round: ' + describeSetup(state.setups[top]).map((d) => `${d.key}=${d.shown}`).join(' '));
    // the numbers so far are written after every round (a round with complete brains takes long)
    writeFileSync(join(out, file), JSON.stringify({ task: task.name, flies: n, threads, seconds, fast, standard, log, games: all, best: { ...best, setup: Array.from(best.setup) } }, null, 1));
    if (!standard) for (const dst of evolve(state)) { same[dst] = 0; state.setups[dst][KEY.gBlue] = 0; }
  }
  console.log(`best game: ${best.score.toFixed(2)} of 8 (${level ? `${pct(best.way)} of the way, through ${best.doors} door(s), ` : ''}${best.kills} killed) in round ${best.round}; setup: ` + describeSetup(best.setup).map((d) => `${d.key}=${d.shown}`).join(' '));
  console.log(`numbers written to tools/.out/${file}`);
  for (const w of workers) w.terminate();
}
