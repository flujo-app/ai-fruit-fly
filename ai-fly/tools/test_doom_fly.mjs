// Checks the chain "Doom picture -> fly eyes -> complete brain -> game controller".
//   node tools/test_doom_fly.mjs          (about a minute)
import { loadDoomFromUrls, DOOM } from '../js/doom/engine.js';
import { loadRig, loadWiring, makeFly } from '../js/doom/load.js';
import { Game, Replay, readoutCells, FRAME_W, FRAME_H } from '../js/doom/game.js';
import { defaultSetup, randomSetup, mutateSetup, rng, SETUP, KEY } from '../js/doom/setup.js';
import { evolve } from '../js/doom/evolve.js';

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
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
