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
  DirectionalLight: class extends Light {}, AmbientLight: class extends Light {}, PointLight: class extends Light {},
};

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

export const TESTS = [
  ['light', 'The shop is lit with warm light'],
  ['colour', 'The meat looks grilled (brown)'],
  ['shape', 'It is shaped like a döner (wider at the top)'],
  ['spit', 'A vertical spit goes through the meat'],
  ['heat', 'A hot grill glows beside the meat'],
  ['bread', 'Bread waits below the meat'],
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
  const meat = solid.find((m) => !warmGlow(m.material.emissive) && !isBread(m.material.color.hsl())) || solid[0];

  // 1. light
  {
    const total = w.lights.reduce((a, l) => a + l.intensity * l.color.luminance, 0);
    const warm = w.lights.length > 0 && w.lights.every((l) => l.color.r >= l.color.b);
    part.light = Math.min(1, total / 1.5) * (warm ? 1 : 0.5);
    why.light = !w.lights.length ? 'Pitch dark.' : total < 1.5 ? 'Too dark.' : !warm ? 'Cold, blue light.' : 'Nicely lit.';
  }
  if (!meat) {
    why.colour = why.shape = why.spit = why.heat = why.bread = why.shave = why.spin = 'There is nothing on the counter.';
  } else {
    const ms = shapes.get(meat), mc = meat.material.color.hsl(), mp = meat.geometry.parameters;
    // 2. colour
    part.colour = (mc.h >= 0.02 && mc.h <= 0.12 ? 0.5 : 0) + (mc.s >= 0.35 ? 0.25 : 0) + (mc.l >= 0.15 && mc.l < 0.45 ? 0.25 : 0);
    why.colour = isBrown(mc) ? 'Grilled to perfection.' : `The meat is ${meat.material.color.hex === 0xff5500 ? 'orange' : 'the wrong colour'}.`;
    // 3. shape
    const cyl = meat.geometry.type === 'CylinderGeometry';
    part.shape = (cyl ? 0.4 : 0) + (cyl && mp.radiusTop > mp.radiusBottom * 1.2 ? 0.3 : 0) + (ms.halfH * 2 >= 1.8 ? 0.3 : 0);
    why.shape = part.shape > 0.99 ? 'A proper döner cone.' : !cyl ? `That is a ${meat.geometry.type === 'BoxGeometry' ? 'box' : 'ball'}, not a döner.` : mp.radiusTop <= mp.radiusBottom * 1.2 ? 'The cone is not wider at the top.' : 'Too short for a döner.';
    // 4. spit
    // any other cylinder could be a spit: the customer rates how tall, thin and well placed it is
    const rods = w.meshes.filter((m) => m !== meat && m.geometry.type === 'CylinderGeometry');
    const spitScore = (s) => {
      const p = s.geometry.parameters, r = Math.max(p.radiusTop, p.radiusBottom);
      const tall = Math.min(1, p.height / 2.5), thin = r <= 0.1 ? 1 : r <= 0.5 ? 0.4 : 0;
      const centred = flat(s, meat) < 0.2 ? 1 : 0, through = Math.abs(s.position.y - meat.position.y) < p.height / 2 + ms.halfH - 0.2 ? 1 : 0;
      return 0.2 * tall + 0.2 * thin + 0.3 * centred * thin + 0.3 * through * thin;
    };
    part.spit = rods.length ? Math.max(...rods.map(spitScore)) : 0;
    why.spit = part.spit > 0.99 ? 'Spit is in place.' : !rods.length ? 'Nothing holds the meat up.' : part.spit < 0.5 ? 'That is not a spit, it is a pillar.' : 'The spit misses the meat.';
    // 5. heat
    const grills = w.meshes.filter((m) => m !== meat && warmGlow(m.material.emissive));
    const heatScore = (g) => {
      const d = flat(g, meat);
      const beside = d < 0.6 ? d / 0.6 * 0.8 : d <= 2.2 ? 1 : Math.max(0, 1 - (d - 2.2) / 2);   // a little credit for moving it part of the way
      return 0.4 + 0.3 * beside + (Math.abs(g.position.y - meat.position.y) < 0.8 ? 0.3 : 0);
    };
    part.heat = grills.length ? Math.max(...grills.map(heatScore)) : 0;
    why.heat = part.heat > 0.99 ? 'Hot grill, perfect.' : grills.length ? 'The grill is in the wrong place.' : 'Nothing is cooking the meat.';
    // 6. bread
    const breads = w.meshes.filter((m) => m !== meat && !shapes.get(m).thin && isBread(m.material.color.hsl()));
    const breadScore = (b) => 0.4 + 0.3 * Math.min(1, Math.max(0, (meat.position.y - b.position.y) / 0.8)) * (b.position.y < meat.position.y - 0.8 ? 1 : 0.8) + (flat(b, meat) <= 2 ? 0.3 : 0);
    part.bread = breads.length ? Math.max(...breads.map(breadScore)) : 0;
    why.bread = part.bread > 0.99 ? 'Fresh bread below.' : breads.length ? 'The bread is not below the meat.' : 'No bread.';
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
