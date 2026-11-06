import * as THREE from 'three';
import { SLOTS, TEMPLATE_HEAD, buildApp, snapshot, runTests } from './blocks.js';
import { FlyCam } from './fly-cam.js';
import { BrainView, loadNeurons } from '../brain-view.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEMPERATURE = 0.05;   // how noisy the fly's choices are (lower = pickier)
const SNIFF_SHOW_MS = 420;  // how long each sniff is shown at 1x speed

// ---------------------------------------------------------------- learning centre worker (RPC)
const worker = new Worker(new URL('../mb-worker.js', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map();
let ready;
const readyPromise = new Promise((r) => (ready = r));
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') { ready(m); return; }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
};
function call(type, payload = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ type, id, ...payload }); });
}
worker.postMessage({ type: 'init' });

// ---------------------------------------------------------------- visuals: fly at the laptop, brain
const flyCam = new FlyCam($('flycam'));
let brainView = null;
const brainCanvas = $('brain');
const brainRenderer = new THREE.WebGLRenderer({ canvas: brainCanvas, antialias: true });
brainRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
loadNeurons(new URL('../../data/neurons.bin', import.meta.url)).then((d) => {
  brainView = new BrainView(d);
  brainView.camera.position.set(0, 0.6, 11);
});
const spikeQueue = [];   // { spikes, start, dur, sent }
function queueSpikes(spikes, dur) { spikeQueue.push({ spikes, start: performance.now(), dur, sent: 0 }); }

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  flyCam.frame();
  if (brainView) {
    for (let i = spikeQueue.length - 1; i >= 0; i--) {
      const q = spikeQueue[i];
      const upto = Math.min(q.spikes.length, Math.floor(q.spikes.length * Math.min(1, (now - q.start) / q.dur)));
      if (upto > q.sent) { brainView.spikes(q.spikes.subarray(q.sent, upto)); q.sent = upto; }
      if (q.sent >= q.spikes.length) spikeQueue.splice(i, 1);
    }
    brainView.update(dt);
    const w = brainCanvas.clientWidth, h = brainCanvas.clientHeight;
    if (brainCanvas.width !== Math.round(w * brainRenderer.getPixelRatio())) brainRenderer.setSize(w, h, false);
    brainView.render(brainRenderer, { left: 0, bottom: h, width: w, height: h }, h);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- code view
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKENS = /(\/\/[^\n]*)|(`(?:\\.|[^`])*`?|'(?:\\.|[^'\n])*'?|"(?:\\.|[^"\n])*"?)|\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(const|let|new|for|if|while|return|of|import|from)\b|\b(THREE|Math|document|scene|meat|meatMat|doener|spin|shave)\b/g;
function highlight(src) {
  let out = '', lastIdx = 0, m;
  TOKENS.lastIndex = 0;
  while ((m = TOKENS.exec(src))) {
    out += esc(src.slice(lastIdx, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'k' : 't';
    out += `<span class="tok-${cls}">${esc(m[0])}</span>`;
    lastIdx = TOKENS.lastIndex;
  }
  return out + esc(src.slice(lastIdx));
}

const codeEl = $('code');
const sections = {};
function renderCodeSkeleton() {
  const headLines = TEMPLATE_HEAD.trim().split('\n').length;
  codeEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'frame';
  head.innerHTML = highlight(`// ── set-up we gave the fly: page, scene, camera, renderer, counter (${headLines} lines) ──`);
  codeEl.appendChild(head);
  SLOTS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'sec pending';
    el.textContent = `// ${i + 1}. ${s.title}: not written yet`;
    codeEl.appendChild(el);
    sections[s.id] = el;
  });
  const tail = document.createElement('div');
  tail.className = 'frame';
  tail.innerHTML = highlight('// ── animation loop we gave the fly: spin(dt); shave(dt); render ──');
  codeEl.appendChild(tail);
}
renderCodeSkeleton();

let speed = 1;
let screenText = '';
async function typeCode(slot, code) {
  const el = sections[slot.id];
  el.className = 'sec active';
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const cps = 260 * speed;
  const t0 = performance.now();
  let n = 0;
  const base = screenText;
  while (n < code.length) {
    await new Promise(requestAnimationFrame);
    n = Math.min(code.length, Math.floor(((performance.now() - t0) / 1000) * cps) + 1);
    el.innerHTML = highlight(code.slice(0, n)) + '<span class="cursor"></span>';
    if (n % 6 === 0 || n === code.length) flyCam.drawCode(base + code.slice(0, n));
  }
  el.innerHTML = highlight(code);
  el.className = 'sec';
  screenText = base + code + '\n\n';
}

// ---------------------------------------------------------------- option cards
const optionList = $('option-list');
const memory = {};   // our log of what happened to each block (the fly's real memory is in its wiring)
function renderOptions(slot) {
  $('slot-title').textContent = slot.title;
  $('slot-step').textContent = `decision ${SLOTS.indexOf(slot) + 1} of ${SLOTS.length}`;
  optionList.innerHTML = '';
  for (const o of slot.options) {
    const el = document.createElement('div');
    el.className = 'opt';
    el.id = `opt-${o.id}`;
    const m = memory[`${slot.id}:${o.id}`];
    const memText = m ? [m.sugar ? `sugar ×${m.sugar}` : '', m.bitter ? `bitter ×${m.bitter}` : ''].filter(Boolean).join(' · ') : 'never tried';
    el.innerHTML = `<div class="row1"><span class="name">${esc(o.label)}</span><span class="pct">…</span></div><div class="bar"><i></i></div><div class="mem">${memText}</div>`;
    optionList.appendChild(el);
  }
}

// ---------------------------------------------------------------- tests panel
const testList = $('test-list');
function renderTests(result) {
  testList.innerHTML = '';
  for (const s of SLOTS) {
    const li = document.createElement('li');
    const r = result && result.res[s.id];
    li.className = result ? (r ? 'pass' : 'fail') : '';
    li.innerHTML = `<span class="ico">${result ? (r ? '✓' : '✗') : '·'}</span><span class="t">${esc(s.test)}<span class="why">${result ? esc(result.why[s.id]) : ''}</span></span>${result ? `<span class="treat">${r ? 'sugar' : 'bitter'}</span>` : '<span></span>'}`;
    testList.appendChild(li);
  }
}
renderTests(null);

function loadApp(html) {
  return new Promise((resolve) => {
    const iframe = $('preview');
    const onload = () => { iframe.removeEventListener('load', onload); resolve(iframe.contentWindow); };
    iframe.addEventListener('load', onload);
    iframe.srcdoc = html;
  });
}
async function testApp(html) {
  const win = await loadApp(html);
  const t0 = performance.now();
  while (!win.doener && !win.doenerError && performance.now() - t0 < 10000) await sleep(50);
  if (!win.doener) return { crashed: win.doenerError || 'The app did not start (is the internet connection down?)' };
  await sleep(1300);
  const a = snapshot(win);
  await sleep(500);
  const b = snapshot(win);
  if (win.doenerError) return { crashed: win.doenerError };
  return runTests(win, a, b);
}

// ---------------------------------------------------------------- chart
const history = [];
function drawChart() {
  const c = $('chart');
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * devicePixelRatio; c.height = h * devicePixelRatio;
  const g = c.getContext('2d');
  g.scale(devicePixelRatio, devicePixelRatio);
  g.clearRect(0, 0, w, h);
  const padL = 12, padR = 12, top = 6, bottom = 16;
  const innerW = w - padL - padR, innerH = h - top - bottom;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.beginPath(); g.moveTo(padL, top); g.lineTo(w - padR, top); g.moveTo(padL, top + innerH); g.lineTo(w - padR, top + innerH); g.stroke();
  const n = Math.max(history.length, 12);
  const bw = innerW / n;
  history.forEach((v, i) => {
    if (v === null) {   // the app crashed this round
      g.fillStyle = '#ff5d62';
      g.font = '11px system-ui';
      g.fillText('×', padL + i * bw + bw / 2 - 3, top + innerH - 3);
      return;
    }
    const bh = (v / 8) * innerH;
    g.fillStyle = v === 8 ? '#45d483' : '#a98bff';
    g.beginPath();
    g.roundRect(padL + i * bw + 2, top + innerH - bh, Math.max(2, bw - 4), Math.max(bh, 2), 3);
    g.fill();
  });
  g.fillStyle = '#5f6878'; g.font = '10px system-ui';
  g.fillText('8', 0, top + 8); g.fillText('0', 0, top + innerH);
  $('chart-note').textContent = history.length ? `${history.length} round${history.length > 1 ? 's' : ''}` : '';
}
drawChart();
addEventListener('resize', drawChart);

// ---------------------------------------------------------------- one round of coding
let running = false, busy = false, round = 0, solvedAt = 0;
let lastHtml = null;

const phase = (t) => ($('phase').textContent = t);

function softmax(vals) {
  const m = Math.max(...vals);
  const ex = vals.map((v) => Math.exp((v - m) / TEMPERATURE));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((x) => x / s);
}

async function oneRound() {
  busy = true;
  round++;
  $('round').textContent = round;
  renderCodeSkeleton();
  screenText = '';
  flyCam.drawCode('');
  renderTests(null);
  $('score').textContent = '–';
  $('verdict').className = 'verdict';
  $('verdict').textContent = 'The fly is coding…';
  const choices = {};
  const picked = {};

  for (const slot of SLOTS) {
    renderOptions(slot);
    sections[slot.id].className = 'sec active';
    sections[slot.id].textContent = `// ${SLOTS.indexOf(slot) + 1}. ${slot.title}: sniffing the options…`;
    const sniffs = [];
    for (const o of slot.options) {
      const el = $(`opt-${o.id}`);
      el.classList.add('sniffing');
      flyCam.sniffing = true;
      phase(`Sniffing “${o.label}”`);
      const r = await call('sniff', { key: `${slot.id}:${o.id}` });
      sniffs.push(r);
      const show = SNIFF_SHOW_MS / speed;
      queueSpikes(r.spikes, show);
      el.querySelector('.pct').textContent = `${(r.kcFraction * 100).toFixed(1)}% of learning cells`;
      await sleep(show);
      el.classList.remove('sniffing');
    }
    flyCam.sniffing = false;
    const probs = softmax(sniffs.map((r) => r.valence));
    slot.options.forEach((o, i) => {
      const el = $(`opt-${o.id}`);
      el.querySelector('.pct').textContent = `${Math.round(probs[i] * 100)}%`;
      el.querySelector('.bar i').style.width = `${(probs[i] * 100).toFixed(1)}%`;
    });
    // the fly decides (with a little noise, like a real one)
    let x = Math.random(), k = 0;
    while (k < probs.length - 1 && (x -= probs[k]) > 0) k++;
    const choice = slot.options[k];
    choices[slot.id] = choice.id;
    picked[slot.id] = { key: `${slot.id}:${choice.id}`, kcs: sniffs[k].kcs };
    slot.options.forEach((o, i) => $(`opt-${o.id}`).classList.add(i === k ? 'chosen' : 'dim'));
    phase(`Picked “${choice.label}”. Typing…`);
    await sleep(350 / speed);
    flyCam.mode = 'type';
    await typeCode(slot, choice.code);
    flyCam.mode = 'idle';
  }

  // serve it
  phase('Serving the döner to the customer…');
  $('verdict').textContent = 'The customer is checking the döner…';
  const html = buildApp(choices);
  lastHtml = html;
  $('btn-download').disabled = false;
  let result = await testApp(html);
  if (result.crashed && /did not start/.test(result.crashed)) result = await testApp(html);   // one retry for slow loads
  if (result.crashed) {
    console.warn('döner app crashed:', result.crashed);
    $('verdict').textContent = `The app crashed: ${result.crashed}. No sugar, no bitter this round.`;
    history.push(null);
    drawChart();
    busy = false;
    return false;
  }
  renderTests(result);
  const passed = SLOTS.filter((s) => result.res[s.id]).length;
  $('score').textContent = passed;
  for (const s of SLOTS) sections[s.id].className = `sec ${result.res[s.id] ? 'pass' : 'fail'}`;

  // dopamine: sugar for passed tests, bitter for failed ones
  phase(passed === 8 ? 'All tests passed! Sugar everywhere.' : `Learning: ${passed} sugar, ${8 - passed} bitter`);
  flyCam.mode = passed >= 4 ? 'feed' : 'idle';
  for (const s of SLOTS) {
    const kind = result.res[s.id] ? 'sugar' : 'bitter';
    await call('learn', { kcs: picked[s.id].kcs, kind });
    const m = (memory[picked[s.id].key] ||= { sugar: 0, bitter: 0 });
    m[kind]++;
  }
  history.push(passed);
  drawChart();
  const fails = SLOTS.filter((s) => !result.res[s.id]).map((s) => result.why[s.id]);
  const v = $('verdict');
  if (passed === 8) {
    if (!solvedAt) solvedAt = round;
    v.className = 'verdict win';
    v.textContent = `“Perfekt, Bruder! Ein Döner, bitte!” The fly's app passes every test (first time in round ${solvedAt}).`;
  } else {
    v.textContent = `“${fails.slice(0, 2).join(' ')}”${fails.length > 2 ? ` …and ${fails.length - 2} more problems.` : ''}`;
  }
  await sleep(900 / speed);
  flyCam.mode = 'idle';
  busy = false;
  return passed === 8;
}

async function loop() {
  while (running) {
    const solved = await oneRound();
    if (solved) { setRunning(false); phase('Done! The fly wrote a working döner app.'); break; }
    await sleep(500 / speed);
  }
}
function setRunning(on) {
  running = on;
  $('run-label').textContent = on ? 'Pause' : round ? 'Keep coding' : 'Start coding';
  $('btn-step').disabled = on;
}

// ---------------------------------------------------------------- controls
$('btn-run').addEventListener('click', () => {
  if (running) { setRunning(false); return; }
  if (busy) return;
  setRunning(true);
  loop();
});
$('btn-step').addEventListener('click', async () => { if (!busy && !running) { $('btn-step').disabled = true; await oneRound(); $('btn-step').disabled = false; } });
document.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => {
  speed = Number(b.dataset.speed);
  document.querySelectorAll('#speed button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('btn-forget').addEventListener('click', async () => {
  if (busy) return;
  await call('forget');
  for (const k of Object.keys(memory)) delete memory[k];
  history.length = 0; round = 0; solvedAt = 0;
  $('round').textContent = '0';
  drawChart();
  renderCodeSkeleton();
  renderTests(null);
  $('verdict').className = 'verdict';
  $('verdict').textContent = 'Memory wiped. The fly has never seen a döner.';
  setRunning(false);
  phase('Memory wiped');
});
$('btn-download').disabled = true;
$('btn-download').addEventListener('click', () => {
  if (!lastHtml) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lastHtml], { type: 'text/html' }));
  a.download = 'doener-by-a-fruit-fly.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$('btn-run').disabled = true;
$('btn-step').disabled = true;
readyPromise.then((m) => {
  phase(`Ready: ${m.neurons.toLocaleString()} neurons, ${m.connections.toLocaleString()} connections`);
  $('btn-run').disabled = false;
  $('btn-step').disabled = false;
});

// for debugging
window.__doener = { SLOTS, memory, history, call, get round() { return round; } };
