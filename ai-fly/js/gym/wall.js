// The wall: one tiny front-view thumbnail of every fly's döner shop, drawn from its program.
const PER = 11, SLOTS = 6, STRIDE = 2 + SLOTS * PER;

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
function scoreColour(s) {
  // red (0) -> amber (4) -> green (8)
  const t = Math.max(0, Math.min(1, s / 8));
  const h = t < 0.5 ? 0 + t * 2 * 38 : 38 + (t - 0.5) * 2 * 100;
  return `hsl(${h}, 85%, ${45 + t * 10}%)`;
}

export class Wall {
  constructor(canvas, labs, perLab) {
    this.canvas = canvas;
    this.labs = labs;
    this.perLab = perLab;
    this.data = Array.from({ length: labs }, () => null);
    this.highlight = null;   // [lab, fly]
    this.layout();
  }

  layout() {
    const c = this.canvas;
    const w = c.clientWidth;
    const labCols = this.labs >= 8 ? 4 : this.labs >= 4 ? 2 : this.labs;
    const labRows = Math.ceil(this.labs / labCols);
    const flyCols = Math.ceil(Math.sqrt(this.perLab * 2));    // labs are twice as wide as tall
    const flyRows = Math.ceil(this.perLab / flyCols);
    const gap = 10;
    const cell = Math.floor((w - gap * (labCols - 1)) / (labCols * flyCols));
    this.geom = { labCols, labRows, flyCols, flyRows, gap, cell, labW: cell * flyCols, labH: cell * flyRows + 16 };
    const h = labRows * this.geom.labH + (labRows - 1) * gap;
    c.style.height = `${h}px`;
    c.width = Math.round(w * devicePixelRatio);
    c.height = Math.round(h * devicePixelRatio);
  }

  cellAt(px, py) {
    const g = this.geom;
    const lc = Math.floor(px / (g.labW + g.gap)), lr = Math.floor(py / (g.labH + g.gap));
    const lab = lr * g.labCols + lc;
    if (lab >= this.labs || lc >= g.labCols) return null;
    const x = px - lc * (g.labW + g.gap), y = py - lr * (g.labH + g.gap) - 16;
    if (x < 0 || y < 0 || x >= g.labW) return null;
    const fly = Math.floor(y / g.cell) * g.flyCols + Math.floor(x / g.cell);
    return fly < this.perLab ? [lab, fly] : null;
  }

  draw(time, labStats) {
    const c = this.canvas, g = this.geom, ctx = c.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    for (let lab = 0; lab < this.labs; lab++) {
      const ox = (lab % g.labCols) * (g.labW + g.gap), oy = Math.floor(lab / g.labCols) * (g.labH + g.gap);
      const st = labStats && labStats[lab];
      ctx.fillStyle = '#8d96a7';
      ctx.font = '600 10.5px system-ui, sans-serif';
      ctx.fillText(`LAB ${lab + 1}`, ox, oy + 10);
      if (st) {
        ctx.fillStyle = st.solved ? '#45d483' : '#5f6878';
        ctx.textAlign = 'right';
        ctx.fillText(st.solved ? `${st.solved} perfect` : `best ${st.best.toFixed(1)}`, ox + g.labW, oy + 10);
        ctx.textAlign = 'left';
      }
      const d = this.data[lab];
      for (let f = 0; f < this.perLab; f++) {
        const x = ox + (f % g.flyCols) * g.cell, y = oy + 16 + Math.floor(f / g.flyCols) * g.cell;
        this.drawCell(ctx, x, y, g.cell, d, f, time);
      }
    }
    if (this.highlight) {
      const [lab, f] = this.highlight;
      const ox = (lab % g.labCols) * (g.labW + g.gap), oy = Math.floor(lab / g.labCols) * (g.labH + g.gap);
      ctx.strokeStyle = '#5fd4ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + (f % g.flyCols) * g.cell + 1, oy + 16 + Math.floor(f / g.flyCols) * g.cell + 1, g.cell - 2, g.cell - 2);
    }
  }

  drawCell(ctx, x, y, s, d, f, time) {
    const pad = 1;
    ctx.fillStyle = '#10131a';
    ctx.fillRect(x + pad, y + pad, s - 2 * pad, s - 2 * pad);
    if (!d) return;
    const o = f * STRIDE;
    const score = d[o], light = d[o + 1];
    // a lit shop gets a warm background
    if (light > 0.05) {
      ctx.fillStyle = `rgba(255, 196, 120, ${Math.min(0.22, light * 0.12)})`;
      ctx.fillRect(x + pad, y + pad, s - 2 * pad, s - 2 * pad);
    }
    // world -> cell: x in [-3.2, 3.2], y in [-2.4, 3.0]
    const k = (s - 4) / 6.4;
    const cx = x + s / 2, base = y + s - 2;
    const X = (wx) => cx + wx * k, Y = (wy) => base - (wy + 2.4) * k;
    // draw far objects first
    const order = [];
    for (let i = 0; i < SLOTS; i++) if (d[o + 2 + i * PER]) order.push(i);
    order.sort((a, b) => d[o + 2 + a * PER + 6] - d[o + 2 + b * PER + 6]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + pad, y + pad, s - 2 * pad, s - 2 * pad);
    ctx.clip();
    for (const i of order) {
      const j = o + 2 + i * PER;
      const type = d[j], a = d[j + 1], b = d[j + 2], c = d[j + 3];
      const px = d[j + 4], py = d[j + 5];
      const col = hex(d[j + 7]), em = d[j + 8] >>> 0, turn = d[j + 9];
      const glow = ((em >> 16) & 255) > 150 && ((em >> 16) & 255) > 1.5 * (em & 255);
      ctx.beginPath();
      if (type === 1) ctx.rect(X(px - a / 2), Y(py + b / 2), a * k, b * k);
      else if (type === 2) {
        ctx.moveTo(X(px - a), Y(py + c / 2)); ctx.lineTo(X(px + a), Y(py + c / 2));
        ctx.lineTo(X(px + b), Y(py - c / 2)); ctx.lineTo(X(px - b), Y(py - c / 2)); ctx.closePath();
      } else ctx.arc(X(px), Y(py), Math.max(0.6, a * k), 0, Math.PI * 2);
      if (glow) { ctx.fillStyle = 'rgba(255, 110, 20, 0.35)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,120,30,0.5)'; ctx.stroke(); }
      ctx.fillStyle = glow ? '#ff7a2a' : col;
      ctx.fill();
      if (Math.abs(turn) > 0.05 && type !== 3) {
        // a stripe sweeping across shows it is turning
        const w = type === 1 ? a / 2 : Math.max(a, b);
        const sx = px + Math.sin(time * Math.min(Math.abs(turn), 6)) * w * 0.8;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1, k * 0.15);
        ctx.beginPath();
        ctx.moveTo(X(sx), Y(py + (type === 1 ? b : c) / 2));
        ctx.lineTo(X(sx), Y(py - (type === 1 ? b : c) / 2));
        ctx.stroke();
      }
    }
    ctx.restore();
    // score bar
    ctx.fillStyle = scoreColour(score);
    ctx.fillRect(x + pad, y + s - pad - 2, (s - 2 * pad) * (score / 8), 2);
    if (score > 7.99) {
      ctx.strokeStyle = 'rgba(69, 212, 131, 0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + pad + 0.5, y + pad + 0.5, s - 2 * pad - 1, s - 2 * pad - 1);
    }
  }
}
