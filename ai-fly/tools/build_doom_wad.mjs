// Builds ai-fly/data/doom/flygym.wad, the one game-data file of the fly gym's Doom engine.
//   node tools/build_doom_wad.mjs          (from ai-fly/)
//
// Made from Freedoom Phase 2 (freedoom2.wad, Doom II format, BSD-style licence), which the
// script downloads into doom-engine/.build/ (checked against a pinned SHA-256) unless it is
// already there. What the WAD contains:
//   - everything the headless engine needs to show any Doom II monster, weapon, item or
//     effect: palettes, colour maps, all sprites, status bar graphics and font;
//   - the real Freedoom MAP01, untouched;
//   - MAP02 "the arena" and MAP03 "the arena with pillars", generated below;
//   - only the wall textures and flats these three maps can show (every other texture name
//     stays defined, pointing at one tiny placeholder patch, so lookups by name never fail).
// Not included: music, sound samples, demos, the other 31 maps, menus, title/help/
// intermission/finale pictures, the DEHACKED and MIDI lumps.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------
// The arena maps. Change the description here and re-run the script.
//
// MAP02: one big, bright, regular 16-sided room. Player 1 starts in the middle facing east.
// MAP03: the same room with square pillars (full height) on a ring around the middle.
// No monsters are placed in the maps; the gym spawns them through fg_spawn().
// Coordinates are Doom map units, angles are degrees (0 = east, counter-clockwise).
export const ARENA = {
  sides: 16,          // regular polygon
  radius: 768,        // centre to corner
  rotate: 11.25,      // corner angle offset: 11.25 puts a flat wall face straight east
  floor: 0,           // floor height
  ceiling: 192,       // ceiling height
  light: 208,         // sector light level (0..255)
  wall: 'BRICK12',    // wall texture (must be 128 tall: Doom repeats walls every 128 units)
  floorFlat: 'FLOOR4_8',  // darker than the walls
  ceilFlat: 'FLAT2',      // brighter than the walls
};
export const PILLARS = {
  count: 6,           // on one ring
  size: 64,           // square side
  ring: 400,          // ring radius
  startAngle: 30,     // first pillar's angle; 30 leaves the view east from the start clear
  texture: 'STARG3',  // pillar texture (128 tall)
};
// ---------------------------------------------------------------------------------------

const FREEDOOM_URL = 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip';
const FREEDOOM_SHA256 = '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DL = path.join(ROOT, 'doom-engine', '.build', 'freedoom-dl');
const OUT = path.join(ROOT, 'data', 'doom');

// Doom's switch pairs (p_switch.c) and animation ranges (p_spec.c): if a map shows one
// of these textures/flats, its partners must be real too.
const SWITCHES = 'BRCOM BRN1 BRN2 BRNGN BROWN COMM COMP DIRT EXIT GRAY GRAY1 METAL PIPE SLAD STARG STON1 STON2 STONE STRTN BLUE CMT GARG GSTON HOT LION SATYR SKIN VINE WOOD PANEL ROCK MET2 WDMET BRIK MOD1 ZIM STON6 TEK MARB SKULL'.split(' ');
const ANIM_TEXTURES = [['BLODGR1', 'BLODGR4'], ['SLADRIP1', 'SLADRIP3'], ['BLODRIP1', 'BLODRIP4'], ['FIREWALA', 'FIREWALL'], ['GSTFONT1', 'GSTFONT3'], ['FIRELAV3', 'FIRELAVA'], ['FIREMAG1', 'FIREMAG3'], ['FIREBLU1', 'FIREBLU2'], ['ROCKRED1', 'ROCKRED3'], ['BFALL1', 'BFALL4'], ['SFALL1', 'SFALL4'], ['WFALL1', 'WFALL4'], ['DBRAIN1', 'DBRAIN4']];
const ANIM_FLATS = [['NUKAGE1', 'NUKAGE3'], ['FWATER1', 'FWATER4'], ['SWATER1', 'SWATER4'], ['LAVA1', 'LAVA4'], ['BLOOD1', 'BLOOD3'], ['RROCK05', 'RROCK08'], ['SLIME01', 'SLIME04'], ['SLIME05', 'SLIME08'], ['SLIME09', 'SLIME12']];
const SKIES = ['SKY1'];   // MAP01..MAP11 use SKY1
const MAP_LUMPS = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'];

// ---- getting Freedoom -------------------------------------------------------------------

async function freedoomFiles() {
  const dir = path.join(DL, 'freedoom-0.13.0');
  const want = ['freedoom2.wad', 'COPYING.txt', 'CREDITS.txt'];
  if (want.every((f) => fs.existsSync(path.join(dir, f)))) return dir;
  fs.mkdirSync(DL, { recursive: true });
  const zipPath = path.join(DL, 'freedoom-0.13.0.zip');
  if (!fs.existsSync(zipPath)) {
    console.log('downloading', FREEDOOM_URL);
    const r = await fetch(FREEDOOM_URL);
    if (!r.ok) throw new Error('download failed: ' + r.status);
    fs.writeFileSync(zipPath, Buffer.from(await r.arrayBuffer()));
  }
  const zip = fs.readFileSync(zipPath);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  if (sha !== FREEDOOM_SHA256) throw new Error('freedoom zip has the wrong SHA-256: ' + sha);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of unzip(zip)) {
    const base = path.basename(name);
    if (want.includes(base)) fs.writeFileSync(path.join(dir, base), data);
  }
  return dir;
}

// minimal ZIP reader (central directory + deflate), enough for the Freedoom release
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    out.push([name, method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null]);
  }
  return out;
}

// ---- WAD reading / writing --------------------------------------------------------------

function readWad(buf) {
  const n = buf.readInt32LE(4), dir = buf.readInt32LE(8), lumps = [];
  for (let i = 0; i < n; i++) {
    const o = dir + 16 * i, pos = buf.readInt32LE(o), size = buf.readInt32LE(o + 4);
    lumps.push({ name: buf.toString('latin1', o + 8, o + 16).replace(/\0.*$/, '').toUpperCase(), data: buf.subarray(pos, pos + size) });
  }
  return lumps;
}

function writeWad(lumps) {
  let size = 12;
  for (const l of lumps) size += l.data.length;
  const buf = Buffer.alloc(size + 16 * lumps.length);
  buf.write('IWAD', 0, 'latin1');
  buf.writeInt32LE(lumps.length, 4);
  buf.writeInt32LE(size, 8);
  let pos = 12;
  lumps.forEach((l, i) => {
    Buffer.from(l.data).copy(buf, pos);
    const o = size + 16 * i;
    buf.writeInt32LE(l.data.length ? pos : 0, o);
    buf.writeInt32LE(l.data.length, o + 4);
    buf.write(l.name.padEnd(8, '\0'), o + 8, 8, 'latin1');
    pos += l.data.length;
  });
  return buf;
}

const name8 = (b, o) => b.toString('latin1', o, o + 8).replace(/\0.*$/, '').toUpperCase();
function put8(b, o, s) { b.fill(0, o, o + 8); b.write(s, o, Math.min(8, s.length), 'latin1'); }

// ---- the arena geometry -------------------------------------------------------------------

// Returns { vertices, lines, sides, sectors, things }; lines are one-sided, their front
// (right-hand) side faces into the room.
function arenaGeometry(withPillars) {
  const V = [], lines = [], sides = [];
  const vtx = (x, y) => { V.push({ x: Math.round(x), y: Math.round(y) }); return V.length - 1; };
  const wall = (a, b, tex, xoff) => {
    sides.push({ xoff: xoff | 0, yoff: 0, upper: '-', lower: '-', mid: tex, sector: 0 });
    lines.push({ v1: a, v2: b, flags: 1, special: 0, tag: 0, front: sides.length - 1, back: -1 });
  };
  // outer wall: corners clockwise so the room is on each line's right
  const ring = [];
  for (let i = 0; i < ARENA.sides; i++) {
    const a = (ARENA.rotate - (i * 360) / ARENA.sides) * Math.PI / 180;
    ring.push(vtx(ARENA.radius * Math.cos(a), ARENA.radius * Math.sin(a)));
  }
  let run = 0;   // texture runs on around the room without jumps
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    wall(a, b, ARENA.wall, run % 256);
    run += Math.round(Math.hypot(V[b].x - V[a].x, V[b].y - V[a].y));
  }
  if (withPillars) {
    const h = PILLARS.size / 2;
    for (let k = 0; k < PILLARS.count; k++) {
      const a = (PILLARS.startAngle + (k * 360) / PILLARS.count) * Math.PI / 180;
      const cx = Math.round(PILLARS.ring * Math.cos(a)), cy = Math.round(PILLARS.ring * Math.sin(a));
      // counter-clockwise, so the room (outside the pillar) is on the right
      const c = [vtx(cx - h, cy - h), vtx(cx + h, cy - h), vtx(cx + h, cy + h), vtx(cx - h, cy + h)];
      for (let i = 0; i < 4; i++) wall(c[i], c[(i + 1) % 4], PILLARS.texture, 0);
    }
  }
  const sectors = [{ floor: ARENA.floor, ceil: ARENA.ceiling, floorpic: ARENA.floorFlat, ceilpic: ARENA.ceilFlat, light: ARENA.light, special: 0, tag: 0 }];
  const things = [{ x: 0, y: 0, angle: 0, type: 1, flags: 7 }];   // player 1 start, all skills
  return { V, lines, sides, sectors, things };
}

// ---- node builder ---------------------------------------------------------------------------
// Classic BSP: pick a seg's line as partition (fewest splits, then best balance), split the
// segs that cross it, recurse until every set of segs is convex (each seg in front of all
// the others' lines) -> one subsector. A convex room gives one subsector and zero nodes.

function buildNodes(V, lines) {
  const key = new Map(V.map((v, i) => [v.x + ',' + v.y, i]));
  const vertexAt = (x, y) => {
    const k = x + ',' + y;
    if (!key.has(k)) { V.push({ x, y }); key.set(k, V.length - 1); }
    return key.get(k);
  };
  const segs0 = [];
  lines.forEach((l, i) => {
    if (l.front >= 0) segs0.push({ v1: l.v1, v2: l.v2, line: i, side: 0 });
    if (l.back >= 0) segs0.push({ v1: l.v2, v2: l.v1, line: i, side: 1 });
  });
  // a seg's partition is its whole linedef line, pointing the same way as the seg
  const part = (s) => {
    const l = lines[s.line], a = V[s.side ? l.v2 : l.v1], b = V[s.side ? l.v1 : l.v2];
    return { x: a.x, y: a.y, dx: b.x - a.x, dy: b.y - a.y };
  };
  const sideOf = (p, P) => P.dx * (p.y - P.y) - P.dy * (p.x - P.x);   // < 0 front (right), > 0 back
  const classify = (s, P) => {
    const a = sideOf(V[s.v1], P), b = sideOf(V[s.v2], P);
    if (a === 0 && b === 0) {
      const sx = V[s.v2].x - V[s.v1].x, sy = V[s.v2].y - V[s.v1].y;
      return sx * P.dx + sy * P.dy > 0 ? 0 : 1;
    }
    if (a <= 0 && b <= 0) return 0;
    if (a >= 0 && b >= 0) return 1;
    return 2;
  };
  const convex = (set) => set.every((s) => { const P = part(s); return set.every((t) => t === s || classify(t, P) === 0); });
  const bbox = (set) => {
    const b = [-Infinity, Infinity, Infinity, -Infinity];   // top, bottom, left, right
    for (const s of set) for (const v of [V[s.v1], V[s.v2]]) {
      b[0] = Math.max(b[0], v.y); b[1] = Math.min(b[1], v.y); b[2] = Math.min(b[2], v.x); b[3] = Math.max(b[3], v.x);
    }
    return b;
  };
  const segs = [], ssectors = [], nodes = [];
  let splits = 0;
  const build = (set, depth) => {
    if (depth > 64) throw new Error('node builder: too deep');
    if (convex(set)) {
      ssectors.push({ first: segs.length, count: set.length });
      segs.push(...set);
      return { id: (ssectors.length - 1) | 0x8000, box: bbox(set) };
    }
    let best = null, bestScore = Infinity;
    const tried = new Set();
    for (const s of set) {
      const k = s.line + ':' + s.side;
      if (tried.has(k)) continue;
      tried.add(k);
      const P = part(s);
      let f = 0, b = 0, sp = 0;
      for (const t of set) { const c = classify(t, P); if (c === 0) f++; else if (c === 1) b++; else sp++; }
      if (b + sp === 0) continue;   // everything in front: does not divide
      const score = sp * 8 + Math.abs(f - b);
      if (score < bestScore) { bestScore = score; best = P; }
    }
    if (!best) throw new Error('node builder: no partition');
    const F = [], B = [];
    for (const t of set) {
      const c = classify(t, best);
      if (c === 0) { F.push(t); continue; }
      if (c === 1) { B.push(t); continue; }
      const A = V[t.v1], Z = V[t.v2], a = sideOf(A, best), z = sideOf(Z, best);
      const u = a / (a - z), x = Math.round(A.x + u * (Z.x - A.x)), y = Math.round(A.y + u * (Z.y - A.y));
      if ((x === A.x && y === A.y) || (x === Z.x && y === Z.y)) {   // rounding hit an end: no split
        ((x === A.x && y === A.y) ? z : a) < 0 ? F.push(t) : B.push(t);
        continue;
      }
      const m = vertexAt(x, y), first = { ...t, v2: m }, second = { ...t, v1: m };
      splits++;
      if (a < 0) { F.push(first); B.push(second); } else { B.push(first); F.push(second); }
    }
    const f = build(F, depth + 1), b = build(B, depth + 1);
    nodes.push({ P: best, box: [f.box, b.box], child: [f.id, b.id] });   // root comes last
    const box = [Math.max(f.box[0], b.box[0]), Math.min(f.box[1], b.box[1]), Math.min(f.box[2], b.box[2]), Math.max(f.box[3], b.box[3])];
    return { id: nodes.length - 1, box };
  };
  build(segs0, 0);
  return { segs, ssectors, nodes, splits };
}

// ---- blockmap -------------------------------------------------------------------------------

function buildBlockmap(V, lines) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const l of lines) for (const v of [V[l.v1], V[l.v2]]) {
    minx = Math.min(minx, v.x); miny = Math.min(miny, v.y); maxx = Math.max(maxx, v.x); maxy = Math.max(maxy, v.y);
  }
  const ox = minx - 8, oy = miny - 8;
  const cols = Math.floor((maxx - ox) / 128) + 1, rows = Math.floor((maxy - oy) / 128) + 1;
  // does segment a-b touch the closed box [x0,x1]x[y0,y1]? (Liang-Barsky)
  const touches = (a, b, x0, y0, x1, y1) => {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  };
  const lists = [];
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    const x0 = ox + bx * 128, y0 = oy + by * 128, list = [0];
    lines.forEach((l, i) => { if (touches(V[l.v1], V[l.v2], x0, y0, x0 + 128, y0 + 128)) list.push(i); });
    list.push(-1);
    lists.push(list);
  }
  const words = [ox, oy, cols, rows];
  let at = 4 + lists.length;
  for (const l of lists) { words.push(at); at += l.length; }
  for (const l of lists) words.push(...l);
  if (at > 65535) throw new Error('blockmap too big');
  const b = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => b.writeUInt16LE(w & 0xffff, i * 2));
  return b;
}

// ---- map lumps -------------------------------------------------------------------------------

function mapLumps(name, geo) {
  const { V, lines, sides, sectors, things } = geo;
  const bsp = buildNodes(V, lines);   // may add split vertices to V
  const L = {};
  L.THINGS = Buffer.alloc(10 * things.length);
  things.forEach((t, i) => [t.x, t.y, t.angle, t.type, t.flags].forEach((v, j) => L.THINGS.writeInt16LE(v, 10 * i + 2 * j)));
  L.LINEDEFS = Buffer.alloc(14 * lines.length);
  lines.forEach((l, i) => [l.v1, l.v2, l.flags, l.special, l.tag, l.front, l.back].forEach((v, j) => L.LINEDEFS.writeUInt16LE(v & 0xffff, 14 * i + 2 * j)));
  L.SIDEDEFS = Buffer.alloc(30 * sides.length);
  sides.forEach((s, i) => {
    const o = 30 * i;
    L.SIDEDEFS.writeInt16LE(s.xoff, o); L.SIDEDEFS.writeInt16LE(s.yoff, o + 2);
    put8(L.SIDEDEFS, o + 4, s.upper); put8(L.SIDEDEFS, o + 12, s.lower); put8(L.SIDEDEFS, o + 20, s.mid);
    L.SIDEDEFS.writeInt16LE(s.sector, o + 28);
  });
  L.VERTEXES = Buffer.alloc(4 * V.length);
  V.forEach((v, i) => { L.VERTEXES.writeInt16LE(v.x, 4 * i); L.VERTEXES.writeInt16LE(v.y, 4 * i + 2); });
  L.SEGS = Buffer.alloc(12 * bsp.segs.length);
  bsp.segs.forEach((s, i) => {
    const l = lines[s.line], a = V[s.v1], b = V[s.v2], start = V[s.side ? l.v2 : l.v1];
    const angle = Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 32768) / Math.PI) & 0xffff;
    const offset = Math.round(Math.hypot(a.x - start.x, a.y - start.y));
    [s.v1, s.v2, angle, s.line, s.side, offset].forEach((v, j) => L.SEGS.writeUInt16LE(v & 0xffff, 12 * i + 2 * j));
  });
  L.SSECTORS = Buffer.alloc(4 * bsp.ssectors.length);
  bsp.ssectors.forEach((s, i) => { L.SSECTORS.writeUInt16LE(s.count, 4 * i); L.SSECTORS.writeUInt16LE(s.first, 4 * i + 2); });
  L.NODES = Buffer.alloc(28 * bsp.nodes.length);
  bsp.nodes.forEach((n, i) => {
    const w = [n.P.x, n.P.y, n.P.dx, n.P.dy, ...n.box[0], ...n.box[1], n.child[0], n.child[1]];
    w.forEach((v, j) => L.NODES.writeUInt16LE(v & 0xffff, 28 * i + 2 * j));
  });
  L.SECTORS = Buffer.alloc(26 * sectors.length);
  sectors.forEach((s, i) => {
    const o = 26 * i;
    L.SECTORS.writeInt16LE(s.floor, o); L.SECTORS.writeInt16LE(s.ceil, o + 2);
    put8(L.SECTORS, o + 4, s.floorpic); put8(L.SECTORS, o + 12, s.ceilpic);
    L.SECTORS.writeInt16LE(s.light, o + 20); L.SECTORS.writeInt16LE(s.special, o + 22); L.SECTORS.writeInt16LE(s.tag, o + 24);
  });
  L.REJECT = Buffer.alloc(Math.ceil((sectors.length * sectors.length) / 8));   // all zero: everyone can see everyone
  L.BLOCKMAP = buildBlockmap(V, lines);
  const lumps = [{ name, data: Buffer.alloc(0) }, ...MAP_LUMPS.map((n) => ({ name: n, data: L[n] }))];
  return { lumps, info: `${name}: ${lines.length} lines, ${V.length} vertices, ${bsp.segs.length} segs, ${bsp.ssectors.length} subsectors, ${bsp.nodes.length} nodes, ${bsp.splits} splits` };
}

// textures and flats a map's sidedefs and sectors name
function mapUses(lumps) {
  const get = (n) => lumps.find((l) => l.name === n).data;
  const tex = new Set(), flats = new Set();
  const sd = get('SIDEDEFS');
  for (let o = 0; o + 30 <= sd.length; o += 30) for (const k of [4, 12, 20]) { const t = name8(sd, o + k); if (t && t !== '-') tex.add(t); }
  const se = get('SECTORS');
  for (let o = 0; o + 26 <= se.length; o += 26) { flats.add(name8(se, o + 4)); flats.add(name8(se, o + 12)); }
  return { tex, flats };
}

// ---- main ------------------------------------------------------------------------------------

async function main() {
  const src = await freedoomFiles();
  const wad = readWad(fs.readFileSync(path.join(src, 'freedoom2.wad')));
  const byName = new Map(wad.map((l) => [l.name, l]));
  const ix = (n) => wad.findIndex((l) => l.name === n);

  // sections
  const between = (a, b) => wad.slice(ix(a) + 1, ix(b));
  const sprites = between('S_START', 'S_END');
  const patches = between('P_START', 'P_END');
  const flats = between('F_START', 'F_END');

  // maps: the real MAP01 plus our two arenas
  const m1 = ix('MAP01');
  const map01 = wad.slice(m1, m1 + 11);
  if (map01.slice(1).map((l) => l.name).join() !== MAP_LUMPS.join()) throw new Error('unexpected MAP01 layout');
  const arena = mapLumps('MAP02', arenaGeometry(false));
  const pillars = mapLumps('MAP03', arenaGeometry(true));
  console.log(arena.info);
  console.log(pillars.info);

  // which textures / flats can ever be drawn
  const usedTex = new Set(SKIES), usedFlats = new Set(['F_SKY1']);
  for (const m of [map01, arena.lumps, pillars.lumps]) {
    const u = mapUses(m);
    u.tex.forEach((t) => usedTex.add(t));
    u.flats.forEach((f) => usedFlats.add(f));
  }
  for (const t of [...usedTex]) {
    const m = /^SW([12])(.*)$/.exec(t);
    if (m && SWITCHES.includes(m[2])) { usedTex.add('SW1' + m[2]); usedTex.add('SW2' + m[2]); }
  }

  // TEXTURE1 / PNAMES
  const pn = byName.get('PNAMES').data, np = pn.readInt32LE(0);
  const pnames = Array.from({ length: np }, (_, i) => name8(pn, 4 + 8 * i));
  const t1 = byName.get('TEXTURE1').data, nt = t1.readInt32LE(0);
  const texdefs = [];
  for (let i = 0; i < nt; i++) {
    const o = t1.readInt32LE(4 + 4 * i), pc = t1.readInt16LE(o + 20);
    texdefs.push({ name: name8(t1, o), def: t1.subarray(o, o + 22 + 10 * pc) });
  }
  const texIndex = new Map(texdefs.map((t, i) => [t.name, i]));
  for (const [a, b] of ANIM_TEXTURES) {
    const ia = texIndex.get(a), ib = texIndex.get(b);
    if (ia === undefined || ib === undefined) continue;
    let any = false;
    for (let i = ia; i <= ib; i++) if (usedTex.has(texdefs[i].name)) any = true;
    if (any) for (let i = ia; i <= ib; i++) usedTex.add(texdefs[i].name);
  }
  for (const t of usedTex) if (!texIndex.has(t)) throw new Error('texture not in Freedoom: ' + t);

  // placeholder patch: 8 x 128, one colour
  const blank = Buffer.alloc(8 + 4 * 8 + 8 * 133);
  blank.writeInt16LE(8, 0); blank.writeInt16LE(128, 2);
  for (let x = 0; x < 8; x++) {
    const c = 40 + 133 * x;
    blank.writeInt32LE(c, 8 + 4 * x);
    blank[c] = 0; blank[c + 1] = 128; blank.fill(251, c + 2, c + 132); blank[c + 132] = 0xff;
  }
  const newPnames = ['FGBLANK'], pIndex = new Map([['FGBLANK', 0]]);
  const texOut = texdefs.map((t) => {
    if (usedTex.has(t.name)) {
      const d = Buffer.from(t.def), pc = d.readInt16LE(20);
      for (let p = 0; p < pc; p++) {
        const pname = pnames[d.readInt16LE(22 + 10 * p + 4)];
        if (!pIndex.has(pname)) { pIndex.set(pname, newPnames.length); newPnames.push(pname); }
        d.writeInt16LE(pIndex.get(pname), 22 + 10 * p + 4);
      }
      return d;
    }
    const d = Buffer.alloc(32);   // same name, 8x128, one placeholder patch
    put8(d, 0, t.name); d.writeInt16LE(8, 12); d.writeInt16LE(128, 14); d.writeInt16LE(1, 20);
    return d;
  });
  let tsize = 4 + 4 * texOut.length;
  const offs = texOut.map((d) => { const o = tsize; tsize += d.length; return o; });
  const newT1 = Buffer.alloc(tsize);
  newT1.writeInt32LE(texOut.length, 0);
  texOut.forEach((d, i) => { newT1.writeInt32LE(offs[i], 4 + 4 * i); d.copy(newT1, offs[i]); });
  const newPN = Buffer.alloc(4 + 8 * newPnames.length);
  newPN.writeInt32LE(newPnames.length, 0);
  newPnames.forEach((n, i) => put8(newPN, 4 + 8 * i, n));
  const keepPatch = new Set(newPnames);
  const patchesOut = [{ name: 'FGBLANK', data: blank }, ...patches.filter((l) => l.data.length === 0 || keepPatch.has(l.name))];
  for (const n of newPnames) if (n !== 'FGBLANK' && !patches.some((l) => l.name === n)) throw new Error('patch missing: ' + n);

  // flats: the used ones, plus whole animation ranges that contain a used one
  const flatNames = flats.map((l) => l.name);
  const keepFlat = new Set(usedFlats);
  for (const [a, b] of ANIM_FLATS) {
    const ia = flatNames.indexOf(a), ib = flatNames.indexOf(b);
    if (ia < 0 || ib < 0) continue;
    if (flatNames.slice(ia, ib + 1).some((n) => usedFlats.has(n))) flatNames.slice(ia, ib + 1).forEach((n) => keepFlat.add(n));
  }
  for (const f of usedFlats) if (!flatNames.includes(f)) throw new Error('flat not in Freedoom: ' + f);
  const flatsOut = flats.filter((l) => l.data.length === 0 || keepFlat.has(l.name));

  // the few lumps outside the sections that the engine reads (status bar, its font, palettes)
  const misc = wad.filter((l) => ['PLAYPAL', 'COLORMAP'].includes(l.name) || /^(ST|AMMNUM|BRDR_)/.test(l.name))
    .filter((l, i, a) => wad.indexOf(l) < ix('S_START'));

  const out = [
    ...misc,
    { name: 'TEXTURE1', data: newT1 },
    { name: 'PNAMES', data: newPN },
    ...map01, ...arena.lumps, ...pillars.lumps,
    { name: 'S_START', data: Buffer.alloc(0) }, ...sprites, { name: 'S_END', data: Buffer.alloc(0) },
    { name: 'P_START', data: Buffer.alloc(0) }, ...patchesOut, { name: 'P_END', data: Buffer.alloc(0) },
    { name: 'F_START', data: Buffer.alloc(0) }, ...flatsOut, { name: 'F_END', data: Buffer.alloc(0) },
  ];
  fs.mkdirSync(OUT, { recursive: true });
  const buf = writeWad(out);
  fs.writeFileSync(path.join(OUT, 'flygym.wad'), buf);
  fs.copyFileSync(path.join(src, 'COPYING.txt'), path.join(OUT, 'FREEDOOM-COPYING.txt'));
  fs.copyFileSync(path.join(src, 'CREDITS.txt'), path.join(OUT, 'FREEDOOM-CREDITS.txt'));

  const sum = (ls) => ls.reduce((a, l) => a + l.data.length, 0);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`textures: ${usedTex.size} of ${nt} real (others -> placeholder), patches ${newPnames.length - 1} of ${np}, flats ${flatsOut.filter((l) => l.data.length).length} of ${flats.filter((l) => l.data.length).length}`);
  console.log(`sprites ${kb(sum(sprites))}, patches ${kb(sum(patchesOut))}, flats ${kb(sum(flatsOut))}, maps ${kb(sum(map01) + sum(arena.lumps) + sum(pillars.lumps))}, other ${kb(sum(misc) + newT1.length + newPN.length)}`);
  console.log(`wrote ${path.relative(ROOT, path.join(OUT, 'flygym.wad'))}: ${out.length} lumps, ${buf.length} bytes (${(buf.length / 1048576).toFixed(2)} MB; freedoom2.wad is ${(fs.statSync(path.join(src, 'freedoom2.wad')).size / 1048576).toFixed(2)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
