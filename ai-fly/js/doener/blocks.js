// The code blocks the fly can choose from, the app template they slot into, and the customer's
// tests. Each slot has one block that works and several that don't (some of them funny).
// The tests look only at the running app, never at which block was picked.

export const TEMPLATE_HEAD = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Döner – coded by a fruit fly</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#20160f}canvas{display:block}</style>
<script>addEventListener('error', (e) => { window.doenerError = String(e.message || e); });</script>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
</head>
<body>
<script type="module">
import * as THREE from 'three';

// Rotating döner, written one block at a time by a fruit fly's learning centre.
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a1d14);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.2, 6.4);
camera.lookAt(0, 1.4, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 3.4), new THREE.MeshStandardMaterial({ color: 0x8d9297, metalness: 0.7, roughness: 0.35 }));
counter.position.y = -0.1;
scene.add(counter);
const doener = (window.doener = {});
let spin = () => {};
let shave = () => {};
`;

export const TEMPLATE_TAIL = `
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

export const SLOTS = [
  {
    id: 'light', title: 'Lighting', test: 'The shop is lit warmly and steadily',
    options: [
      { id: 'warm', label: 'Warm shop lights', code: `// lighting: warm shop lights
const sky = new THREE.HemisphereLight(0xfff1dd, 0x3a2a20, 1.6);
const lamp = new THREE.DirectionalLight(0xffe2b8, 2.2);
lamp.position.set(3, 5, 4);
scene.add(sky, lamp);
doener.lights = [sky, lamp];` },
      { id: 'off', label: 'Lights off', code: `// lighting: off, to save electricity` },
      { id: 'disco', label: 'Disco', code: `// lighting: disco mode
const disco = new THREE.PointLight(0xff00ff, 40, 12);
disco.position.set(0, 4, 2);
const haze = new THREE.AmbientLight(0x330066, 0.6);
scene.add(disco, haze);
setInterval(() => disco.color.setHSL(Math.random(), 1, 0.5), 120);
doener.lights = [disco, haze];` },
      { id: 'candle', label: 'One candle', code: `// lighting: romantic candle
const candle = new THREE.PointLight(0xffb060, 0.4, 3);
candle.position.set(1.5, 0.3, 1);
scene.add(candle);
doener.lights = [candle];` },
    ],
  },
  {
    id: 'colour', title: 'Meat colour', test: 'The meat looks grilled (brown)',
    options: [
      { id: 'grilled', label: 'Grilled brown, in layers', code: `// meat colour: grilled brown, stacked in layers
const layers = document.createElement('canvas');
layers.width = 64;
layers.height = 256;
const lg = layers.getContext('2d');
for (let y = 0; y < 256; y += 4) {
  lg.fillStyle = \`hsl(\${18 + Math.random() * 10}, \${50 + Math.random() * 20}%, \${26 + Math.random() * 22}%)\`;
  lg.fillRect(0, y, 64, 4);
}
const meatTexture = new THREE.CanvasTexture(layers);
meatTexture.colorSpace = THREE.SRGBColorSpace;
const meatMat = new THREE.MeshStandardMaterial({ color: 0xa8663a, map: meatTexture, roughness: 0.8 });` },
      { id: 'blue', label: 'Blue', code: `// meat colour: blue (it was on sale)
const meatMat = new THREE.MeshStandardMaterial({ color: 0x2f6bff, roughness: 0.5 });` },
      { id: 'raw', label: 'Raw pink', code: `// meat colour: raw
const meatMat = new THREE.MeshStandardMaterial({ color: 0xf2a3b3, roughness: 0.4 });` },
      { id: 'rainbow', label: 'Rainbow', code: `// meat colour: every colour at once
const meatMat = new THREE.MeshNormalMaterial();` },
    ],
  },
  {
    id: 'shape', title: 'Meat shape', test: 'It is shaped like a döner (wider at the top)',
    options: [
      { id: 'cone', label: 'Döner cone', code: `// meat shape: classic döner cone, wider at the top
const meat = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.6, 2.4, 48, 24), meatMat);
const pos = meat.geometry.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const k = 1 + 0.04 * Math.sin(pos.getY(i) * 22) + 0.02 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 7);
  pos.setX(i, pos.getX(i) * k);
  pos.setZ(i, pos.getZ(i) * k);
}
meat.geometry.computeVertexNormals();
meat.position.y = 1.6;
scene.add(meat);
doener.meat = meat;` },
      { id: 'cube', label: 'Cube', code: `// meat shape: cube (easier to stack)
const meat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), meatMat);
meat.position.y = 1.2;
scene.add(meat);
doener.meat = meat;` },
      { id: 'ball', label: 'Giant meatball', code: `// meat shape: giant meatball
const meat = new THREE.Mesh(new THREE.SphereGeometry(1.1, 40, 20), meatMat);
meat.position.y = 1.4;
scene.add(meat);
doener.meat = meat;` },
      { id: 'upside', label: 'Cone, upside down', code: `// meat shape: cone (upside down)
const meat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.0, 2.4, 48), meatMat);
meat.position.y = 1.6;
scene.add(meat);
doener.meat = meat;` },
    ],
  },
  {
    id: 'spit', title: 'Spit', test: 'A vertical spit goes through the meat',
    options: [
      { id: 'vertical', label: 'Vertical steel spit', code: `// spit: vertical steel skewer through the middle
const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 16), new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.9, roughness: 0.25 }));
spit.position.set(meat.position.x, 1.75, meat.position.z);
scene.add(spit);
doener.spit = spit;` },
      { id: 'bbq', label: 'Horizontal (BBQ style)', code: `// spit: horizontal, barbecue style
const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 16), new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.9, roughness: 0.25 }));
spit.rotation.z = Math.PI / 2;
spit.position.copy(meat.position);
scene.add(spit);
doener.spit = spit;` },
      { id: 'none', label: 'No spit', code: `// spit: who needs a spit?` },
      { id: 'beside', label: 'Spit next to the meat', code: `// spit: next to the meat (close enough)
const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 16), new THREE.MeshStandardMaterial({ color: 0xcfd4da, metalness: 0.9, roughness: 0.25 }));
spit.position.set(1.7, 1.75, 0);
scene.add(spit);
doener.spit = spit;` },
    ],
  },
  {
    id: 'heat', title: 'Heat', test: 'A hot grill glows beside the meat',
    options: [
      { id: 'grill', label: 'Vertical gas grill', code: `// heat: vertical gas grill behind the meat
const grill = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff5a14, emissiveIntensity: 1.6 }));
grill.position.set(0, 1.6, -1.25);
const glow = new THREE.PointLight(0xff7a2a, 6, 5);
glow.position.set(0, 1.6, -0.7);
scene.add(grill, glow);
doener.grill = grill;` },
      { id: 'none', label: 'No heat', code: `// heat: none (raw is healthier)` },
      { id: 'ice', label: 'Cooling unit', code: `// heat: cooling unit, to keep it fresh
const grill = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x0a2233, emissive: 0x66ccff, emissiveIntensity: 1.2 }));
grill.position.set(0, 1.6, -1.25);
scene.add(grill);
doener.grill = grill;` },
      { id: 'campfire', label: 'Campfire underneath', code: `// heat: campfire under the meat
const grill = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.6, 7), new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff6a00, emissiveIntensity: 2 }));
grill.position.set(0, 0.3, 0);
scene.add(grill);
doener.grill = grill;` },
    ],
  },
  {
    id: 'bread', title: 'Bread', test: 'Bread waits below the meat',
    options: [
      { id: 'pide', label: 'Fluffy pide', code: `// bread: fluffy pide on the counter
const bread = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8c48a, roughness: 0.9 }));
bread.scale.set(1.3, 0.35, 0.9);
bread.position.set(0.15, 0.02, 1.15);
scene.add(bread);
doener.bread = bread;` },
      { id: 'none', label: 'No bread', code: `// bread: low-carb` },
      { id: 'hat', label: 'Bread on top, as a hat', code: `// bread: on top of the meat, as a hat
const bread = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8c48a, roughness: 0.9 }));
bread.scale.set(1.3, 0.5, 1.3);
bread.position.set(0, 3.0, 0);
scene.add(bread);
doener.bread = bread;` },
      { id: 'pizza', label: 'Pizza', code: `// bread: pizza (similar, right?)
const bread = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 40), new THREE.MeshStandardMaterial({ color: 0xd23b2a, roughness: 0.7 }));
bread.position.set(0.15, 0.03, 1.15);
scene.add(bread);
doener.bread = bread;` },
    ],
  },
  {
    id: 'shave', title: 'Slicing', test: 'Thin slices fall down from the meat',
    options: [
      { id: 'knife', label: 'Knife shaves slices', code: `// slicing: a knife shaves thin slices that fall into the bread
const knife = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.95, roughness: 0.2 }));
scene.add(knife);
const slices = (doener.slices = []);
const sliceGeo = new THREE.BoxGeometry(0.18, 0.03, 0.12);
let knifeT = 0;
let sliceTimer = 0;
shave = (dt) => {
  knifeT += dt;
  const y = 1.4 + Math.sin(knifeT * 2.2) * 0.7;
  knife.position.set(0.2, y, 0.8 + (y - 0.4) * 0.1);
  sliceTimer += dt;
  if (sliceTimer > 0.12) {
    sliceTimer = 0;
    const s = new THREE.Mesh(sliceGeo, meatMat);
    s.position.set(0.1 + Math.random() * 0.2, y, 0.85);
    s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.3, 0.25);
    scene.add(s);
    slices.push(s);
  }
  for (const s of slices) {
    s.userData.v.y -= 4 * dt;
    s.position.addScaledVector(s.userData.v, dt);
    s.rotation.x += dt * 3;
    if (s.position.y < 0.12) { s.position.y = 0.12; s.userData.v.set(0, 0, 0); }
  }
  while (slices.length > 70) scene.remove(slices.shift());
};` },
      { id: 'none', label: 'No slicing', code: `// slicing: none, customers bite directly` },
      { id: 'up', label: 'Slices fly upward', code: `// slicing: anti-gravity slices
const slices = (doener.slices = []);
const sliceGeo = new THREE.BoxGeometry(0.18, 0.03, 0.12);
let sliceTimer = 0;
shave = (dt) => {
  sliceTimer += dt;
  if (sliceTimer > 0.12) {
    sliceTimer = 0;
    const s = new THREE.Mesh(sliceGeo, meatMat);
    s.position.set(0.1 + Math.random() * 0.2, 1.4, 0.85);
    s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.3, 0.25);
    scene.add(s);
    slices.push(s);
  }
  for (const s of slices) {
    s.userData.v.y += 4 * dt;
    s.position.addScaledVector(s.userData.v, dt);
  }
  while (slices.length > 70) scene.remove(slices.shift());
};` },
      { id: 'knifeonly', label: 'Knife waves, cuts nothing', code: `// slicing: the knife moves very professionally
const knife = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0xdde3ea, metalness: 0.95, roughness: 0.2 }));
scene.add(knife);
let knifeT = 0;
shave = (dt) => {
  knifeT += dt;
  knife.position.set(1.8, 1.4 + Math.sin(knifeT * 6) * 0.8, 0.8);
};` },
    ],
  },
  {
    id: 'spin', title: 'Rotation', test: 'The meat turns slowly around the vertical axis',
    options: [
      { id: 'slow', label: 'Slowly around the spit', code: `// rotation: slow and steady around the spit
spin = (dt) => {
  meat.rotation.y += dt * 0.9;
};` },
      { id: 'tumble', label: 'Tumbling', code: `// rotation: forward roll
spin = (dt) => {
  meat.rotation.x += dt * 0.9;
};` },
      { id: 'none', label: 'Not at all', code: `// rotation: none, the customer walks around it` },
      { id: 'turbo', label: 'Turbo', code: `// rotation: turbo döner
spin = (dt) => {
  meat.rotation.y += dt * 45;
};` },
    ],
  },
];

export function buildApp(choices) {
  // choices: slot id -> option id
  const body = SLOTS.map((s) => s.options.find((o) => o.id === choices[s.id]).code).join('\n\n');
  return TEMPLATE_HEAD + '\n' + body + '\n' + TEMPLATE_TAIL;
}

// ---------------------------------------------------------------- the customer's tests
const hsl = (c) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o); return o; };
const near = (a, b, d) => Math.abs(a - b) <= d;

// first look: shapes, colours and positions; second look 0.5 s later: what moved
export function snapshot(win) {
  const d = win.doener;
  if (!d) return null;
  return {
    t: win.performance.now(),
    meatRot: d.meat ? { x: d.meat.rotation.x, y: d.meat.rotation.y, z: d.meat.rotation.z } : null,
    lightColours: (d.lights || []).map((l) => l.color.getHex()),
    slicesY: (d.slices || []).map((s) => s.position.y),
  };
}

export function runTests(win, first, second) {
  const d = win.doener || {};
  const meat = d.meat;
  const res = {};
  const why = {};

  // lighting
  {
    const ls = d.lights || [];
    const total = ls.reduce((a, l) => a + l.intensity, 0);
    const steady = first.lightColours.length === second.lightColours.length && first.lightColours.every((c, i) => c === second.lightColours[i]);
    const warm = ls.length > 0 && ls.every((l) => l.color.r >= l.color.b);
    res.light = ls.length > 0 && total >= 1.5 && steady && warm;
    why.light = !ls.length ? 'It is pitch dark.' : !steady ? 'The lights keep changing colour.' : total < 1.5 ? 'Too dark to see the meat.' : !warm ? 'The light is cold.' : 'Nicely lit.';
  }
  // colour
  {
    const c = meat && meat.material && meat.material.color;
    if (!c) { res.colour = false; why.colour = meat ? 'The meat has every colour at once.' : 'There is no meat.'; }
    else {
      const { h, s, l } = hsl(c);
      res.colour = h >= 0.02 && h <= 0.12 && s >= 0.3 && l >= 0.15 && l <= 0.5;
      why.colour = res.colour ? 'Grilled to perfection.' : h > 0.5 && h < 0.75 ? 'The meat is blue.' : l > 0.5 ? 'The meat looks raw.' : 'The meat has a strange colour.';
    }
  }
  // shape
  {
    const g = meat && meat.geometry;
    const p = g && g.parameters;
    res.shape = !!(g && g.type === 'CylinderGeometry' && p.radiusTop > p.radiusBottom * 1.2 && p.height >= 1.8);
    why.shape = res.shape ? 'A proper döner cone.' : !g ? 'There is no meat.' : g.type === 'BoxGeometry' ? 'That is a cube, not a döner.' : g.type === 'SphereGeometry' ? 'That is a meatball.' : 'The cone is upside down.';
  }
  // spit
  {
    const sp = d.spit;
    if (!sp || !meat) { res.spit = false; why.spit = 'Nothing holds the meat up.'; }
    else {
      sp.updateMatrixWorld(true);
      const e = sp.matrixWorld.elements;
      const up = Math.abs(e[5]) / Math.hypot(e[4], e[5], e[6]);
      const off = Math.hypot(sp.position.x - meat.position.x, sp.position.z - meat.position.z);
      res.spit = up > 0.95 && off < 0.2;
      why.spit = res.spit ? 'Spit is in place.' : up <= 0.95 ? 'The spit is lying sideways.' : 'The spit misses the meat.';
    }
  }
  // heat
  {
    const gr = d.grill;
    if (!gr || !meat) { res.heat = false; why.heat = 'Nothing is cooking the meat.'; }
    else {
      const em = gr.material.emissive;
      const warm = em && em.r > 0.6 && em.r > em.b * 1.5 && gr.material.emissiveIntensity > 0.5;
      const side = near(gr.position.y, meat.position.y, 0.8);
      const dist = Math.hypot(gr.position.x - meat.position.x, gr.position.z - meat.position.z);
      res.heat = !!(warm && side && dist > 0.6 && dist < 2.2);
      why.heat = res.heat ? 'Hot grill, perfect.' : !warm ? 'It is freezing cold.' : !side ? 'The fire is under the meat. The shop is on fire.' : 'The grill is too far away.';
    }
  }
  // bread
  {
    const b = d.bread;
    if (!b || !meat) { res.bread = false; why.bread = 'No bread to put it in.'; }
    else {
      const { h, l } = hsl(b.material.color);
      const below = b.position.y < meat.position.y - 0.8;
      res.bread = below && h >= 0.06 && h <= 0.16 && l >= 0.5;
      why.bread = res.bread ? 'Fresh bread.' : !below ? 'The bread is wearing the meat as a hat.' : 'That is a pizza.';
    }
  }
  // slicing
  {
    const now = second.slicesY;
    const prev = first.slicesY;
    const fallen = now.filter((y) => y < 0.6).length;
    const flying = now.filter((y) => y > 3.4).length;
    res.shave = now.length >= 3 && fallen >= 2 && flying === 0;
    why.shave = res.shave ? 'Thin slices drop into the bread.' : !d.slices ? 'Nobody cuts the meat.' : flying ? 'The slices fly up into the sky.' : prev.length === 0 ? 'Nobody cuts the meat.' : 'The slices never land.';
  }
  // rotation
  {
    const a = first.meatRot, b = second.meatRot;
    if (!a || !b) { res.spin = false; why.spin = 'Nothing to turn.'; }
    else {
      const dt = (second.t - first.t) / 1000;
      const wy = (b.y - a.y) / dt, wx = (b.x - a.x) / dt, wz = (b.z - a.z) / dt;
      res.spin = Math.abs(wx) < 0.05 && Math.abs(wz) < 0.05 && Math.abs(wy) >= 0.2 && Math.abs(wy) <= 3;
      why.spin = res.spin ? 'Turning nice and slow.' : Math.abs(wx) >= 0.05 ? 'The meat is doing somersaults.' : Math.abs(wy) > 3 ? 'It spins so fast the meat flies off.' : 'It does not turn.';
    }
  }
  return { res, why };
}
