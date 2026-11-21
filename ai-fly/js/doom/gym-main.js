// The Doom Gym page.
//   ?fast          a reduced brain (only the cells between the eyes and the output cells): quicker, not the real thing
//   ?flies=1024    how many desks (default 1,024)      ?labs=8   how many brains run at once (default: one per core, up to 8)
//   ?seconds=30    how long a game lasts at most       ?autostart   start at once
//   ?resume        continue the saved run (saved to the local server after every few games)
import { DoomRunner } from './runner.js';
import { loadDoom, DOOM } from './engine.js';
import { parseRig } from './eye.js';
import { readData } from './load.js';
import { Replay, FRAME_W, FRAME_H, ARENA } from './game.js';
import { Screens, BrainDots, drawFacets, scoreColour } from './views.js';
import { describeSetup, KEY } from './setup.js';

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search);
const FAST = P.has('fast');
const LABS = Math.max(1, Math.min(16, Number(P.get('labs')) || Math.min(8, navigator.hardwareConcurrency || 4)));
const PER_LAB = Math.max(1, Math.round((Number(P.get('flies')) || 1024) / LABS));
const SECONDS = Number(P.get('seconds')) || ARENA.seconds;
const STATE_URL = `/state/doom-${FAST ? 'fast' : 'full'}-${LABS}x${PER_LAB}`;
const nf = (x) => Math.round(x).toLocaleString('en-US');

let screens = null, rig = null, dots = null, replayDoom = null, replay = null;
let watchLab = 0, selected = null;          // selected: desk index whose game is replayed instead of the best one
let lastFrames = new Array(LABS).fill(null);
const gameLog = [];                           // every game's score, for the chart

const runner = new DoomRunner({
  labs: LABS, perLab: PER_LAB, fast: FAST, seconds: SECONDS,
  onStatus: (t) => { if (t) $('btn-run').textContent = t[0].toUpperCase() + t.slice(1) + '…'; },
  onFrame, onGame, onRound,
});

// ---------------------------------------------------------------- layout of the two canvases
const live = { cols: Math.min(LABS, 4), rows: Math.ceil(LABS / Math.min(LABS, 4)), tw: 0, th: 0, gap: 8 };
const wall = { labCols: LABS >= 8 ? 4 : LABS >= 4 ? 2 : LABS, cols: 0, rows: 0, cw: 0, ch: 0, gap: 10, labW: 0, labH: 0 };
function layout() {
  const lc = $('live'), w = lc.clientWidth;
  live.tw = Math.floor((w - live.gap * (live.cols - 1)) / live.cols); live.th = Math.round(live.tw * FRAME_H / FRAME_W);
  const lh = live.rows * live.th + (live.rows - 1) * live.gap;
  lc.style.height = `${lh}px`; lc.width = w; lc.height = lh;
  const wc = $('wall'), ww = wc.clientWidth;
  wall.labRows = Math.ceil(LABS / wall.labCols);
  wall.cols = Math.max(1, Math.ceil(Math.sqrt(PER_LAB * 2)));
  wall.rows = Math.ceil(PER_LAB / wall.cols);
  wall.cw = Math.max(4, Math.floor((ww - wall.gap * (wall.labCols - 1)) / (wall.labCols * wall.cols)));
  wall.ch = Math.max(3, Math.round(wall.cw * FRAME_H / FRAME_W));
  wall.labW = wall.cw * wall.cols; wall.labH = wall.ch * wall.rows + 16;
  const wh = wall.labRows * wall.labH + (wall.labRows - 1) * wall.gap;
  wc.style.height = `${wh}px`; wc.width = ww; wc.height = wh;
  redrawWall();
  for (let lab = 0; lab < LABS; lab++) if (lastFrames[lab]) drawLive(lastFrames[lab]); else drawLiveIdle(lab);
}
const liveXY = (lab) => [(lab % live.cols) * (live.tw + live.gap), Math.floor(lab / live.cols) * (live.th + live.gap)];
function deskXY(lab, d) {
  const ox = (lab % wall.labCols) * (wall.labW + wall.gap), oy = Math.floor(lab / wall.labCols) * (wall.labH + wall.gap) + 16;
  return [ox + (d % wall.cols) * wall.cw, oy + Math.floor(d / wall.cols) * wall.ch];
}

// ---------------------------------------------------------------- drawing
function drawLiveIdle(lab) {
  const g = $('live').getContext('2d'), [x, y] = liveXY(lab);
  g.fillStyle = '#0b0e14'; g.fillRect(x, y, live.tw, live.th);
  g.fillStyle = '#5f6878'; g.font = '600 11px system-ui'; g.fillText(`LAB ${lab + 1} · waiting`, x + 8, y + 16);
}
function drawLive(m) {
  const g = $('live').getContext('2d'), [x, y] = liveXY(m.lab);
  g.imageSmoothingEnabled = false;
  g.drawImage(screens.canvasOf(m.frame, m.pal), x, y, live.tw, live.th);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, live.tw, 17);
  g.font = '600 10.5px system-ui'; g.fillStyle = '#cfd3dc';
  g.fillText(`LAB ${m.lab + 1} · desk ${m.desk + 1}`, x + 6, y + 12);
  g.textAlign = 'right'; g.fillStyle = m.health > 0 ? '#eceef3' : '#ff5d62';
  g.fillText(`${m.kills} killed · health ${Math.max(0, m.health)} · ${(m.tic / 35).toFixed(0)} s`, x + live.tw - 6, y + 12); g.textAlign = 'left';
  if (m.rates && m.rates.fire) { g.fillStyle = '#ffb547'; g.fillRect(x + live.tw - 10, y + live.th - 10, 6, 6); }
  if (m.lab === watchLab) { g.strokeStyle = '#5fd4ff'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, live.tw - 2, live.th - 2); }
}
function drawDesk(lab, d, frame, pal, info, playing = false) {
  const g = $('wall').getContext('2d'), [x, y] = deskXY(lab, d), { cw, ch } = wall;
  g.imageSmoothingEnabled = true;
  if (frame) g.drawImage(screens.canvasOf(frame, pal), x, y, cw - 1, ch - 1);
  else { g.fillStyle = info ? '#151a24' : '#10131a'; g.fillRect(x, y, cw - 1, ch - 1); }
  if (info && !playing) {
    g.fillStyle = scoreColour(info.score); g.fillRect(x, y + ch - 3, (cw - 1) * Math.max(0.04, info.score / 8), 2);
    if (info.perfect) { g.strokeStyle = 'rgba(69, 212, 131, 0.95)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cw - 2, ch - 2); }
  }
  if (playing) { g.strokeStyle = '#5fd4ff'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cw - 2, ch - 2); }
}
function redrawWall() {
  const c = $('wall'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  for (let lab = 0; lab < LABS; lab++) {
    const ox = (lab % wall.labCols) * (wall.labW + wall.gap), oy = Math.floor(lab / wall.labCols) * (wall.labH + wall.gap);
    g.fillStyle = '#8d96a7'; g.font = '600 10.5px system-ui, sans-serif'; g.fillText(`LAB ${lab + 1}`, ox, oy + 10);
    for (let d = 0; d < PER_LAB; d++) { const l = runner.last[lab * PER_LAB + d]; drawDesk(lab, d, l && l.thumb, l ? l.pal : 0, l); }
  }
}
function labBest() {
  const g = $('wall').getContext('2d');
  for (let lab = 0; lab < LABS; lab++) {
    const ox = (lab % wall.labCols) * (wall.labW + wall.gap), oy = Math.floor(lab / wall.labCols) * (wall.labH + wall.gap);
    let best = -1, n = 0;
    for (let d = 0; d < PER_LAB; d++) { const l = runner.last[lab * PER_LAB + d]; if (l) { best = Math.max(best, l.score); n++; } }
    g.clearRect(ox + 60, oy, wall.labW - 60, 14);
    if (n) { g.fillStyle = best > 7.99 ? '#45d483' : '#5f6878'; g.font = '600 10.5px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`best ${best.toFixed(1)}`, ox + wall.labW, oy + 10); g.textAlign = 'left'; }
  }
}

const METERS = [['left', 'steer left', 60, '#5fd4ff'], ['right', 'steer right', 60, '#5fd4ff'], ['walk', 'walk', 150, '#45d483'], ['back', 'back up', 60, '#a98bff'], ['jump', 'jump neuron', 150, '#ffb547']];
function buildMeters() {
  $('meters').innerHTML = METERS.map(([k, name, , c]) => `<div class="meter" id="m-${k}"><span>${name}</span><i><b style="--c:${c}"></b></i><span>0</span></div>`).join('')
    + `<div class="meter" id="m-fire"><span>trigger</span><i><b style="--c:#ff5d62"></b></i><span>–</span></div>`;
}
function drawMeters(r) {
  for (const [k, , max] of METERS) {
    const el = $(`m-${k}`); el.querySelector('b').style.width = `${Math.min(100, 100 * r[k] / max)}%`; el.lastElementChild.textContent = `${Math.round(r[k])}/s`;
  }
  const f = $('m-fire'); f.classList.toggle('on', !!r.fire); f.querySelector('b').style.width = r.fire ? '100%' : '0'; f.lastElementChild.textContent = r.fire ? 'pulled' : '–';
}

// ---------------------------------------------------------------- events from the labs
let lastBrainDraw = 0;
function onFrame(m) {
  lastFrames[m.lab] = m;
  drawLive(m);
  drawDesk(m.lab, m.desk, m.frame, m.pal, null, true);
  if (m.lab === watchLab && m.facets) {
    const setup = runner.setups[m.lab * PER_LAB + m.desk];
    const n = drawFacets($('facets').getContext('2d'), 176, 132, rig, m.facets, setup[KEY.screen]);
    $('facets-note').textContent = `what its eyes get: ${n} facets look at the screen`;
    if (dots && m.spikes) dots.spikes(m.spikes, 1 / Math.max(0.05, m.spikeShare) * 0.35);
    drawMeters(m.rates);
    $('head-title').textContent = `Inside the head of lab ${m.lab + 1}, desk ${m.desk + 1}`;
    $('head-note').textContent = m.speed ? `this brain runs at ${m.speed.toFixed(2)}× real time` : '';
  }
}

function onGame({ index, lab, desk, result, first, better }) {
  const l = runner.last[index];
  drawDesk(lab, desk, l.thumb, l.pal, l);
  labBest();
  gameLog.push(result.score);
  updateStats();
  drawChart();
  if (first) {
    $('banner').innerHTML = `<b>Round ${runner.round + 1}, game ${nf(runner.games)}:</b> the fly at desk ${desk + 1} in lab ${lab + 1} killed all 8 monsters and is still alive!`;
    $('banner').classList.add('show');
    $('milestone').textContent = `first perfect game: game ${nf(runner.games)}`;
  }
  if (better && selected === null) showReplay();
  if (better) renderSetup();
  if (runner.games % 16 === 0) runner.save(STATE_URL);
}

function onRound(stat) {
  runner.save(STATE_URL);
  updateStats();
  redrawWall();        // the copied setups have not played yet: their desks keep the old picture until they do
  drawChart();
}

function updateStats() {
  const played = runner.playedThisRound;
  $('st-round').textContent = nf(runner.round + 1);
  $('st-played').textContent = `${nf(played)} / ${nf(runner.desks)}`;
  $('st-games').textContent = nf(runner.games);
  $('st-best').textContent = runner.best ? `${runner.best.score.toFixed(2)} / 8` : '–';
  const recent = gameLog.slice(-50);
  $('st-mean').textContent = recent.length ? (recent.reduce((a, b) => a + b, 0) / recent.length).toFixed(2) : '–';
  $('st-solved').textContent = nf(runner.perfect);
  $('st-speed').textContent = runner.speed ? `${runner.speed.toFixed(2)}× real time` : '–';
  const i = runner.impulses;
  $('st-impulses').textContent = i >= 1e9 ? `${(i / 1e9).toFixed(2)} bn` : i >= 1e6 ? `${(i / 1e6).toFixed(1)} M` : nf(i);
}

// ---------------------------------------------------------------- the replay screen (a third Doom, on the page itself)
function showReplay() {
  if (!replayDoom) return;
  let rec = null;
  if (selected !== null && runner.records[selected]) {
    const lab = Math.floor(selected / PER_LAB), d = selected % PER_LAB, l = runner.last[selected];
    rec = runner.records[selected];
    $('replay-title').textContent = `Lab ${lab + 1}, desk ${d + 1}: latest game`;
    $('replay-note').innerHTML = `${l.score.toFixed(2)} of 8 · ${l.kills} killed · <a href="#" id="to-best">back to the best game</a>`;
    $('to-best').onclick = (e) => { e.preventDefault(); selected = null; showReplay(); renderSetup(); };
  } else if (runner.best) {
    const b = runner.best; rec = b.record;
    $('replay-title').textContent = 'Best game so far';
    $('replay-note').textContent = `lab ${b.lab + 1}, desk ${b.desk + 1}, round ${b.round} · ${b.score.toFixed(2)} of 8 · ${b.kills} killed${b.perfect ? ' · perfect' : ''}`;
  }
  if (!rec) return;
  replay = new Replay(replayDoom, { ...ARENA, seconds: SECONDS }).start(rec);
  replay.hold = 0;
}
let replayAt = 0;
function replayTick(t) {
  if (replay && t - replayAt >= 1000 / 35) {
    replayAt = t - Math.min(40, (t - replayAt) % (1000 / 35));
    if (replay.hold > 0) { if (--replay.hold === 0) replay.start(replay.rec); }
    else if (!replay.step()) replay.hold = 70;                // show the end for 2 seconds, then again
    const pal = replayDoom.state[DOOM.S.PALETTE];
    const g = $('replay').getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(screens.canvasOf(replayDoom.renderFull(), pal, 320, 200, 'replay'), 0, 0);
  }
}

function renderSetup() {
  const idx = selected !== null ? selected : runner.best ? runner.best.lab * PER_LAB + runner.best.desk : -1;
  const setup = selected !== null ? runner.setups[selected] : runner.best ? runner.best.setup : null;
  if (!setup) { $('setup').innerHTML = '<span class="muted">no game yet</span>'; return; }
  $('setup-note').textContent = selected !== null ? `lab ${Math.floor(idx / PER_LAB) + 1}, desk ${idx % PER_LAB + 1}` : 'the fly\'s brain is never changed; the gym tunes the desk';
  $('setup').innerHTML = describeSetup(setup).map((k) => {
    const pos = (v) => `${Math.max(0, Math.min(100, 100 * (v - k.min) / (k.max - k.min)))}%`;
    return `<div class="knob" title="${k.text}"><span>${k.name}</span><div class="track"><u style="left:${pos(k.def)}"></u><b style="left:${pos(k.value)}"></b></div><span>${k.shown}</span></div>`;
  }).join('') + `<span class="muted">grey mark = the standard setting · hover a knob to see what it does${setup[KEY.turn] < 0 ? ' · this desk reads the ball the other way round: when the fly tries to turn away from something, the view turns towards it' : ''}</span>`;
}

// ---------------------------------------------------------------- chart: every game's score
function drawChart() {
  const c = $('chart'), w = c.clientWidth, h = c.clientHeight;
  c.width = w * devicePixelRatio; c.height = h * devicePixelRatio;
  const g = c.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
  const L = 26, R = 12, T = 8, B = 18, iw = w - L - R, ih = h - T - B;
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.fillStyle = '#5f6878'; g.font = '10px system-ui';
  for (const v of [0, 2, 4, 6, 8]) { const y = T + ih - (v / 8) * ih; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(String(v), 8, y + 3); }
  const n = gameLog.length; if (!n) return;
  const span = Math.max(n, 64), X = (i) => L + (i / (span - 1)) * iw, Y = (v) => T + ih - (v / 8) * ih;
  g.fillStyle = 'rgba(141,150,167,0.35)';
  const stride = Math.max(1, Math.floor(n / 3000));
  for (let i = 0; i < n; i += stride) g.fillRect(X(i) - 1, Y(gameLog[i]) - 1, 2, 2);
  let best = 0, sum = 0; const win = [];
  const bestLine = [], meanLine = [];
  for (let i = 0; i < n; i++) { best = Math.max(best, gameLog[i]); win.push(gameLog[i]); sum += gameLog[i]; if (win.length > 50) sum -= win.shift(); bestLine.push(best); meanLine.push(sum / win.length); }
  for (const [line, col] of [[meanLine, '#a98bff'], [bestLine, '#ffb547']]) {
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < n; i += stride) i ? g.lineTo(X(i), Y(line[i])) : g.moveTo(X(i), Y(line[i]));
    g.stroke();
  }
  g.fillStyle = '#5f6878'; g.fillText(`${nf(n)} games`, w - R - 70, h - 4);
}

// ---------------------------------------------------------------- controls
function setRunLabel() { $('btn-run').textContent = runner.running ? 'Pause' : runner.games ? 'Keep playing' : 'Start'; }
$('btn-run').addEventListener('click', () => { if (runner.running) runner.pause(); else runner.start(); setRunLabel(); });
$('btn-reset').addEventListener('click', async () => {
  runner.pause(); $('btn-run').disabled = true; $('btn-reset').disabled = true;
  await runner.init();                                  // fresh workers, so nothing of the old games is left
  runner.reset(); gameLog.length = 0; lastFrames = new Array(LABS).fill(null); selected = null; replay = null;
  $('banner').classList.remove('show'); $('milestone').textContent = '';
  runner.watch(-1); runner.watched = -1; runner.watch(watchLab);
  layout(); updateStats(); drawChart(); renderSetup();
  $('btn-run').disabled = false; $('btn-reset').disabled = false; setRunLabel();
});
$('live').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const lab = Math.floor(y / (live.th + live.gap)) * live.cols + Math.floor(x / (live.tw + live.gap));
  if (lab < 0 || lab >= LABS) return;
  const old = watchLab; watchLab = lab; runner.watch(lab);
  if (lastFrames[old]) drawLive(lastFrames[old]);
  if (lastFrames[lab]) drawLive(lastFrames[lab]);
});
function deskAt(e) {
  const r = $('wall').getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const lc = Math.floor(px / (wall.labW + wall.gap)), lr = Math.floor(py / (wall.labH + wall.gap)), lab = lr * wall.labCols + lc;
  if (lab >= LABS || lc >= wall.labCols) return -1;
  const x = px - lc * (wall.labW + wall.gap), y = py - lr * (wall.labH + wall.gap) - 16;
  if (x < 0 || y < 0 || x >= wall.labW) return -1;
  const d = Math.floor(y / wall.ch) * wall.cols + Math.floor(x / wall.cw);
  return d < PER_LAB ? lab * PER_LAB + d : -1;
}
$('wall').addEventListener('mousemove', (e) => {
  const i = deskAt(e), tip = $('tip');
  if (i < 0) { tip.classList.add('hidden'); return; }
  const l = runner.last[i], card = $('wall').parentElement.getBoundingClientRect();
  tip.textContent = `Lab ${Math.floor(i / PER_LAB) + 1} · desk ${i % PER_LAB + 1} · ` + (l ? `${l.score.toFixed(2)} of 8 · ${l.kills} killed · ${l.dead ? 'died' : 'alive'} after ${l.seconds.toFixed(0)} s${runner.records[i] ? ' · click to replay' : ''}` : 'has not played yet');
  tip.style.left = `${e.clientX - card.left + 14}px`; tip.style.top = `${e.clientY - card.top + 14}px`;
  tip.classList.remove('hidden');
});
$('wall').addEventListener('mouseleave', () => $('tip').classList.add('hidden'));
$('wall').addEventListener('click', (e) => { const i = deskAt(e); if (i >= 0 && runner.records[i]) { selected = i; showReplay(); renderSetup(); } });
$('replay').addEventListener('click', () => { if (selected !== null) { selected = null; showReplay(); renderSetup(); } });
addEventListener('resize', () => { layout(); drawChart(); });

let lastT = 0;
function frame(t) {
  replayTick(t);
  if (dots && t - lastBrainDraw > 45) { dots.draw((t - lastBrainDraw) / 1000); lastBrainDraw = t; }
  lastT = t;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
(async () => {
  buildMeters();
  const info = await runner.init();
  screens = new Screens(runner.palettes);
  rig = parseRig(runner.rigBin, runner.rigMeta);
  $('mode').classList.toggle('fast', FAST);
  $('mode').innerHTML = FAST
    ? `FAST MODE: a reduced brain of ${nf(info.neurons)} of the 138,639 neurons (the cells between the eyes and the output cells). <a href="${location.pathname}">Switch to the complete brain</a>`
    : `Complete brain: ${nf(info.neurons)} neurons and ${nf(info.connections)} connections for every fly, nothing left out. ${nf(info.driven)} eye cells receive the picture. ${LABS} flies play at once, ${nf(runner.desks)} desks take turns.`;
  $('live-title').textContent = `Playing right now: ${LABS} flies`;
  if (P.has('resume') && await runner.load(STATE_URL)) {
    for (const l of runner.last) if (l) gameLog.push(l.score);
    if (runner.firstPerfect) $('milestone').textContent = `first perfect game: game ${nf(runner.firstPerfect.game)}`;
  }
  layout(); updateStats(); drawChart(); renderSetup();
  runner.watch(watchLab);
  $('btn-run').disabled = false; $('btn-reset').disabled = false; setRunLabel();
  requestAnimationFrame(frame);
  // the extras can arrive later: the brain picture and the replay screen
  readData('neurons.bin').then((buf) => { dots = new BrainDots($('brain'), buf); }).catch(() => {});
  loadDoom({ wasm: runner.wasm, wad: runner.wad }).then((d) => { replayDoom = d; showReplay(); }).catch((e) => console.error(e));
  if (P.has('autostart')) { runner.start(); setRunLabel(); }
})().catch((err) => { $('btn-run').textContent = 'Could not start'; $('mode').textContent = String(err.message || err); console.error(err); });

window.__doom = { runner, get games() { return runner.games; }, get best() { return runner.best && { score: runner.best.score, kills: runner.best.kills, perfect: runner.best.perfect }; }, gameLog };
