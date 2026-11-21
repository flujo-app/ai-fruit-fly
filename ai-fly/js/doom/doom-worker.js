// One lab of the Doom gym: one background worker with one Doom engine and one fly brain (the complete
// brain by default). It plays one desk's game at a time and reports back.
import { loadDoom, DOOM } from './engine.js';
import { parseRig } from './eye.js';
import { makeFly } from './load.js';
import { Game, ARENA, FRAME_W, FRAME_H } from './game.js';

let doom = null, fly = null, game = null, rig = null, fast = false;
let watching = false, abort = false, busy = false;

// lets waiting messages (watch, stop) through in the middle of a game
const chan = new MessageChannel();
let wake = null;
chan.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
const breathe = () => new Promise((r) => { wake = r; chan.port2.postMessage(0); });

async function play(m) {
  busy = true; abort = false;
  const { brain, eye } = fly;
  game.start(m.setup, m.seed);
  brain.spikesTotal = 0;
  const t0 = performance.now();
  let more = true;
  while (more) {
    if (watching && !brain.log) brain.enableLog(1 << 16); else if (!watching && brain.log) brain.log = null;
    if (brain.log) brain.logLen = 0;
    more = game.step();
    // a picture for the page every 3rd tic (the wall and the live view)
    if (m.live && (game.tic % 3 === 0 || !more)) {
      const st = doom.state, frame = game.frame.slice();
      const msg = { type: 'frame', lab: m.lab, desk: m.desk, tic: game.tic, frame, pal: st[DOOM.S.PALETTE], health: st[DOOM.S.HEALTH], kills: st[DOOM.S.PLAYER_KILLS], ammo: st[DOOM.S.AMMO], rates: game.rates };
      const move = [frame.buffer];
      if (watching) {
        // for the selected desk: what each facet sees, and a sample of the neurons that just fired
        msg.facets = eye.lum.slice(); move.push(msg.facets.buffer);
        const n = brain.logLen, take = Math.min(n, 2500), stride = n / Math.max(1, take), sp = new Uint32Array(take);
        for (let k = 0; k < take; k++) { const i = brain.log[Math.floor(k * stride)]; sp[k] = fast ? rig.circuitGlobal[i] : i; }
        msg.spikes = sp; msg.spikeShare = take / Math.max(1, n); move.push(sp.buffer);
        msg.speed = (game.tic / 35 * 1000) / (performance.now() - t0);
      }
      postMessage(msg, move);
    }
    if (abort) break;
    if (game.tic % 6 === 0) await breathe();
  }
  const ms = performance.now() - t0;
  const result = game.result();
  const thumb = game.frame ? game.frame.slice() : new Uint8Array(FRAME_W * FRAME_H);
  busy = false;
  postMessage({ type: 'played', id: m.id, lab: m.lab, desk: m.desk, aborted: abort, result, thumb, pal: doom.state[DOOM.S.PALETTE], ms, impulses: brain.spikesTotal, speed: (result.tics / 35 * 1000) / ms },
    [thumb.buffer, result.cmds.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      fast = !!m.fast;
      rig = parseRig(m.rigBin, m.rigMeta);
      doom = await loadDoom({ wasm: m.wasm, wad: m.wad });
      fly = makeFly(rig, m.wiring, fast);
      game = new Game({ doom, brain: fly.brain, eye: fly.eye, rig, remap: fly.remap, task: { ...ARENA, ...(m.task || {}) } });
      const palettes = new Uint8Array(14 * 768);
      for (let i = 0; i < 14; i++) palettes.set(doom.palette(i), i * 768);
      postMessage({ type: 'ready', id: m.id, lab: m.lab, neurons: fly.neurons, connections: fly.connections, driven: fly.eye.N, palettes }, [palettes.buffer]);
    } else if (m.type === 'play') {
      if (busy) throw new Error('this lab is already playing');
      await play(m);
    } else if (m.type === 'watch') {
      watching = !!m.on;
    } else if (m.type === 'stop') {
      abort = true;
    }
  } catch (err) {
    busy = false;
    postMessage({ type: 'error', id: m.id, lab: m.lab, message: String(err && err.stack || err) });
  }
};
