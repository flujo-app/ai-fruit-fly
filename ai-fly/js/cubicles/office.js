// The office building: floor, walls, lights, the supervisor deck, the management office, and 1,024
// cubicles (desk, monitor, keyboard and chair) drawn as one instanced mesh. Every monitor shows its
// fly's döner shop, taken from one big shared picture (the "atlas"), so all screens cost one texture.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawShop } from '../gym/wall.js';
import { CUB, OFFICE, DECK, RAMP, MGMT, cubicle, teamOrigin, TEAM_W, TEAM_D } from './layout.js';

// a box / cylinder with one colour baked into its vertices, ready to merge
export function part(geom, color, x = 0, y = 0, z = 0, rot = null) {
  if (rot) geom.rotateX(rot[0] || 0).rotateY(rot[1] || 0).rotateZ(rot[2] || 0);
  geom.translate(x, y, z);
  const c = new THREE.Color(color), n = geom.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geom.index ? geom.toNonIndexed() : geom;
}
const box = (w, h, d, color, x, y, z, rot) => part(new THREE.BoxGeometry(w, h, d), color, x, y, z, rot);
const cyl = (rt, rb, h, color, x, y, z, seg = 10) => part(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z);

// one cubicle in its own frame: the opening faces +z, the fly sits facing -z towards its monitor
export const SCREEN_POS = new THREE.Vector3(0, 1.02, -0.562);
export const SCREEN_SIZE = [0.6, 0.36];
function cubicleGeometry() {
  const fabric = 0x5d6b7c, trim = 0xc5ccd6, wood = 0xb48c5c, metal = 0x4d535b, black = 0x16191e, seat = 0x23272e;
  const parts = [
    // partitions: back wall and both side walls, with a light trim on top
    box(1.5, 1.2, 0.05, fabric, 0, 0.6, -0.725), box(1.5, 0.03, 0.06, trim, 0, 1.215, -0.725),
    box(0.05, 1.2, 1.2, fabric, 0.725, 0.6, -0.15), box(0.06, 0.03, 1.2, trim, 0.725, 1.215, -0.15),
    box(0.05, 1.2, 1.2, fabric, -0.725, 0.6, -0.15), box(0.06, 0.03, 1.2, trim, -0.725, 1.215, -0.15),
    // desk
    box(1.3, 0.04, 0.55, wood, 0, 0.73, -0.42), box(0.04, 0.71, 0.5, metal, 0.6, 0.355, -0.42), box(0.04, 0.71, 0.5, metal, -0.6, 0.355, -0.42),
    // monitor
    box(0.64, 0.4, 0.03, black, 0, 1.02, -0.58), box(0.05, 0.12, 0.04, metal, 0, 0.8, -0.6), box(0.22, 0.012, 0.16, metal, 0, 0.756, -0.58),
    // keyboard and mouse
    box(0.42, 0.02, 0.14, 0x2a2e35, 0, 0.76, -0.3), box(0.06, 0.02, 0.09, 0x2a2e35, 0.32, 0.76, -0.3),
    // a coffee mug
    cyl(0.035, 0.03, 0.09, 0xe9e4da, -0.45, 0.795, -0.45, 8),
    // chair
    box(0.44, 0.06, 0.5, seat, 0, 0.46, 0.26), box(0.42, 0.3, 0.05, seat, 0, 0.66, 0.64),
    cyl(0.025, 0.025, 0.4, metal, 0, 0.24, 0.22, 6), cyl(0.24, 0.24, 0.03, metal, 0, 0.04, 0.22, 10),
  ];
  return mergeGeometries(parts);
}

export class Office {
  constructor(scene, labs, perLab) {
    this.scene = scene;
    this.labs = labs;
    this.perLab = perLab;
    this.n = labs * perLab;
    this.cubes = Array.from({ length: this.n }, (_, i) => cubicle(Math.floor(i / perLab), i % perLab));
    this.matrices = this.cubes.map((c) => new THREE.Matrix4().makeRotationY(c.rot).setPosition(c.x, 0, c.z));
    this.buildRoom();
    this.buildCubicles();
    this.buildScreens();
    this.buildSigns();
    this.buildManagement();
  }

  // world position of a point given in a cubicle's own frame
  toWorld(i, local) { return local.clone().applyMatrix4(this.matrices[i]); }

  buildRoom() {
    const s = this.scene;
    const W = OFFICE.x1 - OFFICE.x0, D = OFFICE.z1 - OFFICE.z0;
    // carpet with a faint tile pattern
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#353b44'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1200; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
    const carpet = new THREE.CanvasTexture(c);
    carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping;
    carpet.repeat.set(W / 2, D / 2);
    carpet.colorSpace = THREE.SRGBColorSpace;
    carpet.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((OFFICE.x0 + OFFICE.x1) / 2, 0, (OFFICE.z0 + OFFICE.z1) / 2);
    s.add(floor);
    // walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8f98a3, roughness: 0.9 });
    const H = 5.5;
    for (const [w, d, x, z] of [[W, 0.3, 0, OFFICE.z0], [W, 0.3, 0, OFFICE.z1], [0.3, D, OFFICE.x0, (OFFICE.z0 + OFFICE.z1) / 2], [0.3, D, OFFICE.x1, (OFFICE.z0 + OFFICE.z1) / 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z);
      s.add(m);
    }
    // ceiling lights: long glowing strips above the aisles
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 0.06, 0.25), new THREE.MeshBasicMaterial({ color: 0xf2f6ff }), 200);
    let k = 0;
    const m4 = new THREE.Matrix4();
    for (let x = OFFICE.x0 + 6; x < OFFICE.x1 - 4 && k < 200; x += 9) for (let z = OFFICE.z0 + 4; z < 0 && k < 200; z += 6) strip.setMatrixAt(k++, m4.makeTranslation(x, 5.42, z));
    strip.count = k;
    s.add(strip);
    // the supervisor deck and its ramp
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 0.6, metalness: 0.2 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK.x1 - DECK.x0, DECK.y, DECK.z1 - DECK.z0), deckMat);
    deck.position.set((DECK.x0 + DECK.x1) / 2, DECK.y / 2, (DECK.z0 + DECK.z1) / 2);
    s.add(deck);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(DECK.x1 - DECK.x0, 0.04, 0.06), new THREE.MeshBasicMaterial({ color: 0xffb547 }));
    edge.position.set(0, DECK.y + 0.02, DECK.z0 + 0.03);
    s.add(edge);
    const rampLen = Math.hypot(RAMP.z1 - RAMP.z0, DECK.y);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(RAMP.x1 - RAMP.x0, 0.06, rampLen), deckMat);
    ramp.rotation.x = Math.atan2(DECK.y, RAMP.z1 - RAMP.z0);
    ramp.position.set(0, DECK.y / 2, (RAMP.z0 + RAMP.z1) / 2);
    s.add(ramp);
    // glass railing along the deck's front, with a gap for the ramp
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false });
    for (const [x0, x1] of [[DECK.x0, RAMP.x0], [RAMP.x1, DECK.x1]]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.9, 0.03), glass);
      r.position.set((x0 + x1) / 2, DECK.y + 0.45, DECK.z0 + 0.05);
      s.add(r);
    }
    // a doormat that says where you are
    const mat = this.label('SUPERVISOR DECK', 1024, 128, '#ffb547', 'rgba(20,24,30,0.9)', 64);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.5), new THREE.MeshBasicMaterial({ map: mat, transparent: true }));
    sign.rotation.x = -Math.PI / 2;
    sign.position.set(0, DECK.y + 0.01, DECK.z0 + 0.8);
    s.add(sign);
  }

  label(text, w, h, color, bg, size, font = '700') {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = color; g.font = `${font} ${size}px "Segoe UI", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  buildCubicles() {
    const mesh = new THREE.InstancedMesh(cubicleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), this.n);
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.cubicleMesh = mesh;
  }

  // every monitor shows its fly's shop: one shared 2048 x 2048 picture with a 64 px tile per fly
  buildScreens() {
    const TILES = 32, T = 64;
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.atlas.height = TILES * T;
    const g = this.atlas.getContext('2d');
    g.fillStyle = '#10131a'; g.fillRect(0, 0, this.atlas.width, this.atlas.height);
    this.atlasTex = new THREE.CanvasTexture(this.atlas);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.atlasTex.generateMipmaps = false;
    this.atlasTex.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(...SCREEN_SIZE);
    const tile = new Float32Array(this.n * 2);
    for (let i = 0; i < this.n; i++) { tile[i * 2] = i % TILES; tile[i * 2 + 1] = Math.floor(i / TILES); }
    geo.setAttribute('tile', new THREE.InstancedBufferAttribute(tile, 2));
    const mat = new THREE.MeshBasicMaterial({ map: this.atlasTex, toneMapped: false });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 tile;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv = vec2((tile.x + uv.x) / ${TILES}.0, 1.0 - (tile.y + 1.0 - uv.y) / ${TILES}.0);`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, this.n);
    const off = new THREE.Matrix4().makeTranslation(SCREEN_POS.x, SCREEN_POS.y, SCREEN_POS.z);
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m.clone().multiply(off)));
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.screenMesh = mesh;
  }

  // redraw every fly's tile from the labs' latest summaries
  drawAtlas(results, time) {
    const g = this.atlas.getContext('2d'), T = 64;
    for (let lab = 0; lab < this.labs; lab++) {
      const d = results[lab] && results[lab].summary;
      for (let f = 0; f < this.perLab; f++) {
        const i = lab * this.perLab + f;
        drawShop(g, (i % 32) * T, Math.floor(i / 32) * T, T, d, f, time);
      }
    }
    this.atlasTex.needsUpdate = true;
  }

  // a sign hanging over each team, with its live numbers
  buildSigns() {
    this.signs = [];
    for (let lab = 0; lab < this.labs; lab++) {
      const o = teamOrigin(lab);
      const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      // two faces back to back, so the text reads correctly from both sides
      for (const turn of [0, Math.PI]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), mat);
        m.position.set(o.x + TEAM_W / 2, 4.1, o.z + TEAM_D + (turn ? -0.01 : 0.01));
        m.rotation.y = turn;
        this.scene.add(m);
      }
      this.signs.push({ c, tex });
      this.drawSign(lab, null);
    }
  }

  drawSign(lab, st) {
    const { c, tex } = this.signs[lab], g = c.getContext('2d');
    g.fillStyle = '#0d1016'; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = st && st.solved ? '#45d483' : '#ffb547'; g.lineWidth = 10; g.strokeRect(5, 5, 1014, 246);
    g.fillStyle = '#ffb547'; g.font = '800 110px "Segoe UI", system-ui'; g.textBaseline = 'middle';
    g.fillText(`LAB ${lab + 1}`, 40, 128);
    g.fillStyle = '#eceef3'; g.font = '600 52px "Segoe UI", system-ui'; g.textAlign = 'right';
    g.fillText(st ? `best ${st.best.toFixed(2)} / 8` : '128 flies', 984, 90);
    g.fillStyle = st && st.solved ? '#45d483' : st && st.bored ? '#ffb547' : '#8d96a7';
    g.fillText(st ? (st.solved ? `${st.solved} perfect` : st.bored ? 'bored: extra curious' : '0 perfect') : 'waiting', 984, 170);
    g.textAlign = 'left';
    tex.needsUpdate = true;
  }

  // the glass management office, with a desk and three big chairs for promoted flies
  buildManagement() {
    const s = this.scene, cx = (MGMT.x0 + MGMT.x1) / 2, cz = (MGMT.z0 + MGMT.z1) / 2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MGMT.x1 - MGMT.x0, MGMT.z1 - MGMT.z0), new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0.005, cz);
    s.add(floor);
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false });
    const frame = new THREE.MeshStandardMaterial({ color: 0x20252c, metalness: 0.6, roughness: 0.4 });
    const H = 3;
    const wall = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, H, 0.04), glass);
      m.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      s.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), frame);
      top.position.set(m.position.x, H, m.position.z); top.rotation.y = m.rotation.y;
      s.add(top);
    };
    wall(MGMT.x0, MGMT.z0, MGMT.door[0], MGMT.z0); wall(MGMT.door[1], MGMT.z0, MGMT.x1, MGMT.z0);
    wall(MGMT.x0, MGMT.z0, MGMT.x0, MGMT.z1); wall(MGMT.x1, MGMT.z0, MGMT.x1, MGMT.z1);
    const lamp = new THREE.PointLight(0xffd9a0, 14, 14, 1.2);
    lamp.position.set(cx, 2.7, 7.2);
    s.add(lamp);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.9), new THREE.MeshBasicMaterial({ map: this.label('MANAGEMENT', 1024, 160, '#ffb547', '#0d1016', 110, '800'), toneMapped: false }));
    sign.position.set(cx, H + 0.6, MGMT.z0 - 0.05);
    sign.rotation.y = Math.PI;
    s.add(sign);
    // big desk facing the door, three executive chairs behind it
    const desk = new THREE.Mesh(new THREE.BoxGeometry(MGMT.x1 - MGMT.x0 - 8, 0.08, 1.2), new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.4, metalness: 0.1 }));
    desk.position.set(cx, 0.78, 8.8);
    s.add(desk);
    const front = new THREE.Mesh(new THREE.BoxGeometry(MGMT.x1 - MGMT.x0 - 8, 0.74, 0.06), new THREE.MeshStandardMaterial({ color: 0x2c1b10 }));
    front.position.set(cx, 0.37, 8.2);
    s.add(front);
    this.mgmtSeats = [-2.4, 0, 2.4].map((dx) => {
      const g = new THREE.Group();
      const leather = new THREE.MeshStandardMaterial({ color: 0x5a1f1a, roughness: 0.5 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.65), leather); seat.position.set(0, 0.5, 0); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.12), leather); back.position.set(0, 1.05, 0.33); g.add(back);
      g.position.set(cx + dx, 0, 9.9);
      g.rotation.y = Math.PI;   // facing -z (towards the door and the office)
      s.add(g);
      // nameplate on the desk
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      plate.position.set(cx + dx, 0.94, 8.18);
      plate.rotation.y = Math.PI;
      s.add(plate);
      return { pos: new THREE.Vector3(cx + dx, 0, 9.85), c, tex, taken: false };
    });
  }

  nameplate(seat, text) {
    const g = seat.c.getContext('2d');
    g.fillStyle = '#c9a24a'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#1b1406'; g.font = '700 46px "Segoe UI", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 64);
    seat.tex.needsUpdate = true;
  }
}
