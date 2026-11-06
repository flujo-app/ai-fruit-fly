// Live view of the whole brain: one glowing dot per neuron, placed where its cell body sits
// in the FlyWire map. Dots flash when the neuron fires.
import * as THREE from 'three';

const PALETTE = [
  0x6b7280, // unknown
  0x2f5bff, // optic lobes
  0x9d5cff, // central brain
  0x2fe39a, // sensory
  0x2cc8ff, // visual projection
  0xffd23d, // ascending
  0xff7a2f, // descending (brain -> body)
  0xa3ff3d, // sensory ascending
  0x1fd1c1, // visual centrifugal
  0xff3d6e, // motor
  0xff5fd2, // endocrine
];

export async function loadNeurons(url) {
  const buf = await fetch(url).then(r => { if (!r.ok) throw new Error(`Could not load ${url}`); return r.arrayBuffer(); });
  const n = new DataView(buf).getUint32(4, true);
  const xyz = new Float32Array(buf, 8, n * 3);
  const cls = new Uint8Array(buf, 8 + n * 12, n);
  return { n, xyz, cls };
}

export class BrainView {
  constructor({ n, xyz, cls }) {
    this.n = n;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a12);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 100);
    this.camera.position.set(0, 0.6, 13);
    this.camera.lookAt(0, 0, 0);

    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[3 * i] = xyz[3 * i] * 0.01;
      pos[3 * i + 1] = -xyz[3 * i + 1] * 0.01;   // FlyWire y points down
      pos[3 * i + 2] = xyz[3 * i + 2] * 0.01;
    }
    this.act = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('cls', new THREE.BufferAttribute(Float32Array.from(cls), 1));
    this.actAttr = new THREE.BufferAttribute(this.act, 1);
    this.actAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('act', this.actAttr);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        palette: { value: PALETTE.map(c => new THREE.Color(c)) },
        uSize: { value: 26 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */`
        attribute float cls;
        attribute float act;
        uniform vec3 palette[11];
        uniform float uSize;
        uniform float uPixelRatio;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vec3 base = palette[int(cls + 0.5)];
          vec3 hot = mix(base, vec3(1.0, 0.97, 0.85), 0.55);
          float a = clamp(act, 0.0, 1.0);
          vColor = mix(base * 0.075, hot * 1.4, a);
          gl_PointSize = uPixelRatio * uSize * (1.0 + 2.2 * a) / -mv.z;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r2 = dot(d, d);
          if (r2 > 0.25) discard;
          float f = smoothstep(0.25, 0.0, r2);
          gl_FragColor = vec4(vColor * f, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.points);
    this.group.rotation.x = 0.25;
    this.scene.add(this.group);
    this.angle = 0;
    this.dragging = false;
  }

  spikes(list) {
    const a = this.act;
    for (let k = 0; k < list.length; k++) a[list[k]] = 1;
  }

  update(dt) {
    const f = Math.exp(-dt / 0.18);
    const a = this.act;
    for (let i = 0; i < a.length; i++) if (a[i] > 0.003) a[i] *= f; else a[i] = 0;
    this.actAttr.needsUpdate = true;
    if (!this.dragging) this.angle += dt * 0.18;
    this.group.rotation.y = Math.sin(this.angle) * 0.9;
  }

  render(renderer, rect, canvasHeight) {
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    const y = canvasHeight - rect.bottom;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }
}
