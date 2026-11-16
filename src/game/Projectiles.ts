import * as THREE from 'three';
import { assets } from '../engine/Assets';
import { audio } from '../engine/Audio';
import type { Game } from '../Game';
import { itemDef, type WeaponDef } from './Items';

interface Proj {
  kind: 'bolt' | 'fire' | 'thrown';
  obj: THREE.Object3D;
  pos: THREE.Vector3; vel: THREE.Vector3;
  dmg: number; owner: 'player' | 'enemy';
  life: number; grav: number; itemId?: string; stuck?: number;
}

export class Projectiles {
  list: Proj[] = [];
  private fireGeo = new THREE.SphereGeometry(0.28, 10, 8);
  private fireMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });

  constructor(private g: Game) {}

  bolt(pos: THREE.Vector3, vel: THREE.Vector3, dmg: number, owner: 'player' | 'enemy') {
    const o = new THREE.Group();
    const m = assets.item(owner === 'player' ? 'arrow' : 'Skeleton_Arrow');
    m.rotation.x = Math.PI / 2; // model points +y -> +z
    o.add(m);
    o.position.copy(pos);
    this.g.scene.add(o);
    this.list.push({ kind: 'bolt', obj: o, pos: pos.clone(), vel: vel.clone(), dmg, owner, life: 6, grav: 9 });
  }

  fireball(pos: THREE.Vector3, vel: THREE.Vector3, small: boolean, dmg = 3) {
    const o = new THREE.Mesh(this.fireGeo, this.fireMat);
    o.scale.setScalar(small ? 0.7 : 1.2);
    o.position.copy(pos);
    this.g.scene.add(o);
    const v = small ? vel.clone().normalize().multiplyScalar(18) : vel.clone();
    this.list.push({ kind: 'fire', obj: o, pos: pos.clone(), vel: v, dmg: small ? 6 : dmg, owner: small ? 'player' : 'enemy', life: small ? 0.7 : 5, grav: 0 });
  }

  thrown(pos: THREE.Vector3, vel: THREE.Vector3, dmg: number, itemId: string) {
    const d = itemDef(itemId) as WeaponDef;
    const o = new THREE.Group();
    o.add(assets.item(d.model));
    o.position.copy(pos);
    this.g.scene.add(o);
    this.list.push({ kind: 'thrown', obj: o, pos: pos.clone(), vel: vel.clone(), dmg, owner: 'player', life: 3, grav: 14, itemId });
  }

  private end(p: Proj, i: number, dropItem = true) {
    p.obj.removeFromParent();
    this.list.splice(i, 1);
    if (p.kind === 'thrown' && p.itemId && dropItem) this.g.pickups.dropGear(p.itemId, p.pos, true);
  }

  update(dt: number) {
    const g = this.g;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.stuck !== undefined) { p.stuck -= dt; if (p.stuck <= 0) this.end(p, i); continue; }
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === 'fire') g.fx.burst(p.pos, 10, 0xff8030, 2, 0.3, 0.4, 0);
        this.end(p, i); continue;
      }
      p.vel.y -= p.grav * dt;
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      p.obj.position.copy(p.pos);
      if (p.kind === 'bolt') p.obj.lookAt(p.pos.clone().add(p.vel));
      else if (p.kind === 'thrown') { p.obj.rotation.x += dt * 18; p.obj.rotation.y = Math.atan2(p.vel.x, p.vel.z); }
      else if (p.kind === 'fire') {
        if (Math.random() < 0.8) g.fx.spawn(p.pos, new THREE.Vector3((Math.random() - 0.5), Math.random() * 1.5, (Math.random() - 0.5)), Math.random() < 0.5 ? 0xff6020 : 0xffc040, 0.45, 0.35);
      }
      // hit test vs actors
      let hit = false;
      if (p.owner === 'player') {
        for (const e of g.enemies.targets()) {
          const r = (e.radius || 0.5) + 0.3;
          const c = e.pos.clone(); c.y += (e.height || 1.6) * 0.5;
          if (segPointDist(prev, p.pos, c) < r + (e.height || 1.6) * 0.3) {
            const dir = p.vel.clone().setY(0).normalize();
            g.damageEnemy(e, p.dmg, dir, p.kind === 'thrown' ? 1.5 : 0.7);
            if (p.kind === 'fire' && e.burn !== undefined) e.burn = 3;
            audio.play('arrowHit');
            hit = true; break;
          }
        }
      } else {
        const P = g.player;
        const c = P.pos.clone(); c.y += 1;
        if (P.state !== 'dead' && segPointDist(prev, p.pos, c) < 0.75) {
          g.hitPlayer(p.dmg, prev, null, p.kind === 'fire');
          hit = true;
        }
      }
      if (hit) {
        if (p.kind === 'fire') g.fx.burst(p.pos, 18, 0xff7030, 3, 0.4, 0.5, 0);
        this.end(p, i, true); continue;
      }
      // physics bodies (stasis momentum, etc)
      if (p.owner === 'player' && g.phys.hitProjectile(prev, p.pos, p.vel, p.dmg)) { this.end(p, i); continue; }
      // world collision
      const th = g.inShrine ? -1e9 : g.terrain.heightAt(p.pos.x, p.pos.z);
      const box = g.colliders.raycastBoxes(prev, p.vel.clone().normalize(), prev.distanceTo(p.pos) + 0.01, (b) => b.tag !== 'body' || true);
      if (p.pos.y < th || box.t < Infinity) {
        if (box.t < Infinity) p.pos.copy(prev).addScaledVector(p.vel.clone().normalize(), box.t);
        if (p.kind === 'bolt') { p.stuck = 4; audio.play('arrowHit', 0.4); }
        else if (p.kind === 'fire') { g.fx.burst(p.pos, 14, 0xff7030, 3, 0.35, 0.4, 0); this.end(p, i); }
        else { p.pos.y = Math.max(p.pos.y, th + 0.2); this.end(p, i); }
        continue;
      }
      if (p.pos.y < g.waterLevelAt(p.pos.x, p.pos.z)) {
        g.fx.burst(p.pos, 8, 0xffffff, 2, 0.2, 0.4, 6);
        this.end(p, i); continue;
      }
    }
  }

  clear() { for (let i = this.list.length - 1; i >= 0; i--) this.end(this.list[i], i, false); }
}

function segPointDist(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const ab = _s1.subVectors(b, a); const ap = _s2.subVectors(p, a);
  const t = Math.max(0, Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-8)));
  return _s3.copy(a).addScaledVector(ab, t).distanceTo(p);
}
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3();
