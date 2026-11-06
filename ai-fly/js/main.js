import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFly } from './fly.js';
import { createWorld, ARENA_RADIUS } from './world.js';
import { BrainView, loadNeurons } from './brain-view.js';

// ---------------------------------------------------------------- setup
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.5;
controls.maxDistance = 220;
controls.maxPolarAngle = 1.48;

const world = createWorld(scene);
const fly = createFly();
scene.add(fly.root);

const $ = (id) => document.getElementById(id);
const ui = {
  behaviour: $('behaviour'), dot: $('state-dot'), toast: $('toast'), brainFrame: $('brain-frame'),
  speed: $('st-speed'), spikes: $('st-spikes'), active: $('st-active'), time: $('st-time'),
};

// ---------------------------------------------------------------- fly state
const S = {
  pos: new THREE.Vector3(-4, 0, 4),
  heading: 0.4,
  y: 0,
  mode: 'idle',          // idle | walk | back | feed | groom | flight | stunned
  speed: 0, turn: 0,
  wander: 0,
  hunger: 1,
  groomHold: 0,
  flight: null,
  escapeCooldown: 0,
  stunned: 0,
  onFood: null,
  tasteKind: null,
};
const rates = { steer_L: 0, steer_R: 0, groom: 0, MN9: 0, DNp01: 0, MDN: 0 };
const senses = { objects_L: 0, objects_R: 0, loom_L: 0, loom_R: 0, sugar: 0, bitter: 0, antenna_touch_L: 0, antenna_touch_R: 0 };
const lesions = { DNp01: false, MN9: false, objects_L: false };
let brainReady = false;
let brainView = null;

const fwd = new THREE.Vector3(), left = new THREE.Vector3();
function updateAxes() {
  fwd.set(Math.cos(S.heading), 0, -Math.sin(S.heading));
  left.set(-Math.sin(S.heading), 0, -Math.cos(S.heading));
}
function headPos(out = new THREE.Vector3()) {
  return out.copy(S.pos).addScaledVector(fwd, 0.95).setY(S.y + 0.75);
}
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- brain worker
const worker = new Worker(new URL('./brain-worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') {
    const mb = (x) => (x / 1048576).toFixed(0);
    $('load-fill').style.width = `${m.total ? (100 * m.loaded / m.total) : 50}%`;
    $('load-text').textContent = `Loading the brain wiring: ${mb(m.loaded)} of ${mb(m.total || 61e6)} MB`;
  } else if (m.type === 'ready') {
    brainReady = true;
    $('load-text').textContent = 'Brain loaded. Waking the fly up…';
    setTimeout(() => $('loading').classList.add('gone'), 400);
    setTimeout(() => ($('loading').style.display = 'none'), 1100);
    S.mode = 'walk';
    toast('The fly is awake. Its brain is running live.');
  } else if (m.type === 'state') {
    Object.assign(rates, m.rates);
    if (brainView) brainView.spikes(m.spikes);
    ui.speed.textContent = `${m.speed.toFixed(2)}×`;
    ui.spikes.textContent = Math.round(m.spikesPerSec).toLocaleString();
    ui.active.textContent = m.active.toLocaleString();
    ui.time.textContent = `${(m.t / 1000).toFixed(1)} s`;
  } else if (m.type === 'error') {
    $('load-text').textContent = `Something went wrong: ${m.message}`;
    $('loading').classList.add('error');
  }
};
worker.postMessage({ type: 'init' });

loadNeurons(new URL('../data/neurons.bin', import.meta.url)).then((d) => { brainView = new BrainView(d); })
  .catch((err) => console.error(err));

// ---------------------------------------------------------------- toast
let toastTimer = 0;
function toast(msg, kind = '') {
  ui.toast.textContent = msg;
  ui.toast.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.className = ''), 3200);
}

// ---------------------------------------------------------------- actions
const swat = { active: false, t: 0, dur: 1.15, center: new THREE.Vector3(), lastAlpha: 0, impactDone: false, height: 80 };
function doSwat() {
  if (swat.active || !brainReady) return;
  updateAxes();
  const side = Math.random() < 0.5 ? -1 : 1;
  swat.center.copy(S.pos).addScaledVector(left, side * (2 + Math.random() * 5)).addScaledVector(fwd, (Math.random() - 0.5) * 6);
  swat.center.y = 0;
  swat.active = true; swat.t = 0; swat.impactDone = false; swat.lastAlpha = null; swat.surface = S.y;
  world.swatter.visible = true;
  // point the handle away from the camera so it doesn't block the view
  world.swatter.rotation.y = Math.atan2(-(camera.position.z - S.pos.z), camera.position.x - S.pos.x) + (Math.random() - 0.5) * 0.8;
  toast('Incoming swatter…');
}

let puffT = 0;
const puffParticles = [];
const puffGroup = new THREE.Group();
scene.add(puffGroup);
const puffMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
function doPuff() {
  if (!brainReady) return;
  puffT = 1.4;
  updateAxes();
  const h = headPos();
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(puffMat.clone());
    const start = h.clone().addScaledVector(fwd, 4 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5));
    sp.position.copy(start);
    sp.scale.setScalar(0.3 + Math.random() * 0.4);
    sp.userData = { v: h.clone().sub(start).multiplyScalar(0.9 + Math.random() * 0.6), life: 0.9 + Math.random() * 0.5, age: -Math.random() * 0.4 };
    puffGroup.add(sp);
    puffParticles.push(sp);
  }
  toast('Puff of air on the antennae');
}

function dropAt(x, z, kind) {
  const r = Math.hypot(x, z);
  if (r > ARENA_RADIUS - 3) { x *= (ARENA_RADIUS - 3) / r; z *= (ARENA_RADIUS - 3) / r; }
  const f = world.addDrop(x, z, kind);
  f.mesh.scale.multiplyScalar(0.01);
  f.grow = 0;
  return f;
}
function dropAhead(kind) {
  updateAxes();
  const a = S.heading + (Math.random() - 0.5) * 1.2, d = 9 + Math.random() * 12;
  dropAt(S.pos.x + Math.cos(a) * d, S.pos.z - Math.sin(a) * d, kind);
  toast(kind === 'sugar' ? 'Sugar drop placed' : 'Bitter drop placed');
}

let follow = true;
function toggleFollow() {
  follow = !follow;
  document.querySelector('[data-act="camera"]').classList.toggle('on', follow);
  toast(follow ? 'Camera follows the fly' : 'Free camera');
}

function setLesion(group, on) {
  lesions[group] = on;
  worker.postMessage({ type: 'silence', group, on });
  const names = { DNp01: 'escape neurons (DNp01)', MN9: 'feeding motor neurons (MN9)', objects_L: 'left-eye object neurons (LC10a)' };
  toast(`${on ? 'Silenced' : 'Restored'} the ${names[group]}`, on ? 'warn' : '');
}

const actions = {
  swat: doSwat, puff: doPuff, sugar: () => dropAhead('sugar'), bitter: () => dropAhead('bitter'),
  camera: toggleFollow, lab: () => $('lab').classList.toggle('hidden'), info: () => $('info').classList.toggle('hidden'),
  hud: () => document.body.classList.toggle('no-hud'),
};
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));
document.querySelectorAll('[data-lesion]').forEach((cb) => cb.addEventListener('change', () => setLesion(cb.dataset.lesion, cb.checked)));
$('info-close').addEventListener('click', () => $('info').classList.add('hidden'));
$('lab-close').addEventListener('click', () => $('lab').classList.add('hidden'));
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  const map = { s: 'swat', a: 'puff', f: 'sugar', b: 'bitter', c: 'camera', l: 'lab', i: 'info', h: 'hud' };
  if (map[k]) actions[map[k]]();
  if (k === 'escape') { $('info').classList.add('hidden'); $('lab').classList.add('hidden'); }
});

// click on the cloth to place sugar (shift: bitter); click on the fly to puff air
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 350;
  downAt = null;
  if (moved > 6 || !quick) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hitFly = raycaster.intersectObject(fly.root, true);
  const hitGround = raycaster.intersectObjects([world.cloth, world.table], false);
  if (hitFly.length && (!hitGround.length || hitFly[0].distance <= hitGround[0].distance + 0.5)) { doPuff(); return; }
  if (hitGround.length) {
    const p = hitGround[0].point;
    dropAt(p.x, p.z, e.shiftKey ? 'bitter' : 'sugar');
    toast(e.shiftKey ? 'Bitter drop placed' : 'Sugar drop placed');
  }
});

// ---------------------------------------------------------------- senses: world -> sensory neurons
const tmpV = new THREE.Vector3();
function computeSenses(dt) {
  updateAxes();
  const h = headPos(tmpV);
  let eyeL = 0, eyeR = 0;
  const flying = S.mode === 'flight';
  S.onFood = null;
  for (const f of world.foods) {
    const dx = f.pos.x - h.x, dz = f.pos.z - h.z;
    const d = Math.hypot(dx, dz);
    const r = f.radius * (Number.isFinite(f.amount) ? Math.max(0.05, f.amount) ** 0.33 : 1);
    if (!flying && d < r + 0.35 && Math.abs(S.y - f.height) < 0.6) S.onFood = f;
    if (flying || d < r + 0.6 || d > 90) continue;           // too close (underfoot) or too far to see
    const th = Math.atan2(dx * left.x + dz * left.z, dx * fwd.x + dz * fwd.z);   // + = left
    const alphaDeg = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(r, 0.3) / d));
    const drive = alphaDeg * 3.4;
    if (th > -0.21 && th < 2.6) eyeL += drive;             // the eyes overlap ~12° in front
    if (th < 0.21 && th > -2.6) eyeR += drive;
  }
  senses.objects_L = Math.min(85, eyeL);
  senses.objects_R = Math.min(85, eyeR);

  // looming swatter
  senses.loom_L = senses.loom_R = 0;
  if (swat.active && swat.t < swat.dur) {
    const p = world.swatter.position;
    const d = Math.max(0.5, Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z));
    const alpha = THREE.MathUtils.radToDeg(2 * Math.atan(world.swatterRadius / d));
    if (swat.lastAlpha !== null) {
      const expansion = Math.max(0, (alpha - swat.lastAlpha) / Math.max(dt, 1e-3));   // degrees per second
      const th = Math.atan2((p.x - h.x) * left.x + (p.z - h.z) * left.z, (p.x - h.x) * fwd.x + (p.z - h.z) * fwd.z);
      const wl = 0.5 + 0.45 * Math.sin(th);
      const base = Math.min(200, expansion * 1.2);
      if (alpha > 25) { senses.loom_L = Math.min(200, base * 2 * wl); senses.loom_R = Math.min(200, base * 2 * (1 - wl)); }
    }
    swat.lastAlpha = alpha;
  }

  // taste (through the legs and mouthparts when standing on food)
  senses.sugar = senses.bitter = 0;
  if (S.onFood && S.mode !== 'flight') {
    if (S.onFood.kind === 'bitter') senses.bitter = 100;
    else senses.sugar = 150 * S.hunger;
  }

  // touch on the antennae
  senses.antenna_touch_L = senses.antenna_touch_R = puffT > 0 && puffT < 1.25 ? 100 : 0;
}

// ---------------------------------------------------------------- body: brain read-outs -> movement
const RIGHT_GAIN = 1.5;   // balances the model's weaker right-side steering read-out (see README)
function behave(dt) {
  updateAxes();
  const steerL = rates.steer_L, steerR = rates.steer_R * RIGHT_GAIN;
  S.escapeCooldown -= dt;

  if (S.mode === 'flight') { fly1(dt); return; }
  if (S.stunned > 0) { S.stunned -= dt; S.mode = 'stunned'; S.speed = 0; S.turn = 0; return; }

  if (rates.DNp01 > 35 && S.escapeCooldown <= 0) { startFlight(steerL, steerR); return; }

  if (rates.groom > 4) S.groomHold = 0.8;
  S.groomHold -= dt;
  if (S.groomHold > 0) { S.mode = 'groom'; S.speed = 0; S.turn = 0; return; }

  if (S.onFood && rates.MN9 > 18 && S.onFood.kind !== 'bitter') {
    S.mode = 'feed'; S.speed = 0; S.turn = 0;
    S.hunger = Math.max(0.12, S.hunger - dt * 0.07);
    if (Number.isFinite(S.onFood.amount)) {
      S.onFood.amount -= dt * 0.12;
      if (S.onFood.amount <= 0.05) { world.removeFood(S.onFood); S.onFood = null; toast('Drop finished'); }
    }
    return;
  }

  S.hunger = Math.min(1, S.hunger + dt * 0.018);
  // engineered exploration: slow random turning when nothing is in view
  S.wander += (-S.wander * 0.7 + (Math.random() - 0.5) * 7) * dt;
  const seeing = steerL + steerR > 4;
  let turn = 0.045 * (steerL - steerR) + S.wander * (seeing ? 0.25 : 1);
  let speed = Math.min(15, 4.5 + 0.06 * (steerL + steerR));
  if (rates.MDN > 8) { speed = -2.5 - Math.min(6, rates.MDN * 0.12); S.mode = 'back'; } else S.mode = 'walk';

  // engineered: stay on the cloth
  const r = Math.hypot(S.pos.x, S.pos.z);
  if (r > ARENA_RADIUS - 8) {
    const toCentre = Math.atan2(S.pos.z, -S.pos.x) ;
    turn += 3 * wrapAngle(toCentre - S.heading) * Math.min(1, (r - (ARENA_RADIUS - 8)) / 6);
  }
  S.turn = THREE.MathUtils.clamp(turn, -4, 4);
  S.speed += (speed - S.speed) * Math.min(1, dt * 5);
  S.heading = wrapAngle(S.heading + S.turn * dt);
  updateAxes();
  S.pos.addScaledVector(fwd, S.speed * dt);
  const rr = Math.hypot(S.pos.x, S.pos.z);
  if (rr > ARENA_RADIUS) S.pos.multiplyScalar(ARENA_RADIUS / rr);
}

function startFlight(steerL, steerR) {
  const turn = THREE.MathUtils.clamp(0.035 * (steerL - steerR), -1.3, 1.3);
  const heading = S.heading + turn;
  const dist = 22 + Math.random() * 12;
  const to = new THREE.Vector3(S.pos.x + Math.cos(heading) * dist, 0, S.pos.z - Math.sin(heading) * dist);
  const r = Math.hypot(to.x, to.z);
  if (r > ARENA_RADIUS - 10) to.multiplyScalar((ARENA_RADIUS - 10) / r);
  const finalHeading = Math.atan2(-(to.z - S.pos.z), to.x - S.pos.x);
  S.flight = { t: 0, dur: 1.35, from: S.pos.clone(), to, h0: S.heading, h1: finalHeading, y0: S.y };
  S.mode = 'flight';
  toast('Escape! The giant fibre neuron (DNp01) fired', 'good');
}

function fly1(dt) {
  const F = S.flight;
  F.t += dt;
  const u = Math.min(1, F.t / F.dur);
  const e = u * u * (3 - 2 * u);
  S.pos.lerpVectors(F.from, F.to, e);
  S.y = F.y0 * (1 - u) + Math.sin(Math.PI * u) * 11;
  S.heading = F.h0 + wrapAngle(F.h1 - F.h0) * Math.min(1, u * 3);
  S.speed = 0; S.turn = 0;
  if (u >= 1) { S.mode = 'walk'; S.y = 0; S.escapeCooldown = 1.2; S.flight = null; }
}

// ---------------------------------------------------------------- per-frame updates
function updateSwatter(dt) {
  if (!swat.active) return;
  swat.t += dt;
  const sw = world.swatter;
  const stopHeight = (swat.surface ?? 0) + 3.2;   // stop just above the fly (it's a gentle swatter)
  if (swat.t < swat.dur) {
    const u = swat.t / swat.dur;
    sw.position.set(swat.center.x, stopHeight + (swat.height - stopHeight) * (1 - u * u * u), swat.center.z);
  } else {
    if (!swat.impactDone) {
      swat.impactDone = true;
      shake = 0.5;
      const near = Math.hypot(S.pos.x - swat.center.x, S.pos.z - swat.center.z) < 14;
      if (S.mode === 'flight' || !near) toast(S.mode === 'flight' ? 'Missed! The fly got away' : 'Missed!', 'good');
      else { S.stunned = 1.8; toast(lesions.DNp01 ? 'No escape: its escape neurons are silenced' : 'Too slow this time', 'warn'); }
    }
    const u = (swat.t - swat.dur) / 0.7;
    sw.position.y = stopHeight + u * u * swat.height;
    if (u >= 1) { swat.active = false; sw.visible = false; }
  }
}

function updateFoods(dt) {
  for (const f of world.foods) {
    if (f.kind === 'banana') continue;
    if (f.grow !== undefined && f.grow < 1) f.grow = Math.min(1, f.grow + dt * 4);
    const g = f.grow === undefined ? 1 : f.grow;
    const s = f.radius * Math.max(0.05, f.amount) ** 0.33 * (0.2 + 0.8 * g);
    f.mesh.scale.set(s, s * 0.55, s);
  }
}

function updatePuff(dt) {
  puffT = Math.max(0, puffT - dt);
  for (let i = puffParticles.length - 1; i >= 0; i--) {
    const p = puffParticles[i];
    const d = p.userData;
    d.age += dt;
    if (d.age < 0) { p.visible = false; continue; }
    p.visible = true;
    p.position.addScaledVector(d.v, dt);
    p.material.opacity = 0.55 * (1 - d.age / d.life);
    p.scale.multiplyScalar(1 + dt * 1.5);
    if (d.age > d.life) { puffGroup.remove(p); puffParticles.splice(i, 1); }
  }
}

let shake = 0;
const camOffset = new THREE.Vector3(-9, 6, 9);
camera.position.copy(S.pos).add(camOffset);
controls.target.copy(S.pos);
const lastTarget = controls.target.clone();

function updateCamera(dt) {
  if (follow) {
    const goal = tmpV.copy(S.pos).setY(S.y + 0.6);
    const before = controls.target.clone();
    controls.target.lerp(goal, Math.min(1, dt * 4));
    camera.position.add(controls.target.clone().sub(before));
  }
  controls.update();
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.4);
    camera.position.x += (Math.random() - 0.5) * shake * 0.6;
    camera.position.y += (Math.random() - 0.5) * shake * 0.6;
  }
  lastTarget.copy(controls.target);
  // keep the shadow camera on the fly
  world.sun.position.set(S.pos.x + 35, 70, S.pos.z + 25);
  world.sun.target.position.copy(S.pos);
}

// ---------------------------------------------------------------- HUD bars
const bars = {};
document.querySelectorAll('[data-bar]').forEach((el) => { bars[el.dataset.bar] = { fill: el.querySelector('i'), val: el.querySelector('b'), max: +el.dataset.max }; });
function setBar(key, v) {
  const b = bars[key];
  if (!b) return;
  b.fill.style.width = `${Math.min(100, (100 * v) / b.max)}%`;
  b.val.textContent = v < 0.5 ? '0' : Math.round(v);
}
const LABELS = {
  idle: 'Waking up…', walk: 'Exploring', back: 'Backing up (MDN)', feed: 'Feeding (MN9 firing)', groom: 'Grooming its antennae',
  flight: 'Escape flight!', stunned: 'Stunned',
};
function updateHud() {
  let label = LABELS[S.mode] || S.mode;
  if (S.mode === 'walk' && rates.steer_L + rates.steer_R > 8) label = rates.steer_L > rates.steer_R * RIGHT_GAIN ? 'Turning left toward something' : 'Turning right toward something';
  if (S.mode === 'walk' && S.onFood?.kind === 'bitter') label = 'Tasting… bitter, no thanks';
  ui.behaviour.textContent = label;
  ui.dot.dataset.mode = S.mode;
  setBar('objects_L', senses.objects_L); setBar('objects_R', senses.objects_R);
  setBar('loom', senses.loom_L + senses.loom_R); setBar('sugar', senses.sugar); setBar('bitter', senses.bitter);
  setBar('touch', senses.antenna_touch_L);
  setBar('steer_L', rates.steer_L); setBar('steer_R', rates.steer_R); setBar('DNp01', rates.DNp01);
  setBar('MN9', rates.MN9); setBar('groom', rates.groom); setBar('MDN', rates.MDN);
  setBar('hunger', S.hunger * 100);
}

// ---------------------------------------------------------------- loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let sendTimer = 0, hudTimer = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (brainReady) {
    computeSenses(dt);
    sendTimer += dt;
    if (sendTimer > 0.03) { sendTimer = 0; worker.postMessage({ type: 'senses', rates: senses }); }
    behave(dt);
  }
  // climbing onto the banana slice
  if (S.mode !== 'flight') {
    const b = world.banana.position;
    const onSlice = Math.hypot(S.pos.x - b.x, (S.pos.z - b.z) / 0.92) < 8 - 0.3;
    S.y += ((onSlice ? 2.4 : 0) - S.y) * Math.min(1, dt * 8);
  }
  fly.root.position.set(S.pos.x, S.y, S.pos.z);
  fly.root.rotation.y = S.heading;
  fly.update(dt, {
    speed: S.mode === 'walk' || S.mode === 'back' ? S.speed : 0,
    turn: S.turn, mode: S.mode === 'back' ? 'back' : S.mode,
    proboscis: S.mode === 'feed' ? Math.min(1, rates.MN9 / 50) : (S.onFood ? 0.25 : 0),
    antennaWiggle: puffT > 0,
  });
  updateSwatter(dt);
  updateFoods(dt);
  updatePuff(dt);
  updateCamera(dt);
  if (brainView) brainView.update(dt);
  hudTimer += dt;
  if (hudTimer > 0.06) { hudTimer = 0; updateHud(); }

  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
  if (brainView && !document.body.classList.contains('no-hud')) {
    const rect = ui.brainFrame.getBoundingClientRect();
    if (rect.width > 0) brainView.render(renderer, rect, window.innerHeight);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// let the brain view be spun by dragging
let brainDrag = null;
ui.brainFrame.addEventListener('pointerdown', (e) => { brainDrag = e.clientX; if (brainView) brainView.dragging = true; ui.brainFrame.setPointerCapture(e.pointerId); });
ui.brainFrame.addEventListener('pointermove', (e) => { if (brainDrag !== null && brainView) { brainView.angle += (e.clientX - brainDrag) * 0.006; brainDrag = e.clientX; } });
ui.brainFrame.addEventListener('pointerup', () => { brainDrag = null; if (brainView) brainView.dragging = false; });

// for debugging in the browser console
window.__fly = { S, rates, senses, world, camera, controls };
