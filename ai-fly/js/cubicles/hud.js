// Text on top of the 3D view (status line, crosshair, prompts, messages, captions). It is drawn into
// the WebGL picture itself, so a recording of the canvas includes it.
import * as THREE from 'three';
import { clock } from './clock.js';

export class Hud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })));
    this.state = { status: '', prompt: '', target: '', caption: '', help: '', rec: false, crosshair: true };
    this.toasts = [];
    this.dirty = true;
    this.lastDraw = 0;
  }

  resize(w, h) {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.tex.dispose();
    this.dirty = true;
  }

  set(fields) {
    for (const [k, v] of Object.entries(fields)) if (this.state[k] !== v) { this.state[k] = v; this.dirty = true; }
  }

  toast(text, seconds = 5) {
    const now = clock.now();
    this.toasts.push({ text, until: now + seconds * 1000, at: now });
    if (this.toasts.length > 3) this.toasts.shift();
    this.dirty = true;
  }

  render(renderer, now) {
    this.toasts = this.toasts.filter((t) => t.until > now);
    const animating = this.toasts.length || this.state.rec;
    // redraw for fading messages a few times a second, for the REC blink twice a second
    if (this.dirty || (animating && now - this.lastDraw > (this.toasts.length ? 120 : 500))) this.draw(now);
    renderer.render(this.scene, this.camera);
  }

  draw(now) {
    this.dirty = false;
    this.lastDraw = now;
    const c = this.canvas, g = c.getContext('2d'), W = c.width, H = c.height, k = H / 1080;
    g.clearRect(0, 0, W, H);
    const font = (w, px) => `${w} ${Math.round(px * k)}px "Segoe UI", system-ui, sans-serif`;
    const pill = (text, x, y, size, color, bg, align = 'left', weight = 600) => {
      g.font = font(weight, size);
      const tw = g.measureText(text).width, pad = 14 * k, h = size * k * 1.55;
      const x0 = align === 'center' ? x - tw / 2 - pad : align === 'right' ? x - tw - 2 * pad : x;
      g.fillStyle = bg; roundRect(g, x0, y, tw + 2 * pad, h, 10 * k); g.fill();
      g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, x0 + pad, y + h / 2 + 1);
      return h;
    };
    const s = this.state;
    // status line, top left
    if (s.status) pill(s.status, 24 * k, 22 * k, 24, '#eceef3', 'rgba(11,13,18,0.72)');
    if (s.rec) {
      const on = Math.floor(now / 500) % 2 === 0;
      g.font = font(800, 24);
      const tw = g.measureText('REC').width;
      g.fillStyle = 'rgba(11,13,18,0.72)'; roundRect(g, W - tw - 90 * k, 22 * k, tw + 66 * k, 38 * k, 10 * k); g.fill();
      g.fillStyle = on ? '#ff2d55' : '#5a1020'; g.beginPath(); g.arc(W - tw - 62 * k, 41 * k, 9 * k, 0, 7); g.fill();
      g.fillStyle = '#eceef3'; g.textBaseline = 'middle'; g.fillText('REC', W - tw - 44 * k, 42 * k);
    }
    // caption, top centre
    if (s.caption) pill(s.caption, W / 2, 84 * k, 36, '#ffffff', 'rgba(11,13,18,0.8)', 'center', 700);
    // crosshair and what it points at
    if (s.crosshair) {
      g.strokeStyle = s.target ? '#ffb547' : 'rgba(255,255,255,0.75)'; g.lineWidth = 2.5 * k;
      g.beginPath(); g.arc(W / 2, H / 2, (s.target ? 11 : 6) * k, 0, 7); g.stroke();
      if (s.target) pill(s.target, W / 2, H / 2 + 26 * k, 24, '#241503', '#ffb547', 'center', 700);
    }
    // prompt and messages, bottom centre
    let y = H - 70 * k;
    if (s.prompt) { y -= 8 * k; pill(s.prompt, W / 2, y - 30 * k, 28, '#241503', '#ffb547', 'center', 700); y -= 60 * k; }
    for (const t of [...this.toasts].reverse()) {
      const a = Math.min(1, (t.until - now) / 600, (now - t.at) / 200);
      g.globalAlpha = Math.max(0, a);
      y -= pill(t.text, W / 2, y - 44 * k, 28, '#eceef3', 'rgba(11,13,18,0.82)', 'center') + 10 * k;
      g.globalAlpha = 1;
    }
    // help, bottom left
    if (s.help) pill(s.help, 24 * k, H - 64 * k, 20, '#c7ccd6', 'rgba(11,13,18,0.6)', 'left', 500);
    this.tex.needsUpdate = true;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
