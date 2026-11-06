// A procedural fruit-fly body (units: millimetres; the fly faces +x, up is +y, its left is -z).
// Legs use two-joint inverse kinematics and a tripod gait; wings fold at rest and beat in flight.
import * as THREE from 'three';

function bandTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8935e';
  g.fillRect(0, 0, 32, 256);
  // dark posterior band on each abdominal segment (texture v runs along the body axis)
  const bands = [[0.0, 0.12], [0.31, 0.36], [0.47, 0.52], [0.62, 0.67], [0.76, 0.80]];
  g.fillStyle = '#4a3020';
  for (const [a, b] of bands) g.fillRect(0, a * 256, 32, (b - a) * 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wingTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(60,50,40,1)';
  g.lineWidth = 2.2;
  const veins = [[10, 64, 250, 40], [10, 64, 250, 64], [10, 64, 240, 88], [10, 64, 200, 110], [30, 60, 250, 20]];
  for (const [x0, y0, x1, y1] of veins) {
    g.beginPath(); g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 6, x1, y1); g.stroke();
  }
  g.beginPath(); g.moveTo(120, 46); g.lineTo(122, 70); g.stroke();
  g.beginPath(); g.moveTo(170, 66); g.lineTo(168, 92); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function along(geom, axis = 'x') {
  // rotate a y-aligned primitive so its long axis is x (for body parts) or z (for leg segments)
  if (axis === 'x') geom.rotateZ(-Math.PI / 2);
  if (axis === 'z') geom.rotateX(Math.PI / 2);
  return geom;
}

const LEG = { femur: 0.62, tibia: 0.66, tarsus: 0.42 };
// hips (body frame) and resting foot positions, for the right side; the left side mirrors z
const LEG_LAYOUT = [
  { name: 'front', hip: [0.30, 0.52, 0.16], foot: [0.95, 0, 0.62] },
  { name: 'middle', hip: [0.06, 0.50, 0.20], foot: [0.12, 0, 0.98] },
  { name: 'hind', hip: [-0.18, 0.50, 0.17], foot: [-0.80, 0, 0.82] },
];

export function createFly() {
  const root = new THREE.Group();
  root.name = 'fly';
  const body = new THREE.Group();
  root.add(body);

  const chitin = new THREE.MeshStandardMaterial({ color: 0xa47a42, roughness: 0.42, metalness: 0.08 });
  const thoraxMat = new THREE.MeshStandardMaterial({ color: 0x8c6a3c, roughness: 0.38, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b1e14, roughness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x5a3f22, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xb81d16, roughness: 0.3, metalness: 0.0, flatShading: true, emissive: 0x3a0402 });
  const abdMat = new THREE.MeshStandardMaterial({ map: bandTexture(), roughness: 0.45, metalness: 0.05 });
  const wingMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8f2ff, map: wingTexture(), transparent: true, opacity: 0.32, roughness: 0.2,
    side: THREE.DoubleSide, depthWrite: false, iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 600],
  });

  const add = (geom, mat, pos, scale, parent = body) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(...pos);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // thorax, abdomen, head
  const thorax = add(along(new THREE.SphereGeometry(1, 40, 28)), thoraxMat, [0.06, 0.74, 0], [0.56, 0.46, 0.46]);
  thorax.name = 'thorax';
  add(along(new THREE.SphereGeometry(1, 24, 16)), dark, [0.12, 0.98, 0.0], [0.30, 0.06, 0.10]);   // dark scutellum stripe
  const abdomen = add(along(new THREE.SphereGeometry(1, 40, 28)), abdMat, [-0.92, 0.64, 0], [0.80, 0.44, 0.47]);
  abdomen.rotation.z = 0.10;
  const head = new THREE.Group();
  head.position.set(0.66, 0.80, 0);
  body.add(head);
  add(new THREE.SphereGeometry(0.30, 32, 24), chitin, [0.04, 0, 0], [0.8, 1, 1.12], head);
  for (const s of [-1, 1]) {
    add(new THREE.IcosahedronGeometry(0.22, 3), eyeMat, [0.06, 0.02, s * 0.215], [0.78, 1.08, 0.62], head);
    // antenna: a short segment plus a feathery arista
    const ant = new THREE.Group();
    ant.position.set(0.25, 0.08, s * 0.07);
    head.add(ant);
    add(new THREE.SphereGeometry(0.055, 12, 8), chitin, [0.02, -0.02, 0], [1.2, 1.4, 1], ant);
    const arista = add(new THREE.CylinderGeometry(0.008, 0.012, 0.34, 6), dark, [0.08, 0.13, s * 0.03], null, ant);
    arista.rotation.set(s * 0.55, 0, -1.1);
    head.userData[s < 0 ? 'antL' : 'antR'] = ant;
  }
  // ocelli
  for (const [x, z] of [[0.0, 0], [-0.05, 0.05], [-0.05, -0.05]]) add(new THREE.SphereGeometry(0.025, 8, 6), dark, [x, 0.29, z], null, head);
  // proboscis
  const prob = new THREE.Group();
  prob.position.set(0.12, -0.16, 0);
  head.add(prob);
  const probStalk = add(new THREE.CylinderGeometry(0.045, 0.055, 1, 10).translate(0, -0.5, 0), chitin, [0, 0, 0], [1, 0.12, 1], prob);
  const labellum = add(new THREE.SphereGeometry(0.075, 12, 10), chitin, [0, -0.12, 0], [1.2, 0.7, 1.2], prob);
  prob.rotation.z = -0.45;

  // bristles on the thorax
  const bristleGeo = new THREE.CylinderGeometry(0.004, 0.008, 0.22, 4).translate(0, 0.11, 0);
  for (let i = 0; i < 10; i++) {
    const b = add(bristleGeo, dark, [-0.15 + (i % 5) * 0.08, 1.12 - Math.abs(i % 5 - 2) * 0.02, (i < 5 ? -1 : 1) * 0.12]);
    b.rotation.set((i < 5 ? 1 : -1) * 0.3, 0, 0.9);
  }

  // wings
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.6, 0.22, 1.7, 0.42, 2.05, 0.18);
  shape.bezierCurveTo(2.25, 0.02, 2.1, -0.28, 1.7, -0.33);
  shape.bezierCurveTo(1.1, -0.38, 0.4, -0.2, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(shape, 24);
  wingGeo.computeBoundingBox();
  {
    const uv = wingGeo.attributes.uv, pos = wingGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2.25, (pos.getY(i) + 0.4) / 0.85);
  }
  wingGeo.rotateX(-Math.PI / 2);         // lie in the horizontal plane; shape +y becomes -z
  const wings = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(0.16, 1.11, s * 0.12);
    body.add(hinge);
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.scale.set(1, 1, -s);                  // mirror so the leading edge faces outward on both sides
    w.renderOrder = 2;
    hinge.add(w);
    wings.push({ hinge, side: s });
  }
  // halteres
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.045, 8, 6), chitin, [-0.24, 0.86, s * 0.30]);

  // legs
  const femurGeo = along(new THREE.CylinderGeometry(0.045, 0.055, LEG.femur, 8), 'z').translate(0, 0, LEG.femur / 2);
  const tibiaGeo = along(new THREE.CylinderGeometry(0.03, 0.042, LEG.tibia, 8), 'z').translate(0, 0, LEG.tibia / 2);
  const tarsusGeo = along(new THREE.CylinderGeometry(0.018, 0.028, LEG.tarsus, 6), 'z').translate(0, 0, LEG.tarsus / 2);
  const legs = [];
  LEG_LAYOUT.forEach((L, row) => {
    for (const s of [-1, 1]) {
      const hip = new THREE.Vector3(L.hip[0], L.hip[1], s * L.hip[2]);
      const rest = new THREE.Vector3(L.foot[0], 0.09, s * L.foot[2]);
      const yawG = new THREE.Group(); yawG.position.copy(hip); body.add(yawG);
      const femur = new THREE.Group(); yawG.add(femur);
      add(femurGeo, legMat, [0, 0, 0], null, femur);
      const tibia = new THREE.Group(); tibia.position.z = LEG.femur; femur.add(tibia);
      add(tibiaGeo, legMat, [0, 0, 0], null, tibia);
      const tarsus = new THREE.Group(); tarsus.position.z = LEG.tibia; tibia.add(tarsus);
      add(tarsusGeo, dark, [0, 0, 0], null, tarsus);
      // tripod groups: L1 R2 L3 vs R1 L2 R3
      const tripod = (row % 2 === 0) === (s < 0) ? 0 : 0.5;
      legs.push({ row, side: s, hip, rest, yawG, femur, tibia, tarsus, tripod, foot: rest.clone() });
    }
  });

  const tmp = new THREE.Vector3();
  function solveLeg(leg, target) {
    // put the leg's plane through the hip and the target, then two-joint IK with the knee up
    const dx = target.x - leg.hip.x, dz = target.z - leg.hip.z;
    leg.yawG.rotation.y = Math.atan2(dx, dz);
    const D = Math.hypot(dx, dz);
    const dy = target.y - leg.hip.y;
    const L1 = LEG.femur, L2 = LEG.tibia;
    let dist = Math.hypot(D, dy);
    dist = Math.min(Math.max(dist, Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-3);
    const phi = Math.atan2(dy, D);
    const a = Math.acos((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist));
    const femurAng = phi + a;
    const kx = L1 * Math.cos(femurAng), ky = L1 * Math.sin(femurAng);
    const tibiaAng = Math.atan2(dy - ky, D - kx);
    leg.femur.rotation.x = -femurAng;
    leg.tibia.rotation.x = -(tibiaAng - femurAng);
    leg.tarsus.rotation.x = -(-0.2 - tibiaAng);
  }

  const state = {
    phase: 0, proboscis: 0, flap: 0, groomT: 0, bob: 0, tuck: 0,
  };

  function update(dt, s) {
    // s: { speed (mm/s, negative = backwards), turn (rad/s), mode, proboscis (0..1) }
    const moving = s.mode === 'walk' || s.mode === 'back';
    const stride = 0.55;
    if (moving) state.phase += (Math.abs(s.speed) + Math.abs(s.turn) * 0.6) * dt / stride * Math.sign(s.speed || 1) * 0.5;
    state.tuck += ((s.mode === 'flight' ? 1 : 0) - state.tuck) * Math.min(1, dt * 10);
    state.groomT += dt;

    for (const leg of legs) {
      const target = tmp.copy(leg.rest);
      if (moving) {
        let p = (state.phase + leg.tripod) % 1; if (p < 0) p += 1;
        if (p < 0.5) {
          target.x += stride / 2 - stride * (p / 0.5);                 // stance: foot slides back
        } else {
          const q = (p - 0.5) / 0.5;
          target.x += -stride / 2 + stride * q;                        // swing: lift and move forward
          target.y += Math.sin(Math.PI * q) * 0.22;
        }
        // turning: feet sweep sideways a little
        target.x += -Math.sign(leg.side) * s.turn * 0.04;
      }
      if (s.mode === 'type' && leg.row === 0) {
        // front legs tap on a keyboard in front of the fly
        const k = state.groomT * 13 + (leg.side > 0 ? Math.PI : 0);
        target.set(1.2 + Math.sin(k * 0.37) * 0.1, 0.36 + Math.max(0, Math.sin(k)) * 0.22, leg.side * (0.2 + Math.sin(k * 0.23) * 0.08));
      }
      if (s.mode === 'groom' && leg.row === 0) {
        // front legs rub the head and antennae
        const k = state.groomT * 11 + (leg.side > 0 ? Math.PI : 0);
        target.set(0.92 + Math.sin(k) * 0.08, 0.72 + Math.cos(k) * 0.12, leg.side * (0.10 + Math.sin(k * 0.5) * 0.05));
      }
      if (state.tuck > 0.01) {
        const tucked = new THREE.Vector3(leg.hip.x + 0.1 - leg.row * 0.12, 0.08, leg.side * 0.32);
        target.lerp(tucked, state.tuck);
      }
      solveLeg(leg, target);
    }

    // body posture
    const bobTarget = moving ? Math.sin(state.phase * Math.PI * 4) * 0.015 : 0;
    body.position.y += (bobTarget - body.position.y) * Math.min(1, dt * 20);
    const pitchTarget = s.mode === 'groom' ? 0.10 : s.mode === 'type' ? 0.06 : s.mode === 'flight' ? -0.18 : 0;
    body.rotation.z += (pitchTarget - body.rotation.z) * Math.min(1, dt * 6);

    // proboscis
    state.proboscis += ((s.proboscis || 0) - state.proboscis) * Math.min(1, dt * 8);
    const ext = 0.12 + state.proboscis * 0.5;
    probStalk.scale.y = ext;
    labellum.position.y = -ext - 0.02;
    labellum.scale.setScalar(0.8 + state.proboscis * 0.6);
    prob.rotation.z = -0.45 + state.proboscis * 0.35;

    // wings: folded over the abdomen at rest, beating in flight
    for (const { hinge, side } of wings) {
      if (s.mode === 'flight') {
        state.flap += dt * 60;
        const beat = Math.sin(state.flap) * 1.05;
        hinge.rotation.set(side * beat, side * -1.25, 0.2);
      } else {
        const groomTwitch = s.mode === 'groom' ? Math.sin(state.groomT * 6) * 0.05 : 0;
        hinge.rotation.set(side * 0.06, Math.PI + side * (0.07 + groomTwitch), 0.06);
      }
    }
    // antennae twitch while being puffed or grooming
    const tw = s.antennaWiggle ? Math.sin(state.groomT * 40) * 0.15 : 0;
    head.userData.antL.rotation.x = tw;
    head.userData.antR.rotation.x = -tw;
  }

  // the root's +x is forward; a heading h rotates about +y
  return { root, body, head, update, headOffset: new THREE.Vector3(0.95, 0.75, 0) };
}
