import * as THREE from 'three';
import { assets, Animator, findBone } from '../engine/Assets';
import { audio } from '../engine/Audio';
import { damp, dampAngle } from '../engine/noise';
import type { Game } from '../Game';
import { CITADEL } from '../world/WorldData';

type BState = 'dormant' | 'intro' | 'idle' | 'chase' | 'sweep' | 'slam' | 'spin' | 'volley' | 'summon' | 'stun' | 'hurt' | 'dead';

export class Boss {
  root = new THREE.Group();
  model: THREE.Object3D;
  anim: Animator;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp = 900; maxHp = 900;
  alive = false; // targetable
  active = false;
  aware = true;
  radius = 1.6;
  height = 5;
  state: BState = 'dormant';
  t = 0;
  private cd = 2;
  private hitDone = false;
  private strikeAt = 0;
  private summoned = 0;
  private waves: { mesh: THREE.Mesh; r: number; hit: boolean }[] = [];
  private center: THREE.Vector3;
  burn = 0;
  shieldUp = false;
  name = 'The Hollow King';

  constructor(private g: Game) {
    this.model = assets.character('Skeleton_Warrior');
    this.model.scale.setScalar(2.3);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.material = (m.material as THREE.MeshToonMaterial).clone(); const mt = m.material as THREE.MeshToonMaterial; mt.color.multiply(new THREE.Color(0x9a8ab0)); mt.emissive = new THREE.Color(0x200830); }
    });
    const hr = findBone(this.model, 'handslotr');
    if (hr) { const w = assets.item('sword_2handed'); w.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = (m.material as THREE.MeshToonMaterial).clone(); (m.material as THREE.MeshToonMaterial).color.setHex(0x5a3a7a); (m.material as THREE.MeshToonMaterial).emissive = new THREE.Color(0x6a1aa0); } }); hr.add(w); }
    this.root.add(this.model);
    this.anim = new Animator(this.model);
    this.anim.play('Sit_Floor_Idle');
    const y = g.terrain.heightAt(CITADEL.x, CITADEL.z - 22);
    this.center = new THREE.Vector3(CITADEL.x, g.terrain.heightAt(CITADEL.x, CITADEL.z), CITADEL.z);
    this.pos.set(CITADEL.x, y + 1, CITADEL.z - 21);
    this.root.position.copy(this.pos);
    g.scene.add(this.root);
  }

  reset() {
    this.hp = this.maxHp; this.alive = false; this.active = false; this.state = 'dormant'; this.summoned = 0;
    const y = this.g.terrain.heightAt(CITADEL.x, CITADEL.z - 22);
    this.pos.set(CITADEL.x, y + 1, CITADEL.z - 21); this.yaw = 0;
    this.anim.play('Sit_Floor_Idle');
    this.root.visible = !this.g.state.bossDefeated;
    for (const w of this.waves) w.mesh.removeFromParent();
    this.waves = [];
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  private set(s: BState) { this.state = s; this.t = 0; this.hitDone = false; }

  attackIncoming(p: THREE.Vector3, window: number) {
    if (!['sweep', 'slam', 'spin'].includes(this.state) || this.hitDone) return false;
    return this.strikeAt - this.t < window + 0.2 && this.pos.distanceTo(p) < 8;
  }

  onHit(_dir: THREE.Vector3 | null, knock: number) {
    if (this.state === 'stun' || this.state === 'dead') return;
    if (knock >= 1.6 && Math.random() < 0.35) { this.set('stun'); this.anim.play('Hit_B', { loop: false, restart: true, speed: 0.6 }); }
  }
  parried() { this.set('stun'); this.anim.play('Hit_B', { loop: false, restart: true, speed: 0.5 }); this.g.toast('Staggered!'); }

  die() {
    this.alive = false;
    this.set('dead');
    this.anim.play('Death_A', { loop: false, clamp: true, restart: true, speed: 0.6 });
    this.g.onBossDefeated();
  }

  update(dt: number) {
    const g = this.g, P = g.player;
    this.t += dt;
    if (g.state.bossDefeated && this.state !== 'dead') { this.root.visible = false; return; }
    const toP = P.pos.clone().sub(this.pos); toP.y = 0;
    const dist = toP.length();
    const dirP = toP.clone().normalize();
    if (this.state === 'dormant') {
      this.anim.update(dt);
      if (!g.inShrine && P.pos.distanceTo(this.center) < 24 && P.state !== 'dead') {
        this.set('intro'); this.active = true;
        this.anim.play('Lie_StandUp', { loop: false, clamp: true, restart: true, speed: 0.5 });
        g.startBossIntro(this);
      }
      return;
    }
    if (!this.active) return;
    // player left arena or died -> reset
    if ((P.pos.distanceTo(this.center) > 60 || P.state === 'dead') && this.state !== 'dead') {
      if (this.t > 1) { this.reset(); g.endBossFight(false); return; }
    }
    const phase = this.hp > this.maxHp * 0.66 ? 1 : this.hp > this.maxHp * 0.33 ? 2 : 3;
    const spd = phase === 3 ? 1.3 : 1;
    let move = 0; let face: THREE.Vector3 | null = null;
    this.cd -= dt * spd;
    switch (this.state) {
      case 'intro':
        if (this.t > 3.2) { this.alive = true; this.set('chase'); this.anim.play('Taunt'); audio.play('boss'); }
        break;
      case 'chase': case 'idle':
        face = dirP;
        if (phase >= 2 && this.summoned < phase - 1) { this.set('summon'); break; }
        if (this.cd <= 0) {
          const r = Math.random();
          if (dist < 6.5) { this.set(r < 0.5 ? 'sweep' : phase === 3 && r < 0.8 ? 'spin' : 'slam'); }
          else if (phase >= 2 && r < 0.45) this.set('volley');
          else if (dist < 14 && r < 0.4) this.set('slam');
          else move = 3.6 * spd;
          if ((this.state as BState) === 'sweep') { this.anim.play('2H_Melee_Attack_Slice', { loop: false, restart: true, speed: 0.55 * spd }); this.strikeAt = 1.0 / spd; }
          if ((this.state as BState) === 'slam') { this.anim.play('1H_Melee_Attack_Jump_Chop', { loop: false, restart: true, speed: 0.6 * spd }); this.strikeAt = 1.2 / spd; }
          if ((this.state as BState) === 'spin') { this.anim.play('2H_Melee_Attack_Spin', { loop: false, restart: true, speed: 0.6 }); this.strikeAt = 0.9; }
          if ((this.state as BState) === 'volley') { this.anim.play('Spellcast_Raise', { loop: false, restart: true, speed: 0.7 }); }
        } else move = dist > 5 ? 3.6 * spd : 0;
        if (this.state === 'chase') this.anim.play(move > 0 ? 'Walking_D_Skeletons' : 'Idle_Combat', { speed: 0.7 });
        break;
      case 'sweep': case 'spin': {
        face = this.t < this.strikeAt * 0.7 ? dirP : null;
        if (this.t >= this.strikeAt && !this.hitDone) {
          this.hitDone = true;
          audio.play('swingHeavy');
          g.fx.slash(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), this.yaw, 0xb070ff, 7, this.state === 'spin');
          const f = this.forward();
          if (dist < 7.5 && (this.state === 'spin' || dirP.dot(f) > -0.1) && Math.abs(P.pos.y - this.pos.y) < 3) g.hitPlayer(this.state === 'spin' ? 8 : 6, this.pos, this, false, 2);
        }
        if (this.t > this.strikeAt + 1.0) { this.cd = 1.5; this.set('chase'); }
        break;
      }
      case 'slam': {
        face = this.t < this.strikeAt * 0.6 ? dirP : null;
        if (this.t < this.strikeAt * 0.6) move = Math.min(dist, 8) * 0.9;
        if (this.t >= this.strikeAt && !this.hitDone) {
          this.hitDone = true;
          audio.play('explode', 0.7); g.camRig.shake(0.8); g.input.rumble(0.8, 300);
          const at = this.pos.clone().addScaledVector(this.forward(), 3);
          g.fx.burst(at, 40, 0x9a70ff, 8, 0.6, 0.8, 6);
          if (at.distanceTo(P.pos) < 4) g.hitPlayer(8, at, this, false, 2);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 6, 48), new THREE.MeshBasicMaterial({ color: 0xc090ff, transparent: true, opacity: 0.9 }));
          ring.rotation.x = Math.PI / 2; ring.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
          g.scene.add(ring);
          this.waves.push({ mesh: ring, r: 1, hit: false });
        }
        if (this.t > this.strikeAt + 1.2) { this.cd = 1.8; this.set('chase'); }
        break;
      }
      case 'volley':
        face = dirP;
        if (Math.random() < 0.5) g.fx.sparkle(this.pos.clone().add(new THREE.Vector3(0, 6, 0)), 0xb070ff, 2, 1.5);
        if (this.t > 1.2 && !this.hitDone) {
          this.hitDone = true;
          for (let i = -2; i <= 2; i++) {
            const o = this.pos.clone().add(new THREE.Vector3(0, 6, 0));
            const v = P.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(o).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.18).multiplyScalar(16);
            g.projectiles.fireball(o, v, false, 4);
          }
          audio.play('fire');
          this.anim.play('Spellcast_Shoot', { loop: false, restart: true, speed: 0.7 });
        }
        if (this.t > 2.2) { this.cd = 2; this.set('chase'); }
        break;
      case 'summon':
        if (this.t < 0.05) { this.anim.play('Spellcast_Summon', { loop: false, restart: true, speed: 0.7 }); g.toast('The Hollow King summons his servants!'); }
        if (this.t > 1.4 && !this.hitDone) {
          this.hitDone = true; this.summoned++;
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            const e = g.enemies.spawn(i === 0 && phase === 3 ? 'warrior' : 'minion', this.center.x + Math.cos(a) * 12, this.center.z + Math.sin(a) * 12);
            e.aware = true; e.setState('spawn'); e.anim.play('Spawn_Ground_Skeletons', { loop: false, clamp: true, restart: true });
          }
        }
        if (this.t > 2.5) { this.cd = 2; this.set('chase'); }
        break;
      case 'stun':
        if (Math.random() < 0.3) g.fx.sparkle(this.pos.clone().add(new THREE.Vector3(0, this.height + 0.5, 0)), 0xffff80, 1, 1.5);
        if (this.t > 2.8) { this.set('chase'); }
        break;
      case 'dead':
        if (this.t > 2 && this.t < 6 && Math.random() < 0.5) g.fx.burst(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 3)), 10, 0xffe0a0, 4, 0.4, 0.8, -1);
        if (this.t > 5) { this.model.position.y -= dt; if (this.t > 8) { this.root.visible = false; this.active = false; } }
        break;
    }
    if (face) this.yaw = dampAngle(this.yaw, Math.atan2(face.x, face.z), 4, dt);
    const f = this.forward();
    this.vel.x = damp(this.vel.x, f.x * move, 5, dt); this.vel.z = damp(this.vel.z, f.z * move, 5, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    // stay in arena
    const off = this.pos.clone().sub(this.center); off.y = 0;
    if (off.length() > 24) { off.setLength(24); this.pos.x = this.center.x + off.x; this.pos.z = this.center.z + off.z; }
    this.pos.y = damp(this.pos.y, g.terrain.heightAt(this.pos.x, this.pos.z), 10, dt);
    // push player out
    if (dist < this.radius + 0.4 && this.alive) { P.pos.x += dirP.x * (this.radius + 0.4 - dist); P.pos.z += dirP.z * (this.radius + 0.4 - dist); }
    // shockwaves
    for (const w of this.waves.slice()) {
      w.r += dt * 11;
      w.mesh.scale.setScalar(w.r);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - w.r / 26);
      const pd = Math.hypot(P.pos.x - w.mesh.position.x, P.pos.z - w.mesh.position.z);
      const onGround = P.state === 'ground' || P.state === 'locked' || P.state === 'hurt';
      if (!w.hit && Math.abs(pd - w.r) < 0.8 && onGround) { w.hit = true; g.hitPlayer(4, w.mesh.position, null, false, 1.5); }
      if (w.r > 26) { w.mesh.removeFromParent(); this.waves.splice(this.waves.indexOf(w), 1); }
    }
    this.anim.update(dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}
