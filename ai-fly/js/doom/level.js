// A real Doom level, read out of the game file: its walls, where a player can walk, and how far it
// is from any spot to the exit switch, walking around the walls.
//
// None of this ever reaches the fly. It is for the books only: the score ("how much of the way to the
// exit did it cover"), the treats of the learning centre, and the small map on the page.
//
//   const level = readLevel(wad, 1);     // wad: the bytes of data/doom/flygym.wad
//   const nav = buildNav(level, 3);      // 3 = the skill the game is played at
//   nav.way(x, y)                        // 0 at the start ... 1 at the exit switch
//
// How "where a player can walk" is worked out: a grid of points 16 map units apart. A point counts if
// a player (16 units wide to each side) fits there without touching a wall. From one point to the next
// one may go if the step up is at most 24 units and there are 56 units of headroom, as in Doom. Doors
// that open when "use" is pressed on them count as open, lifts count in both positions, and a
// teleporter line leads to its landing spot. Doors and floors that are worked from somewhere else (a
// switch, a line on the floor) count as they are at the start: a shortcut that only opens later is
// no way for someone who has not been there yet. (Only if the exit could not be reached at all are
// they counted as open.) The distance to the exit is then the shortest way over these points.

const CELL = 16, RADIUS = 16, STEP = 24, HEIGHT = 56;
// line types (Doom's "specials"). Doors opened by walking up and pressing "use" on them:
const DOOR_MANUAL = new Set([1, 26, 27, 28, 31, 32, 33, 34, 117, 118]);
// doors that are worked from somewhere else (a switch or a line on the floor), lifts, and floors that sink when
// a switch or a line somewhere else is worked
const DOOR_REMOTE = new Set([2, 4, 29, 46, 61, 63, 86, 90, 99, 103, 105, 106, 108, 109, 111, 112, 114, 115, 133, 134, 135, 136, 137]);
const LIFT = new Set([10, 21, 62, 88, 120, 121, 122, 123]);
const FLOOR_TO_HIGHEST = new Set([19, 36, 45, 70, 71, 83, 98, 102]);
const FLOOR_TO_LOWEST = new Set([23, 37, 38, 60, 82, 84]);
const TELEPORT = new Set([39, 97]);
const EXIT_SWITCH = new Set([11, 51]), EXIT_LINE = new Set([52, 124]);
// things on the map: monsters, things that count as "items" in Doom's tally, and solid decoration (with its radius)
const MONSTER = new Set([3004, 9, 3001, 3002, 58, 65, 3005, 3006, 3003, 69, 66, 67, 68, 71, 64, 16, 7, 84]);
const ITEM = new Set([2013, 2014, 2015, 2022, 2023, 2024, 2026, 2045, 83]);
const SOLID = { 43: 16, 47: 16, 48: 16, 54: 32, 2028: 16, 2035: 10, 70: 10, 85: 16, 86: 16, 44: 16, 45: 16, 46: 16, 55: 16, 56: 16, 57: 16, 41: 16, 42: 16, 30: 16, 31: 16, 32: 16, 33: 16, 35: 16, 36: 16, 37: 16 };

export function readLevel(wad, map = 1) {
  const b = wad instanceof Uint8Array ? wad : new Uint8Array(wad);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getInt32(4, true), dir = dv.getInt32(8, true), want = 'MAP' + String(map).padStart(2, '0');
  const lump = {};
  let inMap = false;
  for (let i = 0; i < count; i++) {
    const o = dir + 16 * i;
    let name = '';
    for (let k = 0; k < 8 && b[o + 8 + k]; k++) name += String.fromCharCode(b[o + 8 + k]);
    if (/^MAP\d\d$/.test(name)) inMap = name === want;
    else if (inMap && !(name in lump)) lump[name] = [dv.getInt32(o, true), dv.getInt32(o + 4, true)];
  }
  if (!lump.LINEDEFS) throw new Error(`no ${want} in the game file`);
  const i16 = (o) => dv.getInt16(o, true), u16 = (o) => dv.getUint16(o, true);
  const each = (name, size, f) => { const [o, n] = lump[name], out = []; for (let p = o; p < o + n; p += size) out.push(f(p)); return out; };
  const vertices = each('VERTEXES', 4, (p) => [i16(p), i16(p + 2)]);
  const sectors = each('SECTORS', 26, (p) => ({ floor: i16(p), ceil: i16(p + 2), special: i16(p + 22), tag: i16(p + 24) }));
  const sides = each('SIDEDEFS', 30, (p) => u16(p + 28));
  const lines = each('LINEDEFS', 14, (p) => {
    const [x1, y1] = vertices[u16(p)], [x2, y2] = vertices[u16(p + 2)], r = u16(p + 10), l = u16(p + 12);
    return { x1, y1, x2, y2, flags: u16(p + 4), special: u16(p + 6), tag: u16(p + 8), front: r === 0xffff ? -1 : sides[r], back: l === 0xffff ? -1 : sides[l] };
  });
  const things = each('THINGS', 10, (p) => ({ x: i16(p), y: i16(p + 2), angle: i16(p + 4), type: i16(p + 6), flags: i16(p + 8) }));
  // Doom's own way of finding the sector under a point (its BSP tree)
  const nodes = each('NODES', 28, (p) => [i16(p), i16(p + 2), i16(p + 4), i16(p + 6), u16(p + 24), u16(p + 26)]);
  const subs = each('SSECTORS', 4, (p) => u16(p + 2));
  const segs = each('SEGS', 12, (p) => { const line = lines[u16(p + 6)]; return u16(p + 8) ? line.back : line.front; });
  const sectorAt = (x, y) => {
    let k = nodes.length - 1;
    while (!(k & 0x8000)) {
      const [nx, ny, dx, dy, right, left] = nodes[k];
      let side;
      if (!dx) side = x <= nx ? dy > 0 : dy < 0;
      else if (!dy) side = y <= ny ? dx < 0 : dx > 0;
      else side = (y - ny) * dx >= dy * (x - nx);
      k = side ? left : right;
    }
    return segs[subs[k & 0x7fff]];
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of vertices) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const start = things.find((t) => t.type === 1);
  return { map, vertices, sectors, lines, things, sectorAt, start, bounds: { minX, minY, maxX, maxY } };
}

// what is placed in the level at this skill for one player
export function levelThings(level, skill = 3) {
  const bit = skill <= 2 ? 1 : skill === 3 ? 2 : 4;
  const here = level.things.filter((t) => (t.flags & bit) && !(t.flags & 16));
  return { monsters: here.filter((t) => MONSTER.has(t.type)), items: here.filter((t) => ITEM.has(t.type)), all: here };
}

export function buildNav(level, skill = 3) {
  try { return build(level, skill, false); } catch { return build(level, skill, true); }
}

// remote: whether doors and floors that are worked from somewhere else count as open
function build(level, skill, remote) {
  const { lines, sectors, sectorAt, bounds, start } = level;
  const x0 = bounds.minX - 2 * CELL, y0 = bounds.minY - 2 * CELL;
  const W = Math.ceil((bounds.maxX - bounds.minX) / CELL) + 5, H = Math.ceil((bounds.maxY - bounds.minY) / CELL) + 5, N = W * H;
  const cx = (i) => x0 + (i % W) * CELL, cy = (i) => y0 + Math.floor(i / W) * CELL;
  const cellOf = (x, y) => { const gx = Math.round((x - x0) / CELL), gy = Math.round((y - y0) / CELL); return gx < 0 || gy < 0 || gx >= W || gy >= H ? -1 : gy * W + gx; };

  // ---- what the doors, lifts and sinking floors can do to their sectors
  const S = sectors.length;
  const floorLo = Float32Array.from(sectors, (s) => s.floor), floorHi = Float32Array.from(floorLo), ceilHi = Float32Array.from(sectors, (s) => s.ceil);
  const next = Array.from({ length: S }, () => new Set());
  for (const l of lines) if (l.front >= 0 && l.back >= 0 && l.front !== l.back) { next[l.front].add(l.back); next[l.back].add(l.front); }
  const tagged = (tag) => sectors.map((s, i) => s.tag === tag ? i : -1).filter((i) => i >= 0);
  const around = (s, key, pick) => { let v = pick === Math.min ? Infinity : -Infinity; for (const o of next[s]) v = pick(v, sectors[o][key]); return Number.isFinite(v) ? v : sectors[s][key]; };
  const isDoor = new Uint8Array(S);
  for (const l of lines) {
    if (DOOR_MANUAL.has(l.special) && l.back >= 0) isDoor[l.back] = 1;
    if (LIFT.has(l.special) && l.tag) for (const s of tagged(l.tag)) floorLo[s] = Math.min(floorLo[s], around(s, 'floor', Math.min));
    if (!remote) continue;
    if (DOOR_REMOTE.has(l.special) && l.tag) for (const s of tagged(l.tag)) isDoor[s] = 1;
    if (FLOOR_TO_LOWEST.has(l.special) && l.tag) for (const s of tagged(l.tag)) floorLo[s] = Math.min(floorLo[s], around(s, 'floor', Math.min));
    if (FLOOR_TO_HIGHEST.has(l.special) && l.tag) for (const s of tagged(l.tag)) floorLo[s] = Math.min(floorLo[s], around(s, 'floor', Math.max));
  }
  for (let s = 0; s < S; s++) if (isDoor[s]) ceilHi[s] = Math.max(ceilHi[s], around(s, 'ceil', Math.min) - 4);

  // ---- the points where a player fits: not within reach of a wall or of a solid thing
  const blocked = new Uint8Array(N), near = new Float32Array(N).fill(64);     // near: distance to the nearest wall (up to 64)
  const mark = (ax, ay, bx, by, reach) => {
    const gx0 = Math.max(0, Math.floor((Math.min(ax, bx) - 64 - x0) / CELL)), gx1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + 64 - x0) / CELL));
    const gy0 = Math.max(0, Math.floor((Math.min(ay, by) - 64 - y0) / CELL)), gy1 = Math.min(H - 1, Math.ceil((Math.max(ay, by) + 64 - y0) / CELL));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const px = x0 + gx * CELL, py = y0 + gy * CELL, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy), i = gy * W + gx;
      if (d < reach) blocked[i] = 1;
      if (d - (reach - RADIUS) < near[i]) near[i] = d - (reach - RADIUS);
    }
  };
  for (const l of lines) if (l.back < 0 || l.front < 0 || (l.flags & 1)) mark(l.x1, l.y1, l.x2, l.y2, RADIUS);
  const placed = levelThings(level, skill);
  for (const t of placed.all) if (SOLID[t.type]) mark(t.x, t.y, t.x, t.y, RADIUS + SOLID[t.type]);
  const sec = new Int16Array(N);
  for (let i = 0; i < N; i++) sec[i] = blocked[i] ? -1 : sectorAt(cx(i), cy(i));

  // ---- from one point to its neighbour
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1], COST = DX.map((dx, k) => Math.hypot(dx, DY[k]) * CELL);
  const stepOk = (a, b) => {
    const A = sec[a], B = sec[b];
    if (A < 0 || B < 0) return false;
    if (A === B) return true;
    return floorLo[B] - floorHi[A] <= STEP && Math.min(ceilHi[A], ceilHi[B]) - Math.max(floorLo[A], floorLo[B]) >= HEIGHT && ceilHi[B] - floorLo[B] >= HEIGHT;
  };
  const go = (a, k) => {            // the neighbour of `a` in direction k, or -1
    const gx = a % W + DX[k], gy = Math.floor(a / W) + DY[k];
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return -1;
    const b = gy * W + gx;
    if (!stepOk(a, b)) return -1;
    if (k & 1) {                    // diagonal: not around a corner
      const s1 = a + DX[k], s2 = a + DY[k] * W;
      if (!stepOk(a, s1) || !stepOk(a, s2) || !stepOk(s1, b) || !stepOk(s2, b)) return -1;
    }
    return b;
  };
  // teleporter lines: stepping over one from its front leads to the landing spot of its target sector
  const jump = new Map();           // a * 8 + k  ->  the point one lands on
  for (const l of lines) {
    if (!TELEPORT.has(l.special)) continue;
    const spot = placed.all.find((t) => t.type === 14 && sectors[sectorAt(t.x, t.y)].tag === l.tag) || level.things.find((t) => t.type === 14 && sectors[sectorAt(t.x, t.y)].tag === l.tag);
    if (!spot) continue;
    const dest = cellOf(spot.x, spot.y), dx = l.x2 - l.x1, dy = l.y2 - l.y1;
    const side = (x, y) => (x - l.x1) * dy - (y - l.y1) * dx;        // > 0: in front of the line (its right-hand side)
    const gx0 = Math.floor((Math.min(l.x1, l.x2) - x0) / CELL) - 1, gx1 = Math.ceil((Math.max(l.x1, l.x2) - x0) / CELL) + 1;
    const gy0 = Math.floor((Math.min(l.y1, l.y2) - y0) / CELL) - 1, gy1 = Math.ceil((Math.max(l.y1, l.y2) - y0) / CELL) + 1;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const a = gy * W + gx;
      if (gx < 0 || gy < 0 || gx >= W || gy >= H || side(cx(a), cy(a)) <= 0) continue;
      for (let k = 0; k < 8; k++) {
        const b = go(a, k);
        if (b < 0 || side(cx(b), cy(b)) > 0) continue;
        // does the step cross the line itself (not just the line continued)?
        const ex = cx(b) - cx(a), ey = cy(b) - cy(a), den = ex * dy - ey * dx;
        if (!den) continue;
        const u = ((l.x1 - cx(a)) * ey - (l.y1 - cy(a)) * ex) / den;
        if (u >= 0 && u <= 1) jump.set(a * 8 + k, dest);
      }
    }
  }
  const to = (a, k) => { const j = jump.get(a * 8 + k); return j !== undefined ? j : go(a, k); };

  // ---- everything that can be reached from the start
  const startCell = cellOf(start.x, start.y);
  const reach = new Uint8Array(N), stack = [startCell];
  reach[startCell] = 1;
  const into = Array.from({ length: N }, () => null);     // for each point, the steps that lead onto it: [from, cost]
  while (stack.length) {
    const a = stack.pop();
    for (let k = 0; k < 8; k++) {
      const b = to(a, k);
      if (b < 0) continue;
      (into[b] ||= []).push(a, COST[k]);
      if (!reach[b]) { reach[b] = 1; stack.push(b); }
    }
  }

  // ---- the exit, and the distance to it from everywhere (walking backwards from the exit)
  const exitLine = lines.find((l) => EXIT_SWITCH.has(l.special)) || lines.find((l) => EXIT_LINE.has(l.special));
  if (!exitLine) throw new Error('this level has no exit');
  const mx = (exitLine.x1 + exitLine.x2) / 2, my = (exitLine.y1 + exitLine.y2) / 2, len = Math.hypot(exitLine.x2 - exitLine.x1, exitLine.y2 - exitLine.y1);
  const fx = (exitLine.y2 - exitLine.y1) / len, fy = -(exitLine.x2 - exitLine.x1) / len;       // points to the front of the line
  let exitCell = -1, bestD = Infinity;
  for (let i = 0; i < N; i++) if (reach[i]) { const d = Math.hypot(cx(i) - mx - 24 * fx, cy(i) - my - 24 * fy); if (d < bestD) { bestD = d; exitCell = i; } }
  const spread = (weight) => {
    const dist = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
    // a simple priority queue (binary heap) of [distance, point]
    const heap = [[0, exitCell]]; dist[exitCell] = 0;
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, b] = pop();
      if (d > dist[b]) continue;
      const list = into[b];
      if (!list) continue;
      for (let j = 0; j < list.length; j += 2) {
        const a = list[j];
        if (!reach[a]) continue;
        const nd = Math.fround(d + list[j + 1] * (weight ? weight(a) : 1));
        if (nd < dist[a]) { dist[a] = nd; from[a] = b; push([nd, a]); }
      }
    }
    return { dist, from };
  };
  const { dist } = spread(null);
  // the route drawn on the map (and walked by the test's route follower) keeps away from the walls where it can
  const comfy = spread((a) => 1 + 3 * Math.max(0, 1 - near[a] / 48));
  const route = [];
  for (let c = startCell, guard = 0; c >= 0 && guard < N; c = comfy.from[c], guard++) route.push([cx(c), cy(c)]);
  if (!Number.isFinite(dist[startCell])) throw new Error('the exit cannot be reached from the start');

  // the nearest reachable point to a position (a player pressed against a wall stands between the points)
  const nearest = (x, y) => {
    const c = cellOf(x, y);
    if (c >= 0 && reach[c]) return c;
    let best = -1, bd = Infinity;
    const gx = Math.round((x - x0) / CELL), gy = Math.round((y - y0) / CELL);
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const X = gx + i, Y = gy + j;
      if (X < 0 || Y < 0 || X >= W || Y >= H || !reach[Y * W + X]) continue;
      const d = Math.hypot(x0 + X * CELL - x, y0 + Y * CELL - y);
      if (d < bd) { bd = d; best = Y * W + X; }
    }
    return best;
  };
  // the floor in squares of 64 units, to count how much ground a fly has covered
  const GW = Math.ceil(W / 4), GH = Math.ceil(H / 4), ground = new Uint8Array(GW * GH);
  let groundTotal = 0;
  for (let i = 0; i < N; i++) if (reach[i] && Number.isFinite(dist[i])) { const g = Math.floor(Math.floor(i / W) / 4) * GW + Math.floor((i % W) / 4); if (!ground[g]) { ground[g] = 1; groundTotal++; } }
  const total = dist[startCell];
  let routeLength = 0;
  for (let k = 1; k < route.length; k++) routeLength += Math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1]);

  // the doors the route goes through (a door has two faces; both belong to the same door)
  const doors = [];
  const atDoor = (x, y) => lines.some((l) => { if (!DOOR_MANUAL.has(l.special)) return false; const dx = l.x2 - l.x1, dy = l.y2 - l.y1, t = Math.max(0, Math.min(1, ((x - l.x1) * dx + (y - l.y1) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - l.x1 - t * dx, y - l.y1 - t * dy) < 20; });
  for (let k = 0, inside = -1; k < route.length; k++) {
    const here = atDoor(route[k][0], route[k][1]);
    if (here && inside < 0) inside = k;
    if (!here && inside >= 0) {
      const far = route[Math.min(route.length - 1, k + 2)], c = cellOf(far[0], far[1]);
      doors.push({ x: route[inside][0], y: route[inside][1], way: 1 - dist[c] / total });
      inside = -1;
    }
  }

  return {
    level, W, H, x0, y0, cell: CELL, reach, dist, near, total, route, routeLength,
    exit: { x: mx + 24 * fx, y: my + 24 * fy, line: exitLine, faceDeg: Math.atan2(-fy, -fx) * 180 / Math.PI },
    monsters: placed.monsters.length, items: placed.items.length,
    groundTotal, groundSquares: GW * GH,
    // walking distance from (x, y) to the exit switch, in map units (Infinity if there is no way)
    toExit(x, y) { const c = nearest(x, y); return c < 0 ? Infinity : dist[c]; },
    // how much of the way from the start to the exit lies behind a fly standing at (x, y): 0 ... 1
    way(x, y) { const d = this.toExit(x, y); return Number.isFinite(d) ? Math.max(0, Math.min(1, 1 - d / total)) : 0; },
    // which 64-unit square of floor (x, y) is on, or -1
    square(x, y) { const gx = Math.floor(Math.round((x - x0) / CELL) / 4), gy = Math.floor(Math.round((y - y0) / CELL) / 4); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : gy * GW + gx; },
    // the doors on the way to the exit, in order: [{ x, y, way }], `way` = how far along the way their far side is
    doors,
  };
}

// the level's lines for a small map: [x1, y1, x2, y2, kind] with kind 0 = wall, 1 = step or ledge, 2 = door, 3 = exit switch
export function mapLines(level) {
  const out = [];
  for (const l of level.lines) {
    let kind = 0;
    if (EXIT_SWITCH.has(l.special) || EXIT_LINE.has(l.special)) kind = 3;
    else if (DOOR_MANUAL.has(l.special)) kind = 2;
    else if (l.back >= 0 && l.front >= 0) {
      const a = level.sectors[l.front], b = level.sectors[l.back];
      if (a.floor === b.floor && a.ceil === b.ceil) continue;       // nothing to see between two parts of the same room
      kind = 1;
    }
    out.push([l.x1, l.y1, l.x2, l.y2, kind]);
  }
  return out;
}
