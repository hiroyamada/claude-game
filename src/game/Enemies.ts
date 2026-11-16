import * as THREE from 'three';
import { assets, Animator, findBone, type CharName, type ItemModel } from '../engine/Assets';
import { audio } from '../engine/Audio';
import { damp, dampAngle, angleDiff, clamp } from '../engine/noise';
import type { Game } from '../Game';
import { CAMPS } from '../world/WorldData';

export type EnemyKind = 'minion' | 'warrior' | 'rogue' | 'mage' | 'elite';
type EState = 'idle' | 'wander' | 'alert' | 'chase' | 'windup' | 'strike' | 'recover' | 'shoot' | 'cast' | 'hurt' | 'dead' | 'spawn' | 'stun' | 'block' | 'retreat';

interface KindDef { model: CharName; hp: number; dmg: number; speed: number; weapon?: ItemModel; shield?: ItemModel; ranged?: 'bolt' | 'fire'; reach: number; drops: [string, number][]; scale: number; weaponDrop?: string; }
const KINDS: Record<EnemyKind, KindDef> = {
  minion: { model: 'Skeleton_Minion', hp: 22, dmg: 2, speed: 4.3, weapon: 'Skeleton_Blade', reach: 1.9, drops: [['bone', 0.8], ['apple', 0.2]], scale: 0.72, weaponDrop: 'boneblade' },
  warrior: { model: 'Skeleton_Warrior', hp: 50, dmg: 4, speed: 3.8, weapon: 'Skeleton_Axe', shield: 'Skeleton_Shield_Large_A', reach: 2.2, drops: [['bone', 1], ['meat', 0.4]], scale: 0.8, weaponDrop: 'boneaxe' },
  rogue: { model: 'Skeleton_Rogue', hp: 20, dmg: 2, speed: 4.5, weapon: 'Skeleton_Crossbow', ranged: 'bolt', reach: 1.6, drops: [['arrow', 1], ['arrow', 1], ['bone', 0.5], ['feather', 0.3]], scale: 0.72, weaponDrop: 'bonecrossbow' },
  mage: { model: 'Skeleton_Mage', hp: 24, dmg: 3, speed: 3.6, weapon: 'Skeleton_Staff', ranged: 'fire', reach: 1.6, drops: [['ember', 0.9], ['bone', 0.5], ['mushroom', 0.3]], scale: 0.74, weaponDrop: 'emberstaff' },
  elite: { model: 'Skeleton_Warrior', hp: 90, dmg: 5, speed: 4.2, weapon: 'Skeleton_Blade', shield: 'Skeleton_Shield_Small_A', reach: 2.3, drops: [['bone', 1], ['ore', 0.6]], scale: 0.95, weaponDrop: 'greatsword' },
};

export class Enemy {
  root = new THREE.Group();
  model: THREE.Object3D;
  anim: Animator;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number; maxHp: number;
  state: EState = 'idle';
  t = 0;
  alive = true;
  aware = false;
  def: KindDef;
  home: THREE.Vector3;
  radius = 0.45;
  height = 1.6;
  attackCd = 0;
  strikeAt = 0;
  hitDone = false;
  campId: number;
  stagger = 0;
  frozen = 0; // stasis
  dead = 0;
  label: HTMLDivElement | null = null;
  spawnedAtNight = false;
  shieldUp = false;
  burn = 0;
  private wanderTarget = new THREE.Vector3();

  constructor(private g: Game, public kind: EnemyKind, x: number, z: number, campId = -1) {
    this.def = KINDS[kind];
    this.hp = this.maxHp = this.def.hp;
    this.model = assets.character(this.def.model);
    this.model.scale.setScalar(this.def.scale);
    if (kind === 'elite') this.model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = (m.material as THREE.MeshToonMaterial).clone(); (m.material as THREE.MeshToonMaterial).color.multiply(new THREE.Color(0xff9a7a)); } });
    this.root.add(this.model);
    this.anim = new Animator(this.model);
    const hr = findBone(this.model, 'handslotr'), hl = findBone(this.model, 'handslotl');
    if (this.def.weapon && hr) hr.add(assets.item(this.def.weapon));
    if (this.def.shield && hl) hl.add(assets.item(this.def.shield));
    this.campId = campId;
    this.pos.set(x, g.groundAt(x, z, 999).y, z);
    this.home = this.pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.anim.play(campId >= 0 && Math.random() < 0.5 ? 'Sit_Floor_Idle' : 'Idle');
    this.height = 1.7 * this.def.scale / 0.72;
    g.scene.add(this.root);
    this.sync();
  }

  sync() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  setState(s: EState) { this.state = s; this.t = 0; }

  canSee(p: THREE.Vector3, sneaky: boolean): boolean {
    const d = _a.copy(p).sub(this.pos); const dist = d.length();
    let range = this.g.sky.isNight ? 15 : 24;
    if (sneaky) range *= 0.45;
    if (dist > range) return false;
    if (dist < (sneaky ? 2.5 : 5)) return true;
    d.y = 0; d.normalize();
    return d.dot(this.forward(_b)) > (this.state === 'idle' ? 0.2 : -0.3);
  }

  update(dt: number) {
    const g = this.g, P = g.player;
    this.t += dt;
    if (!this.alive) {
      this.dead += dt;
      if (this.dead > 1.6) {
        this.model.position.y -= dt * 0.8;
        if (this.dead > 3) { this.g.enemies.remove(this); }
      }
      this.anim.update(dt); this.sync();
      return;
    }
    if (this.frozen > 0) { this.frozen -= dt; this.sync(); return; }
    if (this.burn > 0) {
      this.burn -= dt;
      if (Math.random() < dt * 8) g.fx.spawn(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random(), (Math.random() - 0.5) * 0.6)), new THREE.Vector3(0, 2, 0), 0xff7020, 0.35, 0.5);
      if (Math.floor((this.burn + dt) * 2) !== Math.floor(this.burn * 2)) g.damageEnemy(this, 2, null, 0, true);
      if (!this.alive) return;
    }
    this.attackCd -= dt;
    const toP = _a.copy(P.pos).sub(this.pos); toP.y = 0;
    const dist = toP.length();
    const dirP = dist > 0.001 ? toP.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const playerOk = P.state !== 'dead' && g.mode === 'play';
    let moveSpeed = 0;
    let face: THREE.Vector3 | null = null;
    const d = this.def;

    switch (this.state) {
      case 'spawn':
        if (this.t > 1.8) this.setState('chase'), this.aware = true;
        break;
      case 'idle': case 'wander': {
        if (playerOk && this.canSee(P.pos, P.crouch)) { this.alert(); break; }
        if (playerOk && dist < 10 && P.sprinting) { this.alert(); break; }
        if (this.state === 'idle' && this.t > 4 + Math.random() * 6) {
          this.setState('wander');
          this.wanderTarget.set(this.home.x + (Math.random() - 0.5) * 14, 0, this.home.z + (Math.random() - 0.5) * 14);
          this.anim.play('Walking_D_Skeletons');
        }
        if (this.state === 'wander') {
          const w = _b.set(this.wanderTarget.x - this.pos.x, 0, this.wanderTarget.z - this.pos.z);
          if (w.length() < 0.8 || this.t > 8) { this.setState('idle'); this.anim.play('Idle'); }
          else { face = w.normalize(); moveSpeed = 1.3; }
        }
        break;
      }
      case 'alert':
        face = dirP;
        if (this.t > 0.7) this.setState(d.ranged ? 'shoot' : 'chase');
        break;
      case 'chase': {
        if (!playerOk || dist > 40) { this.aware = false; this.setState('idle'); this.anim.play('Idle'); break; }
        if (dist > 30 && this.pos.distanceTo(this.home) > 45 && this.campId >= 0) { this.aware = false; this.setState('wander'); this.wanderTarget.copy(this.home); break; }
        face = dirP;
        if (d.ranged && dist > 5 && dist < 22 && this.attackCd <= 0) { this.setState(d.ranged === 'bolt' ? 'shoot' : 'cast'); break; }
        if (d.ranged && dist < 4) { moveSpeed = -d.speed * 0.6; break; }
        // flurry-rush style circle when cooling down
        if (dist > d.reach + 0.3) moveSpeed = d.speed * (dist > 8 ? 1 : 0.8);
        else if (this.attackCd <= 0) { this.setState('windup'); this.anim.play(this.kind === 'warrior' || this.kind === 'elite' ? '1H_Melee_Attack_Chop' : '1H_Melee_Attack_Slice_Diagonal', { loop: false, speed: 0.7, restart: true }); this.strikeAt = 0.55; this.hitDone = false; }
        else {
          // shield up while waiting
          if (d.shield && P.attack && Math.random() < 0.6) { this.setState('block'); this.anim.play('Blocking'); }
          moveSpeed = 0;
        }
        break;
      }
      case 'block':
        face = dirP; this.shieldUp = true;
        if (this.t > 1.0) { this.shieldUp = false; this.setState('chase'); }
        break;
      case 'windup':
        face = this.t < this.strikeAt * 0.6 ? dirP : null;
        if (this.t >= this.strikeAt && !this.hitDone) {
          this.hitDone = true;
          moveSpeed = 0;
          this.vel.addScaledVector(this.forward(_b), 4);
          if (dist < d.reach + 0.6 && Math.abs(P.pos.y - this.pos.y) < 2) {
            const f = this.forward(_b);
            if (dirP.dot(f) > 0.3 || dist < 1) g.hitPlayer(d.dmg, this.pos, this);
          }
          audio.play('swing', 0.6);
        }
        if (this.t > this.strikeAt + 0.5) { this.attackCd = 1.2 + Math.random() * 1.5; this.setState('chase'); }
        break;
      case 'shoot': {
        face = dirP;
        if (this.t < 0.05) this.anim.play('1H_Ranged_Aiming');
        if (this.t > 1.1 && !this.hitDone) {
          this.hitDone = true;
          const o = this.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
          const tgt = P.pos.clone().add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(P.vel, dist / 40);
          const v = tgt.sub(o).normalize().multiplyScalar(38);
          v.y += dist * 0.06;
          g.projectiles.bolt(o, v, d.dmg, 'enemy');
          this.anim.play('1H_Ranged_Shoot', { loop: false, restart: true });
          audio.play('shoot', 0.5);
        }
        if (this.t > 1.8) { this.hitDone = false; this.attackCd = 2 + Math.random() * 1.5; this.setState('chase'); }
        break;
      }
      case 'cast': {
        face = dirP;
        if (this.t < 0.05) this.anim.play('Spellcast_Raise', { loop: false, restart: true });
        if (Math.random() < 0.5) g.fx.sparkle(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), 0xff7030, 1, 0.5);
        if (this.t > 1.2 && !this.hitDone) {
          this.hitDone = true;
          const o = this.pos.clone().add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(this.forward(_b), 0.6);
          const v = P.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(o).normalize().multiplyScalar(14);
          g.projectiles.fireball(o, v, false, d.dmg);
          this.anim.play('Spellcast_Shoot', { loop: false, restart: true });
          audio.play('fire', 0.6);
        }
        if (this.t > 2.0) { this.hitDone = false; this.attackCd = 2.5 + Math.random() * 2; this.setState('chase'); }
        break;
      }
      case 'hurt':
        if (this.t > 0.45 + this.stagger) { this.stagger = 0; this.setState('chase'); }
        break;
      case 'stun':
        if (Math.random() < 0.3) g.fx.sparkle(this.pos.clone().add(new THREE.Vector3(0, this.height + 0.3, 0)), 0xffff80, 1, 0.4);
        if (this.t > 1.8) this.setState('chase');
        break;
    }

    if (face) this.yaw = dampAngle(this.yaw, Math.atan2(face.x, face.z), 8, dt);
    const f = this.forward(_b);
    const targetV = f.multiplyScalar(moveSpeed);
    if (moveSpeed < 0) targetV.copy(dirP).multiplyScalar(moveSpeed);
    this.vel.x = damp(this.vel.x, targetV.x, 8, dt);
    this.vel.z = damp(this.vel.z, targetV.z, 8, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    g.colliders.pushOut(this.pos, this.radius, this.height);
    // separate from other enemies and player
    for (const o of g.enemies.list) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, dd = Math.hypot(dx, dz), md = this.radius + o.radius;
      if (dd < md && dd > 1e-4) { this.pos.x += (dx / dd) * (md - dd) * 0.5; this.pos.z += (dz / dd) * (md - dd) * 0.5; }
    }
    if (dist < this.radius + 0.35 && dist > 1e-4) { this.pos.x -= dirP.x * (this.radius + 0.35 - dist); this.pos.z -= dirP.z * (this.radius + 0.35 - dist); }
    // ground
    const gr = g.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.8);
    this.vel.y -= 26 * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= gr.y) { this.pos.y = gr.y; this.vel.y = 0; }
    // water: skeletons sink & die in deep water
    if (g.waterLevelAt(this.pos.x, this.pos.z) - this.pos.y > 1.6) { g.damageEnemy(this, 999, null, 0, true); }

    // animation by locomotion
    if (['idle', 'wander', 'chase', 'alert'].includes(this.state)) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (this.state === 'idle') { if (this.anim.currentName !== 'Sit_Floor_Idle') this.anim.play('Idle'); }
      else if (hs > 2.5) this.anim.play('Running_C', { speed: hs / 5 });
      else if (hs > 0.4) this.anim.play('Walking_D_Skeletons', { speed: Math.max(0.6, hs / 1.5) });
      else this.anim.play(this.aware ? 'Idle_Combat' : 'Idle');
    }
    this.anim.update(dt);
    this.sync();
  }

  alert() {
    if (this.aware) return;
    this.aware = true;
    this.setState('alert');
    this.anim.play('Taunt', { loop: false, restart: true, speed: 1.5 });
    audio.play('alert', 0.5);
    this.g.hud.enemyAlert(this);
    // alert camp mates
    for (const o of this.g.enemies.list) if (o !== this && o.alive && !o.aware && o.pos.distanceTo(this.pos) < 18) { o.aware = true; o.setState('alert'); }
  }

  onHit(dir: THREE.Vector3 | null, knock: number) {
    this.aware = true;
    if (this.state === 'windup' && knock < 1.5 && this.kind === 'elite') return; // super armor
    this.setState('hurt');
    this.stagger = knock > 1 ? 0.35 : 0;
    this.anim.play(knock > 1 ? 'Hit_B' : 'Hit_A', { loop: false, restart: true, speed: 1.3 });
    if (dir) { this.vel.x = dir.x * 5 * knock; this.vel.z = dir.z * 5 * knock; if (knock > 1.2) this.vel.y = 4; }
  }

  die() {
    this.alive = false;
    this.setState('dead');
    this.anim.play(Math.random() < 0.5 ? 'Death_A' : 'Death_B', { loop: false, clamp: true, restart: true });
    audio.play('enemyDie', 0.7);
    const g = this.g;
    g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 25, 0xb8a8ff, 3, 0.3, 1.0, -1, 1);
    // drops
    for (const [id, ch] of this.def.drops) if (Math.random() < ch) g.pickups.drop(id, this.pos, id === 'arrow' ? 3 : 1);
    if (this.def.weaponDrop && Math.random() < (this.kind === 'elite' ? 1 : 0.4)) g.pickups.drop(this.def.weaponDrop, this.pos);
    if (Math.random() < 0.5) g.pickups.dropGems(this.pos, 1 + Math.floor(Math.random() * (this.kind === 'elite' ? 20 : 5)));
    g.enemies.onDeath(this);
  }

  dispose() {
    this.root.removeFromParent();
    this.anim.mixer.stopAllAction(); this.anim.mixer.uncacheRoot(this.model);
    const seen = new Set<THREE.Skeleton>();
    this.root.traverse((o) => { const sk = (o as THREE.SkinnedMesh).skeleton; if (sk && !seen.has(sk)) { seen.add(sk); sk.dispose(); } });
    this.label?.remove();
  }
}

export class EnemyManager {
  list: Enemy[] = [];
  campState: { cleared: boolean; spawned: boolean }[] = CAMPS.map(() => ({ cleared: false, spawned: false }));
  private nightSpawnT = 10;
  extraTargets: any[] = [];

  constructor(private g: Game) {}

  targets(): any[] {
    const r: any[] = this.list.filter((e) => e.alive && e.state !== 'spawn');
    for (const t of this.extraTargets) if (t.alive) r.push(t);
    return r;
  }

  nearestTarget(p: THREE.Vector3, range: number, current?: any): any {
    let best: any = null, bd = range;
    for (const e of this.targets()) {
      const d = e.pos.distanceTo(p);
      if (d < bd && e !== current) { bd = d; best = e; }
    }
    return best || (current && current.alive ? current : null);
  }

  attackIncoming(p: THREE.Vector3, window: number): boolean {
    for (const e of this.list) {
      if (!e.alive || e.state !== 'windup' || e.hitDone) continue;
      if (e.strikeAt - e.t < window + 0.15 && e.pos.distanceTo(p) < e.def.reach + 1.5) return true;
    }
    for (const t of this.extraTargets) if (t.alive && t.attackIncoming?.(p, window)) return true;
    return false;
  }

  spawn(kind: EnemyKind, x: number, z: number, campId = -1): Enemy {
    const e = new Enemy(this.g, kind, x, z, campId);
    this.list.push(e);
    return e;
  }

  remove(e: Enemy) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    e.dispose();
  }

  onDeath(e: Enemy) {
    if (e.campId >= 0) {
      const alive = this.list.some((o) => o.alive && o.campId === e.campId);
      if (!alive && !this.campState[e.campId].cleared) {
        this.campState[e.campId].cleared = true;
        this.g.onCampCleared(e.campId);
      }
    }
    this.g.shrines.onEnemyDeath(e);
  }

  /** called when a new day starts: camps repopulate */
  respawnCamps() {
    for (const c of this.campState) { c.cleared = false; c.spawned = false; }
    for (const e of this.list.slice()) if (e.campId >= 0) this.remove(e);
    this.g.toast('The restless dead return to their camps...');
  }

  update(dt: number) {
    const g = this.g, P = g.player.pos;
    // camp streaming
    if (!g.inShrine) {
      CAMPS.forEach((c, i) => {
        const st = this.campState[i];
        const d = Math.hypot(P.x - c.x, P.z - c.z);
        if (!st.spawned && !st.cleared && d < 140) {
          st.spawned = true;
          c.kinds.forEach((k, j) => {
            const a = (j / c.kinds.length) * Math.PI * 2;
            this.spawn(k, c.x + Math.cos(a) * 4.5, c.z + Math.sin(a) * 4.5, i);
          });
        } else if (st.spawned && d > 220) {
          st.spawned = false;
          for (const e of this.list.slice()) if (e.campId === i) this.remove(e);
        }
      });
      // night spawns: skeletons crawl out of the ground
      if (g.sky.isNight && g.mode === 'play' && !g.boss?.active) {
        this.nightSpawnT -= dt;
        const nightCount = this.list.filter((e) => e.spawnedAtNight && e.alive).length;
        if (this.nightSpawnT <= 0 && nightCount < 3) {
          this.nightSpawnT = 25 + Math.random() * 25;
          const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 10;
          const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
          const h = g.terrain.heightAt(x, z);
          const n = g.terrain.normalAt(x, z, _a);
          if (h > 2 && n.y > 0.8) {
            const e = this.spawn(Math.random() < 0.7 ? 'minion' : Math.random() < 0.5 ? 'rogue' : 'warrior', x, z);
            e.spawnedAtNight = true; e.aware = true;
            e.setState('spawn'); e.anim.play('Spawn_Ground_Skeletons', { loop: false, clamp: true, restart: true });
            g.fx.burst(e.pos.clone(), 20, 0x7a6a50, 3, 0.4, 0.8, 5, 1);
          }
        }
      }
      for (const e of this.list.slice()) if (e.spawnedAtNight && (!g.sky.isNight && e.alive && !e.aware || e.pos.distanceTo(P) > 120)) this.remove(e);
    }
    for (const e of this.list.slice()) {
      const d = e.pos.distanceTo(P);
      if (d > 160 && e.campId >= 0) { e.root.visible = false; continue; }
      e.root.visible = true;
      e.update(dt * (e.frozen > 0 ? 0 : 1));
    }
  }

  combatActive(): boolean {
    const P = this.g.player.pos;
    return this.list.some((e) => e.alive && e.aware && e.pos.distanceTo(P) < 30);
  }

  clearAll() { for (const e of this.list.slice()) this.remove(e); this.campState.forEach((c) => (c.spawned = false)); }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
void angleDiff; void clamp;
