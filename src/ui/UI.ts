import * as THREE from 'three';
import type { Game } from '../Game';
import { audio } from '../engine/Audio';
import { itemDef, cook, WEAPONS, SHIELDS, BOWS, MATERIALS, type MaterialDef, type WeaponDef, type ShieldDef, type BowDef, type Meal } from '../game/Items';
import { RUNE_INFO, type RuneId } from '../game/Runes';
import { HALF, WORLD_SIZE, TOWERS, SHRINES, CAMPS, VILLAGE, CITADEL, PLATEAU } from '../world/WorldData';
import type { Action } from '../engine/Input';

const ICONS: Record<string, string> = {
  apple: '🍎', mushroom: '🍄', pepper: '🌶️', herb: '🌿', meat: '🍖', shroom_red: '🟤', banana: '🍌', feather: '🪶', bone: '🦴', ember: '🔥', ore: '💎', arrow: '➶',
  glider: '🪁', orb: '🔮', slate: '📜',
};
export function itemIcon(id: string): string {
  const d = itemDef(id);
  if (!d) return '❔';
  if (d.kind === 'weapon') return (d as WeaponDef).type === 'two' ? '⚔️' : (d as WeaponDef).type === 'spear' ? '🪄' : id.includes('axe') ? '🪓' : id === 'dagger' ? '🔪' : '🗡️';
  if (d.kind === 'shield') return '🛡️';
  if (d.kind === 'bow') return '🏹';
  return ICONS[id] || '◆';
}
const EFFECT_ICON: Record<string, string> = { stamina: '⚡', warm: '🔥', attack: '⚔️', defense: '🛡️', speed: '👟', hearty: '💛', none: '' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e;
}

const GLYPHS: Record<string, Partial<Record<Action, string>>> = {
  pad: { interact: 'A', jump: 'X', attack: 'Y', sprint: 'B', rune: 'L', throw: 'R', shield: 'ZL', aim: 'ZR', menu: '+', map: '−', back: 'B', confirm: 'A', crouch: 'L-Stick' },
  kbm: { interact: 'E', jump: 'Space', attack: 'Click', sprint: 'Shift', rune: 'F', throw: 'R', shield: 'R-Click', aim: 'Q', menu: 'Esc', map: 'M', back: 'Esc', confirm: 'E', crouch: 'C' },
  touch: { interact: '✋', jump: '⤒', attack: '⚔', sprint: '»', rune: '✦', throw: '↗', shield: '🛡', aim: '🏹', menu: '☰', map: '🗺', back: '✕', confirm: '✋', crouch: '⇩' },
};

/** spatial navigation over [data-nav] elements for gamepad / keyboard */
class Nav {
  idx = 0;
  constructor(public root: HTMLElement) {}
  items(): HTMLElement[] { return Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => e.offsetParent !== null && !(e as HTMLButtonElement).disabled); }
  current(): HTMLElement | null { const it = this.items(); if (!it.length) return null; this.idx = Math.min(this.idx, it.length - 1); return it[this.idx]; }
  focus(e: HTMLElement | null) { const it = this.items(); const i = e ? it.indexOf(e) : -1; if (i >= 0) this.idx = i; this.paint(); }
  paint() { const it = this.items(); it.forEach((e, i) => e.classList.toggle('focus', i === this.idx)); it[this.idx]?.scrollIntoView?.({ block: 'nearest' }); }
  move(dx: number, dy: number) {
    const it = this.items(); if (!it.length) return;
    const cur = it[Math.min(this.idx, it.length - 1)].getBoundingClientRect();
    const cx = cur.left + cur.width / 2, cy = cur.top + cur.height / 2;
    let best = -1, bs = Infinity;
    it.forEach((e, i) => {
      if (i === this.idx) return;
      const r = e.getBoundingClientRect(); const x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      const along = x * dx + y * dy; if (along <= 2) return;
      const perp = Math.abs(x * dy - y * dx);
      const s = along + perp * 2.5;
      if (s < bs) { bs = s; best = i; }
    });
    if (best >= 0) { this.idx = best; audio.play('menu'); }
    this.paint();
  }
}

interface Screen { el: HTMLElement; nav: Nav; onBack?: () => void; onTab?: (d: number) => void; update?: (dt: number) => void; }

export class UI {
  root: HTMLElement;
  private hearts = el('div'); private objective = el('div'); private stamina = el('div');
  private slots = el('div'); private minimap = el('div'); private mmCanvas = el('canvas'); private envinfo = el('div');
  private prompt = el('div'); private toasts = el('div'); private crosshair = el('div'); private bossbar = el('div');
  private marks = el('div'); private buffs = el('div'); private fadeEl = el('div');
  private quick: HTMLDivElement | null = null; private quickT = 0;
  private screen: Screen | null = null;
  private dialogEl: HTMLDivElement | null = null;
  private dialogState: { lines: string[]; i: number; who?: string; choices?: string[]; resolve: (v: number) => void; nav?: Nav } | null = null;
  private mapImg: HTMLCanvasElement | null = null;
  private mmT = 0;
  private enemyMarks = new Map<any, HTMLDivElement>();
  private lastHeartsKey = '';
  invTab = 0;
  pins: { x: number; z: number }[] = [];

  constructor(private g: Game) {
    this.root = document.getElementById('ui')!;
    this.hearts.id = 'hearts'; this.objective.id = 'objective'; this.stamina.id = 'stamina';
    this.slots.id = 'slots'; this.minimap.id = 'minimap'; this.envinfo.id = 'envinfo'; this.prompt.id = 'prompt';
    this.toasts.id = 'toasts'; this.crosshair.id = 'crosshair'; this.bossbar.id = 'bossbar'; this.buffs.id = 'buffs'; this.fadeEl.id = 'fade';
    this.marks.style.cssText = 'position:absolute;inset:0;';
    this.minimap.appendChild(this.mmCanvas); this.mmCanvas.width = this.mmCanvas.height = 200;
    this.stamina.innerHTML = `<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.15)" stroke-width="7"/><circle id="stam-arc" cx="28" cy="28" r="22" fill="none" stroke="#6fe06a" stroke-width="7" stroke-linecap="round" transform="rotate(-90 28 28)" stroke-dasharray="138.2" stroke-dashoffset="0"/></svg>`;
    this.bossbar.innerHTML = `<h4></h4><div class="bar"><i></i></div>`;
    for (const e of [this.marks, this.hearts, this.objective, this.buffs, this.stamina, this.slots, this.envinfo, this.minimap, this.prompt, this.toasts, this.crosshair, this.bossbar, this.fadeEl]) this.root.appendChild(e);
    this.prompt.classList.add('hidden'); this.crosshair.classList.add('hidden'); this.bossbar.classList.add('hidden');
    this.setHudVisible(false);
  }

  glyph(a: Action) { const d = this.g.input.device; return GLYPHS[d][a] || a; }
  setHudVisible(v: boolean) {
    for (const e of [this.hearts, this.objective, this.stamina, this.slots, this.minimap, this.envinfo, this.buffs, this.marks]) e.classList.toggle('hidden', !v);
    if (!v) { this.prompt.classList.add('hidden'); this.crosshair.classList.add('hidden'); }
  }
  get menuOpen() { return !!this.screen; }
  get dialogOpen() { return !!this.dialogState; }

  // ---------------- HUD ----------------
  private heartSvg(fill: number, yellow: boolean) {
    // fill: 0..4 quarters
    const col = yellow ? '#ffd23a' : '#ff4a4a';
    const id = 'c' + Math.random().toString(36).slice(2, 7);
    const pct = fill / 4;
    const path = 'M14 24 C14 24 2 16 2 8.5 C2 4.5 5 2 8.5 2 C11 2 13 3.5 14 5.5 C15 3.5 17 2 19.5 2 C23 2 26 4.5 26 8.5 C26 16 14 24 14 24 Z';
    // quarter wedge clip
    const a = pct * Math.PI * 2;
    const x = 14 + Math.sin(a) * 30, y = 13 - Math.cos(a) * 30;
    const large = pct > 0.5 ? 1 : 0;
    const wedge = pct >= 1 ? `<rect x="0" y="0" width="28" height="26"/>` : pct <= 0 ? '' : `<path d="M14 13 L14 -17 A30 30 0 ${large} 1 ${x} ${y} Z"/>`;
    return `<svg viewBox="0 0 28 26"><defs><clipPath id="${id}">${wedge}</clipPath></defs><path d="${path}" fill="rgba(20,10,10,.6)" stroke="rgba(255,255,255,.8)" stroke-width="1.6"/><path d="${path}" fill="${col}" clip-path="url(#${id})"/></svg>`;
  }

  updateHUD(dt: number) {
    const g = this.g, P = g.player;
    // hearts
    const hk = `${P.health}|${P.maxHealth}|${P.extraHearts}`;
    if (hk !== this.lastHeartsKey) {
      this.lastHeartsKey = hk;
      let html = '';
      for (let i = 0; i < P.maxHealth / 4; i++) html += this.heartSvg(Math.max(0, Math.min(4, P.health - i * 4)), false);
      for (let i = 0; i < Math.ceil(P.extraHearts / 4); i++) html += this.heartSvg(Math.max(0, Math.min(4, P.extraHearts - i * 4)), true);
      this.hearts.innerHTML = html;
    }
    // stamina wheel near player
    const show = P.stamina < P.maxStamina - 0.5 || P.exhausted;
    this.stamina.style.opacity = show ? '1' : '0';
    if (show) {
      const sp = P.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).project(g.camera);
      const r = this.g.renderer.canvas.getBoundingClientRect();
      this.stamina.style.left = ((sp.x * 0.5 + 0.5) * r.width + 70) + 'px';
      this.stamina.style.top = ((-sp.y * 0.5 + 0.5) * r.height - 30) + 'px';
      const frac = P.stamina / P.maxStamina;
      const arc = this.stamina.querySelector('#stam-arc') as SVGCircleElement;
      const wheels = P.maxStamina / 100;
      arc.setAttribute('stroke-dashoffset', String(138.2 * (1 - frac)));
      arc.setAttribute('stroke', P.exhausted ? '#ff6a4a' : frac < 0.25 ? '#ffb040' : '#6fe06a');
      this.stamina.style.transform = `translate(-50%,-50%) scale(${0.85 + wheels * 0.15})`;
    }
    // objective
    const obj = g.objectiveText();
    if (this.objective.dataset.t !== obj) { this.objective.dataset.t = obj; this.objective.innerHTML = obj ? `<b>Objective</b>${obj}` : ''; }
    // buffs
    const bk = Object.entries(P.buffs).map(([k, b]) => `${k}${b.level}${Math.ceil(b.t / 10)}`).join(',') + (g.coldness > 0.5 ? 'cold' : '');
    if (this.buffs.dataset.k !== bk) {
      this.buffs.dataset.k = bk;
      this.buffs.innerHTML = Object.entries(P.buffs).map(([k, b]) => `<span class="buff">${EFFECT_ICON[k] || ''} ${'★'.repeat(b.level)} ${Math.floor(b.t / 60)}:${String(Math.floor(b.t % 60)).padStart(2, '0')}</span>`).join('') + (g.coldness > 0.5 ? '<span class="buff">🥶 Freezing!</span>' : '');
    }
    // slots
    this.updateSlots();
    // env info
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.1;
      const temp = g.inShrine ? 18 : Math.round(26 - Math.max(0, P.pos.y) * 0.14 - (g.sky.isNight ? 8 : 0) + g.terrain.biome(P.pos.x, P.pos.z).desert * 12);
      const wIcon = { clear: g.sky.isNight ? '🌙' : '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️' }[g.weather.kind];
      this.envinfo.innerHTML = `<span>${wIcon} ${temp}°</span><span>🕐 ${g.sky.clockString()}</span>`;
      this.drawMinimap();
    }
    // prompt
    const it = g.currentInteractable;
    const pickup = g.currentPickup;
    if ((it || pickup) && g.mode === 'play') {
      const label = it ? it.label : `Pick up ${itemDef(pickup!.id).name}`;
      const k = `${label}|${this.glyph('interact')}`;
      if (this.prompt.dataset.k !== k) { this.prompt.dataset.k = k; this.prompt.innerHTML = `<span class="btn-glyph">${this.glyph('interact')}</span>${label}`; }
      this.prompt.classList.remove('hidden');
    } else this.prompt.classList.add('hidden');
    this.crosshair.classList.toggle('hidden', !(P.aiming || g.runes.aiming || g.runes.holding));
    // boss bar
    if (g.boss && g.boss.alive) {
      this.bossbar.classList.remove('hidden');
      (this.bossbar.querySelector('h4') as HTMLElement).textContent = g.boss.name;
      (this.bossbar.querySelector('i') as HTMLElement).style.width = `${(g.boss.hp / g.boss.maxHp) * 100}%`;
    } else this.bossbar.classList.add('hidden');
    // enemy marks
    this.updateMarks();
    // quick select timeout
    if (this.quick) { this.quickT -= dt; if (this.quickT <= 0) { this.quick.remove(); this.quick = null; } }
  }

  private updateSlots() {
    const g = this.g;
    const w = g.inv.weapon(), s = g.inv.shield(), b = g.inv.bow();
    const rune = g.state.runes.length ? g.runes.selected : null;
    const wd = w ? g.inv.weapons[g.inv.equipped.weapon] : null, sd = s ? g.inv.shields[g.inv.equipped.shield] : null;
    const key = `${rune}|${w?.id}|${wd?.dur}|${s?.id}|${sd?.dur}|${b?.id}|${g.inv.count('arrow')}|${g.input.device}|${g.runes.cooldown.bomb > 0}|${g.runes.cooldown.stasis > 0}`;
    if (this.slots.dataset.k === key) return;
    this.slots.dataset.k = key;
    const dur = (v: number, m: number) => `<span class="dur"><i style="width:${Math.max(0, (v / m) * 100)}%"></i></span>`;
    const cd = rune && g.runes.cooldown[rune] > 0;
    this.slots.innerHTML =
      (rune ? `<div class="slot" id="slot-rune" style="opacity:${cd ? 0.5 : 1};color:#${RUNE_INFO[rune].color.toString(16).padStart(6, '0')}"><span class="key">${this.glyph('rune')}</span>${RUNE_INFO[rune].icon}<small>${RUNE_INFO[rune].name}</small></div>` : '') +
      `<div class="slot" id="slot-w">${w ? itemIcon(w.id) : '✊'}${w ? dur(wd!.dur, w.durability) : ''}<small>${w ? w.name : 'Unarmed'}</small></div>` +
      `<div class="slot" id="slot-s">${s ? '🛡️' : '·'}${s ? dur(sd!.dur, s.durability) : ''}<small>${s ? s.name : 'No shield'}</small></div>` +
      `<div class="slot" id="slot-b"><span class="key">${this.glyph('aim')}</span>${b ? '🏹' : '·'}<small>${b ? '➶ ' + g.inv.count('arrow') : 'No crossbow'}</small></div>`;
  }
  flashRune(_r: RuneId) { this.slots.dataset.k = ''; this.updateSlots(); document.getElementById('slot-rune')?.classList.add('flash'); }

  showQuick(kind: 'weapon' | 'shield' | 'bow' | 'rune') {
    const g = this.g;
    this.quick?.remove();
    const q = el('div'); q.id = 'quick';
    let items: { icon: string; name: string; sel: boolean }[] = [];
    if (kind === 'rune') items = g.runes.unlocked().map((r) => ({ icon: RUNE_INFO[r].icon, name: RUNE_INFO[r].name, sel: r === g.runes.selected }));
    else {
      const list = kind === 'weapon' ? g.inv.weapons : kind === 'shield' ? g.inv.shields : g.inv.bows;
      items = [{ icon: '✖', name: 'None', sel: g.inv.equipped[kind] < 0 }, ...list.map((s, i) => ({ icon: itemIcon(s.id), name: itemDef(s.id).name, sel: i === g.inv.equipped[kind] }))];
    }
    q.innerHTML = items.map((i) => `<div class="q ${i.sel ? 'sel' : ''}">${i.icon}<small>${i.name}</small></div>`).join('');
    this.root.appendChild(q); this.quick = q; this.quickT = 1.4;
  }

  private updateMarks() {
    const g = this.g;
    const r = g.renderer.canvas.getBoundingClientRect();
    const seen = new Set<any>();
    for (const e of g.enemies.targets()) {
      if (e === g.boss) continue;
      const d = e.pos.distanceTo(g.player.pos);
      if (d > 35 || g.mode !== 'play') continue;
      const sp = e.pos.clone().add(new THREE.Vector3(0, (e.height || 1.7) + 0.4, 0)).project(g.camera);
      if (sp.z > 1) continue;
      seen.add(e);
      let m = this.enemyMarks.get(e);
      if (!m) { m = el('div', 'emark', '<div class="alert"></div><div class="hp"><i></i></div>'); this.marks.appendChild(m); this.enemyMarks.set(e, m); }
      m.style.left = ((sp.x * 0.5 + 0.5) * r.width) + 'px';
      m.style.top = ((-sp.y * 0.5 + 0.5) * r.height) + 'px';
      const hp = m.querySelector('.hp') as HTMLElement;
      hp.style.visibility = e.hp < e.maxHp ? 'visible' : 'hidden';
      (hp.firstChild as HTMLElement).style.width = `${(e.hp / e.maxHp) * 100}%`;
      m.classList.toggle('lock', g.player.lockTarget === e);
      const al = m.querySelector('.alert') as HTMLElement;
      const at = (e as any).alertT || 0;
      al.textContent = performance.now() - at < 1200 ? '!' : '';
    }
    for (const [e, m] of this.enemyMarks) if (!seen.has(e)) { m.remove(); this.enemyMarks.delete(e); }
  }
  enemyAlert(e: any) { e.alertT = performance.now(); }

  toast(msg: string, color?: number) {
    const t = el('div', 'toast', msg);
    if (color) t.style.borderLeftColor = '#' + color.toString(16).padStart(6, '0');
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 5) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 4100);
  }
  itemGet(name: string, color?: number, desc?: string) {
    document.getElementById('itemget')?.remove();
    const d = el('div', '', `<h3>${name}</h3>${desc ? `<p>${desc}</p>` : ''}`); d.id = 'itemget';
    if (color) d.style.borderColor = '#' + color.toString(16).padStart(6, '0');
    this.root.appendChild(d);
    setTimeout(() => d.remove(), desc ? 3500 : 2000);
  }
  banner(title: string, sub = '') {
    document.getElementById('banner')?.remove();
    const b = el('div', '', `<h1>${title}</h1><div class="line"></div><h2>${sub}</h2>`); b.id = 'banner';
    this.root.appendChild(b);
    setTimeout(() => b.remove(), 4100);
  }
  fade(on: boolean) { this.fadeEl.classList.toggle('on', on); }

  // ---------------- minimap / map ----------------
  private buildMapImage() {
    if (this.mapImg) return this.mapImg;
    const S = 512; const c = el('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d')!; const img = ctx.createImageData(S, S);
    const T = this.g.terrain; const col = new THREE.Color();
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -HALF + (i + 0.5) * (WORLD_SIZE / S), z = -HALF + (j + 0.5) * (WORLD_SIZE / S);
      const h = T.heightAt(x, z);
      const k = (j * S + i) * 4;
      if (h < 0) { const d = Math.min(1, -h / 20); img.data[k] = 40 - d * 20; img.data[k + 1] = 110 - d * 40; img.data[k + 2] = 150 - d * 30; img.data[k + 3] = 255; continue; }
      T.colorAt(x, z, col);
      const hs = (T.heightAt(x - 3, z - 3) - h) * 0.06;
      const sh = Math.max(0.55, Math.min(1.3, 1 + hs));
      img.data[k] = Math.min(255, Math.pow(col.r, 1 / 2.2) * 255 * sh); img.data[k + 1] = Math.min(255, Math.pow(col.g, 1 / 2.2) * 255 * sh); img.data[k + 2] = Math.min(255, Math.pow(col.b, 1 / 2.2) * 255 * sh); img.data[k + 3] = 255;
      if (Math.floor(h) % 25 === 0 && h > 5) { img.data[k] *= 0.85; img.data[k + 1] *= 0.85; img.data[k + 2] *= 0.85; }
    }
    ctx.putImageData(img, 0, 0);
    this.mapImg = c; return c;
  }
  private revealed(x: number, z: number) {
    const st = this.g.state;
    return TOWERS.some((t) => st.towers[t.id] && x >= t.region[0] && x <= t.region[2] && z >= t.region[1] && z <= t.region[3]);
  }
  private drawMapTo(ctx: CanvasRenderingContext2D, S: number, cx: number, cz: number, span: number, full: boolean) {
    const g = this.g, img = this.buildMapImage();
    const toPx = (x: number, z: number) => [((x - (cx - span / 2)) / span) * S, ((z - (cz - span / 2)) / span) * S];
    ctx.fillStyle = '#0c1424'; ctx.fillRect(0, 0, S, S);
    const sx = ((cx - span / 2 + HALF) / WORLD_SIZE) * 512, sy = ((cz - span / 2 + HALF) / WORLD_SIZE) * 512, sw = (span / WORLD_SIZE) * 512;
    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, S, S);
    // fog of unrevealed regions
    ctx.fillStyle = 'rgba(12,20,36,0.82)';
    for (const t of TOWERS) {
      if (g.state.towers[t.id]) continue;
      const [x0, y0] = toPx(t.region[0], t.region[1]), [x1, y1] = toPx(t.region[2], t.region[3]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const icon = (x: number, z: number, txt: string, color: string, size = 14) => {
      const [px, py] = toPx(x, z); if (px < -10 || py < -10 || px > S + 10 || py > S + 10) return;
      ctx.font = `${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.arc(px, py, size * 0.65, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.fillText(txt, px, py + 1);
    };
    const sz = full ? 18 : 12;
    for (const t of TOWERS) icon(t.x, t.z, '▲', g.state.towers[t.id] ? '#6ad8ff' : '#ffa040', sz);
    for (const s of SHRINES) if (g.state.discoveredShrines[s.id] || this.revealed(s.x, s.z)) icon(s.x, s.z, '◈', g.state.shrines[s.id] ? '#6ad8ff' : '#ffa040', sz);
    if (full || this.revealed(VILLAGE.x, VILLAGE.z)) icon(VILLAGE.x, VILLAGE.z, '⌂', '#f3d48a', sz);
    icon(CITADEL.x, CITADEL.z, '☠', g.state.bossDefeated ? '#888' : '#c070ff', sz);
    for (const c of CAMPS) if (this.revealed(c.x, c.z) && !g.state.campsCleared.includes(c.id)) icon(c.x, c.z, '✕', '#ff7060', full ? 12 : 9);
    for (const p of this.pins) icon(p.x, p.z, '📍', '#ff4040', sz);
    if (full) { ctx.font = 'bold 14px Cinzel, serif'; ctx.fillStyle = 'rgba(255,240,210,.8)'; const lbl = (x: number, z: number, s: string) => { const [px, py] = toPx(x, z); ctx.fillText(s, px, py); };
      lbl(PLATEAU.x, PLATEAU.z - 70, 'Dawn Plateau'); lbl(CITADEL.x, CITADEL.z + 50, 'Sunken Citadel'); lbl(200, -520, 'Frostpeak Range'); lbl(420, 300, 'Sunscar Dunes'); lbl(-420, -330, 'Whisperwood'); lbl(170, -40, 'Mirelake'); lbl(VILLAGE.x, VILLAGE.z + 30, 'Brookhaven'); }
    // player arrow
    const P = g.inShrine ? g.shrineReturn : g.player.pos;
    const [px, py] = toPx(P.x, P.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-g.player.yaw + Math.PI);
    ctx.fillStyle = '#ffe080'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); const a = full ? 10 : 8; ctx.moveTo(0, -a); ctx.lineTo(a * 0.7, a * 0.8); ctx.lineTo(0, a * 0.35); ctx.lineTo(-a * 0.7, a * 0.8); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    return toPx;
  }
  private drawMinimap() {
    const ctx = this.mmCanvas.getContext('2d')!;
    const P = this.g.inShrine ? this.g.shrineReturn : this.g.player.pos;
    this.drawMapTo(ctx, 200, P.x, P.z, 260, false);
  }

  // ---------------- screens ----------------
  private open(s: Screen) {
    this.close(false);
    this.screen = s;
    this.root.appendChild(s.el);
    this.g.input.releasePointer();
    setTimeout(() => s.nav.paint(), 0);
    s.el.addEventListener('mousemove', (e) => { const t = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement; if (t) s.nav.focus(t); });
  }
  close(resume = true) {
    if (this.screen) { this.screen.el.remove(); this.screen = null; }
    if (resume && this.g.mode === 'menu') this.g.setMode('play');
  }

  update(dt: number) {
    const inp = this.g.input;
    if (this.dialogState) { this.updateDialog(); return; }
    const s = this.screen; if (!s) return;
    s.update?.(dt);
    if (inp.nav('up')) s.nav.move(0, -1);
    if (inp.nav('down')) s.nav.move(0, 1);
    if (inp.nav('left')) s.nav.move(-1, 0);
    if (inp.nav('right')) s.nav.move(1, 0);
    if (inp.pressed('tabL')) s.onTab?.(-1);
    if (inp.pressed('tabR')) s.onTab?.(1);
    if (inp.pressed('confirm')) { const c = s.nav.current(); if (c) { c.click(); } }
    if (inp.pressed('back') || (inp.pressed('menu') && s.onBack)) { audio.play('menu'); (s.onBack || (() => this.close()))(); }
  }

  // ---- dialog ----
  dialog(lines: string[], who?: string, choices?: string[]): Promise<number> {
    return new Promise((resolve) => {
      this.dialogEl?.remove();
      this.dialogState = { lines, i: 0, who, choices, resolve };
      this.dialogEl = el('div'); this.dialogEl.id = 'dialog';
      this.root.appendChild(this.dialogEl);
      this.dialogEl.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.btn')) this.advanceDialog(); });
      this.renderDialog();
      this.g.input.consume('confirm'); this.g.input.consume('attack'); this.g.input.consume('interact');
    });
  }
  private renderDialog() {
    const d = this.dialogState!; const e = this.dialogEl!;
    const last = d.i >= d.lines.length - 1;
    e.innerHTML = `${d.who ? `<div class="who">${d.who}</div>` : ''}<div>${d.lines[d.i]}</div>` +
      (last && d.choices ? `<div class="choices">${d.choices.map((c, i) => `<div class="btn" data-nav data-i="${i}">${c}</div>`).join('')}</div>` : `<div class="more">▼ ${this.glyph('confirm')}</div>`);
    if (last && d.choices) {
      d.nav = new Nav(e); d.nav.paint();
      e.querySelectorAll<HTMLElement>('.btn').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); this.endDialog(+b.dataset.i!); }));
    }
  }
  private advanceDialog() {
    const d = this.dialogState!;
    if (d.i >= d.lines.length - 1) { if (!d.choices) this.endDialog(0); return; }
    d.i++; audio.play('menu'); this.renderDialog();
  }
  private endDialog(v: number) {
    const d = this.dialogState!; this.dialogState = null; this.dialogEl?.remove(); this.dialogEl = null;
    this.g.input.consume('confirm'); this.g.input.consume('interact'); this.g.input.consume('attack'); this.g.input.consume('jump');
    d.resolve(v);
  }
  private updateDialog() {
    const inp = this.g.input, d = this.dialogState!;
    if (d.nav) {
      if (inp.nav('up')) d.nav.move(0, -1);
      if (inp.nav('down')) d.nav.move(0, 1);
      if (inp.pressed('confirm')) d.nav.current()?.click();
      if (inp.pressed('back')) this.endDialog(d.choices!.length - 1);
      return;
    }
    if (inp.pressed('confirm') || inp.pressed('attack') || inp.pressed('jump')) this.advanceDialog();
  }

  // ---- inventory / pause ----
  openInventory(tab = this.invTab) {
    const g = this.g;
    const tabs = ['Weapons', 'Shields', 'Crossbows', 'Materials', 'Food', 'Key Items', 'Map', 'System'];
    this.invTab = (tab + tabs.length) % tabs.length;
    if (tabs[this.invTab] === 'Map') { this.openMap(true); return; }
    if (tabs[this.invTab] === 'System') { this.openSystem(); return; }
    const scr = el('div', 'screen');
    const nav = new Nav(scr);
    scr.innerHTML = `<div class="tabs">${tabs.map((t, i) => `<div class="tab ${i === this.invTab ? 'on' : ''}" data-t="${i}">${t}</div>`).join('')}</div>
      <div class="stats-row"><span>❤ <b>${(g.player.health / 4).toFixed(2).replace(/\.?0+$/, '')}/${g.state.maxHearts}</b></span><span>⚡ <b>${Math.round(g.state.maxStamina / 100 * 10) / 10}</b> wheels</span><span>💎 <b>${g.inv.gems}</b> gems</span><span>🔮 <b>${g.inv.count('orb')}</b> orbs</span><span>◈ <b>${g.state.shrines.filter(Boolean).length}/${SHRINES.length}</b> sanctums</span></div>
      <div class="menu-body"><div class="grid"></div><div class="detail"></div></div>
      <div class="footer-hint">${this.glyph('tabL' as Action) === 'tabL' ? '' : ''}${g.input.device === 'pad' ? 'L / R: switch tabs · A: select · B: back' : g.input.device === 'kbm' ? 'Z / X or [ ]: switch tabs · Arrows: move · E: select · Esc: back' : 'Tap a tab or item'}</div>`;
    scr.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.addEventListener('click', () => this.openInventory(+t.dataset.t!)));
    const grid = scr.querySelector('.grid') as HTMLElement, detail = scr.querySelector('.detail') as HTMLElement;
    const kind = ['weapon', 'shield', 'bow'][this.invTab] as 'weapon' | 'shield' | 'bow' | undefined;
    const showDetail = (html: string, actions: { label: string; fn: () => void; primary?: boolean }[]) => {
      detail.innerHTML = html + `<div class="actions">${actions.map((a, i) => `<div class="btn ${a.primary ? 'primary' : ''}" data-nav data-a="${i}">${a.label}</div>`).join('')}</div>`;
      detail.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => actions[+b.dataset.a!].fn()));
    };
    const refresh = () => { const idx = nav.idx; this.openInventory(this.invTab); if (this.screen) { this.screen.nav.idx = idx; this.screen.nav.paint(); } };
    if (kind) {
      const list = kind === 'weapon' ? g.inv.weapons : kind === 'shield' ? g.inv.shields : g.inv.bows;
      list.forEach((s, i) => {
        const d = itemDef(s.id) as WeaponDef | ShieldDef | BowDef;
        const c = el('div', 'cell', `${itemIcon(s.id)}<small>${d.name}</small>${g.inv.equipped[kind] === i ? '<span class="eq">E</span>' : ''}<span class="dur"><i style="width:${(s.dur / d.durability) * 100}%"></i></span>`);
        c.dataset.nav = '';
        const select = () => {
          grid.querySelectorAll('.cell').forEach((x) => x.classList.remove('sel')); c.classList.add('sel');
          const stat = d.kind === 'shield' ? `🛡 Guard <b>${(d as ShieldDef).guard}</b>` : `⚔ Attack <b>${(d as WeaponDef).power}</b>`;
          showDetail(`<h2>${d.name}</h2><div class="stats"><span>${stat}</span><span>Durability ${Math.max(0, s.dur)}/${d.durability}</span>${(d as WeaponDef).type ? `<span>${{ one: 'One-handed', two: 'Two-handed', spear: 'Staff' }[(d as WeaponDef).type]}</span>` : ''}</div><p>${d.desc}</p>`, [
            { label: g.inv.equipped[kind] === i ? 'Unequip' : 'Equip', primary: true, fn: () => { g.inv.equipped[kind] = g.inv.equipped[kind] === i ? -1 : i; audio.play('select'); refresh(); } },
            { label: 'Drop', fn: () => { const id = g.inv.drop(kind, i); if (id) g.pickups.dropGear(id, g.player.pos.clone().addScaledVector(g.player.forward(), 1.2), true); refresh(); } },
          ]);
        };
        c.addEventListener('click', select); c.addEventListener('focus', select);
        grid.appendChild(c);
      });
      if (!list.length) detail.innerHTML = `<p>Nothing here yet.</p>`;
    } else if (this.invTab === 3) {
      const mats = Object.entries(g.inv.materials).filter(([, n]) => n > 0);
      for (const [id, n] of mats) {
        const d = itemDef(id) as MaterialDef;
        const c = el('div', 'cell', `${itemIcon(id)}<small>${d.name}</small><span class="cnt">×${n}</span>`); c.dataset.nav = '';
        c.addEventListener('click', () => {
          grid.querySelectorAll('.cell').forEach((x) => x.classList.remove('sel')); c.classList.add('sel');
          const acts = d.edible ? [{ label: `Eat (+${d.hearts * 2 / 4} ♥)`, primary: true, fn: () => { g.eatRaw(id); refresh(); } }] : [];
          acts.push({ label: 'Drop', primary: false, fn: () => { g.inv.remove(id); g.pickups.drop(id, g.player.pos); refresh(); } });
          showDetail(`<h2>${d.name}</h2><div class="stats">${d.hearts ? `<span>♥ ${d.hearts}</span>` : ''}${d.effect !== 'none' ? `<span>${EFFECT_ICON[d.effect]} ${d.effect}</span>` : ''}<span>💎 ${d.value}</span></div><p>${d.desc}</p>`, acts);
        });
        grid.appendChild(c);
      }
      if (!mats.length) detail.innerHTML = `<p>You haven't gathered any materials. Look for fruit, mushrooms and herbs in the wild.</p>`;
    } else if (this.invTab === 4) {
      g.inv.meals.forEach((m, i) => {
        const c = el('div', 'cell', `🍲<small>${m.name}</small>${m.effect !== 'none' ? `<span class="eq">${EFFECT_ICON[m.effect]}</span>` : ''}`); c.dataset.nav = '';
        c.addEventListener('click', () => {
          grid.querySelectorAll('.cell').forEach((x) => x.classList.remove('sel')); c.classList.add('sel');
          showDetail(`<h2>${m.name}</h2><div class="stats"><span>♥ ${m.hearts / 4}</span>${m.effect !== 'none' ? `<span>${EFFECT_ICON[m.effect]} ${'★'.repeat(m.level)}</span>` : ''}${m.duration ? `<span>⏱ ${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}</span>` : ''}</div><p>${m.desc}</p>`, [
            { label: 'Eat', primary: true, fn: () => { g.eatMeal(i); refresh(); } },
          ]);
        });
        grid.appendChild(c);
      });
      if (!g.inv.meals.length) detail.innerHTML = `<p>No meals. Cook ingredients at a cooking pot to make hearty dishes.</p>`;
    } else if (this.invTab === 5) {
      const keys: [string, string, string][] = [];
      keys.push(['slate', 'Wayfinder Stone', 'An ancient stone tablet. It holds your runes, map and memories.']);
      if (g.state.glider) keys.push(['glider', 'Windsail', 'Press jump in midair to glide. Uses stamina.']);
      if (g.inv.count('orb')) keys.push(['orb', `Spirit Orb ×${g.inv.count('orb')}`, 'Offer two at a Goddess Statue for a Heart Container or Stamina Vessel.']);
      for (const r of g.state.runes as RuneId[]) keys.push(['rune:' + r, 'Rune: ' + RUNE_INFO[r].name, RUNE_INFO[r].desc]);
      for (const [id, name, desc] of keys) {
        const icon = id.startsWith('rune:') ? RUNE_INFO[id.slice(5) as RuneId].icon : itemIcon(id);
        const c = el('div', 'cell', `${icon}<small>${name}</small>`); c.dataset.nav = '';
        c.addEventListener('click', () => { grid.querySelectorAll('.cell').forEach((x) => x.classList.remove('sel')); c.classList.add('sel'); showDetail(`<h2>${name}</h2><p>${desc}</p>`, []); });
        grid.appendChild(c);
      }
    }
    this.open({ el: scr, nav, onTab: (d) => { audio.play('menu'); this.openInventory(this.invTab + d); } });
    setTimeout(() => { const first = grid.querySelector<HTMLElement>('.cell'); if (first) { first.click(); nav.focus(first); } }, 0);
  }

  openMap(fromMenu = false) {
    const g = this.g;
    const scr = el('div', 'screen');
    const tabs = ['Weapons', 'Shields', 'Crossbows', 'Materials', 'Food', 'Key Items', 'Map', 'System'];
    if (fromMenu) scr.innerHTML = `<div class="tabs">${tabs.map((t, i) => `<div class="tab ${i === 6 ? 'on' : ''}" data-t="${i}">${t}</div>`).join('')}</div>`;
    const wrap = el('div', 'map-wrap'); scr.appendChild(wrap);
    const cv = el('canvas'); cv.width = cv.height = 900; wrap.appendChild(cv);
    const legend = el('div', 'map-legend'); wrap.appendChild(legend);
    const hint = el('div', 'footer-hint', g.input.device === 'pad' ? 'Left stick: move cursor · A: travel / place pin · B: back' : g.input.device === 'kbm' ? 'Click: travel / place pin · WASD/Arrows: move cursor · Esc: back' : 'Tap a ◈ or ▲ to travel; tap elsewhere to place a pin');
    scr.appendChild(hint);
    scr.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.addEventListener('click', () => { this.invTab = +t.dataset.t!; this.openInventory(+t.dataset.t!); }));
    const P = g.inShrine ? g.shrineReturn : g.player.pos;
    const cursor = new THREE.Vector2(P.x, P.z);
    const span = WORLD_SIZE;
    const ctx = cv.getContext('2d')!;
    const travelPts = () => {
      const pts: { x: number; z: number; name: string; go: () => void }[] = [];
      for (const t of TOWERS) if (g.state.towers[t.id]) pts.push({ x: t.x, z: t.z, name: t.name, go: () => g.fastTravel('tower', t.id) });
      for (const s of SHRINES) if (g.state.shrines[s.id]) pts.push({ x: s.x, z: s.z, name: s.name, go: () => g.fastTravel('shrine', s.id) });
      return pts;
    };
    const near = () => { let best: any = null, bd = 30; for (const p of travelPts()) { const d = Math.hypot(p.x - cursor.x, p.z - cursor.y); if (d < bd) { bd = d; best = p; } } return best; };
    const draw = () => {
      this.drawMapTo(ctx, 900, 0, 0, span, true);
      const cx = ((cursor.x + HALF) / span) * 900, cy = ((cursor.y + HALF) / span) * 900;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
      const n = near();
      legend.innerHTML = `<b style="color:var(--gold)">${n ? '⟶ ' + n.name : 'Isle of Wildreach'}</b><br>${n ? `${this.glyph('confirm')}: Travel here` : `${this.glyph('confirm')}: Place / remove pin`}<br><br>▲ Tower &nbsp; ◈ Sanctum<br>⌂ Village &nbsp; ✕ Enemy camp<br>☠ Sunken Citadel<br>Climb towers to reveal the map.`;
    };
    const confirm = async () => {
      const n = near();
      if (n) { const c = await this.dialog([`Travel to ${n.name}?`], undefined, ['Travel', 'Cancel']); if (c === 0) { this.close(); n.go(); } return; }
      const pi = this.pins.findIndex((p) => Math.hypot(p.x - cursor.x, p.z - cursor.y) < 25);
      if (pi >= 0) this.pins.splice(pi, 1); else if (this.pins.length < 20) this.pins.push({ x: cursor.x, z: cursor.y });
      audio.play('select'); draw();
    };
    const toWorld = (e: MouseEvent | PointerEvent) => { const r = cv.getBoundingClientRect(); cursor.set(((e.clientX - r.left) / r.width) * span - HALF, ((e.clientY - r.top) / r.height) * span - HALF); };
    cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { toWorld(e); draw(); } });
    cv.addEventListener('click', (e) => { toWorld(e); draw(); confirm(); });
    draw();
    const nav = new Nav(scr);
    this.open({
      el: scr, nav,
      onTab: fromMenu ? (d) => { this.openInventory(6 + d); } : undefined,
      update: (dt) => {
        const inp = g.input;
        const mx = inp.move.x + (inp.down('right') ? 1 : 0) - (inp.down('left') ? 1 : 0);
        const my = inp.move.y + (inp.down('up') ? 1 : 0) - (inp.down('down') ? 1 : 0);
        if (Math.abs(mx) + Math.abs(my) > 0.05) { cursor.x += mx * 400 * dt; cursor.y -= my * 400 * dt; cursor.clampScalar(-HALF, HALF); draw(); }
        if (inp.pressed('confirm')) { inp.consume('confirm'); confirm(); }
        if (inp.pressed('map') && !fromMenu) this.close();
      },
    });
    // map handles its own directional input
    this.screen!.nav = new Nav(el('div'));
  }

  openSystem() {
    const g = this.g;
    const tabs = ['Weapons', 'Shields', 'Crossbows', 'Materials', 'Food', 'Key Items', 'Map', 'System'];
    const scr = el('div', 'screen');
    const nav = new Nav(scr);
    const st = g.settings;
    const qn = ['Low (phone)', 'Medium', 'High'];
    scr.innerHTML = `<div class="tabs">${tabs.map((t, i) => `<div class="tab ${i === 7 ? 'on' : ''}" data-t="${i}">${t}</div>`).join('')}</div>
    <div class="settings">
      <div class="setrow"><span>Save game</span><div class="val"><div class="btn primary" data-nav id="s-save">Save</div><div class="btn" data-nav id="s-load">Load</div></div></div>
      <div class="setrow"><span>Graphics quality</span><div class="val"><div class="btn" data-nav id="q-">◀</div><span>${qn[st.quality]}</span><div class="btn" data-nav id="q+">▶</div></div></div>
      <div class="setrow"><span>Look sensitivity</span><div class="val"><div class="btn" data-nav id="sens-">◀</div><span>${st.sensitivity.toFixed(1)}</span><div class="btn" data-nav id="sens+">▶</div></div></div>
      <div class="setrow"><span>Invert camera Y</span><div class="val"><div class="btn" data-nav id="inv">${st.invertY ? 'On' : 'Off'}</div></div></div>
      <div class="setrow"><span>Controller face buttons</span><div class="val"><div class="btn" data-nav id="swap">${st.swapFace ? 'Swapped (A↔B, X↔Y)' : 'Standard'}</div></div></div>
      <div class="setrow"><span>Music volume</span><div class="val"><div class="btn" data-nav id="mus-">◀</div><span>${Math.round(st.music * 10)}</span><div class="btn" data-nav id="mus+">▶</div></div></div>
      <div class="setrow"><span>Effects volume</span><div class="val"><div class="btn" data-nav id="sfx-">◀</div><span>${Math.round(st.sfx * 10)}</span><div class="btn" data-nav id="sfx+">▶</div></div></div>
      <div class="setrow"><span>Touch controls</span><div class="val"><div class="btn" data-nav id="touch">${st.touch === 'auto' ? 'Auto' : st.touch === 'on' ? 'Always on' : 'Off'}</div></div></div>
      <div class="setrow"><span>Controls</span><div class="val"><div class="btn" data-nav id="ctl">View</div></div></div>
      <div class="setrow"><span>Return to title</span><div class="val"><div class="btn" data-nav id="title">Quit</div></div></div>
      <div class="footer-hint">${g.input.padConnected ? '🎮 ' + g.input.padName.slice(0, 50) : 'No controller detected — press any button on your controller.'}</div>
    </div>`;
    scr.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.addEventListener('click', () => this.openInventory(+t.dataset.t!)));
    const on = (id: string, fn: () => void) => scr.querySelector('#' + CSS.escape(id))?.addEventListener('click', () => { fn(); g.applySettings(); audio.play('select'); const i = nav.idx; this.openSystem(); this.screen!.nav.idx = i; this.screen!.nav.paint(); });
    scr.querySelector('#s-save')!.addEventListener('click', () => { g.save(); this.toast('Game saved.'); });
    scr.querySelector('#s-load')!.addEventListener('click', () => { this.close(); g.loadGame(); });
    on('q-', () => (st.quality = Math.max(0, st.quality - 1) as any)); on('q+', () => (st.quality = Math.min(2, st.quality + 1) as any));
    on('sens-', () => (st.sensitivity = Math.max(0.2, st.sensitivity - 0.1))); on('sens+', () => (st.sensitivity = Math.min(3, st.sensitivity + 0.1)));
    on('inv', () => (st.invertY = !st.invertY)); on('swap', () => (st.swapFace = !st.swapFace));
    on('mus-', () => (st.music = Math.max(0, st.music - 0.1))); on('mus+', () => (st.music = Math.min(1, st.music + 0.1)));
    on('sfx-', () => (st.sfx = Math.max(0, st.sfx - 0.1))); on('sfx+', () => (st.sfx = Math.min(1, st.sfx + 0.1)));
    on('touch', () => (st.touch = st.touch === 'auto' ? 'on' : st.touch === 'on' ? 'off' : 'auto'));
    scr.querySelector('#ctl')!.addEventListener('click', () => this.openControls(() => this.openSystem()));
    scr.querySelector('#title')!.addEventListener('click', async () => { const c = await this.dialog(['Return to the title screen? Unsaved progress since your last save will be lost.'], undefined, ['Quit to title', 'Cancel']); if (c === 0) { this.close(false); g.toTitle(); } });
    this.open({ el: scr, nav, onTab: (d) => this.openInventory(7 + d) });
  }

  openControls(back: () => void) {
    const scr = el('div', 'screen');
    const rows: [string, string, string, string][] = [
      ['Move', 'Left stick', 'WASD', 'Left side drag'], ['Camera', 'Right stick', 'Mouse', 'Right side drag'],
      ['Jump / Glide / Climb-jump', 'X', 'Space', '⤒'], ['Attack (hold: spin)', 'Y', 'Left click', '⚔'],
      ['Interact', 'A', 'E', '✋'], ['Sprint / Swim dash / Let go', 'B', 'Shift', '»'],
      ['Shield + Lock-on', 'ZL (hold)', 'Right click (hold)', '🛡'], ['Dodge (while locked)', 'ZL + X + direction', 'Right click + Space', '🛡 + ⤒'],
      ['Aim crossbow / fire', 'ZR hold / release', 'Q hold / click', '🏹'], ['Use rune', 'L', 'F', '✦'],
      ['Switch rune', 'D-pad ↑', '1–4', 'Tap rune icon'], ['Switch weapon / shield / crossbow', 'D-pad → / ← / ↓', '5 / 6', 'Menu'],
      ['Throw weapon', 'R', 'R', '↗'], ['Crouch (sneak)', 'L-stick click', 'C', '⇩'],
      ['Menu', '+', 'Esc / I', '☰'], ['Map', '−', 'M', '🗺'], ['Reset camera', 'R-stick click', 'V', '—'],
    ];
    scr.innerHTML = `<h2 style="text-align:center;font-family:var(--title);color:var(--gold);margin:4px 0 14px">Controls</h2>
      <div style="overflow:auto;flex:1;display:flex;justify-content:center"><div class="controls-table"><div>Action</div><div>🎮 Switch Pro</div><div>⌨️ Keyboard · 📱 Touch</div>${rows.map((r) => `<div>${r[0]}</div><div>${r[1]}</div><div>${r[2]} · ${r[3]}</div>`).join('')}</div></div>
      <div style="text-align:center;margin-top:10px"><div class="btn primary" data-nav id="back">Back</div></div>`;
    const nav = new Nav(scr);
    scr.querySelector('#back')!.addEventListener('click', back);
    this.open({ el: scr, nav, onBack: back });
  }

  openCooking() {
    const g = this.g;
    this.g.setMode('menu');
    const sel: string[] = [];
    const scr = el('div', 'screen');
    const nav = new Nav(scr);
    const render = () => {
      const avail = Object.entries(g.inv.materials).filter(([id, n]) => n > 0 && id !== 'arrow');
      scr.innerHTML = `<h2 style="text-align:center;font-family:var(--title);color:var(--gold);margin:4px 0">Cooking Pot</h2>
        <div class="footer-hint" style="margin:0 0 10px">Choose up to 5 ingredients, then cook. Combine ingredients with the same effect for stronger dishes!</div>
        <div class="menu-body"><div class="grid">${avail.map(([id, n]) => { const used = sel.filter((s) => s === id).length; return `<div class="cell ${used ? 'sel' : ''}" data-nav data-id="${id}">${itemIcon(id)}<small>${itemDef(id).name}</small><span class="cnt">${n - used}</span>${used ? `<span class="eq">${used}</span>` : ''}</div>`; }).join('') || '<p>You have no ingredients.</p>'}</div>
        <div class="detail"><h2>In the pot</h2><div style="font-size:34px;min-height:44px">${sel.map((s) => itemIcon(s)).join(' ') || '<span style="font-size:15px;color:var(--dim)">Empty</span>'}</div>
        <div class="actions"><div class="btn primary" data-nav id="cook" ${sel.length ? '' : 'disabled'}>Cook</div><div class="btn" data-nav id="clear">Clear</div><div class="btn" data-nav id="leave">Leave</div></div></div></div>`;
      scr.querySelectorAll<HTMLElement>('.cell[data-id]').forEach((c) => c.addEventListener('click', () => {
        const id = c.dataset.id!; const have = g.inv.count(id) - sel.filter((s) => s === id).length;
        if (have > 0 && sel.length < 5) { sel.push(id); audio.play('menu'); }
        else { const i = sel.lastIndexOf(id); if (i >= 0) sel.splice(i, 1); }
        const idx = nav.idx; render(); nav.idx = idx; nav.paint();
      }));
      scr.querySelector('#cook')?.addEventListener('click', async () => {
        if (!sel.length) return;
        if (g.inv.meals.length >= 20) { this.toast('You cannot carry more meals.'); return; }
        for (const s of sel) g.inv.remove(s);
        const meal = cook(sel);
        sel.length = 0;
        audio.play('cook');
        g.player.playOnce('Use_Item', 1);
        this.close(false); g.setMode('cutscene');
        await new Promise((r) => setTimeout(r, 1300));
        g.inv.meals.push(meal);
        this.itemGet(meal.name, meal.color, `♥ ${meal.hearts / 4}${meal.effect !== 'none' ? ` · ${EFFECT_ICON[meal.effect]} ${meal.desc}` : ''}`);
        g.setMode('play');
        g.autosave();
      });
      scr.querySelector('#clear')?.addEventListener('click', () => { sel.length = 0; render(); nav.paint(); });
      scr.querySelector('#leave')?.addEventListener('click', () => this.close());
    };
    render();
    this.open({ el: scr, nav });
  }

  openStatue() {
    const g = this.g;
    g.setMode('menu');
    const orbs = g.inv.count('orb');
    this.close(false);
    g.setMode('dialog');
    this.dialog([orbs >= 2 ? `You hold ${orbs} Spirit Orbs. Offer two, and I shall grant you strength.` : `Bring me Spirit Orbs from the sanctums, traveler. For every two, I will grant you a Heart Container or Stamina Vessel. (You have ${orbs}.)`], 'Goddess Statue', orbs >= 2 ? ['Heart Container ❤', 'Stamina Vessel ⚡', 'Not now'] : undefined).then((c) => {
      if (orbs >= 2 && c < 2) {
        g.inv.remove('orb', 2);
        if (c === 0) { g.state.maxHearts = Math.min(20, g.state.maxHearts + 1); g.player.health = g.player.maxHealth; this.itemGet('Heart Container', 0xff4a4a, 'Your maximum hearts increased by one!'); }
        else { g.state.maxStamina = Math.min(300, g.state.maxStamina + 20); g.player.stamina = g.state.maxStamina; this.itemGet('Stamina Vessel', 0x6fe06a, 'Your stamina wheel grew!'); }
        audio.play('fanfare');
        g.autosave();
      }
      g.setMode('play');
    });
  }

  openShop() {
    const g = this.g;
    g.setMode('menu');
    const scr = el('div', 'screen');
    const nav = new Nav(scr);
    const stock: [string, number, number][] = [['arrow', 10, 20], ['roundshield', 1, 60], ['crossbow', 1, 80], ['axe', 1, 50], ['herb', 1, 15], ['pepper', 1, 10], ['mushroom', 1, 10], ['meat', 1, 12]];
    let tab = 0;
    const render = () => {
      scr.innerHTML = `<div class="tabs"><div class="tab ${tab === 0 ? 'on' : ''}" id="t0">Buy</div><div class="tab ${tab === 1 ? 'on' : ''}" id="t1">Sell</div></div>
      <div class="stats-row"><span>💎 <b>${g.inv.gems}</b> gems</span></div>
      <div class="menu-body"><div class="grid"></div><div class="detail"><h2>Brakka's Goods</h2><p>"Finest wares on the isle! Bolts, shields, the works."</p><div class="actions"><div class="btn" data-nav id="leave">Leave</div></div></div></div>`;
      const grid = scr.querySelector('.grid')!;
      if (tab === 0) for (const [id, n, price] of stock) {
        const c = el('div', 'cell', `${itemIcon(id)}<small>${itemDef(id).name}${n > 1 ? ' ×' + n : ''}</small><span class="cnt">💎${price}</span>`); c.dataset.nav = '';
        c.addEventListener('click', () => {
          if (g.inv.gems < price) { this.toast('Not enough gems.'); return; }
          if (!g.inv.add(id, n)) { this.toast('No room for that.'); return; }
          g.inv.gems -= price; audio.play('pickup'); this.toast(`Bought ${itemDef(id).name}.`);
          const i = nav.idx; render(); nav.idx = i; nav.paint();
        });
        grid.appendChild(c);
      } else for (const [id, n] of Object.entries(g.inv.materials)) {
        const d = itemDef(id) as MaterialDef; if (!n || id === 'arrow') continue;
        const c = el('div', 'cell', `${itemIcon(id)}<small>${d.name}</small><span class="cnt">×${n} · 💎${d.value}</span>`); c.dataset.nav = '';
        c.addEventListener('click', () => { g.inv.remove(id); g.inv.gems += d.value; audio.play('pickup'); const i = nav.idx; render(); nav.idx = i; nav.paint(); });
        grid.appendChild(c);
      }
      scr.querySelector('#t0')!.addEventListener('click', () => { tab = 0; render(); nav.idx = 0; nav.paint(); });
      scr.querySelector('#t1')!.addEventListener('click', () => { tab = 1; render(); nav.idx = 0; nav.paint(); });
      scr.querySelector('#leave')!.addEventListener('click', () => this.close());
    };
    render();
    this.open({ el: scr, nav, onTab: () => { tab = 1 - tab; render(); nav.idx = 0; nav.paint(); } });
  }

  // ---------------- title / story / game over ----------------
  showLoading(): (f: number, msg?: string) => void {
    const l = el('div', '', `<h1>WILDREACH</h1><div class="bar"><i></i></div><p>Loading…</p>`); l.id = 'loading';
    document.body.appendChild(l);
    return (f, msg) => { (l.querySelector('i') as HTMLElement).style.width = `${f * 100}%`; if (msg) (l.querySelector('p') as HTMLElement).textContent = msg; if (f >= 1) setTimeout(() => l.remove(), 200); };
  }

  showTitle(hasSave: boolean, onNew: () => void, onContinue: () => void) {
    const t = el('div'); t.id = 'title';
    t.innerHTML = `<h1>WILDREACH</h1><div class="sub">Echoes of the Sundered Isle</div>
      <div class="menu">${hasSave ? '<div class="btn primary" data-nav id="cont">Continue</div>' : ''}<div class="btn ${hasSave ? '' : 'primary'}" data-nav id="new">New Game</div><div class="btn" data-nav id="ctl">Controls</div><div class="btn" data-nav id="fs">Fullscreen</div></div>
      <div class="hint">🎮 Pair your Switch Pro Controller over Bluetooth, then press any button. · ⌨️ Mouse + keyboard supported · 📱 Touch controls on phones</div>`;
    const nav = new Nav(t);
    const start = (fn: () => void) => { audio.unlock(); audio.play('select'); this.close(false); fn(); };
    t.querySelector('#new')!.addEventListener('click', async () => {
      if (hasSave) { audio.unlock(); const c = await this.dialog(['Start a new adventure? Your existing save will be overwritten.'], undefined, ['Start new game', 'Cancel']); if (c !== 0) return; }
      start(onNew);
    });
    t.querySelector('#cont')?.addEventListener('click', () => start(onContinue));
    t.querySelector('#ctl')!.addEventListener('click', () => { audio.unlock(); this.openControls(() => this.showTitle(hasSave, onNew, onContinue)); });
    t.querySelector('#fs')!.addEventListener('click', () => { audio.unlock(); const d: any = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => {}); });
    this.open({ el: t, nav, onBack: () => {} });
  }

  story(lines: string[]): Promise<void> {
    return new Promise((resolve) => {
      const s = el('div', 'story');
      this.root.appendChild(s);
      let i = 0;
      const show = () => { s.innerHTML = `<p>${lines[i]}</p>`; };
      show();
      let t = 0; let last = performance.now();
      const step = () => {
        const now = performance.now(); t += (now - last) / 1000; last = now;
        const inp = this.g.input; inp.update(0.016);
        if (t > 4.5 || inp.pressed('confirm') || inp.pressed('attack') || inp.pressed('jump')) {
          t = 0; i++;
          if (i >= lines.length) { s.remove(); resolve(); return; }
          show();
        }
        requestAnimationFrame(step);
      };
      s.addEventListener('click', () => { t = 99; });
      requestAnimationFrame(step);
    });
  }

  showGameOver(onContinue: () => void) {
    const s = el('div', 'gameover', `<h1>You have fallen</h1><p style="color:var(--dim)">The isle still needs you.</p><div class="btn primary" data-nav id="go">Continue</div>`);
    const nav = new Nav(s);
    s.querySelector('#go')!.addEventListener('click', () => { this.close(false); onContinue(); });
    this.open({ el: s, nav, onBack: () => {} });
  }
}

export { WEAPONS, SHIELDS, BOWS, MATERIALS };
export type { Meal };
