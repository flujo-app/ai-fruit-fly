// The döner shop around every fly-written program: the counter to stand on, a faint glow, the
// `knife(mesh)` helper (three.js has no döner knife) and the slices it shaves off. The knife cuts thin
// slices off the side that faces the customer. Each slice gets a small push away from the meat,
// falls, and stays on the first thing it lands on (the bread, if it is in the right place).
//
// Used by the real app page (app-template.js copies this function's text into the page, so the page
// works on its own) and by the last shot of a Cubicles video. That is why it uses nothing from
// outside itself: COUNTER_TOP and SLICE are the customer's numbers from judge.js.
export function doenerShop(THREE, scene, COUNTER_TOP, SLICE) {
  const counter = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x8d9297, metalness: 0.6, roughness: 0.4 }));
  counter.position.y = COUNTER_TOP - 0.15;
  scene.add(counter);
  scene.add(new THREE.AmbientLight(0xffffff, 0.06));   // a faint glow so a dark shop is not fully black
  const knifeTargets = [];
  const knife = (mesh) => { if (!knifeTargets.includes(mesh)) knifeTargets.push(mesh); };

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
  return { knife, update: shave };
}
