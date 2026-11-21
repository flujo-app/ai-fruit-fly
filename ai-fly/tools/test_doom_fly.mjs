// Checks the chain "Doom picture -> fly eyes -> complete brain -> game controller", the learning centre,
// and the real level (its map, the "use" key, the score, the replay).
//   node tools/test_doom_fly.mjs          (several minutes)
import { loadDoomFromUrls, DOOM } from '../js/doom/engine.js';
import { loadRig, loadWiring, makeFly } from '../js/doom/load.js';
import { readFileSync } from 'node:fs';
import { Game, Replay, readoutCells, taskOf, LEVEL, USE_CELLS, FRAME_W, FRAME_H } from '../js/doom/game.js';
import { readLevel, buildNav } from '../js/doom/level.js';
import { defaultSetup, randomSetup, mutateSetup, rng, SETUP, KEY, BLUE_STANDARD } from '../js/doom/setup.js';
import { evolve } from '../js/doom/evolve.js';
import { LEARN } from '../js/doom/learning.js';

let failed = 0;
const check = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failed++; };
const [doom, rig, wiring] = await Promise.all([loadDoomFromUrls(), loadRig(), loadWiring(false)]);
const { brain, eye, neurons, connections } = makeFly(rig, wiring, false);

// ---- the data
check(neurons === 138639 && connections === 15091983, `the complete brain is loaded: ${neurons.toLocaleString('en')} neurons, ${connections.toLocaleString('en')} connections`);
check(rig.colSide.length > 1500 && eye.N > 24000, `eye map: ${rig.colSide.length} facets, ${eye.N.toLocaleString('en')} eye cells get the picture`);
const m = rig.meta.eyeMapCheck;
const near = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 25;
check(['left', 'right'].every((s) => near(m[s].T4a[0], 0) && near(m[s].T4b[0], 180) && near(m[s].T4c[0], 90) && near(m[s].T4d[0], -90) && Math.min(...Object.values(m[s]).map((x) => x[1])) > 0.6),
  `the motion cells' wiring agrees with the eye map (front-to-back 0°, back-to-front 180°, up 90°, down -90°): left ${JSON.stringify(m.left)}`);
eye.setScreen(120, FRAME_W, FRAME_H);
check(eye.facetsOnScreen > 400 && eye.facetsOnScreen < 900, `a 120° screen is seen by ${eye.facetsOnScreen} facets (both eyes)`);
const read = readoutCells(rig);
check(['DNa01_L', 'DNa02_R', 'DNg100_L', 'DNg97_R', 'MDN_L', 'DNp01_L', 'DNp01_R'].every((k) => read.span[k][1] >= 1), 'the output cells for steering, walking, backing up and jumping exist');

// ---- the eye in front of simple pictures (no game): a grey screen, then a dark bar moving to the right
{
  eye.setPalette(Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)));     // palette entry i = grey level i
  const frame = new Uint8Array(FRAME_W * FRAME_H).fill(128);
  eye.reset(); for (let k = 0; k < 10; k++) eye.see(frame);
  let quiet = 0; for (let i = 0; i < eye.N; i++) if (eye.rate[i] > 1) quiet++;
  check(quiet === 0, 'a still grey screen drives no eye cell');
  const sums = new Float64Array(16);
  for (let t = 0; t < 20; t++) {
    frame.fill(128);
    const x0 = 10 + t * 3;
    for (let y = 0; y < FRAME_H; y++) for (let x = x0; x < x0 + 10; x++) frame[y * FRAME_W + x] = 10;
    eye.see(frame);
    for (let i = 0; i < eye.N; i++) {
      // the bar moves to the fly's right: front-to-back for the right eye, back-to-front for the left eye
      const k = eye.cellKind[i], rightEye = rig.colSide[eye.cellCol[i]];
      if (k < 8 && (k & 3) < 2) sums[(rightEye ? 4 : 0) + (k & 3) + 0] += eye.rate[i];
    }
  }
  const [lFtb, lBtf, , , rFtb, rBtf] = sums;
  check(rFtb > 3 * rBtf && lBtf > 3 * lFtb, `a bar moving right drives the right eye's front-to-back cells and the left eye's back-to-front cells (right eye ${rFtb.toFixed(0)} vs ${rBtf.toFixed(0)}, left eye ${lBtf.toFixed(0)} vs ${lFtb.toFixed(0)})`);
}

// ---- a whole game, twice, and its replay
const game = new Game({ doom, brain, eye, rig });
const play = (setup, seed) => { game.start(setup, seed); const t0 = performance.now(); while (game.step()); const r = game.result(); r.ms = performance.now() - t0; r.end = [...doom.state.slice(1, 17)].join(','); r.impulses = brain.spikesTotal; return r; };
brain.spikesTotal = 0;
const a = play(defaultSetup(), 3);
check(a.tics > 100 && a.impulses > 50000, `a game with the standard desk setup runs: ${(a.tics / 35).toFixed(1)} s of Doom, score ${a.score.toFixed(2)} of 8, ${a.kills} killed, ${a.shots} shots, ${a.impulses.toLocaleString('en')} nerve impulses, brain at ${(a.tics / 35 * 1000 / a.ms).toFixed(2)}x real time`);
check(a.shots > 0, 'the fly pulled the trigger (its giant fibre fired)');
brain.spikesTotal = 0;
const b = play(defaultSetup(), 3);
check(a.end === b.end && a.score === b.score && a.cmds.length === b.cmds.length && a.cmds.every((v, i) => v === b.cmds[i]), 'the same seed and setup give exactly the same game again');
const rp = new Replay(doom).start(a); while (rp.step());
check([...doom.state.slice(1, 17)].join(',') === a.end, 'replaying the recorded input (no brain) ends in the same state');
const c = play(defaultSetup(), 4);
check(c.end !== a.end, 'another seed gives another game');
check(a.kcEver === 0 && a.memory === null, 'with the blue-light signal off, no Kenyon cell of the learning centre fires, and nothing is learnt');

// ---- the learning centre
{
  const lc = game.lc;
  check(lc.ok && eye.blueCells.length === 7 && lc.kc.length > 300 && lc.size > 3000, `learning centre: ${eye.blueCells.length} blue-light cells, ${lc.kc.length} Kenyon cells with input from the eyes, a memory of ${lc.size} connections`);
  // the rule by itself: pretend Kenyon cells 0..9 were just active, then give a drop of sugar, then one of bitter
  lc.load(null);
  for (let k = 0; k < 10; k++) lc.trace[k] = 5;
  const zoneOf = (m) => lc.memZone[m], inFirstTen = (m) => m < lc.memStart[10];
  lc.drop(1, 1);
  let okSugar = true, touched = 0;
  for (let m = 0; m < lc.size; m++) { const should = inFirstTen(m) && zoneOf(m) === 1; if (should) touched++; if (should ? Math.abs(lc.mem[m] - (1 - LEARN.sugar)) > 1e-6 : lc.mem[m] !== 1) okSugar = false; }
  check(okSugar && touched > 0, `a drop of sugar weakens only the active Kenyon cells' connections onto the "sugar zone" output cells (${touched} connections, each by ${LEARN.sugar * 100}%)`);
  lc.drop(2, 1);
  let okBitter = true, touchedB = 0;
  for (let m = 0; m < lc.size; m++) { if (inFirstTen(m) && zoneOf(m) === 2) { touchedB++; if (Math.abs(lc.mem[m] - (1 - LEARN.bitter)) > 1e-6) okBitter = false; } else if (!inFirstTen(m) && lc.mem[m] !== 1) okBitter = false; }
  check(okBitter && touchedB > 0, `a drop of bitter does the same for the "bitter zone" output cells (${touchedB} connections)`);
  const m0 = lc.memIdx[lc.memStart[0]];
  check(Math.abs(brain.pw[m0] - brain.pBase[m0] * lc.mem[lc.memStart[0]]) < 1e-6, 'the brain really runs with the weakened connections');
  const kept = lc.memory();
  check(kept.every((v, m) => v >= lc.mem[m] - 1e-6 && v <= 1 + 1e-6) && kept.some((v, m) => v > lc.mem[m] + 1e-6), 'between games a little of the memory fades back');

  // a game with blue light reaching the learning centre, without and with learning
  const blue = defaultSetup(); blue[KEY.gBlue] = BLUE_STANDARD;
  const seeing = play(blue, 3);
  check(seeing.kcEver > 0 && seeing.kcStorm < 0.1 && seeing.memory === null, `blue light on: ${seeing.kcEver} Kenyon cells take part in the game (${seeing.kcPerTic.toFixed(1)} per 1/35 s), the whole centre fires at once in ${(100 * seeing.kcStorm).toFixed(1)}% of the time; score ${seeing.score.toFixed(2)}`);
  game.learn = true;
  const learning = play(blue, 3);
  const weak = learning.memory ? learning.memory.filter((v) => v < 0.99).length : 0;
  check(learning.memory && learning.memory.length === lc.size && (learning.sugar + learning.bitter === 0 || weak > 0), `learning on: ${learning.sugar} drops of sugar, ${learning.bitter} of bitter, ${weak} connections weakened; score ${learning.score.toFixed(2)}`);
  game.start(blue, 4, 0, learning.memory); while (game.step());
  const next = game.result();
  check(next.memory && next.memory.length === lc.size, `the fly takes its memory into the next game (score ${next.score.toFixed(2)})`);
  game.learn = false;
  const again = play(defaultSetup(), 3);
  check(again.end === a.end, 'and with learning and blue light off again, the game is exactly the one from before');
}

// ---- desk setups
{
  const rand = rng(5), n = 64, state = { labs: 8, perLab: 8, elite: 0.3, rand, setups: Array.from({ length: n }, () => randomSetup(rand)), fitness: Float32Array.from({ length: n }, () => rand() * 8) };
  const inRange = (s) => SETUP.every((k, i) => s[i] >= k.min - 1e-6 && s[i] <= k.max + 1e-6);
  check(state.setups.every(inRange) && inRange(mutateSetup(defaultSetup(), rand, 0.5)), 'random and changed setups stay inside the knobs\' ranges');
  const bestOf = (lab) => { let b = lab * 8; for (let d = 1; d < 8; d++) if (state.fitness[lab * 8 + d] > state.fitness[b]) b = lab * 8 + d; return b; };
  const best0 = bestOf(0), keep = Float32Array.from(state.setups[best0]);
  const changed = evolve(state);
  check(changed.length >= 16 && !changed.includes(best0) && state.setups[best0].every((v, i) => v === keep[i]), `after a round ${changed.length} of 64 desks get a new setup and each lab's best desk keeps its own`);
  check(SETUP[KEY.turn].min < 0, 'the turning knob can be negative (the ball read the other way round)');
}
// ---- the real level (Freedoom's first level). It comes last: its game takes over the brain's counters.
{
  const { S, BT } = DOOM, st = doom.state;
  const task = taskOf('level', { seconds: 25 }), lgame = new Game({ doom, brain, eye, rig, task }), nav = lgame.nav;
  const fromFile = buildNav(readLevel(readFileSync(new URL('../data/doom/flygym.wad', import.meta.url)), 1), 3);
  check(nav.total === fromFile.total && nav.total > 4000 && nav.total < 5200 && nav.doors.length === 3 && nav.monsters === 18,
    `the level's map is read from the game file: the way from the start to the exit switch is ${nav.total.toFixed(0)} map units long and leads through ${nav.doors.length} doors (after ${nav.doors.map((d) => Math.round(100 * d.way) + '%').join(', ')} of the way); ${nav.monsters} monsters, ${nav.items} items, ${nav.groundTotal} squares of floor`);
  check(nav.way(nav.level.start.x, nav.level.start.y) === 0 && nav.way(nav.exit.x, nav.exit.y) > 0.99 && nav.doors.every((d, k) => d.way > 0 && d.way < 1 && (!k || d.way > nav.doors[k - 1].way)), 'the way to the exit counts from 0 at the start to 1 at the exit switch, and the doors come in order');
  check(USE_CELLS.every((nm) => lgame.read.span[nm][1] === 1), `the "use" key's cells exist: the landing cells ${USE_CELLS.join(', ')}`);

  // a hand-written walker with the fly's keys (turn, walk, trigger, "use"): it follows the worked-out route,
  // holds the trigger and taps "use". It shows that the level can be finished with these keys in the time given.
  const walker = (seed) => {
    lgame.start(defaultSetup(), seed);
    const route = nav.route;
    let at = 0;
    while (!lgame.over) {
      const x = st[S.X] / 65536, y = st[S.Y] / 65536, a = (st[S.ANGLE] >>> 0) / 4294967296 * 360;
      while (at < route.length - 1 && Math.hypot(route[at][0] - x, route[at][1] - y) < 40) at++;
      const last = at >= route.length - 1 && Math.hypot(route[at][0] - x, route[at][1] - y) < 24;      // at the switch: face it
      let d = (last ? nav.exit.faceDeg : Math.atan2(route[at][1] - y, route[at][0] - x) * 180 / Math.PI) - a; d = ((d % 360) + 540) % 360 - 180;
      lgame.act(last ? 0 : Math.abs(d) < 40 ? 50 : 0, Math.max(-2800, Math.min(2800, Math.round(d * 182 * 0.35))), BT.FIRE | (lgame.tic % 8 < 4 ? BT.USE : 0));
    }
    return lgame.result();
  };
  const w = walker(2);
  check(w.level.exited && w.perfect && w.score === 8 && w.level.way === 1 && w.level.doors === 3 && st[S.EXITED] === 1,
    `a hand-written route follower with the fly's keys finishes the level: exit switch pressed after ${(w.tics / 35).toFixed(1)} s, score ${w.score} of 8, through ${w.level.doors} doors, ${w.level.squares} squares of floor, health ${w.health}`);
  const wEnd = [...st.slice(1, 24)].join(',');
  const rp = new Replay(doom, task).start(w); while (rp.step());
  check([...st.slice(1, 24)].join(',') === wEnd && st[S.EXITED] === 1, 'replaying its recorded input ends at the exit again');
  check(w.level.path.length >= 2 * Math.floor(w.tics / 5) && w.level.path[0] === nav.level.start.x && w.level.path[1] === nav.level.start.y, `its path is recorded for the small map (${w.level.path.length / 2} points)`);

  // the fly itself, standard desk: a still room gives its eyes nothing, and this brain model has no activity of its own
  const fly = (setup, seed, n) => { lgame.start(setup, seed, n); while (lgame.step()); return lgame.result(); };
  const still = fly(defaultSetup(), 3, 0);
  check(still.level.way === 0 && still.shots === 0 && still.level.uses === 0 && still.tics === 25 * 35, `standard desk: nothing moves in the level's first room, so nothing reaches the fly's brain and it stands still for the whole game (score ${still.score.toFixed(2)})`);

  // a desk that gets the fly going (the 4th random desk of `node tools/train_doom.mjs level flies=16 seed=5`): its ball
  // is trimmed, so the view drifts, the eyes get movement and the brain answers. Its own landing cells open the first door.
  const rand = rng(5); let going;
  for (let k = 0; k < 4; k++) going = randomSetup(rand);
  going[KEY.gBlue] = 0;
  const g = fly(going, 3, 7);
  const L = g.level, ground = Math.min(1, L.squares / (LEVEL.groundFull * nav.groundTotal));
  check(L.way > 0.2 && L.doors >= 1 && L.uses >= 1 && !L.exited, `a desk with a trimmed ball: the fly walks ${(100 * L.way).toFixed(0)}% of the way to the exit in ${(g.tics / 35).toFixed(0)} s and gets through ${L.doors} door(s); its landing cells pressed "use" ${L.uses} times (score ${g.score.toFixed(2)} of 8)`);
  check(Math.abs(g.score - (LEVEL.wayPoints * L.way + LEVEL.groundPoints * ground + LEVEL.killPoints * g.kills / nav.monsters)) < 1e-9 && g.score < 8, `the score adds up: ${LEVEL.wayPoints} x ${L.way.toFixed(3)} of the way + ${LEVEL.groundPoints} x ${ground.toFixed(3)} for new ground (${L.squares} squares) + ${LEVEL.killPoints} x ${g.kills}/${nav.monsters} monsters`);
  const gEnd = [...st.slice(1, 24)].join(',');
  const rp2 = new Replay(doom, task).start(g); while (rp2.step());
  check([...st.slice(1, 24)].join(',') === gEnd, 'replaying the fly\'s recorded input (no brain) ends in the same state, doors included');

  // with the learning centre on: sugar for new ground
  const blue = Float32Array.from(going); blue[KEY.gBlue] = BLUE_STANDARD;
  lgame.learn = true;
  const ln = fly(blue, 3, 7);
  check(ln.memory && ln.sugar === Math.floor((ln.level.squares - 1) / LEARN.groundSquares) + ln.kills + (ln.level.exited ? LEARN.clear : 0) && ln.sugar > 0,
    `learning on in the level: ${ln.sugar} drops of sugar for ${ln.level.squares} squares of new ground (one for every ${LEARN.groundSquares}) and ${ln.kills} kills, ${ln.bitter} drops of bitter (hits and being stuck: ${ln.stuck} times stuck); ${(100 * ln.level.way).toFixed(0)}% of the way`);
  lgame.learn = false;
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
