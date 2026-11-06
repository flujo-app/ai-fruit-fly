// The Fly Gym's training loop without any page around it: one background worker per lab, one
// generation at a time, and the labs swap their best fly every few rounds. The gym page and the
// Cubicles office both use it.
export class GymRunner {
  // popOpts: extra settings for every lab's population (see DEFAULTS in population.js)
  constructor({ labs = 8, perLab = 128, attempts = 4, migrateEvery = 2, popOpts = {} } = {}) {
    this.labs = labs;
    this.popOpts = popOpts;
    this.perLab = perLab;
    this.attempts = attempts;
    this.migrateEvery = migrateEvery;
    this.workers = [];
    this.pending = new Map();
    this.nextId = 1;
    this.reset();
  }

  reset() {
    this.gen = 0;
    this.firstSolved = -1;
    this.programs = 0;
    this.tokensTyped = 0;
    this.history = [];
    this.labStats = [];
    this.lastResults = [];
    this.genTimes = [];
  }

  get flies() { return this.labs * this.perLab; }
  get speed() { return this.genTimes.length ? 1000 / (this.genTimes.reduce((a, b) => a + b, 0) / this.genTimes.length) : 0; }

  call(w, msg, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); w.postMessage({ ...msg, id }, transfer); });
  }

  makeWorker() {
    const w = new Worker(new URL('./gym-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
    };
    return w;
  }

  // (re)start with fresh flies
  async init(perLab = this.perLab) {
    this.terminate();
    this.perLab = perLab;
    this.reset();
    this.workers = Array.from({ length: this.labs }, () => this.makeWorker());
    await Promise.all(this.workers.map((w, lab) => this.call(w, { type: 'init', lab, flies: perLab, opts: { attempts: this.attempts, ...this.popOpts } })));
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.pending.clear();
  }

  // one generation in every lab. Returns the round's numbers; `firstNow` is true in the round
  // where the very first fly passes all 8 tests.
  async step() {
    const t0 = performance.now();
    const results = await Promise.all(this.workers.map((w, lab) => this.call(w, { type: 'step', lab })));
    this.gen++;
    this.lastResults = results;
    let best = null, sum = 0, solved = 0;
    results.forEach((r, lab) => {
      this.labStats[lab] = { best: r.stat.best, solved: r.stat.solved, mean: r.stat.mean, bored: r.stat.bored };
      sum += r.stat.mean * this.perLab;
      solved += r.stat.solved;
      this.programs += this.perLab * this.attempts;
      this.tokensTyped += r.tokens * this.attempts;
      if (!best || r.best.score > best.score) best = { ...r.best, lab };
    });
    const mean = sum / this.flies;
    this.history.push({ best: best.score, mean, solved: solved / this.flies });
    const firstNow = solved > 0 && this.firstSolved < 0;
    if (firstNow) this.firstSolved = this.gen;
    // the labs swap their best fly now and then
    if (this.gen % this.migrateEvery === 0) {
      const mems = await Promise.all(this.workers.map((w, lab) => this.call(w, { type: 'export', fly: results[lab].stat.bestFly })));
      await Promise.all(this.workers.map((w, lab) => {
        const from = mems[(lab + this.labs - 1) % this.labs];
        const mem = from.mem.slice();
        return this.call(w, { type: 'import', mem, baseline: from.baseline }, [mem.buffer]);
      }));
    }
    this.genTimes.push(performance.now() - t0);
    if (this.genTimes.length > 10) this.genTimes.shift();
    return { gen: this.gen, best, mean, solved, results, firstNow };
  }

  // has the best score stopped improving for a while?
  get stuck() {
    const h = this.history;
    if (this.firstSolved > 0 || h.length <= 120) return false;
    const before = Math.max(...h.slice(-120, -60).map((x) => x.best));
    return Math.max(...h.slice(-60).map((x) => x.best)) <= before + 0.01;
  }

  code(lab, fly) { return this.call(this.workers[lab], { type: 'code', fly }); }
  codes(lab, flies) { return this.call(this.workers[lab], { type: 'codes', flies }); }

  // a sugar cube: dopamine for every choice in the fly's winning program
  reward(lab, fly, strength = 0.5) { return this.call(this.workers[lab], { type: 'reward', fly, strength }); }

  // a new intern at this desk: the memory goes back to the innate wiring
  rehire(lab, fly) { return this.call(this.workers[lab], { type: 'hire', fly }); }

  // promotion: the fly's memory is copied over the weakest `perLab` flies of every lab
  async promote(lab, fly, perLab = 8) {
    const m = await this.call(this.workers[lab], { type: 'export', fly });
    let n = 0;
    for (const w of this.workers) {
      for (let i = 0; i < perLab; i++) {
        const mem = m.mem.slice();
        await this.call(w, { type: 'import', mem, baseline: m.baseline }, [mem.buffer]);
        n++;
      }
    }
    return n;
  }

  // the whole training state as one buffer: page-specific extras go into `extra`
  async save(url, extra = {}) {
    const parts = await Promise.all(this.workers.map((w) => this.call(w, { type: 'exportAll' })));
    const { labs, perLab } = this;
    const meta = { gen: this.gen, firstSolved: this.firstSolved, programs: this.programs, tokensTyped: this.tokensTyped, history: this.history, perLab, labs, wLen: parts[0].W.length, extra };
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const head = 4 + Math.ceil(metaBytes.length / 4) * 4;
    const buf = new ArrayBuffer(head + labs * (meta.wLen + perLab) * 4);
    new Uint32Array(buf, 0, 1)[0] = metaBytes.length;
    new Uint8Array(buf, 4, metaBytes.length).set(metaBytes);
    parts.forEach((p, lab) => {
      new Float32Array(buf, head + lab * meta.wLen * 4, meta.wLen).set(p.W);
      new Float32Array(buf, head + labs * meta.wLen * 4 + lab * perLab * 4, perLab).set(p.baseline);
    });
    await fetch(`${url}?gen=${this.gen}`, { method: 'POST', body: buf }).catch(() => {});
  }

  // returns the saved extras, or null if there is no usable save
  async load(url) {
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) return null;
    const buf = await r.arrayBuffer();
    const len = new Uint32Array(buf, 0, 1)[0];
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
    if (meta.perLab !== this.perLab || meta.labs !== this.labs) return null;
    const head = 4 + Math.ceil(len / 4) * 4, { labs, perLab } = this;
    await Promise.all(this.workers.map((w, lab) => {
      const W = new Float32Array(buf.slice(head + lab * meta.wLen * 4, head + (lab + 1) * meta.wLen * 4));
      const baseline = new Float32Array(buf.slice(head + labs * meta.wLen * 4 + lab * perLab * 4, head + labs * meta.wLen * 4 + (lab + 1) * perLab * 4));
      return this.call(w, { type: 'importAll', W, baseline, gen: meta.gen }, [W.buffer, baseline.buffer]);
    }));
    ({ gen: this.gen, firstSolved: this.firstSolved, programs: this.programs, tokensTyped: this.tokensTyped, history: this.history } = meta);
    return meta.extra || meta;   // older saves kept the banner at the top level
  }
}
