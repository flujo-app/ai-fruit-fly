// Small drawing helpers shared by the Doom Gym page and the Doom Cubicles office.
import { FRAME_W, FRAME_H } from './game.js';
import { readLevel, buildNav, mapLines } from './level.js';

export function scoreColour(s) {
  const t = Math.max(0, Math.min(1, s / 8));
  const h = t < 0.5 ? t * 2 * 38 : 38 + (t - 0.5) * 2 * 100;
  return `hsl(${h}, 85%, ${45 + t * 10}%)`;
}

// Turns Doom's pictures (one palette number per pixel) into something a canvas can draw.
export class Screens {
  constructor(palettes) {
    // 14 palettes of 256 colours as ready-made 32-bit pixels (red after damage, gold after a pickup)
    this.lut = new Uint32Array(14 * 256);
    for (let p = 0; p < 14; p++) for (let i = 0; i < 256; i++) {
      const o = p * 768 + i * 3;
      this.lut[p * 256 + i] = 0xff000000 | (palettes[o + 2] << 16) | (palettes[o + 1] << 8) | palettes[o];
    }
    this.cache = new Map();
  }

  // a w x h canvas holding the picture
  canvasOf(frame, pal, w = FRAME_W, h = FRAME_H, key = 'tmp') {
    let c = this.cache.get(key);
    if (!c || c.canvas.width !== w || c.canvas.height !== h) {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      c = { canvas, ctx, img, px: new Uint32Array(img.data.buffer) };
      this.cache.set(key, c);
    }
    const lut = this.lut, base = (pal | 0) * 256, px = c.px;
    for (let i = 0; i < px.length; i++) px[i] = lut[base + frame[i]];
    c.ctx.putImageData(c.img, 0, 0);
    return c.canvas;
  }
}

// What the fly's eyes get: one dot per facet that looks at the screen (left eye bluish, right eye yellowish).
export function drawFacets(ctx, w, h, rig, lum, screenDeg) {
  ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, w, h);
  if (!lum) return 0;
  const half = screenDeg / 2, halfV = half * 0.75, r = Math.max(1.6, (rig.meta.facetDeg / screenDeg) * w * 0.52);
  const az = rig.colAz, el = rig.colEl, side = rig.colSide;
  let n = 0;
  for (let c = 0; c < az.length; c++) {
    if (Math.abs(az[c]) >= half || Math.abs(el[c]) >= halfV) continue;
    n++;
    const x = (az[c] / half * 0.5 + 0.5) * w, y = (0.5 - el[c] / halfV * 0.5) * h;
    const v = Math.min(1, lum[c] * 1.7);
    ctx.fillStyle = side[c] ? `rgba(${255 * v | 0},${235 * v | 0},${170 * v | 0},0.85)` : `rgba(${170 * v | 0},${225 * v | 0},${255 * v | 0},0.85)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  return n;
}

// The whole brain from the front: one faint dot per neuron, and a flash where a neuron just fired.
const CLASS_RGB = [[107, 114, 128], [47, 91, 255], [157, 92, 255], [47, 227, 154], [44, 200, 255], [255, 210, 61], [255, 122, 47], [163, 255, 61], [31, 209, 193], [255, 61, 110], [255, 95, 210]];
export class BrainDots {
  constructor(canvas, buf) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    const n = this.n = new DataView(buf).getUint32(4, true);
    const xyz = new Float32Array(buf, 8, n * 3), cls = new Uint8Array(buf, 8 + n * 12, n);
    const w = this.w = canvas.width, h = this.h = canvas.height;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < n; i++) { const x = xyz[3 * i], y = xyz[3 * i + 1]; if (x === 0 && y === 0) continue; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const k = Math.min((w - 8) / (maxX - minX), (h - 8) / (maxY - minY)), ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
    this.pixel = new Int32Array(n);
    const base = new Float32Array(w * h * 3);
    for (let i = 0; i < n; i++) {
      const x = Math.round(ox + (xyz[3 * i] - minX) * k), y = Math.round(oy + (xyz[3 * i + 1] - minY) * k);
      const p = x >= 0 && x < w && y >= 0 && y < h ? y * w + x : -1;
      this.pixel[i] = p;
      if (p < 0) continue;
      const c = CLASS_RGB[cls[i]] || CLASS_RGB[0];
      base[3 * p] += c[0] * 0.05; base[3 * p + 1] += c[1] * 0.05; base[3 * p + 2] += c[2] * 0.05;
    }
    this.base = base; this.heat = new Float32Array(w * h);
    this.img = this.ctx.createImageData(w, h);
    this.draw(0);
  }
  spikes(list, weight = 1) { const { pixel, heat } = this; for (let k = 0; k < list.length; k++) { const p = pixel[list[k]]; if (p >= 0) heat[p] += weight; } }
  draw(dt) {
    const { base, heat, img } = this, d = img.data, f = Math.exp(-dt / 0.12);
    for (let p = 0, o = 0; p < heat.length; p++, o += 4) {
      const hh = heat[p]; heat[p] = hh > 0.01 ? hh * f : 0;
      const a = Math.min(1, hh * 0.5);
      d[o] = Math.min(255, base[3 * p] + 255 * a); d[o + 1] = Math.min(255, base[3 * p + 1] + 245 * a); d[o + 2] = Math.min(255, base[3 * p + 2] + 200 * a); d[o + 3] = 255;
    }
    this.ctx.putImageData(img, 0, 0);
  }
}

// The small map of a real level: its walls, the way to the exit, where a fly went and where it is now.
// (Made from the game file for the people watching; the fly never gets any of it.)
export class LevelMap {
  constructor(wad, map = 1, skill = 3) {
    const level = readLevel(wad, map), nav = this.nav = buildNav(level, skill);
    this.lines = mapLines(level); this.start = level.start;
    // the part of the level a player can get to, with a margin
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < nav.reach.length; i++) if (nav.reach[i]) {
      const x = nav.x0 + (i % nav.W) * nav.cell, y = nav.y0 + Math.floor(i / nav.W) * nav.cell;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    this.b = { minX: minX - 96, minY: minY - 96, maxX: maxX + 96, maxY: maxY + 96 };
  }

  // Draws into the box (x, y, w, h) of a canvas. path: x, y pairs of where a fly went; upTo: how many of
  // those points have been walked so far (the rest is drawn faintly); at: [x, y] where the fly is now;
  // others: [[x, y], ...] where the flies are that play right now.
  draw(g, x, y, w, h, { path = null, upTo = Infinity, at = null, others = null, bg = '#0b0e14', label = true } = {}) {
    const b = this.b, bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const turned = (bh > bw) !== (h > w);              // a tall level in a wide box is laid on its side
    const k = Math.min(w / (turned ? bh : bw), h / (turned ? bw : bh));
    const ox = x + (w - k * (turned ? bh : bw)) / 2, oy = y + (h - k * (turned ? bw : bh)) / 2;
    const X = turned ? (px, py) => ox + (py - b.minY) * k : (px) => ox + (px - b.minX) * k;
    const Y = turned ? (px) => oy + (px - b.minX) * k : (px, py) => oy + (b.maxY - py) * k;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const stroke = (kind, colour, width) => {
      g.strokeStyle = colour; g.lineWidth = width; g.beginPath();
      for (const [x1, y1, x2, y2, kd] of this.lines) if (kd === kind) { g.moveTo(X(x1, y1), Y(x1, y1)); g.lineTo(X(x2, y2), Y(x2, y2)); }
      g.stroke();
    };
    const u = Math.max(1, w / 320);                    // line widths grow with the box
    stroke(1, 'rgba(141,150,167,0.28)', 0.6 * u);
    stroke(0, '#aeb4c2', 0.9 * u);
    stroke(2, '#ffb547', 2 * u);
    stroke(3, '#45d483', 3 * u);
    // the way to the exit, dotted
    const r = this.nav.route;
    g.fillStyle = 'rgba(95,212,255,0.55)';
    for (let i = 0; i < r.length; i += 3) g.fillRect(X(r[i][0], r[i][1]) - 0.7 * u, Y(r[i][0], r[i][1]) - 0.7 * u, 1.4 * u, 1.4 * u);
    // where the fly went
    if (path && path.length >= 4) {
      const n = path.length / 2, done = Math.max(1, Math.min(n, Math.floor(upTo)));
      const line = (from, to, colour, width) => {
        if (to - from < 1) return;
        g.strokeStyle = colour; g.lineWidth = width; g.beginPath();
        for (let i = from; i <= to && i < n; i++) { const px = path[2 * i], py = path[2 * i + 1]; i === from ? g.moveTo(X(px, py), Y(px, py)) : g.lineTo(X(px, py), Y(px, py)); }
        g.stroke();
      };
      line(done - 1, n - 1, 'rgba(255,255,255,0.22)', 1.2 * u);
      line(0, done - 1, '#ffffff', 1.8 * u);
    }
    const s = this.start, e = this.nav.exit;
    g.fillStyle = '#5fd4ff'; g.beginPath(); g.arc(X(s.x, s.y), Y(s.x, s.y), 3 * u, 0, 6.2832); g.fill();
    g.fillStyle = '#45d483'; g.fillRect(X(e.x, e.y) - 3.5 * u, Y(e.x, e.y) - 3.5 * u, 7 * u, 7 * u);
    if (label) {
      g.font = `600 ${Math.round(9 * u)}px system-ui, sans-serif`; g.textBaseline = 'middle';
      g.fillStyle = '#5fd4ff'; g.fillText('start', X(s.x, s.y) + 6 * u, Y(s.x, s.y));
      g.fillStyle = '#45d483'; g.fillText('exit', X(e.x, e.y) + 7 * u, Y(e.x, e.y));
      g.textBaseline = 'alphabetic';
    }
    if (others) { g.fillStyle = '#a98bff'; for (const [px, py] of others) { g.beginPath(); g.arc(X(px, py), Y(px, py), 2.4 * u, 0, 6.2832); g.fill(); } }
    if (at) { g.fillStyle = '#ff5d62'; g.strokeStyle = '#fff'; g.lineWidth = u; g.beginPath(); g.arc(X(at[0], at[1]), Y(at[0], at[1]), 3.2 * u, 0, 6.2832); g.fill(); g.stroke(); }
    g.restore();
  }
}
