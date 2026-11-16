import * as THREE from 'three';
import { lerp, clamp, smoothstep } from '../engine/noise';

// Sky dome + sun/moon/stars/clouds + day/night light rig.

interface Key { t: number; top: number; hor: number; sun: number; sunI: number; amb: number; ground: number; fog: number; }
const KEYS: Key[] = [
  { t: 0, top: 0x060b1e, hor: 0x1b2747, sun: 0x8fa5d8, sunI: 0.35, amb: 0x34406a, ground: 0x1a1f2a, fog: 0x1a2340 },
  { t: 4.5, top: 0x0b1430, hor: 0x2a3358, sun: 0x8fa5d8, sunI: 0.3, amb: 0x343d66, ground: 0x1d2028, fog: 0x232b4a },
  { t: 5.8, top: 0x34507e, hor: 0xf09a6a, sun: 0xffb27a, sunI: 0.9, amb: 0x7f7a94, ground: 0x4a3c34, fog: 0xc99a86 },
  { t: 7.5, top: 0x4a8fd6, hor: 0xbfe0f2, sun: 0xfff1d6, sunI: 2.4, amb: 0x9fbbe0, ground: 0x6b6b4a, fog: 0xbcd8ec },
  { t: 12, top: 0x3d84d8, hor: 0xc4e4f6, sun: 0xfff8ea, sunI: 2.8, amb: 0xa8c4e8, ground: 0x707052, fog: 0xc2dcf0 },
  { t: 16.5, top: 0x4a8bd0, hor: 0xd2e2ee, sun: 0xffe9c8, sunI: 2.5, amb: 0xa5bcdc, ground: 0x6e6a4c, fog: 0xc8dcea },
  { t: 18.3, top: 0x3a4f86, hor: 0xf3925a, sun: 0xff9a5a, sunI: 1.2, amb: 0x8f7a90, ground: 0x4c3a30, fog: 0xd99070 },
  { t: 19.8, top: 0x111a3a, hor: 0x41385e, sun: 0x9aaee0, sunI: 0.35, amb: 0x3c4270, ground: 0x1d1f2a, fog: 0x2e2f50 },
  { t: 24, top: 0x060b1e, hor: 0x1b2747, sun: 0x8fa5d8, sunI: 0.35, amb: 0x34406a, ground: 0x1a1f2a, fog: 0x1a2340 },
];

const c1 = new THREE.Color(), c2 = new THREE.Color();
function lerpHex(a: number, b: number, t: number, out: THREE.Color) { c1.setHex(a); c2.setHex(b); return out.copy(c1).lerp(c2, t); }

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  time = 9; // hours
  daySpeed = 24 / (24 * 60); // hours per second (24 min full day)
  sunDir = new THREE.Vector3();
  fogColor = new THREE.Color();
  isNight = false;
  weatherDark = 0; // 0..1 from storms
  shadowSize = 60;
  indoor = false;

  constructor(scene: THREE.Scene, shadowRes: number) {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
        uTime: { value: 0 }, uNight: { value: 0 }, uCloud: { value: 0.45 }, uDark: { value: 0 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop, uHor, uSunDir, uSunCol; uniform float uTime, uNight, uCloud, uDark;
        varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(uHor, uTop, pow(max(h,0.0), 0.55));
          if (d.y < 0.0) col = mix(uHor, uHor*0.6, clamp(-d.y*4.0,0.0,1.0));
          float sd = max(dot(d, uSunDir), 0.0);
          // sun glow & disc (or moon)
          vec3 sunTint = uSunCol;
          col += sunTint * pow(sd, 8.0) * 0.35 * (1.0 - uNight*0.7);
          col += sunTint * pow(sd, 64.0) * 0.6;
          float disc = smoothstep(0.9993, 0.9996, sd);
          col = mix(col, uNight > 0.5 ? vec3(0.92,0.94,1.0) : vec3(1.0,0.98,0.9)*2.5, disc);
          // stars
          if (uNight > 0.0 && d.y > 0.0) {
            vec2 sp = d.xz / (d.y + 0.3) * 120.0;
            float s = hash(floor(sp));
            float tw = 0.6 + 0.4*sin(uTime*3.0 + s*50.0);
            float star = step(0.985, s) * smoothstep(0.5, 0.0, length(fract(sp)-0.5)) * tw;
            col += vec3(star) * uNight * smoothstep(0.0, 0.25, d.y) * (1.0 - uDark);
          }
          // clouds (stylized)
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime*0.006, uTime*0.002);
            float n = fbm(cp);
            float cov = mix(0.62, 0.3, uCloud);
            float cl = smoothstep(cov, cov + 0.12, n);
            float shade = smoothstep(cov, cov + 0.35, fbm(cp + 0.05));
            vec3 ccol = mix(vec3(1.0), uHor*0.9, 0.35);
            ccol = mix(ccol, ccol*0.72, shade);
            ccol = mix(ccol, uTop*0.5 + 0.1, uNight*0.85);
            ccol += uSunCol * pow(sd, 6.0) * 0.4;
            ccol = mix(ccol, vec3(0.42,0.45,0.5), uDark);
            col = mix(col, ccol, cl * smoothstep(0.0, 0.15, d.y));
          }
          col = mix(col, vec3(0.45,0.48,0.53) * (1.0 - uNight*0.7), uDark*0.75);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = shadowRes > 0;
    if (shadowRes > 0) {
      this.sun.shadow.mapSize.set(shadowRes, shadowRes);
      const s = this.shadowSize;
      Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    scene.add(this.hemi);
  }

  hours() { return this.time; }
  clockString() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3, camPos: THREE.Vector3, scene: THREE.Scene, cloudiness: number) {
    this.time = (this.time + dt * this.daySpeed) % 24;
    const t = this.time;
    let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = smoothstep(0, 1, (t - a.t) / (b.t - a.t));
    const U = this.mat.uniforms;
    lerpHex(a.top, b.top, f, U.uTop.value);
    lerpHex(a.hor, b.hor, f, U.uHor.value);
    lerpHex(a.fog, b.fog, f, this.fogColor);
    const sunCol = lerpHex(a.sun, b.sun, f, U.uSunCol.value);
    // sun angle: sunrise 6, sunset 18
    const ang = ((t - 6) / 24) * Math.PI * 2;
    const sunY = Math.sin(ang);
    this.isNight = sunY < -0.05;
    this.sunDir.set(Math.cos(ang) * 0.8, sunY, 0.45).normalize();
    // when night, light comes from the moon (opposite)
    const lightDir = this.indoor ? new THREE.Vector3(0.3, 1, 0.2) : this.isNight ? this.sunDir.clone().multiplyScalar(-1) : this.sunDir.clone();
    if (lightDir.y < 0.15) lightDir.y = 0.15 + (0.15 - lightDir.y) * 0; // keep light from above-ish
    lightDir.normalize();
    U.uSunDir.value.copy(this.isNight ? lightDir : this.sunDir);
    U.uNight.value = clamp(-sunY * 4 + 0.3, 0, 1);
    U.uTime.value += dt;
    U.uCloud.value = cloudiness;
    U.uDark.value = this.weatherDark;

    const dark = 1 - this.weatherDark * 0.55;
    this.sun.color.copy(sunCol);
    this.sun.intensity = this.indoor ? 1.3 : lerp(a.sunI, b.sunI, f) * dark;
    if (this.indoor) this.sun.color.setHex(0xdde8ff);
    this.hemi.color.copy(lerpHex(a.amb, b.amb, f, c2.clone()));
    this.hemi.groundColor.setHex(a.ground).lerp(c1.setHex(b.ground), f);
    this.hemi.intensity = this.indoor ? 2.4 : 1.25 * (1 - this.weatherDark * 0.3);
    if (this.indoor) { this.hemi.color.setHex(0xb8c8f0); this.hemi.groundColor.setHex(0x4a4560); }

    this.fogColor.lerp(c1.setHex(0x6c7480), this.weatherDark * 0.6);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(this.indoor ? c1.setHex(0x1a2238) : this.fogColor);

    // shadow camera follows the focus point, snapped to texels to avoid shimmer
    const s = this.shadowSize;
    const texel = (s * 2) / (this.sun.shadow.mapSize.x || 1024);
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + lightDir.x * 200, focus.y + lightDir.y * 200, fz + lightDir.z * 200);
    this.sun.target.updateMatrixWorld();
    this.mesh.position.copy(camPos);
  }
}
