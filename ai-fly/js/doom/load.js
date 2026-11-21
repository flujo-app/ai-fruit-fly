// Loads everything a Doom-playing fly needs: the brain's wiring, the eye map and the game.
// Works in the browser (page or worker) and in Node (for the tools).
import { parseConnectome } from '../brain-engine.js';
import { FastBrain } from '../brain-fast.js';
import { parseRig, Eye } from './eye.js';

const DATA = new URL('../../data/', import.meta.url);

export async function readData(name) {
  const url = new URL(name, DATA);
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    const b = await fs.readFile(url);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.arrayBuffer();
}

export async function loadRig() {
  const [meta, bin] = await Promise.all([readData('doom/rig.json'), readData('doom/rig.bin')]);
  return parseRig(bin, JSON.parse(new TextDecoder().decode(meta)));
}

// The wiring file: the complete brain (61 MB), or with fast = true the reduced circuit (7 MB).
// Where the browser allows it, the bytes go into shared memory so that all workers use one copy.
export async function loadWiring(fast = false) {
  let buf = await readData(fast ? 'doom/circuit.bin' : 'connectome.bin');
  if (typeof SharedArrayBuffer !== 'undefined' && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) {
    const shared = new SharedArrayBuffer(buf.byteLength);
    new Uint8Array(shared).set(new Uint8Array(buf));
    buf = shared;
  }
  return buf;
}

// A brain and its eyes. wiring: the buffer from loadWiring; fast: whether it is the reduced circuit.
export function makeFly(rig, wiring, fast = false) {
  const conn = parseConnectome(wiring);
  let remap = null;
  if (fast) {
    const map = new Map();
    rig.circuitGlobal.forEach((g, i) => map.set(g, i));
    remap = (g) => map.has(g) ? map.get(g) : -1;
  }
  const brain = new FastBrain(conn);
  const eye = new Eye(rig, {}, remap);
  return { brain, eye, remap, neurons: conn.n, connections: conn.e };
}
