import * as THREE from 'three';
import { makeToonMaterial } from '../engine/Materials';
import { audio } from '../engine/Audio';
import type { Game } from '../Game';
import { SHRINES, type ShrineDef } from '../world/WorldData';
import type { Collider } from '../world/Colliders';
import type { Body } from './Physics';
import type { Enemy } from './Enemies';
import { RUNE_INFO, type RuneId } from './Runes';

const BASE_Y = 300;

export class Shrines {
  current: ShrineDef | null = null;
  private group: THREE.Group | null = null;
  private colliders: Collider[] = [];
  private bodies: Body[] = [];
  private interactables: any[] = [];
  pools: { minX: number; maxX: number; minZ: number; maxZ: number; level: number }[] = [];
  updrafts: { pos: THREE.Vector3; r: number; h: number }[] = [];
  private origin = new THREE.Vector3();
  private enemies: Enemy[] = [];
  private altarOpen = true;
  private barrier: THREE.Mesh | null = null;
  private barrierCol: Collider | null = null;
  private returnPos = new THREE.Vector3();
  private M: Record<string, THREE.Material> = {};
  private anim: (() => void)[] = [];

  constructor(private g: Game) {
    this.M.floor = makeToonMaterial({ color: 0xb4ab98, worldNoise: true, rim: 0.15 });
    this.M.wall = makeToonMaterial({ color: 0x7a7488, worldNoise: true });
    this.M.trim = makeToonMaterial({ color: 0x5ad0ff, emissive: 0x2a90ff, emissiveIntensity: 1.3 });
    this.M.orange = makeToonMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 1.3 });
    this.M.altar = makeToonMaterial({ color: 0x7a7ea0, rim: 0.4 });
    this.M.barrier = new THREE.MeshBasicMaterial({ color: 0xff7040, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  }

  floorY() { return BASE_Y; }

  enter(id: number) {
    const def = SHRINES[id];
    const g = this.g;
    g.fade(() => {
      this.returnPos.set(def.x, g.terrain.heightAt(def.x, def.z) + 0.5, def.z + 2);
      this.build(def);
      g.enterShrine();
      g.banner(def.name, def.kind === 'combat' || def.kind === 'wind' ? 'Trial' : 'Sanctum of ' + RUNE_INFO[def.kind as RuneId]?.name);
      audio.musicMood = 'shrine';
      g.state.discoveredShrines[id] = true;
    });
  }

  leave() {
    const g = this.g;
    g.fade(() => {
      this.destroy();
      g.exitShrine(this.returnPos);
    });
  }

  private destroy() {
    const g = this.g;
    if (this.group) { this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); this.group.removeFromParent(); this.group = null; }
    for (const c of this.colliders) g.colliders.remove(c);
    for (const b of this.bodies) if (!b.dead) g.phys.remove(b);
    for (const it of this.interactables) g.removeInteractable(it);
    for (const e of this.enemies) if (g.enemies.list.includes(e)) g.enemies.remove(e);
    for (const b of g.runes.pillars) if (!b.dead) g.phys.remove(b);
    g.runes.pillars = [];
    if (g.runes.bomb && !g.runes.bomb.dead) { g.phys.remove(g.runes.bomb); g.runes.bomb = null; }
    g.runes.cancel();
    this.colliders = []; this.bodies = []; this.interactables = []; this.enemies = []; this.pools = []; this.updrafts = []; this.anim = [];
    this.barrier = null; this.barrierCol = null;
    this.current = null;
  }

  // ---------- builders (local coords relative to origin) ----------
  private box(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, climb = true, collide = true) {
    const O = this.origin;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(O.x + x, O.y + y + sy / 2, O.z + z);
    m.castShadow = true; m.receiveShadow = true;
    this.group!.add(m);
    if (collide) this.colliders.push(this.g.colliders.addBoxCentered(O.x + x, O.y + y + sy / 2, O.z + z, sx, sy, sz, climb, climb ? undefined : 'wall'));
    return m;
  }
  private floor(x: number, z: number, w: number, d: number, y = 0, thick = 2) {
    this.box(x, y - thick, z, w, thick, d, this.M.floor);
    // glowing edge trim
    const O = this.origin;
    const t = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.08, d + 0.05), this.M.trim);
    t.position.set(O.x + x, O.y + y - 0.12, O.z + z); this.group!.add(t);
  }
  private wallsAround(minX: number, maxX: number, minZ: number, maxZ: number, h = 16) {
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, w = maxX - minX, d = maxZ - minZ;
    this.box(cx, -12, minZ - 0.5, w + 2, h + 12, 1, this.M.wall, false);
    this.box(cx, -12, maxZ + 0.5, w + 2, h + 12, 1, this.M.wall, false);
    this.box(minX - 0.5, -12, cz, 1, h + 12, d, this.M.wall, false);
    this.box(maxX + 0.5, -12, cz, 1, h + 12, d, this.M.wall, false);
    // ceiling
    const O = this.origin;
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1, d + 2), this.M.wall);
    ceil.position.set(O.x + cx, O.y + h + 0.5, O.z + cz); this.group!.add(ceil); ceil.castShadow = false;
    // pillars w/ glow lines
    for (const [px, pz] of [[minX, minZ], [maxX, minZ], [minX, maxZ], [maxX, maxZ]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, 0.2), this.M.trim);
      line.position.set(O.x + px + (px === minX ? 0.1 : -0.1), O.y + h / 2, O.z + pz + (pz === minZ ? 0.1 : -0.1)); this.group!.add(line);
    }
  }
  private L(x: number, y: number, z: number) { return new THREE.Vector3(this.origin.x + x, this.origin.y + y, this.origin.z + z); }
  private addInt(it: any) { this.g.addInteractable(it); this.interactables.push(it); }
  private body(kind: Body['kind'], x: number, y: number, z: number, size: THREE.Vector3 | number, opts: Partial<Body> = {}) {
    const b = this.g.phys.add(kind, this.L(x, y, z), size, { home: this.L(x, y, z), ...opts });
    this.bodies.push(b);
    return b;
  }

  private build(def: ShrineDef) {
    const g = this.g;
    this.destroy();
    this.current = def;
    this.group = new THREE.Group();
    g.scene.add(this.group);
    this.origin.set(3000 + def.id * 300, BASE_Y, 0);
    this.altarOpen = true;
    switch (def.kind) {
      case 'bomb': this.buildBomb(); break;
      case 'magnet': this.buildMagnet(); break;
      case 'stasis': this.buildStasis(); break;
      case 'ice': this.buildIce(); break;
      case 'combat': this.buildCombat(); break;
      case 'wind': this.buildWind(); break;
    }
    // start pad & exit
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.15, 24), this.M.trim);
    pad.position.copy(this.L(0, 0.05, 3.6)); this.group.add(pad);
    this.addInt({ pos: this.L(0, 0, 3.6), r: 1.3, label: 'Leave Sanctum', act: () => this.leave() });
    g.player.spawn(this.origin.x, this.origin.y + 0.1, this.origin.z + 1.2, Math.PI);
    g.camRig.reset();
  }

  private runePedestal(x: number, z: number, rune: RuneId) {
    const g = this.g;
    if (g.state.runes.includes(rune)) return;
    const ped = this.box(x, 0, z, 1.2, 1.1, 1.2, this.M.altar);
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), makeToonMaterial({ color: RUNE_INFO[rune].color, emissive: RUNE_INFO[rune].color, emissiveIntensity: 1.2 }));
    orb.position.copy(this.L(x, 1.6, z)); this.group!.add(orb);
    this.anim.push(() => { orb.rotation.y += 0.03; orb.position.y = this.origin.y + 1.6 + Math.sin(performance.now() * 0.003) * 0.1; });
    const it = {
      pos: this.L(x, 0, z), r: 2.2, label: 'Take Rune', enabled: () => !g.state.runes.includes(rune),
      act: () => {
        g.state.runes.push(rune);
        g.runes.selected = rune;
        orb.visible = false; void ped;
        audio.play('fanfare');
        g.player.playOnce('Cheer', 1);
        g.dialog([`Rune acquired: ${RUNE_INFO[rune].name}!`, RUNE_INFO[rune].desc, g.input.device === 'pad' ? 'Press L to use runes. Press D-pad ↑ to switch between them.' : g.input.device === 'touch' ? 'Tap the ✦ button to use runes; tap the rune icon to switch.' : 'Press F to use runes. Press 1–4 to switch between them.']);
      },
    };
    this.addInt(it);
  }

  private altar(x: number, y: number, z: number) {
    const g = this.g;
    const def = this.current!;
    this.box(x, y, z, 2.4, 0.8, 2.4, this.M.altar);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), makeToonMaterial({ color: 0x9ff0ff, emissive: 0x4ad0ff, emissiveIntensity: 1.5 }));
    orb.position.copy(this.L(x, y + 1.8, z)); this.group!.add(orb);
    this.anim.push(() => { orb.rotation.y += 0.02; orb.visible = !g.state.shrines[def.id] && this.altarOpen; });
    this.addInt({
      pos: this.L(x, y + 0.8, z), r: 2.4, label: 'Claim Spirit Orb', enabled: () => !g.state.shrines[def.id] && this.altarOpen,
      act: () => {
        g.state.shrines[def.id] = true;
        g.inv.add('orb', 1);
        audio.play('fanfare');
        g.player.playOnce('Cheer', 1);
        g.fx.burst(orb.position.clone(), 50, 0x9ff0ff, 5, 0.3, 1.2, -1);
        g.hud.itemGet('Spirit Orb', 0x9ff0ff, 'Offer Spirit Orbs at a Goddess Statue to gain strength.');
        g.structures.refreshShrines();
        g.autosave();
        setTimeout(() => g.toast('Sanctum complete! Step on the glowing pad to leave.'), 1500);
      },
    });
  }

  // 1. Ember bomb: cracked walls
  private buildBomb() {
    this.floor(0, -15, 12, 36);
    this.wallsAround(-6, 6, -33, 3);
    this.runePedestal(0, -2, 'bomb');
    // first cracked wall spans the corridor
    this.box(-4.5, 0, -10, 3, 6, 1.2, this.M.wall, false);
    this.box(4.5, 0, -10, 3, 6, 1.2, this.M.wall, false);
    this.box(0, 6, -10, 12, 6, 1.2, this.M.wall, false);
    this.body('cracked', 0, 3, -10, new THREE.Vector3(6, 6, 1.2));
    // steps up to a raised hall
    for (let i = 0; i < 4; i++) this.box(0, 0, -14 - i * 2, 12, 0.5 * (i + 1), 2, this.M.floor);
    this.box(0, 0, -26.5, 12, 2, 11, this.M.floor);
    this.box(-4, 2, -24, 4, 10, 1.2, this.M.wall, false);
    this.box(4, 2, -24, 4, 10, 1.2, this.M.wall, false);
    this.body('cracked', 0, 3.5, -24, new THREE.Vector3(4, 3, 1.2));
    this.box(0, 5, -24, 4, 7, 1.2, this.M.wall, false);
    this.body('crate', 3.5, 2.6, -27, new THREE.Vector3(1.2, 1.2, 1.2), { drops: ['arrow', 'apple'] });
    this.altar(0, 2, -29);
  }

  // 2. Lodestone: bridge a chasm, pull a door
  private buildMagnet() {
    this.floor(0, -4, 14, 14);
    this.wallsAround(-7, 7, -40, 3);
    this.runePedestal(-3, -3, 'magnet');
    // chasm from z=-11 to -19 (no floor); far side
    this.floor(0, -28, 14, 18);
    const plate = this.body('metal', 3.5, 0.25, -5, new THREE.Vector3(2.2, 0.4, 11));
    plate.climbable = false;
    // metal door blocking the exit corridor
    this.box(-4.5, 0, -32, 5, 6, 1, this.M.wall, false);
    this.box(4.5, 0, -32, 5, 6, 1, this.M.wall, false);
    this.body('metal', 0, 2.5, -32, new THREE.Vector3(4, 5, 1));
    this.floor(0, -37, 14, 6);
    this.altar(0, 0, -37);
    // decorative glow in chasm
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), this.M.orange);
    glow.rotation.x = -Math.PI / 2; glow.position.copy(this.L(0, -20, -15)); this.group!.add(glow);
  }

  // 3. Stillness: freeze a sweeping slab; launch a boulder into a wall
  private buildStasis() {
    this.floor(0, -2, 12, 10);
    this.wallsAround(-8, 8, -44, 3);
    this.runePedestal(3, -3, 'stasis');
    // narrow bridge over pit
    this.box(0, -2, -14, 2.4, 2, 14, this.M.floor);
    const O = this.origin;
    const slab = this.body('platform', 0, 1.5, -14, new THREE.Vector3(1, 3, 4), {
      path: (t) => new THREE.Vector3(O.x + Math.sin(t * 2.4) * 5, O.y + 1.5, O.z - 14),
    });
    slab.climbable = false;
    this.floor(0, -30, 16, 18);
    // boulder + cracked wall
    this.body('boulder', -3, 1.3, -26, 1.2);
    this.box(-5.5, 0, -38, 5, 7, 1.4, this.M.wall, false);
    this.box(5.5, 0, -38, 5, 7, 1.4, this.M.wall, false);
    this.body('cracked', 0, 3.5, -38, new THREE.Vector3(6, 7, 1.4));
    this.floor(0, -41.5, 16, 5);
    this.altar(0, 0, -42);
  }

  // 4. Rime: pools with smooth high ledges
  private buildIce() {
    this.floor(0, -1, 16, 8);
    this.wallsAround(-8, 8, -40, 3);
    this.runePedestal(-3, -2, 'ice');
    const wmat = makeToonMaterial({ color: 0x3a8fb0, transparent: true, opacity: 0.72, emissive: 0x000000 });
    const O = this.origin;
    const pool = (z0: number, z1: number, floorTop: number, level: number) => {
      this.box(0, floorTop - 2, (z0 + z1) / 2, 16, 2, z1 - z0, this.M.floor);
      this.pools.push({ minX: O.x - 8, maxX: O.x + 8, minZ: O.z + z0, maxZ: O.z + z1, level: O.y + level });
      const w = new THREE.Mesh(new THREE.PlaneGeometry(16, z1 - z0), wmat);
      w.rotation.x = -Math.PI / 2; w.position.set(O.x, O.y + level, O.z + (z0 + z1) / 2); this.group!.add(w);
    };
    pool(-25, -5, -4, -0.6);
    this.box(0, -4, -28, 16, 6.6, 6, this.M.wall, false); // ledge 1: top 2.6
    pool(-36, -31, -0.4, 2.4);
    this.box(0, -4, -38, 16, 10, 4, this.M.wall, false); // ledge 2: top 6
    this.altar(0, 6, -38);
  }

  // 5. Trial of Blades
  private buildCombat() {
    const g = this.g;
    this.floor(0, -12, 24, 30);
    this.wallsAround(-12, 12, -27, 3);
    this.altarOpen = g.state.shrines[this.current!.id];
    this.altar(0, 0, -24);
    if (!this.altarOpen) {
      this.barrier = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 4, 16, 1, true), this.M.barrier);
      this.barrier.position.copy(this.L(0, 2, -24)); this.group!.add(this.barrier);
      this.barrierCol = g.colliders.addBoxCentered(this.origin.x, this.origin.y + 2, this.origin.z - 24, 3.6, 4, 3.6, false, 'wall');
      this.colliders.push(this.barrierCol);
      setTimeout(() => {
        if (this.current?.kind !== 'combat') return;
        for (const [k, x, z] of [['elite', -4, -14], ['warrior', 4, -14], ['mage', 0, -20]] as const) {
          const e = g.enemies.spawn(k, this.origin.x + x, this.origin.z + z);
          e.pos.y = this.origin.y; e.aware = true; e.setState('chase');
          this.enemies.push(e);
        }
        g.toast('Defeat the guardians!');
      }, 1500);
    }
  }

  // 6. Trial of Winds: glide across a vast chamber on updrafts
  private buildWind() {
    const g = this.g;
    this.floor(0, 0, 10, 10, 0);
    this.wallsAround(-30, 30, -120, 6, 30);
    const O = this.origin;
    const level = -40;
    this.pools.push({ minX: O.x - 30, maxX: O.x + 30, minZ: O.z - 120, maxZ: O.z - 5, level: O.y + level });
    this.box(0, level - 4, -62, 60, 2, 116, this.M.floor);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(60, 116), makeToonMaterial({ color: 0x2f70a0, transparent: true, opacity: 0.8 }));
    water.rotation.x = -Math.PI / 2; water.position.set(O.x, O.y + level, O.z - 62); this.group!.add(water);
    // climbable column back up to the start
    this.box(0, level - 2, -6, 4, -level + 2, 2, this.M.floor);
    const plats: [number, number, number][] = [[6, -14, -30], [-8, -18, -55], [4, -12, -80]];
    for (const [x, y, z] of plats) {
      this.floor(x, z, 7, 7, y, 1);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.25, 6, 16), this.M.trim);
      ring.rotation.x = Math.PI / 2; ring.position.copy(this.L(x, y + 0.2, z)); this.group!.add(ring);
      this.updrafts.push({ pos: this.L(x, y, z), r: 2.4, h: 26 });
    }
    this.floor(0, -108, 12, 14, -6, 2);
    this.altar(0, -6, -110);
    if (!g.state.glider) g.toast('You will need a glider for this trial...');
  }

  onEnemyDeath(e: Enemy) {
    if (!this.current || this.current.kind !== 'combat') return;
    if (!this.enemies.includes(e)) return;
    const alive = this.enemies.filter((x) => x.alive).length;
    if (alive === 0) {
      this.altarOpen = true;
      if (this.barrier) { this.barrier.removeFromParent(); this.barrier = null; }
      if (this.barrierCol) { this.g.colliders.remove(this.barrierCol); this.barrierCol = null; }
      audio.play('jingle');
      this.g.toast('The guardians are defeated. The orb is free!');
    }
  }

  waterLevelAt(x: number, z: number): number {
    let best = -Infinity;
    for (const p of this.pools) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) best = Math.max(best, p.level);
    return best;
  }

  update(_dt: number) {
    for (const a of this.anim) a();
    if (this.barrier) this.barrier.rotation.y += 0.01;
  }
}
