// Tests the fly gym's Doom engine (data/doom/doom.wasm + flygym.wad) and prints its numbers.
//   node tools/test_doom_engine.mjs           (from ai-fly/)
//   node tools/test_doom_engine.mjs --png     also writes screenshots to doom-engine/.build/shots/
// Exits with code 1 if any check fails.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadDoom, compileDoom, DOOM, toRGBA } from '../js/doom/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WANT_PNG = process.argv.includes('--png');
const SHOTS = path.join(ROOT, 'doom-engine', '.build', 'shots');
const { S, MT, BT, WP } = DOOM;
const fx = (v) => v / 65536;
const now = () => performance.now();

let failures = 0;
function check(ok, what, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}
function hash(arr, h = 2166136261) {   // FNV-1a over the bytes of a typed array
  const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
  return h >>> 0;
}
function rng(seed) {   // small deterministic random numbers for test positions
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ---- loading ------------------------------------------------------------------------------------

const wasmBytes = fs.readFileSync(path.join(ROOT, 'data', 'doom', 'doom.wasm'));
const wadBytes = fs.readFileSync(path.join(ROOT, 'data', 'doom', 'flygym.wad'));
let t0 = now();
const module = await compileDoom(wasmBytes);
const tCompile = now() - t0;
const fresh = () => loadDoom({ wasm: module, wad: wadBytes });
t0 = now();
const doom = await fresh();
const tInit = now() - t0;
const mem0 = doom.memInfo();
check(true, 'engine loads', `compile ${tCompile.toFixed(0)} ms, instantiate + init ${tInit.toFixed(0)} ms, wasm ${(wasmBytes.length / 1024).toFixed(0)} KB, WAD ${(wadBytes.length / 1048576).toFixed(2)} MB`);
check(mem0.memory <= 32 * 1048576, 'wasm memory per instance <= 32 MB', `${mem0.memory / 1048576} MB total, C heap top ${(mem0.heapTop / 1048576).toFixed(1)} MB, zone ${(mem0.zoneSize / 1048576).toFixed(0)} MB`);

// ---- undrawn pixels ------------------------------------------------------------------------------
// Draw each frame twice, pre-filled with colour 0 and then 255: a pixel that keeps the fill
// colour both times was never drawn (a hall-of-mirrors spot).
function undrawn(w, h, full) {
  doom.setFill(0);
  const a = (full ? doom.renderFull() : doom.render(w, h, true)).slice();
  doom.setFill(255);
  const b = full ? doom.renderFull() : doom.render(w, h, true);
  doom.setFill(-1);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === 0 && b[i] === 255) n++;
  return n;
}
const SIZES = [[96, 60], [320, 200], [160, 100], [64, 40], [200, 120]];
const PILLARS = Array.from({ length: 6 }, (_, k) => {
  const a = ((30 + 60 * k) * Math.PI) / 180;
  return [Math.round(400 * Math.cos(a)), Math.round(400 * Math.sin(a))];
});
const inPillar = (x, y, pad) => PILLARS.some(([cx, cy]) => Math.abs(x - cx) < 32 + pad && Math.abs(y - cy) < 32 + pad);

for (const map of [2, 3]) {
  doom.newGame({ skill: 3, map, seed: 1 });
  const r = rng(map);
  let views = 0, bad = 0;
  for (let i = 0; i < 150; i++) {
    let x, y;
    do { const rr = 700 * Math.sqrt(r()), a = r() * 2 * Math.PI; x = Math.round(rr * Math.cos(a)); y = Math.round(rr * Math.sin(a)); }
    while (map === 3 && inPillar(x, y, 20));
    doom.setPlayer(x, y, Math.floor(r() * 360));
    for (const [w, h] of SIZES) { bad += undrawn(w, h, false); views++; }
    bad += undrawn(0, 0, true); views++;
  }
  check(bad === 0, `MAP0${map} renders without undrawn pixels`, `${views} frames from 150 random spots/angles, ${bad} undrawn pixels`);
}
{
  doom.newGame({ skill: 1, map: 1, seed: 1 });
  doom.give(-1, -1, 10000);
  const sx = fx(doom.state[S.X]), sy = fx(doom.state[S.Y]);
  let views = 0, bad = 0;
  for (let k = 0; k < 8; k++) {
    doom.setPlayer(Math.round(sx), Math.round(sy), k * 45);
    doom.setCmd(50, 0, 0, 0);
    doom.tick(25);
    doom.setCmd(0, 0, 0, 0);
    doom.tick(10);
    const px = Math.round(fx(doom.state[S.X])), py = Math.round(fx(doom.state[S.Y]));
    for (let a = 0; a < 360; a += 30) {
      doom.setPlayer(px, py, a);
      for (const [w, h] of SIZES) { bad += undrawn(w, h, false); views++; }
      bad += undrawn(0, 0, true); views++;
    }
  }
  check(bad === 0, 'MAP01 (Freedoom) starts and renders without undrawn pixels', `${views} frames from 8 spots x 12 angles, ${bad} undrawn pixels`);
}

// ---- movement, turning, walls -------------------------------------------------------------------

doom.newGame({ skill: 3, map: 2, seed: 3 });
{
  const a0 = doom.state[S.ANGLE] >>> 0;
  doom.setCmd(0, 0, 1000, 0);
  doom.tick(10);
  const a1 = doom.state[S.ANGLE] >>> 0, want = (a0 + 10 * 1000 * 65536) % 4294967296;
  check(a1 === want, 'turn: 10 tics of turn=1000 turn left by exactly 10*1000/65536 of a circle', `${((a1 - a0) / 4294967296 * 360).toFixed(3)} degrees`);
  doom.setPlayer(0, 0, 0);
  doom.setCmd(50, 0, 0, 0);
  doom.tick(35);
  const x1 = fx(doom.state[S.X]), v1 = fx(doom.state[S.MOMX]);
  // (Doom's sine table has no exact zero, so "east" drifts a fraction of a unit north)
  check(x1 > 380 && x1 < 460 && Math.abs(fx(doom.state[S.Y])) < 1, 'forward = 50 for one second moves the player straight ahead a plausible distance', `${x1.toFixed(1)} units in 35 tics (y ${fx(doom.state[S.Y]).toFixed(2)}), speed ${v1.toFixed(2)} units/tic, Doom's top running speed is 16.7`);
  doom.tick(105);
  const x2 = fx(doom.state[S.X]);
  doom.tick(35);
  const x3 = fx(doom.state[S.X]);
  const wallX = 768 * Math.cos(Math.PI / 16);
  check(x2 <= wallX - 16 + 0.5 && x3 === x2 && x2 > wallX - 20, 'the east wall stops the player', `stopped at x = ${x2.toFixed(1)}, wall at ${wallX.toFixed(1)}, player radius 16`);
  // diagonal runs into every wall direction: never outside the room
  let worst = 0;
  for (let k = 0; k < 16; k++) {
    doom.setPlayer(0, 0, k * 22.5 + 5);
    doom.setCmd(50, k % 2 ? 30 : -30, 0, 0);
    for (let t = 0; t < 120; t++) { doom.tick(1); worst = Math.max(worst, dist(fx(doom.state[S.X]), fx(doom.state[S.Y]), 0, 0)); }
  }
  check(worst < 768 - 15, 'running and strafing into all 16 walls never leaves the room', `farthest from centre ${worst.toFixed(1)} (corners at 768)`);
  doom.setCmd(0, 0, 0, 0);
}
{
  doom.newGame({ skill: 3, map: 3, seed: 3 });
  let inside = 0;
  for (const [cx, cy] of PILLARS) {
    doom.setPlayer(Math.round(cx * 0.5), Math.round(cy * 0.5), Math.round(Math.atan2(cy, cx) * 180 / Math.PI) + 3);
    doom.setCmd(50, 0, 0, 0);
    for (let t = 0; t < 70; t++) { doom.tick(1); if (inPillar(fx(doom.state[S.X]), fx(doom.state[S.Y]), 15.9)) inside++; }
  }
  check(inside === 0, 'MAP03: running at each pillar never gets the player into it');
  doom.setCmd(0, 0, 0, 0);
}

// ---- shooting ---------------------------------------------------------------------------------------

{
  doom.newGame({ skill: 3, map: 2, seed: 5 });
  doom.tick(20);                     // the pistol comes up after a new game
  doom.sounds();
  doom.setCmd(0, 0, 0, BT.FIRE);     // one short trigger pull
  doom.tick(1);
  doom.setCmd(0, 0, 0, 0);
  let puffs = [];
  for (let t = 0; t < 20 && !puffs.length; t++) { doom.tick(1); puffs = doom.things(true).filter((t) => t.type === MT.PUFF); }
  const snd = doom.sounds();
  const wallX = 768 * Math.cos(Math.PI / 16);
  check(puffs.length === 1 && puffs[0].x > wallX - 12 && puffs[0].x < wallX && Math.abs(puffs[0].y) < 2, 'a pistol shot at the wall makes a bullet puff on the wall', puffs.map((p) => `puff at ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  check(snd.some((s) => DOOM.SFX[s.sfx] === 'pistol' && s.vol === 127 && s.sep === 128), 'the shot is heard: pistol sound, full volume, centred', JSON.stringify(snd));
  check(doom.state[S.SHOTS] === 1, 'shots-fired counter counts the shot', `SHOTS = ${doom.state[S.SHOTS]}`);
}
{
  doom.newGame({ skill: 3, map: 2, seed: 7 });
  const id = doom.spawn(MT.ZOMBIEMAN, 300, 0, 180, false);
  doom.setCmd(0, 0, 0, BT.FIRE);
  let t = 0;
  while (doom.state[S.KILLS] === 0 && t < 350) { doom.tick(1); t++; }
  doom.setCmd(0, 0, 0, 0);
  const s = doom.state;
  check(id >= 0 && s[S.KILLS] === 1 && s[S.PLAYER_KILLS] === 1, 'zombieman 300 units ahead is killed by holding fire with the pistol', `id ${id}, killed after ${t} tics`);
  check(s[S.DAMAGE_DEALT] === 20 && s[S.HITS] >= 2, 'damage-dealt counter rises (zombieman has 20 health; overkill not counted)', `DAMAGE_DEALT = ${s[S.DAMAGE_DEALT]}, HITS = ${s[S.HITS]}`);
  check(s[S.SHOTS] >= 2 && s[S.AMMO] === 50 - s[S.SHOTS], 'shots-fired counter rises and matches the ammo used', `SHOTS = ${s[S.SHOTS]}, ammo left ${s[S.AMMO]}`);
  check(s[S.MONSTERS] === 0 && doom.things().length === 0, 'no live monsters left');
}
{
  doom.newGame({ skill: 3, map: 2, seed: 9 });
  doom.sounds();
  doom.spawn(MT.IMP, 0, 500, 270, true);   // to the north = to the player's left
  const heard = doom.sounds();
  doom.tick(350);
  check(heard.length === 1 && heard[0].sep < 128 && heard[0].vol > 0 && DOOM.SFX[heard[0].sfx].startsWith('bgsit'), 'an awake imp on the left is heard on the left', JSON.stringify(heard));
  check(doom.state[S.DAMAGE_TAKEN] > 0 && doom.state[S.HEALTH] === 100 - doom.state[S.DAMAGE_TAKEN], 'an awake imp attacks: damage-taken counter rises', `DAMAGE_TAKEN = ${doom.state[S.DAMAGE_TAKEN]} in 10 s, health ${doom.state[S.HEALTH]}, palette ${doom.state[S.PALETTE]}`);
}
{
  doom.newGame({ skill: 3, map: 2, seed: 11 });
  doom.spawn(MT.DEMON, -600, 0, 0, true);
  let closest = 1e9, t = 0;
  while (t < 350 && doom.state[S.DAMAGE_TAKEN] === 0) {
    doom.tick(1); t++;
    const d = doom.things()[0];
    if (d) closest = Math.min(closest, dist(d.x, d.y, 0, 0));
  }
  check(closest < 90 && doom.state[S.DAMAGE_TAKEN] > 0, 'an awake demon walks 600 units to the player and bites', `got to ${closest.toFixed(0)} units, first bite after ${t} tics`);
}
{
  // MAP03: a demon right behind a pillar must walk around it
  doom.newGame({ skill: 3, map: 3, seed: 13 });
  const [cx, cy] = PILLARS[0];
  const ux = cx / 400, uy = cy / 400;
  doom.setPlayer(Math.round(cx - 250 * ux), Math.round(cy - 250 * uy), 30);
  doom.give(-1, -1, 1000);
  doom.spawn(MT.DEMON, Math.round(cx + 90 * ux), Math.round(cy + 90 * uy), 210, true);
  let t = 0, inside = 0;
  while (t < 700 && doom.state[S.DAMAGE_TAKEN] === 0) {
    doom.tick(1); t++;
    for (const d of doom.things()) if (inPillar(d.x, d.y, 29.9)) inside++;
  }
  check(doom.state[S.DAMAGE_TAKEN] > 0 && inside === 0, 'MAP03: a demon behind a pillar walks around it (never into it) and reaches the player', `first bite after ${t} tics`);
}
{
  // several monsters chasing for 40 s never get out of the arena
  doom.newGame({ skill: 4, map: 2, seed: 15 });
  doom.give(WP.SHOTGUN, 50, 30000);
  const types = [MT.IMP, MT.DEMON, MT.ZOMBIEMAN, MT.SHOTGUNGUY, MT.CACODEMON, MT.LOSTSOUL, MT.REVENANT, MT.HELLKNIGHT];
  types.forEach((ty, i) => doom.spawn(ty, Math.round(550 * Math.cos(i * 0.785)), Math.round(550 * Math.sin(i * 0.785)), 0, true));
  let worst = 0;
  for (let t = 0; t < 1400; t++) {
    doom.setCmd(t % 200 < 100 ? 25 : -25, 0, 300, t % 40 < 20 ? BT.FIRE : 0);
    doom.tick(1);
    for (const d of doom.things()) worst = Math.max(worst, dist(d.x, d.y, 0, 0));
  }
  doom.setCmd(0, 0, 0, 0);
  check(worst < 768, 'MAP02: 8 kinds of monsters fighting for 40 s all stay inside the room', `farthest monster ${worst.toFixed(0)} units from the centre; ${doom.state[S.MONSTERS]} still alive, player killed ${doom.state[S.PLAYER_KILLS]}`);
}

{
  // MAP01's exit switch, found in the WAD: stand in front of it and press use
  const n = wadBytes.readInt32LE(4), dir = wadBytes.readInt32LE(8), lump = {};
  let inMap = false;
  for (let i = 0; i < n; i++) {
    const o = dir + 16 * i, name = wadBytes.toString('latin1', o + 8, o + 16).replace(/\0.*$/, '');
    if (/^MAP\d\d$/.test(name)) inMap = name === 'MAP01';
    else if (inMap && !(name in lump)) lump[name] = wadBytes.subarray(wadBytes.readInt32LE(o), wadBytes.readInt32LE(o) + wadBytes.readInt32LE(o + 4));
  }
  const vx = (i) => [lump.VERTEXES.readInt16LE(4 * i), lump.VERTEXES.readInt16LE(4 * i + 2)];
  let exitLine = null;
  for (let o = 0; o < lump.LINEDEFS.length; o += 14) if (lump.LINEDEFS.readUInt16LE(o + 6) === 11) exitLine = [vx(lump.LINEDEFS.readUInt16LE(o)), vx(lump.LINEDEFS.readUInt16LE(o + 2))];
  doom.newGame({ skill: 3, map: 1, seed: 1 });
  const [[x1, y1], [x2, y2]] = exitLine, len = Math.hypot(x2 - x1, y2 - y1);
  const nx = (y2 - y1) / len, ny = -(x2 - x1) / len;   // front (right-hand) side
  doom.setPlayer(Math.round((x1 + x2) / 2 + 28 * nx), Math.round((y1 + y2) / 2 + 28 * ny), Math.round(Math.atan2(-ny, -nx) * 180 / Math.PI));
  doom.tick(1);
  const before = doom.state[S.EXITED];
  doom.setCmd(0, 0, 0, BT.USE);
  doom.tick(1);
  doom.setCmd(0, 0, 0, 0);
  const tic = doom.state[S.TIC];
  doom.tick(35);
  check(before === 0 && doom.state[S.EXITED] === 1 && doom.state[S.TIC] === tic, 'MAP01: pressing the exit switch sets the level-exit flag, and the game then stays stopped', `exit switch at (${x1},${y1})-(${x2},${y2})`);
}

// ---- determinism -------------------------------------------------------------------------------------

// A scripted game: 2,000 tics on the pillar map with seven monsters (one a shimmering spectre), moving, turning,
// shooting, switching weapons. Returns hashes of every tic's state and of frames.
function scripted(d, seed, draw = true) {
  d.newGame({ skill: 4, map: 3, seed });
  d.give(WP.SHOTGUN, 40, 200);
  const spawns = [[MT.IMP, 550, 300], [MT.DEMON, -500, 200], [MT.ZOMBIEMAN, 0, -600], [MT.SHOTGUNGUY, 600, -250], [MT.CACODEMON, -300, -500], [MT.LOSTSOUL, 300, 600], [MT.SPECTRE, -600, -100]];
  for (const [ty, x, y] of spawns) d.spawn(ty, x, y, 90, true);
  const states = [], frames = [];
  let snd = 0;
  for (let t = 0; t < 2000; t++) {
    const phase = Math.floor(t / 70) % 6;
    const buttons = (t % 50 < 30 ? BT.FIRE : 0) | (t === 700 ? BT.CHANGE | (WP.PISTOL << BT.WEAPON_SHIFT) : 0) | (t === 1400 ? BT.CHANGE | (WP.SHOTGUN << BT.WEAPON_SHIFT) : 0);
    d.setCmd([50, 25, 0, -25, 50, 0][phase], [0, 20, -20, 0, 0, 40][phase], ((t * 37) % 600) - 300, buttons);
    d.tick(1);
    const st = d.state.slice();
    st[S.SEED] = 0;   // compare the game, not the seed number it reports
    states.push(hash(st));
    if (draw && t % 7 === 0) frames.push(hash(d.render(96, 60, t % 14 === 0)));
    if (draw && t % 100 === 0) frames.push(hash(d.renderFull()));
    if (t % 10 === 0) for (const s of d.sounds()) snd = Math.imul(snd ^ (s.sfx * 65536 + s.vol * 256 + s.sep), 16777619) >>> 0;
  }
  return { states, frames, snd, last: Array.from(d.state), things: d.things() };
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
{
  const A = await fresh(), B = await fresh();
  const ra = scripted(A, 7), rb = scripted(B, 7);
  check(same(ra.states, rb.states) && same(ra.frames, rb.frames) && ra.snd === rb.snd,
    'same seed + same inputs, two fresh instances: identical states, frames and sounds for 2,000 tics',
    `${ra.states.length} state arrays, ${ra.frames.length} frame checksums; end: health ${ra.last[S.HEALTH]}, kills ${ra.last[S.KILLS]}, shots ${ra.last[S.SHOTS]}, dealt ${ra.last[S.DAMAGE_DEALT]}, taken ${ra.last[S.DAMAGE_TAKEN]}`);
  const rc = scripted(B, 8);
  const firstDiff = ra.states.findIndex((h, i) => h !== rc.states[i]);
  check(firstDiff >= 0, 'a different seed gives a different game', `seed 7 vs 8 differ from tic ${firstDiff + 1}; seed 8 end: health ${rc.last[S.HEALTH]}, kills ${rc.last[S.KILLS]}`);
  // a well-used instance plays exactly like a fresh one
  const r = rng(99);
  for (let g = 0; g < 60; g++) {
    B.newGame({ skill: 1 + (g % 5), map: 1 + (g % 3), seed: (r() * 1e9) | 0 });
    for (let k = 0; k < 4; k++) B.spawn(DOOM.MONSTERS[(r() * DOOM.MONSTERS.length) | 0], ((r() - 0.5) * 900) | 0, ((r() - 0.5) * 900) | 0, 0, true);
    B.setCmd(50, 0, 500, BT.FIRE);
    B.tick(200);
    if (g % 3 === 0) { B.render(96, 60); B.render(133, 77, true); B.renderFull(); }
  }
  const rd = scripted(B, 7);
  check(same(ra.states, rd.states) && same(ra.frames, rd.frames) && ra.snd === rd.snd, 'an instance that already played 60 other games plays the seed-7 game identically');
  const re = scripted(A, 7, false);
  check(same(ra.states, re.states), 'drawing frames or not does not change the game');
  // all 256 seed states are different games; seed and seed+256 are the same game
  const C = await fresh();
  const outcomes = new Set();
  const shortGame = (seed) => {
    C.newGame({ skill: 3, map: 2, seed });
    for (const [ty, x, y] of [[MT.IMP, 500, 300], [MT.DEMON, -500, 100], [MT.SHOTGUNGUY, 200, -550], [MT.CACODEMON, -350, -450]]) C.spawn(ty, x, y, 0, true);
    C.setCmd(0, 0, 200, BT.FIRE);
    C.tick(300);
    const st = C.state.slice();
    st[S.SEED] = 0;   // the state also reports the seed itself; compare the game only
    return hash(st) + ':' + C.things().map((t) => `${t.x},${t.y},${t.health}`).join(';');
  };
  for (let s = 0; s < 256; s++) outcomes.add(shortGame(s));
  check(outcomes.size === 256, '256 seeds give 256 different games', `${outcomes.size} distinct outcomes`);
  check(shortGame(5) === shortGame(5 + 256) && shortGame(77) === shortGame(77 + 512), 'seeds that agree in the low 8 bits give the same game');
}

// ---- memory over many games ----------------------------------------------------------------------------

{
  const M = await fresh();
  const r = rng(2024);
  let tNew = 0, before = null, worst = Infinity;
  for (let g = 0; g < 2000; g++) {
    const t = now();
    M.newGame({ skill: 1 + (g % 5), map: 1 + (g % 3), seed: g });
    tNew += now() - t;
    for (let k = 0; k < 3; k++) M.spawn(DOOM.MONSTERS[(r() * DOOM.MONSTERS.length) | 0], ((r() - 0.5) * 1000) | 0, ((r() - 0.5) * 1000) | 0, 0, true);
    M.setCmd(25, 0, 300, BT.FIRE);
    M.tick(20);
    if (g % 50 === 0) M.render(96, 60);
    const mi = M.memInfo();
    if (g === 99) before = mi;
    if (g >= 99 && g % 3 === 0) worst = Math.min(worst, mi.zoneFree);   // same map as game 99
  }
  const after = M.memInfo();
  check(after.memory === mem0.memory && after.heapTop === before.heapTop && worst >= before.zoneFree - 65536,
    '2,000 new games in a row: no crash, memory does not grow',
    `wasm memory ${after.memory / 1048576} MB, C heap top ${before.heapTop} -> ${after.heapTop}, zone free after game 100 ${(before.zoneFree / 1024).toFixed(0)} KB, lowest later ${(worst / 1024).toFixed(0)} KB, mean newGame ${(tNew / 2000).toFixed(2)} ms`);
}

// ---- speed ---------------------------------------------------------------------------------------------------

{
  const P = await fresh();
  const times = {};
  for (const map of [1, 2, 3]) {
    const t = now();
    for (let i = 0; i < 200; i++) P.newGame({ skill: 3, map, seed: i });
    times[map] = (now() - t) / 200;
  }
  P.newGame({ skill: 3, map: 2, seed: 1 });
  P.give(-1, -1, 30000);
  // six imps: they chase and throw fireballs, but (as in Doom) never hurt each other
  for (let k = 0; k < 6; k++) P.spawn(MT.IMP, Math.round(600 * Math.cos(k * 1.047)), Math.round(600 * Math.sin(k * 1.047)), 0, true);
  P.setCmd(0, 0, 0, 0);
  let t = now();
  for (let i = 0; i < 200; i++) P.tick(50);   // 10,000 tics; the player (30,000 health) is still alive
  const tps = 10000 / ((now() - t) / 1000);
  const alive = P.state[S.MONSTERS], aliveP = !P.state[S.DEAD], taken = P.state[S.DAMAGE_TAKEN];
  P.newGame({ skill: 3, map: 1, seed: 1 });
  P.give(-1, -1, 30000);
  t = now();
  for (let i = 0; i < 400; i++) P.tick(50);
  const tps1 = 20000 / ((now() - t) / 1000), alive1 = P.state[S.MONSTERS];
  P.newGame({ skill: 3, map: 2, seed: 1 });
  for (let k = 0; k < 6; k++) P.spawn(MT.IMP, Math.round(600 * Math.cos(k * 1.047)), Math.round(600 * Math.sin(k * 1.047)), 0, true);
  P.tick(10);
  const fps = (w, h, n) => {
    const t1 = now();
    for (let i = 0; i < n; i++) { if (i % 50 === 0) P.setPlayer(0, 0, i); P.render(w, h); }
    return n / ((now() - t1) / 1000);
  };
  const f96 = fps(96, 60, 6000), f320 = fps(320, 200, 1500);
  t = now();
  for (let i = 0; i < 1500; i++) { if (i % 50 === 0) P.setPlayer(0, 0, i); P.renderFull(); }
  const ffull = 1500 / ((now() - t) / 1000);
  console.log(`SPEED game tics per second, no drawing, arena with ${alive} awake imps alive: ${tps.toFixed(0)} (${(tps / 35).toFixed(0)}x real time); Freedoom MAP01 (${alive1} monsters): ${tps1.toFixed(0)}`);
  check(alive === 6 && aliveP, 'speed test really had 6 monsters alive and attacking a living player', `the player took ${taken} damage meanwhile`);
  console.log(`SPEED render(96, 60): ${f96.toFixed(0)} frames/s; render(320, 200): ${f320.toFixed(0)} frames/s; renderFull(): ${ffull.toFixed(0)} frames/s`);
  console.log(`SPEED newGame: MAP01 ${times[1].toFixed(2)} ms, MAP02 ${times[2].toFixed(2)} ms, MAP03 ${times[3].toFixed(2)} ms`);
  console.log(`INFO  vertical field of view of render(w, h) = 2*atan(h/w): 96x60 and 320x200 -> ${(2 * Math.atan(60 / 96) * 180 / Math.PI).toFixed(2)} deg; renderFull's 320x168 view -> ${(2 * Math.atan(168 / 320) * 180 / Math.PI).toFixed(2)} deg`);
}

// ---- screenshots ------------------------------------------------------------------------------------------------

function writePng(file, w, h, pixels, palette, scale = 1) {
  const rgba = toRGBA(pixels, palette);
  const W = w * scale, H = h * scale, raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (((y / scale) | 0) * w + ((x / scale) | 0)) * 4, o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = rgba[s]; raw[o + 1] = rgba[s + 1]; raw[o + 2] = rgba[s + 2]; raw[o + 3] = 255;
  }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), out = Buffer.alloc(td.length + 8);
    out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE(crc(td), td.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
if (WANT_PNG) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const D = await fresh();
  D.newGame({ skill: 3, map: 2, seed: 1 });
  D.spawn(MT.IMP, 380, 120, 200, false);
  D.spawn(MT.ZOMBIEMAN, 300, -90, 160, false);
  D.spawn(MT.CACODEMON, 520, 10, 180, false);
  D.spawn(MT.BARREL, 200, 40, 0, false);
  D.tick(30);                        // pistol fully raised
  const pal = D.palette(0);
  writePng(path.join(SHOTS, 'arena_96x60.png'), 96, 60, D.render(96, 60), pal);
  writePng(path.join(SHOTS, 'arena_96x60_x4.png'), 96, 60, D.render(96, 60), pal, 4);
  writePng(path.join(SHOTS, 'arena_96x60_weapon_x4.png'), 96, 60, D.render(96, 60, { weapon: true }), pal, 4);
  writePng(path.join(SHOTS, 'arena_full.png'), 320, 200, D.renderFull(), pal);
  D.newGame({ skill: 3, map: 1, seed: 1 });
  writePng(path.join(SHOTS, 'map01_start_full.png'), 320, 200, D.renderFull(), D.palette(0));
  D.newGame({ skill: 3, map: 3, seed: 1 });
  D.setPlayer(-650, -150, 20);
  D.spawn(MT.DEMON, 100, 150, 200, false);
  writePng(path.join(SHOTS, 'pillars_full.png'), 320, 200, D.renderFull(), D.palette(0));
  writePng(path.join(SHOTS, 'pillars_96x60_x4.png'), 96, 60, D.render(96, 60), D.palette(0), 4);
  console.log('wrote screenshots to', path.relative(ROOT, SHOTS));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
