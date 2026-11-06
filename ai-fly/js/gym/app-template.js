// Turns a fly-written program into a real, running three.js web page.
// The page only provides what every program gets: a scene, a camera, a counter to stand on, the
// `knife(mesh)` helper (three.js has no döner knife) and an animation loop that calls `spin(dt)`.
// The counter height and the way slices fly are the same numbers the customer (judge.js) uses.
import { COUNTER_TOP, SLICE } from './judge.js';

export function buildRealApp(code) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Döner – typed by a fruit fly</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#1d1712}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
</head>
<body>
<script type="module">
import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d1712);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
// add ?side to the address for a view from the side (shows what is behind the döner)
const side = new URLSearchParams(location.search).has('side');
camera.position.set(side ? 7.4 : 2.6, side ? 2.3 : 1.5, side ? 4.4 : 8.8);
camera.lookAt(0, -0.2, side ? -0.4 : 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const COUNTER_TOP = ${COUNTER_TOP}, SLICE = ${JSON.stringify(SLICE)};
const counter = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x8d9297, metalness: 0.6, roughness: 0.4 }));
counter.position.y = COUNTER_TOP - 0.15;
scene.add(counter);
scene.add(new THREE.AmbientLight(0xffffff, 0.06));   // a faint glow so a dark shop is not fully black
const knifeTargets = [];
const knife = (mesh) => { if (!knifeTargets.includes(mesh)) knifeTargets.push(mesh); };
let spin = () => {};

// ---------------- written by the fly ----------------
${code}
// ----------------------------------------------------

// The knife cuts thin slices off the side that faces the customer. Each slice gets a small push away
// from the meat, falls, and stays on the first thing it lands on (the bread, if it is in the right place).
const slices = [];
const sliceGeo = new THREE.BoxGeometry(0.2, 0.025, 0.13);
const down = new THREE.Vector3(0, -1, 0), ray = new THREE.Raycaster();
let sliceTimer = 0;
function cut(t) {
  const p = t.geometry.parameters, g = t.geometry.type;
  const h = p.height ?? (p.radius ?? 0.5) * 2;
  const f = SLICE.from + Math.random() * (SLICE.to - SLICE.from);
  const r = g === 'CylinderGeometry' ? p.radiusBottom + (p.radiusTop - p.radiusBottom) * f
    : g === 'SphereGeometry' ? p.radius * Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)) : p.depth / 2;
  const s = new THREE.Mesh(sliceGeo, t.material);
  const y = t.position.y - h / 2 + f * h;
  if (g === 'BoxGeometry') {
    s.position.set(t.position.x + (Math.random() * 2 - 1) * SLICE.side * p.width / 2, y, t.position.z + r + 0.04);
    s.userData.v = new THREE.Vector3(0, 0, SLICE.push);
  } else {
    const a = (Math.random() * 2 - 1) * SLICE.side * r, c = Math.sqrt(Math.max(0, r * r - a * a));
    s.position.set(t.position.x + a, y, t.position.z + c + 0.04);
    s.userData.v = r ? new THREE.Vector3(SLICE.push * a / r, 0, SLICE.push * c / r) : new THREE.Vector3(0, 0, SLICE.push);
  }
  s.rotation.y = Math.random() * Math.PI;
  s.userData.slice = true;
  scene.add(s);
  slices.push(s);
}
function shave(dt) {
  sliceTimer += dt;
  if (sliceTimer > 0.12 && knifeTargets.length) {
    sliceTimer = 0;
    for (const t of knifeTargets) if (t.parent) cut(t);
  }
  const solids = scene.children.filter((o) => o.isMesh && !o.userData.slice);
  for (const s of slices) {
    const v = s.userData.v;
    if (!v) continue;   // already landed
    v.y -= SLICE.gravity * dt;
    const step = -v.y * dt;
    ray.set(s.position, down);
    ray.far = step + 0.02;
    const hit = ray.intersectObjects(solids, false)[0];
    if (hit) {
      s.position.set(s.position.x, hit.point.y + 0.013 + Math.random() * 0.01, s.position.z);
      s.rotation.x = s.rotation.z = 0;
      s.userData.v = null;
      continue;
    }
    s.position.addScaledVector(v, dt);
    s.rotation.x += dt * 4;
    if (s.position.y < COUNTER_TOP - 3) s.userData.v = null;
  }
  while (slices.length > 160) scene.remove(slices.shift());
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  spin(dt);
  shave(dt);
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
</script>
</body>
</html>
`;
}
