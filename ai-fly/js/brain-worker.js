// Runs the whole-brain model off the main thread and keeps it in step with the clock.
import { Brain, parseConnectome } from './brain-engine.js';

const INPUTS = ['objects_L', 'objects_R', 'loom_L', 'loom_R', 'sugar', 'bitter', 'antenna_touch_L', 'antenna_touch_R'];
const OUTPUTS = ['steer_L', 'steer_R', 'groom', 'MN9', 'DNp01', 'MDN'];

let brain = null;
let G = null;
const current = {};
let lastWall = 0, owed = 0, lastPost = 0;
let wallAcc = 0, brainAcc = 0, spikeAcc = 0, speed = 1, spikesPerSec = 0;

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

const channel = new MessageChannel();
channel.port1.onmessage = loop;

function loop() {
  const now = performance.now();
  const wall = Math.min(100, now - lastWall);
  lastWall = now;
  owed = Math.min(owed + wall, 120);          // if the brain falls behind, drop the excess
  const chunk = brain.p.dt * 4;
  let ran = 0;
  const before = brain.spikesTotal;
  while (owed >= chunk && performance.now() - now < 28) {
    brain.run(4);
    owed -= chunk;
    ran += chunk;
  }
  wallAcc += wall; brainAcc += ran; spikeAcc += brain.spikesTotal - before;
  if (wallAcc >= 500) {
    speed = brainAcc / wallAcc;
    spikesPerSec = spikeAcc * 1000 / Math.max(1, brainAcc);
    wallAcc = 0; brainAcc = 0; spikeAcc = 0;
  }
  if (now - lastPost >= 30) {
    lastPost = now;
    const spikes = brain.log.slice(0, brain.logLen);
    brain.logLen = 0;
    const rates = {};
    for (const k of OUTPUTS) rates[k] = brain.rate(G[k]);
    postMessage({ type: 'state', t: brain.timeMs, rates, spikes, active: brain.nActive, speed, spikesPerSec }, [spikes.buffer]);
  }
  if (owed >= chunk) channel.port2.postMessage(0);
  else setTimeout(loop, 2);
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const [meta, buf] = await Promise.all([
        fetch(new URL('../data/circuits.json', import.meta.url)).then(r => r.json()),
        fetchWithProgress(new URL('../data/connectome.bin', import.meta.url),
          (loaded, total) => postMessage({ type: 'progress', loaded, total })),
      ]);
      G = meta.groups;
      brain = new Brain(parseConnectome(buf));
      for (const k of OUTPUTS) brain.watchNeurons(G[k]);
      postMessage({ type: 'ready', neurons: brain.n, edges: meta.n_edges });
      lastWall = performance.now();
      loop();
    } catch (err) {
      postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  } else if (m.type === 'senses' && brain) {
    for (const k of INPUTS) {
      const r = Math.round(m.rates[k] || 0);
      if ((current[k] || 0) !== r) { brain.setDrive(G[k], r); current[k] = r; }
    }
  } else if (m.type === 'silence' && brain) {
    for (const i of G[m.group]) brain.silenced[i] = m.on ? 1 : 0;
  }
};
