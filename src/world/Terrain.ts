import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp } from '../engine/noise';
import { WORLD_SIZE, HALF, GRID, CELL, PLATEAU, LAKE, CITADEL, flatSites, SNOW_LINE, SEA_LEVEL } from './WorldData';
import { makeToonMaterial } from '../engine/Materials';

const N = GRID + 1;

export class Terrain {
  heights = new Float32Array(N * N);
  normals = new Float32Array(N * N * 3);
  colors = new Float32Array(N * N * 3);
  grassDensity = new Uint8Array(N * N);
  sx = new Simplex(1337);
  group = new THREE.Group();
  dataTex!: THREE.DataTexture; // r = height (float)
  colorTex!: THREE.DataTexture; // rgb color + a grass density
  material!: THREE.Material;
  private chunks: { mesh: THREE.Mesh; lods: (THREE.BufferGeometry | null)[]; cx: number; cz: number; lod: number; center: THREE.Vector3 }[] = [];
  static CHUNKS = 16;
  static CHUNK_CELLS = GRID / 16; // 64

  biome(x: number, z: number) {
    const sx = this.sx;
    const warp = sx.fbm(x * 0.003 + 50, z * 0.003, 3) * 60;
    const desert = smoothstep(180, 320, x + z * 0.6 + warp) * smoothstep(-80, 60, z + warp);
    const north = smoothstep(-120, -330, z + warp);
    const forest = clamp(smoothstep(-0.05, 0.35, sx.fbm(x * 0.004 - 20, z * 0.004 + 9, 3)) * (1 - desert) + smoothstep(-150, -380, x + warp) * 0.6, 0, 1);
    return { desert, north, forest };
  }

  private rawHeight(x: number, z: number): number {
    const sx = this.sx;
    const r = Math.hypot(x, z) / HALF;
    const coast = 0.86 + sx.fbm(x * 0.004, z * 0.004, 3) * 0.12;
    const mask = smoothstep(coast, coast - 0.16, r);
    const b = this.biome(x, z);
    let h = 6 + (sx.fbm(x * 0.0022, z * 0.0022, 5) * 0.5 + 0.5) * 34 + sx.fbm(x * 0.012, z * 0.012, 3) * 4;
    // northern mountains
    const mtn = sx.ridged(x * 0.0035 + 3, z * 0.0035 - 7, 6);
    h += b.north * (mtn * mtn * 260 + 20);
    // desert dunes - flatter, rippled
    const dune = Math.abs(Math.sin(x * 0.04 + sx.noise(x * 0.01, z * 0.01) * 3)) * 5;
    h = lerp(h, 10 + dune + sx.fbm(x * 0.005, z * 0.005, 3) * 10, b.desert * 0.85);
    // plateau with cliffs
    const pd = Math.hypot(x - PLATEAU.x, z - PLATEAU.z) + sx.fbm(x * 0.02, z * 0.02, 3) * 12;
    const pf = smoothstep(PLATEAU.r + 18, PLATEAU.r - 4, pd);
    const ptop = PLATEAU.top + sx.fbm(x * 0.01, z * 0.01, 3) * 6;
    h = lerp(h, ptop, pf);
    // lake bowl
    const ld = Math.hypot(x - LAKE.x, z - LAKE.z) + sx.fbm(x * 0.015, z * 0.015, 2) * 18;
    h = lerp(h, -9, smoothstep(LAKE.r, LAKE.r * 0.45, ld));
    // citadel hill with flat crown
    const cd = Math.hypot(x - CITADEL.x, z - CITADEL.z);
    const cf = smoothstep(CITADEL.r * 1.6, CITADEL.r * 0.55, cd + sx.fbm(x * 0.02, z * 0.02, 2) * 10);
    h = lerp(h, CITADEL.top, cf);
    // island mask
    h = h * mask + -24 * (1 - mask);
    // beaches: flatten near sea level
    if (h > -3 && h < 5) h = lerp(h, 1.2 + (h - 1.2) * 0.6, 0.5);
    return h;
  }

  generate() {
    const H = this.heights;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      H[j * N + i] = this.rawHeight(x, z);
    }
    // flatten sites
    for (const s of flatSites()) {
      const target = this.sampleGrid(s.x, s.z);
      const tgt = Math.max(target, 1.5);
      const rr = s.r * 1.8;
      const i0 = Math.floor((s.x - rr + HALF) / CELL), i1 = Math.ceil((s.x + rr + HALF) / CELL);
      const j0 = Math.floor((s.z - rr + HALF) / CELL), j1 = Math.ceil((s.z + rr + HALF) / CELL);
      for (let j = Math.max(0, j0); j <= Math.min(GRID, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(GRID, i1); i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        const d = Math.hypot(x - s.x, z - s.z);
        const f = smoothstep(rr, s.r, d);
        H[j * N + i] = lerp(H[j * N + i], tgt, f);
      }
    }
    this.computeNormalsAndColors();
    this.buildTextures();
    this.material = makeToonMaterial({ vertexColors: true, worldNoise: true });
    this.buildChunks();
  }

  private computeNormalsAndColors() {
    const H = this.heights, Nn = this.normals, C = this.colors;
    const tmp = new THREE.Color();
    const cGrass = new THREE.Color(0x6fa63a), cGrass2 = new THREE.Color(0x9cbd4a), cForest = new THREE.Color(0x4a7f2c);
    const cRock = new THREE.Color(0x8a8172), cRockDark = new THREE.Color(0x6b6358), cSnow = new THREE.Color(0xf2f5fa);
    const cSand = new THREE.Color(0xe3cf95), cDesert = new THREE.Color(0xe0a868), cDirt = new THREE.Color(0x8f7a55), cSeabed = new THREE.Color(0xb7a77a);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(GRID, i + 1)];
      const hd = H[Math.max(0, j - 1) * N + i], hu = H[Math.min(GRID, j + 1) * N + i];
      let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      Nn[k * 3] = nx; Nn[k * 3 + 1] = ny; Nn[k * 3 + 2] = nz;
      const x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[k];
      const b = this.biome(x, z);
      const slope = 1 - ny; // 0 flat .. 1 vertical
      const v = this.sx.noise(x * 0.05, z * 0.05) * 0.5 + 0.5;
      tmp.copy(cGrass).lerp(cGrass2, v * 0.7);
      tmp.lerp(cForest, b.forest * 0.6);
      tmp.lerp(cDesert, b.desert);
      if (b.north > 0.3) tmp.lerp(cDirt, (b.north - 0.3) * 0.5);
      // sand near water
      tmp.lerp(cSand, smoothstep(4, 1.5, h) * (1 - b.north));
      if (h < -1) tmp.lerp(cSeabed, 0.8);
      // snow
      const snow = smoothstep(SNOW_LINE - 15, SNOW_LINE + 10, h + this.sx.noise(x * 0.03, z * 0.03) * 12);
      tmp.lerp(cSnow, snow);
      // rock on slopes
      const rock = smoothstep(0.22, 0.36, slope + this.sx.noise(x * 0.08, z * 0.08) * 0.05);
      tmp.lerp(v > 0.5 ? cRock : cRockDark, rock * (snow > 0.5 ? 0.7 : 1));
      C[k * 3] = tmp.r; C[k * 3 + 1] = tmp.g; C[k * 3 + 2] = tmp.b;
      const grass = (1 - rock) * (1 - snow) * (1 - b.desert) * smoothstep(2.5, 4, h) * (b.north > 0.6 ? 0.4 : 1);
      this.grassDensity[k] = Math.round(clamp(grass, 0, 1) * 255);
    }
  }

  private buildTextures() {
    const hd = new Float32Array(N * N);
    hd.set(this.heights);
    this.dataTex = new THREE.DataTexture(hd, N, N, THREE.RedFormat, THREE.FloatType);
    this.dataTex.minFilter = this.dataTex.magFilter = THREE.NearestFilter;
    this.dataTex.needsUpdate = true;
    const cd = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      // store sRGB-ish (approx) for grass tint
      cd[k * 4] = Math.round(Math.pow(this.colors[k * 3], 1 / 2.2) * 255);
      cd[k * 4 + 1] = Math.round(Math.pow(this.colors[k * 3 + 1], 1 / 2.2) * 255);
      cd[k * 4 + 2] = Math.round(Math.pow(this.colors[k * 3 + 2], 1 / 2.2) * 255);
      cd[k * 4 + 3] = this.grassDensity[k];
    }
    this.colorTex = new THREE.DataTexture(cd, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.colorTex.minFilter = this.colorTex.magFilter = THREE.LinearFilter;
    this.colorTex.needsUpdate = true;
  }

  /** clear grass in a radius (under buildings) */
  clearGrass(x: number, z: number, r: number) {
    const i0 = Math.floor((x - r + HALF) / CELL), i1 = Math.ceil((x + r + HALF) / CELL);
    const j0 = Math.floor((z - r + HALF) / CELL), j1 = Math.ceil((z + r + HALF) / CELL);
    const d = this.colorTex.image.data as Uint8Array;
    for (let j = Math.max(0, j0); j <= Math.min(GRID, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(GRID, i1); i++) {
      const px = -HALF + i * CELL, pz = -HALF + j * CELL;
      if (Math.hypot(px - x, pz - z) < r) { d[(j * N + i) * 4 + 3] = 0; this.grassDensity[j * N + i] = 0; }
    }
    this.colorTex.needsUpdate = true;
  }

  private sampleGrid(x: number, z: number) { return this.heightAt(x, z); }

  heightAt(x: number, z: number): number {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= GRID || fz >= GRID) return -24;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const H = this.heights;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    // triangle-correct interpolation matching mesh triangulation (a,c,b) (b,c,d)
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = CELL * 0.75;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  colorAt(x: number, z: number, out: THREE.Color) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, GRID), j = clamp(Math.round((z + HALF) / CELL), 0, GRID);
    const k = j * N + i;
    return out.setRGB(this.colors[k * 3], this.colors[k * 3 + 1], this.colors[k * 3 + 2]);
  }
  grassAt(x: number, z: number) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, GRID), j = clamp(Math.round((z + HALF) / CELL), 0, GRID);
    return this.grassDensity[j * N + i] / 255;
  }

  /** raycast against heightfield. returns distance or -1 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let t = 0; const step = 1.0;
    let prevAbove = origin.y - this.heightAt(origin.x, origin.z);
    if (prevAbove < 0) return 0;
    while (t < maxDist) {
      const nt = t + step;
      const x = origin.x + dir.x * nt, y = origin.y + dir.y * nt, z = origin.z + dir.z * nt;
      const above = y - this.heightAt(x, z);
      if (above < 0) {
        // refine
        let lo = t, hi = nt;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          const a = origin.y + dir.y * m - this.heightAt(origin.x + dir.x * m, origin.z + dir.z * m);
          if (a < 0) hi = m; else lo = m;
        }
        return (lo + hi) / 2;
      }
      prevAbove = above; t = nt;
    }
    return -1;
  }

  // ---------- meshes ----------
  private buildChunks() {
    const C = Terrain.CHUNKS, CC = Terrain.CHUNK_CELLS;
    for (let cz = 0; cz < C; cz++) for (let cx = 0; cx < C; cx++) {
      const lods: (THREE.BufferGeometry | null)[] = [null, null, null, null];
      const mesh = new THREE.Mesh(this.buildChunkGeo(cx, cz, 8), this.material);
      lods[3] = mesh.geometry;
      mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      const x = -HALF + (cx + 0.5) * CC * CELL, z = -HALF + (cz + 0.5) * CC * CELL;
      const center = new THREE.Vector3(x, this.heightAt(x, z), z);
      this.group.add(mesh);
      this.chunks.push({ mesh, lods, cx, cz, lod: 3, center });
    }
  }

  private buildChunkGeo(cx: number, cz: number, step: number): THREE.BufferGeometry {
    const CC = Terrain.CHUNK_CELLS;
    const segs = CC / step;
    const vx = segs + 1;
    const count = vx * vx + vx * 4; // + skirt
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const idx: number[] = [];
    const i0 = cx * CC, j0 = cz * CC;
    let v = 0;
    const put = (gi: number, gj: number, yOff: number) => {
      const k = gj * N + gi;
      pos[v * 3] = -HALF + gi * CELL; pos[v * 3 + 1] = this.heights[k] + yOff; pos[v * 3 + 2] = -HALF + gj * CELL;
      nor[v * 3] = this.normals[k * 3]; nor[v * 3 + 1] = this.normals[k * 3 + 1]; nor[v * 3 + 2] = this.normals[k * 3 + 2];
      col[v * 3] = this.colors[k * 3]; col[v * 3 + 1] = this.colors[k * 3 + 1]; col[v * 3 + 2] = this.colors[k * 3 + 2];
      return v++;
    };
    for (let j = 0; j <= segs; j++) for (let i = 0; i <= segs; i++) put(i0 + i * step, j0 + j * step, 0);
    for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
      const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirts
    const skirt = step * 1.2 + 1;
    const edge = (list: number[], flip: boolean) => {
      const base = v;
      for (const e of list) {
        const gi = i0 + (e % vx) * step, gj = j0 + Math.floor(e / vx) * step;
        put(gi, gj, -skirt);
      }
      for (let n = 0; n < list.length - 1; n++) {
        const a = list[n], b = list[n + 1], c = base + n, d = base + n + 1;
        if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    };
    const top: number[] = [], bot: number[] = [], left: number[] = [], right: number[] = [];
    for (let i = 0; i <= segs; i++) { top.push(i); bot.push(segs * vx + i); }
    for (let j = 0; j <= segs; j++) { left.push(j * vx); right.push(j * vx + segs); }
    edge(top, false); edge(bot, true); edge(left, true); edge(right, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
    g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  updateLOD(camPos: THREE.Vector3, quality: number) {
    const steps = [1, 2, 4, 8];
    const dists = quality >= 2 ? [130, 300, 600] : quality === 1 ? [90, 220, 450] : [60, 150, 320];
    for (const c of this.chunks) {
      const d = Math.hypot(camPos.x - c.center.x, camPos.z - c.center.z) - Terrain.CHUNK_CELLS * CELL * 0.5;
      let lod = d < dists[0] ? 0 : d < dists[1] ? 1 : d < dists[2] ? 2 : 3;
      if (lod !== c.lod) {
        if (!c.lods[lod]) c.lods[lod] = this.buildChunkGeo(c.cx, c.cz, steps[lod]);
        c.mesh.geometry = c.lods[lod]!;
        c.lod = lod;
      }
    }
  }

  isInWorld(x: number, z: number) { return Math.abs(x) < HALF - 5 && Math.abs(z) < HALF - 5; }
}

export { SEA_LEVEL, WORLD_SIZE };
