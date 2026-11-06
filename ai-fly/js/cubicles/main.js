// Cubicles: the Fly Gym as an office you can walk around in. 1,024 flies (8 labs = 8 teams) type at
// their computers; the supervisor deck has a big live screen and push buttons for the training speed.
// URL options: ?autostart (start at full speed), ?record (record the canvas into one video),
// ?autopilot (the camera walks by itself; implies ?go), ?go (skip the start screen).
import * as THREE from 'three';
import { GymRunner } from '../gym/runner.js';
import { Office } from './office.js';
import { Workers, NearDesk } from './flies.js';
import { Supervisor, BUTTONS } from './supervisor.js';
import { Player, EYE } from './player.js';
import { Party } from './party.js';
import { Hud } from './hud.js';
import { Recorder } from './recorder.js';
import { buildGrid, START, floorHeight, pathFrom, cubicle, teamOrigin, AISLE, CUB } from './layout.js';

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search);
const AUTOPILOT = P.has('autopilot');
const LABS = 8, PER_LAB = 128;
const PERIOD = { 1: 3500, 4: 900, max: 0 };            // milliseconds per generation (0 = as fast as possible)
const SPEED_LABEL = { 1: '1×', 4: '4×', max: 'MAX' };
const STUCK_AFTER = 300;   // rounds without a better best score before the flies are replaced
let restarts = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the 3D world
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f27);
scene.fog = new THREE.Fog(0x1b1f27, 30, 120);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x302e2a, 1.25));
const sun = new THREE.DirectionalLight(0xfff6e8, 1.3);
sun.position.set(20, 40, 15);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.12));

const office = new Office(scene, LABS, PER_LAB);
const workers = new Workers(scene, office);
const supervisor = new Supervisor(scene);
const grid = buildGrid(LABS, PER_LAB);
const player = new Player(camera, canvas, grid);
player.setPose(START.x, START.z, START.yaw, 0.17);
const party = new Party(scene, office, workers, grid);
const hud = new Hud();
const recorder = new Recorder(canvas);
const near = Array.from({ length: 8 }, () => new NearDesk(scene, office));

// ?size=1920x1080: always draw (and record) at this size, whatever the window size
const FIXED = P.has('size') ? P.get('size').split('x').map(Number) : null;
if (FIXED) renderer.setPixelRatio(1);
function resize() {
  const [w, h] = FIXED || [innerWidth, innerHeight];
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  hud.resize(size.x, size.y);
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- training
const runner = new GymRunner({ labs: LABS, perLab: PER_LAB });
let speed = 'pause', looping = false, last = null, banner = '', resetArmed = 0;
let genStart = 0, genDuration = 0, lastStepMs = 500;
let atlasDirty = false, atlasAt = 0, screenDirty = true, screenAt = 0, signsAt = 0;

function setSpeed(id) {
  speed = id;
  supervisor.setActive([id === 'pause' ? 'pause' : id, ...(recorder.active ? ['rec'] : [])]);
  screenDirty = true;
  updateStatus();
  if (id !== 'pause' && !looping) loop();
}

async function loop() {
  looping = true;
  while (speed !== 'pause') {
    const t0 = performance.now();
    const out = await runner.step();
    lastStepMs = performance.now() - t0;
    onStep(out);
    // at the slower speeds, let each round last a while (and stop waiting as soon as the speed changes)
    while (speed !== 'pause' && PERIOD[speed] && performance.now() - t0 < PERIOD[speed]) await sleep(40);
  }
  looping = false;
}

function onStep(out) {
  last = out;
  genStart = performance.now();
  genDuration = PERIOD[speed] || Math.max(250, lastStepMs);
  atlasDirty = true;
  screenDirty = true;
  refreshNearCodes();
  if (out.firstNow) startParty(out.best);
  // ?testparty: pretend the best fly of round 20 is a winner (to try the celebration quickly)
  else if (P.has('testparty') && runner.gen === 20 && !party.active) startParty(out.best);
  if (runner.gen % 100 === 0) fetch(`/ping?gen=${runner.gen}&best=${out.best.score.toFixed(2)}&solved=${out.solved}&speed=${runner.speed.toFixed(1)}`).catch(() => {});
  // a safety net: when the flies stop improving for a long time, new flies take the desks
  if (runner.firstSolved < 0 && runner.stagnantFor > STUCK_AFTER && !party.active) {
    hud.toast(`No progress for ${STUCK_AFTER} rounds: these flies are stuck. Hiring 1,024 new ones.`, 7);
    restarts++;
    newFlies(`New flies (restart ${restarts}): the last ones were stuck at ${runner.bestSoFar.toFixed(2)} / 8 for ${STUCK_AFTER} rounds.`);
    return;
  }
  updateStatus();
}

function updateStatus() {
  const s = speed === 'pause' ? (runner.gen ? 'paused' : 'not started') : `${SPEED_LABEL[speed]} · ${runner.speed.toFixed(1)} gen/s`;
  hud.set({ status: `Generation ${runner.gen}  ·  best ${last ? last.best.score.toFixed(2) : '–'} / 8  ·  perfect döners ${last ? last.solved : 0}  ·  ${s}` });
}

function drawScreen() {
  supervisor.draw({
    paused: speed === 'pause', gen: runner.gen, speedLabel: SPEED_LABEL[speed], genPerSec: runner.speed,
    best: last && last.best.score, mean: last && last.mean, solved: last && last.solved, programs: runner.programs,
    results: last && last.results, history: runner.history, champ: last && last.best, banner, recording: recorder.active, time: performance.now() / 1000,
  });
}

async function newFlies(reason = '') {
  const was = speed;
  speed = 'pause';
  while (looping) await sleep(30);
  party.endParty();
  banner = reason; last = null;
  await runner.init(PER_LAB);
  office.drawAtlas([], 0);
  for (const d of near) d.setCode(null, 0, 0);
  for (let lab = 0; lab < LABS; lab++) office.drawSign(lab, null);
  screenDirty = true;
  hud.toast('1,024 new flies started at their desks, all typing at random again.');
  setSpeed(was);
}

// ---------------------------------------------------------------- the desks near the visitor
let nearAt = 0;
function assignNear() {
  const cx = camera.position.x, cz = camera.position.z, fwd = player.forward;
  const want = [];
  for (let i = 0; i < office.n; i++) {
    if (party.active && i === party.i) continue;
    const c = office.cubes[i], dx = c.x - cx, dz = c.z - cz, d = Math.hypot(dx, dz);
    if (d > 9) continue;
    const ahead = (dx * fwd.x + dz * fwd.z) / (d || 1);
    want.push([d - ahead * 2.5, i]);
  }
  want.sort((a, b) => a[0] - b[0]);
  const chosen = new Set(want.slice(0, near.length).map((w) => w[1]));
  const free = near.filter((d) => !chosen.has(d.cube));
  const fresh = [];
  for (const i of chosen) {
    if (near.some((d) => d.cube === i)) continue;
    const d = free.pop();
    d.assign(i);
    fresh.push(d);
  }
  for (const d of free) d.assign(-1);
  workers.hidden = new Set([...near.filter((d) => d.cube >= 0).map((d) => d.cube), ...(party.active ? [party.i] : []), ...(party.away || [])]);
  if (fresh.length) fetchCodes(fresh);
}

async function fetchCodes(desks) {
  if (!runner.gen) return;
  const byLab = new Map();
  for (const d of desks) {
    if (d.cube < 0) continue;
    const lab = Math.floor(d.cube / PER_LAB);
    if (!byLab.has(lab)) byLab.set(lab, []);
    byLab.get(lab).push(d);
  }
  await Promise.all([...byLab].map(async ([lab, ds]) => {
    const r = await runner.codes(lab, ds.map((d) => d.cube % PER_LAB)).catch(() => null);
    if (!r) return;
    for (const item of r.list) {
      const d = ds.find((x) => x.cube % PER_LAB === item.fly);
      if (d) d.setCode({ ...item, label: `Lab ${lab + 1} · fly ${item.fly + 1}` }, genStart, genDuration);
    }
  }));
}
function refreshNearCodes() { fetchCodes(near.filter((d) => d.cube >= 0)); }

// ---------------------------------------------------------------- the winner
function startParty(best) {
  const name = `fly ${best.fly + 1} in lab ${best.lab + 1}`;
  banner = `Generation ${runner.gen}: ${name} typed a perfect döner! Follow the path on the floor.`;
  setSpeed('1');
  party.start(best.lab, best.fly, `FLY ${best.fly + 1} · LAB ${best.lab + 1} · 8/8`);
  party.desk.setCode({ tokens: best.tokens, score: best.score, passed: best.passed, label: `Lab ${best.lab + 1} · fly ${best.fly + 1} · PERFECT` }, performance.now(), 0);
  hud.toast(`Generation ${runner.gen}: ${name} typed a döner app that passes all 8 tests!`, 8);
  hud.toast('Speed is back to 1×. Follow the arrows on the floor to the winner.', 8);
  fetch(`/ping?solved=${runner.gen}`).catch(() => {});
  assignNear();
}

async function giveSugar() {
  const from = camera.position.clone().add(player.forward.multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.25, 0));
  const { lab, fly } = party;
  if (!(await party.giveSugar(from))) return;
  const r = await runner.reward(lab, fly, 0.5).catch(() => null);
  hud.toast(`Sugar! Dopamine strengthened all ${r ? r.choices : ''} choices in fly ${fly + 1}'s winning program.`, 7);
}

async function offerContract() {
  const from = camera.position.clone().add(player.forward.multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.2, 0));
  const { lab, fly, i } = party;
  const res = await party.offerContract(from);
  if (!res) return null;
  party.away = [i];
  hud.toast(`Fly ${fly + 1} signed! Off to the management office…`, 5);
  res.landed.then(async () => {
    office.nameplate(res.seat, `Fly ${fly + 1} · Lab ${lab + 1}`);
    const n = await runner.promote(lab, fly, 8).catch(() => 0);
    await runner.rehire(lab, fly).catch(() => {});
    party.away = [];
    banner = `Fly ${fly + 1} (lab ${lab + 1}) is now Head of Döner. Its memory now trains ${n} flies in all 8 teams.`;
    screenDirty = true;
    hud.toast(`Fly ${fly + 1} is now Head of Döner. Its memory was copied into ${n} flies across all 8 teams.`, 8);
    hud.toast('A new intern takes the empty desk.', 6);
    assignNear();
  });
  return res;
}

// ---------------------------------------------------------------- pointing and clicking
const ray = new THREE.Raycaster();
let aimed = null;
function aim() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  ray.far = 6;
  const targets = [...supervisor.targets, ...party.targets.filter((o) => o.visible)];
  const hit = ray.intersectObjects(targets, false)[0];
  aimed = hit ? hit.object : null;
  let label = '';
  if (aimed && aimed.userData.button) {
    const b = BUTTONS.find((x) => x.id === aimed.userData.button);
    label = { pause: 'click: pause', 1: 'click: 1× speed', 4: 'click: 4× speed', max: 'click: full speed', reset: 'click: replace all flies', rec: recorder.active ? 'click: stop recording' : 'click: start recording' }[b.id];
  } else if (aimed && aimed.userData.reward) label = aimed.userData.reward === 'sugar' ? 'click: give the sugar cube' : 'click: offer the management contract';
  hud.set({ target: label });
  const close = party.active && party.distance(player.x, player.z) < 6;
  hud.set({ prompt: close ? `${party.gotSugar ? '' : '1 · give a sugar cube'}${!party.gotSugar && !party.gotContract ? '     ' : ''}${party.gotContract ? '' : '2 · offer a management contract'}` : '' });
}

function pressButton(id) {
  supervisor.press(id);
  if (id === 'rec') toggleRecording();
  else if (id === 'reset') {
    if (performance.now() - resetArmed < 3000) { resetArmed = 0; newFlies(); }
    else { resetArmed = performance.now(); hud.toast('Press NEW FLIES again to replace all 1,024 flies.', 3); }
  } else setSpeed(id);
}

canvas.addEventListener('mousedown', () => {
  if (player.autopilot) return;
  if (!player.locked) { player.lock(); return; }
  if (!aimed) return;
  if (aimed.userData.button) pressButton(aimed.userData.button);
  else if (aimed.userData.reward === 'sugar') giveSugar();
  else if (aimed.userData.reward === 'contract') offerContract();
});
addEventListener('keydown', (e) => {
  if (player.autopilot || $('splash').style.display !== 'none') return;
  if (e.code === 'KeyR') toggleRecording();
  if (e.code === 'KeyH') hud.set({ help: hud.state.help ? '' : HELP });
  const close = party.active && party.distance(player.x, player.z) < 6;
  if (e.code === 'Digit1' && close) giveSugar();
  if (e.code === 'Digit2' && close) offerContract();
});

async function toggleRecording() {
  if (recorder.active) {
    const r = await recorder.stop();
    supervisor.setActive([speed]);
    hud.set({ rec: false });
    if (r) hud.toast(`Saved ${Math.round(r.seconds)} s of video: ${r.where}`, 8);
  } else {
    recorder.start();
    supervisor.setActive([speed, 'rec']);
    hud.set({ rec: true });
    hud.toast('Recording. Press REC (or R) again to stop.', 4);
  }
  screenDirty = true;
}

// ---------------------------------------------------------------- autopilot (for unattended demo videos)
const tweens = [];
function tween(seconds, fn) { return new Promise((resolve) => tweens.push({ t0: performance.now(), dur: seconds * 1000, fn, resolve })); }
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const lerpAngle = (a, b, k) => a + (((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
function aimAt(x, y, z) {
  const dx = x - player.x, dy = y - player.y, dz = z - player.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}
function glide(to, seconds, look = null) {
  const from = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch };
  return tween(seconds, (k) => {
    const e = ease(k);
    player.x = from.x + (to.x - from.x) * e; player.y = from.y + (to.y - from.y) * e; player.z = from.z + (to.z - from.z) * e;
    const a = look ? aimAt(...look) : to;
    player.yaw = lerpAngle(from.yaw, a.yaw, Math.min(1, e * 1.6)); player.pitch = from.pitch + (a.pitch - from.pitch) * Math.min(1, e * 1.6);
  });
}
function caption(text) { hud.set({ caption: text }); }
function buttonPos(id) { return supervisor.buttons.get(id).cap.getWorldPosition(new THREE.Vector3()); }

async function autopilot() {
  player.autopilot = true;
  hud.set({ help: '', crosshair: false });
  caption('Cubicles: 1,024 fruit fly brains at 1,024 desks, learning to type a döner app');
  await sleep(4000);
  const mx = buttonPos('max');
  await glide({ x: player.x, y: player.y, z: player.z, ...aimAt(mx.x, mx.y, mx.z) }, 1.4);
  caption('The supervisor presses MAX');
  await sleep(500);
  pressButton('max');
  await sleep(1300);
  // fly over the office while the flies train
  const legs = [
    [{ x: 0, y: 4.6, z: 1 }, 4, [0, 1, -25], 'Each fly has its own copy of the real learning centre from the FlyWire map'],
    [{ x: 0, y: 2.6, z: -22 }, 9, [0, 1.2, -45], 'Every screen shows the döner shop its fly is typing right now'],
    [{ x: -42, y: 2.0, z: teamOrigin(0).z + AISLE + 2 * CUB + AISLE / 2 - 0.05 }, 7, [55, 1.2, -10.8], 'Up close, every fly really types: one token at a time'],
    [{ x: 42, y: 2.0, z: teamOrigin(0).z + AISLE + 2 * CUB + AISLE / 2 - 0.05 }, 14, [57, 1.2, -10.8], 'Sugar for the best of its 4 programs per round, bitter for the worst'],
    [{ x: 28.5, y: 4.8, z: -30 }, 6, [0, 0, -15], 'Eight labs, 128 flies each, swapping their best fly every 2 rounds'],
    [{ x: -28.5, y: 4.8, z: -12 }, 10, [0, 0, -25], null],
    [{ x: 0, y: 4.6, z: 1.5 }, 7, [0, 0.5, -22], null],
  ];
  let k = 0;
  while (!party.active) {
    const [to, sec, look, cap] = legs[k % legs.length];
    if (cap) caption(cap);
    if (k >= legs.length) caption('Still looking for the first perfect döner…');
    let watch;
    await Promise.race([glide(to, sec, look), new Promise((r) => { watch = setInterval(() => { if (party.active) r(); }, 100); })]);
    clearInterval(watch);
    tweens.length = 0;
    k++;
  }
  // the winner!
  caption(`Generation ${runner.gen}: fly ${party.fly + 1} in lab ${party.lab + 1} wrote a perfect döner. Speed drops to 1×`);
  await glide({ x: 0, y: 4.8, z: 1.5 }, 3, [party.c.x, 1.5, party.c.z]);
  await sleep(2500);
  caption('A path on the floor leads to the winner');
  await glide({ x: 0, y: EYE, z: -0.3 }, 2.5, [party.c.x, 1.0, party.c.z]);
  player.x = 0; player.z = -0.3;
  const path = pathFrom(grid, party.field, { x: 0, z: -0.3 });
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    const end = i === path.length - 1;
    await glide({ x: b.x, y: floorHeight(b.x, b.z) + EYE, z: b.z, ...aimAt(b.x, EYE, b.z) }, Math.max(0.6, len / 7), end ? [party.c.x, 1.0, party.c.z] : [b.x + (b.x - a.x), EYE - 0.3, b.z + (b.z - a.z)]);
  }
  const h = party.headPosition(new THREE.Vector3());
  await glide({ x: player.x, y: EYE, z: player.z }, 1, [h.x, h.y, h.z]);
  caption(`Fly ${party.fly + 1} is dancing`);
  await sleep(4000);
  caption('A sugar cube: real dopamine for every choice in its winning program');
  await giveSugar();
  await sleep(4500);
  caption('…and a contract for a new position in management');
  const res = await offerContract();
  if (res) {
    // travel towards the management office together with the flying fly, always looking at it
    const desk = new THREE.Vector3(res.seat.pos.x, 1.0, 8.75);
    const from = { x: player.x, y: player.y, z: player.z }, to = { x: 43.75, y: 2.4, z: 0.6 };
    const dur = (party.flying ? party.flying.dur : 4) * 1000 + 600, t0 = performance.now();
    for (let now = t0; now - t0 < dur; now = performance.now()) {
      const k = ease(Math.min(1, (now - t0) / dur));
      player.x = from.x + (to.x - from.x) * k; player.y = from.y + (to.y - from.y) * k; player.z = from.z + (to.z - from.z) * k;
      const f = party.flying ? party.flying.fly.root.position : desk;
      const a = aimAt(f.x, f.y, f.z);
      player.yaw = lerpAngle(player.yaw, a.yaw, 0.12); player.pitch += (a.pitch - player.pitch) * 0.12;
      await sleep(16);
    }
    await glide({ x: 43.75, y: 1.75, z: 5.2 }, 3, [desk.x, desk.y, desk.z]);
    caption(`Fly ${party.fly + 1}, Head of Döner. Its memory now trains flies in all 8 teams`);
    await sleep(7000);
  }
  caption('');
  if (recorder.active) await toggleRecording();
  document.title = 'Cubicles (done)';
  fetch(`/ping?done=${runner.gen}`).catch(() => {});
}

// ---------------------------------------------------------------- every frame
const HELP = 'WASD walk · Shift run · mouse look · click the buttons · R record · H hide this';
const clock = new THREE.Clock();
let frames = 0, fpsAt = 0, fps = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), now = performance.now(), t = now / 1000;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i], k = Math.min(1, (now - tw.t0) / tw.dur);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }
  player.update(dt);
  if (now - nearAt > 250) { nearAt = now; assignNear(); }
  const pace = speed === 'pause' ? 0.1 : speed === '1' ? 0.4 : 1;
  workers.update(t, pace);
  for (const d of near) {
    if (d.cube < 0) continue;
    const lab = Math.floor(d.cube / PER_LAB);
    d.update(dt, now, last ? { data: last.results[lab].summary, fly: d.cube % PER_LAB } : null);
  }
  party.update(dt, now, { x: player.x, z: player.z });
  party.idle(dt);
  supervisor.update(dt, t);
  if (atlasDirty && now - atlasAt > 300 && last) { atlasDirty = false; atlasAt = now; office.drawAtlas(last.results, t); }
  if (screenDirty && now - screenAt > 300) { screenDirty = false; screenAt = now; drawScreen(); }
  if (last && now - signsAt > 1000) { signsAt = now; for (let lab = 0; lab < LABS; lab++) office.drawSign(lab, runner.labStats[lab]); }
  aim();
  if (!player.autopilot && hud.state.help && player.moved > 40) hud.set({ help: '' });
  frames++;
  if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; window.__cubicles.fps = fps; }
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  hud.render(renderer, now);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
window.__cubicles = { runner, party, player, get speed() { return speed; }, fps: 0, setSpeed, newFlies, offerContract, giveSugar };
office.drawAtlas([], 0);
drawScreen();
requestAnimationFrame(frame);

async function enter() {
  $('splash').style.display = 'none';
  const autostart = $('opt-start').checked, record = $('opt-record').checked;
  if (!AUTOPILOT) { player.lock(); hud.set({ help: HELP }); }
  hud.toast('Welcome to the Cubicles. The big screen shows the live training; the buttons are on the console.', 7);
  if (record) toggleRecording();
  if (autostart && !AUTOPILOT) setSpeed('max');
  if (AUTOPILOT) autopilot();
}

// ?cam=x,z,yaw,pitch[,height]: put the camera somewhere (for screenshots); with a height it hovers there
if (P.has('cam')) {
  const [x, z, yaw, pitch, y] = P.get('cam').split(',').map(Number);
  player.setPose(x, z, yaw, pitch || 0);
  if (Number.isFinite(y)) { player.y = y; player.autopilot = true; }
}
$('opt-start').checked = P.has('autostart') || AUTOPILOT;
$('opt-record').checked = P.has('record');
$('splash-status').textContent = 'Hiring 1,024 flies…';
runner.init(PER_LAB).then(() => {
  $('splash-status').textContent = '';
  $('enter').disabled = false;
  updateStatus();
  if (AUTOPILOT || P.has('go')) enter();
}).catch((err) => { $('splash-status').textContent = `Could not start: ${err.message}`; console.error(err); });
$('enter').addEventListener('click', enter);
