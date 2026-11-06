import { Wall } from './wall.js';
import { buildRealApp } from './app-template.js';
import { TESTS } from './judge.js';
import { COLORS, NEWLINE } from './grammar.js';
import { GymRunner } from './runner.js';

const $ = (id) => document.getElementById(id);
const LABS = 8;
// ?demo: start training by itself and stop a little after the first perfect döner (for recordings).
// In demo mode the whole training state is saved to the local server every 20 rounds, and
// ?demo&resume continues from the last save (so a long run can be recorded in pieces).
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.has('demo');
const RESUME = PARAMS.has('resume');
const SAVE_EVERY = DEMO ? 20 : 0;
const DEMO_AFTER = 40;

const runner = new GymRunner({ labs: LABS, perLab: Number($('flies').value) });

function celebrate(best) {
  const el = $('banner');
  el.innerHTML = `<b>Generation ${runner.gen}:</b> fly ${best.fly + 1} in lab ${best.lab + 1} just typed a döner app that passes all 8 tests!`;
  el.classList.add('show');
  if (DEMO) fetch(`/ping?solved=${runner.gen}`).catch(() => {});
}

// ---------------------------------------------------------------- state
let wall = null;
let running = false, busy = false;
let selected = null;        // [lab, fly] being inspected, or null = follow the best fly
let shownCode = '';
let lastFrameAt = 0, previewAt = 0;

async function setup() {
  running = false;
  setRunLabel();
  $('btn-run').disabled = true;
  $('btn-reset').disabled = true;
  await runner.init(Number($('flies').value));
  selected = null; shownCode = '';
  $('banner').classList.remove('show');
  $('st-flies').textContent = runner.flies.toLocaleString();
  ['st-gen', 'st-solved', 'st-programs', 'st-tokens'].forEach((id) => ($(id).textContent = '0'));
  ['st-best', 'st-mean', 'st-speed'].forEach((id) => ($(id).textContent = '–'));
  $('milestone').textContent = '';
  wall = new Wall($('wall'), LABS, runner.perLab);
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
  const { best, mean, solved, results, firstNow } = await runner.step();
  results.forEach((r, lab) => { wall.data[lab] = r.summary; });
  if (firstNow) {
    $('milestone').textContent = `first perfect döner: generation ${runner.gen}`;
    celebrate(best);
  }
  if (DEMO && runner.firstSolved > 0 && runner.gen >= runner.firstSolved + DEMO_AFTER) {
    running = false;
    setRunLabel();
    document.title = 'Fly Gym (done)';
    fetch(`/ping?done=${runner.gen}`).catch(() => {});
  }
  if (runner.firstSolved < 0 && runner.history.length > 120) $('milestone').textContent = runner.stuck ? 'stuck for a while: these flies may need “New flies”' : '';
  updateStats(best, mean, solved);
  await showChampion(best);
  drawChart();
  if (SAVE_EVERY && runner.gen % SAVE_EVERY === 0) await runner.save('/state/demo', { banner: $('banner').innerHTML });
  busy = false;
}

function updateStats(best, mean, solved) {
  $('st-gen').textContent = runner.gen.toLocaleString();
  $('st-best').textContent = `${best.score.toFixed(2)} / 8`;
  $('st-mean').textContent = mean.toFixed(2);
  $('st-solved').textContent = solved.toLocaleString();
  $('st-programs').textContent = runner.programs.toLocaleString();
  const t = runner.tokensTyped;
  $('st-tokens').textContent = t >= 1e6 ? `${(t / 1e6).toFixed(1)} M` : t.toLocaleString();
  $('st-speed').textContent = `${runner.speed.toFixed(1)} gen/s`;
}

async function showChampion(best) {
  let fly = best;
  if (selected) {
    const [lab, f] = selected;
    const m = await runner.code(lab, f);
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
  const history = runner.history;
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
function setRunLabel() { $('btn-run').textContent = running ? 'Pause' : runner.gen ? 'Keep training' : 'Start training'; }
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
  if (!hit || !runner.lastResults.length) { tip.classList.add('hidden'); return; }
  const [lab, f] = hit;
  const score = runner.lastResults[lab].scores[f];
  tip.textContent = `Lab ${lab + 1} · fly ${f + 1} · ${score.toFixed(2)} / 8 · click to inspect`;
  tip.style.left = `${e.clientX - r.left + 26}px`;
  tip.style.top = `${e.clientY - r.top + 52}px`;
  tip.classList.remove('hidden');
});
$('wall').addEventListener('mouseleave', () => tip.classList.add('hidden'));
$('wall').addEventListener('click', async (e) => {
  if (!wall || !runner.lastResults.length) return;
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
  if (wall && t - lastFrameAt > 50) { lastFrameAt = t; wall.draw(t / 1000, runner.labStats); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setup()
  .then(async () => {
    if (!DEMO) return;
    const saved = RESUME ? await runner.load('/state/demo') : null;
    if (saved) {
      if (saved.banner) { $('banner').innerHTML = saved.banner; $('banner').classList.add('show'); }
      if (runner.firstSolved > 0) $('milestone').textContent = `first perfect döner: generation ${runner.firstSolved}`;
      $('st-gen').textContent = runner.gen.toLocaleString();
      drawChart();
    }
    fetch(`/ping?${saved ? 'resumed' : 'started'}=${runner.gen}`).catch(() => {});   // marks the moment in the server log
    setTimeout(() => { running = true; setRunLabel(); loop(); }, saved ? 0 : 1500);
  })
  .catch((err) => { $('code-note').textContent = `Could not start: ${err.message}`; console.error(err); });
window.__gym = { get gen() { return runner.gen; }, get history() { return runner.history; }, get firstSolved() { return runner.firstSolved; } };
