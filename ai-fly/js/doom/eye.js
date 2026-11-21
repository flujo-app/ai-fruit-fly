// The fly's eyes in front of the Doom screen.
//
// Each eye has about 790 facets; behind each facet sits one column of cells in the optic lobe
// (data/doom/rig.bin says where each column looks, see tools/pack_doom_rig.py). The screen stands in
// front of the fly and fills the middle of its view. Every game tic (1/35 s) each facet that looks at
// the screen gets the average brightness of its patch of the picture.
//
// HAND-MADE, and the one big simplification on the way in: the first two layers behind the facets
// (lamina and medulla) work with smoothly varying voltages instead of nerve impulses, which the
// impulse-based brain model cannot do. So their well-known results are computed here in the textbook
// way and handed to the brain at the cells that are known to carry them:
//   brightness going up            -> Tm3                      ("ON")
//   brightness going down          -> Tm1, Tm2, Tm4            ("OFF")
//   darker than the surroundings   -> Tm9                      (steady "dark")
//   a small spot that changes      -> T2, T2a, T3              (small-object cells)
//   local motion in 4 directions   -> T4a-d (bright edges), T5a-d (dark edges); a = front-to-back,
//                                     b = back-to-front, c = up, d = down. Computed with the classic
//                                     Hassenstein-Reichardt detector: the delayed signal of the facet
//                                     the motion comes from, times the signal here, minus the mirror image.
// That is about 25,000 real neurons, each with its own spot on the screen. From there on (lobula,
// lobula plate, the visual projection neurons and the rest of the brain) everything is the real wiring.
// Flies cannot see red: brightness = 5% red + 55% green + 40% blue.
//
// One more signal, for the learning centre: blue light. The 7 aMe12 cells are the biggest eye input
// of the "visual" Kenyon cells, and they are excited by the pale kind of the colour photoreceptors
// R7/R8, which see ultraviolet and blue (Ganguly et al. 2024). A monitor gives no ultraviolet, so
// each aMe12 cell is driven by how much blue light the facets of "its" R8 cells get (the facets
// that look past the screen get none). HAND-MADE: that the response is steady and simply grows
// with the light (nobody has recorded from these cells), and its upper limit: driven harder than
// about 170 impulses per second, all 5,177 Kenyon cells of the model fire at once, which a real
// fly's brain prevents. The other eye cells that reach the learning centre have never been recorded
// from, so they get no made-up signal.

export const KINDS = ['T4a', 'T4b', 'T4c', 'T4d', 'T5a', 'T5b', 'T5c', 'T5d', 'Tm3', 'Tm1', 'Tm2', 'Tm4', 'Tm9', 'T2', 'T2a', 'T3'];
// what each kind of cell reports: [signal, direction]
const SIG = { MOTION_ON: 0, MOTION_OFF: 1, ON: 2, OFF: 3, DARK: 4, OBJECT: 5 };
const KIND_SIG = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [3, 0], [3, 0], [3, 0], [4, 0], [5, 0], [5, 0], [5, 0]];

export function parseRig(buf, meta) {
  const types = { uint8: Uint8Array, uint16: Uint16Array, int16: Int16Array, uint32: Uint32Array, float32: Float32Array };
  const rig = { meta, groups: meta.groups };
  for (const [name, [type, off, len]] of Object.entries(meta.layout)) rig[name] = new types[type](buf, off, len);
  return rig;
}

export const EYE_DEFAULTS = {
  dt: 1000 / 35,     // ms per picture
  tauHp: 200,        // ms: how long a facet takes to get used to a new brightness
  tauDelay: 50,      // ms: the delay in the motion detector
  maxHz: 250,        // no cell is driven faster than this
  // how hard each kind of signal drives its cells, in impulses per second for a full-strength signal.
  // These four are part of each desk's setup in the Doom gym.
  gMotion: 1500, gContrast: 400, gObject: 600, gDark: 40,
  gBlue: 0,          // the blue-light cells (aMe12): impulses per second if all their facets saw full blue; 0 = off
  maxBlue: 150,      // ...but never faster than this (see above)
};

export class Eye {
  // remap: optional function global neuron index -> index in the brain that is simulated (fast mode)
  constructor(rig, opts = {}, remap = null) {
    this.o = { ...EYE_DEFAULTS, ...opts };
    this.rig = rig;
    const C = this.C = rig.colSide.length;
    this.az = rig.colAz; this.el = rig.colEl; this.side = rig.colSide; this.nb = rig.colNb;
    // driven cells that exist in the simulated brain
    const keep = [];
    for (let i = 0; i < rig.drivenIdx.length; i++) {
      const b = remap ? remap(rig.drivenIdx[i]) : rig.drivenIdx[i];
      if (b >= 0) keep.push([b, rig.drivenCol[i], rig.drivenKind[i]]);
    }
    // the blue-light cells come after the column cells in the lists (kind 255: they have no single column)
    const blue = [];
    if (rig.blueIdx) for (let j = 0; j < rig.blueIdx.length; j++) {
      const b = remap ? remap(rig.blueIdx[j]) : rig.blueIdx[j];
      if (b < 0) continue;
      let sum = 0; for (let k = rig.blueStart[j]; k < rig.blueStart[j + 1]; k++) sum += rig.blueW[k];
      blue.push({ cell: b, from: rig.blueStart[j], to: rig.blueStart[j + 1], sum });
    }
    this.blueCells = blue; this.N0 = keep.length;
    const N = this.N = keep.length + blue.length;
    this.cellIdx = new Int32Array(N); this.cellCol = new Uint16Array(N); this.cellKind = new Uint8Array(N).fill(255);
    keep.forEach(([b, c, k], i) => { this.cellIdx[i] = b; this.cellCol[i] = c; this.cellKind[i] = k; });
    blue.forEach((b, j) => { this.cellIdx[this.N0 + j] = b.cell; });
    this.rate = new Float32Array(N);
    this.blueOf = new Float32Array(256); this.blue = new Float32Array(C);

    this.lum = new Float32Array(C).fill(0.5);       // what each facet sees, 0..1 (off-screen facets: 0.5)
    this.lp = new Float32Array(C).fill(0.5);
    this.on = new Float32Array(C); this.off = new Float32Array(C);
    this.dOn = new Float32Array(C); this.dOff = new Float32Array(C);
    this.motion = new Float32Array(C * 8);          // per column: 4 directions for bright edges, 4 for dark
    this.obj = new Float32Array(C); this.dark = new Float32Array(C);
    this.onScreen = new Uint8Array(C);
    this.mean = 0.3; this.first = true;
    this.lumOf = new Float32Array(256);
    this.setScreen(120, 96, 60);
  }

  // the screen: `widthDeg` degrees wide in the fly's view (4:3), showing a w x h picture
  setScreen(widthDeg, w, h) {
    const C = this.C, halfW = widthDeg / 2, halfH = widthDeg * 0.375;
    this.widthDeg = widthDeg; this.w = w; this.h = h;
    const patch = Math.max(1, Math.round(this.rig.meta.facetDeg / widthDeg * w));   // a facet's patch, in pixels
    const taps = [], start = new Uint32Array(C + 1);
    let nOn = 0;
    for (let c = 0; c < C; c++) {
      start[c] = taps.length;
      const a = this.az[c], e = this.el[c];
      this.onScreen[c] = Math.abs(a) < halfW && Math.abs(e) < halfH ? 1 : 0;
      if (!this.onScreen[c]) continue;
      nOn++;
      const x0 = Math.round((a / halfW * 0.5 + 0.5) * w - patch / 2), y0 = Math.round((0.5 - e / halfH * 0.5) * h - patch / 2);
      for (let y = y0; y < y0 + patch; y++) for (let x = x0; x < x0 + patch; x++) {
        if (x >= 0 && x < w && y >= 0 && y < h) taps.push(y * w + x);
      }
      if (taps.length === start[c]) taps.push(Math.min(h - 1, Math.max(0, y0)) * w + Math.min(w - 1, Math.max(0, x0)));
    }
    start[C] = taps.length;
    this.tapStart = start; this.taps = Uint32Array.from(taps); this.facetsOnScreen = nOn;
    this.reset();
  }

  // the colours of the picture (768 bytes: red, green, blue for each of the 256 palette entries)
  setPalette(rgb) {
    for (let i = 0; i < 256; i++) {
      this.lumOf[i] = (0.05 * rgb[3 * i] + 0.55 * rgb[3 * i + 1] + 0.40 * rgb[3 * i + 2]) / 255;
      // what the blue photoreceptor (R8 pale, most sensitive around 440 nm) gets from a monitor
      this.blueOf[i] = (0.15 * rgb[3 * i + 1] + 0.85 * rgb[3 * i + 2]) / 255;
    }
  }

  reset() {
    this.first = true;
    this.on.fill(0); this.off.fill(0); this.dOn.fill(0); this.dOff.fill(0); this.motion.fill(0); this.obj.fill(0); this.dark.fill(0);
    this.lum.fill(0.5); this.lp.fill(0.5);
  }

  // one picture (w*h palette indices) -> how fast each driven cell fires (this.rate, impulses per second)
  see(frame) {
    const { C, lum, lp, on, off, dOn, dOff, motion, obj, dark, nb, onScreen, tapStart, taps, lumOf, o } = this;
    const aHp = 1 - Math.exp(-o.dt / o.tauHp), aD = 1 - Math.exp(-o.dt / o.tauDelay);
    // brightness per facet, and the average over the screen (the eye gets used to the overall level)
    let sum = 0, nOn = 0;
    for (let c = 0; c < C; c++) {
      if (!onScreen[c]) continue;
      let s = 0; const a = tapStart[c], b = tapStart[c + 1];
      for (let k = a; k < b; k++) s += lumOf[frame[taps[k]]];
      lum[c] = s / (b - a); sum += lum[c]; nOn++;
    }
    const m = nOn ? sum / nOn : 0.3;
    this.mean = this.first ? m : this.mean + (m - this.mean) * (1 - Math.exp(-o.dt / 1000));
    const norm = 0.5 / (this.mean + 0.03);
    for (let c = 0; c < C; c++) {
      if (!onScreen[c]) continue;
      const x = lum[c] * norm;                               // brightness relative to the average (average = 0.5)
      if (this.first) lp[c] = x;
      const hp = x - lp[c]; lp[c] += hp * aHp;
      on[c] = hp > 0 ? hp : 0; off[c] = hp < 0 ? -hp : 0;
      dark[c] = x < 0.4 ? 0.4 - x : 0;
    }
    this.first = false;
    // local motion (Hassenstein-Reichardt): for each direction, p is the facet the motion comes from
    for (let c = 0; c < C; c++) {
      if (!onScreen[c]) continue;
      let surround = 0, ns = 0;
      for (let d = 0; d < 4; d++) {
        const p = nb[c * 4 + d];
        if (p < 0 || !onScreen[p]) { motion[c * 8 + d] = 0; motion[c * 8 + 4 + d] = 0; continue; }
        const a = dOn[p] * on[c] - dOn[c] * on[p], b = dOff[p] * off[c] - dOff[c] * off[p];
        motion[c * 8 + d] = a > 0 ? a : 0; motion[c * 8 + 4 + d] = b > 0 ? b : 0;
        surround += on[p] + off[p]; ns++;
      }
      // small-object cells: a change here that the neighbours do not share
      const v = on[c] + off[c] - (ns ? 0.8 * surround / ns : 0);
      obj[c] = v > 0 ? v : 0;
    }
    for (let c = 0; c < C; c++) { if (!onScreen[c]) continue; dOn[c] += (on[c] - dOn[c]) * aD; dOff[c] += (off[c] - dOff[c]) * aD; }
    // hand the signals to the cells
    const { rate, cellCol, cellKind } = this, N = this.N0, mx = o.maxHz;
    const gM = o.gMotion, gC = o.gContrast, gO = o.gObject, gD = o.gDark;
    // blue light for the learning centre's input cells: the average over each cell's own facets
    if (this.blueCells.length) {
      const { blueOf, rig } = this, bc = rig.blueCol, bw = rig.blueW;
      for (let j = 0; j < this.blueCells.length; j++) {
        const cell = this.blueCells[j];
        let acc = 0;
        if (o.gBlue > 0) for (let k = cell.from; k < cell.to; k++) {
          const c = bc[k];
          if (!onScreen[c]) continue;                       // this facet looks past the screen, into the dim lab
          let sum = 0; const a = tapStart[c], b = tapStart[c + 1];
          for (let q = a; q < b; q++) sum += blueOf[frame[taps[q]]];
          acc += bw[k] * sum / (b - a);
        }
        const v = o.gBlue * acc / cell.sum;
        rate[N + j] = v > o.maxBlue ? o.maxBlue : v;
      }
    }
    for (let i = 0; i < N; i++) {
      const c = cellCol[i];
      if (!onScreen[c]) { rate[i] = 0; continue; }
      const k = cellKind[i]; let v;
      if (k < 4) v = gM * motion[c * 8 + k];
      else if (k < 8) v = gM * motion[c * 8 + k];            // kinds 4..7 = dark-edge motion, stored at offsets 4..7
      else if (k === 8) v = gC * on[c];
      else if (k < 12) v = gC * off[c];
      else if (k === 12) v = gD * dark[c];
      else v = gO * obj[c];
      rate[i] = v > mx ? mx : v;
    }
    return rate;
  }
}
export { SIG, KIND_SIG };
