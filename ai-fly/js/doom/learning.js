// The fly's learning centre (mushroom body) in the Doom games.
//
// What is real: the Kenyon cells, their connections onto the learning centre's output cells, those
// cells' connections onward (some go straight onto the steering and moonwalker cells), and the rule:
// where dopamine arrives while a Kenyon cell is active, that cell's connections onto the output
// cells of that dopamine zone get weaker. That is how a real fly learns (Aso et al. 2014), and it is
// the only thing in the brain that ever changes here. Which output cell belongs to which zone is
// read from the wiring (tools/pack_doom_rig.py), as in the döner pages.
//
// HAND-MADE: that a killed monster earns a drop of sugar (three for the last one), and a hit taken or a
// second of walking against a wall a drop of bitter (the trainer decides what earns a treat); in a real
// level also a drop of sugar for new ground (every 4 squares of floor the fly had not stood on in this
// game) and three for pressing the exit switch; that
// sugar means dopamine from the reward cells and bitter dopamine from the punishment cells (in this
// model the taste cells' signal does not reach the dopamine cells through the wiring, so the link
// is made by hand, as in the döner pages); and the sizes below.
// The drops are real input too: the fly's sugar or bitter taste cells fire for a moment, and with
// sugar its feeding neuron fires. It drinks.
export const LEARN = {
  sugar: 0.3,        // one drop of sugar weakens the active Kenyon cells' connections onto the "avoid" output cells by up to this share
  bitter: 0.1,       // one hit's bitter does the same for the "approach" output cells (there are many more hits than kills)
  traceMs: 1000,     // a Kenyon cell counts as "active" for about this long after it fired
  full: 3,           // this many impulses within that time count as fully active
  forget: 0.02,      // between games a memory drifts this share of the way back to the inborn wiring
  tasteHz: 150, tasteTics: 10,   // the taste cells fire this fast for about 0.3 s per drop
  clear: 3,          // killing the last monster earns this many drops of sugar at once
  stuck: 0.5,        // walking against a wall for a second earns half a drop of bitter
  stuckMove: 16,     // "stuck" = moved less than this many map units in a second while trying to walk
  groundSquares: 4,  // in a real level: this many new squares of floor (64 x 64 map units each) earn a drop of sugar
};

export class LearningCentre {
  constructor(brain, rig, remap = null) {
    const map = (list) => list.map((i) => remap ? remap(i) : i).filter((i) => i >= 0);
    const g = rig.groups;
    this.brain = brain;
    this.kc = Int32Array.from(map(g.visualKC || []));
    this.sugarCells = Int32Array.from(map(g.sugar || [])); this.bitterCells = Int32Array.from(map(g.bitter || []));
    // the reduced brain of the fast mode has no learning centre
    this.ok = this.kc.length > 0 && (g.MBON || []).length > 0 && !remap;
    this.drops = { sugar: 0, bitter: 0 }; this.changed = 0;
    if (!this.ok) { this.kc = new Int32Array(0); this.size = 0; return; }
    brain.setPlastic(this.kc);
    const zone = new Uint8Array(brain.n);                  // 1: weakened by sugar, 2: weakened by bitter
    for (const i of g.MBON_sugar) zone[i] = 1;
    for (const i of g.MBON_bitter) zone[i] = 2;
    // a fly's memory: one number per connection from a visual Kenyon cell onto an output cell (1 = as inborn)
    const idx = [], z = [], start = new Int32Array(this.kc.length + 1);
    for (let k = 0; k < this.kc.length; k++) {
      start[k] = idx.length;
      const i = this.kc[k], n = brain.rowptr[i + 1] - brain.rowptr[i], off = brain.pOff[i];
      for (let e = 0; e < n; e++) { const t = brain.pTarget[off + e]; if (zone[t]) { idx.push(off + e); z.push(zone[t]); } }
    }
    start[this.kc.length] = idx.length;
    this.memIdx = Int32Array.from(idx); this.memZone = Uint8Array.from(z); this.memStart = start;
    this.size = idx.length;
    this.mem = new Float32Array(this.size).fill(1);
    this.trace = new Float32Array(this.kc.length);
    this.decay = Math.exp(-(1000 / 35) / LEARN.traceMs);
    this.reset();
  }

  reset() { this.drops = { sugar: 0, bitter: 0 }; this.changed = 0; if (this.ok) this.trace.fill(0); }

  // put a fly's memory into the brain (null = a fly that has learnt nothing yet)
  load(memory) {
    if (!this.ok) return;
    const { pw, pBase } = this.brain, { memIdx, mem } = this;
    pw.set(pBase);
    if (memory && memory.length === this.size) mem.set(memory); else mem.fill(1);
    for (let m = 0; m < memIdx.length; m++) pw[memIdx[m]] = pBase[memIdx[m]] * mem[m];
    this.reset();
  }

  // once per game tic: `count[from + k]` = impulses of visual Kenyon cell k during the tic. Returns how many of them fired.
  tick(count, from) {
    const { trace, decay } = this; let active = 0;
    for (let k = 0; k < trace.length; k++) { const c = count[from + k]; trace[k] = trace[k] * decay + c; if (c) active++; }
    return active;
  }

  // a drop of sugar (kind 1) or bitter (kind 2): dopamine weakens the recently active Kenyon cells' connections in that zone
  drop(kind, strength = 1) {
    if (!this.ok) return 0;
    const { trace, memStart, memIdx, memZone, mem } = this, { pw, pBase } = this.brain;
    const size = (kind === 1 ? LEARN.sugar : LEARN.bitter) * strength;
    let cells = 0;
    for (let k = 0; k < trace.length; k++) {
      if (trace[k] < 0.5) continue;
      cells++;
      const f = 1 - size * Math.min(1, trace[k] / LEARN.full);
      for (let m = memStart[k]; m < memStart[k + 1]; m++) if (memZone[m] === kind) { mem[m] *= f; pw[memIdx[m]] = pBase[memIdx[m]] * mem[m]; }
    }
    this.drops[kind === 1 ? 'sugar' : 'bitter']++; this.changed += cells;
    return cells;
  }

  // the memory to keep for the fly's next game (a little of it fades)
  memory() {
    const out = Float32Array.from(this.mem);
    for (let m = 0; m < out.length; m++) out[m] += (1 - out[m]) * LEARN.forget;
    return out;
  }

  // how much has been learnt: the average weakening of the connections, per zone (0 = nothing, 1 = gone)
  static strength(memory, lc) {
    let s = 0, b = 0, ns = 0, nb = 0;
    for (let m = 0; m < memory.length; m++) { if (lc.memZone[m] === 1) { s += 1 - memory[m]; ns++; } else { b += 1 - memory[m]; nb++; } }
    return { sugar: ns ? s / ns : 0, bitter: nb ? b / nb : 0 };
  }
}
