// Turns a fly-written program into a real, running three.js web page.
// The page only provides what every program gets: a scene, a camera, a counter to stand on, the
// `knife(mesh)` helper (three.js has no döner knife) and an animation loop that calls `spin(dt)`.

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
camera.position.set(2.2, 1.4, 9);
camera.lookAt(0, -0.2, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const counter = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 4.5), new THREE.MeshStandardMaterial({ color: 0x8d9297, metalness: 0.6, roughness: 0.4 }));
counter.position.y = -2.45;
scene.add(counter);
scene.add(new THREE.AmbientLight(0xffffff, 0.06));   // a faint glow so a dark shop is not fully black
const knifeTargets = [];
const knife = (mesh) => knifeTargets.push(mesh);
let spin = () => {};

// ---------------- written by the fly ----------------
${code}
// ----------------------------------------------------

const slices = [];
const sliceGeo = new THREE.BoxGeometry(0.18, 0.03, 0.12);
let sliceTimer = 0;
function shave(dt) {
  sliceTimer += dt;
  if (sliceTimer > 0.14 && knifeTargets.length) {
    sliceTimer = 0;
    for (const t of knifeTargets) {
      if (!t.parent) continue;
      const p = t.geometry.parameters;
      const h = p.height ?? (p.radius ?? 1) * 2;
      const r = Math.max(p.radiusTop ?? 0, p.radiusBottom ?? 0, p.radius ?? 0, (p.width ?? 0) / 2, (p.depth ?? 0) / 2);
      const s = new THREE.Mesh(sliceGeo, t.material);
      s.position.set(t.position.x + (Math.random() - 0.5) * 0.4, t.position.y + (Math.random() - 0.3) * h * 0.6, t.position.z + r + 0.05);
      s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.2, 0.25);
      scene.add(s);
      slices.push(s);
    }
  }
  for (const s of slices) {
    s.userData.v.y -= 4 * dt;
    s.position.addScaledVector(s.userData.v, dt);
    s.rotation.x += dt * 3;
    if (s.position.y < -2.28) { s.position.y = -2.28; s.userData.v.set(0, 0, 0); }
  }
  while (slices.length > 80) scene.remove(slices.shift());
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
