// The winner's döner app, running: the program the winning fly typed, run with the real three.js in
// the same shop as the Fly Gym's preview (shop.js), with a slow camera move round to the side. Next to
// it, the program itself, with the fly's own choices in amber, and the customer's 8 tests.
// It is the last shot of an autopilot video, and key 3 shows it once a fly has won.
import * as THREE from 'three';
import { doenerShop } from '../gym/shop.js';
import { COUNTER_TOP, SLICE, TESTS } from '../gym/judge.js';
import { codeRows } from './flies.js';

const SPLIT = 0.61;   // the app gets the left 61% of the picture, the program the rest
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export class WinnerShow {
  constructor() {
    this.winner = null;
    this.active = false;
    this.panel = document.createElement('canvas');
    this.panelTex = new THREE.CanvasTexture(this.panel);
    this.panelTex.colorSpace = THREE.SRGBColorSpace;
    this.panelTex.generateMipmaps = false;
    this.panelTex.minFilter = THREE.LinearFilter;
    // the program panel and a black layer for fading in and out, drawn over the app
    this.overlay = new THREE.Scene();
    this.ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.panelTex, depthTest: false, depthWrite: false, toneMapped: false }));
    this.black = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false }));
    this.black.position.set(0.5, 0.5, 0);
    this.black.renderOrder = 1;
    this.overlay.add(this.panelMesh, this.black);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.size = new THREE.Vector2();
  }

  // remember the winner: { code, tokens, score, passed, part, fly, lab }
  setWinner(w) { this.winner = w; }

  start(now) {
    if (!this.winner) return false;
    this.stop();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d1712);
    this.shop = doenerShop(THREE, scene, COUNTER_TOP, SLICE);
    // the fly's program, as it would run in its own web page (one program, compiled once)
    try {
      const run = new Function('THREE', 'scene', 'knife', `"use strict";\nlet spin = () => {};\n${this.winner.code}\nreturn spin;`);
      this.spin = run(THREE, scene, this.shop.knife);
    } catch (err) {
      console.error('the winning program did not run:', err);
      this.spin = () => {};
    }
    this.scene = scene;
    this.t0 = now;
    this.endAt = 0;
    this.panelDrawn = '';
    this.active = true;
    return true;
  }

  // fade to black, then stop
  end(now, ms = 900) { if (this.active && !this.endAt) { this.endAt = now; this.fadeMs = ms; } }

  stop() {
    if (!this.scene) return;
    this.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.scene = null;
    this.active = false;
  }

  render(renderer, dt, now) {
    if (!this.active) return;
    if (this.endAt && now - this.endAt > this.fadeMs) { this.stop(); return; }
    renderer.getSize(this.size);
    const W = this.size.x, H = this.size.y, split = Math.round(W * SPLIT);
    try { this.spin(dt); } catch { this.spin = () => {}; }
    this.shop.update(dt);
    // from the app's own front view slowly round to the side, where the grill behind the meat shows
    const k = ease(Math.min(1, (now - this.t0) / 14000));
    const a = 0.29 + 0.6 * k, r = 9.2 - 0.5 * k;
    this.camera.position.set(Math.sin(a) * r, 1.5 + 0.7 * k, Math.cos(a) * r);
    this.camera.lookAt(0, -0.2, -0.4 * k);
    this.camera.aspect = split / H;
    this.camera.updateProjectionMatrix();
    // the app looks like it does on its own page (no tone mapping there)
    const toneMapping = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setViewport(0, 0, split, H);
    renderer.setScissor(0, 0, split, H);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.toneMapping = toneMapping;
    // the program panel, and the fade
    const px = renderer.getPixelRatio();
    this.drawPanel(Math.round((W - split) * px), Math.round(H * px));
    const f = split / W;
    this.panelMesh.scale.set(1 - f, 1, 1);
    this.panelMesh.position.set((1 + f) / 2, 0.5, 0);
    const fadeIn = 1 - Math.min(1, (now - this.t0) / 500);
    const fadeOut = this.endAt ? Math.min(1, (now - this.endAt) / this.fadeMs) : 0;
    this.black.material.opacity = Math.max(fadeIn, fadeOut);
    this.black.visible = this.black.material.opacity > 0.001;
    renderer.render(this.overlay, this.ortho);
  }

  drawPanel(w, h) {
    const key = `${w}x${h}`;
    if (this.panelDrawn === key) return;
    this.panelDrawn = key;
    const c = this.panel, g = c.getContext('2d'), win = this.winner, s = h / 1080;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.panelTex.dispose(); }
    g.fillStyle = '#0f1218'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb547'; g.fillRect(0, 0, 4 * s, h);
    const x0 = 36 * s;
    let y = 205 * s;   // below the caption
    g.textBaseline = 'alphabetic';
    g.font = `700 ${Math.round(34 * s)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#ffb547';
    g.fillText(`Fly ${win.fly + 1} · Lab ${win.lab + 1}`, x0, y);
    g.font = `600 ${Math.round(22 * s)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = win.passed === 8 ? '#45d483' : '#8d96a7';
    g.textAlign = 'right';
    g.fillText(`${win.score.toFixed(2)} / 8 · ${win.passed}/8 tests`, w - x0, y);
    g.textAlign = 'left';
    y += 40 * s;
    g.fillStyle = '#8d96a7';
    g.fillText('The program it typed, token by token:', x0, y);
    // the code: as big as fits, with room for the tests below
    const testsH = (TESTS.length * 31 + 90) * s;
    let size = 22, rows = [];
    for (; size >= 12; size--) {
      g.font = `${Math.round(size * s)}px ui-monospace, Consolas, monospace`;
      const cols = Math.floor((w - 2 * x0) / g.measureText('M').width);
      rows = codeRows(win.tokens, win.tokens.length, cols);
      while (rows.length && !rows[rows.length - 1].length) rows.pop();
      if (y + 24 * s + rows.length * size * 1.3 * s < h - testsH) break;
    }
    y += 22 * s;
    for (const row of rows) {
      y += size * 1.3 * s;
      let x = x0;
      for (const { s: txt, c: col } of row) { g.fillStyle = col; g.fillText(txt, x, y); x += g.measureText(txt).width; }
    }
    // the customer's 8 tests
    y = h - testsH + 40 * s;
    g.font = `600 ${Math.round(22 * s)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#8d96a7';
    g.fillText('The customer’s 8 tests:', x0, y);
    g.font = `${Math.round(19 * s)}px "Segoe UI", system-ui, sans-serif`;
    for (const [k, label] of TESTS) {
      y += 31 * s;
      const ok = !!(win.part && win.part[k] > 0.99);
      g.fillStyle = ok ? '#45d483' : '#ff5d6c';
      g.fillText(ok ? '✓' : '✗', x0, y);
      g.fillStyle = '#c7ccd6';
      g.fillText(label.replace(/ \(.*\)/, ''), x0 + 28 * s, y);
    }
    g.font = `${Math.round(17 * s)}px "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = '#5f6878';
    g.fillText('amber: chosen by the fly · grey: filled in by autocomplete', x0, h - 24 * s);
    this.panelTex.needsUpdate = true;
  }
}
