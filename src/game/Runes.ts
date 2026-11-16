import * as THREE from 'three';
import { audio } from '../engine/Audio';
import type { Game } from '../Game';
import type { Body } from './Physics';
import { clamp } from '../engine/noise';

export type RuneId = 'bomb' | 'magnet' | 'stasis' | 'ice';
export const RUNE_INFO: Record<RuneId, { name: string; desc: string; color: number; icon: string }> = {
  bomb: { name: 'Ember Bomb', desc: 'Throw a remote bomb. Use again to detonate. Breaks cracked rock.', color: 0x3fb7ff, icon: '✹' },
  magnet: { name: 'Lodestone', desc: 'Grab and move metal objects. Adjust distance with D-pad ↑/↓ or mouse wheel.', color: 0xff5050, icon: '⋒' },
  stasis: { name: 'Stillness', desc: 'Freeze an object in time. Strike it to build momentum, then watch it fly.', color: 0xffd040, icon: '⧗' },
  ice: { name: 'Rime Pillar', desc: 'Raise a pillar of ice from water. Up to three at once.', color: 0x9fe6ff, icon: '❄' },
};
const ORDER: RuneId[] = ['bomb', 'magnet', 'stasis', 'ice'];

export class Runes {
  selected: RuneId = 'bomb';
  aiming = false; // targeting mode
  holding: Body | null = null;
  private holdDist = 8;
  bomb: Body | null = null;
  cooldown: Record<RuneId, number> = { bomb: 0, magnet: 0, stasis: 0, ice: 0 };
  pillars: Body[] = [];
  target: Body | null = null;
  iceTarget: THREE.Vector3 | null = null;
  private reticle: THREE.Mesh;
  private beam: THREE.Line;
  private highlight: THREE.Mesh;

  constructor(private g: Game) {
    this.reticle = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.15, 24), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.45, depthWrite: false }));
    this.reticle.visible = false; g.scene.add(this.reticle);
    const bg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.beam = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xff6060, transparent: true, opacity: 0.8 }));
    this.beam.visible = false; this.beam.frustumCulled = false; g.scene.add(this.beam);
    this.highlight = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.8 }));
    this.highlight.visible = false; g.scene.add(this.highlight);
  }

  get active() { return this.aiming || !!this.holding; }
  holdingBomb() { return false; }
  unlocked(): RuneId[] { return ORDER.filter((r) => this.g.state.runes.includes(r)); }

  select(r: RuneId) {
    if (!this.g.state.runes.includes(r)) return;
    if (this.active) this.cancel();
    this.selected = r;
    this.g.hud.flashRune(r);
    audio.play('menu');
  }
  cycle() {
    const u = this.unlocked(); if (!u.length) return;
    const i = u.indexOf(this.selected);
    this.select(u[(i + 1) % u.length]);
  }

  cancel() {
    if (this.holding) { this.holding.held = false; this.holding = null; }
    this.aiming = false; this.target = null; this.iceTarget = null;
    this.reticle.visible = false; this.beam.visible = false; this.highlight.visible = false;
  }

  use() {
    const g = this.g;
    if (!this.g.state.runes.length) { g.toast('You have not learned any runes yet.'); return; }
    if (!g.state.runes.includes(this.selected)) this.selected = this.unlocked()[0];
    const r = this.selected;
    const P = g.player;
    if (!['ground', 'air', 'swim', 'glide', 'locked'].includes(P.state)) return;
    if (r === 'bomb') {
      if (this.bomb && !this.bomb.dead) { this.detonate(this.bomb); return; }
      if (this.cooldown.bomb > 0) { g.toast('Ember Bomb is recharging...'); return; }
      const f = P.forward(new THREE.Vector3());
      const camDir = g.camRig.aimDirection(P.pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
      f.lerp(camDir.setY(0).normalize(), 0.7).normalize();
      const pos = P.pos.clone().add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(f, 0.6);
      this.bomb = g.phys.add('bomb', pos, 0.4);
      this.bomb.vel.copy(f).multiplyScalar(7 + (P.state === 'ground' ? 0 : 0)).add(new THREE.Vector3(0, 4.5, 0)).add(P.vel.clone().multiplyScalar(0.5));
      P.playOnce('Throw', 1.6);
      audio.play('rune');
      return;
    }
    // targeting runes
    if (!this.aiming && !this.holding) {
      this.aiming = true; audio.play('rune', 0.6);
      return;
    }
    if (this.holding) { this.release(); return; }
    // confirm
    if (r === 'magnet' && this.target) {
      this.holding = this.target; this.holding.held = true; this.aiming = false;
      this.holdDist = clamp(this.holding.pos.distanceTo(g.camRig.cam.position), 4, 30);
      audio.play('magnet');
      return;
    }
    if (r === 'stasis' && this.target) {
      if (this.cooldown.stasis > 0) { g.toast('Stillness is recharging...'); return; }
      g.phys.freeze(this.target, 7.5);
      audio.play('stasis'); audio.play('rune');
      g.fx.burst(this.target.pos, 20, 0xffd040, 3, 0.3, 0.6, 0);
      this.cooldown.stasis = 9;
      this.cancel();
      return;
    }
    if (r === 'ice' && this.iceTarget) {
      this.raisePillar(this.iceTarget.clone());
      this.cancel();
      return;
    }
    audio.play('menu');
  }

  release() {
    if (!this.holding) return;
    this.holding.held = false;
    this.holding = null;
    this.beam.visible = false; this.highlight.visible = false;
  }

  detonate(b: Body) {
    const g = this.g;
    if (b.dead) return;
    const p = b.pos.clone();
    g.phys.remove(b);
    if (this.bomb === b) this.bomb = null;
    this.cooldown.bomb = 3.5;
    g.explosion(p, 4.2, 10);
  }

  private raisePillar(p: THREE.Vector3) {
    const g = this.g;
    if (this.pillars.length >= 3) { const old = this.pillars.shift()!; g.phys.breakBody(old); }
    const wl = g.waterLevelAt(p.x, p.z);
    const floor = g.inShrine ? g.groundAt(p.x, p.z, wl).y : g.terrain.heightAt(p.x, p.z);
    const top = wl + 3.2;
    const h = top - floor;
    const center = new THREE.Vector3(p.x, floor + h / 2, p.z);
    const b = g.phys.add('ice', center, new THREE.Vector3(2.4, h, 2.4));
    b.mesh.scale.y = 0.01;
    const target = b.pos.clone();
    g.fx.addTransient(new THREE.Object3D(), 0.35, (_o, k) => { b.mesh.scale.y = Math.max(0.01, k); b.mesh.position.y = floor + (h * k) / 2; if (k >= 1) b.mesh.position.copy(target); });
    this.pillars.push(b);
    audio.play('ice');
    g.fx.burst(new THREE.Vector3(p.x, wl, p.z), 25, 0xdff6ff, 5, 0.3, 0.6, 6);
    // lift player if standing there
    const P = g.player;
    if (Math.abs(P.pos.x - p.x) < 1.6 && Math.abs(P.pos.z - p.z) < 1.6) { P.pos.y = top; P.state = 'ground'; }
  }

  update(dt: number) {
    const g = this.g, inp = g.input;
    for (const k in this.cooldown) this.cooldown[k as RuneId] = Math.max(0, this.cooldown[k as RuneId] - dt);
    if (g.mode !== 'play') return;
    // selection hotkeys
    if (inp.pressed('rune1')) this.select('bomb');
    if (inp.pressed('rune2')) this.select('magnet');
    if (inp.pressed('rune3')) this.select('stasis');
    if (inp.pressed('rune4')) this.select('ice');
    if (inp.pressed('up') && !this.holding) this.cycle();
    if (inp.pressed('rune')) this.use();
    if (this.active && (inp.pressed('back') && inp.device !== 'pad' || inp.pressed('shield') || g.player.state === 'climb' || g.player.state === 'dead')) {
      if (this.holding) this.release(); this.cancel();
    }
    const P = g.player;
    // targeting
    this.target = null; this.iceTarget = null;
    this.reticle.visible = false; this.highlight.visible = false;
    if (this.aiming) {
      const { o, d } = g.camRig.cameraRay();
      if (this.selected === 'magnet' || this.selected === 'stasis') {
        const hit = g.phys.raycast(o, d, 45, (b) => this.selected === 'magnet' ? b.metal : (b.dynamic || b.kind === 'platform') && b.kind !== 'bomb');
        if (hit) {
          this.target = hit.b;
          this.highlight.visible = true;
          this.highlight.position.copy(hit.b.pos);
          this.highlight.scale.copy(hit.b.half).multiplyScalar(2.1);
          (this.highlight.material as THREE.MeshBasicMaterial).color.setHex(RUNE_INFO[this.selected].color);
        }
      } else if (this.selected === 'ice') {
        // march along ray to find water surface
        for (let t = 1; t < 40; t += 0.25) {
          const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
          const wl = g.waterLevelAt(x, z);
          const ground = g.inShrine ? g.groundAt(x, z, y + 0.1).y : g.terrain.heightAt(x, z);
          if (y < ground) break;
          if (y <= wl && wl > ground + 0.3) {
            if (Math.hypot(x - P.pos.x, z - P.pos.z) > 1.2 || P.state === 'swim') {
              this.iceTarget = new THREE.Vector3(x, wl, z);
              this.reticle.visible = true; this.reticle.position.set(x, wl + 0.08, z);
            }
            break;
          }
        }
      }
    }
    // magnet holding
    if (this.holding) {
      const b = this.holding;
      if (b.dead) { this.holding = null; return; }
      if (inp.down('up') || inp.pressed('zoomOut')) this.holdDist = Math.min(35, this.holdDist + (inp.pressed('zoomOut') ? 1.5 : 8 * dt));
      if (inp.down('down') || inp.pressed('zoomIn')) this.holdDist = Math.max(3, this.holdDist - (inp.pressed('zoomIn') ? 1.5 : 8 * dt));
      const { o, d } = g.camRig.cameraRay();
      const target = o.addScaledVector(d, this.holdDist);
      const v = target.sub(b.pos).multiplyScalar(6);
      if (v.length() > 16) v.setLength(16);
      b.vel.copy(v);
      if (P.pos.distanceTo(b.pos) > 45) this.release();
      // beam
      this.beam.visible = true;
      const pos = this.beam.geometry.attributes.position as THREE.BufferAttribute;
      const hp = P.pos.clone().add(new THREE.Vector3(0, 1.5, 0));
      pos.setXYZ(0, hp.x, hp.y, hp.z); pos.setXYZ(1, b.pos.x, b.pos.y, b.pos.z); pos.needsUpdate = true;
      this.highlight.visible = true; this.highlight.position.copy(b.pos); this.highlight.scale.copy(b.half).multiplyScalar(2.1);
      (this.highlight.material as THREE.MeshBasicMaterial).color.setHex(0xff5050);
      if (Math.random() < 0.5) g.fx.sparkle(b.pos, 0xff6060, 1, b.half.x * 2);
    } else this.beam.visible = false;
    // bomb flashing
    if (this.bomb && !this.bomb.dead) {
      const m = (this.bomb.mesh as THREE.Mesh).material as THREE.MeshToonMaterial;
      m.emissiveIntensity = 0.6 + Math.sin(performance.now() * 0.01) * 0.4;
      if (g.waterLevelAt(this.bomb.pos.x, this.bomb.pos.z) > this.bomb.pos.y + 0.3) { this.bomb.vel.y = Math.max(this.bomb.vel.y, 0.5); }
      if (this.bomb.pos.distanceTo(P.pos) > 60) this.detonate(this.bomb);
    }
  }
}
