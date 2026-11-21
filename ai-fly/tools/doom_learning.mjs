// Does the learning centre help the flies at Doom?
//   node tools/doom_learning.mjs [flies=14] [games=10] [threads=6] [blue=450] [seed=1] [level] [seconds=..] [desk=file.json]
//   level        the real level instead of the arena (sugar then also for new ground and the exit, bitter also for being stuck)
//   desk=file    the desk setup to use: a file written by tools/train_doom.mjs (its best desk). Without it, the standard desk.
//                In the level the standard desk's fly stands still, so there a desk that gets it going is needed.
// Every fly plays the same row of games three times, with the same desk setup:
//   1. "blind":    the blue-light signal is off, so nothing reaches its learning centre (the game as it was)
//   2. "seeing":   blue light reaches the learning centre, but nothing is ever learnt
//   3. "learning": the same, and each kill gives sugar and each hit taken bitter (see js/doom/learning.js);
//                  what the fly learns in one game it keeps for the next
// Same monsters, same places and the same run of chance in all three. Complete brains.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const num = (k, d) => { const a = args.find((x) => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };

if (!isMainThread) {
  const { loadDoomFromUrls } = await import('../js/doom/engine.js');
  const { loadRig, loadWiring, makeFly } = await import('../js/doom/load.js');
  const { Game, taskOf } = await import('../js/doom/game.js');
  const { LearningCentre } = await import('../js/doom/learning.js');
  const { defaultSetup, KEY } = await import('../js/doom/setup.js');
  const [doom, rig, wiring] = await Promise.all([loadDoomFromUrls(), loadRig(), loadWiring(false)]);
  const { brain, eye } = makeFly(rig, wiring, false);
  const task = taskOf(workerData.task, workerData.seconds ? { seconds: workerData.seconds } : {});
  const game = new Game({ doom, brain, eye, rig, task, learn: true });
  parentPort.on('message', (m) => {
    const setup = workerData.desk ? Float32Array.from(workerData.desk) : defaultSetup();
    setup[KEY.gBlue] = m.cond === 'blind' ? 0 : workerData.blue;
    game.learn = m.cond === 'learning';
    let memory = null; const out = [];
    for (const seed of m.seeds) {
      game.start(setup, seed, m.fly, memory);
      while (game.step());
      const r = game.result();
      memory = r.memory;
      const st = memory ? LearningCentre.strength(memory, game.lc) : { sugar: 0, bitter: 0 };
      out.push({ way: r.level ? r.level.way : 0, doors: r.level ? r.level.doors : 0, exited: r.level && r.level.exited ? 1 : 0, stuck: r.stuck, score: r.score, kills: r.kills, dead: r.dead, seconds: r.tics / 35, kcPerTic: r.kcPerTic, kcEver: r.kcEver, storm: r.kcStorm, sugar: r.sugar, bitter: r.bitter, learntSugar: st.sugar, learntBitter: st.bitter });
    }
    parentPort.postMessage({ fly: m.fly, cond: m.cond, out });
  });
  parentPort.postMessage({ ready: true });
} else {
  const flies = num('flies', 14), games = num('games', 10), threads = num('threads', 6), blue = num('blue', 450), seed0 = num('seed', 1);
  const task = args.includes('level') ? 'level' : 'arena', seconds = num('seconds', 0);
  const deskArg = args.find((x) => x.startsWith('desk=')), desk = deskArg ? JSON.parse(readFileSync(deskArg.slice(5), 'utf8')).best.setup : null;
  const seeds = Array.from({ length: games }, (_, g) => seed0 * 100 + g * 7 + 3);
  // ways=seeing,learning plays only those (the "blind" games never change: same seeds, same flies, same result)
  const waysArg = args.find((x) => x.startsWith('ways='));
  const conds = waysArg ? waysArg.split('=')[1].split(',') : ['blind', 'seeing', 'learning'];
  const jobs = [];
  for (let f = 0; f < flies; f++) for (const cond of conds) jobs.push({ fly: f, cond, seeds });
  console.log(`${task === 'level' ? 'the real level' : 'the arena'}: ${flies} flies x ${games} games x ${conds.length} ways (${conds.join(', ')}), complete brains, ${threads} at once, blue-light signal ${blue}, ${desk ? 'the desk from ' + deskArg.slice(5) : 'the standard desk'}`);
  const workers = await Promise.all(Array.from({ length: threads }, () => new Promise((res) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { blue, task, seconds, desk }, argv: [] }); w.once('message', () => res(w)); })));
  const res = {}; let next = 0, done = 0; const t0 = performance.now();
  await Promise.all(workers.map((w) => new Promise((finish) => {
    const give = () => { if (next >= jobs.length) { w.removeAllListeners('message'); finish(); return; } w.postMessage(jobs[next++]); };
    w.on('message', (m) => { res[m.cond + m.fly] = m.out; done++; if (done % threads === 0) console.log(`   ${done} of ${jobs.length} rows of games done, ${((performance.now() - t0) / 60000).toFixed(1)} min`); give(); });
    give();
  })));
  for (const w of workers) w.terminate();
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const se = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1) / a.length); };
  const col = (cond, key, from = 0, to = games) => { const a = []; for (let f = 0; f < flies; f++) for (let g = from; g < to; g++) a.push(+res[cond + f][g][key]); return a; };
  console.log('\nscore out of 8, average over the flies, game by game:');
  console.log('game      ' + seeds.map((_, g) => String(g + 1).padStart(5)).join(''));
  for (const c of conds) console.log(c.padEnd(10) + seeds.map((_, g) => mean(col(c, 'score', g, g + 1)).toFixed(2).padStart(5)).join(''));
  const half = Math.floor(games / 2);
  console.log('\n                     all games          first half         second half');
  for (const c of conds) console.log(`${c.padEnd(10)} score  ${[[0, games], [0, half], [half, games]].map(([a, b]) => `${mean(col(c, 'score', a, b)).toFixed(2)} ± ${se(col(c, 'score', a, b)).toFixed(2)}`.padEnd(19)).join('')}`);
  // the same fly, the same games: learning minus seeing
  const diff = (a, b, from, to) => { const d = []; for (let f = 0; f < flies; f++) { let s = 0; for (let g = from; g < to; g++) s += res[a + f][g].score - res[b + f][g].score; d.push(s / (to - from)); } return d; };
  for (const [a, b] of [['learning', 'seeing'], ['seeing', 'blind'], ['learning', 'blind']].filter(([a, b]) => conds.includes(a) && conds.includes(b))) {
    const d1 = diff(a, b, 0, half), d2 = diff(a, b, half, games);
    console.log(`${a} minus ${b}, per fly: first half ${mean(d1) >= 0 ? '+' : ''}${mean(d1).toFixed(2)} ± ${se(d1).toFixed(2)}, second half ${mean(d2) >= 0 ? '+' : ''}${mean(d2).toFixed(2)} ± ${se(d2).toFixed(2)}`);
  }
  if (task === 'level') for (const c of conds) console.log(`${c.padEnd(10)} way to the exit ${(100 * mean(col(c, 'way'))).toFixed(0)}% ± ${(100 * se(col(c, 'way'))).toFixed(0)} (first half ${(100 * mean(col(c, 'way', 0, half))).toFixed(0)}%, second half ${(100 * mean(col(c, 'way', half, games))).toFixed(0)}%), doors per game ${mean(col(c, 'doors')).toFixed(2)}, games that ended at the exit ${col(c, 'exited').reduce((a, b) => a + b, 0)} of ${flies * games}`);
  console.log('\nthe learning centre during the games (average per game):');
  for (const c of ['seeing', 'learning'].filter((c) => conds.includes(c))) console.log(`${c.padEnd(10)} visual Kenyon cells firing per tic ${mean(col(c, 'kcPerTic')).toFixed(1)}, different ones per game ${mean(col(c, 'kcEver')).toFixed(0)}, whole-centre storms ${(100 * mean(col(c, 'storm'))).toFixed(1)}% of the time, died ${(100 * mean(col(c, 'dead'))).toFixed(0)}%`);
  if (conds.includes('learning')) console.log(`learning   drops per game: sugar ${mean(col('learning', 'sugar')).toFixed(1)}, bitter ${mean(col('learning', 'bitter')).toFixed(1)} (${mean(col('learning', 'stuck')).toFixed(1)} of them for being stuck); connections weakened after game 1 / last game: sugar zone ${(100 * mean(col('learning', 'learntSugar', 0, 1))).toFixed(1)}% / ${(100 * mean(col('learning', 'learntSugar', games - 1, games))).toFixed(1)}%, bitter zone ${(100 * mean(col('learning', 'learntBitter', 0, 1))).toFixed(1)}% / ${(100 * mean(col('learning', 'learntBitter', games - 1, games))).toFixed(1)}%`);
  console.log(`\n${((performance.now() - t0) / 60000).toFixed(1)} minutes`);
}
