import { Wall } from './wall.js';
import { buildRealApp } from './app-template.js';
import { TESTS } from './judge.js';
import { COLORS, NEWLINE } from './grammar.js';

const $ = (id) => document.getElementById(id);
const LABS = 8;
const MIGRATE_EVERY = 2;
const ATTEMPTS = 4;

// ---------------------------------------------------------------- workers (one lab each)
let workers = [];
let perLab = Number($('flies').value);
let nextId = 1;
const pending = new Map();
function call(w, msg, transfer = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ ...msg, id }, transfer); });
}
function makeWorker() {
  const w = new Worker(new URL('./gym-worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
  };
  return w;
}

// ---------------------------------------------------------------- state
let wall = null;
let running = false, busy = false;
let gen = 0, firstSolved = -1, programs = 0, tokensTyped = 0;
let history = [];
let labStats = [];
let lastResults = [];
let selected = null;        // [lab, fly] being inspected, or null = follow the best fly
let shownCode = '';
let lastFrameAt = 0, previewAt = 0, genTimes = [];

async function setup() {
  running = false;
  setRunLabel();
  $('btn-run').disabled = true;
  $('btn-reset').disabled = true;
  for (const w of workers) w.terminate();
  pending.clear();
  perLab = Number($('flies').value);
  workers = Array.from({ length: LABS }, makeWorker);
  gen = 0; firstSolved = -1; programs = 0; tokensTyped = 0; history = []; labStats = []; lastResults = []; selected = null; shownCode = '';
  $('st-flies').textContent = (LABS * perLab).toLocaleString();
  ['st-gen', 'st-solved', 'st-programs', 'st-tokens'].forEach((id) => ($(id).textContent = '0'));
  ['st-best', 'st-mean', 'st-speed'].forEach((id) => ($(id).textContent = '–'));
  $('milestone').textContent = '';
  wall = new Wall($('wall'), LABS, perLab);
  await Promise.all(workers.map((w, lab) => call(w, { type: 'init', lab, flies: perLab, opts: { attempts: ATTEMPTS } })));
  $('btn-run').disabled = false;
  $('btn-reset').disabled = false;
  renderCode(null);
  renderTests(null);
  drawChart();
  $('code-note').textContent = 'Press “Start training”. Every fly starts out typing at random.';
}

// ---------------------------------------------------------------- one generation for every lab
async function step() {
  busy = true;
  const t0 = performance.now();
  const results = await Promise.all(workers.map((w, lab) => call(w, { type: 'step', lab })));
  gen++;
  lastResults = results;
  let best = null, sum = 0, solved = 0;
  results.forEach((r, lab) => {
    wall.data[lab] = r.summary;
    labStats[lab] = { best: r.stat.best, solved: r.stat.solved };
    sum += r.stat.mean * perLab;
    solved += r.stat.solved;
    programs += perLab * ATTEMPTS;
    tokensTyped += r.tokens * ATTEMPTS;
    if (!best || r.best.score > best.score) best = { ...r.best, lab };
  });
  const n = LABS * perLab;
  history.push({ best: best.score, mean: sum / n, solved: solved / n });
  if (solved && firstSolved < 0) {
    firstSolved = gen;
    $('milestone').textContent = `first perfect döner: generation ${gen}`;
  }
  if (firstSolved < 0 && history.length > 120) {
    const before = Math.max(...history.slice(-120, -60).map((h) => h.best));
    const now = Math.max(...history.slice(-60).map((h) => h.best));
    $('milestone').textContent = now <= before + 0.01 ? 'stuck for a while: these flies may need “New flies”' : '';
  }
  // the labs swap their best fly now and then
  if (gen % MIGRATE_EVERY === 0) {
    const mems = await Promise.all(workers.map((w, lab) => call(w, { type: 'export', fly: results[lab].stat.bestFly })));
    await Promise.all(workers.map((w, lab) => {
      const from = mems[(lab + LABS - 1) % LABS];
      const mem = from.mem.slice();
      return call(w, { type: 'import', mem, baseline: from.baseline }, [mem.buffer]);
    }));
  }
  genTimes.push(performance.now() - t0);
  if (genTimes.length > 10) genTimes.shift();
  updateStats(best, sum / n, solved);
  await showChampion(best);
  drawChart();
  busy = false;
}

function updateStats(best, mean, solved) {
  $('st-gen').textContent = gen.toLocaleString();
  $('st-best').textContent = `${best.score.toFixed(2)} / 8`;
  $('st-mean').textContent = mean.toFixed(2);
  $('st-solved').textContent = solved.toLocaleString();
  $('st-programs').textContent = programs.toLocaleString();
  $('st-tokens').textContent = tokensTyped >= 1e6 ? `${(tokensTyped / 1e6).toFixed(1)} M` : tokensTyped.toLocaleString();
  const avg = genTimes.reduce((a, b) => a + b, 0) / genTimes.length;
  $('st-speed').textContent = `${(1000 / avg).toFixed(1)} gen/s`;
}

async function showChampion(best) {
  let fly = best;
  if (selected) {
    const [lab, f] = selected;
    const m = await call(workers[lab], { type: 'code', fly: f });
    fly = { ...m, lab, fly: f };
    $('champ-title').textContent = `Lab ${lab + 1}, fly ${f + 1}`;
    $('champ-note').innerHTML = `<a href="#" id="follow-best">follow the best fly</a>`;
    $('follow-best').onclick = (e) => { e.preventDefault(); selected = null; wall.highlight = null; showChampion(best); };
  } else {
    $('champ-title').textContent = 'Best fly right now';
    $('champ-note').textContent = `lab ${best.lab + 1}, fly ${best.fly + 1} · ${best.passed}/8 tests`;
  }
  renderCode(fly);
  renderTests(fly);
  // rebuild the real 3D app only when the program changed, and not too often
  const now = performance.now();
  if (fly.code !== shownCode && (now - previewAt > 2500 || !running)) {
    shownCode = fly.code;
    previewAt = now;
    $('preview').srcdoc = buildRealApp(fly.code);
  }
}

// ---------------------------------------------------------------- code view
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const WORD = /^[A-Za-z_$][\w$]*$/;
const NO_SPACE_BEFORE = new Set(['.', ')', ',', ';', ':']);
function renderCode(fly) {
  const el = $('code');
  if (!fly) { el.innerHTML = '<span class="tk-a">// nothing written yet</span>'; return; }
  let html = '', prev = '\n', chosen = 0, total = 0;
  for (const { t, d } of fly.tokens) {
    if (t === '\n') { html += '\n'; prev = '\n'; continue; }
    total++;
    if (d) chosen++;
    if (t === 'END') { html += `<span class="tk-end">// the fly decided it is done</span>`; continue; }
    if (t === NEWLINE) continue;
    const tight = prev === '\n' || NO_SPACE_BEFORE.has(t) || prev === '.' || prev === '(' || (t === '(' && WORD.test(prev));
    let tok = `<span class="${d ? 'tk-d' : 'tk-a'}">${esc(t)}</span>`;
    if (COLORS[t]) tok += `<span title="${COLORS[t]}" style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-left:3px;vertical-align:-1px;background:#${t.slice(2)}"></span>`;
    html += (tight ? '' : ' ') + tok;
    prev = t;
  }
  el.innerHTML = html;
  $('code-note').textContent = `${total} tokens: ${chosen} chosen by the fly, ${total - chosen} filled in by autocomplete`;
}

function renderTests(fly) {
  const ul = $('tests');
  ul.innerHTML = '';
  for (const [k, label] of TESTS) {
    const li = document.createElement('li');
    const ok = !!(fly && fly.part && fly.part[k] > 0.99);
    li.className = fly ? (ok ? 'pass' : 'fail') : '';
    li.title = fly && fly.why ? fly.why[k] || '' : '';
    li.innerHTML = `<i>${fly ? (ok ? '✓' : '✗') : '·'}</i>${esc(label.replace(/ \(.*\)/, ''))}`;
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- chart
function drawChart() {
  const c = $('chart');
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * devicePixelRatio; c.height = h * devicePixelRatio;
  const g = c.getContext('2d');
  g.scale(devicePixelRatio, devicePixelRatio);
  const L = 26, R = 12, T = 8, B = 18, iw = w - L - R, ih = h - T - B;
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.fillStyle = '#5f6878';
  g.font = '10px system-ui';
  for (const v of [0, 2, 4, 6, 8]) {
    const y = T + ih - (v / 8) * ih;
    g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillText(String(v), 8, y + 3);
  }
  if (!history.length) return;
  const n = Math.max(history.length, 50);
  const X = (i) => L + (i / (n - 1)) * iw;
  g.fillStyle = 'rgba(69, 212, 131, 0.25)';
  g.beginPath(); g.moveTo(X(0), T + ih);
  history.forEach((p, i) => g.lineTo(X(i), T + ih - p.solved * ih));
  g.lineTo(X(history.length - 1), T + ih); g.closePath(); g.fill();
  for (const [key, col] of [['mean', '#a98bff'], ['best', '#ffb547']]) {
    g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath();
    history.forEach((p, i) => (i ? g.lineTo(X(i), T + ih - (p[key] / 8) * ih) : g.moveTo(X(i), T + ih - (p[key] / 8) * ih)));
    g.stroke();
  }
  g.fillStyle = '#5f6878';
  g.fillText(`generation ${history.length}`, w - R - 80, h - 4);
}

// ---------------------------------------------------------------- run loop and controls
function setRunLabel() { $('btn-run').textContent = running ? 'Pause' : gen ? 'Keep training' : 'Start training'; }
async function loop() {
  while (running) {
    await step();
    await new Promise((r) => setTimeout(r, 0));
  }
}
$('btn-run').addEventListener('click', () => {
  running = !running;
  setRunLabel();
  if (running && !busy) loop();
});
$('btn-reset').addEventListener('click', () => setup());
$('flies').addEventListener('change', () => setup());

// wall: hover and click to inspect a fly
const tip = $('tip');
$('wall').addEventListener('mousemove', (e) => {
  if (!wall) return;
  const r = e.target.getBoundingClientRect();
  const hit = wall.cellAt(e.clientX - r.left, e.clientY - r.top);
  if (!hit || !lastResults.length) { tip.classList.add('hidden'); return; }
  const [lab, f] = hit;
  const score = lastResults[lab].scores[f];
  tip.textContent = `Lab ${lab + 1} · fly ${f + 1} · ${score.toFixed(2)} / 8 · click to inspect`;
  tip.style.left = `${e.clientX - r.left + 26}px`;
  tip.style.top = `${e.clientY - r.top + 52}px`;
  tip.classList.remove('hidden');
});
$('wall').addEventListener('mouseleave', () => tip.classList.add('hidden'));
$('wall').addEventListener('click', async (e) => {
  if (!wall || !lastResults.length) return;
  const r = e.target.getBoundingClientRect();
  const hit = wall.cellAt(e.clientX - r.left, e.clientY - r.top);
  if (!hit) return;
  selected = hit;
  wall.highlight = hit;
  shownCode = '';
  previewAt = 0;
  if (!busy) await showChampion(null);
});

addEventListener('resize', () => { if (wall) wall.layout(); drawChart(); });

function frame(t) {
  if (wall && t - lastFrameAt > 50) { lastFrameAt = t; wall.draw(t / 1000, labStats); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setup().catch((err) => { $('code-note').textContent = `Could not start: ${err.message}`; console.error(err); });
window.__gym = { get gen() { return gen; }, get history() { return history; }, get firstSolved() { return firstSolved; } };
