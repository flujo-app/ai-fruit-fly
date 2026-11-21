// Doom Cubicles: the Doom Gym as an office you can walk around in. 1,024 flies at 1,024 desks take turns
// at Doom; as many play at the same moment as the computer has cores, because every player has a
// complete fly brain. The building, the walking, the party and the recording are the ones of the
// Cubicles page (js/cubicles/); only what is on the screens and on the supervisor deck is different.
// URL options: ?autostart, ?record, ?autopilot (the camera walks by itself), ?go (skip the start
// screen), ?fast (a reduced brain), ?flies=, ?seconds=, ?resume, ?cam=x,z,yaw,pitch[,height],
// ?size=1920x1080, ?testparty=N (pretend the best fly after N games won, to try the party),
// ?learn (the learning centre switched on: blue light reaches it, kills earn sugar, hits bitter),
// ?level (the real level, Freedoom's first level, instead of the arena; the best game's replay then
// carries a small map of where that fly went).
import * as THREE from 'three';
import { DoomRunner } from './runner.js';
import { loadDoom, DOOM } from './engine.js';
import { Replay, FRAME_W, FRAME_H, taskOf } from './game.js';
import { Screens, LevelMap, scoreColour } from './views.js';
import { describeSetup, KEY } from './setup.js';
import { Office } from '../cubicles/office.js';
import { Workers, NearDesk } from '../cubicles/flies.js';
import { Supervisor } from '../cubicles/supervisor.js';
import { Player, EYE } from '../cubicles/player.js';
import { Party } from '../cubicles/party.js';
import { Hud } from '../cubicles/hud.js';
import { Recorder, FrameRecorder } from '../cubicles/recorder.js';
import { clock, wait } from '../cubicles/clock.js';
import { buildGrid, START, floorHeight, pathFrom, teamOrigin, AISLE, CUB, SCREEN } from '../cubicles/layout.js';

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search);
const AUTOPILOT = P.has('autopilot');
const FAST = P.has('fast');
const LABS = 8, PER_LAB = 128;                       // the building has 8 teams of 128 desks
const TASK = P.has('level') ? 'level' : 'arena', LEVEL = TASK === 'level';      // the arena, or the real level
const SECONDS = Number(P.get('seconds')) || taskOf(TASK).seconds;
const LEARNING = P.has('learn') && !FAST;      // the learning centre switched on (see js/doom/learning.js)
const STATE_URL = `/state/doom-office-${LEVEL ? 'level-' : ''}${FAST ? 'fast' : LEARNING ? 'learn' : 'full'}`;
const nf = (x) => Math.round(x).toLocaleString('en-US');
const pct = (x) => `${Math.round(100 * (x || 0))}%`;
// a game in a few words: the arena counts kills, the level how far the fly got
const told = (l) => LEVEL ? `${pct(l.way)} of the way` : `${l.kills} killed`;
const WON = LEVEL ? 'found the exit of the level' : 'killed all 8 monsters';
const BUTTONS = [
  { id: 'pause', label: 'PAUSE', color: 0x9aa4b5 },
  { id: 'play', label: 'PLAY', color: 0x45d483 },
  { id: 'reset', label: 'NEW DESKS', color: 0xd63b3b },
  { id: 'rec', label: 'REC', color: 0xff2d55 },
];

// ---------------------------------------------------------------- the 3D world
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f27);
scene.fog = new THREE.Fog(0x1b1f27, 30, 120);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 300);
scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x302e2a, 1.25));
const sun = new THREE.DirectionalLight(0xfff6e8, 1.3);
sun.position.set(20, 40, 15);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.12));

const office = new Office(scene, LABS, PER_LAB);
const workers = new Workers(scene, office);
const supervisor = new Supervisor(scene, BUTTONS);
const grid = buildGrid(LABS, PER_LAB);
const player = new Player(camera, canvas, grid);
player.setPose(START.x, START.z, START.yaw, 0.17);
const party = new Party(scene, office, workers, grid, 'Head of Doom');
const hud = new Hud();
const FRAMES = AUTOPILOT && P.has('record') && FrameRecorder.supported;
const recorder = FRAMES ? new FrameRecorder(canvas, 30) : new Recorder(canvas);
if (FRAMES) clock.useFrames(30);
const near = Array.from({ length: 8 }, () => new NearDesk(scene, office));

const FIXED = P.has('size') ? P.get('size').split('x').map(Number) : null;
if (FIXED) renderer.setPixelRatio(1);
function resize() {
  const [w, h] = FIXED || [innerWidth, innerHeight];
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  hud.resize(size.x, size.y);
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- the games
let screens = null, replayDoom = null, replay = null, banner = '', resetArmed = 0, levelMap = null;
const liveFrames = new Array(LABS).fill(null);     // the latest picture of each lab's running game
const liveDesk = new Int32Array(LABS).fill(-1);    // which desk of each lab is playing
const gameLog = [];
let atlasDirty = true, atlasAt = 0, screenDirty = true, screenAt = 0, signsAt = 0, liveDirty = false, liveAt = 0;

const runner = new DoomRunner({ labs: LABS, perLab: PER_LAB, fast: FAST, learn: LEARNING, task: TASK, seconds: SECONDS, onFrame, onGame, onRound });

function onFrame(m) {
  liveFrames[m.lab] = m;
  liveDesk[m.lab] = m.lab * PER_LAB + m.desk;
  liveDirty = true;
}

function onGame({ index, lab, desk, result, first, better }) {
  gameLog.push(result.score);
  liveDesk[lab] = -1;
  atlasDirty = true; screenDirty = true;
  if (better && !party.active) showReplay();
  if (first) startParty(lab, desk, result);
  else if (P.has('testparty') && runner.games === (Number(P.get('testparty')) || 12) && !party.active) startParty(runner.best.lab, runner.best.desk, runner.best);
  if (runner.games % 16 === 0) runner.save(STATE_URL);
  if (runner.games % 50 === 0) fetch(`/ping?games=${runner.games}&best=${runner.best.score.toFixed(2)}&perfect=${runner.perfect}&speed=${runner.speed.toFixed(2)}`).catch(() => {});
  updateStatus();
}
function onRound() { runner.save(STATE_URL); atlasDirty = true; screenDirty = true; hud.toast(`Round ${runner.round} is over. The best desks' setups were copied over the worst ones; round ${runner.round + 1} begins.`, 8); }

function setPlaying(on) {
  if (on) runner.start(); else runner.pause();
  supervisor.setActive([on ? 'play' : 'pause', ...(recorder.active ? ['rec'] : [])]);
  screenDirty = true;
  updateStatus();
}

function updateStatus() {
  const s = runner.running ? `playing · one brain runs at ${runner.speed ? runner.speed.toFixed(2) : '–'}× real time` : (runner.games ? 'paused' : 'not started');
  hud.set({ status: `Round ${runner.round + 1}  ·  desk ${nf(runner.playedThisRound)} of ${nf(runner.desks)}  ·  best ${runner.best ? runner.best.score.toFixed(2) : '–'} / 8  ·  ${LEVEL ? 'found the exit' : 'perfect games'} ${runner.perfect}  ·  ${s}` });
}

async function newDesks() {
  const was = runner.running;
  runner.pause();
  party.endParty();
  banner = ''; replay = null; gameLog.length = 0; liveFrames.fill(null); liveDesk.fill(-1);
  await runner.init();
  runner.reset();
  atlasDirty = true; screenDirty = true;
  hud.toast('1,024 desks were set up from scratch. The flies are the same as ever.');
  setPlaying(was);
}

// ---------------------------------------------------------------- all 1,024 monitors (one shared picture)
function drawAtlas() {
  const g = office.atlas.getContext('2d'), T = 64;
  for (let i = 0; i < runner.desks; i++) {
    const x = (i % 32) * T, y = Math.floor(i / 32) * T, l = runner.last[i], lab = Math.floor(i / PER_LAB);
    const liveNow = liveDesk[lab] === i && liveFrames[lab];
    if (liveNow) { g.drawImage(screens.canvasOf(liveFrames[lab].frame, liveFrames[lab].pal), x, y, T, T); continue; }
    if (l && l.thumb) g.drawImage(screens.canvasOf(l.thumb, l.pal), x, y, T, T);
    else { g.fillStyle = l ? '#1a202b' : '#0c0f15'; g.fillRect(x, y, T, T); }
    if (l) {
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y + T - 12, T, 12);
      g.fillStyle = scoreColour(l.score); g.fillRect(x, y + T - 9, T * Math.max(0.04, l.score / 8), 6);
      if (l.perfect) { g.strokeStyle = '#45d483'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, T - 4, T - 4); }
    }
  }
  office.atlasTex.needsUpdate = true;
}

// ---------------------------------------------------------------- the sharp screens near the visitor
// (the same detailed flies as in the Cubicles; here their screens show the desk's game)
NearDesk.prototype.update = function (dt, now) {
  if (this.cube < 0) return;
  const i = this.cube, lab = Math.floor(i / PER_LAB), live = liveDesk[lab] === i ? liveFrames[lab] : null;
  if (this.auto) this.mode = live ? 'type' : 'groom';
  this.fly.update(dt, { speed: 0, turn: 0, mode: this.mode, proboscis: this.proboscis });
  if (!screens) return;
  const key = live ? `L${live.tic}` : this.winner && replay ? `R${replay.tic}` : `S${runner.last[i] ? runner.last[i].round + ':' + runner.last[i].score : 'none'}`;
  if (key === this.drawnKey) return;
  this.drawnKey = key;
  const g = this.canvas.getContext('2d'), W = 640, H = 384, l = runner.last[i];
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#07090d'; g.fillRect(0, 0, W, H);
  if (this.winner && replayDoom && replay) g.drawImage(screens.canvasOf(replayDoom.renderFull(), replayDoom.state[DOOM.S.PALETTE], 320, 200, 'near-replay'), 0, 34, W, H - 34);
  else if (live) g.drawImage(screens.canvasOf(live.frame, live.pal), 0, 34, W, H - 34);
  else if (l && l.thumb) g.drawImage(screens.canvasOf(l.thumb, l.pal), 0, 34, W, H - 34);
  else { g.fillStyle = '#5f6878'; g.font = '600 22px "Segoe UI", system-ui'; g.textAlign = 'center'; g.fillText(l ? 'waiting for the next round' : 'waiting for its turn', W / 2, H / 2 + 20); g.textAlign = 'left'; }
  g.fillStyle = '#1a1f29'; g.fillRect(0, 0, W, 34);
  g.font = '600 18px "Segoe UI", system-ui';
  g.fillStyle = '#ffb547'; g.fillText(`Lab ${lab + 1} · desk ${i % PER_LAB + 1}`, 12, 23);
  g.textAlign = 'right';
  if (live) { g.fillStyle = '#45d483'; g.fillText(`PLAYING · ${told(live)} · health ${Math.max(0, live.health)}`, W - 12, 23); }
  else if (l) { g.fillStyle = l.perfect ? '#45d483' : '#8d96a7'; g.fillText(`last game: ${l.score.toFixed(2)} / 8 · ${told(l)}${l.dead ? ' · died' : ''}`, W - 12, 23); }
  g.textAlign = 'left';
  this.tex.needsUpdate = true;
};

function assignNear() {
  const cx = camera.position.x, cz = camera.position.z, fwd = player.forward;
  const want = [];
  for (let i = 0; i < office.n; i++) {
    if (party.active && i === party.i) continue;
    const c = office.cubes[i], dx = c.x - cx, dz = c.z - cz, d = Math.hypot(dx, dz);
    if (d > 9) continue;
    const ahead = (dx * fwd.x + dz * fwd.z) / (d || 1);
    want.push([d - ahead * 2.5, i]);
  }
  want.sort((a, b) => a[0] - b[0]);
  const chosen = new Set(want.slice(0, near.length).map((w) => w[1]));
  const free = near.filter((d) => !chosen.has(d.cube));
  for (const i of chosen) {
    if (near.some((d) => d.cube === i)) continue;
    const d = free.pop();
    d.assign(i); d.auto = true; d.drawnKey = '';
  }
  for (const d of free) d.assign(-1);
  workers.hidden = new Set([...near.filter((d) => d.cube >= 0).map((d) => d.cube), ...(party.active ? [party.i] : []), ...(party.away || [])]);
}

// a floating marker over every desk that is playing right now
const markers = Array.from({ length: LABS }, () => {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: 0x5fd4ff, toneMapped: false }));
  m.visible = false; scene.add(m); return m;
});

// ---------------------------------------------------------------- the supervisor's wall screen
// Two small, quick pictures sit in front of the big (slow) one: the games running right now and the best game so far.
const W = 1920, H = 1080;
const LIVE = { x: 48, y: 342, tw: 264, th: 165, gap: 8 }, BEST = { x: 1190, y: 342, w: 682, h: 426 };
function overlay(px, py, pw, ph, cw, ch) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw / W * SCREEN.w, ph / H * SCREEN.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.position.set(SCREEN.x + (0.5 - (px + pw / 2) / W) * SCREEN.w, SCREEN.y + (0.5 - (py + ph / 2) / H) * SCREEN.h, SCREEN.z - 0.075);
  m.rotation.y = Math.PI;
  scene.add(m);
  return { c, g: c.getContext('2d'), tex };
}
const liveW = 4 * LIVE.tw + 3 * LIVE.gap, liveH = 2 * LIVE.th + LIVE.gap;
const liveView = overlay(LIVE.x, LIVE.y, liveW, liveH, liveW / 2, liveH / 2);
// the best game's screen: Doom's 320 x 200 picture; twice as fine in the level, so that the small map on it stays sharp
const RW = LEVEL ? 640 : 320, RH = LEVEL ? 400 : 200;
const bestView = overlay(BEST.x, BEST.y, BEST.w, BEST.h, RW, RH);
liveView.g.fillStyle = '#0b0d12'; liveView.g.fillRect(0, 0, liveW, liveH);
bestView.g.fillStyle = '#000'; bestView.g.fillRect(0, 0, RW, RH);

function drawLive() {
  const g = liveView.g, tw = LIVE.tw / 2, th = LIVE.th / 2, gap = LIVE.gap / 2;
  g.imageSmoothingEnabled = false;
  for (let lab = 0; lab < LABS; lab++) {
    const x = (lab % 4) * (tw + gap), y = Math.floor(lab / 4) * (th + gap), m = liveFrames[lab];
    if (m && liveDesk[lab] >= 0) g.drawImage(screens.canvasOf(m.frame, m.pal), x, y, tw, th);
    else { g.fillStyle = '#10131a'; g.fillRect(x, y, tw, th); }
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y, tw, 11);
    g.fillStyle = '#eceef3'; g.font = '600 8px "Segoe UI", system-ui';
    g.fillText(m && liveDesk[lab] >= 0 ? `LAB ${lab + 1} · DESK ${m.desk + 1} · ${told(m).toUpperCase()} · HEALTH ${Math.max(0, m.health)}` : `LAB ${lab + 1} · between games`, x + 3, y + 8);
  }
  liveView.tex.needsUpdate = true;
}

function drawScreen() {
  const g = supervisor.canvas.getContext('2d');
  g.fillStyle = '#0b0d12'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = '#ffb547'; g.font = '800 30px "Segoe UI", system-ui'; g.fillText('DOOM GYM · LIVE FROM THE CUBICLES', 48, 66);
  g.fillStyle = '#eceef3'; g.font = '700 52px "Segoe UI", system-ui'; g.fillText(LEVEL ? "1,024 fruit flies take turns at Doom's first level" : '1,024 fruit flies take turns at Doom', 48, 128);
  g.textAlign = 'right';
  g.fillStyle = runner.running ? '#45d483' : '#9aa4b5'; g.font = '800 44px "Segoe UI", system-ui';
  g.fillText(runner.running ? 'PLAYING' : (runner.games ? 'PAUSED' : 'PRESS PLAY TO START'), W - 48, 74);
  g.fillStyle = '#8d96a7'; g.font = '500 30px "Segoe UI", system-ui';
  g.fillText(FAST ? 'FAST MODE: a reduced brain' : 'every player has a complete brain: 138,639 neurons', W - 48, 120);
  if (recorder.active) { g.fillStyle = '#ff2d55'; g.beginPath(); g.arc(W - 800, 110, 12, 0, 7); g.fill(); }
  g.textAlign = 'left';
  const recent = gameLog.slice(-50), mean = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const tiles = [['ROUND', nf(runner.round + 1)], ['DESKS PLAYED', `${nf(runner.playedThisRound)} / ${nf(runner.desks)}`], ['BEST SCORE', runner.best ? `${runner.best.score.toFixed(2)} / 8` : '–'],
    ['AVERAGE', mean != null ? mean.toFixed(2) : '–'], [LEVEL ? 'FOUND THE EXIT' : 'PERFECT GAMES', String(runner.perfect)], ['ONE BRAIN RUNS AT', runner.speed ? `${runner.speed.toFixed(2)}×` : '–']];
  const tw = (W - 96 - 5 * 16) / 6;
  tiles.forEach(([k, v], i) => {
    const x = 48 + i * (tw + 16);
    g.fillStyle = '#141820'; g.fillRect(x, 160, tw, 116);
    g.fillStyle = '#8d96a7'; g.font = '600 22px "Segoe UI", system-ui'; g.fillText(k, x + 20, 200);
    g.fillStyle = (k === 'PERFECT GAMES' || k === 'FOUND THE EXIT') && runner.perfect ? '#45d483' : '#eceef3'; g.font = '700 46px "Segoe UI", system-ui'; g.fillText(v, x + 20, 254);
  });
  g.fillStyle = '#8d96a7'; g.font = '700 22px "Segoe UI", system-ui';
  g.fillText(`PLAYING RIGHT NOW (ONE BRAIN PER PROCESSOR CORE)`, LIVE.x, LIVE.y - 14);
  const b = runner.best;
  g.fillText(b ? `BEST GAME SO FAR · LAB ${b.lab + 1}, DESK ${b.desk + 1} · ${b.score.toFixed(2)} / 8${LEVEL ? ' · ' + told(b).toUpperCase() + ' TO THE EXIT' : ''}` : 'BEST GAME SO FAR', BEST.x, BEST.y - 14);
  if (banner) {
    g.fillStyle = 'rgba(69,212,131,0.16)'; g.fillRect(BEST.x, BEST.y + BEST.h + 14, BEST.w, 64);
    g.strokeStyle = '#45d483'; g.lineWidth = 3; g.strokeRect(BEST.x, BEST.y + BEST.h + 14, BEST.w, 64);
    g.fillStyle = '#45d483'; g.font = '800 24px "Segoe UI", system-ui'; g.fillText(banner, BEST.x + 16, BEST.y + BEST.h + 55, BEST.w - 32);
  }
  // every desk's latest game
  const top = LIVE.y + liveH + 46, cw = 15, ch = 9, labW = 16 * cw, labH = 8 * ch;
  g.fillStyle = '#8d96a7'; g.font = '700 22px "Segoe UI", system-ui'; g.fillText("EVERY DESK'S LATEST GAME", 48, top - 14);
  for (let lab = 0; lab < LABS; lab++) {
    const ox = 48 + (lab % 4) * (labW + 26), oy = top + Math.floor(lab / 4) * (labH + 36);
    g.fillStyle = '#5f6878'; g.font = '600 18px "Segoe UI", system-ui'; g.fillText(`LAB ${lab + 1}`, ox, oy + 14);
    for (let d = 0; d < PER_LAB; d++) {
      const l = runner.last[lab * PER_LAB + d], x = ox + (d % 16) * cw, y = oy + 22 + Math.floor(d / 16) * ch;
      if (l && l.thumb) g.drawImage(screens.canvasOf(l.thumb, l.pal), x, y, cw - 1, ch - 1); else { g.fillStyle = l ? '#1a202b' : '#10131a'; g.fillRect(x, y, cw - 1, ch - 1); }
      if (l) { g.fillStyle = scoreColour(l.score); g.fillRect(x, y + ch - 3, (cw - 1) * Math.max(0.05, l.score / 8), 2); if (l.perfect) { g.strokeStyle = '#45d483'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cw - 2, ch - 2); } }
    }
  }
  // progress
  const cx = 48 + 4 * (labW + 26) + 10, cy = top - 6, cwid = BEST.x - 30 - cx, chh = 2 * (labH + 36) + 6;
  if (cwid > 60) {
    g.fillStyle = '#141820'; g.fillRect(cx, cy, cwid, chh);
    const L = cx + 30, R = cx + cwid - 10, T = cy + 14, B = cy + chh - 14, n = gameLog.length;
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (const v of [0, 4, 8]) { const y = B - (v / 8) * (B - T); g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.fillStyle = '#5f6878'; g.font = '14px system-ui'; g.fillText(String(v), cx + 8, y + 5); }
    if (n) {
      const span = Math.max(n, 64), X = (i) => L + (i / (span - 1)) * (R - L), Y = (v) => B - (v / 8) * (B - T);
      let best = 0, sum = 0; const win = [];
      g.strokeStyle = '#ffb547'; g.lineWidth = 3; g.beginPath();
      for (let i = 0; i < n; i++) { best = Math.max(best, gameLog[i]); i ? g.lineTo(X(i), Y(best)) : g.moveTo(X(i), Y(best)); }
      g.stroke();
      g.strokeStyle = '#a98bff'; g.beginPath();
      for (let i = 0; i < n; i++) { win.push(gameLog[i]); sum += gameLog[i]; if (win.length > 50) sum -= win.shift(); i ? g.lineTo(X(i), Y(sum / win.length)) : g.moveTo(X(i), Y(sum / win.length)); }
      g.stroke();
    }
  }
  // the best desk's setup, in words
  if (b) {
    const y0 = BEST.y + BEST.h + (banner ? 104 : 40);
    g.fillStyle = '#8d96a7'; g.font = '700 22px "Segoe UI", system-ui'; g.fillText(LEARNING ? "THE BEST DESK'S SETUP (LEARNING CENTRE ON)" : "THE BEST DESK'S SETUP (THE FLY'S BRAIN IS NEVER CHANGED)", BEST.x, y0);
    g.font = '500 21px "Segoe UI", system-ui';
    describeSetup(b.setup).forEach((k, i) => {
      const x = BEST.x + (i % 3) * (BEST.w / 3), y = y0 + 34 + Math.floor(i / 3) * 30;
      g.fillStyle = '#8d96a7'; g.fillText(k.name, x, y, BEST.w / 3 - 80);
      g.fillStyle = k.key === 'turn' && k.value < 0 ? '#ffb547' : '#eceef3'; g.textAlign = 'right'; g.fillText(k.shown, x + BEST.w / 3 - 16, y); g.textAlign = 'left';
    });
  }
  supervisor.tex.needsUpdate = true;
}

// ---------------------------------------------------------------- the replay of the best game (a Doom of its own, on the page)
function showReplay() {
  if (!replayDoom || !runner.best) return;
  replay = new Replay(replayDoom, taskOf(TASK, { seconds: SECONDS })).start(runner.best.record);
  replay.hold = 0;
  screenDirty = true;
}
let replayAt = 0;
function replayTick(now) {
  if (!replay || now - replayAt < 1000 / 35) return;
  replayAt = now;
  if (replay.hold > 0) { if (--replay.hold === 0) replay.start(replay.rec); }
  else if (!replay.step()) replay.hold = 70;
  bestView.g.imageSmoothingEnabled = false;
  bestView.g.drawImage(screens.canvasOf(replayDoom.renderFull(), replayDoom.state[DOOM.S.PALETTE], 320, 200, 'replay'), 0, 0, RW, RH);
  // in the level: a small map in the corner, with where the best fly went and where it is in the replay
  if (levelMap && runner.best) {
    const st = replayDoom.state, mw = 250, mh = 176, g = bestView.g;
    g.globalAlpha = 0.9;
    levelMap.draw(g, RW - mw - 8, 8, mw, mh, { path: runner.best.path, upTo: replay.tic / 5 + 1, at: [st[DOOM.S.X] / 65536, st[DOOM.S.Y] / 65536] });
    g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.strokeRect(RW - mw - 8.5, 7.5, mw + 1, mh + 1);
  }
  bestView.tex.needsUpdate = true;
  if (bigScreen.visible) { bigView.g.drawImage(bestView.c, 0, 0); bigView.tex.needsUpdate = true; }
}
// key 3: the best game, filling the view (a screen that follows the camera)
const bigView = (() => { const c = document.createElement('canvas'); c.width = RW; c.height = RH; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; return { c, g: c.getContext('2d'), tex }; })();
const bigScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ map: bigView.tex, toneMapped: false, depthTest: false }));
bigScreen.renderOrder = 10; bigScreen.visible = false; bigScreen.position.set(0, 0, -1.02);
camera.add(bigScreen); scene.add(camera);
function toggleBig(on = !bigScreen.visible) {
  if (on && !replay) return false;
  bigScreen.visible = on;
  caption(on ? `The best game so far, replayed from the fly's recorded moves${AUTOPILOT ? '' : ' · 3 to go back'}` : '');
  return true;
}

// ---------------------------------------------------------------- the winner
function startParty(lab, desk, r) {
  const name = `the fly at desk ${desk + 1} in lab ${lab + 1}`;
  banner = r.perfect ? `Game ${nf(runner.games)}: ${name} ${WON}!` : `Party test: ${name} has the best score so far (${r.score.toFixed(2)} of 8).`;
  party.start(lab, desk, `DESK ${desk + 1} · LAB ${lab + 1} · ${r.perfect ? '8/8' : r.score.toFixed(1) + '/8'}`);
  party.desk.winner = true; party.desk.drawnKey = '';
  showReplay();
  hud.toast(`${banner} Follow the arrows on the floor.`, 9);
  if (!AUTOPILOT) hud.toast('Press 3 any time to watch its game again.', 8);
  fetch(`/ping?perfect=${runner.games}`).catch(() => {});
  screenDirty = true;
  assignNear();
}

async function giveSugar() {
  const from = camera.position.clone().add(player.forward.multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.25, 0));
  if (!(await party.giveSugar(from))) return;
  hud.toast(LEARNING ? `Sugar! It sticks out its tongue and drinks. During its games it already got a drop for every monster it killed${LEVEL ? ' and for new ground' : ''}.` : 'Sugar! It sticks out its tongue and drinks. (Its learning centre is switched off here; add ?learn to the address to switch it on.)', 9);
}

async function offerContract() {
  const from = camera.position.clone().add(player.forward.multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.2, 0));
  const { lab, fly, i } = party;
  const res = await party.offerContract(from);
  if (!res) return null;
  party.away = [i];
  hud.toast(`The fly at desk ${fly + 1} signed! Off to the management office…`, 5);
  res.landed.then(() => {
    office.nameplate(res.seat, `Desk ${fly + 1} · Lab ${lab + 1}`);
    const n = runner.promote(i, 8);
    party.away = [];
    banner = `Desk ${fly + 1} (lab ${lab + 1}) is now Head of Doom. Its desk setup was copied to ${n} desks in all 8 teams.`;
    screenDirty = true;
    hud.toast(banner, 8);
    hud.toast('Another fly takes the empty desk. It has the same brain: they all do.', 7);
    assignNear();
  });
  return res;
}

// ---------------------------------------------------------------- pointing and clicking
const ray = new THREE.Raycaster();
let aimed = null;
function aim() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  ray.far = 6;
  const hit = ray.intersectObjects([...supervisor.targets, ...party.targets.filter((o) => o.visible)], false)[0];
  aimed = hit ? hit.object : null;
  let label = '';
  if (aimed && aimed.userData.button) label = { pause: 'click: pause', play: 'click: let them play', reset: 'click: set up all desks from scratch', rec: recorder.active ? 'click: stop recording' : 'click: start recording' }[aimed.userData.button];
  else if (aimed && aimed.userData.reward) label = aimed.userData.reward === 'sugar' ? 'click: give the sugar cube' : 'click: offer the management contract';
  hud.set({ target: label });
  const close = party.active && party.distance(player.x, player.z) < 6;
  hud.set({ prompt: close ? `${party.gotSugar ? '' : '1 · give a sugar cube'}${!party.gotSugar && !party.gotContract ? '     ' : ''}${party.gotContract ? '' : '2 · offer a management contract'}` : '' });
}

function pressButton(id) {
  supervisor.press(id);
  if (id === 'rec') toggleRecording();
  else if (id === 'reset') {
    if (performance.now() - resetArmed < 3000) { resetArmed = 0; newDesks(); }
    else { resetArmed = performance.now(); hud.toast('Press NEW DESKS again to set up all 1,024 desks from scratch.', 3); }
  } else setPlaying(id === 'play');
}

canvas.addEventListener('mousedown', () => {
  if (player.autopilot) return;
  if (!player.locked) { player.lock(); return; }
  if (!aimed) return;
  if (aimed.userData.button) pressButton(aimed.userData.button);
  else if (aimed.userData.reward === 'sugar') giveSugar();
  else if (aimed.userData.reward === 'contract') offerContract();
});
addEventListener('keydown', (e) => {
  if (player.autopilot || $('splash').style.display !== 'none') return;
  if (e.code === 'KeyR') toggleRecording();
  if (e.code === 'KeyH') hud.set({ help: hud.state.help ? '' : HELP });
  const close = party.active && party.distance(player.x, player.z) < 6;
  if (e.code === 'Digit1' && close) giveSugar();
  if (e.code === 'Digit2' && close) offerContract();
  if (e.code === 'Digit3') toggleBig();
});

async function toggleRecording() {
  if (recorder.active) {
    const r = await recorder.stop();
    supervisor.setActive([runner.running ? 'play' : 'pause']);
    hud.set({ rec: false });
    if (r) hud.toast(`Saved ${Math.round(r.seconds)} s of video: ${r.where}`, 8);
  } else {
    Promise.resolve(recorder.start()).catch((err) => { hud.set({ rec: false }); hud.toast(`Recording failed: ${err.message}`, 8); });
    supervisor.setActive([runner.running ? 'play' : 'pause', 'rec']);
    hud.set({ rec: true });
    hud.toast('Recording. Press REC (or R) again to stop.', 4);
  }
  screenDirty = true;
}

// ---------------------------------------------------------------- autopilot (for unattended demo videos)
const tweens = [];
function tween(seconds, fn) { return new Promise((resolve) => tweens.push({ t0: clock.now(), dur: seconds * 1000, fn, resolve })); }
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const lerpAngle = (a, b, k) => a + (((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
function aimAt(x, y, z) { const dx = x - player.x, dy = y - player.y, dz = z - player.z; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; }
function glide(to, seconds, look = null) {
  const from = { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch };
  return tween(seconds, (k) => {
    const e = ease(k);
    player.x = from.x + (to.x - from.x) * e; player.y = from.y + (to.y - from.y) * e; player.z = from.z + (to.z - from.z) * e;
    const a = look ? aimAt(...look) : to;
    player.yaw = lerpAngle(from.yaw, a.yaw, Math.min(1, e * 1.6)); player.pitch = from.pitch + (a.pitch - from.pitch) * Math.min(1, e * 1.6);
  });
}
function caption(text) { hud.set({ caption: text }); }
function buttonPos(id) { return supervisor.buttons.get(id).cap.getWorldPosition(new THREE.Vector3()); }

async function autopilot() {
  player.autopilot = true;
  hud.set({ help: '', crosshair: false });
  caption('Doom Cubicles: 1,024 fruit flies take turns at Doom, each one with a complete fly brain');
  await wait(4500);
  const b = buttonPos('play');
  await glide({ x: player.x, y: player.y, z: player.z, ...aimAt(b.x, b.y, b.z) }, 1.4);
  caption('The supervisor presses PLAY');
  await wait(600);
  pressButton('play');
  await wait(1500);
  caption('The big screen: the games running right now, one per processor core');
  await glide({ x: 2.6, y: 2.9, z: 4.4 }, 3, [SCREEN.x + 2.4, SCREEN.y - 0.2, SCREEN.z]);
  await wait(9000);
  const rowZ = teamOrigin(0).z + AISLE + 2 * CUB + AISLE / 2 - 0.05;
  const legs = [
    [{ x: 0, y: 4.6, z: 1 }, 4, [0, 1, -25], 'Every fly has the same brain: all 138,639 neurons of the FlyWire map, never changed'],
    [{ x: 0, y: 2.6, z: -22 }, 9, [0, 1.2, -45], 'The picture goes into its eyes, facet by facet; its own steering, walking and jump neurons work the controller'],
    [{ x: -42, y: 2.0, z: rowZ }, 7, [55, 1.2, -10.8], 'A blue marker floats over every desk that is playing right now'],
    [{ x: 42, y: 2.0, z: rowZ }, 14, [57, 1.2, -10.8], 'What gets tuned is the desk: screen size, how hard the eyes are driven, how the ball under the fly is read'],
    [{ x: 28.5, y: 4.8, z: -30 }, 6, [0, 0, -15], 'After each round the best desks\' setups are copied over the worst'],
    [{ x: 0, y: 4.6, z: 1.5 }, 8, [0, 0.5, -22], null],
  ];
  const until = clock.now() + (Number(P.get('tour')) || 75) * 1000;
  let k = 0;
  while (!party.active && clock.now() < until) {
    const [to, sec, look, cap] = legs[k % legs.length];
    if (cap) caption(cap);
    let watch;
    await Promise.race([glide(to, sec, look), new Promise((r) => { watch = setInterval(() => { if (party.active) r(); }, 100); })]);
    clearInterval(watch);
    tweens.length = 0;
    k++;
  }
  if (party.active) {
    caption(`Game ${nf(runner.games)}: the fly at desk ${party.fly + 1} in lab ${party.lab + 1} ${WON}`);
    await glide({ x: 0, y: 4.8, z: 1.5 }, 3, [party.c.x, 1.5, party.c.z]);
    await wait(2500);
    caption('A path on the floor leads to the winner');
    await glide({ x: 0, y: EYE, z: -0.3 }, 2.5, [party.c.x, 1.0, party.c.z]);
    player.x = 0; player.z = -0.3;
    const path = pathFrom(grid, party.field, { x: 0, z: -0.3 });
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], p = path[i], len = Math.hypot(p.x - a.x, p.z - a.z), end = i === path.length - 1;
      await glide({ x: p.x, y: floorHeight(p.x, p.z) + EYE, z: p.z, ...aimAt(p.x, EYE, p.z) }, Math.max(0.6, len / 7), end ? [party.c.x, 1.0, party.c.z] : [p.x + (p.x - a.x), EYE - 0.3, p.z + (p.z - a.z)]);
    }
    const h = party.headPosition(new THREE.Vector3());
    await glide({ x: player.x, y: EYE, z: player.z }, 1, [h.x, h.y, h.z]);
    caption('Its screen replays the winning game');
    await wait(6000);
    caption('A sugar cube for the winner');
    await giveSugar();
    await wait(4500);
  }
  // the last shot: the best game so far, full screen
  if (toggleBig(true)) { await wait(Math.min(26000, (SECONDS + 2) * 1000)); toggleBig(false); await wait(600); }
  caption('');
  if (recorder.active) await toggleRecording();
  document.title = 'Doom Cubicles (done)';
  fetch(`/ping?done=${runner.games}`).catch(() => {});
}

// ---------------------------------------------------------------- every frame
const HELP = 'WASD walk · Shift run · mouse look · click the buttons · 3 best game · R record · H hide this';
const realClock = new THREE.Clock();
let frames = 0, fpsAt = 0, nearAt = 0;
function frame() {
  if (recorder.busy) { requestAnimationFrame(frame); return; }
  clock.tick();
  const realDt = Math.min(0.05, realClock.getDelta());
  const dt = clock.fixed ? clock.fixed / 1000 : realDt, now = clock.now(), t = now / 1000;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i], k = Math.min(1, (now - tw.t0) / tw.dur);
    tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }
  player.update(dt);
  if (now - nearAt > 250) { nearAt = now; assignNear(); }
  workers.update(t, runner.running ? 0.25 : 0.05);
  for (const d of near) d.update(dt, now);
  party.update(dt, now, { x: player.x, z: player.z });
  party.idle(dt);
  supervisor.update(dt, t);
  for (let lab = 0; lab < LABS; lab++) {
    const i = liveDesk[lab], m = markers[lab];
    m.visible = i >= 0;
    if (i >= 0) { const c = office.cubes[i]; m.position.set(c.x, 2.35 + Math.sin(t * 3 + lab) * 0.08, c.z); m.rotation.y = t * 2; }
  }
  if (screens) {
    replayTick(performance.now());
    if (liveDirty && now - liveAt > 100) { liveDirty = false; liveAt = now; drawLive(); atlasDirty = true; }
    // the big pictures are redrawn at most about once a second (see js/cubicles/main.js)
    if (atlasDirty && now - atlasAt > 1000) { atlasDirty = false; atlasAt = now; drawAtlas(); }
    if (screenDirty && now - screenAt > 1000) { screenDirty = false; screenAt = now; drawScreen(); }
    if (now - signsAt > 2000) { signsAt = now; const st = runner.labStats; for (let lab = 0; lab < LABS; lab++) office.drawSign(lab, st[lab]); }
  }
  aim();
  if (!player.autopilot && hud.state.help && player.moved > 40) hud.set({ help: '' });
  frames++;
  const real = performance.now();
  if (real - fpsAt > 1000) { window.__cubicles.fps = frames; frames = 0; fpsAt = real; }
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  hud.render(renderer, now);
  if (recorder.capture && recorder.active) recorder.capture();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
window.__cubicles = { runner, party, player, renderer, office, fps: 0, setPlaying, newDesks, offerContract, giveSugar, toggleBig, get games() { return runner.games; }, get live() { return Array.from(liveDesk); } };
requestAnimationFrame(frame);

async function enter() {
  $('splash').style.display = 'none';
  const autostart = $('opt-start').checked, record = $('opt-record').checked;
  if (!AUTOPILOT) { player.lock(); hud.set({ help: HELP }); }
  hud.toast('Welcome to the Doom Cubicles. The big screen shows the games; the buttons are on the console.', 7);
  if (record) toggleRecording();
  if (autostart && !AUTOPILOT) setPlaying(true);
  if (AUTOPILOT) autopilot();
}

if (P.has('cam')) {
  const [x, z, yaw, pitch, y] = P.get('cam').split(',').map(Number);
  player.setPose(x, z, yaw, pitch || 0);
  if (Number.isFinite(y)) { player.y = y; player.autopilot = true; }
}
$('opt-start').checked = P.has('autostart') || AUTOPILOT;
$('opt-record').checked = P.has('record');
runner.onStatus = (t) => { $('splash-status').textContent = t ? t[0].toUpperCase() + t.slice(1) + '…' : ''; };
runner.init().then(async (info) => {
  screens = new Screens(runner.palettes);
  $('splash-mode').textContent = (FAST ? `FAST MODE: a reduced brain of ${nf(info.neurons)} of the 138,639 neurons.` : `Complete brain: ${nf(info.neurons)} neurons and ${nf(info.connections)} connections for every player.`)
    + (LEVEL ? " The task: Freedoom's real first level, as a human player starts it. The fly's own landing cells press the \"use\" key that opens doors." : ' The task: the arena. Add ?level to the address for a real level.');
  if (LEVEL) { levelMap = new LevelMap(runner.wad); $('splash-goal').textContent = 'When a fly finds the exit of the level'; }
  if (P.has('resume') && await runner.load(STATE_URL)) for (const l of runner.last) if (l) gameLog.push(l.score);
  replayDoom = await loadDoom({ wasm: runner.wasm, wad: runner.wad });
  showReplay();
  drawAtlas(); drawScreen(); drawLive();
  $('splash-status').textContent = '';
  $('enter').disabled = false;
  updateStatus();
  supervisor.setActive(['pause']);
  if (AUTOPILOT || P.has('go')) enter();
}).catch((err) => { $('splash-status').textContent = `Could not start: ${err.message}`; console.error(err); });
$('enter').addEventListener('click', enter);
