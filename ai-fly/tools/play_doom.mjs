// Flies play Doom without a page, for experiments and checks.
//   node tools/play_doom.mjs [games=4] [seed=1] [fast] [png] [knob=value ...]
// Each game: the complete brain (or the reduced circuit with `fast`) plays the arena once.
// Knobs are the desk setup (see js/doom/setup.js), e.g. turn=-3 trigger=4 screen=140.
// `random` plays every game with a different random setup; `png` saves pictures of game 1
// (the fly's view and the normal screen) into tools/.out/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';
import { loadDoomFromUrls, DOOM, toRGBA } from '../js/doom/engine.js';
import { loadRig, loadWiring, makeFly } from '../js/doom/load.js';
import { Game, Replay, FRAME_W, FRAME_H } from '../js/doom/game.js';
import { defaultSetup, randomSetup, SETUP, KEY, rng, describeSetup } from '../js/doom/setup.js';

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const num = (k, d) => { const a = args.find((x) => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };
const fast = flag('fast');
const games = num('games', 4), seed0 = num('seed', 1);
const out = join(dirname(fileURLToPath(import.meta.url)), '.out');

function png(file, rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const t0 = performance.now();
const [doom, rig, wiring] = await Promise.all([loadDoomFromUrls(), loadRig(), loadWiring(fast)]);
const { brain, eye, remap, neurons, connections } = makeFly(rig, wiring, fast);
console.log(`${fast ? 'FAST MODE (reduced circuit)' : 'complete brain'}: ${neurons.toLocaleString()} neurons, ${connections.toLocaleString()} connections; ${eye.N.toLocaleString()} eye cells are driven; loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const game = new Game({ doom, brain, eye, rig, remap });
const base = defaultSetup();
for (const s of SETUP) { const v = num(s.key, NaN); if (!Number.isNaN(v)) base[KEY[s.key]] = v; }
const rand = rng(num('setupseed', 99));
let total = 0;
for (let g = 0; g < games; g++) {
  const setup = flag('random') ? randomSetup(rand) : base;
  game.start(setup, seed0 + g);
  brain.spikesTotal = 0; brain.eventsTotal = 0;
  const w0 = performance.now();
  const acc = { left: 0, right: 0, walk: 0, back: 0, jump: 0, fire: 0, absTurn: 0, driven: 0 };
  let shots = 0;
  while (game.step()) {
    const r = game.rates;
    acc.left += r.left; acc.right += r.right; acc.walk += r.walk; acc.back += r.back; acc.jump += r.jump; acc.fire += r.fire ? 1 : 0; acc.absTurn += Math.abs(r.turn);
    let d = 0; for (let i = 0; i < eye.N; i++) if (eye.rate[i] > 1) d++; acc.driven += d;
    if (flag('png') && g === 0 && (game.tic % 105 === 5)) {
      mkdirSync(out, { recursive: true });
      const pal = doom.palette(doom.state[DOOM.S.PALETTE]);
      png(join(out, `fly-view-${String(shots).padStart(2, '0')}.png`), toRGBA(game.frame, pal), FRAME_W, FRAME_H);
      png(join(out, `screen-${String(shots).padStart(2, '0')}.png`), toRGBA(doom.renderFull(), pal), 320, 200);
      // what the facets see: one dot per facet that looks at the screen
      const W = 320, H = 240, img = new Uint8ClampedArray(W * H * 4); for (let i = 3; i < img.length; i += 4) img[i] = 255;
      const half = setup[KEY.screen] / 2;
      for (let c = 0; c < eye.C; c++) {
        if (!eye.onScreen[c]) continue;
        const x = Math.round((eye.az[c] / half * 0.5 + 0.5) * (W - 1)), y = Math.round((0.5 - eye.el[c] / (half * 0.75) * 0.5) * (H - 1));
        const v = Math.min(255, eye.lum[c] * 255 * 1.6), col = eye.side[c] ? [v, v * 0.9, v * 0.6] : [v * 0.6, v * 0.9, v];
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || dx * dx + dy * dy > 10) continue; const o = (Y * W + X) * 4; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; }
      }
      png(join(out, `facets-${String(shots).padStart(2, '0')}.png`), img, W, H);
      shots++;
    }
  }
  const wall = performance.now() - w0, res = game.result(), n = res.tics;
  total += res.score;
  console.log(`game ${g + 1} (seed ${seed0 + g}): score ${res.score.toFixed(2)} of 8, kills ${res.kills}, shots ${res.shots}, hits ${res.hits}, health ${res.health}, ${(n / 35).toFixed(1)} s (${res.why}); brain ${brain.spikesTotal.toLocaleString()} impulses, ${(n / 35 * 1000 / wall).toFixed(2)}x real time`);
  console.log(`   mean per tic: steering L ${(acc.left / n).toFixed(0)} | R ${(acc.right / n).toFixed(0)} Hz, walk ${(acc.walk / n).toFixed(0)}, back ${(acc.back / n).toFixed(0)}, jump ${(acc.jump / n).toFixed(0)} Hz, trigger held ${(100 * acc.fire / n).toFixed(0)}% of the time, turning ${(acc.absTurn / n / (65536 / 360 / 35)).toFixed(0)} deg/s, eye cells driven ${(acc.driven / n).toFixed(0)}`);
  if (flag('random')) console.log('   setup: ' + describeSetup(setup).map((d) => `${d.key}=${d.shown}`).join(' '));
  if (flag('replaycheck')) {
    // play the recorded input again in a fresh game and compare the end
    const end = [...doom.state.slice(1, 17)].join(',');
    const rp = new Replay(doom).start(res); while (rp.step());
    console.log('   replay from the recorded input ends identically:', [...doom.state.slice(1, 17)].join(',') === end);
  }
}
console.log(`mean score ${(total / games).toFixed(2)} of 8 over ${games} games`);
