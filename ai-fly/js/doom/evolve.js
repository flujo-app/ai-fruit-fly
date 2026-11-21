// What happens to the desk setups after a round (shared by the pages and tools/train_doom.mjs).
//
// Inside each lab, the setups of the best desks are copied, with small random changes, over the
// setups of the worst desks. And each lab hands its best setup, unchanged, to the next lab.
// The flies are not touched: they all have the same brain.
import { mutateSetup } from './setup.js';

// state: { labs, perLab, elite, rand, setups[], fitness (Float32Array) }. Returns the desks that got a new setup.
export function evolve(state) {
  const { labs, perLab, rand, setups, fitness } = state, elite = state.elite ?? 0.3;
  const order = [];
  for (let lab = 0; lab < labs; lab++) order.push(Array.from({ length: perLab }, (_, d) => lab * perLab + d).sort((a, b) => fitness[b] - fitness[a]));
  const copies = [];
  for (let lab = 0; lab < labs; lab++) {
    const o = order[lab], m = Math.max(1, Math.floor(perLab * elite));
    for (let k = 0; k < m && k < perLab - m; k++) copies.push([o[Math.floor(rand() * m)], o[perLab - 1 - k], true]);
    if (labs > 1 && perLab > m + 1) copies.push([order[(lab + labs - 1) % labs][0], o[perLab - 1 - m], false]);
  }
  const changed = [];
  for (const [src, dst, change] of copies) {
    if (src === dst) continue;
    setups[dst] = change ? mutateSetup(setups[src], rand) : Float32Array.from(setups[src]);
    fitness[dst] = fitness[src];
    changed.push(dst);
  }
  return changed;
}
