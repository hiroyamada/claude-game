import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Terrain } from './Terrain';
import { Colliders } from './Colliders';
import { mulberry32, smoothstep } from '../engine/noise';
import { makeToonMaterial, globalUniforms } from '../engine/Materials';
import { HALF, WORLD_SIZE, GRID, SNOW_LINE, flatSites, PLATEAU, CITADEL } from './WorldData';

function colorize(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function lumpy(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.attributes.position; const r = mulberry32(seed);
  const map = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let s = map.get(k); if (s === undefined) { s = 1 + (r() - 0.5) * amt; map.set(k, s); }
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}
const clean = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };

function makeOak(detail: number): THREE.BufferGeometry {
  const trunk = clean(new THREE.CylinderGeometry(0.28, 0.45, 4, 6)); trunk.translate(0, 2, 0);
  colorize(trunk, new THREE.Color(0x6b4a2f));
  const parts = [trunk];
  const blobs: [number, number, number, number][] = [[0, 5.2, 0, 2.6], [1.4, 4.6, 0.6, 1.8], [-1.3, 4.8, -0.5, 1.9], [0.2, 6.4, -0.3, 1.8], [-0.4, 4.5, 1.3, 1.6]];
  blobs.forEach(([x, y, z, r], i) => {
    const b = clean(lumpy(new THREE.IcosahedronGeometry(r, detail), 0.25, i + 3)); b.translate(x, y, z);
    colorize(b, new THREE.Color(0x5d9a35).multiplyScalar(0.9 + i * 0.04));
    parts.push(b);
  });
  const g = mergeGeometries(parts)!; g.computeVertexNormals(); return g;
}
function makePine(detail: number): THREE.BufferGeometry {
  const trunk = clean(new THREE.CylinderGeometry(0.2, 0.35, 3, 6)); trunk.translate(0, 1.5, 0);
  colorize(trunk, new THREE.Color(0x5a3d26));
  const parts = [trunk];
  const seg = detail > 0 ? 8 : 6;
  [[2.4, 3.2, 2.2], [2.0, 2.8, 4.0], [1.5, 2.4, 5.6], [0.9, 2.0, 7.0]].forEach(([r, h, y], i) => {
    const c = clean(new THREE.ConeGeometry(r, h, seg, 1)); c.translate(0, y, 0);
    colorize(c, new THREE.Color(0x2f6b3c).multiplyScalar(0.9 + i * 0.07));
    parts.push(c);
  });
  return mergeGeometries(parts)!;
}
function makeCactus(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const col = new THREE.Color(0x5e8f3e);
  const body = clean(new THREE.CapsuleGeometry(0.45, 3, 3, 8)); body.translate(0, 1.9, 0); parts.push(colorize(body, col));
  const a1 = clean(new THREE.CapsuleGeometry(0.28, 1.0, 3, 6)); a1.translate(0.75, 2.4, 0); parts.push(colorize(a1, col));
  const a1b = clean(new THREE.CapsuleGeometry(0.26, 0.6, 3, 6)); a1b.rotateZ(Math.PI / 2); a1b.translate(0.45, 1.9, 0); parts.push(colorize(a1b, col));
  const a2 = clean(new THREE.CapsuleGeometry(0.25, 0.8, 3, 6)); a2.translate(-0.7, 2.9, 0); parts.push(colorize(a2, col));
  const a2b = clean(new THREE.CapsuleGeometry(0.24, 0.5, 3, 6)); a2b.rotateZ(Math.PI / 2); a2b.translate(-0.42, 2.5, 0); parts.push(colorize(a2b, col));
  return mergeGeometries(parts)!;
}
function makeDead(): THREE.BufferGeometry {
  const c = new THREE.Color(0x7a6a58);
  const parts: THREE.BufferGeometry[] = [];
  const t = clean(new THREE.CylinderGeometry(0.15, 0.35, 4.5, 5)); t.translate(0, 2.25, 0); parts.push(colorize(t, c));
  for (let i = 0; i < 4; i++) {
    const b = clean(new THREE.CylinderGeometry(0.05, 0.12, 2, 4)); b.translate(0, 1, 0);
    b.rotateZ(0.8 + i * 0.1); b.rotateY(i * 1.7); b.translate(0, 2.5 + i * 0.5, 0); parts.push(colorize(b, c));
  }
  return mergeGeometries(parts)!;
}
function makeRock(seed: number, detail: number): THREE.BufferGeometry {
  const g = clean(lumpy(new THREE.IcosahedronGeometry(1, detail), 0.45, seed));
  g.scale(1.3, 0.8, 1.1); g.translate(0, 0.3, 0);
  return colorize(g, new THREE.Color(0x9a9286));
}
function makeBush(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  [[0, 0.5, 0, 0.8], [0.6, 0.4, 0.2, 0.6], [-0.5, 0.4, -0.2, 0.6]].forEach(([x, y, z, r], i) => {
    const b = clean(lumpy(new THREE.IcosahedronGeometry(r, 1), 0.3, 50 + i)); b.translate(x, y, z);
    parts.push(colorize(b, new THREE.Color(0x4f8a30)));
  });
  return mergeGeometries(parts)!;
}
function makeFlower(): THREE.BufferGeometry {
  const stem = clean(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 3)); stem.translate(0, 0.25, 0); colorize(stem, new THREE.Color(0x3c7a2a));
  const head = clean(new THREE.IcosahedronGeometry(0.12, 0)); head.translate(0, 0.52, 0); colorize(head, new THREE.Color(1, 1, 1));
  return mergeGeometries([stem, head])!;
}

type Kind = 'oak' | 'pine' | 'cactus' | 'dead' | 'rock' | 'bush' | 'flower';
interface Inst { kind: Kind; x: number; y: number; z: number; s: number; ry: number; color: THREE.Color; }

const REGION = 128;

export class Vegetation {
  group = new THREE.Group();
  instances: Inst[] = [];
  private regions: { cx: number; cz: number; hi: THREE.InstancedMesh[]; lo: THREE.InstancedMesh[] }[] = [];
  grass: THREE.Mesh | null = null;
  grassMat: THREE.ShaderMaterial | null = null;

  constructor(private terrain: Terrain, private colliders: Colliders, quality: number) {
    this.scatter(quality);
    this.buildRegions();
    this.buildGrass(quality);
  }

  private scatter(quality: number) {
    const rnd = mulberry32(99);
    const t = this.terrain;
    const sites = flatSites();
    const blocked = (x: number, z: number, pad: number) => {
      for (const s of sites) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
      if (Math.hypot(x - CITADEL.x, z - CITADEL.z) < CITADEL.r * 0.7) return true;
      return false;
    };
    const nrm = new THREE.Vector3();
    const step = 7;
    for (let z = -HALF + 5; z < HALF - 5; z += step) for (let x = -HALF + 5; x < HALF - 5; x += step) {
      const px = x + (rnd() - 0.5) * step, pz = z + (rnd() - 0.5) * step;
      const h = t.heightAt(px, pz);
      if (h < 2.5) continue;
      t.normalAt(px, pz, nrm);
      const b = t.biome(px, pz);
      const flat = nrm.y;
      const r = rnd();
      if (blocked(px, pz, 6)) continue;
      const onPlateau = Math.hypot(px - PLATEAU.x, pz - PLATEAU.z) < PLATEAU.r - 5;
      const treeChance = (0.02 + b.forest * 0.55) * (flat > 0.8 ? 1 : 0.2) * (h > SNOW_LINE + 10 ? 0.3 : 1) * (onPlateau ? 0.6 : 1);
      if (b.desert > 0.6) {
        if (r < 0.025 && flat > 0.85) this.add('cactus', px, h, pz, 0.8 + rnd() * 0.6, rnd);
        else if (r < 0.04) this.add('rock', px, h, pz, 0.6 + rnd() * 1.5, rnd);
        else if (r < 0.06) this.add('dead', px, h, pz, 0.7 + rnd() * 0.5, rnd);
        continue;
      }
      if (r < treeChance) {
        const pine = b.north > 0.3 || h > 70 || rnd() < 0.15;
        this.add(pine ? 'pine' : 'oak', px, h - 0.2, pz, 0.8 + rnd() * 0.7, rnd);
      } else if (r < treeChance + 0.04 + (1 - flat) * 0.15) {
        this.add('rock', px, h - 0.2, pz, 0.5 + rnd() * (1 - flat > 0.2 ? 2.5 : 1.4), rnd);
      } else if (r < treeChance + 0.1 && flat > 0.85 && h < SNOW_LINE) {
        this.add('bush', px, h, pz, 0.7 + rnd() * 0.6, rnd);
      } else if (r < treeChance + 0.22 && flat > 0.9 && h < SNOW_LINE - 20 && quality > 0) {
        for (let k = 0; k < 3; k++) {
          const fx = px + (rnd() - 0.5) * 3, fz = pz + (rnd() - 0.5) * 3;
          this.add('flower', fx, t.heightAt(fx, fz), fz, 0.8 + rnd() * 0.5, rnd);
        }
      }
    }
  }

  private add(kind: Kind, x: number, y: number, z: number, s: number, rnd: () => number) {
    const color = new THREE.Color(1, 1, 1);
    if (kind === 'oak') color.setHSL(0.22 + rnd() * 0.08, 0.45, 0.5 + rnd() * 0.15).multiplyScalar(1.7);
    if (kind === 'pine') color.setHSL(0.36 + rnd() * 0.05, 0.3, 0.5).multiplyScalar(1.6);
    if (kind === 'flower') color.setHSL([0.0, 0.13, 0.6, 0.85, 0.08][Math.floor(rnd() * 5)], 0.85, 0.65);
    if (kind === 'rock') { color.setScalar(0.85 + rnd() * 0.3); if (y > SNOW_LINE) color.multiply(new THREE.Color(1.05, 1.05, 1.1)); }
    if (kind === 'bush') color.setHSL(0.25 + rnd() * 0.06, 0.4, 0.55).multiplyScalar(1.6);
    this.instances.push({ kind, x, y, z, s, ry: rnd() * Math.PI * 2, color });
    const c = this.colliders;
    if (kind === 'oak') c.addCyl(x, z, 0.45 * s, y, y + 4 * s, 'tree');
    else if (kind === 'pine') c.addCyl(x, z, 0.35 * s, y, y + 3 * s, 'tree');
    else if (kind === 'cactus') c.addCyl(x, z, 0.5 * s, y, y + 3 * s, 'cactus');
    else if (kind === 'dead') c.addCyl(x, z, 0.3 * s, y, y + 4 * s, 'tree');
    else if (kind === 'rock' && s > 0.9) c.addCyl(x, z, 1.0 * s, y - 1, y + 0.9 * s, 'stump');
  }

  private buildRegions() {
    const geos: Record<Kind, [THREE.BufferGeometry, THREE.BufferGeometry]> = {
      oak: [makeOak(1), makeOak(0)], pine: [makePine(1), makePine(0)], cactus: [makeCactus(), makeCactus()],
      dead: [makeDead(), makeDead()], rock: [makeRock(7, 1), makeRock(7, 0)], bush: [makeBush(), makeBush()], flower: [makeFlower(), makeFlower()],
    };
    const mats: Record<Kind, THREE.Material> = {
      oak: makeToonMaterial({ vertexColors: true, wind: 0.6, rim: 0.2 }),
      pine: makeToonMaterial({ vertexColors: true, wind: 0.4, rim: 0.15 }),
      cactus: makeToonMaterial({ vertexColors: true, rim: 0.2 }),
      dead: makeToonMaterial({ vertexColors: true, rim: 0.1 }),
      rock: makeToonMaterial({ vertexColors: true, worldNoise: true, rim: 0.15 }),
      bush: makeToonMaterial({ vertexColors: true, wind: 1.5, rim: 0.2 }),
      flower: makeToonMaterial({ vertexColors: true, wind: 3, rim: 0.3 }),
    };
    const R = Math.ceil(WORLD_SIZE / REGION);
    const buckets = new Map<string, Inst[]>();
    for (const inst of this.instances) {
      const cx = Math.floor((inst.x + HALF) / REGION), cz = Math.floor((inst.z + HALF) / REGION);
      const k = `${cx},${cz},${inst.kind}`;
      let b = buckets.get(k); if (!b) { b = []; buckets.set(k, b); }
      b.push(inst);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const regionMap = new Map<string, { cx: number; cz: number; hi: THREE.InstancedMesh[]; lo: THREE.InstancedMesh[] }>();
    for (const [k, list] of buckets) {
      const [cxs, czs, kind] = k.split(',');
      const cx = +cxs, cz = +czs;
      const rk = `${cx},${cz}`;
      let reg = regionMap.get(rk);
      if (!reg) { reg = { cx, cz, hi: [], lo: [] }; regionMap.set(rk, reg); this.regions.push(reg); }
      for (let lod = 0; lod < 2; lod++) {
        const im = new THREE.InstancedMesh(geos[kind as Kind][lod], mats[kind as Kind], list.length);
        list.forEach((inst, i) => {
          q.setFromAxisAngle(up, inst.ry); sc.setScalar(inst.s); pos.set(inst.x, inst.y, inst.z);
          if (inst.kind === 'rock') sc.set(inst.s, inst.s * (0.7 + (inst.ry % 1) * 0.5), inst.s);
          m4.compose(pos, q, sc); im.setMatrixAt(i, m4); im.setColorAt(i, inst.color);
        });
        im.castShadow = kind !== 'flower' && lod === 0; im.receiveShadow = true;
        im.computeBoundingSphere();
        im.visible = lod === 1;
        im.userData.small = kind === 'flower' || kind === 'bush';
        (lod === 0 ? reg.hi : reg.lo).push(im);
        this.group.add(im);
      }
    }
    void R;
  }

  updateLOD(cam: THREE.Vector3, quality: number) {
    const near = quality >= 2 ? 220 : quality === 1 ? 150 : 90;
    const far = quality >= 2 ? 900 : quality === 1 ? 600 : 380;
    for (const r of this.regions) {
      const x = -HALF + (r.cx + 0.5) * REGION, z = -HALF + (r.cz + 0.5) * REGION;
      const d = Math.hypot(cam.x - x, cam.z - z) - REGION * 0.7;
      const hi = d < near, vis = d < far;
      for (const m of r.hi) m.visible = hi && vis;
      for (const m of r.lo) m.visible = !hi && vis && !m.userData.small;
    }
  }

  // ---------------- grass ----------------
  private buildGrass(quality: number) {
    const count = quality >= 2 ? 90000 : quality === 1 ? 45000 : 16000;
    const radius = quality >= 2 ? 42 : quality === 1 ? 32 : 22;
    // blade geometry: 2 segments tapered
    const bp = new Float32Array([-0.035, 0, 0, 0.035, 0, 0, -0.024, 0.2, 0, 0.024, 0.2, 0, 0, 0.4, 0]);
    const bi = [0, 1, 2, 2, 1, 3, 2, 3, 4];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    g.setIndex(bi);
    const offs = new Float32Array(count * 4);
    const rnd = mulberry32(5);
    for (let i = 0; i < count; i++) {
      offs[i * 4] = (rnd() * 2 - 1) * radius; offs[i * 4 + 1] = (rnd() * 2 - 1) * radius;
      offs[i * 4 + 2] = rnd(); offs[i * 4 + 3] = rnd() * Math.PI * 2;
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 4));
    g.instanceCount = count;
    const tr = this.terrain;
    this.grassMat = new THREE.ShaderMaterial({
      fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: globalUniforms.uTime, uWind: globalUniforms.uWind,
        uHeight: { value: tr.dataTex }, uCol: { value: tr.colorTex },
        uCenter: { value: new THREE.Vector2() }, uRadius: { value: radius },
        uPlayer: globalUniforms.uPlayerPos,
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uAmb: { value: new THREE.Color(0.5, 0.5, 0.6) },
      }]),
      vertexShader: `
        uniform float uTime, uWind, uRadius; uniform vec2 uCenter; uniform vec3 uPlayer;
        uniform sampler2D uHeight, uCol;
        attribute vec4 aOff;
        varying vec3 vCol; varying float vT; varying float vFade;
        #include <fog_pars_vertex>
        float H(vec2 xz){
          vec2 g = (xz + ${HALF.toFixed(1)}) / ${(WORLD_SIZE / GRID).toFixed(4)};
          vec2 i = floor(g); vec2 f = g - i;
          ivec2 ii = ivec2(clamp(i, vec2(0.0), vec2(${(GRID - 1).toFixed(1)})));
          float a = texelFetch(uHeight, ii, 0).r, b = texelFetch(uHeight, ii+ivec2(1,0), 0).r;
          float c = texelFetch(uHeight, ii+ivec2(0,1), 0).r, d = texelFetch(uHeight, ii+ivec2(1,1), 0).r;
          if (f.x + f.y <= 1.0) return a + (b-a)*f.x + (c-a)*f.y;
          return d + (c-d)*(1.0-f.x) + (b-d)*(1.0-f.y);
        }
        void main(){
          vec2 rel = aOff.xy - uCenter;
          rel = mod(rel + uRadius, 2.0*uRadius) - uRadius;
          vec2 wp = uCenter + rel;
          vec2 uv = (wp + ${HALF.toFixed(1)}) / ${WORLD_SIZE.toFixed(1)};
          vec4 tc = texture2D(uCol, uv);
          float dens = tc.a;
          float dist = length(rel) / uRadius;
          vFade = 1.0 - smoothstep(0.7, 1.0, dist);
          float keep = step(aOff.z, dens * 1.1 - 0.05) * step(dist, 1.0);
          float h = H(wp);
          float sc = (0.6 + aOff.z * 0.8) * keep * (0.4 + 0.6*vFade);
          vec3 p = position * sc;
          float cs = cos(aOff.w), sn = sin(aOff.w);
          p.xz = mat2(cs, -sn, sn, cs) * p.xz;
          float t = position.y / 0.4;
          vT = t;
          // wind
          float w = sin(uTime*1.8 + wp.x*0.25 + wp.y*0.18) * 0.5 + sin(uTime*3.1 + wp.x*0.7) * 0.2;
          vec2 bend = vec2(w, w*0.5) * 0.35 * uWind;
          // push away from player
          vec2 dp = wp - uPlayer.xz;
          float pd = length(dp);
          float push = (1.0 - smoothstep(0.3, 1.4, pd)) * step(abs(uPlayer.y - h), 1.5);
          bend += normalize(dp + 0.0001) * push * 0.9;
          p.xz += bend * t * t * sc;
          p.y *= 1.0 - push * 0.4;
          vec3 world = vec3(wp.x, h, wp.y) + p;
          vec3 base = tc.rgb;
          vCol = mix(base * 0.55, base * 1.25 + vec3(0.06,0.08,0.0), t);
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 uSunCol, uAmb; uniform vec3 uSunDir;
        varying vec3 vCol; varying float vT; varying float vFade;
        #include <fog_pars_fragment>
        void main(){
          vec3 c = vCol;
          vec3 lit = c * (uAmb * 0.8 + uSunCol * max(uSunDir.y, 0.0) * 0.55 * (0.6 + 0.4*vT));
          gl_FragColor = vec4(lit, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // our colorTex stores sRGB-encoded values; decode in shader by declaring linear sample then pow
    this.grassMat.onBeforeCompile = () => {};
    this.grassMat.vertexShader = this.grassMat.vertexShader.replace('vec3 base = tc.rgb;', 'vec3 base = pow(tc.rgb, vec3(2.2));');
    this.grass = new THREE.Mesh(g, this.grassMat);
    this.grass.frustumCulled = false;
    this.group.add(this.grass);
  }

  updateGrass(center: THREE.Vector3, sunDir: THREE.Vector3, sunCol: THREE.Color, sunI: number, amb: THREE.Color, ambI: number) {
    if (!this.grassMat) return;
    const u = this.grassMat.uniforms;
    u.uCenter.value.set(center.x, center.z);
    u.uSunDir.value.copy(sunDir);
    u.uSunCol.value.copy(sunCol).multiplyScalar(sunI * 0.5);
    u.uAmb.value.copy(amb).multiplyScalar(ambI * 0.8);
  }
}

export { smoothstep };
