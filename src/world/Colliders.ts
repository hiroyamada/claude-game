import * as THREE from 'three';

// Static & semi-static collision world: vertical cylinders and AABBs in a spatial hash.

export interface Cyl { type: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; id: number; tag?: string; }
export interface Box {
  type: 'box'; min: THREE.Vector3; max: THREE.Vector3; id: number;
  climbable: boolean; tag?: string; ref?: any; slippery?: boolean;
}
export type Collider = Cyl | Box;

const CELL = 16;

export class Colliders {
  private grid = new Map<number, Collider[]>();
  private all = new Map<number, { c: Collider; keys: number[] }>();
  private nextId = 1;
  private key(i: number, j: number) { return ((i + 1000) << 12) | (j + 1000); }

  private insert(c: Collider) {
    let minx: number, maxx: number, minz: number, maxz: number;
    if (c.type === 'cyl') { minx = c.x - c.r; maxx = c.x + c.r; minz = c.z - c.r; maxz = c.z + c.r; }
    else { minx = c.min.x; maxx = c.max.x; minz = c.min.z; maxz = c.max.z; }
    const keys: number[] = [];
    if (![minx, maxx, minz, maxz].every(Number.isFinite) || maxx - minx > 4000 || maxz - minz > 4000) { this.all.set(c.id, { c, keys }); return; }
    for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++)
      for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) {
        const k = this.key(i, j); keys.push(k);
        let arr = this.grid.get(k); if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(c);
      }
    this.all.set(c.id, { c, keys });
  }

  addCyl(x: number, z: number, r: number, y0: number, y1: number, tag?: string): Cyl {
    const c: Cyl = { type: 'cyl', x, z, r, y0, y1, id: this.nextId++, tag };
    this.insert(c); return c;
  }
  addBox(min: THREE.Vector3, max: THREE.Vector3, climbable = true, tag?: string, ref?: any): Box {
    const c: Box = { type: 'box', min: min.clone(), max: max.clone(), id: this.nextId++, climbable, tag, ref };
    this.insert(c); return c;
  }
  addBoxCentered(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, climbable = true, tag?: string, ref?: any) {
    return this.addBox(new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2), new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2), climbable, tag, ref);
  }
  remove(c: Collider) {
    const e = this.all.get(c.id); if (!e) return;
    for (const k of e.keys) { const arr = this.grid.get(k); if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); } }
    this.all.delete(c.id);
  }
  /** call after moving a box collider */
  update(c: Collider) { this.remove(c); this.insert(c); }

  query(x: number, z: number, r: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !(r < 2000)) return out;
    const seen = new Set<number>();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const arr = this.grid.get(this.key(i, j)); if (!arr) continue;
        for (const c of arr) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
      }
    return out;
  }

  /** highest walkable top at (x,z) that is <= maxY (for standing on boxes) */
  groundTop(x: number, z: number, maxY: number, rad = 0.3): { y: number; c: Collider | null } {
    let best = -Infinity; let bc: Collider | null = null;
    for (const c of this.query(x, z, rad + 0.1, tmpList)) {
      if (c.type === 'box') {
        if (x >= c.min.x - rad && x <= c.max.x + rad && z >= c.min.z - rad && z <= c.max.z + rad && c.max.y <= maxY && c.max.y > best) { best = c.max.y; bc = c; }
      } else {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < c.r + rad * 0.5 && c.y1 <= maxY && c.y1 > best && c.tag === 'stump') { best = c.y1; bc = c; }
      }
    }
    return { y: best, c: bc };
  }

  /** Push a vertical capsule (center x,z, feet y, height h, radius r) out of colliders. Returns hit normal of last push or null. */
  pushOut(p: THREE.Vector3, r: number, h: number, outNormal?: THREE.Vector3, ignore?: Collider | null, step = 0): boolean {
    let hit = false;
    for (const c of this.query(p.x, p.z, r + 0.5, tmpList2)) {
      if (c === ignore) continue;
      if (c.type === 'cyl') {
        if (p.y + h < c.y0 || p.y > c.y1 - 0.05 - step) continue;
        const dx = p.x - c.x, dz = p.z - c.z; const d = Math.hypot(dx, dz); const md = c.r + r;
        if (d < md && d > 1e-5) {
          p.x = c.x + (dx / d) * md; p.z = c.z + (dz / d) * md; hit = true;
          outNormal?.set(dx / d, 0, dz / d);
        }
      } else {
        if (p.y + h <= c.min.y || p.y >= c.max.y - 0.05 - step) continue;
        const cx = Math.max(c.min.x, Math.min(p.x, c.max.x));
        const cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
        const dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r;
            outNormal?.set(dx / d, 0, dz / d);
          } else {
            // inside: push along smallest axis
            const pxl = p.x - c.min.x, pxr = c.max.x - p.x, pzl = p.z - c.min.z, pzr = c.max.z - p.z;
            const m = Math.min(pxl, pxr, pzl, pzr);
            if (m === pxl) { p.x = c.min.x - r; outNormal?.set(-1, 0, 0); }
            else if (m === pxr) { p.x = c.max.x + r; outNormal?.set(1, 0, 0); }
            else if (m === pzl) { p.z = c.min.z - r; outNormal?.set(0, 0, -1); }
            else { p.z = c.max.z + r; outNormal?.set(0, 0, 1); }
          }
          hit = true;
        }
      }
    }
    return hit;
  }

  /** ceiling check: lowest box bottom above y at x,z */
  ceiling(x: number, z: number, y: number, r: number): number {
    let best = Infinity;
    for (const c of this.query(x, z, r, tmpList)) {
      if (c.type !== 'box') continue;
      if (x >= c.min.x - r * 0.5 && x <= c.max.x + r * 0.5 && z >= c.min.z - r * 0.5 && z <= c.max.z + r * 0.5 && c.min.y >= y && c.min.y < best) best = c.min.y;
    }
    return best;
  }

  /** find climbable box face in front of p within dist along dir */
  climbFace(p: THREE.Vector3, dir: THREE.Vector3, dist: number, yOff: number): { box: Box; normal: THREE.Vector3; point: THREE.Vector3 } | null {
    const y = p.y + yOff;
    let best: { box: Box; normal: THREE.Vector3; point: THREE.Vector3 } | null = null; let bd = Infinity;
    for (const c of this.query(p.x, p.z, dist + 1, tmpList)) {
      if (c.type !== 'box' || !c.climbable) continue;
      if (y < c.min.y || y > c.max.y) continue;
      // closest point on box in xz
      const cx = Math.max(c.min.x, Math.min(p.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
      const dx = p.x - cx, dz = p.z - cz; const d = Math.hypot(dx, dz);
      if (d > dist || d < 1e-4) continue;
      const n = new THREE.Vector3(dx / d, 0, dz / d);
      // snap normal to axis
      if (Math.abs(n.x) > Math.abs(n.z)) n.set(Math.sign(n.x), 0, 0); else n.set(0, 0, Math.sign(n.z));
      if (n.x * dir.x + n.z * dir.z > -0.3) continue; // must face it
      if (d < bd) { bd = d; best = { box: c, normal: n, point: new THREE.Vector3(cx, y, cz) }; }
    }
    return best;
  }

  /** ray vs boxes (for camera / aiming). returns distance or Infinity */
  raycastBoxes(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, filter?: (c: Box) => boolean): { t: number; box: Box | null } {
    let best = maxDist; let bb: Box | null = null;
    const steps = Math.ceil(maxDist / CELL) + 1;
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const px = o.x + d.x * s * CELL, pz = o.z + d.z * s * CELL;
      for (const c of this.query(px, pz, CELL, tmpList)) {
        if (seen.has(c.id) || c.type !== 'box') continue; seen.add(c.id);
        if (filter && !filter(c)) continue;
        const t = rayAABB(o, d, c.min, c.max);
        if (t >= 0 && t < best) { best = t; bb = c; }
      }
      if (s * CELL > best) break;
    }
    return { t: bb ? best : Infinity, box: bb };
  }
}

const tmpList: Collider[] = [];
const tmpList2: Collider[] = [];

export function rayAABB(o: THREE.Vector3, d: THREE.Vector3, mn: THREE.Vector3, mx: THREE.Vector3): number {
  let tmin = -Infinity, tmax = Infinity;
  for (const ax of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[ax]) < 1e-9) { if (o[ax] < mn[ax] || o[ax] > mx[ax]) return -1; continue; }
    let t1 = (mn[ax] - o[ax]) / d[ax], t2 = (mx[ax] - o[ax]) / d[ax];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
