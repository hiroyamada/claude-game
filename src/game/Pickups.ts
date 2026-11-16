import * as THREE from 'three';
import { audio } from '../engine/Audio';
import { assets } from '../engine/Assets';
import { mulberry32 } from '../engine/noise';
import { makeToonMaterial } from '../engine/Materials';
import type { Game } from '../Game';
import { itemDef, type MaterialDef, type WeaponDef } from './Items';
import { HALF, SNOW_LINE, PLATEAU, LAKE } from '../world/WorldData';

interface Pick { id: string; n: number; obj: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; auto: boolean; worldKey?: number; t: number; gems?: number; settled: boolean; }

const geoCache = new Map<string, THREE.Object3D>();
function materialModel(id: string): THREE.Object3D {
  let src = geoCache.get(id);
  if (!src) {
    const d = itemDef(id) as MaterialDef;
    const grp = new THREE.Group();
    const m = makeToonMaterial({ color: d.color, emissive: id === 'mushroom' ? 0x1a6a70 : id === 'ore' || id === 'ember' ? d.color : 0x000000, emissiveIntensity: id === 'ore' ? 0.4 : 0.5 });
    const stem = makeToonMaterial({ color: 0xe8e0c8 });
    switch (id) {
      case 'apple': { const s = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), m); s.position.y = 0.18; grp.add(s); const l = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), makeToonMaterial({ color: 0x4a8a2a })); l.position.y = 0.4; grp.add(l); break; }
      case 'mushroom': case 'shroom_red': {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.25, 6), stem); st.position.y = 0.12; grp.add(st);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m); cap.position.y = 0.22; grp.add(cap); break;
      }
      case 'pepper': { const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 8), m); c.rotation.z = Math.PI * 0.6; c.position.y = 0.12; grp.add(c); break; }
      case 'herb': case 'feather': {
        for (let i = 0; i < 4; i++) { const l = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), m); l.position.y = 0.2; l.rotation.set(0.4, i * 1.6, 0); grp.add(l); }
        break;
      }
      case 'banana': { const b = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.05, 6, 10, Math.PI * 0.9), m); b.position.y = 0.12; grp.add(b); break; }
      case 'meat': { const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.18, 3, 8), m); b.rotation.z = Math.PI / 2; b.position.y = 0.12; grp.add(b); const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), stem); bone.rotation.z = Math.PI / 2; bone.position.y = 0.12; grp.add(bone); break; }
      case 'ore': {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), makeToonMaterial({ color: 0x6a6460 })); rock.position.y = 0.25; grp.add(rock);
        for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), m); c.position.set(Math.cos(i * 1.6) * 0.3, 0.5 + (i % 2) * 0.1, Math.sin(i * 1.6) * 0.3); c.scale.y = 1.8; grp.add(c); }
        break;
      }
      case 'arrow': { const a = assets.item('arrow'); a.rotation.z = Math.PI / 2; a.position.y = 0.1; grp.add(a); break; }
      default: { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), m); s.position.y = 0.2; grp.add(s); }
    }
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    geoCache.set(id, grp);
    src = grp;
  }
  return src.clone();
}

export class Pickups {
  list: Pick[] = [];
  private gemMat = makeToonMaterial({ color: 0x40ff90, emissive: 0x10a040, emissiveIntensity: 0.6 });
  private worldSpots: { id: string; pos: THREE.Vector3; key: number }[] = [];

  constructor(private g: Game) {
    this.scatterWorld();
  }

  private scatterWorld() {
    const rnd = mulberry32(777);
    const t = this.g.terrain;
    let key = 0;
    const n = new THREE.Vector3();
    for (let i = 0; i < 1400; i++) {
      const x = (rnd() * 2 - 1) * (HALF - 40), z = (rnd() * 2 - 1) * (HALF - 40);
      const h = t.heightAt(x, z);
      if (h < 2) continue;
      t.normalAt(x, z, n);
      if (n.y < 0.8) continue;
      const b = t.biome(x, z);
      let id: string | null = null;
      const r = rnd();
      if (h > SNOW_LINE - 20) id = r < 0.5 ? 'ore' : r < 0.8 ? 'feather' : 'herb';
      else if (b.desert > 0.6) id = r < 0.5 ? 'pepper' : r < 0.7 ? 'banana' : r < 0.8 ? 'ore' : null;
      else if (b.forest > 0.5) id = r < 0.45 ? 'mushroom' : r < 0.7 ? 'apple' : r < 0.85 ? 'shroom_red' : 'herb';
      else if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 40) id = r < 0.5 ? 'banana' : 'herb';
      else id = r < 0.35 ? 'apple' : r < 0.55 ? 'herb' : r < 0.7 ? 'mushroom' : r < 0.8 ? 'pepper' : r < 0.9 ? 'shroom_red' : null;
      if (!id) continue;
      this.worldSpots.push({ id, pos: new THREE.Vector3(x, h, z), key: key++ });
    }
    // guaranteed plateau goodies
    const pr = mulberry32(3);
    for (let i = 0; i < 40; i++) {
      const a = pr() * Math.PI * 2, rr = 20 + pr() * (PLATEAU.r - 30);
      const x = PLATEAU.x + Math.cos(a) * rr, z = PLATEAU.z + Math.sin(a) * rr;
      const id = ['apple', 'mushroom', 'pepper', 'herb', 'apple', 'shroom_red'][i % 6];
      this.worldSpots.push({ id, pos: new THREE.Vector3(x, t.heightAt(x, z), z), key: key++ });
    }
  }

  /** spawn world plants not yet collected today */
  populateWorld() {
    for (const p of this.list.slice()) if (p.worldKey !== undefined) this.removePick(p);
    const taken = new Set(this.g.state.collected);
    for (const s of this.worldSpots) {
      if (taken.has(s.key)) continue;
      const obj = materialModel(s.id);
      obj.position.copy(s.pos);
      this.g.scene.add(obj);
      this.list.push({ id: s.id, n: 1, obj, pos: s.pos.clone(), vel: new THREE.Vector3(), auto: false, worldKey: s.key, t: Math.random() * 10, settled: true });
    }
  }

  drop(id: string, at: THREE.Vector3, n = 1) {
    const d = itemDef(id);
    if (!d) return;
    if (d.kind === 'weapon' || d.kind === 'shield' || d.kind === 'bow') { this.dropGear(id, at); return; }
    const obj = materialModel(id);
    const pos = at.clone().add(new THREE.Vector3(0, 1, 0));
    obj.position.copy(pos);
    this.g.scene.add(obj);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 4, 5, (Math.random() - 0.5) * 4);
    this.list.push({ id, n, obj, pos, vel, auto: true, t: 0, settled: false });
  }

  dropGear(id: string, at: THREE.Vector3, still = false) {
    const d = itemDef(id) as WeaponDef;
    const obj = new THREE.Group();
    const m = assets.item(d.model); m.rotation.z = Math.PI / 2; obj.add(m);
    const pos = at.clone().add(new THREE.Vector3(0, still ? 0.3 : 1, 0));
    obj.position.copy(pos);
    this.g.scene.add(obj);
    const vel = still ? new THREE.Vector3() : new THREE.Vector3((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3);
    this.list.push({ id, n: 1, obj, pos, vel, auto: false, t: 0, settled: false });
  }

  dropGems(at: THREE.Vector3, amount: number) {
    const obj = new THREE.Mesh(new THREE.OctahedronGeometry(0.15 + Math.min(amount, 20) * 0.01), this.gemMat);
    obj.scale.y = 1.6;
    const pos = at.clone().add(new THREE.Vector3(0, 1, 0));
    obj.position.copy(pos);
    this.g.scene.add(obj);
    this.list.push({ id: 'gem', n: amount, obj, pos, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 5, (Math.random() - 0.5) * 3), auto: true, t: 0, gems: amount, settled: false });
  }

  private removePick(p: Pick) { p.obj.removeFromParent(); const i = this.list.indexOf(p); if (i >= 0) this.list.splice(i, 1); }

  collect(p: Pick): boolean {
    const g = this.g;
    if (p.gems) { g.inv.gems += p.gems; g.toast(`+${p.gems} gems`, 0x40ff90); audio.play('pickup'); this.removePick(p); return true; }
    const d = itemDef(p.id);
    const ok = g.inv.add(p.id, p.n);
    if (!ok) { g.toast(`Your ${d.kind === 'weapon' ? 'weapon' : d.kind === 'shield' ? 'shield' : 'crossbow'} pouch is full.`); return false; }
    audio.play('pickup');
    g.hud.itemGet(d.name + (p.n > 1 ? ` ×${p.n}` : ''), (d as any).color);
    if (p.worldKey !== undefined) g.state.collected.push(p.worldKey);
    this.removePick(p);
    return true;
  }

  /** nearest non-auto pickup for interaction prompt */
  nearest(pos: THREE.Vector3, r: number): Pick | null {
    let best: Pick | null = null, bd = r;
    for (const p of this.list) {
      if (p.auto) continue;
      const d = p.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  update(dt: number) {
    const g = this.g, P = g.player.pos;
    for (const p of this.list.slice()) {
      p.t += dt;
      if (!p.settled) {
        p.vel.y -= 20 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const gr = g.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.5).y;
        if (p.pos.y < gr) { p.pos.y = gr; p.vel.set(0, 0, 0); p.settled = true; }
        const wl = g.waterLevelAt(p.pos.x, p.pos.z);
        if (p.pos.y < wl) { p.pos.y = wl; p.vel.multiplyScalar(0.5); p.vel.y = 0; p.settled = true; }
      }
      p.obj.position.copy(p.pos);
      if (p.auto || p.worldKey === undefined) {
        p.obj.rotation.y += dt * 1.5;
        p.obj.position.y = p.pos.y + 0.15 + Math.sin(p.t * 3) * 0.05;
      }
      const d = p.pos.distanceTo(P);
      if (d > 70) { p.obj.visible = false; continue; }
      p.obj.visible = true;
      if (p.auto && p.t > 0.5 && d < 3.5) {
        p.pos.lerp(P.clone().add(new THREE.Vector3(0, 0.8, 0)), Math.min(1, dt * 8));
        if (d < 1.0) this.collect(p);
      }
      if (!p.auto && Math.random() < dt * 0.8 && d < 25) g.fx.sparkle(p.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffffc0, 1, 0.3);
      if (p.auto && p.t > 300) this.removePick(p);
    }
  }
}
