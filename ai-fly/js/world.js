// The tabletop world: a wooden table, a gingham picnic cloth, a banana slice, sugar and bitter
// drops, crumbs, and a fly swatter. Units are millimetres.
import * as THREE from 'three';

export const ARENA_RADIUS = 58;

function canvasTexture(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

function rand(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function woodTexture() {
  return canvasTexture(1024, 1024, (g, w, h) => {
    const r = rand(7);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#9c6a3c'); grad.addColorStop(0.5, '#a87545'); grad.addColorStop(1, '#94633a');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const y0 = r() * h, amp = 4 + r() * 18, freq = 0.002 + r() * 0.006, ph = r() * 6.28;
      g.strokeStyle = `rgba(${60 + r() * 40},${35 + r() * 20},${18 + r() * 10},${0.05 + r() * 0.18})`;
      g.lineWidth = 0.6 + r() * 2.4;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1) * amp * 0.2;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    // plank seams
    g.fillStyle = 'rgba(40,22,10,0.55)';
    for (let k = 1; k < 4; k++) g.fillRect(0, (k * h) / 4 - 1, w, 2.5);
  }, 3);
}

function ginghamTexture(repeat) {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#f8f4ec'; g.fillRect(0, 0, w, h);
    const period = 64, band = 32;
    g.fillStyle = 'rgba(196, 44, 56, 0.52)';
    for (let x = 0; x < w; x += period) g.fillRect(x, 0, band, h);
    for (let y = 0; y < h; y += period) g.fillRect(0, y, w, band);
    // woven fabric grain
    const img = g.getImageData(0, 0, w, h);
    const r = rand(3);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 18 + ((i / 4) % 2 === 0 ? 4 : -4);
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, repeat);
}

function bananaTopTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const grad = g.createRadialGradient(cx, cy, 10, cx, cy, w / 2);
    grad.addColorStop(0, '#f3e6b5'); grad.addColorStop(0.62, '#f6ebc2'); grad.addColorStop(0.74, '#e9d699');
    grad.addColorStop(0.8, '#f4e7b8'); grad.addColorStop(0.97, '#efdca4'); grad.addColorStop(1, '#d9bd6c');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const r = rand(11);
    g.strokeStyle = 'rgba(200,170,100,0.25)';
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2, r0 = 40 + r() * 60, r1 = 150 + r() * 90;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
    }
    // the seedy centre
    g.fillStyle = 'rgba(160,130,70,0.35)';
    g.beginPath(); g.ellipse(cx, cy, 52, 44, 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2614';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.3, d = 18 + r() * 18;
      g.beginPath(); g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 4.5, 3, a, 0, Math.PI * 2); g.fill();
    }
  });
}

function swatterTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#000';
  for (let y = 26; y < 236; y += 15) for (let x = 26; x < 236; x += 15) {
    g.beginPath(); g.arc(x, y, 5.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function createWorld(scene) {
  scene.background = new THREE.Color(0xd8d0c3);
  scene.fog = new THREE.Fog(0xd8d0c3, 140, 460);

  const hemi = new THREE.HemisphereLight(0xfff6e8, 0x7a5a3c, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.5);
  fill.position.set(-60, 40, -50);
  scene.add(fill);

  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.72, metalness: 0.02 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.35;
  table.receiveShadow = true;
  scene.add(table);

  const clothSize = 150;
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(clothSize, clothSize, 1, 1),
    new THREE.MeshStandardMaterial({ map: ginghamTexture(clothSize / 32), roughness: 0.92 }),
  );
  cloth.rotation.x = -Math.PI / 2;
  cloth.rotation.z = 0.12;
  cloth.receiveShadow = true;
  cloth.name = 'cloth';
  scene.add(cloth);

  const foods = [];
  const drops = new THREE.Group();
  scene.add(drops);

  const dropGeo = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const sugarMat = new THREE.MeshPhysicalMaterial({
    color: 0xffe2a0, roughness: 0.04, transmission: 0.88, thickness: 0.9, ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color(0xffb347), attenuationDistance: 2.5,
  });
  const bitterMat = sugarMat.clone();
  bitterMat.color.set(0x9fd0ff);
  bitterMat.attenuationColor = new THREE.Color(0x2f7dff);

  function addDrop(x, z, kind = 'sugar', radius = 1.1 + Math.random() * 0.5) {
    const m = new THREE.Mesh(dropGeo, kind === 'sugar' ? sugarMat : bitterMat);
    m.position.set(x, 0, z);
    m.scale.set(radius, radius * 0.55, radius);
    m.castShadow = true;
    drops.add(m);
    const food = { kind, mesh: m, pos: m.position, radius, amount: 1, height: 0 };
    foods.push(food);
    return food;
  }

  function removeFood(food) {
    drops.remove(food.mesh);
    foods.splice(foods.indexOf(food), 1);
  }

  // banana slice
  const banana = new THREE.Group();
  const bananaR = 8, bananaH = 2.4;
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xeedfa6, roughness: 0.55 });
  const topMat = new THREE.MeshStandardMaterial({ map: bananaTopTexture(), roughness: 0.45 });
  const slice = new THREE.Mesh(new THREE.CylinderGeometry(bananaR, bananaR * 1.02, bananaH, 64, 1), [sideMat, topMat, topMat]);
  slice.position.y = bananaH / 2;
  slice.castShadow = true; slice.receiveShadow = true;
  slice.scale.z = 0.92;
  banana.add(slice);
  banana.position.set(26, 0, -14);
  scene.add(banana);
  foods.push({ kind: 'banana', mesh: banana, pos: banana.position, radius: bananaR * 0.96, amount: Infinity, height: bananaH });

  // crumbs
  const crumbMat = new THREE.MeshStandardMaterial({ color: 0xb98a4e, roughness: 0.85, flatShading: true });
  const r = rand(5);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 12 + r() * 60;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + r() * 0.8, 0), crumbMat);
    m.position.set(Math.cos(a) * d, 0.2, Math.sin(a) * d);
    m.rotation.set(r() * 3, r() * 3, r() * 3);
    m.castShadow = true;
    scene.add(m);
  }

  // starting drops
  addDrop(-14, 9, 'sugar', 1.5);
  addDrop(10, 20, 'sugar', 1.3);
  addDrop(-20, -18, 'bitter', 1.4);

  // fly swatter
  const swatter = new THREE.Group();
  const paddleMat = new THREE.MeshStandardMaterial({
    color: 0x2fae58, roughness: 0.5, alphaMap: swatterTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const paddle = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), paddleMat);
  paddle.rotation.x = -Math.PI / 2;
  paddle.castShadow = true;
  swatter.add(paddle);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(13.6, 0.5, 8, 4), new THREE.MeshStandardMaterial({ color: 0x23914a, roughness: 0.5 }));
  rim.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  rim.scale.set(1.36, 1.36, 1);
  rim.castShadow = true;
  swatter.add(rim);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 120, 12), new THREE.MeshStandardMaterial({ color: 0x23914a, roughness: 0.45 }));
  handle.position.set(-13 - 52, 34, 0);
  handle.rotation.z = Math.PI / 2 - 0.58;
  handle.castShadow = true;
  swatter.add(handle);
  swatter.visible = false;
  scene.add(swatter);

  return { sun, cloth, table, foods, addDrop, removeFood, swatter, swatterRadius: 13, banana };
}
