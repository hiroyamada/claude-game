import * as THREE from 'three';
import { assets, Animator, findBone } from '../engine/Assets';
import { audio } from '../engine/Audio';
import { clamp, damp, dampAngle, angleDiff } from '../engine/noise';
import type { Game } from '../Game';
import type { Box } from '../world/Colliders';
import { itemDef, type WeaponDef, type ShieldDef, type BowDef } from './Items';
import { makeToonMaterial } from '../engine/Materials';
import { SNOW_LINE } from '../world/WorldData';

export type PState = 'ground' | 'air' | 'glide' | 'climb' | 'swim' | 'dodge' | 'hurt' | 'dead' | 'mantle' | 'locked';

const GRAV = 26;
const RADIUS = 0.35, HEIGHT = 1.75;

interface Attack { anims: string[]; idx: number; t: number; dur: number; hitAt: number; hit: boolean; queued: boolean; kind: 'combo' | 'spin' | 'plunge' | 'flurry'; }

function recolorHero(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshToonMaterial;
    if (!mat.map || (mat.map as any).__recolored) return;
    const img = mat.map.image as ImageBitmap | HTMLImageElement;
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d')!; ctx.drawImage(img as any, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    const c = new THREE.Color(); const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < d.data.length; i += 4) {
      c.setRGB(d.data[i] / 255, d.data[i + 1] / 255, d.data[i + 2] / 255);
      c.getHSL(hsl);
      if (hsl.h > 0.2 && hsl.h < 0.5 && hsl.s > 0.2) {
        c.setHSL(0.6 + (hsl.h - 0.35) * 0.3, Math.min(1, hsl.s * 0.9), hsl.l * 0.85);
        d.data[i] = c.r * 255; d.data[i + 1] = c.g * 255; d.data[i + 2] = c.b * 255;
      }
    }
    ctx.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.flipY = mat.map.flipY; t.colorSpace = THREE.SRGBColorSpace;
    (t as any).__recolored = true;
    const nm = mat.clone(); nm.map = t; nm.onBeforeCompile = mat.onBeforeCompile; nm.customProgramCacheKey = mat.customProgramCacheKey;
    m.material = nm;
  });
}

export class Player {
  root = new THREE.Group();
  model: THREE.Object3D;
  anim: Animator;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  state: PState = 'ground';
  stateT = 0;
  // stats
  health = 12; // quarters
  stamina = 100;
  exhausted = false;
  staminaDelay = 0;
  extraHearts = 0; // quarters (temporary yellow hearts)
  buffs: Record<string, { level: number; t: number }> = {};
  invuln = 0;
  // combat
  attack: Attack | null = null;
  chargeT = 0;
  shielding = false;
  shieldT = 0; // time since shield raised (parry window)
  aiming = false;
  drawT = 0;
  lockTarget: any = null;
  flurryT = 0;
  // climbing
  climbSurf: { kind: 'terrain' } | { kind: 'box'; box: Box; n: THREE.Vector3 } | null = null;
  climbN = new THREE.Vector3(0, 0, 1);
  slipT = 0;
  // misc
  onGround = true;
  groundNormal = new THREE.Vector3(0, 1, 0);
  groundRef: any = null;
  fallStartY = 0;
  crouch = false;
  sprinting = false;
  lastSafe = new THREE.Vector3();
  coldT = 0;
  stepT = 0;
  mantleFrom = new THREE.Vector3(); mantleTo = new THREE.Vector3();
  gliderMesh: THREE.Object3D;
  private handR: THREE.Object3D; private handL: THREE.Object3D; private back: THREE.Object3D;
  private weaponObj: THREE.Object3D | null = null; private shieldObj: THREE.Object3D | null = null; private bowObj: THREE.Object3D | null = null;
  private gearKey = '';
  private lastHitT = 0;
  private hurtCooldown = 0;
  oneShot = '';
  private oneShotT = 0;
  sneaky = false;
  speedMul = 1;

  constructor(private g: Game) {
    this.model = assets.character('Rogue_Hooded');
    recolorHero(this.model);
    this.model.scale.setScalar(0.72);
    this.root.add(this.model);
    this.anim = new Animator(this.model);
    this.anim.play('Idle');
    this.handR = findBone(this.model, 'handslotr')!;
    this.handL = findBone(this.model, 'handslotl')!;
    this.back = findBone(this.model, 'chest')!;
    this.gliderMesh = this.buildGlider();
    this.gliderMesh.visible = false;
    this.root.add(this.gliderMesh);
    g.scene.add(this.root);
  }

  private buildGlider() {
    const grp = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(-1.6, 0); shape.quadraticCurveTo(0, 0.5, 1.6, 0); shape.lineTo(1.2, -0.9); shape.quadraticCurveTo(0, -0.6, -1.2, -0.9); shape.closePath();
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), makeToonMaterial({ color: 0xd8a25a, side: THREE.DoubleSide }));
    cloth.rotation.x = -Math.PI / 2 + 0.45;
    cloth.scale.setScalar(1.15);
    cloth.position.set(0, 2.25, 0.25);
    grp.add(cloth);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.15), makeToonMaterial({ color: 0x8a3a2a, side: THREE.DoubleSide }));
    stripe.rotation.x = -Math.PI / 2 + 0.45; stripe.position.set(0, 2.3, 0.1);
    grp.add(stripe);
    const rodM = makeToonMaterial({ color: 0x6b4a2f });
    for (const x of [-0.25, 0.25]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 4), rodM);
      rod.position.set(x, 1.8, 0.05); rod.rotation.z = x * 0.6;
      grp.add(rod);
    }
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    return grp;
  }

  get maxHealth() { return this.g.state.maxHearts * 4; }
  get maxStamina() { return this.g.state.maxStamina; }
  buff(k: string) { const b = this.buffs[k]; return b && b.t > 0 ? b.level : 0; }

  spawn(x: number, y: number, z: number, yaw = 0) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw;
    this.state = 'ground'; this.attack = null; this.lastSafe.copy(this.pos);
    this.root.position.copy(this.pos);
  }

  // ---------- gear visuals ----------
  syncGear() {
    const inv = this.g.inv;
    const w = inv.weapon(), s = inv.shield(), b = inv.bow();
    const key = `${w?.id}|${s?.id}|${b?.id}|${this.aiming}|${inv.equipped.weapon}`;
    if (key === this.gearKey) return;
    this.gearKey = key;
    for (const o of [this.weaponObj, this.shieldObj, this.bowObj]) o?.removeFromParent();
    this.weaponObj = this.shieldObj = this.bowObj = null;
    const mk = (d: WeaponDef | ShieldDef | BowDef) => {
      const o = assets.item(d.model);
      if (d.tint) o.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) { m.material = (m.material as THREE.MeshToonMaterial).clone(); (m.material as THREE.MeshToonMaterial).color.multiply(new THREE.Color(d.tint!)); } });
      if ((d as WeaponDef).id === 'royalsword') o.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) { (m.material as THREE.MeshToonMaterial).emissive = new THREE.Color(0x553300); } });
      return o;
    };
    const two = w?.type === 'two' || w?.type === 'spear';
    if (w) {
      this.weaponObj = mk(w);
      if (this.aiming) { this.back.add(this.weaponObj); this.weaponObj.position.set(0, 0.2, -0.35); this.weaponObj.rotation.set(0, 0, Math.PI * 0.8); }
      else this.handR.add(this.weaponObj);
    }
    if (s) {
      this.shieldObj = mk(s);
      if (two || this.aiming) { this.back.add(this.shieldObj); this.shieldObj.position.set(0, 0.1, -0.4); this.shieldObj.rotation.set(0, Math.PI, 0); }
      else this.handL.add(this.shieldObj);
    }
    if (b && this.aiming) { this.bowObj = mk(b); this.handR.add(this.bowObj); }
  }

  // ---------- helpers ----------
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  private camBasis(fwd: THREE.Vector3, right: THREE.Vector3) {
    const y = this.g.camRig.yaw;
    fwd.set(-Math.sin(y), 0, -Math.cos(y)); right.set(Math.cos(y), 0, -Math.sin(y));
  }
  useStamina(n: number) {
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0.8;
    if (this.stamina <= 0 && !this.exhausted) { this.exhausted = true; audio.play('lowHp', 0.7); }
  }
  ground(x: number, z: number, maxY: number) { return this.g.groundAt(x, z, maxY); }

  playOnce(name: string, speed = 1, fade = 0.1) {
    this.anim.play(name, { loop: false, speed, restart: true, fade });
    this.oneShot = name;
    this.oneShotT = this.anim.duration(name) / speed;
  }

  // ---------- main update ----------
  update(dt: number) {
    const g = this.g, inp = g.input;
    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    for (const k in this.buffs) { this.buffs[k].t -= dt; if (this.buffs[k].t <= 0) delete this.buffs[k]; }
    this.speedMul = 1 + this.buff('speed') * 0.12;
    if (this.oneShotT > 0) { this.oneShotT -= dt; if (this.oneShotT <= 0) this.oneShot = ''; }
    const controllable = g.mode === 'play' && !g.cutscene;

    const fwd = _v1, right = _v2, move = _v3;
    this.camBasis(fwd, right);
    move.set(0, 0, 0);
    if (controllable) move.addScaledVector(fwd, inp.move.y).addScaledVector(right, inp.move.x);
    const mlen = Math.min(1, move.length());
    if (mlen > 0.01) move.normalize();

    // shield / lock-on
    const canGuard = controllable && (this.state === 'ground' || this.state === 'locked') && !this.aiming;
    const wasShield = this.shielding;
    this.shielding = canGuard && inp.down('shield') && !this.attack;
    if (this.shielding && !wasShield) { this.shieldT = 0; this.lockTarget = g.enemies.nearestTarget(this.pos, 22, this.lockTarget); }
    if (this.shielding) this.shieldT += dt; else this.lockTarget = null;
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.pos.distanceTo(this.pos) > 30)) this.lockTarget = null;

    // aiming crossbow
    const wantAim = controllable && inp.down('aim') && !!g.inv.bow() && ['ground', 'air', 'glide', 'swim'].includes(this.state) && this.state !== 'swim' && !this.attack && !g.runes.active;
    if (wantAim && !this.aiming) { this.aiming = true; this.drawT = 0; audio.play('draw'); }
    if (this.aiming) {
      this.drawT += dt;
      const fire = inp.released('aim') || (inp.pressed('attack'));
      if (fire && this.drawT > 0.25) this.fireBolt();
      if (!inp.down('aim')) this.aiming = false;
      if (this.state === 'glide') { this.state = 'air'; }
    }
    // bullet time when aiming midair
    g.bulletTime = this.aiming && this.state === 'air' && this.stamina > 0 && !this.exhausted;
    if (g.bulletTime) this.useStamina(14 * dt);

    switch (this.state) {
      case 'ground': case 'locked': this.updateGround(dt, move, mlen, controllable); break;
      case 'air': this.updateAir(dt, move, mlen, controllable); break;
      case 'glide': this.updateGlide(dt, move, mlen, controllable); break;
      case 'climb': this.updateClimb(dt, controllable); break;
      case 'swim': this.updateSwim(dt, move, mlen, controllable); break;
      case 'dodge': this.updateDodge(dt); break;
      case 'hurt': this.updateHurt(dt); break;
      case 'mantle': this.updateMantle(dt); break;
      case 'dead': this.vel.set(0, 0, 0); break;
    }

    // attacks progress
    if (this.attack) this.updateAttack(dt, controllable);

    // stamina regen
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if ((this.state === 'ground' || this.state === 'locked' || this.state === 'swim') && !this.sprinting && !g.bulletTime) {
      this.stamina = Math.min(this.maxStamina, this.stamina + (this.exhausted ? 22 : 40) * dt);
      if (this.stamina >= this.maxStamina) this.exhausted = false;
    }

    // environment: cold
    const cold = this.pos.y > SNOW_LINE - 10 && !this.g.inShrine;
    const warm = this.buff('warm') > 0 || g.nearFire(this.pos);
    if (cold && !warm && this.state !== 'dead') {
      this.coldT += dt;
      if (this.coldT > 4) { this.coldT = 0; g.damagePlayer(1, null, 'cold'); }
    } else this.coldT = 0;
    g.coldness = damp(g.coldness, cold && !warm ? 1 : 0, 2, dt);

    // fall out of world
    if (this.pos.y < -60 || (this.g.inShrine && this.pos.y < this.g.shrines.floorY() - 25)) {
      g.damagePlayer(4, null, 'fall'); this.respawnSafe();
    }

    this.syncGear();
    this.updateVisual(dt, move, mlen);
  }

  respawnSafe() {
    this.pos.copy(this.lastSafe); this.vel.set(0, 0, 0); this.state = 'ground'; this.stateT = 0;
  }

  private faceToward(dir: THREE.Vector3, rate: number, dt: number) {
    if (dir.lengthSq() < 1e-4) return;
    this.yaw = dampAngle(this.yaw, Math.atan2(dir.x, dir.z), rate, dt);
  }

  private startClimbCheck(move: THREE.Vector3, mlen: number): boolean {
    if (this.exhausted || this.stamina <= 0) return false;
    const g = this.g;
    const dir = mlen > 0.2 ? move : null;
    if (!dir) return false;
    // box faces (towers, pillars)
    const face = g.colliders.climbFace(this.pos, dir, RADIUS + 0.25, 1.0);
    if (face && face.box.max.y - this.pos.y > 1.3) {
      this.climbSurf = { kind: 'box', box: face.box, n: face.normal.clone() };
      this.climbN.copy(face.normal);
      this.enterClimb();
      return true;
    }
    // steep terrain ahead
    if (g.inShrine) return false;
    const ax = this.pos.x + dir.x * 0.9, az = this.pos.z + dir.z * 0.9;
    const h = g.terrain.heightAt(ax, az);
    if (h > this.pos.y + 0.9) {
      const n = g.terrain.normalAt(ax, az, _v4);
      if (n.y < 0.6 && (n.x * dir.x + n.z * dir.z) < -0.2) {
        this.climbSurf = { kind: 'terrain' };
        this.climbN.copy(n);
        this.enterClimb();
        // move onto the wall and stick to it
        this.pos.x += dir.x * 0.5; this.pos.z += dir.z * 0.5;
        this.pos.y = Math.max(this.pos.y, g.terrain.heightAt(this.pos.x, this.pos.z) - 0.2);
        this.climbStep(0, 0, 0);
        return true;
      }
    }
    return false;
  }
  private enterClimb() {
    this.state = 'climb'; this.stateT = 0; this.vel.set(0, 0, 0); this.attack = null; this.aiming = false;
    this.gliderMesh.visible = false;
  }

  private updateGround(dt: number, move: THREE.Vector3, mlen: number, ctl: boolean) {
    const g = this.g, inp = g.input;
    this.crouch = ctl && (inp.pressed('crouch') ? !this.crouch : this.crouch);
    this.sprinting = ctl && inp.down('sprint') && mlen > 0.3 && !this.exhausted && !this.shielding && !this.attack && !this.aiming && !this.crouch;
    let speed = (mlen < 0.6 ? 3.0 : 6.2) * mlen;
    if (this.sprinting) { speed = 9.5; this.useStamina(18 * dt); }
    if (this.crouch) speed = Math.min(speed, 2.4);
    if (this.exhausted) speed = Math.min(speed, 2.6);
    if (this.shielding || this.aiming) speed = Math.min(speed, 3.0);
    if (this.attack && this.attack.kind !== 'flurry') speed = this.attack.kind === 'spin' ? 1.5 : 0.6;
    if (g.runes.holding) speed = Math.min(speed, 2.5);
    speed *= this.speedMul;
    // slope handling
    const n = this.groundNormal;
    let tvx = move.x * speed, tvz = move.z * speed;
    const steep = n.y < 0.68 && !this.groundRef;
    if (steep) { tvx = n.x * 7; tvz = n.z * 7; }
    const acc = steep ? 4 : 14;
    this.vel.x = damp(this.vel.x, tvx, acc, dt);
    this.vel.z = damp(this.vel.z, tvz, acc, dt);
    // facing
    if (this.lockTarget) {
      const d = _v4.copy(this.lockTarget.pos).sub(this.pos); d.y = 0; this.faceToward(d, 14, dt);
    } else if (this.aiming || g.runes.aiming) {
      this.yaw = dampAngle(this.yaw, g.camRig.yaw + Math.PI, 20, dt);
    } else if (mlen > 0.05 && (!this.attack || this.attack.t < 0.1)) this.faceToward(move, 12, dt);

    if (ctl && !steep && this.startClimbCheck(move, mlen)) return;

    // jump / dodge
    if (ctl && inp.pressed('jump') && !this.attack) {
      if (this.shielding && this.lockTarget && mlen > 0.3) {
        this.startDodge(move);
        return;
      } else if (this.shielding && this.lockTarget) { this.startDodge(this.forward(_v4).multiplyScalar(-1)); return; }
      this.vel.y = 8.6; this.state = 'air'; this.stateT = 0; this.onGround = false; this.fallStartY = this.pos.y;
      this.groundRef = null;
      audio.play('jump', 0.6);
      return;
    }
    // integrate
    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    // riding platforms
    if (this.groundRef && this.groundRef.ref && this.groundRef.ref.delta) { this.pos.add(this.groundRef.ref.delta); }
    g.colliders.pushOut(this.pos, RADIUS, HEIGHT, undefined, this.groundRef, 0.55);
    g.pushOutDynamic(this.pos, RADIUS);
    const gr = this.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);
    if (gr.y >= prevY - 0.7 && gr.y <= this.pos.y + 0.6) {
      this.pos.y = gr.y; this.vel.y = 0; this.groundRef = gr.c;
      if (gr.c) this.groundNormal.set(0, 1, 0); else g.terrain.normalAt(this.pos.x, this.pos.z, this.groundNormal);
      if (!steep && !g.inShrine && gr.y > 0.5 && !gr.c) this.lastSafe.copy(this.pos);
      if (g.inShrine && gr.c) this.lastSafe.copy(this.pos);
    } else {
      this.state = 'air'; this.stateT = 0; this.fallStartY = this.pos.y; this.groundRef = null;
    }
    // water
    const wl = g.waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.pos.y > 1.15) { this.enterSwim(); return; }

    // attacks
    if (ctl && !this.aiming && !g.runes.aiming) this.handleAttackInput(dt);
    if (ctl && inp.pressed('throw') && !this.attack && g.inv.weapon() && !g.runes.holdingBomb()) this.throwWeapon();

    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.stepT += hs * dt;
    if (this.stepT > 1.7) { this.stepT = 0; audio.play('step', this.crouch ? 0.2 : 0.5); }
  }

  private updateAir(dt: number, move: THREE.Vector3, mlen: number, ctl: boolean) {
    const g = this.g, inp = g.input;
    this.vel.y -= GRAV * dt;
    this.vel.y = Math.max(this.vel.y, -45);
    const air = 5;
    this.vel.x = damp(this.vel.x, move.x * 6.2 * mlen, air * 0.5, dt);
    this.vel.z = damp(this.vel.z, move.z * 6.2 * mlen, air * 0.5, dt);
    if (mlen > 0.1 && !this.aiming) this.faceToward(move, 6, dt);
    if (this.aiming || g.runes.aiming) this.yaw = dampAngle(this.yaw, g.camRig.yaw + Math.PI, 20, dt);
    if (this.vel.y < 0 && this.fallStartY < this.pos.y) this.fallStartY = this.pos.y;
    // glide
    if (ctl && inp.pressed('jump') && this.stateT > 0.15 && g.state.glider && !this.exhausted && this.stamina > 0 && !this.aiming) {
      this.state = 'glide'; this.stateT = 0; this.gliderMesh.visible = true; audio.play('glide');
      this.vel.y = Math.max(this.vel.y, -3);
      return;
    }
    // plunge attack
    if (ctl && inp.pressed('attack') && !this.attack && !this.aiming && this.pos.y - g.terrain.heightAt(this.pos.x, this.pos.z) > 1.2) {
      this.startAttack('plunge');
    }
    if (ctl && this.startClimbCheck(move, mlen) && this.stateT > 0.1) return;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    g.colliders.pushOut(this.pos, RADIUS, HEIGHT);
    g.pushOutDynamic(this.pos, RADIUS);
    // ceiling
    const ceil = g.colliders.ceiling(this.pos.x, this.pos.z, prevY + HEIGHT - 0.05, RADIUS);
    if (this.pos.y + HEIGHT > ceil && this.vel.y > 0) { this.pos.y = ceil - HEIGHT; this.vel.y = 0; }
    const wl = g.waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.pos.y > 1.0) { this.enterSwim(); audio.play('splash'); g.fx.burst(new THREE.Vector3(this.pos.x, wl, this.pos.z), 20, 0xcfefff, 4, 0.3, 0.7, 10); return; }
    const gr = this.ground(this.pos.x, this.pos.z, prevY + 0.3);
    if (this.pos.y <= gr.y && this.vel.y <= 0) {
      this.land(gr);
    }
  }

  private land(gr: { y: number; c: any }) {
    const g = this.g;
    const fall = this.fallStartY - gr.y;
    this.pos.y = gr.y;
    this.groundRef = gr.c;
    this.state = 'ground'; this.stateT = 0;
    this.gliderMesh.visible = false;
    if (this.attack?.kind === 'plunge') { this.plungeImpact(); }
    if (fall > 11 && (this.state as PState) !== 'dead') {
      const dmg = Math.floor((fall - 10) * 0.6);
      if (dmg > 0) g.damagePlayer(dmg, null, 'fall');
      if (this.state === 'ground') this.playOnce('Jump_Land', 1);
    } else if (this.vel.y < -6) { this.playOnce('Jump_Land', 1.5); }
    audio.play('land', clamp(-this.vel.y / 15, 0.2, 1));
    if (this.vel.y < -12) g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), 10, 0xd8c8a0, 3, 0.4, 0.5, 4, 0.4);
    this.vel.y = 0;
  }

  private updateGlide(dt: number, move: THREE.Vector3, mlen: number, ctl: boolean) {
    const g = this.g, inp = g.input;
    this.useStamina(8 * dt);
    if (this.exhausted || this.stamina <= 0 || (ctl && (inp.pressed('jump') || inp.pressed('back') && g.input.device !== 'pad'))) {
      this.state = 'air'; this.stateT = 0.2; this.gliderMesh.visible = false; this.fallStartY = this.pos.y; return;
    }
    if (mlen > 0.1) this.faceToward(move, 2.5, dt);
    const f = this.forward(_v4);
    const sp = 8.5 * (0.55 + 0.45 * mlen);
    this.vel.x = damp(this.vel.x, f.x * sp, 2, dt);
    this.vel.z = damp(this.vel.z, f.z * sp, 2, dt);
    const lift = g.updraftAt(this.pos);
    this.vel.y = damp(this.vel.y, lift > 0 ? lift : -2.2, lift > 0 ? 1.5 : 3, dt);
    this.fallStartY = this.pos.y;
    if (ctl && this.startClimbCheck(move, mlen)) return;
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    g.colliders.pushOut(this.pos, RADIUS, HEIGHT);
    const wl = g.waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.pos.y > 1.0) { this.enterSwim(); return; }
    const gr = this.ground(this.pos.x, this.pos.z, prevY + 0.3);
    if (this.pos.y <= gr.y) this.land(gr);
  }

  private updateClimb(dt: number, ctl: boolean) {
    const g = this.g, inp = g.input;
    const s = this.climbSurf!;
    let mx = ctl ? inp.move.x : 0, my = ctl ? inp.move.y : 0;
    const raining = g.weather.rain > 0.4 && !g.inShrine;
    if (ctl && (inp.pressed('back') && inp.device !== 'touch' || inp.pressed('sprint') && inp.device === 'touch')) { this.letGo(); return; }
    // climb jump
    if (ctl && inp.pressed('jump') && !this.exhausted) {
      this.useStamina(22);
      if (raining) { audio.play('land', 0.3); }
      const dirY = Math.abs(mx) + Math.abs(my) < 0.2 ? 1 : my;
      mx *= 3.2; my = dirY * (raining ? 0.8 : 3.2);
      this.playOnce('Jump_Full_Short', 1.6);
      this.climbStep(mx, my, 1);
      return;
    }
    const moving = Math.abs(mx) + Math.abs(my) > 0.1;
    if (moving) this.useStamina(7 * dt);
    if (this.exhausted || this.stamina <= 0) { this.letGo(); return; }
    let speed = 1.9 * this.speedMul;
    // rain: slip
    if (raining) {
      this.slipT += dt;
      if (this.slipT > 1.2 && my > 0) { this.slipT = 0; this.climbStep(0, -1.2, 1); }
    }
    this.climbStep(mx * speed * dt, my * speed * dt, 0);
  }

  /** move along climb surface by (dx right, dy up) meters */
  private climbStep(dx: number, dy: number, _jump: number) {
    const g = this.g;
    const s = this.climbSurf!;
    if (s.kind === 'box') {
      const n = s.n, b = s.box;
      const rightV = _v4.set(-n.z, 0, n.x);
      this.pos.addScaledVector(rightV, dx);
      this.pos.y += dy;
      // stick to face
      if (n.x !== 0) { this.pos.x = n.x > 0 ? b.max.x + RADIUS : b.min.x - RADIUS; this.pos.z = clamp(this.pos.z, b.min.z - 0.2, b.max.z + 0.2); }
      else { this.pos.z = n.z > 0 ? b.max.z + RADIUS : b.min.z - RADIUS; this.pos.x = clamp(this.pos.x, b.min.x - 0.2, b.max.x + 0.2); }
      this.yaw = Math.atan2(-n.x, -n.z);
      // wrapped off side?
      const off = n.x !== 0 ? (this.pos.z < b.min.z - 0.1 || this.pos.z > b.max.z + 0.1) : (this.pos.x < b.min.x - 0.1 || this.pos.x > b.max.x + 0.1);
      if (off) { this.letGo(); return; }
      // top out
      if (this.pos.y + 1.2 > b.max.y) {
        // is there a box above blocking? (e.g. tower ledges) -> just mantle onto top
        const tgt = new THREE.Vector3(this.pos.x - n.x * (RADIUS + 0.45), b.max.y, this.pos.z - n.z * (RADIUS + 0.45));
        g.colliders.pushOut(tgt, RADIUS * 0.8, HEIGHT);
        this.startMantle(tgt);
        return;
      }
      // reached ground below
      const gr = g.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1);
      if (dy < 0 && this.pos.y <= gr.y + 0.05) { this.pos.y = gr.y; this.state = 'ground'; this.stateT = 0; }
      // transfer to an adjacent stacked box (e.g. tower body above a ledge)
      return;
    }
    // terrain climbing
    const T = g.terrain;
    const n = T.normalAt(this.pos.x, this.pos.z, this.climbN);
    const upT = _v5.set(-n.x * n.y, 1 - n.y * n.y, -n.z * n.y).normalize();
    const rightV = _v4.crossVectors(n, upT).normalize();
    this.pos.addScaledVector(rightV, dx).addScaledVector(upT, dy);
    // project back to hold distance from surface
    for (let k = 0; k < 4; k++) {
      const nn = T.normalAt(this.pos.x, this.pos.z, _v6);
      const h = T.heightAt(this.pos.x, this.pos.z);
      const d = (this.pos.y - h) * nn.y;
      this.pos.addScaledVector(nn, 0.3 - d);
    }
    const nn = T.normalAt(this.pos.x, this.pos.z, this.climbN);
    this.yaw = Math.atan2(-nn.x, -nn.z);
    g.colliders.pushOut(this.pos, RADIUS, HEIGHT);
    // ledge: surface became walkable
    const hh = T.heightAt(this.pos.x, this.pos.z);
    if (nn.y > 0.74 && this.stateT > 0.25) {
      this.pos.y = Math.max(this.pos.y, hh);
      this.state = 'ground'; this.stateT = 0; this.vel.set(0, 0, 0);
      return;
    }
    // check top lip: look slightly above & ahead
    const ax = this.pos.x - nn.x * 0.8, az = this.pos.z - nn.z * 0.8;
    const ah = T.heightAt(ax, az);
    const an = T.normalAt(ax, az, _v6);
    if (dy > 0 && an.y > 0.75 && ah < this.pos.y + 1.6) {
      this.startMantle(new THREE.Vector3(ax, ah, az));
      return;
    }
    if (dy < 0 && this.pos.y < hh + 0.2 && nn.y > 0.5) { this.state = 'ground'; this.stateT = 0; }
    const wl = g.waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.pos.y > 1.0) this.enterSwim();
  }

  private startMantle(to: THREE.Vector3) {
    this.state = 'mantle'; this.stateT = 0;
    this.mantleFrom.copy(this.pos); this.mantleTo.copy(to);
    this.playOnce('Jump_Land', 1.4);
  }
  private updateMantle(_dt: number) {
    const k = Math.min(1, this.stateT / 0.35);
    const e = k * k * (3 - 2 * k);
    this.pos.lerpVectors(this.mantleFrom, this.mantleTo, e);
    this.pos.y = this.mantleFrom.y + (this.mantleTo.y + 0.3 - this.mantleFrom.y) * Math.min(1, k * 1.6) - (k > 0.6 ? (k - 0.6) * 0.75 : 0);
    if (k >= 1) { this.pos.copy(this.mantleTo); this.state = 'ground'; this.stateT = 0; this.vel.set(0, 0, 0); }
  }

  letGo() {
    this.state = 'air'; this.stateT = 0.2;
    this.vel.set(this.climbN.x * 2.5, 0, this.climbN.z * 2.5);
    this.pos.addScaledVector(this.climbN, 0.1);
    this.fallStartY = this.pos.y;
  }

  private enterSwim() {
    this.state = 'swim'; this.stateT = 0; this.vel.y = 0; this.attack = null; this.gliderMesh.visible = false; this.aiming = false;
    this.fallStartY = this.pos.y;
  }
  private updateSwim(dt: number, move: THREE.Vector3, mlen: number, ctl: boolean) {
    const g = this.g, inp = g.input;
    const wl = g.waterLevelAt(this.pos.x, this.pos.z);
    let speed = 2.6 * mlen * this.speedMul;
    if (ctl && inp.pressed('sprint') && !this.exhausted && mlen > 0.1) {
      this.useStamina(20);
      this.vel.addScaledVector(move, 5);
      audio.play('splash', 0.4);
    }
    this.vel.x = damp(this.vel.x, move.x * speed, 2.5, dt);
    this.vel.z = damp(this.vel.z, move.z * speed, 2.5, dt);
    if (mlen > 0.05) this.faceToward(move, 6, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.pos.y = damp(this.pos.y, wl - 1.25, 6, dt);
    g.colliders.pushOut(this.pos, RADIUS, HEIGHT);
    if (ctl && this.startClimbCheck(move, mlen)) return;
    const gr = this.ground(this.pos.x, this.pos.z, this.pos.y + 1.0);
    if (gr.y > wl - 1.05) { this.pos.y = gr.y; this.state = 'ground'; this.stateT = 0; return; }
    if (this.exhausted && this.stamina <= 0) {
      // drown
      g.damagePlayer(4, null, 'drown');
      g.toast('You ran out of stamina and sank...');
      this.respawnSafe();
      this.stamina = this.maxStamina; this.exhausted = false;
    }
    if (Math.random() < dt * 3 * mlen) g.fx.spawn(new THREE.Vector3(this.pos.x, wl + 0.05, this.pos.z), new THREE.Vector3(0, 0.5, 0), 0xffffff, 0.3, 0.6, 0);
  }

  private startDodge(dir: THREE.Vector3) {
    this.state = 'dodge'; this.stateT = 0;
    const d = dir.clone().setY(0).normalize();
    this.vel.set(d.x * 9, 0, d.z * 9);
    this.invuln = 0.4;
    // pick anim relative to facing
    const f = this.forward(_v4);
    const dotF = d.dot(f), cr = f.x * d.z - f.z * d.x;
    const name = dotF < -0.5 ? 'Dodge_Backward' : dotF > 0.5 ? 'Dodge_Forward' : cr > 0 ? 'Dodge_Left' : 'Dodge_Right';
    this.playOnce(name, 1.5);
    audio.play('jump', 0.5);
    // perfect dodge check -> flurry rush
    if (this.g.enemies.attackIncoming(this.pos, 0.35)) {
      this.flurryT = 2.6;
      this.g.startFlurry();
    }
  }
  private updateDodge(dt: number) {
    this.vel.multiplyScalar(Math.exp(-4 * dt));
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.g.colliders.pushOut(this.pos, RADIUS, HEIGHT);
    const gr = this.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);
    this.pos.y = gr.y > this.pos.y - 1 ? gr.y : this.pos.y - 9 * dt;
    if (this.stateT > 0.45) { this.state = 'ground'; this.stateT = 0; }
  }

  private updateHurt(dt: number) {
    this.vel.x *= Math.exp(-5 * dt); this.vel.z *= Math.exp(-5 * dt);
    this.vel.y -= GRAV * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.g.colliders.pushOut(this.pos, RADIUS, HEIGHT);
    const gr = this.ground(this.pos.x, this.pos.z, this.pos.y + 0.6);
    if (this.pos.y <= gr.y) { this.pos.y = gr.y; this.vel.y = 0; }
    const wl = this.g.waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.pos.y > 1.15) { this.enterSwim(); return; }
    if (this.stateT > 0.5) { this.state = this.pos.y > gr.y + 0.3 ? 'air' : 'ground'; this.stateT = 0; }
  }

  // ---------- combat ----------
  private handleAttackInput(dt: number) {
    const inp = this.g.input;
    const w = this.g.inv.weapon();
    if (this.attack) {
      if (inp.pressed('attack') && this.attack.kind === 'combo' && this.attack.t > this.attack.dur * 0.3) this.attack.queued = true;
      if (this.attack.kind === 'flurry' && inp.pressed('attack')) this.attack.queued = true;
      return;
    }
    if (this.flurryT > 0 && inp.pressed('attack')) { this.startAttack('flurry'); return; }
    if (inp.down('attack') && w) {
      this.chargeT += dt;
      if (this.chargeT > 0.45 && this.chargeT - dt <= 0.45) { audio.play('rune', 0.4); }
      if (this.chargeT > 0.45) { this.anim.play('2H_Melee_Idle', { fade: 0.2 }); this.g.fx.sparkle(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xfff0a0, 1, 1); }
    }
    if (inp.released('attack')) {
      if (this.chargeT > 0.45 && w && this.stamina > 0) { this.useStamina(28); this.startAttack('spin'); }
      else if (!this.shielding || this.lockTarget) this.startAttack('combo');
      this.chargeT = 0;
    } else if (!inp.down('attack')) this.chargeT = 0;
    // shield bash = parry attempt when pressing attack while guarding is handled as combo
  }

  startAttack(kind: Attack['kind']) {
    const w = this.g.inv.weapon();
    const type = w ? w.type : 'none';
    let anims: string[]; let dur: number;
    if (kind === 'spin') { anims = ['2H_Melee_Attack_Spin']; dur = 0.7; }
    else if (kind === 'plunge') { anims = ['1H_Melee_Attack_Jump_Chop']; dur = 0.9; }
    else if (kind === 'flurry') { anims = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab']; dur = 0.22; }
    else if (type === 'two') { anims = ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Chop', '2H_Melee_Attack_Spin']; dur = 0.75; }
    else if (type === 'spear') { anims = ['1H_Melee_Attack_Stab', '2H_Melee_Attack_Stab', '1H_Melee_Attack_Stab']; dur = 0.5; }
    else if (type === 'one') { anims = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop']; dur = 0.48; }
    else { anims = ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Kick', 'Unarmed_Melee_Attack_Punch_A']; dur = 0.45; }
    this.attack = { anims, idx: 0, t: 0, dur, hitAt: kind === 'plunge' ? 99 : dur * 0.42, hit: false, queued: false, kind };
    this.beginSwing();
    if (kind === 'plunge') { this.vel.y = 4; this.vel.x *= 0.3; this.vel.z *= 0.3; }
  }
  private beginSwing() {
    const a = this.attack!;
    const name = a.anims[a.idx % a.anims.length];
    const clipDur = this.anim.duration(name);
    let speed = clipDur / a.dur;
    if (a.kind === 'plunge') speed = 1.4;
    this.anim.play(name, { loop: false, speed, restart: true, fade: 0.06 });
    this.oneShot = name; this.oneShotT = a.dur;
    a.t = 0; a.hit = false; a.queued = false;
    const w = this.g.inv.weapon();
    audio.play(w?.type === 'two' || a.kind === 'spin' ? 'swingHeavy' : 'swing');
    // lunge toward lock target / forward
    const f = this.forward(_v4);
    if (this.lockTarget) { const d = _v5.copy(this.lockTarget.pos).sub(this.pos); d.y = 0; if (d.length() > 2) f.copy(d.normalize()); this.yaw = Math.atan2(f.x, f.z); }
    if (a.kind !== 'plunge') { this.vel.x += f.x * 2.5; this.vel.z += f.z * 2.5; }
  }
  private updateAttack(dt: number, _ctl: boolean) {
    const a = this.attack!;
    a.t += dt;
    if (a.kind === 'plunge') {
      if (this.state === 'air') { this.vel.y = Math.min(this.vel.y, a.t > 0.2 ? -30 : this.vel.y); }
      if (this.state === 'ground' || this.state === 'swim' || this.state === 'climb') { this.attack = null; }
      return;
    }
    if (this.state !== 'ground' && this.state !== 'locked') { this.attack = null; return; }
    if (!a.hit && a.t >= a.hitAt) { a.hit = true; this.doHit(a); }
    if (a.t >= a.dur) {
      if (a.queued && (a.kind === 'combo' || a.kind === 'flurry') && (a.kind === 'flurry' ? this.flurryT > 0 : a.idx < 2)) {
        a.idx++; this.beginSwing();
      } else {
        this.attack = null;
      }
    }
  }
  private doHit(a: Attack) {
    const g = this.g;
    const w = g.inv.weapon();
    const type = w ? w.type : 'none';
    let reach = type === 'two' ? 2.9 : type === 'spear' ? 3.1 : type === 'one' ? 2.4 : 1.7;
    let arc = type === 'spear' ? 0.75 : type === 'two' ? -0.1 : 0.15; // dot threshold
    let dmg = w ? w.power : 1;
    if (a.kind === 'spin') { reach += 0.6; arc = -1.1; dmg *= 1.6; }
    if (a.kind === 'combo' && a.idx === 2) dmg *= 1.4;
    if (a.kind === 'flurry') { reach = 4; arc = -0.5; }
    dmg *= 1 + this.buff('attack') * 0.25;
    const f = this.forward(_v4);
    const center = this.pos.clone().add(new THREE.Vector3(0, 1, 0));
    g.fx.slash(center.clone().addScaledVector(f, 0.4), this.yaw, a.kind === 'spin' ? 0xfff0b0 : 0xffffff, reach * 0.9, a.kind === 'spin');
    let hitAny = false;
    for (const e of g.enemies.targets()) {
      const d = _v5.copy(e.pos).sub(this.pos); d.y = 0;
      const dist = d.length() - (e.radius || 0.5);
      if (dist > reach || Math.abs(e.pos.y - this.pos.y) > 2.5 + (e.radius || 0)) continue;
      d.normalize();
      if (d.dot(f) < arc && dist > 0.6) continue;
      let dd = dmg;
      if (this.crouch && !e.aware) { dd *= 8; g.toast('Sneak strike!'); }
      g.damageEnemy(e, dd, d, a.kind === 'spin' || a.idx === 2 ? 1.6 : 1);
      hitAny = true;
    }
    // physics objects
    if (g.phys.hitMelee(center, f, reach, arc, dmg)) hitAny = true;
    if (w?.element === 'fire') g.projectiles.fireball(center.clone().addScaledVector(f, 0.8), f.clone(), true);
    if (hitAny) {
      g.hitstop(0.06);
      g.input.rumble(0.4, 80);
      if (w && a.kind !== 'flurry') {
        const broke = g.inv.wear('weapon');
        if (broke) { g.toast(`Your ${w.name} broke!`); audio.play('break'); g.fx.burst(center.clone().addScaledVector(f, 1), 20, 0xcccccc, 5, 0.25, 0.5, 8); }
      }
    }
  }
  private plungeImpact() {
    const g = this.g;
    const w = g.inv.weapon();
    const dmg = (w ? w.power : 2) * 2;
    g.fx.ring(this.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 3.5, 0xffffff, 0.35);
    g.fx.burst(this.pos.clone(), 20, 0xd8c8a0, 5, 0.4, 0.6, 6, 0.4);
    audio.play('hit'); g.camRig.shake(0.4);
    for (const e of g.enemies.targets()) {
      const d = _v5.copy(e.pos).sub(this.pos); d.y = 0;
      if (d.length() < 3.2 + (e.radius || 0)) { g.damageEnemy(e, dmg, d.normalize(), 1.8); }
    }
    g.phys.hitMelee(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0), 3, -1.1, dmg);
    this.attack = null;
  }

  fireBolt() {
    const g = this.g;
    const bow = g.inv.bow();
    if (!bow) return;
    if (!g.inv.has('arrow')) { g.toast('No bolts left!'); this.aiming = false; return; }
    g.inv.remove('arrow');
    const origin = this.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    const dir = g.camRig.aimDirection(origin);
    const n = bow.multi || 1;
    for (let i = 0; i < n; i++) {
      const d = dir.clone();
      if (i > 0) d.applyAxisAngle(new THREE.Vector3(0, 1, 0), (i === 1 ? 1 : -1) * 0.06);
      g.projectiles.bolt(origin.clone(), d.multiplyScalar(55), bow.power * (1 + this.buff('attack') * 0.25), 'player');
    }
    audio.play('shoot');
    this.playOnce('1H_Ranged_Shoot', 1.5);
    this.drawT = 0;
    if (g.inv.wear('bow')) { g.toast(`Your ${bow.name} broke!`); audio.play('break'); this.aiming = false; }
  }

  throwWeapon() {
    const g = this.g;
    const idx = g.inv.equipped.weapon;
    const id = g.inv.drop('weapon', idx);
    if (!id) return;
    const d = itemDef(id) as WeaponDef;
    const dir = g.camRig.aimDirection(this.pos.clone().add(new THREE.Vector3(0, 1.4, 0)));
    dir.y = Math.max(dir.y, 0.05);
    this.yaw = Math.atan2(dir.x, dir.z);
    g.projectiles.thrown(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), dir.multiplyScalar(22), d.power * 2, id);
    this.playOnce('Throw', 1.6);
    audio.play('swing');
    // auto-equip next
    if (g.inv.weapons.length) g.inv.equipped.weapon = 0;
  }

  /** returns true if hit was blocked */
  tryBlock(from: THREE.Vector3 | null, dmg: number): 'parry' | 'block' | false {
    if (!this.shielding || !from) return false;
    const s = this.g.inv.shield();
    const d = _v5.copy(from).sub(this.pos); d.y = 0; d.normalize();
    if (d.dot(this.forward(_v4)) < 0.3) return false;
    if (this.shieldT < 0.22) return 'parry';
    if (!s) return false;
    void dmg;
    return 'block';
  }

  hurt(knock: THREE.Vector3 | null, strength = 1) {
    if (this.state === 'climb' || this.state === 'glide') { this.state = 'air'; this.gliderMesh.visible = false; }
    if (knock) { this.vel.set(knock.x * 7 * strength, 3 * strength, knock.z * 7 * strength); }
    this.state = 'hurt'; this.stateT = 0; this.attack = null; this.aiming = false;
    this.playOnce(strength > 1.2 ? 'Hit_B' : 'Hit_A', 1.4);
    this.invuln = 0.9;
  }

  die() {
    this.state = 'dead'; this.attack = null; this.aiming = false; this.gliderMesh.visible = false;
    this.anim.play('Death_A', { loop: false, clamp: true, fade: 0.2 });
    this.oneShot = 'Death_A'; this.oneShotT = 99;
  }

  // ---------- visuals ----------
  private updateVisual(dt: number, move: THREE.Vector3, mlen: number) {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    let pitch = 0; let yoff = 0;
    const st = this.state;
    if (st === 'swim') { pitch = 0; yoff = 0.15 + Math.sin(this.stateT * 3) * 0.05; }
    if (st === 'climb') { pitch = 0; }
    this.model.rotation.x = damp(this.model.rotation.x, pitch, 10, dt);
    this.model.position.y = yoff;
    this.gliderMesh.rotation.z = damp(this.gliderMesh.rotation.z, -this.g.input.move.x * 0.25, 5, dt);
    this.anim.update(dt * (this.g.bulletTime ? 0.35 : 1));
    if (this.oneShot) return;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let a = 'Idle'; let sp = 1;
    switch (st) {
      case 'ground': case 'locked':
        if (this.aiming) a = '1H_Ranged_Aiming';
        else if (this.g.runes.aiming || this.g.runes.holding) a = 'Spellcasting';
        else if (this.shielding) { a = hs > 0.5 ? (this.g.inv.shield() ? 'Blocking' : 'Walking_A') : this.g.inv.shield() ? 'Blocking' : 'Idle'; }
        else if (this.attack) return;
        else if (this.chargeT > 0.45) a = '2H_Melee_Idle';
        else if (hs < 0.3) a = this.crouch ? 'Sit_Floor_Idle' : this.exhausted ? 'Idle' : 'Idle';
        else if (this.crouch) { a = 'Walking_C'; sp = hs / 1.6; }
        else if (hs < 3.5) { a = 'Walking_A'; sp = hs / 2.6; }
        else if (this.sprinting) { a = 'Running_B'; sp = 1.25; }
        else { a = 'Running_A'; sp = hs / 6; }
        break;
      case 'air': a = this.aiming ? '1H_Ranged_Aiming' : this.vel.y > 2 ? 'Jump_Start' : 'Jump_Idle'; break;
      case 'glide': a = 'Jump_Idle'; break;
      case 'climb': {
        const m = Math.abs(this.g.input.move.x) + Math.abs(this.g.input.move.y);
        a = m > 0.1 ? 'Walking_B' : 'Jump_Idle'; sp = 1.3;
        break;
      }
      case 'swim': a = mlen > 0.1 ? 'Walking_B' : 'Jump_Idle'; sp = 0.8; break;
      case 'mantle': return;
      case 'dodge': case 'hurt': case 'dead': return;
    }
    void move;
    this.anim.play(a, { speed: clamp(sp, 0.4, 2), fade: 0.18 });
  }
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
void angleDiff;
