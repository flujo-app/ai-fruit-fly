// Runs the fly's learning centre in the background for the kebab coding studio.
import { MushroomBody } from './mushroom-body.js';

let mb = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const [meta, buf] = await Promise.all([
        fetch(new URL('../data/mb.json', import.meta.url)).then((r) => r.json()),
        fetch(new URL('../data/mb.bin', import.meta.url)).then((r) => r.arrayBuffer()),
      ]);
      mb = new MushroomBody(buf, meta);
      postMessage({
        type: 'ready', neurons: meta.n, connections: meta.edges, kcs: meta.kc.length,
        avoid: mb.avoid.length, approach: mb.approach.length,
      });
    } else if (m.type === 'sniff') {
      const glomeruli = mb.smellFor(m.key);
      const r = mb.sniff(glomeruli);
      const g = mb.meta.global;
      const spikes = new Int32Array(r.spikes.length);
      for (let i = 0; i < spikes.length; i++) spikes[i] = g[r.spikes[i]];
      postMessage({
        type: 'sniffed', id: m.id, glomeruli, kcs: r.kcs, valence: r.valence,
        approach: r.approach, avoid: r.avoid, kcFraction: r.kcFraction, spikes,
      }, [spikes.buffer]);
    } else if (m.type === 'learn') {
      const changed = mb.learn(m.kcs, m.kind);
      postMessage({ type: 'learned', id: m.id, changed });
    } else if (m.type === 'forget') {
      mb.forget();
      postMessage({ type: 'forgot', id: m.id });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
