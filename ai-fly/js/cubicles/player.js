// Walking around: WASD or the arrow keys, the mouse to look (pointer lock), Shift to run. You cannot
// walk through cubicles or walls, and the floor rises onto the supervisor deck over the ramp.
import * as THREE from 'three';
import { free, floorHeight } from './layout.js';

export const EYE = 1.7;

export class Player {
  constructor(camera, dom, grid) {
    this.camera = camera;
    this.dom = dom;
    this.grid = grid;
    this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.y = EYE;
    this.keys = new Set();
    this.locked = false;
    this.moved = 0;            // metres walked (to fade out the help)
    this.autopilot = false;    // when true, a script moves the camera instead
    addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (this.locked && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.autopilot) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - e.movementY * 0.0022));
    });
  }

  lock() { if (!this.locked && this.dom.requestPointerLock) this.dom.requestPointerLock(); }

  setPose(x, z, yaw, pitch = 0) { this.x = x; this.z = z; this.yaw = yaw; this.pitch = pitch; this.y = floorHeight(x, z) + EYE; this.apply(); }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  update(dt) {
    if (!this.autopilot) {
      const k = this.keys;
      let f = 0, r = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
      if (f || r) {
        const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 11 : 4.5) * dt / Math.hypot(f, r);
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        const dx = (-sy * f + cy * r) * speed, dz = (-cy * f - sy * r) * speed;
        // slide along walls: try the full step, then each direction on its own
        if (free(this.grid, this.x + dx, this.z + dz)) { this.x += dx; this.z += dz; }
        else if (free(this.grid, this.x + dx, this.z)) this.x += dx;
        else if (free(this.grid, this.x, this.z + dz)) this.z += dz;
        this.moved += Math.hypot(dx, dz);
      }
      const target = floorHeight(this.x, this.z) + EYE;
      this.y += (target - this.y) * Math.min(1, dt * 12);
    }
    this.apply();
  }

  apply() {
    this.camera.position.set(this.x, this.y, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
