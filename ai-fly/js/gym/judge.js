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
class CylinderGeometry { constructor(rt = 1, rb = 1, h = 1) { this.type = 'CylinderGeometry'; this.parameters = { radiusTop: rt, radiusBottom: rb, height: h }; } }
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
const flat = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
const isBrown = ({ h, s, l }) => h >= 0.02 && h <= 0.12 && s >= 0.35 && l >= 0.15 && l < 0.45;
const isBread = ({ h, s, l }) => h >= 0.06 && h <= 0.16 && s >= 0.3 && l >= 0.55;
const warmGlow = (c) => c.r >= 0.6 && c.r > 1.5 * c.b;
const glows = (c) => Math.max(c.r, c.g, c.b) >= 0.15;

// the space an object takes up (the camera looks along -z, so bigger z = closer to the viewer)
function boxOf(m) {
  const p = m.geometry.parameters, { x, y, z } = m.position;
  let hx, hy, hz;
  if (m.geometry.type === 'CylinderGeometry') { hx = hz = Math.max(p.radiusTop, p.radiusBottom); hy = p.height / 2; }
  else if (m.geometry.type === 'BoxGeometry') { hx = p.width / 2; hy = p.height / 2; hz = p.depth / 2; }
  else { hx = hy = hz = p.radius; }
  return { x0: x - hx, x1: x + hx, y0: y - hy, y1: y + hy, z0: z - hz, z1: z + hz, w: 2 * hx, h: 2 * hy };
}
const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const touches = (A, B, m = 0.05) => ov(A.x0, A.x1, B.x0, B.x1) > m && ov(A.y0, A.y1, B.y0, B.y1) > m && ov(A.z0, A.z1, B.z0, B.z1) > m;
// does B cover a good part of A as seen from the front?
const hides = (B, A) => B.z1 > A.z0 + 0.1 && Math.max(0, ov(A.x0, A.x1, B.x0, B.x1)) * Math.max(0, ov(A.y0, A.y1, B.y0, B.y1)) > 0.25 * A.w * A.h;

export const TESTS = [
  ['light', 'The döner stands in the middle, brightly lit, and nothing hides it'],
  ['colour', 'The meat looks grilled (brown, not glowing)'],
  ['shape', 'A proper döner cone, the biggest thing in the shop'],
  ['spit', 'A vertical spit goes through the meat'],
  ['heat', 'A hot grill panel glows right behind the meat, not touching it'],
  ['bread', 'Bread-sized bread waits below the meat'],
  ['shave', 'A knife shaves the meat'],
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
    const tallOk = M.h >= 1.8 && M.h <= 3.5, baseOk = cyl && mp.radiusBottom >= 0.3, wider = cyl && mp.radiusTop > mp.radiusBottom * 1.2;
    const heightCredit = tallOk ? 1 : Math.max(0, 1 - Math.min(Math.abs(M.h - 1.8), Math.abs(M.h - 3.5)) / 1.5) * 0.7;
    const baseCredit = baseOk ? 1 : cyl ? Math.min(0.7, mp.radiusBottom / 0.3 * 0.7) : 0;
    // a döner's height matters most: it should pay off before the spit and bread are adjusted to it
    part.shape = (cyl ? 0.15 : 0) + (wider ? 0.15 : 0) + 0.35 * heightCredit + 0.15 * baseCredit + (biggest ? 0.2 : 0);
    why.shape = part.shape > 0.99 ? 'A proper döner cone.' : !cyl ? `That is a ${meat.geometry.type === 'BoxGeometry' ? 'box' : 'ball'}, not a döner.` : !wider ? 'The cone is not wider at the top.' : !baseOk ? 'The cone ends in a needle point.' : !tallOk ? 'Wrong height for a döner.' : 'Something else is bigger than the döner.';
    // 4. spit: thin, vertical, through the middle and sticking out at the top
    const rods = w.meshes.filter((m) => m !== meat && m.geometry.type === 'CylinderGeometry');
    const spitScore = (s) => {
      const p = s.geometry.parameters, r = Math.max(p.radiusTop, p.radiusBottom), S = boxOf(s);
      const tall = Math.min(1, p.height / (M.h + 0.4)), thin = r <= 0.1 ? 1 : r <= 0.5 ? 0.4 : 0;
      const centred = flat(s, meat) < 0.2 ? 1 : 0;
      const stickOut = S.y1 - (M.y1 + 0.1);   // how far it sticks out above the meat
      const through = stickOut >= 0 && S.y0 <= M.y0 + 0.2 ? 1 : ov(S.y0, S.y1, M.y0, M.y1) > 0 ? 0.4 + 0.4 * Math.max(0, Math.min(1, 1 + stickOut / 1.5)) : 0;
      return 0.2 * tall + 0.2 * thin + 0.3 * centred * thin + 0.3 * through * thin;
    };
    part.spit = rods.length ? Math.max(...rods.map(spitScore)) : 0;
    why.spit = part.spit > 0.99 ? 'Spit is in place.' : !rods.length ? 'Nothing holds the meat up.' : part.spit < 0.5 ? 'That is not a spit, it is a pillar.' : 'The spit does not go through the meat.';
    // 5. heat: a glowing grill behind the meat, close but not touching, sensibly sized
    const grills = w.meshes.filter((m) => m !== meat && warmGlow(m.material.emissive));
    const heatScore = (g) => {
      const G = boxOf(g), gap = M.z0 - G.z1;
      const behind = gap >= 0.05 ? 1 : 0.7 * Math.max(0, Math.min(1, 1 + (gap - 0.05) / 2));   // a little credit for moving it back part of the way
      const apart = touches(G, M) ? 0 : 1, level = Math.abs(g.position.y - meat.position.y) < 0.8 ? 1 : 0;
      // a panel, not a stick: wide and tall enough, but not bigger than the döner
      const wide = G.w > 3 ? 0.5 : Math.min(1, G.w / 0.8), tall = G.h > 1.6 * M.h ? 0.5 : Math.min(1, G.h / 0.8);
      const near = gap <= 2 ? 1 : 0;
      const side = Math.abs(g.position.x - meat.position.x), aligned = side <= 0.6 ? 1 : 0.7 * Math.max(0, 1 - (side - 0.6) / 2);
      return 0.15 + 0.2 * behind + 0.1 * apart + 0.1 * level + 0.15 * wide + 0.1 * tall + 0.1 * near + 0.1 * aligned;
    };
    part.heat = grills.length ? Math.max(...grills.map(heatScore)) : 0;
    why.heat = part.heat > 0.99 ? 'Hot grill behind the meat, perfect.' : grills.length ? 'The grill is in the wrong place (or the wrong size).' : 'Nothing is cooking the meat.';
    // 6. bread: bread-coloured, bread-sized, right under the meat
    const breads = w.meshes.filter((m) => m !== meat && !shapes.get(m).thin && isBread(m.material.color.hsl()));
    const breadScore = (b) => {
      const B = boxOf(b);
      const below = B.y1 <= M.y0 + 0.15 ? 1 : Math.min(0.8, Math.max(0, (meat.position.y - b.position.y) / (M.h / 2 + B.h / 2)));
      const d = flat(b, meat), under = d <= 0.8 ? 1 : 0.7 * Math.max(0, 1 - (d - 0.8) / 1.5);
      const sized = B.w >= 0.6 && B.w <= 2.6 && B.h <= B.w ? 1 : 0, apart = touches(B, M, 0.2) ? 0 : 1;
      return 0.3 + 0.25 * below + 0.15 * under + 0.15 * sized + 0.15 * apart;
    };
    part.bread = breads.length ? Math.max(...breads.map(breadScore)) : 0;
    why.bread = part.bread > 0.99 ? 'Fresh bread below.' : breads.length ? 'The bread is not under the meat (or not bread-sized).' : 'No bread.';
    // 7. knife
    part.shave = w.knives.length ? (w.knives.includes(meat) ? 1 : 0.5) : 0;
    why.shave = part.shave > 0.99 ? 'Thin slices fall into the bread.' : w.knives.length ? 'The knife cuts the wrong thing.' : 'Nobody cuts the meat.';
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
