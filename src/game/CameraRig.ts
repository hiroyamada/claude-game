import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../engine/noise';
import type { Game } from '../Game';

export class CameraRig {
  yaw = 0.6;
  pitch = 0.25;
  dist = 6;
  targetDist = 6;
  focus = new THREE.Vector3();
  private shakeAmt = 0;
  private curDist = 6;
  private shoulder = 0;
  fovBase = 60;
  private autoT = 0;
  cutscene: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;

  constructor(private g: Game, public cam: THREE.PerspectiveCamera) {}

  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  reset() { this.yaw = this.g.player.yaw + Math.PI; this.pitch = 0.2; }

  update(dt: number) {
    const g = this.g, p = g.player, inp = g.input;
    if (this.cutscene) {
      this.cam.position.lerp(this.cutscene.pos, 1 - Math.exp(-3 * dt));
      this.cam.lookAt(this.cutscene.look);
      return;
    }
    const aiming = p.aiming || g.runes.aiming;
    if (g.mode === 'play') {
      this.yaw -= inp.look.x * (aiming ? 0.6 : 1);
      this.pitch += inp.look.y * (aiming ? 0.6 : 1);
      if (inp.pressed('zoomIn')) this.targetDist = clamp(this.targetDist - 1, 3, 11);
      if (inp.pressed('zoomOut')) this.targetDist = clamp(this.targetDist + 1, 3, 11);
      if (inp.pressed('camReset')) this.reset();
    }
    this.pitch = clamp(this.pitch, -0.9, 1.25);
    // lock-on: swing camera behind player looking at target
    if (p.lockTarget) {
      const d = new THREE.Vector3().subVectors(p.lockTarget.pos, p.pos);
      const want = Math.atan2(-d.x, -d.z);
      this.yaw = dampAngle(this.yaw, want, 6, dt);
      this.pitch = damp(this.pitch, 0.18, 3, dt);
    }
    // gentle auto-follow while moving (gamepad/touch feel)
    const moving = Math.abs(inp.move.x) + Math.abs(inp.move.y) > 0.3 && Math.abs(inp.look.x) < 0.001;
    if (moving && !aiming && !p.lockTarget && (p.state === 'ground' || p.state === 'glide') && inp.device !== 'kbm') {
      this.autoT += dt;
      if (this.autoT > 0.6 && Math.abs(inp.move.x) > 0.5) this.yaw = dampAngle(this.yaw, p.yaw + Math.PI, 0.6, dt);
    } else this.autoT = 0;

    const headY = p.state === 'swim' ? 0.9 : p.crouch ? 1.0 : 1.5;
    const want = new THREE.Vector3(p.pos.x, p.pos.y + headY, p.pos.z);
    const lagF = p.state === 'glide' || p.state === 'air' ? 8 : 14;
    this.focus.x = damp(this.focus.x, want.x, 20, dt);
    this.focus.z = damp(this.focus.z, want.z, 20, dt);
    this.focus.y = damp(this.focus.y, want.y, lagF, dt);
    if (this.focus.distanceTo(want) > 8) this.focus.copy(want);

    this.shoulder = damp(this.shoulder, aiming ? 1 : 0, 10, dt);
    let dist = this.targetDist;
    if (p.state === 'glide') dist += 1.5;
    if (p.state === 'climb') dist += 1;
    if (g.boss?.active) dist += 3;
    dist = dist * (1 - this.shoulder) + 2.3 * this.shoulder;
    this.dist = dist;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const origin = this.focus.clone().addScaledVector(right, this.shoulder * 0.75);
    origin.y += this.shoulder * 0.15;
    // collision vs terrain & boxes
    let maxD = dist;
    const t = g.inShrine ? -1 : g.terrain.raycast(origin, dir, dist + 0.5);
    if (t >= 0) maxD = Math.min(maxD, Math.max(0.6, t - 0.4));
    const bt = g.colliders.raycastBoxes(origin, dir, dist + 0.5, (b) => b.tag !== 'body' && b.tag !== 'noCam');
    if (bt.t < Infinity) maxD = Math.min(maxD, Math.max(0.6, bt.t - 0.3));
    this.curDist = maxD < this.curDist ? maxD : damp(this.curDist, maxD, 4, dt);
    const pos = origin.clone().addScaledVector(dir, this.curDist);
    // keep above terrain
    if (!g.inShrine) { const th = g.terrain.heightAt(pos.x, pos.z) + 0.5; if (pos.y < th) pos.y = th; }
    const wl = g.waterLevelAt(pos.x, pos.z);
    if (pos.y < wl + 0.3 && p.state !== 'swim') pos.y = wl + 0.3;
    if (this.shakeAmt > 0) {
      pos.x += (Math.random() - 0.5) * this.shakeAmt; pos.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    }
    this.cam.position.copy(pos);
    const look = origin.clone().addScaledVector(dir, -10);
    if (p.lockTarget && !aiming) {
      const tp = p.lockTarget.pos.clone(); tp.y += (p.lockTarget.height || 1.2) * 0.6;
      look.lerp(tp, 0.35);
    }
    this.cam.lookAt(look);
    const fov = this.fovBase + (p.sprinting ? 6 : 0) + (p.state === 'glide' ? 8 : 0) - this.shoulder * 12;
    if (Math.abs(this.cam.fov - fov) > 0.1) { this.cam.fov = damp(this.cam.fov, fov, 5, dt); this.cam.updateProjectionMatrix(); }
  }

  /** direction from origin toward what the crosshair points at */
  aimDirection(origin: THREE.Vector3): THREE.Vector3 {
    const camDir = new THREE.Vector3(); this.cam.getWorldDirection(camDir);
    const far = this.cam.position.clone().addScaledVector(camDir, 80);
    // try to hit something along camera ray
    const g = this.g;
    let hitD = 80;
    const tt = g.inShrine ? -1 : g.terrain.raycast(this.cam.position, camDir, 80);
    if (tt > 0) hitD = Math.min(hitD, tt);
    const bt = g.colliders.raycastBoxes(this.cam.position, camDir, 80, (b) => b.tag !== 'noCam');
    if (bt.t < hitD && bt.t > 2.5) hitD = bt.t;
    far.copy(this.cam.position).addScaledVector(camDir, Math.max(hitD, 3));
    return far.sub(origin).normalize();
  }

  cameraRay(): { o: THREE.Vector3; d: THREE.Vector3 } {
    const d = new THREE.Vector3(); this.cam.getWorldDirection(d);
    return { o: this.cam.position.clone(), d };
  }
}
