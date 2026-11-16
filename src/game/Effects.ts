import * as THREE from 'three';

// Pooled billboard particles + transient meshes (rings, flashes).

const MAX = 3000;

export class Effects {
  private geo: THREE.InstancedBufferGeometry;
  private mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private next = 0;
  private transients: { obj: THREE.Object3D; t: number; dur: number; update: (o: THREE.Object3D, k: number) => void }[] = [];

  constructor(private scene: THREE.Scene) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aSize', this.aSize);
    g.instanceCount = MAX;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;
        varying vec4 vCol; varying vec2 vUv;
        void main(){
          vCol = aCol; vUv = position.xy + 0.5;
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          mv.xy += position.xy * aSize;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vCol; varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.3, d) * vCol.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vCol.rgb * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 25, 2);
      scene.add(l); this.lights.push({ l, t: 1, dur: 1, i: 0 });
    }
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life: number, gravity = 0, alpha = 1) {
    const i = this.next; this.next = (this.next + 1) % MAX;
    const c = new THREE.Color(color);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = alpha;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grav[i] = gravity;
  }

  burst(p: THREE.Vector3, n: number, color: THREE.ColorRepresentation, speed = 4, size = 0.25, life = 0.6, gravity = 6, up = 1) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() * up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.spawn(p, v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), gravity);
    }
  }

  sparkle(p: THREE.Vector3, color: THREE.ColorRepresentation, n = 1, spread = 0.6) {
    const q = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      q.set(p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread);
      this.spawn(q, new THREE.Vector3(0, 0.6 + Math.random(), 0), color, 0.12 + Math.random() * 0.1, 0.8 + Math.random() * 0.6, 0);
    }
  }

  explosion(p: THREE.Vector3, radius = 4) {
    this.burst(p, 60, 0xffa040, radius * 3, 0.9, 0.7, -1, 1);
    this.burst(p, 30, 0xff5020, radius * 2, 1.2, 0.5, -1, 1);
    this.burst(p, 25, 0x555555, radius * 1.2, 1.6, 1.4, -2, 1.5);
    this.ring(p, radius * 1.4, 0xffc070, 0.4);
    this.flash(p, 0xffa050, 30, 0.3);
  }

  ring(p: THREE.Vector3, radius: number, color: number, dur = 0.5, thickness = 0.15) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.copy(p);
    void thickness;
    this.scene.add(m);
    this.transients.push({ obj: m, t: 0, dur, update: (o, k) => { const s = 0.2 + k * radius; o.scale.set(s, s, s); ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - k; } });
  }

  // fixed pool of lights (adding/removing lights would trigger shader recompiles)
  private lights: { l: THREE.PointLight; t: number; dur: number; i: number }[] = [];
  flash(p: THREE.Vector3, color: number, intensity: number, dur: number) {
    if (!this.lights.length) return;
    const e = this.lights.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    e.l.color.setHex(color); e.l.position.copy(p); e.t = 0; e.dur = dur; e.i = intensity;
  }

  slash(p: THREE.Vector3, yaw: number, color = 0xffffff, radius = 2, heavy = false) {
    const g = new THREE.RingGeometry(radius * 0.55, radius, 24, 1, -Math.PI * 0.4, Math.PI * (heavy ? 2 : 0.8));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.copy(p); m.rotation.set(-Math.PI / 2, 0, yaw + Math.PI / 2, 'YXZ');
    m.rotation.order = 'YXZ'; m.rotation.y = yaw; m.rotation.x = -Math.PI / 2 + 0.25; m.rotation.z = 0;
    this.scene.add(m);
    this.transients.push({ obj: m, t: 0, dur: 0.18, update: (o, k) => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k); o.scale.setScalar(0.9 + k * 0.2); } });
  }

  addTransient(obj: THREE.Object3D, dur: number, update: (o: THREE.Object3D, k: number) => void) {
    this.scene.add(obj);
    this.transients.push({ obj, t: 0, dur, update });
  }

  update(dt: number) {
    let maxActive = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.aSize.array[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      (this.aSize.array as Float32Array)[i] = this.size[i] * (0.3 + 0.7 * k);
      this.col[i * 4 + 3] = Math.min(1, k * 2);
      maxActive = i + 1;
    }
    this.geo.instanceCount = Math.max(1, maxActive);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
    for (const e of this.lights) { e.t += dt; e.l.intensity = e.t < e.dur ? e.i * (1 - e.t / e.dur) : 0; }
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i];
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      tr.update(tr.obj, k);
      if (k >= 1) {
        this.scene.remove(tr.obj);
        (tr.obj as THREE.Mesh).geometry?.dispose?.();
        this.transients.splice(i, 1);
      }
    }
  }
}
