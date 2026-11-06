// The supervisor deck: a big wall screen with the live Fly Gym, and a console of real push buttons
// (pause, 1x, 4x, max speed, new flies, record) that sink when pressed.
import * as THREE from 'three';
import { drawShop } from '../gym/wall.js';
import { COLORS, NEWLINE } from '../gym/grammar.js';
import { SCREEN, CONSOLE, DECK } from './layout.js';

export const BUTTONS = [
  { id: 'pause', label: 'PAUSE', color: 0x9aa4b5 },
  { id: '1', label: '1×', color: 0x45d483 },
  { id: '4', label: '4×', color: 0xffb547 },
  { id: 'max', label: 'MAX', color: 0xff6a3d },
  { id: 'reset', label: 'NEW FLIES', color: 0xd63b3b },
  { id: 'rec', label: 'REC', color: 0xff2d55 },
];

export class Supervisor {
  constructor(scene) {
    this.scene = scene;
    // ---------------------------------------------------------------- the wall screen
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1920; this.canvas.height = 1080;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    screen.position.set(SCREEN.x, SCREEN.y, SCREEN.z - 0.06);
    screen.rotation.y = Math.PI;
    scene.add(screen);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w + 0.3, SCREEN.h + 0.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.4, metalness: 0.5 }));
    bezel.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
    scene.add(bezel);
    this.screenLight = new THREE.PointLight(0x9fc4ff, 6, 14, 1.4);
    this.screenLight.position.set(0, SCREEN.y, SCREEN.z - 3);
    scene.add(this.screenLight);

    // ---------------------------------------------------------------- the console
    const y0 = DECK.y;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a414d, roughness: 0.55, metalness: 0.5 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(CONSOLE.w, 0.82, CONSOLE.d), metal);
    desk.position.set(CONSOLE.x, y0 + 0.41, CONSOLE.z);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(CONSOLE.w + 0.01, 0.04, CONSOLE.d + 0.01), new THREE.MeshBasicMaterial({ color: 0xffb547 }));
    stripe.position.set(CONSOLE.x, y0 + 0.62, CONSOLE.z);
    scene.add(stripe);
    scene.add(desk);
    this.panel = new THREE.Group();
    this.panel.position.set(CONSOLE.x, y0 + 1.0, CONSOLE.z);
    this.panel.rotation.x = -0.32;   // tilted towards the supervisor (who stands at smaller z, looking at +z)
    scene.add(this.panel);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(CONSOLE.w - 0.1, 0.06, CONSOLE.d - 0.1), new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6 }));
    this.panel.add(plate);
    // printed labels under the buttons
    const lc = document.createElement('canvas'); lc.width = 2048; lc.height = 128;
    const lg = lc.getContext('2d');
    lg.fillStyle = '#e9edf3'; lg.font = '700 58px "Segoe UI", system-ui'; lg.textAlign = 'center'; lg.textBaseline = 'middle';
    const spacing = (CONSOLE.w - 0.6) / (BUTTONS.length - 1);
    BUTTONS.forEach((b, i) => lg.fillText(b.label, ((0.3 + i * spacing) / CONSOLE.w) * 2048, 64));
    const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace;
    const labels = new THREE.Mesh(new THREE.PlaneGeometry(CONSOLE.w, CONSOLE.w / 16), new THREE.MeshBasicMaterial({ map: ltex, transparent: true, toneMapped: false }));
    labels.rotation.set(-Math.PI / 2, 0, Math.PI);   // readable for someone facing +z
    labels.position.set(0, 0.032, -0.3);
    this.panel.add(labels);
    // the buttons themselves
    this.buttons = new Map();
    BUTTONS.forEach((b, i) => {
      const x = CONSOLE.w / 2 - 0.3 - i * spacing;   // the supervisor faces +z, so their left is +x
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.05, 28), new THREE.MeshStandardMaterial({ color: 0x0a0b0e, metalness: 0.7, roughness: 0.3 }));
      ring.position.set(x, 0.045, 0.05);
      this.panel.add(ring);
      const capMat = new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: 0.15, roughness: 0.35 });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.07, 28), capMat);
      cap.position.set(x, 0.09, 0.05);
      cap.userData.button = b.id;
      this.panel.add(cap);
      this.buttons.set(b.id, { cap, mat: capMat, rest: 0.09, pressT: 0, active: false });
    });
    this.targets = [...this.buttons.values()].map((b) => b.cap);
  }

  // a button sinks for a moment; the active speed stays a little down and glows
  press(id) { const b = this.buttons.get(id); if (b) b.pressT = 0.22; }
  setActive(ids) { for (const [id, b] of this.buttons) b.active = ids.includes(id); }

  update(dt, t) {
    for (const [id, b] of this.buttons) {
      b.pressT = Math.max(0, b.pressT - dt);
      const down = b.pressT > 0 ? 0.035 : b.active ? 0.015 : 0;
      b.cap.position.y += (b.rest - down - b.cap.position.y) * Math.min(1, dt * 30);
      const glow = b.active ? (id === 'rec' ? 0.6 + 0.5 * Math.sin(t * 6) : 0.9) : 0.15;
      b.mat.emissiveIntensity += (glow - b.mat.emissiveIntensity) * Math.min(1, dt * 10);
    }
  }

  // ---------------------------------------------------------------- what the wall screen shows
  draw(s) {
    const g = this.canvas.getContext('2d'), W = 1920, H = 1080;
    g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    // header
    g.fillStyle = '#ffb547'; g.font = '800 30px "Segoe UI", system-ui'; g.fillText('FLY GYM · LIVE FROM THE CUBICLES', 48, 66);
    g.fillStyle = '#eceef3'; g.font = '700 52px "Segoe UI", system-ui'; g.fillText('1,024 fruit flies type a döner app', 48, 128);
    g.textAlign = 'right';
    g.fillStyle = s.paused ? '#9aa4b5' : '#45d483'; g.font = '800 44px "Segoe UI", system-ui';
    g.fillText(s.paused ? (s.gen ? 'PAUSED' : 'PRESS 1×, 4× OR MAX TO START') : `SPEED ${s.speedLabel}`, W - 48, 74);
    g.fillStyle = '#8d96a7'; g.font = '500 30px "Segoe UI", system-ui';
    g.fillText(s.paused ? 'buttons on the console below' : `${s.genPerSec.toFixed(1)} generations per second`, W - 48, 120);
    if (s.recording) { g.fillStyle = '#ff2d55'; g.beginPath(); g.arc(W - 48 - g.measureText('buttons on the console below').width - 40, 110, 12, 0, 7); g.fill(); }
    g.textAlign = 'left';
    // stat tiles
    const tiles = [['GENERATION', s.gen.toLocaleString('en')], ['FLIES', '1,024'], ['BEST SCORE', s.best != null ? `${s.best.toFixed(2)} / 8` : '–'],
      ['AVERAGE', s.mean != null ? s.mean.toFixed(2) : '–'], ['PERFECT DÖNERS', String(s.solved || 0)], ['PROGRAMS WRITTEN', s.programs.toLocaleString('en')]];
    const tw = (W - 96 - 5 * 16) / 6;
    tiles.forEach(([k, v], i) => {
      const x = 48 + i * (tw + 16);
      g.fillStyle = '#141820'; g.fillRect(x, 160, tw, 116);
      g.fillStyle = '#8d96a7'; g.font = '600 22px "Segoe UI", system-ui'; g.fillText(k, x + 20, 200);
      g.fillStyle = k === 'PERFECT DÖNERS' && s.solved ? '#45d483' : '#eceef3'; g.font = '700 46px "Segoe UI", system-ui'; g.fillText(v, x + 20, 254);
    });
    // banner
    let top = 300;
    if (s.banner) {
      g.fillStyle = 'rgba(69,212,131,0.16)'; g.fillRect(48, top, W - 96, 84);
      g.strokeStyle = '#45d483'; g.lineWidth = 3; g.strokeRect(48, top, W - 96, 84);
      g.fillStyle = '#45d483'; g.font = '800 38px "Segoe UI", system-ui'; g.fillText(s.banner, 72, top + 55);
      top += 100;
    }
    // every fly's shop, one tile each, grouped by lab
    const cell = s.banner ? 11 : 12, labW = 16 * cell, labH = 8 * cell;
    g.fillStyle = '#8d96a7'; g.font = '700 22px "Segoe UI", system-ui'; g.fillText("EVERY FLY'S CURRENT DÖNER SHOP", 48, top + 26);
    for (let lab = 0; lab < 8; lab++) {
      const ox = 48 + (lab % 4) * (labW + 22), oy = top + 44 + Math.floor(lab / 4) * (labH + 40);
      g.fillStyle = '#5f6878'; g.font = '600 18px "Segoe UI", system-ui'; g.fillText(`LAB ${lab + 1}`, ox, oy + 14);
      const d = s.results && s.results[lab] && s.results[lab].summary;
      for (let f = 0; f < 128; f++) drawShop(g, ox + (f % 16) * cell, oy + 22 + Math.floor(f / 16) * cell, cell, d, f, s.time);
    }
    // progress chart
    const cx = 48 + 4 * (labW + 22) + 20, cy = top + 44, cw = W - 48 - cx, ch = 2 * labH + 62;
    g.fillStyle = '#141820'; g.fillRect(cx, cy, cw, ch);
    g.fillStyle = '#8d96a7'; g.font = '700 22px "Segoe UI", system-ui'; g.fillText('PROGRESS', cx + 18, cy + 32);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    const L = cx + 50, R = cx + cw - 18, T = cy + 48, B = cy + ch - 20;
    for (const v of [0, 2, 4, 6, 8]) {
      const y = B - (v / 8) * (B - T);
      g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
      g.fillStyle = '#5f6878'; g.font = '16px system-ui'; g.fillText(String(v), cx + 22, y + 5);
    }
    const h = s.history || [];
    if (h.length) {
      const n = Math.max(h.length, 50), X = (i) => L + (i / (n - 1)) * (R - L);
      g.fillStyle = 'rgba(69,212,131,0.3)'; g.beginPath(); g.moveTo(X(0), B);
      h.forEach((p, i) => g.lineTo(X(i), B - p.solved * (B - T)));
      g.lineTo(X(h.length - 1), B); g.closePath(); g.fill();
      for (const [k, col] of [['mean', '#a98bff'], ['best', '#ffb547']]) {
        g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
        h.forEach((p, i) => (i ? g.lineTo(X(i), B - (p[k] / 8) * (B - T)) : g.moveTo(X(i), B - (p[k] / 8) * (B - T))));
        g.stroke();
      }
    }
    // the best fly's program
    const py = top + 44 + 2 * (labH + 40) + 14;
    g.fillStyle = '#8d96a7'; g.font = '700 22px "Segoe UI", system-ui';
    g.fillText(s.champ ? `BEST FLY RIGHT NOW · LAB ${s.champ.lab + 1}, FLY ${s.champ.fly + 1} · ${s.champ.passed}/8 TESTS` : 'BEST FLY RIGHT NOW', 48, py);
    if (s.champ) {
      g.font = '22px ui-monospace, Consolas, monospace';
      const lines = [[]];
      let prev = '\n';
      for (const { t, d } of s.champ.tokens) {
        if (t === '\n') { lines.push([]); prev = '\n'; continue; }
        if (t === 'END' || t === NEWLINE) continue;
        const tight = prev === '\n' || ['.', ')', ',', ';', ':'].includes(t) || prev === '.' || prev === '(' || (t === '(' && /^[A-Za-z_$][\w$]*$/.test(prev));
        lines[lines.length - 1].push({ s: (tight ? '' : ' ') + t, c: d ? '#ffb547' : COLORS[t] ? '#' + t.slice(2) : '#7d8696' });
        prev = t;
      }
      const maxLines = Math.floor((H - py - 30) / 27);
      lines.slice(0, maxLines).forEach((ln, r) => {
        let x = 48;
        for (const { s: txt, c } of ln) { if (x > W - 60) break; g.fillStyle = c; g.fillText(txt, x, py + 36 + r * 27); x += g.measureText(txt).width; }
      });
    }
    this.tex.needsUpdate = true;
  }
}
