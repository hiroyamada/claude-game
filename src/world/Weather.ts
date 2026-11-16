import * as THREE from 'three';
import type { Game } from '../Game';
import { audio } from '../engine/Audio';
import { damp } from '../engine/noise';
import { SNOW_LINE } from './WorldData';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm';

export class Weather {
  kind: WeatherKind = 'clear';
  rain = 0; // 0..1 actual intensity at player
  snow = 0;
  clouds = 0.35;
  wind = 1;
  private timer = 120;
  private drops: THREE.LineSegments;
  private dropPos: Float32Array;
  private flakes: THREE.Points;
  private flakePos: Float32Array;
  private N = 1800;
  private boltT = 8;
  private warnT = 0;
  private warnPos = new THREE.Vector3();
  private flashT = 0;

  constructor(private g: Game) {
    const N = this.N;
    this.dropPos = new Float32Array(N * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3));
    this.drops = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaac4e0, transparent: true, opacity: 0.5 }));
    this.drops.frustumCulled = false; this.drops.visible = false;
    g.scene.add(this.drops);
    for (let i = 0; i < N; i++) this.resetDrop(i, new THREE.Vector3(), true);
    this.flakePos = new Float32Array(N * 3);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3));
    this.flakes = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 }));
    this.flakes.frustumCulled = false; this.flakes.visible = false;
    g.scene.add(this.flakes);
    for (let i = 0; i < N; i++) { this.flakePos[i * 3] = (Math.random() - 0.5) * 50; this.flakePos[i * 3 + 1] = Math.random() * 25; this.flakePos[i * 3 + 2] = (Math.random() - 0.5) * 50; }
  }

  private resetDrop(i: number, c: THREE.Vector3, randomY = false) {
    const x = c.x + (Math.random() - 0.5) * 50, z = c.z + (Math.random() - 0.5) * 50;
    const y = c.y + (randomY ? Math.random() * 30 : 25 + Math.random() * 5);
    const a = this.dropPos;
    a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
    a[i * 6 + 3] = x - 0.1; a[i * 6 + 4] = y - 0.7; a[i * 6 + 5] = z;
  }

  set(kind: WeatherKind) { this.kind = kind; this.timer = 120 + Math.random() * 180; }

  forecast(): string { return { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm' }[this.kind]; }

  update(dt: number) {
    const g = this.g;
    this.timer -= dt;
    if (this.timer <= 0) {
      const r = Math.random();
      this.set(r < 0.4 ? 'clear' : r < 0.65 ? 'cloudy' : r < 0.9 ? 'rain' : 'storm');
    }
    const P = g.player.pos;
    const b = g.inShrine ? { desert: 0, north: 0 } : g.terrain.biome(P.x, P.z);
    const wet = this.kind === 'rain' ? 0.8 : this.kind === 'storm' ? 1 : 0;
    const cold = P.y > SNOW_LINE - 30 || b.north > 0.7;
    const targetRain = g.inShrine ? 0 : wet * (1 - b.desert) * (cold ? 0 : 1);
    const targetSnow = g.inShrine ? 0 : (cold ? Math.max(wet, 0.3 * (this.kind === 'cloudy' ? 1 : 0)) : 0);
    this.rain = damp(this.rain, targetRain, 0.5, dt);
    this.snow = damp(this.snow, targetSnow, 0.5, dt);
    this.clouds = damp(this.clouds, this.kind === 'clear' ? 0.3 : this.kind === 'cloudy' ? 0.65 : 0.95, 0.3, dt);
    this.wind = damp(this.wind, this.kind === 'storm' ? 2.5 : this.kind === 'rain' ? 1.6 : 1, 0.5, dt);
    g.sky.weatherDark = damp(g.sky.weatherDark, g.inShrine ? 0 : (this.kind === 'storm' ? 0.8 : this.kind === 'rain' ? 0.5 : this.kind === 'cloudy' ? 0.15 : 0) * (1 - b.desert * 0.8), 0.5, dt);
    audio.setAmbience(this.rain, g.inShrine ? 0.1 : (0.15 + (P.y > 80 ? 0.25 : 0) + (g.player.state === 'glide' ? 0.4 : 0)) * this.wind);

    // rain particles
    this.drops.visible = this.rain > 0.02;
    if (this.drops.visible) {
      const n = Math.floor(this.N * this.rain);
      const a = this.dropPos;
      const c = g.camRig.cam.position;
      for (let i = 0; i < this.N; i++) {
        if (i >= n) { a[i * 6 + 1] = -9999; a[i * 6 + 4] = -9999; continue; }
        const fall = 28 * dt;
        a[i * 6 + 1] -= fall; a[i * 6 + 4] -= fall;
        a[i * 6] -= 2 * dt * this.wind; a[i * 6 + 3] -= 2 * dt * this.wind;
        if (a[i * 6 + 1] < c.y - 15 || Math.abs(a[i * 6] - c.x) > 26 || Math.abs(a[i * 6 + 2] - c.z) > 26) this.resetDrop(i, c, a[i * 6 + 1] < -9000);
      }
      (this.drops.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.drops.material as THREE.LineBasicMaterial).opacity = 0.35 + this.rain * 0.3;
    }
    this.flakes.visible = this.snow > 0.02;
    if (this.flakes.visible) {
      const c = g.camRig.cam.position;
      const f = this.flakePos;
      this.flakes.position.set(Math.floor(c.x / 50) * 50, c.y - 10, Math.floor(c.z / 50) * 50);
      const t = performance.now() * 0.001;
      for (let i = 0; i < this.N; i++) {
        f[i * 3 + 1] -= dt * 2;
        f[i * 3] += Math.sin(t + i) * dt * 0.6 + dt * this.wind * 0.8;
        if (f[i * 3 + 1] < 0) f[i * 3 + 1] += 25;
        if (f[i * 3] > 25) f[i * 3] -= 50;
      }
      (this.flakes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.flakes.material as THREE.PointsMaterial).opacity = this.snow;
    }

    // lightning in storms
    if (this.kind === 'storm' && !g.inShrine && this.rain > 0.5) {
      this.boltT -= dt;
      const metal = g.hasMetalEquipped();
      if (this.warnT > 0) {
        this.warnT -= dt;
        this.warnPos.copy(P);
        if (Math.random() < 0.6) g.fx.sparkle(P.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xfff080, 2, 1.4);
        if (this.warnT <= 0) {
          if (g.hasMetalEquipped()) this.strike(P.clone(), true);
        }
      } else if (this.boltT <= 0) {
        this.boltT = 6 + Math.random() * 10;
        if (metal && Math.random() < 0.5) { this.warnT = 2.2; g.toast('Your metal gear is attracting lightning!'); }
        else {
          const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 60;
          const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
          this.strike(new THREE.Vector3(x, g.terrain.heightAt(x, z), z), false);
        }
      }
    }
    if (this.flashT > 0) { this.flashT -= dt; g.sky.weatherDark = Math.max(0, g.sky.weatherDark - this.flashT * 2); }
  }

  private strike(p: THREE.Vector3, atPlayer: boolean) {
    const g = this.g;
    const pts: THREE.Vector3[] = [];
    let cur = p.clone().add(new THREE.Vector3(0, 120, 0));
    while (cur.y > p.y) { pts.push(cur.clone()); cur = cur.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, -12, (Math.random() - 0.5) * 8)); }
    pts.push(p.clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true }));
    g.fx.addTransient(line, 0.35, (o, k) => { ((o as THREE.Line).material as THREE.LineBasicMaterial).opacity = 1 - k; });
    this.flashT = 0.3;
    g.fx.flash(p.clone().add(new THREE.Vector3(0, 5, 0)), 0xddeeff, 80, 0.4);
    g.fx.burst(p, 30, 0xfff8c0, 8, 0.4, 0.6, 4);
    setTimeout(() => audio.play('thunder'), atPlayer ? 0 : 300 + Math.random() * 800);
    if (atPlayer || g.player.pos.distanceTo(p) < 4) g.damagePlayer(12, p, 'lightning');
  }
}
