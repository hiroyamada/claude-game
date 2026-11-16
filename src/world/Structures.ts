import * as THREE from 'three';
import { makeToonMaterial } from '../engine/Materials';
import { assets, Animator } from '../engine/Assets';
import { audio } from '../engine/Audio';
import type { Game } from '../Game';
import { TOWERS, SHRINES, CAMPS, VILLAGE, CITADEL, PLATEAU, HERMIT_POS, STATUE_POS, START_POS, SNOW_LINE } from './WorldData';
import { mulberry32 } from '../engine/noise';
import { itemDef } from '../game/Items';

export interface Interactable { pos: THREE.Vector3; r: number; label: string; act: () => void; enabled?: () => boolean; }

export interface Chest { id: number; pos: THREE.Vector3; contents: string; count: number; lid: THREE.Object3D; opened: boolean; campId?: number; }

export class NPC {
  root = new THREE.Group();
  anim: Animator;
  constructor(public g: Game, model: 'Mage' | 'Knight' | 'Barbarian' | 'Rogue_Hooded', public name: string, pos: THREE.Vector3, yaw: number, idle = 'Idle') {
    const m = assets.character(model);
    m.scale.setScalar(0.72);
    this.root.add(m);
    this.anim = new Animator(m);
    this.anim.play(idle);
    this.root.position.copy(pos); this.root.rotation.y = yaw;
    g.scene.add(this.root);
    g.colliders.addCyl(pos.x, pos.z, 0.4, pos.y, pos.y + 1.8, 'npc');
  }
  lookAt(p: THREE.Vector3, dt: number) {
    const want = Math.atan2(p.x - this.root.position.x, p.z - this.root.position.z);
    let d = want - this.root.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += d * Math.min(1, dt * 4);
  }
}

export class Structures {
  group = new THREE.Group();
  chests: Chest[] = [];
  towerPanels: THREE.Mesh[] = [];
  shrineDoors: THREE.Mesh[] = [];
  towerTops: THREE.Vector3[] = [];
  fires: THREE.Vector3[] = [];
  updrafts: { pos: THREE.Vector3; r: number; h: number }[] = [];
  npcs: NPC[] = [];
  hermit!: NPC; merchant!: NPC; guard!: NPC; chef!: NPC;
  private M: Record<string, THREE.Material> = {};
  private flames: THREE.Object3D[] = [];

  constructor(private g: Game) {
    this.M.stone = makeToonMaterial({ color: 0x9a948a, worldNoise: true });
    this.M.darkstone = makeToonMaterial({ color: 0x5a5866, worldNoise: true });
    this.M.ancient = makeToonMaterial({ color: 0x6d6a78, worldNoise: true, rim: 0.3 });
    this.M.glowOrange = makeToonMaterial({ color: 0xff9a3a, emissive: 0xff7a1a, emissiveIntensity: 1.2 });
    this.M.glowBlue = makeToonMaterial({ color: 0x6ad8ff, emissive: 0x3ab8ff, emissiveIntensity: 1.4 });
    this.M.wood = makeToonMaterial({ color: 0x8a5f3a, worldNoise: true });
    this.M.roof = makeToonMaterial({ color: 0xb0503a });
    this.M.roof2 = makeToonMaterial({ color: 0x4a6a9a });
    this.M.plaster = makeToonMaterial({ color: 0xe8dcc0, worldNoise: true });
    this.M.bone = makeToonMaterial({ color: 0xe0d6bc });
    this.M.gold = makeToonMaterial({ color: 0xe0b040, emissive: 0x402800, rim: 0.5 });
    this.M.cloth = makeToonMaterial({ color: 0x7a3a3a, side: THREE.DoubleSide });
    this.M.fire = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    g.scene.add(this.group);
    this.build();
  }

  private gy(x: number, z: number) { return this.g.terrain.heightAt(x, z); }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, collide = true, climb = true, tag?: string) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y + sy / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    if (collide) this.g.colliders.addBoxCentered(x, y + sy / 2, z, sx, sy, sz, climb, tag);
    return m;
  }

  private build() {
    const g = this.g;
    // ---- towers ----
    for (const t of TOWERS) {
      const base = this.gy(t.x, t.z);
      const short = t.id === 0;
      const segs = short ? [[7, 12], [5.5, 10]] : [[8, 14], [6.5, 14], [5.2, 13]];
      let y = base - 1;
      for (const [w, h] of segs) {
        this.box(t.x, y, t.z, w, h + (y === base - 1 ? 1 : 0), w, this.M.ancient);
        // glowing band
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.25, w + 0.1), this.M.glowOrange);
        band.position.set(t.x, y + h * 0.5, t.z); this.group.add(band); this.towerPanels.push(band);
        y += h + (y === base - 1 ? 1 : 0);
      }
      // top platform deco + terminal
      const top = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 2.6, 0.6, 8), this.M.darkstone);
      top.position.set(t.x, y - 0.3, t.z); this.group.add(top);
      const term = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.1, 6), this.M.glowOrange);
      term.position.set(t.x, y + 0.55, t.z); this.group.add(term); this.towerPanels.push(term);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4, 6), this.M.ancient);
      spire.position.set(t.x + 2, y + 2, t.z + 2); this.group.add(spire);
      g.colliders.addCyl(t.x + 2, t.z + 2, 0.6, y, y + 4);
      const topPos = new THREE.Vector3(t.x, y, t.z);
      this.towerTops.push(topPos);
      g.addInteractable({
        pos: topPos.clone(), r: 2.2, label: 'Activate',
        enabled: () => !g.state.towers[t.id],
        act: () => g.activateTower(t.id),
      });
      g.terrain.clearGrass(t.x, t.z, 6);
    }
    // ---- shrine entrances ----
    for (const s of SHRINES) {
      const y = this.gy(s.x, s.z);
      this.box(s.x, y - 1, s.z, 6, 1.4, 6, this.M.darkstone, true, true);
      // arch
      const py = y + 0.4;
      this.box(s.x - 1.7, py, s.z - 1.5, 0.8, 3.6, 0.8, this.M.ancient);
      this.box(s.x + 1.7, py, s.z - 1.5, 0.8, 3.6, 0.8, this.M.ancient);
      this.box(s.x, py + 3.6, s.z - 1.5, 4.2, 0.7, 0.9, this.M.ancient, true, true);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), this.M.glowOrange.clone());
      door.position.set(s.x, py + 1.7, s.z - 1.45); this.group.add(door); this.shrineDoors.push(door);
      const door2 = door.clone(); door2.rotation.y = Math.PI; door2.position.z = s.z - 1.55; this.group.add(door2);
      (door as any).twin = door2;
      g.addInteractable({ pos: new THREE.Vector3(s.x, py, s.z - 0.6), r: 2.4, label: 'Enter Sanctum', act: () => g.shrines.enter(s.id) });
      g.terrain.clearGrass(s.x, s.z, 5);
    }
    // ---- goddess statue (village + plateau) ----
    for (const sp of [STATUE_POS, { x: PLATEAU.x + 20, z: PLATEAU.z - 30 }]) {
      const y = this.gy(sp.x, sp.z);
      this.box(sp.x, y - 0.5, sp.z, 3, 1.2, 3, this.M.stone);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 3.2, 8), this.M.stone);
      body.position.set(sp.x, y + 2.3, sp.z); this.group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), this.M.stone);
      head.position.set(sp.x, y + 4.2, sp.z); this.group.add(head);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 6, 24), this.M.gold);
      halo.position.set(sp.x, y + 4.3, sp.z - 0.2); this.group.add(halo);
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 4), this.M.stone);
        wing.position.set(sp.x + s * 0.9, y + 3, sp.z - 0.2); wing.rotation.z = s * 0.9; this.group.add(wing);
      }
      g.colliders.addCyl(sp.x, sp.z, 1.2, y, y + 4.5);
      g.addInteractable({ pos: new THREE.Vector3(sp.x, y + 0.7, sp.z + 2), r: 2.8, label: 'Pray', act: () => g.ui.openStatue() });
    }
    // ---- hermit hut on plateau ----
    {
      const hx = HERMIT_POS.x, hz = HERMIT_POS.z, y = this.gy(hx, hz);
      this.house(hx + 6, hz - 4, 0.3, 5, 4);
      this.cookingPot(hx + 1.5, hz + 2.5);
      this.hermit = new NPC(g, 'Mage', 'Old Hermit', new THREE.Vector3(hx, y, hz), Math.PI);
      this.npcs.push(this.hermit);
      g.addInteractable({ pos: this.hermit.root.position, r: 2.6, label: 'Talk', act: () => g.talkHermit() });
      // starting chamber: stone slab where hero wakes
      const sy = this.gy(START_POS.x, START_POS.z);
      this.box(START_POS.x, sy - 0.6, START_POS.z, 3, 1.0, 2, this.M.ancient, true, true);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.4), makeToonMaterial({ color: 0x6ad8ff, emissive: 0x1a6aa0, emissiveIntensity: 0.6 }));
      glow.position.set(START_POS.x, sy + 0.42, START_POS.z); this.group.add(glow);
      g.terrain.clearGrass(hx + 4, hz, 9);
    }
    // ---- village ----
    {
      const vx = VILLAGE.x, vz = VILLAGE.z;
      const houses: [number, number, number][] = [[-14, -10, 0.2], [12, -14, -0.4], [16, 8, 1.6], [-16, 12, 2.8], [0, 20, 3.1]];
      for (const [dx, dz, r] of houses) this.house(vx + dx, vz + dz, r, 6, 5);
      // well
      const wy = this.gy(vx, vz);
      const well = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1, 10, 1, true), this.M.stone);
      well.position.set(vx, wy + 0.5, vz); this.group.add(well);
      g.colliders.addCyl(vx, vz, 1.3, wy, wy + 1);
      this.cookingPot(vx + 5, vz + 3);
      this.merchant = new NPC(g, 'Barbarian', 'Brakka', new THREE.Vector3(vx - 6, this.gy(vx - 6, vz + 2), vz + 2), 0.8);
      this.guard = new NPC(g, 'Knight', 'Captain Ardel', new THREE.Vector3(vx + 3, this.gy(vx + 3, vz - 8), vz - 8), Math.PI);
      this.chef = new NPC(g, 'Rogue_Hooded', 'Chef Mirra', new THREE.Vector3(vx + 7, this.gy(vx + 7, vz + 3), vz + 3), -1.2);
      this.npcs.push(this.merchant, this.guard, this.chef);
      // market stall
      this.box(vx - 6, wy, vz + 3.5, 3.2, 1, 1.2, this.M.wood);
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2), this.M.cloth); awn.position.set(vx - 6, wy + 2.6, vz + 3.6); awn.rotation.x = -1.1; this.group.add(awn);
      g.addInteractable({ pos: this.merchant.root.position, r: 2.8, label: 'Trade', act: () => g.ui.openShop() });
      g.addInteractable({ pos: this.guard.root.position, r: 2.6, label: 'Talk', act: () => g.talkGuard() });
      g.addInteractable({ pos: this.chef.root.position, r: 2.4, label: 'Talk', act: () => g.talkChef() });
      g.terrain.clearGrass(vx, vz, 4);
    }
    // ---- camps ----
    for (const c of CAMPS) {
      const y = this.gy(c.x, c.z);
      this.campfire(c.x, c.z);
      // bone totem
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 3.5, 5), this.M.wood);
      pole.position.set(c.x + 6, y + 1.7, c.z - 5); this.group.add(pole);
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), this.M.bone);
      skull.position.set(c.x + 6, y + 3.6, c.z - 5); this.group.add(skull);
      g.colliders.addCyl(c.x + 6, c.z - 5, 0.3, y, y + 3.8);
      // tents
      for (let k = 0; k < 2; k++) {
        const tx = c.x + (k ? -7 : 2), tz = c.z + (k ? 4 : 8);
        const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3, 4), this.M.cloth);
        tent.position.set(tx, this.gy(tx, tz) + 1.5, tz); tent.rotation.y = k; this.group.add(tent);
        g.colliders.addCyl(tx, tz, 1.8, this.gy(tx, tz), this.gy(tx, tz) + 2.5);
      }
      const reward = ['knightsword', 'roundshield', 'greatsword', 'heavycrossbow', 'kiteshield', 'greataxe', 'spikeshield', 'royalsword', 'axe'][c.id % 9];
      this.chest(c.x - 3, c.z - 6, reward, 1, c.id);
    }
    // ---- loose chests in the world ----
    const loose: [number, number, string, number][] = [
      [-405, 300, 'rustsword', 1], [-330, 405, 'potlid', 1], [-345, 260, 'crossbow', 1], [-440, 330, 'arrow', 15],
      [250, -420, 'ore', 3], [-520, -420, 'dagger', 1], [520, 250, 'greatsword', 1], [170, -150, 'arrow', 20],
      [-600, 100, 'herb', 4], [400, -380, 'kiteshield', 1], [-150, -500, 'arrow', 20], [600, -200, 'royalsword', 1],
      [0, 500, 'gems', 100], [-250, -50, 'pepper', 5], [80, -420, 'gems', 60],
    ];
    loose.forEach(([x, z, it, n]) => this.chest(x, z, it, n));
    // ---- citadel ----
    this.citadel();
    // ---- updraft vents near mountain tower and a few cliffs ----
    for (const [x, z] of [[195, -285], [-330, 450], [-460, 280]] as [number, number][]) this.vent(x, z, 40);
    // ---- ruins scattered ----
    const rnd = mulberry32(42);
    for (let i = 0; i < 28; i++) {
      const x = (rnd() * 2 - 1) * 600, z = (rnd() * 2 - 1) * 600;
      const y = this.gy(x, z);
      if (y < 3 || y > SNOW_LINE) continue;
      if (Math.hypot(x - PLATEAU.x, z - PLATEAU.z) < PLATEAU.r + 20) continue;
      if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 60 || Math.hypot(x - CITADEL.x, z - CITADEL.z) < 100) continue;
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const px = x + (rnd() - 0.5) * 10, pz = z + (rnd() - 0.5) * 10, h = 2 + rnd() * 5;
        this.box(px, this.gy(px, pz) - 0.5, pz, 1.4, h, 1.4, this.M.stone);
      }
      if (rnd() < 0.5) this.box(x, y - 0.3, z, 6, 0.6, 1.2, this.M.stone);
    }
  }

  house(x: number, z: number, rot: number, w: number, d: number) {
    const y = this.gy(x, z) - 0.3;
    const grp = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d), this.M.plaster);
    walls.position.y = 1.6; grp.add(walls);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, Math.max(w, d) * 0.78, 2.4, 4, 1), this.M.roof);
    roof.rotation.y = Math.PI / 4; roof.position.y = 4.4; roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); grp.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2, 0.1), this.M.wood); door.position.set(0, 1, d / 2 + 0.03); grp.add(door);
    for (const sx of [-1, 1]) { const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), this.M.glowOrange); win.position.set(sx * w * 0.3, 1.9, d / 2 + 0.03); grp.add(win); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.3, 0.3), this.M.wood); beam.position.set(sx * w / 2, 1.6, sz * d / 2); grp.add(beam); }
    grp.position.set(x, y, z); grp.rotation.y = rot;
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(grp);
    // axis-aligned collider covering rotated footprint (approx)
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const ex = (w * c + d * s) / 2 * 0.9, ez = (w * s + d * c) / 2 * 0.9;
    this.g.colliders.addBox(new THREE.Vector3(x - ex, y, z - ez), new THREE.Vector3(x + ex, y + 3.2, z + ez), true);
    this.g.terrain.clearGrass(x, z, Math.max(w, d) * 0.7);
  }

  cookingPot(x: number, z: number) {
    const y = this.gy(x, z);
    this.campfire(x, z, true);
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.75), makeToonMaterial({ color: 0x3a3a40, side: THREE.DoubleSide }));
    pot.position.set(x, y + 0.9, z); this.group.add(pot);
    const soup = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), makeToonMaterial({ color: 0xc8a050, emissive: 0x302000 }));
    soup.rotation.x = -Math.PI / 2; soup.position.set(x, y + 1.3, z); this.group.add(soup);
    this.g.addInteractable({ pos: new THREE.Vector3(x, y, z), r: 2.4, label: 'Cook', act: () => this.g.ui.openCooking() });
  }

  campfire(x: number, z: number, withPot = false) {
    const y = this.gy(x, z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), this.M.stone);
      st.position.set(x + Math.cos(a) * 0.7, y + 0.1, z + Math.sin(a) * 0.7); this.group.add(st);
    }
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 5), this.M.wood);
      log.position.set(x, y + 0.15, z); log.rotation.set(Math.PI / 2, i * 1.05, 0.3); this.group.add(log);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 6), this.M.fire);
    flame.position.set(x, y + 0.55, z); this.group.add(flame); this.flames.push(flame);
    this.fires.push(new THREE.Vector3(x, y, z));
    if (!withPot) this.updrafts.push({ pos: new THREE.Vector3(x, y, z), r: 1.6, h: 14 });
  }

  vent(x: number, z: number, h: number) {
    const y = this.gy(x, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 6, 16), this.M.ancient);
    ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.2, z); this.group.add(ring);
    this.updrafts.push({ pos: new THREE.Vector3(x, y, z), r: 2.2, h });
  }

  chest(x: number, z: number, contents: string, count = 1, campId?: number, y0?: number) {
    const y = y0 ?? this.gy(x, z);
    const grp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.8), this.M.wood); base.position.y = 0.3; grp.add(base);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.1, 0.84), this.M.gold); trim.position.y = 0.55; grp.add(trim);
    const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.6, -0.4); grp.add(lidPivot);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8, 1, false, 0, Math.PI), this.M.wood);
    lid.rotation.z = Math.PI / 2; lid.position.set(0, 0, 0.4); lidPivot.add(lid);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.1), this.M.gold); lock.position.set(0, 0.5, 0.42); grp.add(lock);
    grp.position.set(x, y, z);
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.group.add(grp);
    this.g.colliders.addBoxCentered(x, y + 0.4, z, 1.2, 0.8, 0.8, false);
    const ch: Chest = { id: this.chests.length, pos: new THREE.Vector3(x, y, z), contents, count, lid: lidPivot, opened: false, campId };
    this.chests.push(ch);
    this.g.addInteractable({
      pos: ch.pos, r: 2.0, label: 'Open',
      enabled: () => !ch.opened && (ch.campId === undefined || this.g.enemies.campState[ch.campId].cleared || this.g.state.campsCleared.includes(ch.campId)),
      act: () => this.openChest(ch),
    });
    return ch;
  }

  openChest(ch: Chest) {
    const g = this.g;
    if (ch.opened) return;
    if (ch.contents !== 'gems') {
      const d = itemDef(ch.contents);
      if ((d.kind === 'weapon' || d.kind === 'shield' || d.kind === 'bow')) {
        const list = d.kind === 'weapon' ? g.inv.weapons : d.kind === 'shield' ? g.inv.shields : g.inv.bows;
        const max = d.kind === 'weapon' ? g.inv.maxWeapons : d.kind === 'shield' ? g.inv.maxShields : g.inv.maxBows;
        if (list.length >= max) { g.toast('Your pouch is full. Drop something first.'); return; }
      }
    }
    ch.opened = true;
    g.state.chests.push(ch.id);
    audio.play('chest');
    g.player.playOnce('Interact', 1.2);
    g.fx.addTransient(new THREE.Object3D(), 0.5, (_o, k) => { ch.lid.rotation.x = -k * 1.9; });
    g.fx.burst(ch.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 20, 0xffe080, 3, 0.25, 0.8, -1);
    setTimeout(() => {
      if (ch.contents === 'gems') { g.inv.gems += ch.count; g.hud.itemGet(`${ch.count} Gems`, 0x40ff90); }
      else { g.inv.add(ch.contents, ch.count); const d = itemDef(ch.contents); g.hud.itemGet(d.name + (ch.count > 1 ? ` ×${ch.count}` : ''), (d as any).color, d.desc); }
      g.autosave();
    }, 400);
  }

  applySavedChests(ids: number[]) {
    for (const id of ids) { const ch = this.chests[id]; if (ch) { ch.opened = true; ch.lid.rotation.x = -1.9; } }
  }

  citadel() {
    const c = CITADEL, y = this.gy(c.x, c.z);
    // ring of broken pillars and walls
    const rnd = mulberry32(9);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = 34;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const h = 6 + rnd() * 10;
      this.box(x, this.gy(x, z) - 1, z, 2.5, h, 2.5, this.M.darkstone);
      if (i % 2 === 0) {
        const a2 = a + Math.PI / 16;
        const wx = c.x + Math.cos(a2) * r, wz = c.z + Math.sin(a2) * r;
        const wall = this.box(wx, this.gy(wx, wz) - 1, wz, 7, 3 + rnd() * 3, 1.2, this.M.darkstone, false);
        wall.rotation.y = -a2 + Math.PI / 2;
        this.g.colliders.addCyl(wx, wz, 2.5, this.gy(wx, wz), this.gy(wx, wz) + 4);
      }
    }
    // arena floor
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(26, 27, 1, 32), this.M.ancient);
    floor.position.set(c.x, y - 0.35, c.z); floor.receiveShadow = true; this.group.add(floor);
    const rune = new THREE.Mesh(new THREE.RingGeometry(10, 10.6, 48), new THREE.MeshBasicMaterial({ color: 0x9a3aff, transparent: true, opacity: 0.6 }));
    rune.rotation.x = -Math.PI / 2; rune.position.set(c.x, y + 0.2, c.z); this.group.add(rune);
    // throne
    this.box(c.x, y, c.z - 22, 6, 1, 4, this.M.darkstone);
    this.box(c.x, y + 1, c.z - 23.5, 4, 6, 1, this.M.darkstone);
    this.g.terrain.clearGrass(c.x, c.z, 30);
  }

  update(dt: number, t: number) {
    for (const f of this.flames) { f.scale.set(1 + Math.sin(t * 13 + f.position.x) * 0.15, 1 + Math.sin(t * 9 + f.position.z) * 0.25, 1); }
    // tower panels colour
    this.g.state.towers.forEach((on, i) => {
      if (!on) return;
      const n = TOWERS[i] ? (i * 4) : 0; void n;
    });
    const P = this.g.player.pos;
    for (const npc of this.npcs) {
      const d = npc.root.position.distanceTo(P);
      if (d < 6) npc.lookAt(P, dt);
      if (d < 80) npc.anim.update(dt);
    }
    // sparkles above updrafts
    for (const u of this.updrafts) {
      if (u.pos.distanceTo(P) < 60 && Math.random() < dt * 6) this.g.fx.spawn(u.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * u.r, 0.5, (Math.random() - 0.5) * u.r)), new THREE.Vector3(0, 6, 0), 0xfff0d0, 0.15, 2.0, 0);
    }
  }

  refreshTowers() {
    // towers have 3 or 2 bands + terminal; recolor when active
    let k = 0;
    for (const t of TOWERS) {
      const n = t.id === 0 ? 3 : 4;
      for (let i = 0; i < n; i++) { const m = this.towerPanels[k++]; if (m) m.material = this.g.state.towers[t.id] ? this.M.glowBlue : this.M.glowOrange; }
    }
  }
  refreshShrines() {
    SHRINES.forEach((s, i) => {
      const door = this.shrineDoors[i]; if (!door) return;
      const done = this.g.state.shrines[s.id];
      const mat = done ? this.M.glowBlue : this.M.glowOrange;
      door.material = mat; ((door as any).twin as THREE.Mesh).material = mat;
    });
  }
}
