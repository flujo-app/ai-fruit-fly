// A little 3D scene: the fruit fly at a tiny laptop, typing the code it chose.
import * as THREE from 'three';
import { createFly } from '../fly.js';

export class FlyCam {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d24);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
    this.camera.position.set(-3.6, 3.4, 5.2);
    this.target = new THREE.Vector3(2.0, 1.2, 0);

    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x302820, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    this.scene.add(key);
    // light from the laptop screen
    this.screenLight = new THREE.PointLight(0x7fb4ff, 3, 8);
    this.screenLight.position.set(4.2, 2.2, 0);
    this.scene.add(this.screenLight);

    const desk = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.8 }));
    desk.rotation.x = -Math.PI / 2;
    desk.receiveShadow = true;
    this.scene.add(desk);

    // tiny laptop (about twice the fly's length)
    const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.8, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 4.6), alu);
    base.position.set(2.6, 0.09, 0);
    base.castShadow = true; base.receiveShadow = true;
    this.scene.add(base);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.8), new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7 }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(2.8, 0.185, 0);
    this.scene.add(keys);
    const lid = new THREE.Group();
    lid.position.set(4.2, 0.18, 0);
    lid.rotation.z = -0.28;   // lean the screen back, away from the fly
    this.scene.add(lid);
    const lidBack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.0, 4.6), alu);
    lidBack.position.set(0.05, 1.5, 0);
    lidBack.castShadow = true;
    lid.add(lidBack);
    this.code = document.createElement('canvas');
    this.code.width = 512; this.code.height = 336;
    this.codeTex = new THREE.CanvasTexture(this.code);
    this.codeTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.8), new THREE.MeshBasicMaterial({ map: this.codeTex }));
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-0.01, 1.5, 0);
    lid.add(screen);
    this.drawCode('');

    this.fly = createFly();
    this.fly.root.position.set(-0.15, 0, 0);
    this.scene.add(this.fly.root);
    this.mode = 'idle';
    this.sniffing = false;
    this.clock = new THREE.Clock();
    this.angle = 0;
  }

  drawCode(text) {
    const g = this.code.getContext('2d');
    g.fillStyle = '#0f1218';
    g.fillRect(0, 0, 512, 336);
    g.font = '13px ui-monospace, Consolas, monospace';
    const lines = text.split('\n').slice(-22);
    lines.forEach((ln, i) => {
      g.fillStyle = ln.trim().startsWith('//') ? '#6b7a90' : /THREE\./.test(ln) ? '#8fd3ff' : '#e7e9ee';
      g.fillText(ln.slice(0, 64), 12, 20 + i * 14.5);
    });
    g.fillStyle = '#ffb547';
    g.fillRect(12, 20 + Math.min(lines.length, 22) * 14.5 - 11, 7, 13);
    this.codeTex.needsUpdate = true;
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.angle += dt * 0.25;
    const swing = 0.35 + Math.sin(this.angle) * 0.55;   // look over the fly's shoulder, swaying gently
    this.camera.position.set(2.0 - Math.cos(swing) * 6.4, 3.0, Math.sin(swing) * 6.4);
    this.camera.lookAt(this.target);
    this.fly.update(dt, { speed: 0, turn: 0, mode: this.mode, proboscis: this.mode === 'feed' ? 1 : 0, antennaWiggle: this.sniffing });
    this.screenLight.intensity = 2.5 + Math.sin(performance.now() / 300) * 0.3;
    this.renderer.render(this.scene, this.camera);
  }
}
