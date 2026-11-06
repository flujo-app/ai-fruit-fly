// When a fly writes the first perfect döner app: it dances on its chair under a light beam and
// confetti, a path of arrows on the floor leads the visitor to it, and the visitor can hand it a sugar
// cube (real dopamine for its winning program) or a management contract (it flies to the management
// office, and its memory is copied into flies of every team).
import * as THREE from 'three';
import { NearDesk, SEAT } from './flies.js';
import { floorHeight, makeField, pathFrom, cubicle } from './layout.js';

const tmpV = new THREE.Vector3();

function chevronTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffb547'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#ffb547'; g.shadowBlur = 10;
  g.beginPath(); g.moveTo(40, 12); g.lineTo(78, 32); g.lineTo(40, 52); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textSprite(text, color = '#241503', bg = '#ffb547', w = 512, h = 128, size = 54) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 28); g.fill();
  g.fillStyle = color; g.font = `800 ${size}px "Segoe UI", system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, toneMapped: false, depthTest: false }));
  s.scale.set(w / h * 0.3, 0.3, 1);
  s.renderOrder = 10;
  return s;
}

export class Party {
  constructor(scene, office, workers, grid) {
    this.scene = scene;
    this.office = office;
    this.workers = workers;
    this.grid = grid;
    this.active = false;
    this.root = new THREE.Group();
    scene.add(this.root);
    // confetti
    this.N = 700;
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), this.N);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const palette = [0xffb547, 0x45d483, 0xff5a8a, 0x5fd4ff, 0xa98bff, 0xffffff, 0xff6a3d];
    for (let i = 0; i < this.N; i++) this.confetti.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    this.p = { pos: new Float32Array(this.N * 3), vel: new Float32Array(this.N * 3), rot: new Float32Array(this.N * 3), alive: new Uint8Array(this.N) };
    this.confetti.count = this.N;
    this.root.add(this.confetti);
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.N; i++) this.confetti.setMatrixAt(i, this.zero);
    // a light beam that can be seen from anywhere in the office
    const gc = document.createElement('canvas'); gc.width = 4; gc.height = 256;
    const gg = gc.getContext('2d'), grad = gg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.8, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,1)');
    gg.fillStyle = grad; gg.fillRect(0, 0, 4, 256);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 28, 24, 1, true), new THREE.MeshBasicMaterial({
      color: 0x8dffb9, alphaMap: new THREE.CanvasTexture(gc), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.beam.visible = false;
    this.root.add(this.beam);
    // the floor path
    this.chevrons = chevronTexture();
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: this.chevrons, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.ribbon.visible = false;
    this.ribbon.renderOrder = 2;
    this.root.add(this.ribbon);
    // the dancing fly and its sharp screen
    this.desk = new NearDesk(scene, office);
    // two presents, floating at the cubicle's opening
    this.sugar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.35, roughness: 0.9 }));
    this.sugar.userData.reward = 'sugar';
    const pc = document.createElement('canvas'); pc.width = 256; pc.height = 340;
    const pg = pc.getContext('2d');
    pg.fillStyle = '#f7f3ea'; pg.fillRect(0, 0, 256, 340);
    pg.fillStyle = '#1b1406'; pg.font = '800 30px "Segoe UI", system-ui'; pg.textAlign = 'center'; pg.fillText('CONTRACT', 128, 50);
    pg.font = '600 20px "Segoe UI", system-ui'; pg.fillText('Head of Döner', 128, 84);
    pg.fillStyle = '#b9b2a3'; for (let y = 120; y < 270; y += 22) pg.fillRect(30, y, 196, 5);
    pg.fillStyle = '#1b1406'; pg.font = '500 18px "Segoe UI", system-ui'; pg.fillText('sign here: ________', 128, 310);
    const ptex = new THREE.CanvasTexture(pc); ptex.colorSpace = THREE.SRGBColorSpace;
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.345), new THREE.MeshBasicMaterial({ map: ptex, side: THREE.DoubleSide }));
    this.paper.userData.reward = 'contract';
    this.sugarLabel = textSprite('1 · sugar cube');
    this.paperLabel = textSprite('2 · contract');
    for (const o of [this.sugar, this.paper, this.sugarLabel, this.paperLabel]) { o.visible = false; this.root.add(o); }
    this.targets = [this.sugar, this.paper];
    this.flying = null;   // the promoted fly on its way to management
  }

  start(lab, fly, label) {
    const i = lab * this.office.perLab + fly;
    this.active = true;
    this.i = i; this.lab = lab; this.fly = fly; this.label = label;
    this.c = cubicle(lab, fly);
    this.door = this.c.door;
    this.field = makeField(this.grid, this.door);
    this.workers.hidden.add(i);
    this.desk.assign(i);
    this.desk.group.visible = true;
    this.desk.mode = 'type';
    this.t0 = performance.now() / 1000;
    this.beam.position.set(this.c.x, 1.6 + 14, this.c.z);   // starts above the cubicle walls
    this.beam.visible = true;
    this.burstAt = 0;
    this.gotSugar = false; this.gotContract = false;
    // presents float in the aisle in front of the cubicle
    const side = new THREE.Vector3(1, 0, 0);
    this.sugarHome = new THREE.Vector3(this.door.x - side.x * 0.45, 1.55, this.door.z);
    this.paperHome = new THREE.Vector3(this.door.x + side.x * 0.45, 1.55, this.door.z);
    this.sugar.position.copy(this.sugarHome); this.paper.position.copy(this.paperHome);
    for (const o of [this.sugar, this.paper, this.sugarLabel, this.paperLabel]) o.visible = true;
    this.star = textSprite(`★ ${label} ★`, '#06210f', '#45d483', 1024, 160, 72);
    this.star.scale.set(4.8, 0.75, 1);
    this.star.position.set(this.c.x, 3.1, this.c.z);
    this.root.add(this.star);
    this.lastPathFrom = null;
  }

  // distance from the visitor to the winner's aisle spot
  distance(x, z) { return this.active ? Math.hypot(x - this.door.x, z - this.door.z) : Infinity; }

  burst(n, x, y, z, speed = 3) {
    const { pos, vel, rot, alive } = this.p;
    let made = 0;
    for (let i = 0; i < this.N && made < n; i++) {
      if (alive[i]) continue;
      alive[i] = 1; made++;
      pos[i * 3] = x + (Math.random() - 0.5) * 0.4; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed * 0.6;
      vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = speed * (0.6 + Math.random() * 0.6); vel[i * 3 + 2] = Math.sin(a) * s;
      rot[i * 3] = Math.random() * 6; rot[i * 3 + 1] = Math.random() * 6; rot[i * 3 + 2] = Math.random() * 6;
    }
  }

  update(dt, now, visitor) {
    const t = now / 1000;
    // confetti
    const { pos, vel, rot, alive } = this.p, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (!alive[i]) continue;
      any = true;
      vel[i * 3 + 1] -= 5 * dt;
      if (vel[i * 3 + 1] < -0.9) vel[i * 3 + 1] = -0.9;   // paper flutters down slowly
      vel[i * 3] *= 1 - dt * 0.8; vel[i * 3 + 2] *= 1 - dt * 0.8;
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] += vel[i * 3 + k] * dt; rot[i * 3 + k] += dt * (4 + (i % 5)); }
      pos[i * 3] += Math.sin(t * 3 + i) * 0.15 * dt;
      if (pos[i * 3 + 1] < 0.02) { alive[i] = 0; this.confetti.setMatrixAt(i, this.zero); continue; }
      m.compose(tmpV.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), q.setFromEuler(e.set(rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2])), one);
      this.confetti.setMatrixAt(i, m);
    }
    if (any || this.active) this.confetti.instanceMatrix.needsUpdate = true;
    this.chevrons.offset.x -= dt * 1.4;
    this.updateFlight(dt, t);
    if (!this.active) return;
    // keep the party going
    if (t - this.burstAt > 1.6) { this.burstAt = t; this.burst(70, this.c.x, 2.2, this.c.z, 3.2); }
    // the beam is for finding the winner from afar; it fades away when you are close
    const far = Math.min(1, Math.max(0, (Math.hypot(visitor.x - this.c.x, visitor.z - this.c.z) - 3) / 8));
    this.beam.material.opacity = (0.45 + 0.15 * Math.sin(t * 3)) * far;
    // the dance: hop, spin and buzz (unless it is eating or signing)
    const d = this.desk, tt = t - this.t0;
    if (!this.busy) {
      d.pivot.position.y = SEAT.y + 0.18 + Math.abs(Math.sin(tt * 5)) * 0.28;
      d.pivot.rotation.y = Math.PI / 2 + tt * 2.6;
      d.mode = Math.floor(tt / 0.9) % 3 === 2 ? 'flight' : 'groom';
      d.fly.root.rotation.z = SEAT.pitch + Math.sin(tt * 7) * 0.25;
    }
    d.update(dt, now, null);
    // presents bob in the air
    this.sugar.position.y = this.sugarHome.y + Math.sin(t * 2.2) * 0.06;
    this.sugar.rotation.y += dt * 1.2;
    this.paper.position.y = this.paperHome.y + Math.sin(t * 2.2 + 1) * 0.06;
    this.paper.rotation.y = Math.sin(t) * 0.5;
    this.sugarLabel.position.set(this.sugar.position.x, this.sugarHome.y + 0.28, this.sugar.position.z);
    this.paperLabel.position.set(this.paper.position.x, this.paperHome.y + 0.32, this.paper.position.z);
    // the path on the floor, from wherever the visitor is
    const dist = this.distance(visitor.x, visitor.z);
    if (dist < 2.2) this.ribbon.visible = false;
    else if (!this.lastPathFrom || Math.hypot(visitor.x - this.lastPathFrom.x, visitor.z - this.lastPathFrom.z) > 0.4) {
      this.lastPathFrom = { x: visitor.x, z: visitor.z };
      this.path = pathFrom(this.grid, this.field, visitor);
      this.buildRibbon(this.path);
      this.ribbon.visible = true;
    }
  }

  // a strip of moving arrows along the path, a little above the floor
  buildRibbon(path) {
    const pts = [];
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1], len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(len / 0.5));
      for (let s = 0; s < n; s++) pts.push({ x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n });
    }
    pts.push(path[path.length - 1]);
    // start a little in front of the visitor, so the arrows are not under their feet
    const skip = Math.min(pts.length - 2, 2);
    const P = pts.slice(skip);
    const pos = [], uv = [], idx = [];
    let u = 0;
    for (let k = 0; k < P.length; k++) {
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (k) u += Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z) / 0.8;
      const y = floorHeight(P[k].x, P[k].z) + 0.03, w = 0.28;
      pos.push(P[k].x - dz * w, y, P[k].z + dx * w, P[k].x + dz * w, y, P[k].z - dx * w);
      uv.push(u, 1, u, 0);
      if (k) { const o = (k - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.ribbon.geometry.dispose();
    this.ribbon.geometry = g;
  }

  headPosition(out) { return this.desk.fly.head.getWorldPosition(out); }

  // throw something from the visitor to the fly
  toss(obj, from, ms = 900) {
    const start = from.clone(), end = this.headPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
    const t0 = performance.now();
    return new Promise((resolve) => {
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        obj.position.lerpVectors(start, end, k);
        obj.position.y += Math.sin(Math.PI * k) * 0.6;
        obj.rotation.x += 0.15; obj.rotation.z += 0.1;
        if (k < 1) requestAnimationFrame(tick); else resolve();
      };
      tick();
    });
  }

  async giveSugar(from) {
    if (!this.active || this.gotSugar || this.busy) return false;
    this.gotSugar = true;
    this.busy = true;
    this.sugarLabel.visible = false;
    this.calmDown();
    await this.toss(this.sugar, from);
    this.sugar.visible = false;
    // eat it: the proboscis comes out
    this.desk.proboscis = 1;
    this.desk.mode = 'feed';
    const h = this.headPosition(new THREE.Vector3());
    this.burst(90, h.x, h.y + 0.2, h.z, 2.2);
    await new Promise((r) => setTimeout(r, 2600));
    this.desk.proboscis = 0;
    this.busy = false;
    return true;
  }

  calmDown() {
    const d = this.desk;
    d.pivot.position.y = SEAT.y + 0.12;
    d.pivot.rotation.y = Math.PI / 2;
    d.fly.root.rotation.z = SEAT.pitch;
  }

  // the contract: the fly signs, then flies to a free chair in the management office
  async offerContract(from) {
    if (!this.active || this.gotContract || this.busy) return null;
    this.gotContract = true;
    this.busy = true;
    this.paperLabel.visible = false;
    this.calmDown();
    await this.toss(this.paper, from);
    this.paper.visible = false;
    this.desk.mode = 'groom';   // "signing"
    await new Promise((r) => setTimeout(r, 1500));
    const seat = this.office.mgmtSeats.find((s) => !s.taken) || this.office.mgmtSeats[this.office.mgmtSeats.length - 1];
    seat.taken = true;
    // the fly leaves its desk and flies over the cubicles
    const fly = this.desk.fly;
    this.scene.attach(fly.root);
    // the empty desk object gets a fresh fly for any later party
    const old = this.desk;
    this.desk = new NearDesk(this.scene, this.office);
    old.group.visible = false;
    // it lands standing on the big desk in front of its chair, facing the office
    const start = fly.root.position.clone(), end = new THREE.Vector3(seat.pos.x, 0.85, 8.75);
    const mid = start.clone().lerp(end, 0.5); mid.y = 5;
    this.flying = { fly, curve: new THREE.QuadraticBezierCurve3(start, mid, end), t: 0, dur: Math.max(5, start.distanceTo(end) / 7), seat, done: null };
    const landed = new Promise((r) => { this.flying.done = r; });
    this.endParty(false);
    return { seat, landed };
  }

  updateFlight(dt, t) {
    const f = this.flying;
    if (!f) return;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;   // ease in and out
    const p = f.curve.getPoint(k), ahead = f.curve.getPoint(Math.min(1, k + 0.01));
    f.fly.root.position.copy(p);
    if (f.t < 1) {
      f.fly.root.rotation.set(0, Math.atan2(-(ahead.z - p.z), ahead.x - p.x), -0.15);
      f.fly.update(dt, { speed: 0, turn: 0, mode: 'flight', proboscis: 0 });
    } else {
      // landed on the desk, facing the office
      f.fly.root.rotation.set(0, Math.PI / 2, 0);
      f.fly.update(dt, { speed: 0, turn: 0, mode: 'idle', proboscis: 0 });
      if (f.done) { f.done(); f.done = null; }
      this.managers = this.managers || [];
      this.managers.push(f.fly);
      this.flying = null;
    }
  }

  // the managers relax in their chairs
  idle(dt) { for (const fl of this.managers || []) fl.update(dt, { speed: 0, turn: 0, mode: 'groom', proboscis: 0 }); }

  endParty(releaseDesk = true) {
    this.active = false;
    this.beam.visible = false;
    this.ribbon.visible = false;
    for (const o of [this.sugar, this.paper, this.sugarLabel, this.paperLabel]) o.visible = false;
    if (this.star) { this.root.remove(this.star); this.star = null; }
    this.desk.group.visible = false;
    this.desk.cube = -1;
    if (releaseDesk) this.workers.hidden.delete(this.i);
    this.busy = false;
  }
}
