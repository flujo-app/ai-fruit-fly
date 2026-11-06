// Turns a fly-written program into a real, running three.js web page.
// The page only provides what every program gets: a scene, a camera, the shop (a counter to stand on
// and the `knife(mesh)` helper, see shop.js) and an animation loop that calls `spin(dt)`.
// The counter height and the way slices fly are the same numbers the customer (judge.js) uses.
import { COUNTER_TOP, SLICE } from './judge.js';
import { doenerShop } from './shop.js';

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
// the counter, the knife and the falling slices (js/gym/shop.js, copied in so this page works on its own)
const shop = (${doenerShop})(THREE, scene, COUNTER_TOP, SLICE);
const knife = shop.knife;
let spin = () => {};

// ---------------- written by the fly ----------------
${code}
// ----------------------------------------------------

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  spin(dt);
  shop.update(dt);
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
