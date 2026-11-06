// Runs a fly-written program against a tiny stand-in for three.js (no drawing, so thousands of
// programs can be checked per second) and lets the customer score the resulting döner shop.
// Every test looks only at what the program actually builds and how it moves.

class Color {
  constructor(hex = 0xffffff) {
    this.hex = hex;
    this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255;
  }
  hsl() {
    const { r, g, b } = this;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min, s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
    return { h, s, l };
  }
  get luminance() { return 0.2126 * this.r + 0.7152 * this.g + 0.0722 * this.b; }
}
class Vec3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
class BoxGeometry { constructor(w = 1, h = 1, d = 1) { this.type = 'BoxGeometry'; this.parameters = { width: w, height: h, depth: d }; } }
class CylinderGeometry { constructor(rt = 1, rb = 1, h = 1, n = 32) { this.type = 'CylinderGeometry'; this.parameters = { radiusTop: rt, radiusBottom: rb, height: h, radialSegments: n }; } }
class SphereGeometry { constructor(r = 1) { this.type = 'SphereGeometry'; this.parameters = { radius: r }; } }
class MeshStandardMaterial { constructor(o = {}) { this.color = new Color(o.color ?? 0xffffff); this.emissive = new Color(o.emissive ?? 0); } }
class Mesh { constructor(g, m) { this.isMesh = true; this.geometry = g; this.material = m; this.position = new Vec3(); this.rotation = new Vec3(); } }
class Light { constructor(color = 0xffffff, intensity = 1) { this.isLight = true; this.color = new Color(color); this.intensity = intensity; } }
const MOCK = {
  BoxGeometry, CylinderGeometry, SphereGeometry, MeshStandardMaterial, Mesh,
  // three.js defaults: a directional light shines from straight above, a point light sits at the origin
  DirectionalLight: class extends Light { constructor(c, i) { super(c, i); this.kind = 'directional'; this.position = new Vec3().set(0, 1, 0); } },
  AmbientLight: class extends Light { constructor(c, i) { super(c, i); this.kind = 'ambient'; } },
  PointLight: class extends Light { constructor(c, i) { super(c, i); this.kind = 'point'; this.position = new Vec3(); } },
};

// The shop around every program (the real app uses the same numbers): the top of the counter, and
// how shaved slices fly. The knife cuts the side of the meat that faces the customer, between 10% and
// 80% of its height, a little left or right of the middle; each slice gets a small push away from the
// meat and then drops onto whatever is below it.
export const COUNTER_TOP = -2.1;
export const SLICE = { from: 0.1, to: 0.8, side: 0.35, push: 0.35, gravity: 4 };

// How much light reaches the side of the meat that faces the customer (a simple Lambert estimate):
// ambient light everywhere, other lights only if they shine onto that side and are not inside the meat.
function frontLight(lights, meat, M) {
  const p = meat.geometry.parameters;
  let n = [0, 0, 1];
  if (meat.geometry.type === 'CylinderGeometry') {
    const s = (p.radiusBottom - p.radiusTop) / p.height;   // a cone wider at the top faces slightly down
    const len = Math.hypot(s, 1);
    n = [0, s / len, 1 / len];
  }
  let total = 0;
  for (const l of lights) {
    let k = 1;
    if (l.kind !== 'ambient') {
      const lp = l.position;
      const inside = lp.x > M.x0 && lp.x < M.x1 && lp.y > M.y0 && lp.y < M.y1 && lp.z > M.z0 && lp.z < M.z1;
      const d = l.kind === 'directional' ? [lp.x, lp.y, lp.z] : [lp.x - meat.position.x, lp.y - meat.position.y, lp.z - meat.position.z];
      const dl = Math.hypot(...d) || 1;
      k = inside ? 0 : Math.max(0, (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / dl);
    }
    total += l.intensity * l.color.luminance * k;
  }
  return total;
}

export function runProgram(code) {
  const scene = { children: [], add(o) { if (!this.children.includes(o)) this.children.push(o); return this; } };
  const knives = [];
  let spin;
  try {
    const fn = new Function('THREE', 'scene', 'knife', `"use strict";\nlet spin = () => {};\n${code}\nreturn spin;`);
    spin = fn(MOCK, scene, (m) => knives.push(m));
  } catch (err) {
    return { error: String(err.message || err) };
  }
  const meshes = scene.children.filter((o) => o.isMesh);
  const before = meshes.map((m) => ({ ...m.rotation }));
  try { for (let i = 0; i < 10; i++) spin(0.1); } catch (err) { return { error: String(err.message || err) }; }
  const turn = meshes.map((m, i) => ({ x: m.rotation.x - before[i].x, y: m.rotation.y - before[i].y, z: m.rotation.z - before[i].z }));   // per second
  return { scene, meshes, lights: scene.children.filter((o) => o.isLight), knives, turn };
}

function shapeOf(m) {
  const p = m.geometry.parameters;
  switch (m.geometry.type) {
    case 'CylinderGeometry': return { halfH: p.height / 2, rad: Math.max(p.radiusTop, p.radiusBottom), vol: Math.PI * p.height * (p.radiusTop ** 2 + p.radiusTop * p.radiusBottom + p.radiusBottom ** 2) / 3, thin: Math.max(p.radiusTop, p.radiusBottom) <= 0.1 };
    case 'BoxGeometry': return { halfH: p.height / 2, rad: Math.max(p.width, p.depth) / 2, vol: p.width * p.height * p.depth, thin: Math.min(p.width, p.height, p.depth) < 0.15 };
    default: return { halfH: p.radius, rad: p.radius, vol: (4 / 3) * Math.PI * p.radius ** 3, thin: p.radius < 0.1 };
  }
}
// a dürüm is a round flatbread; a Fladenbrot (pide) piece is a triangle
const breadKind = (b) => b.geometry.type !== 'CylinderGeometry' ? null : b.geometry.parameters.radialSegments >= 8 ? 'dürüm' : b.geometry.parameters.radialSegments === 3 ? 'Fladenbrot' : null;
const flat = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
const isBrown = ({ h, s, l }) => h >= 0.02 && h <= 0.12 && s >= 0.35 && l >= 0.15 && l < 0.45;
const isBread = ({ h, s, l }) => h >= 0.06 && h <= 0.16 && s >= 0.3 && l >= 0.55;
const warmGlow = (c) => c.r >= 0.6 && c.r > 1.5 * c.b;
const glows = (c) => Math.max(c.r, c.g, c.b) >= 0.15;
// a grill is a panel or a heating rod, not a ball (a glowing ball looks like a light bulb), and dark
// enough to glow orange instead of pale like a lamp
const notBall = (g) => (g.geometry.type === 'SphereGeometry' ? 0 : 1);
const looksHot = (g) => (g.material.color.luminance <= 0.5 ? 1 : 0);

// the space an object takes up (the camera looks along -z, so bigger z = closer to the viewer)
function boxOf(m) {
  const p = m.geometry.parameters, { x, y, z } = m.position;
  let hx, hy, hz;
  if (m.geometry.type === 'CylinderGeometry') { hx = hz = Math.max(p.radiusTop, p.radiusBottom); hy = p.height / 2; }
  else if (m.geometry.type === 'BoxGeometry') { hx = p.width / 2; hy = p.height / 2; hz = p.depth / 2; }
  else { hx = hy = hz = p.radius; }
  return { x0: x - hx, x1: x + hx, y0: y - hy, y1: y + hy, z0: z - hz, z1: z + hz, w: 2 * hx, h: 2 * hy };
}
// how far the meat reaches towards the customer at a height (0 = bottom, 1 = top)
function radiusAt(m, f) {
  const p = m.geometry.parameters;
  if (m.geometry.type === 'CylinderGeometry') return p.radiusBottom + (p.radiusTop - p.radiusBottom) * f;
  if (m.geometry.type === 'SphereGeometry') return p.radius * Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2));
  return p.depth / 2;
}
// where shaved slices start and which way they fly (a few fixed samples of what the app does at random)
function sliceSamples(meat) {
  const M = boxOf(meat), { x, z } = meat.position, out = [];
  for (const f of [0.15, 0.35, 0.55, 0.75]) {
    const r = radiusAt(meat, f), y = M.y0 + f * M.h;
    for (const s of [-1, 0, 1]) {
      if (meat.geometry.type === 'BoxGeometry') { out.push({ x: x + s * SLICE.side * meat.geometry.parameters.width / 2, y, z: z + r + 0.04, vx: 0, vz: SLICE.push }); continue; }
      const a = s * SLICE.side * r, c = Math.sqrt(Math.max(0, r * r - a * a));
      out.push({ x: x + a, y, z: z + c + 0.04, vx: r ? SLICE.push * a / r : 0, vz: r ? SLICE.push * c / r : SLICE.push });
    }
  }
  return out;
}
// the top of a piece of bread seen from above, as a list of corners (a round one has 32)
function topOutline(b, turning) {
  const p = b.geometry.parameters, { x, z } = b.position;
  if (b.geometry.type === 'BoxGeometry') return [[x - p.width / 2, z - p.depth / 2], [x + p.width / 2, z - p.depth / 2], [x + p.width / 2, z + p.depth / 2], [x - p.width / 2, z + p.depth / 2]];
  const cyl = b.geometry.type === 'CylinderGeometry';
  let r = cyl ? p.radiusTop : p.radius * 0.7, n = cyl ? p.radialSegments : 32;
  if (turning) { r *= Math.cos(Math.PI / n); n = 32; }   // a turning bread only reliably covers its inner circle
  // three.js puts the first corner straight towards the customer (+z)
  return Array.from({ length: n }, (_, i) => [x + r * Math.sin((2 * Math.PI * i) / n), z + r * Math.cos((2 * Math.PI * i) / n)]);
}
function inside([px, pz], poly) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}
// how many of the shaved slices land on this bread (0..1)
function landsOn(meat, bread, turning) {
  const top = boxOf(bread).y1, poly = topOutline(bread, turning), samples = sliceSamples(meat);
  let hits = 0;
  for (const s of samples) {
    const drop = s.y - top;
    if (drop <= 0) continue;
    const t = Math.sqrt((2 * drop) / SLICE.gravity);
    if (inside([s.x + s.vx * t, s.z + s.vz * t], poly)) hits++;
  }
  return hits / samples.length;
}

const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const touches = (A, B, m = 0.05) => ov(A.x0, A.x1, B.x0, B.x1) > m && ov(A.y0, A.y1, B.y0, B.y1) > m && ov(A.z0, A.z1, B.z0, B.z1) > m;
// does B cover a good part of A as seen from the front?
const hides = (B, A) => B.z1 > A.z0 + 0.1 && Math.max(0, ov(A.x0, A.x1, B.x0, B.x1)) * Math.max(0, ov(A.y0, A.y1, B.y0, B.y1)) > 0.25 * A.w * A.h;

export const TESTS = [
  ['light', 'The döner stands in the middle, brightly lit, and nothing hides it'],
  ['colour', 'The meat looks grilled (brown, not glowing)'],
  ['shape', 'A proper döner cone: round, taller than wide, the biggest thing in the shop'],
  ['spit', 'A vertical spit goes through the meat'],
  ['heat', 'A hot grill glows orange right behind the meat, not touching it'],
  ['bread', 'A dürüm or a Fladenbrot lies on the counter, right where the meat falls'],
  ['shave', 'A knife shaves the meat, and only the meat'],
  ['spin', 'The meat turns slowly around the vertical axis'],
];

// Returns { score (0-8, with partial credit), passed (0-8), res: test -> bool, part: test -> 0..1, why }
export function judge(code) {
  const w = runProgram(code);
  const part = Object.fromEntries(TESTS.map(([k]) => [k, 0]));
  const why = {};
  if (w.error) return { score: 0, passed: 0, res: {}, part, why: { error: w.error }, error: w.error };
  const shapes = new Map(w.meshes.map((m) => [m, shapeOf(m)]));
  // the customer calls the biggest solid thing on the counter "the meat", unless it is glowing
  // (that's a grill) or bread-coloured (that's bread)
  const solid = w.meshes.filter((m) => !shapes.get(m).thin).sort((a, b) => shapes.get(b).vol - shapes.get(a).vol);
  // (if everything is bread-coloured or glowing, there is simply no meat)
  const meat = solid.find((m) => !warmGlow(m.material.emissive) && !isBread(m.material.color.hsl()));

  // light that actually falls on the front of the döner (without a döner: all light counts)
  const lightTotal = meat ? frontLight(w.lights, meat, boxOf(meat)) : w.lights.reduce((a, l) => a + l.intensity * l.color.luminance, 0);
  const lightWarm = w.lights.length > 0 && w.lights.every((l) => l.color.r >= l.color.b);
  const lightPart = Math.min(1, lightTotal / 1.5) * (lightWarm ? 1 : 0.5);
  const lightWhy = !w.lights.length ? 'Pitch dark.' : lightTotal < 1.5 ? 'The front of the döner is in the dark.' : !lightWarm ? 'Cold, blue light.' : 'Nicely lit.';
  const brightLight = w.lights.some((l) => l.color.luminance >= 0.6 && l.intensity >= 1);
  if (!meat) {
    part.light = 0.4 * lightPart;
    why.light = lightWhy;
    why.colour = why.shape = why.spit = why.heat = why.bread = why.shave = why.spin = solid.length ? 'Where is the meat? All I see is bread and fire.' : 'There is nothing on the counter.';
  } else {
    const ms = shapes.get(meat), mc = meat.material.color.hsl(), mp = meat.geometry.parameters, M = boxOf(meat);
    // 1. light, and nothing big in front of (or inside) the döner
    const hider = w.meshes.find((m) => m !== meat && !shapes.get(m).thin && hides(boxOf(m), M));
    // the döner should stand in the middle of the shop, where the customer looks
    const { x: mx, y: my, z: mz } = meat.position;
    const off = Math.max(0, Math.abs(mx) - 1) + Math.max(0, -0.5 - my, my - 1.5) + Math.max(0, Math.abs(mz) - 1);
    const centred = off === 0 ? 1 : 0.7 * Math.max(0, 1 - off / 2);
    part.light = 0.4 * lightPart * (brightLight ? 1 : 0.6) + (hider ? 0 : 0.3) + 0.3 * centred;
    why.light = hider ? 'Something big is hiding the döner.' : centred < 1 ? 'The döner is not in the middle of the shop.' : lightPart < 1 ? lightWhy : !brightLight ? 'Too gloomy in here.' : lightWhy;
    // 2. colour: brown, and meat does not glow
    const meatGlows = glows(meat.material.emissive);
    part.colour = (mc.h >= 0.02 && mc.h <= 0.12 ? 0.4 : 0) + (mc.s >= 0.35 ? 0.2 : 0) + (mc.l >= 0.15 && mc.l < 0.45 ? 0.15 : 0) + (meatGlows ? 0 : 0.25);
    why.colour = !isBrown(mc) ? `The meat is ${meat.material.color.hex === 0xff5500 ? 'orange' : 'the wrong colour'}.` : meatGlows ? 'Glowing meat? No thanks.' : 'Grilled to perfection.';
    // 3. shape: a döner cone with sensible proportions, and the biggest thing in the shop
    const cyl = meat.geometry.type === 'CylinderGeometry';
    const biggest = w.meshes.every((m) => m === meat || shapes.get(m).vol <= ms.vol);
    const round = cyl && mp.radialSegments >= 8;
    const tallOk = M.h >= 1.8 && M.h <= 3.5, baseOk = cyl && mp.radiusBottom >= 0.3, wider = cyl && mp.radiusTop > mp.radiusBottom * 1.2;
    // (gradual: an upside-down cone earns a little for every step towards a wider top)
    const widerCredit = !cyl ? 0 : wider ? 1 : 0.8 * Math.min(1, Math.max(0, (mp.radiusTop / Math.max(mp.radiusBottom, 0.01) - 0.6) / 0.6));
    const heightCredit = tallOk ? 1 : Math.max(0, 1 - Math.min(Math.abs(M.h - 1.8), Math.abs(M.h - 3.5)) / 1.5) * 0.7;
    const baseCredit = baseOk ? 1 : cyl ? Math.min(0.7, mp.radiusBottom / 0.3 * 0.7) : 0;
    // a döner is at least as tall as it is wide (not a lampshade), but not a pole either
    // (partial credit also counts a narrower bottom, so a too-wide cone can slim down one step at a time)
    const slim = M.h / M.w, slimOk = slim >= 1 && slim <= 2.5;
    const softSlim = cyl ? M.h / (1.5 * mp.radiusTop + 0.5 * mp.radiusBottom) : slim;
    const slimCredit = slimOk ? 1 : 0.8 * Math.min(1, softSlim, 2.5 / slim);
    // a döner's height matters most: it should pay off before the spit and bread are adjusted to it
    part.shape = (cyl ? (round ? 0.15 : 0.05) : 0) + 0.1 * widerCredit + 0.25 * heightCredit + 0.2 * slimCredit + 0.1 * baseCredit + (biggest ? 0.2 : 0);
    why.shape = part.shape > 0.99 ? 'A proper döner cone.' : !cyl ? `That is a ${meat.geometry.type === 'BoxGeometry' ? 'box' : 'ball'}, not a döner.` : !round ? 'A döner is round, not pointy.' : !wider ? 'The cone is not wider at the top.' : !baseOk ? 'The cone ends in a needle point.' : !tallOk ? 'Wrong height for a döner.' : !slimOk ? (slim < 1 ? 'Too wide: that is a lampshade, not a döner.' : 'Too skinny: that is a pole, not a döner.') : 'Something else is bigger than the döner.';
    // 4. spit: thin, vertical, through the middle and sticking out at the top
    const rods = w.meshes.filter((m) => m !== meat && m.geometry.type === 'CylinderGeometry');
    // each end of the rod counts on its own, so making one end thinner already helps
    const thinEnd = (r) => (r <= 0.1 ? 1 : r <= 0.2 ? 0.75 : r <= 0.3 ? 0.6 : r <= 0.5 ? 0.45 : r <= 1 ? 0.2 : 0);
    const spitParts = (s) => {
      const p = s.geometry.parameters, S = boxOf(s);
      const tall = Math.min(1, p.height / (M.h + 0.4)), thin = (thinEnd(p.radiusTop) + thinEnd(p.radiusBottom)) / 2;
      const centred = flat(s, meat) < 0.2 ? 1 : 0;
      const stickOut = S.y1 - (M.y1 + 0.1);   // how far it sticks out above the meat
      const through = stickOut >= 0 && S.y0 <= M.y0 + 0.2 ? 1 : ov(S.y0, S.y1, M.y0, M.y1) > 0 ? 0.4 + 0.4 * Math.max(0, Math.min(1, 1 + stickOut / 1.5)) : 0;
      const plain = glows(s.material.emissive) ? 0 : 1;   // a spit is plain metal, it does not glow
      return { tall, thin, centred, through, plain, score: 0.15 * tall + 0.15 * thin + 0.25 * centred * thin + 0.3 * through * thin + 0.15 * plain };
    };
    // 5. heat: a glowing grill behind the meat, close but not touching, sensibly sized
    // (something as thin as a spit is no grill: one glowing rod cannot be the spit and the grill at once)
    const grills = w.meshes.filter((m) => m !== meat && !shapes.get(m).thin && warmGlow(m.material.emissive));
    const heatParts = (g) => {
      const G = boxOf(g), gap = M.z0 - G.z1;
      const behind = gap >= 0.05 ? 1 : 0.8 * Math.max(0, Math.min(1, 1 + (gap - 0.05) / 1.2));   // credit for every step back
      const dy = Math.abs(g.position.y - meat.position.y);
      const apart = touches(G, M) ? 0 : 1, level = dy < 0.8 ? 1 : 0.7 * Math.max(0, 1 - (dy - 0.8) / 2);
      // wide and tall enough to heat the meat, but not bigger than the döner
      const wide = G.w > 3 ? 0.5 : Math.min(1, G.w / 0.8), tall = G.h > 1.6 * M.h ? 0.5 : Math.min(1, G.h / 0.8);
      const near = gap <= 2 ? 1 : 0.7 * Math.max(0, 1 - (gap - 2) / 2);
      const side = Math.abs(g.position.x - meat.position.x), aligned = side <= 0.6 ? 1 : 0.7 * Math.max(0, 1 - (side - 0.6) / 2);
      const ball = notBall(g), hot = looksHot(g);
      return { behind, apart, level, wide, tall, near, aligned, ball, hot, score: 0.05 + 0.25 * behind + 0.1 * apart + 0.05 * level + 0.1 * wide + 0.1 * tall + 0.05 * near + 0.1 * aligned + 0.1 * ball + 0.1 * hot };
    };
    // every object has one job: the spit and the grill are picked together, so one glowing rod in the
    // middle of the meat cannot collect credit as both
    let spit = null, heat = null, spitObj = null, grillObj = null, bestSum = -1;
    for (const s of [null, ...rods]) {
      const sp = s && spitParts(s);
      for (const g of [null, ...grills]) {
        if (s && s === g) continue;
        const hp = g && heatParts(g), sum = (sp ? sp.score : 0) + (hp ? hp.score : 0);
        if (sum > bestSum + 1e-9) { bestSum = sum; spit = sp; heat = hp; spitObj = s; grillObj = g; }
      }
    }
    part.spit = spit ? spit.score : 0;
    why.spit = part.spit > 0.99 ? 'Spit is in place.' : !spit ? 'Nothing holds the meat up.' : spit.thin < 1 ? 'That is not a spit, it is a pillar.'
      : spit.tall < 1 ? 'The spit is too short.' : spit.centred < 1 ? 'The spit misses the middle of the meat.' : spit.through < 1 ? 'The spit does not go through the meat.' : 'A glowing spit? It should be plain metal.';
    part.heat = heat ? heat.score : 0;
    why.heat = part.heat > 0.99 ? 'Hot grill behind the meat, perfect.' : !heat ? 'Nothing is cooking the meat.'
      : !heat.ball ? 'A glowing ball? That is a light bulb, not a grill.' : !heat.hot ? 'The grill glows pale, like a lamp.'
        : heat.behind < 1 ? 'The grill is not behind the meat.' : !heat.apart ? 'The grill touches the meat.' : heat.wide < 1 || heat.tall < 1 ? 'The grill is too small (or too big).'
          : heat.near < 1 ? 'The grill is too far away.' : heat.level < 1 ? 'The grill is too high or too low.' : 'The grill is off to the side.';
    // 6. bread: a flat round dürüm or a triangle of Fladenbrot, lying on the counter where the slices fall
    // (bread lies flat and does not glow: one wheat-coloured thing cannot be the grill or the spit and the
    // bread at once)
    const breads = w.meshes.filter((m) => m !== meat && m !== spitObj && m !== grillObj && !shapes.get(m).thin && isBread(m.material.color.hsl()) && !glows(m.material.emissive) && boxOf(m).h <= boxOf(m).w);
    const breadParts = (b) => {
      const B = boxOf(b), t = w.turn[w.meshes.indexOf(b)];
      const kind = breadKind(b) ? 1 : b.geometry.type === 'CylinderGeometry' ? 0.3 : 0;
      const flatOk = B.h <= 0.25 ? 1 : B.h <= 0.6 ? 0.4 : 0;
      const sized = B.w < 1 ? 0.5 * B.w : B.w <= 3.5 ? 1 : 0.6 * Math.max(0, 1 - (B.w - 3.5) / 4);
      const below = B.y1 <= M.y0 + 0.15 ? 1 : Math.min(0.8, Math.max(0, (meat.position.y - b.position.y) / (M.h / 2 + B.h / 2)));
      const lift = Math.abs(B.y0 - COUNTER_TOP), onCounter = lift <= 0.12 ? 1 : 0.6 * Math.max(0, 1 - lift / 2);
      const apart = touches(B, M, 0.2) ? 0 : 1;
      const catches = Math.min(1, landsOn(meat, b, Math.abs(t.x) + Math.abs(t.y) + Math.abs(t.z) > 0.01) / 0.9);
      return { kind, flatOk, sized, below, onCounter, apart, catches, score: 0.1 + 0.2 * kind + 0.1 * flatOk + 0.1 * sized + 0.1 * below + 0.1 * onCounter + 0.05 * apart + 0.25 * catches };
    };
    const scored = breads.map((b) => [b, breadParts(b)]).sort((a, b) => b[1].score - a[1].score);
    const [bread, bp] = scored[0] || [null, null];
    part.bread = bread ? bp.score : 0;
    why.bread = part.bread > 0.99 ? `A fresh ${breadKind(bread)}, and the meat lands right on it.` : !bread ? 'No bread.'
      : bp.kind < 1 ? (bread.geometry.type === 'CylinderGeometry' ? 'Odd-shaped bread? I want a round dürüm or a Fladenbrot triangle.' : 'A loaf? I want a dürüm or a Fladenbrot.')
        : bp.flatOk < 1 ? 'The bread is too thick.' : bp.sized < 1 ? 'The bread is the wrong size.' : bp.onCounter < 1 ? 'The bread floats in the air.'
          : bp.below < 1 || bp.apart < 1 ? 'The bread is not under the meat.' : 'The meat falls next to the bread.';
    // 7. knife
    const onMeat = w.knives.includes(meat), otherCuts = w.knives.some((k) => k !== meat);
    part.shave = onMeat ? (otherCuts ? 0.6 : 1) : w.knives.length ? 0.3 : 0;
    why.shave = part.shave > 0.99 ? 'Thin slices of meat, and only meat.' : onMeat ? 'The knife also shaves things that are not meat.' : w.knives.length ? 'The knife cuts the wrong thing.' : 'Nobody cuts the meat.';
    // 8. rotation
    const ti = w.meshes.indexOf(meat), t = w.turn[ti];
    const any = w.turn.some((r) => Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z) > 0.01);
    const meatTurns = Math.abs(t.x) + Math.abs(t.y) + Math.abs(t.z) > 0.01;
    const aroundY = meatTurns && Math.abs(t.x) < 0.01 && Math.abs(t.z) < 0.01;
    const speedOk = aroundY && Math.abs(t.y) >= 0.2 && Math.abs(t.y) <= 3;
    part.spin = (any ? 0.3 : 0) + (meatTurns ? 0.3 : 0) + (aroundY ? 0.2 : 0) + (speedOk ? 0.2 : 0);
    why.spin = speedOk ? 'Turning nice and slow.' : !any ? 'Nothing turns.' : !meatTurns ? 'Something turns, but not the meat.' : !aroundY ? 'The meat is doing somersaults.' : 'Way too fast (or too slow).';
  }
  const res = Object.fromEntries(TESTS.map(([k]) => [k, part[k] > 0.99]));
  const score = TESTS.reduce((a, [k]) => a + part[k], 0);
  return { score, passed: Object.values(res).filter(Boolean).length, res, part, why, meat, world: w };
}
