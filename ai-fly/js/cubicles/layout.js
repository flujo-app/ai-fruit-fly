// Where everything is in the Cubicles office (metres; y is up, the supervisor deck is at +z and the
// cubicles stretch towards -z). Also: which spots you can walk on, and the shortest way between two
// spots (for the path on the floor).

export const CUB = 1.5;          // one cubicle is 1.5 x 1.5 m
export const COLS = 16, ROWS = 8; // 128 cubicles per team (one team per lab)
export const AISLE = 1.5, CROSS = 1.5, CORRIDOR = 3;
export const TEAM_W = COLS * CUB + CROSS;          // 25.5 m
export const TEAM_D = 4 * 2 * CUB + 5 * AISLE;     // 19.5 m: 4 back-to-back rows of cubicles, 5 aisles
export const OFFICE = { x0: -57, x1: 57, z0: -46, z1: 12 };
export const DECK = { x0: -12, x1: 12, z0: 2, z1: 11.5, y: 0.8 };
export const RAMP = { x0: -2, x1: 2, z0: 0, z1: 2 };
export const SCREEN = { x: 0, y: 4.75, z: 11.85, w: 8.0, h: 4.5 };
export const CONSOLE = { x: 0, z: 9.1, w: 4.4, d: 1.0 };
export const MGMT = { x0: 36, x1: 52, z0: 2.5, z1: 11.5, door: [42.5, 45] };
export const START = { x: 0, z: 5.6, yaw: Math.PI };   // yaw PI = looking towards +z (the big screen)

const TEAMS_X0 = -(4 * TEAM_W + 3 * CORRIDOR) / 2;
const TEAMS_Z1 = -1;

// north-west corner of a lab's team area. Labs 1-4 sit in the front row, near the deck.
export function teamOrigin(lab) {
  const tc = lab % 4, front = lab < 4;
  return { x: TEAMS_X0 + tc * (TEAM_W + CORRIDOR), z: TEAMS_Z1 - TEAM_D - (front ? 0 : TEAM_D + CORRIDOR) };
}

// one cubicle: its centre, which way its opening faces (+1 = towards +z), and the aisle spot in front
export function cubicle(lab, f) {
  const o = teamOrigin(lab);
  const r = f >> 4, c = f & 15, pair = r >> 1;
  const z = o.z + AISLE + pair * (2 * CUB + AISLE) + (r & 1) * CUB + CUB / 2;
  const x = o.x + c * CUB + (c >= 8 ? CROSS : 0) + CUB / 2;
  const dir = r & 1 ? 1 : -1;
  return { x, z, dir, rot: dir > 0 ? 0 : Math.PI, door: { x, z: z + dir * (CUB / 2 + AISLE / 2) } };
}

export function floorHeight(x, z) {
  if (x >= DECK.x0 && x <= DECK.x1 && z >= DECK.z0 && z <= DECK.z1) return DECK.y;
  if (x >= RAMP.x0 && x <= RAMP.x1 && z >= RAMP.z0 && z < RAMP.z1) return DECK.y * (z - RAMP.z0) / (RAMP.z1 - RAMP.z0);
  return 0;
}

// ---------------------------------------------------------------- walkable cells
export const CELL = 0.25;
const GW = Math.round((OFFICE.x1 - OFFICE.x0) / CELL), GH = Math.round((OFFICE.z1 - OFFICE.z0) / CELL);

export function buildGrid(labs, perLab) {
  const g = new Uint8Array(GW * GH);   // 1 = blocked
  const block = (x0, z0, x1, z1) => {
    const i0 = Math.max(0, Math.floor((x0 - OFFICE.x0) / CELL)), i1 = Math.min(GW - 1, Math.ceil((x1 - OFFICE.x0) / CELL) - 1);
    const j0 = Math.max(0, Math.floor((z0 - OFFICE.z0) / CELL)), j1 = Math.min(GH - 1, Math.ceil((z1 - OFFICE.z0) / CELL) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * GW + i] = 1;
  };
  // outer walls
  block(OFFICE.x0, OFFICE.z0, OFFICE.x1, OFFICE.z0 + 0.3); block(OFFICE.x0, OFFICE.z1 - 0.3, OFFICE.x1, OFFICE.z1);
  block(OFFICE.x0, OFFICE.z0, OFFICE.x0 + 0.3, OFFICE.z1); block(OFFICE.x1 - 0.3, OFFICE.z0, OFFICE.x1, OFFICE.z1);
  // cubicles
  for (let lab = 0; lab < labs; lab++) for (let f = 0; f < perLab; f++) {
    const c = cubicle(lab, f);
    block(c.x - CUB / 2, c.z - CUB / 2, c.x + CUB / 2, c.z + CUB / 2);
  }
  // the deck's edges (you get up and down by the ramp), the console and the screen wall
  block(DECK.x0, DECK.z0 - 0.25, RAMP.x0, DECK.z0); block(RAMP.x1, DECK.z0 - 0.25, DECK.x1, DECK.z0);
  block(DECK.x0 - 0.25, DECK.z0 - 0.25, DECK.x0, DECK.z1); block(DECK.x1, DECK.z0 - 0.25, DECK.x1 + 0.25, DECK.z1);
  block(CONSOLE.x - CONSOLE.w / 2, CONSOLE.z - CONSOLE.d / 2, CONSOLE.x + CONSOLE.w / 2, CONSOLE.z + CONSOLE.d / 2);
  // the management office: glass walls with a door, and the big desk
  block(MGMT.x0, MGMT.z0, MGMT.x0 + 0.2, MGMT.z1); block(MGMT.x1 - 0.2, MGMT.z0, MGMT.x1, MGMT.z1);
  block(MGMT.x0, MGMT.z0, MGMT.door[0], MGMT.z0 + 0.2); block(MGMT.door[1], MGMT.z0, MGMT.x1, MGMT.z0 + 0.2);
  block(MGMT.x0 + 4, 8.2, MGMT.x1 - 4, 9.4);
  return g;
}

export function blocked(grid, x, z) {
  const i = Math.floor((x - OFFICE.x0) / CELL), j = Math.floor((z - OFFICE.z0) / CELL);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return true;
  return grid[j * GW + i] === 1;
}

// is a round body of this radius free at (x, z)?
export function free(grid, x, z, r = 0.3) {
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
    if (blocked(grid, x + dx, z + dz)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- shortest walk (A* on 0.5 m cells)
const S = 2;   // coarse cell = 2 x 2 fine cells
const CW = Math.floor(GW / S), CH = Math.floor(GH / S);
let coarse = null, coarseOf = null;
function coarseGrid(grid) {
  if (coarseOf === grid) return coarse;
  coarse = new Uint8Array(CW * CH);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
    let b = 0;
    for (let dj = 0; dj < S; dj++) for (let di = 0; di < S; di++) b |= grid[(j * S + dj) * GW + i * S + di];
    coarse[j * CW + i] = b;
  }
  coarseOf = grid;
  return coarse;
}

// distance (in coarse cells) from every walkable spot to the target: computed once, then the way
// from anywhere is just "always step downhill"
export function makeField(grid, to) {
  const g = coarseGrid(grid), CS = CELL * S;
  const t = nearestFree(g, cellOf(to, CS));
  const dist = new Float32Array(CW * CH).fill(Infinity), queue = new Int32Array(CW * CH);
  let head = 0, tail = 0;
  const s0 = t[1] * CW + t[0];
  dist[s0] = 0; queue[tail++] = s0;
  while (head < tail) {
    const n = queue[head++], i = n % CW, j = (n / CW) | 0, d = dist[n] + 1;
    if (i > 0 && !g[n - 1] && dist[n - 1] > d) { dist[n - 1] = d; queue[tail++] = n - 1; }
    if (i < CW - 1 && !g[n + 1] && dist[n + 1] > d) { dist[n + 1] = d; queue[tail++] = n + 1; }
    if (j > 0 && !g[n - CW] && dist[n - CW] > d) { dist[n - CW] = d; queue[tail++] = n - CW; }
    if (j < CH - 1 && !g[n + CW] && dist[n + CW] > d) { dist[n + CW] = d; queue[tail++] = n + CW; }
  }
  return { dist, to };
}

const cellOf = (p, CS) => [Math.min(CW - 1, Math.max(0, Math.floor((p.x - OFFICE.x0) / CS))), Math.min(CH - 1, Math.max(0, Math.floor((p.z - OFFICE.z0) / CS)))];
function nearestFree(g, [i, j]) {
  if (!g[j * CW + i]) return [i, j];
  for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < CW && b < CH && !g[b * CW + a]) return [a, b];
  }
  return [i, j];
}

export function pathFrom(grid, field, from) {
  const g = coarseGrid(grid), CS = CELL * S, { dist, to } = field;
  let [i, j] = nearestFree(g, cellOf(from, CS));
  const pts = [{ x: from.x, z: from.z }];
  for (let guard = 0; guard < CW * CH && dist[j * CW + i] > 0 && dist[j * CW + i] < Infinity; guard++) {
    let best = j * CW + i;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < CW && b < CH && dist[b * CW + a] < dist[best]) best = b * CW + a;
    }
    if (best === j * CW + i) break;
    i = best % CW; j = (best / CW) | 0;
    pts.push({ x: OFFICE.x0 + (i + 0.5) * CS, z: OFFICE.z0 + (j + 0.5) * CS });
  }
  pts.push({ x: to.x, z: to.z });
  // pull the string tight: keep only the corners you cannot see past
  const clear = (a, b) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.2);
    for (let k = 1; k < n; k++) if (blocked(grid, a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n)) return false;
    return true;
  };
  const out = [pts[0]];
  let k = 0;
  while (k < pts.length - 1) {
    let far = k + 1;
    for (let m = Math.min(pts.length - 1, k + 400); m > k + 1; m--) if (clear(pts[k], pts[m])) { far = m; break; }
    out.push(pts[far]);
    k = far;
  }
  return out;
}

export function findPath(grid, from, to) { return pathFrom(grid, makeField(grid, to), from); }
