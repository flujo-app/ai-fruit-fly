// Check the Fly Gym customer: a proper döner passes, the flies' first "döner" (a glowing ball
// swallowing the meat) fails, and random typing scores low.
//   node tools/test_judge.mjs
import { judge } from '../js/gym/judge.js';
import { writeProgram } from '../js/gym/grammar.js';

const proper = `scene.add(new THREE.DirectionalLight(0xffffff, 2));
const m1 = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.5, 2), new THREE.MeshStandardMaterial({ color: 0x8b4513 })); scene.add(m1);
const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), new THREE.MeshStandardMaterial({ color: 0xc0c6cc })); scene.add(m2);
const m3 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 0.2), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff5500 })); scene.add(m3);
m3.position.set(0, 0, -1.5);
const m4 = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0xf5deb3 })); scene.add(m4);
m4.position.set(0, -1.5, 0.5);
knife(m1);
spin = (dt) => { m1.rotation.y += dt * 1; };`;

const orangeBall = `const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.05, 3), new THREE.MeshStandardMaterial({ color: 0x8b4513, emissive: 0x33aa44 })); scene.add(m1);
m1.position.set(0, 0.5, 0);
const m2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 3, 2), new THREE.MeshStandardMaterial({ color: 0xf5deb3 })); scene.add(m2);
knife(m1);
spin = (dt) => { m1.rotation.y += dt * 2; };
m2.position.set(-1, -0.5, 0);
scene.add(new THREE.PointLight(0xf5deb3, 3));
const m3 = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshStandardMaterial({ color: 0x3366ff, emissive: 0xff5500 })); scene.add(m3);
m3.position.set(-1.5, 0.5, 0);
const m4 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), new THREE.MeshStandardMaterial({ color: 0x8b4513 })); scene.add(m4);`;

// the flies' third loophole: a glowing stick far to the side as the "grill", the döner up near the
// top edge, and dim brown lamps
const stickGrill = `scene.add(new THREE.PointLight(0x8b4513, 3));
scene.add(new THREE.PointLight(0x8b4513, 3));
scene.add(new THREE.PointLight(0x8b4513, 3));
const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1), new THREE.MeshStandardMaterial({ color: 0x8b4513, emissive: 0xff5500 })); scene.add(m1);
scene.add(new THREE.DirectionalLight(0xf5deb3, 1));
const m2 = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.5, 2), new THREE.MeshStandardMaterial({ color: 0x8b4513 })); scene.add(m2);
knife(m2);
const m3 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), new THREE.MeshStandardMaterial({ color: 0xf5deb3, emissive: 0xf5deb3 })); scene.add(m3);
knife(m3);
m3.position.set(-1, 2, 0);
const m4 = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0xf5deb3 })); scene.add(m4);
m1.position.set(2, 2, -1.5);
spin = (dt) => { m2.rotation.y += dt * 0.5; };
m2.position.set(-1, 2, 0);`;

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failed++; };

const a = judge(proper);
check(`proper döner passes all 8 tests (${a.passed}/8, ${a.score.toFixed(2)})`, a.passed === 8);
const b = judge(orangeBall);
check(`glowing ball "döner" no longer passes (${b.passed}/8): ${Object.entries(b.res).filter(([, v]) => !v).map(([k]) => `${k}: ${b.why[k]}`).join(' | ')}`, b.passed <= 4);

const c = judge(stickGrill);
check(`stick-grill "döner" no longer passes (${c.passed}/8): ${Object.entries(c.res).filter(([, v]) => !v).map(([k]) => `${k}: ${c.why[k]}`).join(' | ')}`, c.passed <= 6);

let sum = 0, best = 0, maxPassed = 0, errors = 0;
for (let i = 0; i < 3000; i++) {
  const r = judge(writeProgram((l, s, o) => Math.floor(Math.random() * o.length)).code);
  if (r.error) errors++;
  sum += r.score; best = Math.max(best, r.score); maxPassed = Math.max(maxPassed, r.passed);
}
check(`random typing: mean ${(sum / 3000).toFixed(2)}, best ${best.toFixed(2)}, most tests ${maxPassed}, errors ${errors}`, errors === 0 && maxPassed < 6);
process.exit(failed ? 1 : 0);
