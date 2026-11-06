// The workers. Far away, 1,024 simple flies are drawn as one instanced mesh and bob while they type.
// Near the visitor, a few detailed flies (the same body as in the other pages, with legs that really
// tap the keyboard) take over, and their monitors switch to a sharp screen with the code being typed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFly } from '../fly.js';
import { drawShop } from '../gym/wall.js';
import { COLORS, NEWLINE } from '../gym/grammar.js';
import { part, SCREEN_POS, SCREEN_SIZE } from './office.js';

// how a fly sits on its chair, in the cubicle's frame (the fly's own frame faces +x, in fly units)
export const SEAT = { y: 0.508, z: 0.04, pitch: 0.3, scale: 0.33 };

// A fly's program (its first `shown` tokens) as rows of coloured pieces { s, c }, wrapped at `cols`
// characters: the fly's own choices in amber, colours in their colour, autocomplete in grey.
export function codeRows(tokens, shown = tokens.length, cols = 66) {
  const lines = [[]];
  let col = 0, prev = '\n';
  const tight = (t) => prev === '\n' || ['.', ')', ',', ';', ':'].includes(t) || prev === '.' || prev === '(' || (t === '(' && /^[A-Za-z_$][\w$]*$/.test(prev));
  for (let k = 0; k < shown; k++) {
    const { t, d: chosen } = tokens[k];
    if (t === '\n') { lines.push([]); col = 0; prev = '\n'; continue; }
    if (t === 'END' || t === NEWLINE) continue;
    const txt = (tight(t) ? '' : ' ') + t;
    if (col + txt.length > cols) { lines.push([]); col = 2; lines[lines.length - 1].push({ s: '  ', c: '#5f6878' }); }
    lines[lines.length - 1].push({ s: txt, c: chosen ? '#ffb547' : COLORS[t] ? '#' + t.slice(2) : '#9aa4b5' });
    col += txt.length;
    prev = t;
  }
  return lines;
}
function pose(geom) {
  return geom.scale(SEAT.scale, SEAT.scale, SEAT.scale).rotateZ(SEAT.pitch).rotateY(Math.PI / 2).translate(0, SEAT.y, SEAT.z);
}

function limb(a, b, r, color) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r * 0.8, r, len, 5);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  return part(g, color, A.x, A.y, A.z);
}
function blob(r, sx, sy, sz, color, x, y, z, seg = 9) {
  return part(new THREE.SphereGeometry(r, seg, Math.max(5, seg - 3)).scale(sx, sy, sz), color, x, y, z);
}

// a simple fly (about 1,000 triangles) in the sitting, typing pose
function simpleFly() {
  const body = [
    blob(1, 0.56, 0.46, 0.46, 0x8c6a3c, 0.06, 0.74, 0),
    blob(1, 0.8, 0.44, 0.47, 0xa88550, -0.92, 0.64, 0),
    blob(1, 0.32, 0.2, 0.42, 0x4a3020, -0.75, 0.72, 0, 7),   // a dark band on the abdomen
    blob(0.3, 0.8, 1, 1.12, 0xa47a42, 0.7, 0.8, 0),
  ];
  for (const s of [-1, 1]) {
    body.push(blob(0.22, 0.78, 1.08, 0.62, 0xb81d16, 0.72, 0.82, s * 0.215, 7));
    // front legs reach the keyboard, the others hang down
    body.push(limb([0.3, 0.52, s * 0.16], [0.78, 0.86, s * 0.28], 0.05, 0x4a3420), limb([0.78, 0.86, s * 0.28], [1.22, 0.42, s * 0.2], 0.04, 0x4a3420));
    body.push(limb([0.06, 0.5, s * 0.2], [0.2, 0.15, s * 0.62], 0.05, 0x4a3420), limb([0.2, 0.15, s * 0.62], [0.05, -0.35, s * 0.72], 0.04, 0x4a3420));
    body.push(limb([-0.18, 0.5, s * 0.17], [-0.5, 0.2, s * 0.6], 0.05, 0x4a3420), limb([-0.5, 0.2, s * 0.6], [-0.6, -0.3, s * 0.68], 0.04, 0x4a3420));
  }
  const wings = [-1, 1].map((s) => {
    const g = new THREE.CircleGeometry(1, 14).scale(0.95, 0.3, 1).rotateX(-Math.PI / 2).rotateY(s * 0.12).translate(-0.62, 1.08, s * 0.16);
    return part(g, 0xdfeaf7);
  });
  return { body: pose(mergeGeometries(body)), wings: pose(mergeGeometries(wings)) };
}

export class Workers {
  constructor(scene, office) {
    this.office = office;
    const n = office.n;
    const { body, wings } = simpleFly();
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 }), n);
    this.wings = new THREE.InstancedMesh(wings, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }), n);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.body, this.wings);
    this.hidden = new Set();     // cubicles whose fly is drawn in detail (or is away)
    this.phase = Float32Array.from({ length: n }, () => Math.random() * 100);
    this.tmp = new THREE.Matrix4();
    this.bob = new THREE.Matrix4();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.update(0, 1);
  }

  // `pace` 0..1: how busy everyone is typing (follows the training speed)
  update(t, pace) {
    const { matrices } = this.office;
    for (let i = 0; i < matrices.length; i++) {
      if (this.hidden.has(i)) { this.body.setMatrixAt(i, this.zero); this.wings.setMatrixAt(i, this.zero); continue; }
      const p = this.phase[i] + t * (6 + 10 * pace);
      const lift = Math.max(0, Math.sin(p)) * 0.012 * (0.3 + pace);
      this.bob.makeRotationY(Math.sin(p * 0.13) * 0.06).setPosition(0, lift, 0);
      this.tmp.multiplyMatrices(matrices[i], this.bob);
      this.body.setMatrixAt(i, this.tmp);
      this.wings.setMatrixAt(i, this.tmp);
    }
    this.body.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- detailed desks near the visitor
export class NearDesk {
  constructor(scene, office) {
    this.office = office;
    this.cube = -1;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    // the detailed fly
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, SEAT.y, SEAT.z);
    this.pivot.rotation.y = Math.PI / 2;
    this.group.add(this.pivot);
    this.fly = createFly();
    this.fly.root.rotation.z = SEAT.pitch;
    this.fly.root.scale.setScalar(SEAT.scale);
    this.fly.root.traverse((o) => { o.castShadow = false; });
    this.pivot.add(this.fly.root);
    // a sharp screen in front of the monitor's atlas tile
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640; this.canvas.height = 384;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(...SCREEN_SIZE), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.screen.position.copy(SCREEN_POS).add(new THREE.Vector3(0, 0, 0.003));
    this.group.add(this.screen);
    this.data = null;
    this.group.visible = false;
    this.mode = 'type';
    this.proboscis = 0;
  }

  assign(i) {
    this.cube = i;
    this.group.visible = i >= 0;
    if (i >= 0) { this.group.matrix.copy(this.office.matrices[i]); this.group.matrixWorldNeedsUpdate = true; }
    this.data = null;
    this.drawn = -1;
  }

  // what this fly is typing: { tokens, score, passed, label }, and when the round started
  setCode(data, startedAt, duration) {
    this.data = data;
    this.startedAt = startedAt;
    this.duration = duration;
    this.drawn = -1;
  }

  update(dt, now, summary) {
    if (this.cube < 0) return;
    this.fly.update(dt, { speed: 0, turn: 0, mode: this.mode, proboscis: this.proboscis });
    // type the program token by token over the round
    const d = this.data;
    if (!d) return;
    const total = d.tokens.length;
    const shown = this.duration > 0 ? Math.min(total, Math.floor(total * Math.min(1, (now - this.startedAt) / (this.duration * 0.85)))) : total;
    if (shown === this.drawn && now - (this.blinkAt || 0) < 400) return;
    this.blinkAt = now;
    this.drawn = shown;
    this.draw(d, shown, summary, now);
  }

  draw(d, shown, summary, now) {
    const g = this.canvas.getContext('2d'), W = 640, H = 384;
    g.fillStyle = '#0f1218'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a1f29'; g.fillRect(0, 0, W, 34);
    g.font = '600 18px "Segoe UI", system-ui';
    g.fillStyle = '#ffb547'; g.fillText(d.label, 12, 23);
    g.fillStyle = d.passed === 8 ? '#45d483' : '#8d96a7';
    g.textAlign = 'right'; g.fillText(`${d.score.toFixed(2)} / 8 · ${d.passed}/8 tests`, W - 12, 23); g.textAlign = 'left';
    // the code, wrapped, with the fly's own choices in amber
    g.font = '15px ui-monospace, Consolas, monospace';
    const vis = codeRows(d.tokens, shown, 66).slice(-19);
    vis.forEach((ln, r) => {
      let x = 12;
      for (const { s, c } of ln) { g.fillStyle = c; g.fillText(s, x, 56 + r * 17); x += g.measureText(s).width; }
      if (r === vis.length - 1 && shown < d.tokens.length && Math.floor(now / 300) % 2) { g.fillStyle = '#ffb547'; g.fillRect(x + 2, 44 + r * 17, 8, 15); }
    });
    // the shop it describes, in the corner
    if (summary) {
      g.save();
      drawShop(g, W - 132, 42, 120, summary.data, summary.fly, now / 1000);
      g.restore();
    }
    this.tex.needsUpdate = true;
  }
}
