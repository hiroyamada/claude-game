import * as THREE from 'three';
import { audio } from '../engine/Audio';
import type { Game } from '../Game';
import type { Box } from '../world/Colliders';
import { makeToonMaterial } from '../engine/Materials';

export type BodyKind = 'crate' | 'metal' | 'boulder' | 'bomb' | 'platform' | 'cracked' | 'ice' | 'block';

export interface Body {
  kind: BodyKind;
  mesh: THREE.Object3D;
  pos: THREE.Vector3; vel: THREE.Vector3;
  half: THREE.Vector3; // half extents (spheres: radius in x)
  sphere: boolean;
  dynamic: boolean;
  metal: boolean;
  floats: boolean;
  frozen: number; impulse: THREE.Vector3;
  held: boolean;
  hp: number;
  collider: Box | null;
  delta: THREE.Vector3;
  path?: (t: number) => THREE.Vector3; pathT: number;
  dead: boolean;
  onBreak?: () => void;
  drops?: string[];
  climbable: boolean;
  tagId?: string;
  restT: number;
  baseColor?: THREE.Color;
  home?: THREE.Vector3;
}

const tmp = new THREE.Vector3();

export class Physics {
  bodies: Body[] = [];
  private mats: Record<string, THREE.Material> = {};
  private arrow: THREE.Mesh;

  constructor(private g: Game) {
    this.mats.crate = makeToonMaterial({ color: 0xa8743e, worldNoise: true });
    this.mats.metal = makeToonMaterial({ color: 0x6e7f99, rim: 0.5 });
    this.mats.boulder = makeToonMaterial({ color: 0x8c8478, worldNoise: true });
    this.mats.bomb = makeToonMaterial({ color: 0x3fb7ff, emissive: 0x1a5aa0, emissiveIntensity: 0.8 });
    this.mats.cracked = makeToonMaterial({ color: 0x8a7d70, worldNoise: true });
    this.mats.ice = makeToonMaterial({ color: 0xbfe8ff, emissive: 0x2a5070, emissiveIntensity: 0.5, transparent: true, opacity: 0.88 });
    this.mats.platform = makeToonMaterial({ color: 0x5a6b88, emissive: 0x102040, rim: 0.4 });
    this.mats.block = makeToonMaterial({ color: 0x8a8fa0, worldNoise: true });
    // stasis momentum arrow
    const ag = new THREE.ConeGeometry(0.4, 1, 8); ag.rotateX(Math.PI / 2); ag.translate(0, 0, 0.5);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.85, depthTest: false }));
    this.arrow.visible = false; this.arrow.renderOrder = 10;
    g.scene.add(this.arrow);
  }

  add(kind: BodyKind, pos: THREE.Vector3, size: THREE.Vector3 | number, opts: Partial<Body> = {}): Body {
    const sphere = typeof size === 'number';
    const half = sphere ? new THREE.Vector3(size as number, size as number, size as number) : (size as THREE.Vector3).clone().multiplyScalar(0.5);
    let geo: THREE.BufferGeometry;
    if (sphere) geo = kind === 'boulder' ? new THREE.IcosahedronGeometry(half.x, 1) : new THREE.SphereGeometry(half.x, 16, 12);
    else geo = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
    const mesh = new THREE.Mesh(geo, this.mats[kind]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (kind === 'crate') {
      const band = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2.02, half.y * 0.3, half.z * 2.02), makeToonMaterial({ color: 0x6b4a2a }));
      mesh.add(band);
    }
    if (kind === 'metal') {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2.04, half.y * 0.25, half.z * 2.04), makeToonMaterial({ color: 0xd0a040, emissive: 0x402000 }));
      rim.position.y = half.y * 0.6; mesh.add(rim);
    }
    if (kind === 'cracked') {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2.02, half.y * 1.6, 0.1), new THREE.MeshBasicMaterial({ color: 0x2a2018 }));
      cr.scale.set(0.05, 1, 1); cr.rotation.z = 0.3; mesh.add(cr);
      const cr2 = cr.clone(); cr2.rotation.z = -0.5; cr2.rotation.y = Math.PI / 2; mesh.add(cr2);
    }
    if (kind === 'bomb') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(half.x * 1.02, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: 0xbff0ff }));
      ring.rotation.x = Math.PI / 2; mesh.add(ring);
    }
    mesh.position.copy(pos);
    this.g.scene.add(mesh);
    const dynamic = kind === 'crate' || kind === 'metal' || kind === 'boulder' || kind === 'bomb';
    const b: Body = {
      kind, mesh, pos: pos.clone(), vel: new THREE.Vector3(), half, sphere, dynamic,
      metal: kind === 'metal', floats: kind === 'crate', frozen: 0, impulse: new THREE.Vector3(), held: false,
      hp: kind === 'crate' ? 6 : 999, collider: null, delta: new THREE.Vector3(), pathT: 0, dead: false,
      climbable: kind === 'ice' || kind === 'block' || kind === 'metal', restT: 0,
      ...opts,
    };
    b.baseColor = ((mesh.material as THREE.MeshToonMaterial).color || new THREE.Color()).clone();
    if (kind !== 'bomb') {
      b.collider = this.g.colliders.addBox(pos.clone().sub(half), pos.clone().add(half), b.climbable, 'body', b);
      if (sphere) b.collider.climbable = false;
    }
    this.bodies.push(b);
    return b;
  }

  remove(b: Body) {
    b.dead = true;
    b.mesh.removeFromParent();
    b.mesh.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    if (b.collider) this.g.colliders.remove(b.collider);
    const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1);
  }

  breakBody(b: Body) {
    if (b.dead) return;
    audio.play('break');
    const c = b.kind === 'crate' ? 0xa8743e : b.kind === 'ice' ? 0xd0f0ff : 0x9a9080;
    this.g.fx.burst(b.pos, 30, c, 6, 0.4, 0.8, 10);
    if (b.drops) for (const d of b.drops) this.g.pickups.drop(d, b.pos);
    b.onBreak?.();
    this.remove(b);
  }

  freeze(b: Body, t: number) {
    b.frozen = t; b.impulse.set(0, 0, 0); b.vel.set(0, 0, 0);
    const m = b.mesh as THREE.Mesh;
    (m.material as THREE.MeshToonMaterial) = (m.material as THREE.MeshToonMaterial);
  }

  /** melee hits: crates take damage, frozen bodies gain momentum */
  hitMelee(center: THREE.Vector3, f: THREE.Vector3, reach: number, arc: number, dmg: number): boolean {
    let hit = false;
    for (const b of this.bodies.slice()) {
      tmp.copy(b.pos).sub(center); const dy = tmp.y; tmp.y = 0;
      const dist = tmp.length() - Math.max(b.half.x, b.half.z);
      if (dist > reach || Math.abs(dy) > b.half.y + 1.5) continue;
      tmp.normalize();
      if (tmp.dot(f) < arc && dist > 0.5) continue;
      if (b.frozen > 0) {
        b.impulse.addScaledVector(f, dmg * 1.2 + 4);
        audio.play('stasis'); this.g.fx.sparkle(b.pos, 0xffd040, 6, b.half.x * 2);
        hit = true;
      } else if (b.kind === 'crate') {
        b.hp -= dmg; hit = true; audio.play('hit', 0.5);
        b.vel.addScaledVector(f, 2);
        if (b.hp <= 0) this.breakBody(b);
      } else if (b.kind === 'bomb') {
        b.vel.addScaledVector(f, 8).add(new THREE.Vector3(0, 3, 0)); hit = true;
      } else if (b.kind === 'boulder') {
        b.vel.addScaledVector(f, 3); hit = true; audio.play('hit', 0.3);
      }
    }
    return hit;
  }

  hitProjectile(a: THREE.Vector3, b2: THREE.Vector3, vel: THREE.Vector3, dmg: number): boolean {
    for (const b of this.bodies.slice()) {
      if (b.kind === 'ice' || b.kind === 'cracked' || b.kind === 'block') continue;
      const mn = b.pos.clone().sub(b.half), mx = b.pos.clone().add(b.half);
      const box = new THREE.Box3(mn, mx);
      const ray = new THREE.Ray(a, vel.clone().normalize());
      const hitP = ray.intersectBox(box, new THREE.Vector3());
      if (hitP && hitP.distanceTo(a) <= a.distanceTo(b2) + 0.2) {
        if (b.frozen > 0) { b.impulse.addScaledVector(vel.clone().normalize(), dmg * 1.2 + 4); audio.play('stasis'); return true; }
        if (b.kind === 'crate') { b.hp -= dmg; if (b.hp <= 0) this.breakBody(b); return true; }
        if (b.kind === 'bomb') { this.g.runes.detonate(b); return true; }
        return true;
      }
    }
    return false;
  }

  explode(p: THREE.Vector3, radius: number) {
    for (const b of this.bodies.slice()) {
      const d = b.pos.distanceTo(p) - Math.max(b.half.x, b.half.y, b.half.z);
      if (d > radius) continue;
      if (b.kind === 'cracked' || b.kind === 'crate') { this.breakBody(b); continue; }
      if (b.frozen > 0) { b.impulse.add(tmp.copy(b.pos).sub(p).normalize().multiplyScalar(20)); continue; }
      if (b.dynamic && b.kind !== 'bomb') b.vel.add(tmp.copy(b.pos).sub(p).normalize().multiplyScalar(10 / (b.sphere ? 1 : 2))).add(new THREE.Vector3(0, 4, 0));
    }
  }

  /** ray vs bodies (for rune targeting) */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, filter: (b: Body) => boolean): { b: Body; t: number } | null {
    let best: { b: Body; t: number } | null = null;
    const ray = new THREE.Ray(o, d);
    const v = new THREE.Vector3();
    for (const b of this.bodies) {
      if (!filter(b)) continue;
      const box = new THREE.Box3(b.pos.clone().sub(b.half).subScalar(0.3), b.pos.clone().add(b.half).addScalar(0.3));
      const h = ray.intersectBox(box, v);
      if (h) { const t = h.distanceTo(o); if (t < maxD && (!best || t < best.t)) best = { b, t }; }
    }
    return best;
  }

  update(dt: number) {
    const g = this.g;
    let showArrow: Body | null = null;
    for (const b of this.bodies.slice()) {
      const prev = tmp.copy(b.pos);
      const px = prev.x, py = prev.y, pz = prev.z;
      // stasis
      if (b.frozen > 0) {
        b.frozen -= dt;
        const m = b.mesh as THREE.Mesh; const mat = m.material as THREE.MeshToonMaterial;
        if (mat.emissive) { const blink = b.frozen < 2 ? (Math.sin(b.frozen * 30) > 0 ? 1 : 0.3) : 1; mat.emissive.setRGB(0.6 * blink, 0.45 * blink, 0.0); }
        if (b.impulse.lengthSq() > 0.01) showArrow = b;
        if (Math.floor(b.frozen * (b.frozen < 2 ? 6 : 2)) !== Math.floor((b.frozen + dt) * (b.frozen < 2 ? 6 : 2))) audio.play('stasis', 0.4);
        if (b.frozen <= 0) {
          if (mat.emissive) mat.emissive.setRGB(0, 0, 0);
          if (b.kind === 'bomb') (mat.emissive as THREE.Color).setHex(0x1a5aa0);
          if (b.kind === 'platform') (mat.emissive as THREE.Color).setHex(0x102040);
          const imp = b.impulse.clone(); if (imp.length() > 40) imp.setLength(40);
          if (b.dynamic) b.vel.copy(imp);
          if (imp.length() > 2) { audio.play('swingHeavy'); g.fx.burst(b.pos, 15, 0xffd040, 4, 0.3, 0.5, 0); }
          b.impulse.set(0, 0, 0);
        }
        b.delta.set(0, 0, 0);
        continue;
      }
      if (b.path) {
        b.pathT += dt;
        b.pos.copy(b.path(b.pathT));
      } else if (b.dynamic) {
        if (b.held) {
          // velocity is driven by magnet rune
        } else {
          b.vel.y -= 22 * dt;
        }
        b.pos.addScaledVector(b.vel, dt);
        // ground
        let ground = -1e9;
        if (!g.inShrine) {
          const r = b.sphere ? 0 : Math.min(b.half.x, b.half.z) * 0.8;
          ground = Math.max(
            g.terrain.heightAt(b.pos.x, b.pos.z),
            r ? g.terrain.heightAt(b.pos.x + r, b.pos.z + r) : -1e9, r ? g.terrain.heightAt(b.pos.x - r, b.pos.z - r) : -1e9,
            r ? g.terrain.heightAt(b.pos.x + r, b.pos.z - r) : -1e9, r ? g.terrain.heightAt(b.pos.x - r, b.pos.z + r) : -1e9,
          );
        }
        let onGround = false;
        const sx = b.sphere ? 0 : b.half.x * 0.85, sz = b.sphere ? 0 : b.half.z * 0.85;
        for (const [ox, oz] of [[0, 0], [sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz], [sx, 0], [-sx, 0], [0, sz], [0, -sz]]) {
          const top = g.colliders.groundTop(b.pos.x + ox, b.pos.z + oz, b.pos.y - b.half.y + 0.4, 0.1);
          if (top.c !== b.collider && top.y > ground) ground = top.y;
        }
        if (b.pos.y - b.half.y < ground) {
          b.pos.y = ground + b.half.y;
          if (b.vel.y < -6 && b.kind !== 'bomb') audio.play('land', Math.min(1, -b.vel.y / 20));
          b.vel.y = b.kind === 'bomb' ? -b.vel.y * 0.35 : Math.max(0, -b.vel.y * 0.15);
          onGround = true;
        }
        if (onGround && !b.held) {
          if (b.sphere) {
            // roll down slopes
            if (!g.inShrine) {
              const n = g.terrain.normalAt(b.pos.x, b.pos.z, new THREE.Vector3());
              b.vel.x += n.x * 14 * dt; b.vel.z += n.z * 14 * dt;
            }
            b.vel.x *= Math.exp(-0.6 * dt); b.vel.z *= Math.exp(-0.6 * dt);
          } else {
            b.vel.x *= Math.exp(-8 * dt); b.vel.z *= Math.exp(-8 * dt);
          }
        }
        // water
        const wl = g.waterLevelAt(b.pos.x, b.pos.z);
        if (b.pos.y < wl) {
          if (b.floats) { b.vel.y += (wl - b.pos.y) * 40 * dt; b.vel.multiplyScalar(Math.exp(-2 * dt)); }
          else b.vel.multiplyScalar(Math.exp(-3 * dt));
        }
        // push out from static colliders (cylinders & boxes)
        const foot = new THREE.Vector3(b.pos.x, b.pos.y - b.half.y + 0.05, b.pos.z);
        const n = new THREE.Vector3();
        if (g.colliders.pushOut(foot, Math.max(b.half.x, b.half.z) * 0.95, b.half.y * 2 - 0.1, n, b.collider)) {
          b.pos.x = foot.x; b.pos.z = foot.z;
          const vn = b.vel.dot(n); if (vn < 0) b.vel.addScaledVector(n, -vn * (b.kind === 'bomb' ? 1.5 : 1.1));
        }
        // fast boulder breaks cracked walls / hurts enemies
        const spd = b.vel.length();
        if (spd > 9) {
          for (const o of this.bodies.slice()) {
            if (o === b || o.kind !== 'cracked') continue;
            if (Math.abs(o.pos.x - b.pos.x) < o.half.x + b.half.x + 0.3 && Math.abs(o.pos.z - b.pos.z) < o.half.z + b.half.z + 0.3 && Math.abs(o.pos.y - b.pos.y) < o.half.y + b.half.y) this.breakBody(o);
          }
          for (const e of g.enemies.targets()) {
            if (e.pos.distanceTo(b.pos) < b.half.x + 1) g.damageEnemy(e, spd * 1.5, b.vel.clone().normalize(), 1.6);
          }
        }
        if (b.pos.y < -80 || (g.inShrine && b.pos.y < g.shrines.floorY() - 30)) {
          if (b.home && b.kind !== 'bomb') { b.pos.copy(b.home); b.vel.set(0, 0, 0); if (b.held) g.runes.release(); g.fx.burst(b.pos, 20, 0x9ff0ff, 3, 0.3, 0.6, 0); }
          else { b.onBreak?.(); this.remove(b); continue; }
        }
        // bombs detonate in water etc.
      }
      if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z) || !Number.isFinite(b.vel.x + b.vel.y + b.vel.z)) { if (b.home) { b.pos.copy(b.home); b.vel.set(0, 0, 0); } else { this.remove(b); continue; } }
      // mesh
      b.mesh.position.copy(b.pos);
      if (b.sphere && b.dynamic && !b.held) {
        const hv = Math.hypot(b.vel.x, b.vel.z);
        if (hv > 0.05) { const axis = new THREE.Vector3(b.vel.z, 0, -b.vel.x).normalize(); b.mesh.rotateOnWorldAxis(axis, (hv * dt) / b.half.x); }
      }
      b.delta.set(b.pos.x - px, b.pos.y - py, b.pos.z - pz);
      if (b.collider && b.delta.lengthSq() > 1e-10) {
        b.collider.min.copy(b.pos).sub(b.half); b.collider.max.copy(b.pos).add(b.half);
        g.colliders.update(b.collider);
      }
    }
    // stasis arrow
    if (showArrow) {
      const b = showArrow;
      this.arrow.visible = true;
      this.arrow.position.copy(b.pos);
      const L = Math.min(6, b.impulse.length() * 0.15 + 1);
      this.arrow.scale.set(1, 1, L);
      this.arrow.lookAt(b.pos.clone().add(b.impulse));
    } else this.arrow.visible = false;
  }

  clearShrineBodies(predicate: (b: Body) => boolean) { for (const b of this.bodies.slice()) if (predicate(b)) this.remove(b); }
}
