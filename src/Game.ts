import * as THREE from 'three';
import { Renderer, type Quality } from './engine/Renderer';
import { Input } from './engine/Input';
import { audio } from './engine/Audio';
import { globalUniforms } from './engine/Materials';
import { Terrain } from './world/Terrain';
import { Colliders } from './world/Colliders';
import { Sky } from './world/Sky';
import { Water } from './world/Water';
import { Vegetation } from './world/Vegetation';
import { Weather } from './world/Weather';
import { Structures, type Interactable } from './world/Structures';
import { Player } from './game/Player';
import { CameraRig } from './game/CameraRig';
import { EnemyManager, Enemy } from './game/Enemies';
import { Projectiles } from './game/Projectiles';
import { Physics } from './game/Physics';
import { Runes, RUNE_INFO } from './game/Runes';
import { Shrines } from './game/Shrines';
import { Pickups } from './game/Pickups';
import { Effects } from './game/Effects';
import { Boss } from './game/Boss';
import { Inventory } from './game/Inventory';
import { itemDef, type MaterialDef, type WeaponDef } from './game/Items';
import { UI } from './ui/UI';
import { TouchControls } from './ui/Touch';
import { START_POS, PLATEAU, VILLAGE, CITADEL, LAKE, SHRINES, TOWERS, HALF, SNOW_LINE, CAMPS } from './world/WorldData';
import { smoothstep } from './engine/noise';

export type Mode = 'title' | 'play' | 'menu' | 'dialog' | 'cutscene' | 'dead';

export interface GameState {
  maxHearts: number; maxStamina: number; runes: string[]; glider: boolean;
  shrines: boolean[]; discoveredShrines: boolean[]; towers: boolean[];
  chests: number[]; campsCleared: number[]; collected: number[];
  bossDefeated: boolean; hermitStage: number; day: number; introDone: boolean;
}
export interface Settings { quality: Quality; sensitivity: number; invertY: boolean; swapFace: boolean; music: number; sfx: number; touch: 'auto' | 'on' | 'off'; }

const SAVE_KEY = 'wildreach-save-v1';
const SETTINGS_KEY = 'wildreach-settings-v1';

function freshState(): GameState {
  return {
    maxHearts: 3, maxStamina: 100, runes: [], glider: false,
    shrines: SHRINES.map(() => false), discoveredShrines: SHRINES.map(() => false), towers: TOWERS.map(() => false),
    chests: [], campsCleared: [], collected: [], bossDefeated: false, hermitStage: 0, day: 0, introDone: false,
  };
}

export class Game {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  input: Input;
  terrain!: Terrain; colliders = new Colliders(); sky!: Sky; water!: Water; veg!: Vegetation; weather!: Weather;
  structures!: Structures; player!: Player; camRig!: CameraRig; enemies!: EnemyManager; projectiles!: Projectiles;
  phys!: Physics; runes!: Runes; shrines!: Shrines; pickups!: Pickups; fx!: Effects; boss!: Boss; inv = new Inventory();
  ui!: UI; touch!: TouchControls;
  get hud() { return this.ui; }
  state: GameState = freshState();
  settings: Settings;
  mode: Mode = 'title';
  cutscene = false;
  inShrine = false;
  shrineReturn = new THREE.Vector3();
  bulletTime = false;
  noRender = false;
  private hurtFlash = 0;
  coldness = 0;
  private hitstopT = 0;
  private flurryT = 0;
  private interactables: Interactable[] = [];
  currentInteractable: Interactable | null = null;
  currentPickup: any = null;
  private discoverT = 0;
  private autosaveT = 60;
  private regionName = '';
  private regionT = 0;
  private deadT = 0;
  private titleT = 0;
  private lastHour = 0;
  private bossIntroT = 0;
  private clock = new THREE.Timer();
  fps = 60; private fpsT = 0; private frames = 0; private lowFps = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = this.loadSettings();
    this.renderer = new Renderer(canvas, this.settings.quality);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    this.input = new Input(canvas);
    this.scene.fog = new THREE.Fog(0xbcd8ec, 150, 1100);
  }

  private loadSettings(): Settings {
    const def: Settings = { quality: (navigator.maxTouchPoints > 1 && /iPhone|iPad|Android|Mobile|Macintosh/.test(navigator.userAgent) && 'ontouchstart' in window) ? 0 : 2, sensitivity: 1, invertY: false, swapFace: false, music: 0.5, sfx: 0.8, touch: 'auto' };
    const q = new URLSearchParams(location.search).get('q');
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (s) Object.assign(def, s); } catch {}
    if (q !== null) def.quality = +q as Quality;
    return def;
  }

  async init(progress: (f: number, msg?: string) => void) {
    const q = this.settings.quality;
    progress(0.55, 'Shaping the land…');
    await tick();
    this.terrain = new Terrain(); this.terrain.generate(); this.scene.add(this.terrain.group);
    progress(0.7, 'Growing forests…');
    await tick();
    this.sky = new Sky(this.scene, q === 2 ? 2048 : q === 1 ? 1024 : 0);
    this.water = new Water(this.scene, this.terrain.dataTex, this.sky);
    this.veg = new Vegetation(this.terrain, this.colliders, q); this.scene.add(this.veg.group);
    progress(0.82, 'Raising towers…');
    await tick();
    this.fx = new Effects(this.scene);
    this.ui = new UI(this);
    this.player = new Player(this);
    this.camRig = new CameraRig(this, this.camera);
    this.enemies = new EnemyManager(this);
    this.projectiles = new Projectiles(this);
    this.phys = new Physics(this);
    this.runes = new Runes(this);
    this.pickups = new Pickups(this);
    this.structures = new Structures(this);
    this.shrines = new Shrines(this);
    this.weather = new Weather(this);
    this.boss = new Boss(this);
    this.enemies.extraTargets.push(this.boss);
    this.touch = new TouchControls(this);
    this.spawnWorldProps();
    progress(0.95, 'Warming up…');
    this.renderer.setupComposer(this.scene, this.camera);
    this.renderer.resize(this.camera);
    window.addEventListener('resize', () => this.renderer.resize(this.camera));
    this.input.onDeviceChange = (d) => { this.updateTouchVisibility(); if (d === 'pad') this.toastOnce('pad', '🎮 Controller connected'); };
    this.applySettings();
    this.pickups.populateWorld();
    // initial camera
    this.player.spawn(START_POS.x, this.terrain.heightAt(START_POS.x, START_POS.z) + 0.5, START_POS.z, 0.5);
    this.camRig.focus.copy(this.player.pos);
    this.updateFog();
    // compile shaders
    this.renderer.renderer.compile(this.scene, this.camera);
    progress(1);
  }

  private shown = new Set<string>();
  private toastOnce(k: string, msg: string) { if (this.shown.has(k)) return; this.shown.add(k); this.toast(msg); }

  /** physics props scattered in the overworld */
  private spawnWorldProps() {
    const P = PLATEAU;
    const add = (kind: any, x: number, z: number, size: any, opts: any = {}) => {
      const y = this.terrain.heightAt(x, z);
      const h = typeof size === 'number' ? size : size.y / 2;
      return this.phys.add(kind, new THREE.Vector3(x, y + h + 0.05, z), size, opts);
    };
    // crates with loot near camps & village
    for (const c of CAMPS) add('crate', c.x + 4, c.z + 6, new THREE.Vector3(1.2, 1.2, 1.2), { drops: ['apple', 'arrow'] });
    add('crate', VILLAGE.x + 10, VILLAGE.z - 3, new THREE.Vector3(1.2, 1.2, 1.2), { drops: ['meat'] });
    // cracked rocks hiding loot on plateau
    const cr = add('cracked', P.x + 70, P.z + 50, new THREE.Vector3(3, 3, 3));
    cr.onBreak = () => this.pickups.drop('ore', cr.pos, 1);
    // boulders on hills
    add('boulder', P.x + 40, P.z - 60, 1.3);
    add('boulder', -200, 120, 1.5);
    // metal crates
    add('metal', P.x - 50, P.z + 20, new THREE.Vector3(1.4, 1.4, 1.4));
    add('metal', VILLAGE.x + 20, VILLAGE.z + 20, new THREE.Vector3(1.4, 1.4, 1.4));
  }

  // ---------------- interactables ----------------
  addInteractable(i: Interactable) { this.interactables.push(i); }
  removeInteractable(i: Interactable) { const k = this.interactables.indexOf(i); if (k >= 0) this.interactables.splice(k, 1); }

  // ---------------- world queries ----------------
  groundAt(x: number, z: number, maxY: number): { y: number; c: any } {
    const t = this.inShrine ? -1e9 : this.terrain.heightAt(x, z);
    const b = this.colliders.groundTop(x, z, maxY, 0.3);
    return b.y > t ? b : { y: t, c: null };
  }
  waterLevelAt(x: number, z: number): number {
    if (this.inShrine) return this.shrines.waterLevelAt(x, z);
    return 0;
  }
  pushOutDynamic(p: THREE.Vector3, r: number) {
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z, d = Math.hypot(dx, dz), md = r + e.radius;
      if (d < md && d > 1e-4 && Math.abs(p.y - e.pos.y) < 1.5) { p.x = e.pos.x + (dx / d) * md; p.z = e.pos.z + (dz / d) * md; }
    }
  }
  nearFire(p: THREE.Vector3) { return !this.inShrine && this.structures.fires.some((f) => f.distanceTo(p) < 6); }
  updraftAt(p: THREE.Vector3): number {
    const list = this.inShrine ? this.shrines.updrafts : this.structures.updrafts;
    for (const u of list) {
      if (Math.hypot(p.x - u.pos.x, p.z - u.pos.z) < u.r + 0.8 && p.y > u.pos.y - 1 && p.y < u.pos.y + u.h) return 9;
    }
    return 0;
  }
  hasMetalEquipped() {
    const w = this.inv.weapon(), s = this.inv.shield();
    const metalW = w && !['twig', 'emberstaff', 'boneblade', 'boneaxe'].includes(w.id);
    const metalS = s && ['kiteshield', 'spikeshield'].includes(s.id);
    return !!(metalW || metalS);
  }

  // ---------------- combat glue ----------------
  hitstop(t: number) { this.hitstopT = Math.max(this.hitstopT, t); }
  startFlurry() {
    this.flurryT = 2.6;
    audio.play('parry');
    this.toast('Flurry Rush!');
  }
  damagePlayer(q: number, from: THREE.Vector3 | null, cause: string) {
    const P = this.player;
    if (P.state === 'dead' || this.mode === 'title') return;
    let dmg = q;
    if (cause !== 'fall' && cause !== 'cold' && cause !== 'drown') dmg = Math.max(1, Math.round(dmg * (1 - P.buff('defense') * 0.2)));
    if (P.extraHearts > 0) { const a = Math.min(P.extraHearts, dmg); P.extraHearts -= a; dmg -= a; }
    P.health = Math.max(0, P.health - dmg);
    audio.play('hurt');
    this.hurtFlash = 0.6;
    this.input.rumble(0.7, 160);
    if (P.health <= 0) this.onPlayerDeath();
    else if (P.health <= 4) audio.play('lowHp');
    void from;
  }
  hitPlayer(dmg: number, from: THREE.Vector3 | null, attacker: any, fire = false, knock = 1) {
    const P = this.player;
    if (P.invuln > 0 || P.state === 'dead') return;
    if (P.state === 'dodge') return;
    const block = P.tryBlock(from, dmg);
    if (block === 'parry') {
      audio.play('parry'); this.fx.burst(P.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(P.forward(), 0.6), 25, 0xfff0a0, 5, 0.25, 0.4, 0);
      this.hitstop(0.12); this.camRig.shake(0.2);
      if (attacker instanceof Enemy) { attacker.setState('stun'); attacker.anim.play('Hit_B', { loop: false, restart: true, speed: 0.5 }); }
      else if (attacker && attacker.parried) attacker.parried();
      this.toast('Perfect guard!');
      return;
    }
    if (block === 'block') {
      audio.play('block'); this.fx.burst(P.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(P.forward(), 0.6), 12, 0xffffff, 3, 0.2, 0.3, 0);
      const s = this.inv.shield()!;
      const chip = Math.max(0, Math.round(dmg - s.guard / 4));
      if (this.inv.wear('shield', Math.max(1, Math.ceil(dmg / 3)))) { this.toast(`Your ${s.name} broke!`); audio.play('break'); }
      if (from) { const d = P.pos.clone().sub(from).setY(0).normalize(); P.vel.addScaledVector(d, 4); }
      if (chip > 0 && knock > 1.5) this.damagePlayer(chip, from, 'hit');
      return;
    }
    this.damagePlayer(dmg, from, fire ? 'fire' : 'hit');
    if ((P.state as string) !== 'dead') {
      const d = from ? P.pos.clone().sub(from).setY(0).normalize() : null;
      P.hurt(d, knock);
    }
    this.camRig.shake(0.3);
  }
  damageEnemy(e: any, dmg: number, dir: THREE.Vector3 | null, knock: number, silent = false) {
    if (!e.alive) return;
    // shield block from front
    if (e.shieldUp && dir && !silent) {
      const f = e.forward(new THREE.Vector3());
      if (f.dot(dir) < -0.3 && knock < 1.5) {
        audio.play('block'); this.fx.burst(e.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 8, 0xffffff, 3, 0.2, 0.3, 0);
        dmg *= 0.2;
      }
    }
    e.hp -= dmg;
    if (!silent) {
      audio.play('hit');
      this.fx.burst(e.pos.clone().add(new THREE.Vector3(0, (e.height || 1.6) * 0.6, 0)), 10, 0xfff4d0, 4, 0.2, 0.35, 6);
    }
    if (e.hp <= 0) { e.hp = 0; e.die(); return; }
    if (!silent) e.onHit(dir, knock);
  }
  explosion(p: THREE.Vector3, radius: number, dmg: number) {
    this.fx.explosion(p, radius);
    audio.play('explode');
    this.camRig.shake(Math.max(0, 1 - p.distanceTo(this.player.pos) / 30));
    this.input.rumble(0.8, 250);
    this.phys.explode(p, radius);
    for (const e of this.enemies.targets()) {
      const d = e.pos.distanceTo(p);
      if (d < radius + (e.radius || 0.5)) this.damageEnemy(e, dmg * (1 - d / (radius * 1.5)) + 4, e.pos.clone().sub(p).setY(0).normalize(), 1.8);
    }
    const pd = this.player.pos.clone().add(new THREE.Vector3(0, 1, 0)).distanceTo(p);
    if (pd < radius * 0.85) this.hitPlayer(3, p, null, true, 1.6);
  }

  // ---------------- events ----------------
  toast(msg: string, color?: number) { this.ui?.toast(msg, color); }
  banner(t: string, s = '') { this.ui.banner(t, s); }
  async dialog(lines: string[], who?: string, choices?: string[]): Promise<number> {
    const prev = this.mode;
    this.setMode('dialog');
    const r = await this.ui.dialog(lines, who, choices);
    if (this.mode === 'dialog') this.setMode(prev === 'dialog' ? 'play' : prev === 'menu' ? 'play' : prev);
    return r;
  }
  fade(cb: () => void) {
    this.ui.fade(true);
    const prev = this.mode; this.setMode('cutscene');
    setTimeout(() => { cb(); setTimeout(() => { this.ui.fade(false); if (this.mode === 'cutscene') this.setMode(prev === 'cutscene' ? 'play' : prev); }, 250); }, 480);
  }
  setMode(m: Mode) {
    this.mode = m;
    this.ui.setHudVisible(m === 'play' || m === 'dialog' || m === 'cutscene');
    this.updateTouchVisibility();
    if (m !== 'play') this.input.releasePointer();
  }
  private updateTouchVisibility() {
    const st = this.settings.touch;
    const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const want = st === 'on' || (st === 'auto' && touchCapable && this.input.device !== 'pad' && this.input.device !== 'kbm');
    this.touch?.setVisible(want && this.mode === 'play');
    this.input.enabledPointerLock = !(st === 'on' || (st === 'auto' && touchCapable && this.input.device === 'touch'));
  }
  audioUnlock() { audio.unlock(); }

  activateTower(id: number) {
    if (this.state.towers[id]) return;
    this.state.towers[id] = true;
    this.structures.refreshTowers();
    audio.play('fanfare');
    this.player.playOnce('Spellcast_Summon', 1);
    const t = TOWERS[id];
    this.fx.burst(this.structures.towerTops[id].clone().add(new THREE.Vector3(0, 1.5, 0)), 60, 0x6ad8ff, 8, 0.4, 1.5, -2);
    this.banner(t.name, 'Map data revealed');
    setTimeout(() => this.toast('You can now fast travel here from the map.'), 1500);
    this.autosave();
  }
  onCampCleared(id: number) {
    if (!this.state.campsCleared.includes(id)) this.state.campsCleared.push(id);
    audio.play('jingle');
    this.toast('Camp cleared! A treasure chest has been unlocked.', 0xffd040);
  }
  async talkHermit() {
    const st = this.state;
    const who = 'Old Hermit';
    const H = this.structures.hermit;
    H.anim.play('Interact', { loop: false, restart: true });
    setTimeout(() => H.anim.play('Idle'), 1500);
    if (st.hermitStage === 0) {
      await this.dialog([
        'Ah... so you have finally woken. You slept a long, long time, child.',
        'This is the Dawn Plateau. Below lies the Sundered Isle, overrun by the restless dead since the Hollow King rose in the Sunken Citadel.',
        'The tablet you carry is a Wayfinder Stone. Four sanctums on this plateau hold ancient powers — runes — that it can learn.',
        'Clear all four sanctums and bring me their Spirit Orbs. Then I shall give you my Windsail. Without it, you\'ll never leave this plateau alive.',
        'If you climb the Dawn Spire, the stone will chart this land for you. Off you go!',
      ], who);
      st.hermitStage = 1;
      this.toast('Tip: climb almost anything — walk into a cliff to start climbing.');
    } else if (st.hermitStage === 1) {
      const done = SHRINES.slice(0, 4).filter((s) => st.shrines[s.id]).length;
      if (done < 4) {
        await this.dialog([`You've cleared ${done} of the four sanctums. The orange glow marks those that remain.`, done === 0 ? 'The Ember Sanctum lies just southwest of here.' : 'Keep going — the plateau isn\'t large.', 'And do eat something! Cook at my pot if you gather ingredients.'], who);
      } else {
        await this.dialog(['All four! The runes have chosen you well.', 'As promised — take my Windsail. Leap from any height and press jump in midair to glide.', 'Now go. Climb the towers, seek the sanctums beyond, grow strong... and end the Hollow King.'], who);
        st.glider = true; st.hermitStage = 2;
        this.inv.add('glider', 1);
        this.ui.itemGet('Windsail', 0xd8a25a, 'Press jump while in midair to glide. Gliding uses stamina.');
        audio.play('fanfare');
        this.autosave();
      }
    } else {
      await this.dialog(['The Sunken Citadel lies at the heart of the isle. Its king grows stronger with every night.', 'Goddess Statues will turn your Spirit Orbs into hearts or stamina. There\'s one by this hut, and another in Brookhaven village.', this.sky.isNight ? 'Careful at night — the dead crawl from the earth.' : 'Rain makes rock slippery. Wait it out or find another way up.'], who);
    }
  }
  async talkGuard() {
    await this.dialog(['Halt! Oh — a traveler. Welcome to Brookhaven.', 'Skeleton camps dot the isle. Clear one and you\'ll find a chest they were guarding.', 'Word of advice: metal gear in a thunderstorm is a fine way to get struck by lightning.'], 'Captain Ardel');
  }
  async talkChef() {
    await this.dialog(['Hungry? Toss up to five ingredients in the pot.', 'Match effects for strong dishes: Emberpeppers keep you warm in the mountains, Glowcaps restore stamina, Vigor Herbs give extra hearts.', 'Mix different effects and they cancel out. Cooking doubles the healing of raw food!'], 'Chef Mirra');
  }
  startBossIntro(_b: Boss) {
    this.setMode('cutscene');
    this.bossIntroT = 3.4;
    audio.musicMood = 'boss';
    const c = new THREE.Vector3(CITADEL.x, this.terrain.heightAt(CITADEL.x, CITADEL.z), CITADEL.z);
    this.camRig.cutscene = { pos: c.clone().add(new THREE.Vector3(8, 6, 4)), look: this.boss.pos.clone().add(new THREE.Vector3(0, 4, 0)) };
    this.banner('The Hollow King', 'Lord of the Restless Dead');
  }
  endBossFight(_won: boolean) {
    audio.musicMood = this.sky.isNight ? 'night' : 'day';
    for (const e of this.enemies.list.slice()) if (e.campId < 0 && !e.spawnedAtNight) this.enemies.remove(e);
  }
  onBossDefeated() {
    this.state.bossDefeated = true;
    audio.play('fanfare');
    this.banner('Victory', 'The Hollow King is vanquished');
    this.endBossFight(true);
    audio.musicMood = 'day';
    for (const e of this.enemies.list.slice()) if (e.alive && e.pos.distanceTo(this.boss.pos) < 60) this.damageEnemy(e, 999, null, 0, true);
    this.state.maxHearts = Math.min(20, this.state.maxHearts + 2);
    this.player.health = this.player.maxHealth;
    this.autosave();
    setTimeout(async () => {
      this.setMode('cutscene');
      await this.ui.story([
        'As the Hollow King crumbles to dust, a warm wind sweeps across the Sundered Isle.',
        'The restless dead fall still. Dawn light spills over the Citadel walls for the first time in a hundred years.',
        'The isle is free — but there is always more to explore.',
        'WILDREACH · Characters & props: KayKit by Kay Lousberg (CC0) · Built with three.js',
        'Thank you for playing!',
      ]);
      this.setMode('play');
      this.toast('You can keep exploring. Your progress has been saved.');
    }, 7000);
  }

  enterShrine() {
    this.inShrine = true;
    this.shrineReturn.copy(this.player.pos);
    const def = this.shrines.current!;
    this.shrineReturn.set(def.x, this.terrain.heightAt(def.x, def.z), def.z);
    this.sky.indoor = true;
    for (const o of [this.sky.mesh, this.water.mesh, this.veg.group, this.terrain.group, this.structures.group, this.boss.root]) o.visible = false;
    this.enemies.clearAll();
    this.projectiles.clear();
    this.updateFog();
  }
  exitShrine(pos: THREE.Vector3) {
    this.inShrine = false;
    this.sky.indoor = false;
    for (const o of [this.sky.mesh, this.water.mesh, this.veg.group, this.terrain.group, this.structures.group]) o.visible = true;
    this.boss.root.visible = !this.state.bossDefeated;
    this.player.spawn(pos.x, pos.y, pos.z, 0);
    this.camRig.reset();
    audio.musicMood = this.sky.isNight ? 'night' : 'day';
    this.updateFog();
  }
  fastTravel(kind: 'tower' | 'shrine', id: number) {
    this.fade(() => {
      if (this.inShrine) { (this.shrines as any).destroy(); this.inShrine = false; this.exitShrine(new THREE.Vector3()); }
      if (kind === 'tower') { const t = this.structures.towerTops[id]; this.player.spawn(t.x + 1.5, t.y + 0.1, t.z + 1.5, 0); }
      else { const s = SHRINES[id]; const y = this.terrain.heightAt(s.x, s.z + 3); this.player.spawn(s.x, y + 0.6, s.z + 3, 0); }
      this.camRig.reset();
      this.enemies.clearAll();
      this.camRig.focus.copy(this.player.pos);
    });
  }

  eatRaw(id: string) {
    const d = itemDef(id) as MaterialDef;
    this.inv.remove(id);
    this.player.health = Math.min(this.player.maxHealth, this.player.health + d.hearts * 2);
    if (d.effect === 'stamina') this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 15);
    audio.play('heal');
  }
  eatMeal(i: number) {
    const m = this.inv.meals[i]; if (!m) return;
    this.inv.meals.splice(i, 1);
    const P = this.player;
    P.health = Math.min(P.maxHealth, P.health + m.hearts);
    if (m.effect === 'hearty') { P.health = P.maxHealth; P.extraHearts = Math.max(P.extraHearts, 4 * m.level); }
    else if (m.effect === 'stamina') { P.stamina = Math.min(P.maxStamina, P.stamina + 40 * m.level); P.exhausted = false; }
    else if (m.effect !== 'none') P.buffs[m.effect] = { level: m.level, t: m.duration };
    audio.play('heal');
    this.fx.burst(P.pos.clone().add(new THREE.Vector3(0, 1, 0)), 15, 0xffa0a0, 2, 0.25, 0.8, -1);
  }

  objectiveText(): string {
    const st = this.state;
    if (st.hermitStage === 0) return 'Speak with the old hermit by the hut.';
    if (st.hermitStage === 1) {
      const done = SHRINES.slice(0, 4).filter((s) => st.shrines[s.id]).length;
      if (done < 4) return `Clear the four sanctums of the Dawn Plateau (${done}/4).`;
      return 'Return to the old hermit.';
    }
    if (!st.bossDefeated) return 'Defeat the Hollow King in the Sunken Citadel.';
    return '';
  }

  onPlayerDeath() {
    this.player.die();
    this.setMode('dead');
    this.deadT = 0;
    audio.musicMood = 'none';
    if (this.boss.active) { this.boss.reset(); this.endBossFight(false); }
  }

  // ---------------- save/load ----------------
  serialize() {
    const P = this.player;
    return {
      v: 1, state: this.state, inv: this.inv.serialize(),
      player: { pos: (this.inShrine ? this.shrineReturn.clone().add(new THREE.Vector3(0, 0.5, 2)) : P.pos).toArray(), yaw: P.yaw, health: Math.max(4, P.health), stamina: P.stamina, buffs: P.buffs, extra: P.extraHearts },
      time: this.sky.time, weather: this.weather.kind, pins: this.ui.pins, rune: this.runes.selected,
    };
  }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); } catch (e) { console.warn(e); } }
  autosave() {
    if (this.mode === 'title' || this.player.state === 'dead') return;
    this.save();
    this.autosaveT = 60;
  }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  loadGame() {
    let d: any = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch {}
    if (!d) { this.newGame(); return; }
    this.fade(() => {
      if (this.inShrine) { (this.shrines as any).destroy(); this.exitShrine(new THREE.Vector3()); }
      this.state = Object.assign(freshState(), d.state);
      this.inv.load(d.inv);
      this.applyState();
      const p = d.player;
      this.player.spawn(p.pos[0], p.pos[1], p.pos[2], p.yaw);
      this.player.health = p.health; this.player.stamina = p.stamina; this.player.buffs = p.buffs || {}; this.player.extraHearts = p.extra || 0;
      this.player.exhausted = false;
      this.player.anim.play('Idle', { restart: true });
      this.player.oneShot = '';
      this.sky.time = d.time ?? 9;
      this.weather.set(d.weather || 'clear');
      this.ui.pins = d.pins || [];
      if (d.rune) this.runes.selected = d.rune;
      this.camRig.reset(); this.camRig.focus.copy(this.player.pos);
      this.setMode('play');
      audio.musicMood = this.sky.isNight ? 'night' : 'day';
    });
  }
  private applyState() {
    this.structures.applySavedChests(this.state.chests);
    this.structures.refreshTowers();
    this.structures.refreshShrines();
    this.enemies.clearAll();
    this.enemies.campState.forEach((c, i) => (c.cleared = this.state.campsCleared.includes(i)));
    this.pickups.populateWorld();
    this.boss.reset();
    this.runes.cancel();
  }
  async newGame() {
    this.state = freshState();
    this.inv.load({});
    this.inv.add('arrow', 0);
    this.ui.pins = [];
    this.applyState();
    this.sky.time = 7.2;
    this.weather.set('clear');
    this.player.health = 12; this.player.stamina = 100; this.player.buffs = {}; this.player.extraHearts = 0; this.player.exhausted = false;
    const sx = START_POS.x, sz = START_POS.z;
    this.player.spawn(sx, this.terrain.heightAt(sx, sz) + 0.4, sz, 2.2);
    this.setMode('cutscene');
    await this.ui.story([
      'Long ago, the Sundered Isle was watched over by the Wardens of Dawn.',
      'Then the Hollow King rose from the Sunken Citadel, and the dead walked again.',
      'The last Warden was hidden away in an ancient chamber... to sleep, and to wait.',
      'Open your eyes.',
    ]);
    this.player.anim.play('Lie_StandUp', { loop: false, restart: true, clamp: true, speed: 0.8 });
    this.player.oneShot = 'Lie_StandUp'; (this.player as any).oneShotT = 2.2;
    this.camRig.reset(); this.camRig.focus.copy(this.player.pos);
    this.camRig.yaw = this.player.yaw + Math.PI + 0.5; this.camRig.pitch = 0.15;
    this.setMode('play');
    audio.musicMood = 'day';
    setTimeout(() => this.banner('Dawn Plateau', 'Wildreach'), 1500);
    const dev = this.input.device;
    setTimeout(() => this.toast(dev === 'pad' ? 'Left stick to move, right stick to look. A to interact.' : dev === 'touch' ? 'Drag on the left to move, right to look.' : 'WASD to move, mouse to look (click to capture). E to interact.'), 2500);
    this.state.introDone = true;
    this.autosave();
  }
  toTitle() {
    if (this.inShrine) { (this.shrines as any).destroy(); this.exitShrine(new THREE.Vector3(START_POS.x, 100, START_POS.z)); }
    this.setMode('title');
    audio.musicMood = 'day';
    this.ui.showTitle(this.hasSave(), () => this.newGame(), () => this.loadGame());
  }

  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity; this.input.invertY = s.invertY; this.input.swapFaceButtons = s.swapFace;
    audio.volume.music = s.music; audio.volume.sfx = s.sfx; audio.applyVolume();
    if (this.renderer.quality !== s.quality) {
      this.renderer.setQuality(s.quality);
      this.renderer.resize(this.camera);
      this.sky.sun.castShadow = s.quality > 0;
    }
    this.updateTouchVisibility();
    this.updateFog();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  }
  private updateFog() {
    const f = this.scene.fog as THREE.Fog;
    const q = this.settings.quality;
    if (this.inShrine) { f.near = 45; f.far = 220; this.scene.background = new THREE.Color(0x1c1e28); }
    else { f.near = q === 0 ? 90 : 160; f.far = q === 0 ? 650 : q === 1 ? 900 : 1150; this.scene.background = null; }
    this.camera.far = this.inShrine ? 300 : f.far + 50;
    this.camera.updateProjectionMatrix();
    if (this.renderer.ink) this.renderer.ink.uniforms.uFar.value = this.camera.far;
  }

  // ---------------- main loop ----------------
  start() {
    if (new URLSearchParams(location.search).get('manual')) { this.toTitle(); return; }
    const loop = () => {
      requestAnimationFrame(loop);
      this.clock.update();
      const dt = Math.min(this.clock.getDelta(), 1 / 20);
      this.frame(dt);
    };
    this.toTitle();
    requestAnimationFrame(loop);
  }

  frame(dt: number) {
    this.input.update(dt);
    // fps watch
    this.frames++;
    const now = performance.now();
    if (!this.fpsT) this.fpsT = now;
    if (now - this.fpsT > 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT); this.frames = 0; this.fpsT = now;
      // dynamic resolution: step pixel ratio down when the frame rate stays low
      if (this.mode === 'play' && !this.noRender) {
        this.lowFps = this.fps < 42 ? this.lowFps + 1 : 0;
        const r = this.renderer.renderer;
        if (this.lowFps >= 4 && r.getPixelRatio() > 1.01 && !/HeadlessChrome/.test(navigator.userAgent)) {
          r.setPixelRatio(Math.max(1, r.getPixelRatio() - 0.25));
          this.renderer.resize(this.camera);
          this.lowFps = 0;
        }
      }
    }
    globalUniforms.uTime.value += dt;
    globalUniforms.uWind.value = this.weather.wind;
    // time scales
    this.hitstopT = Math.max(0, this.hitstopT - dt);
    this.flurryT = Math.max(0, this.flurryT - dt);
    if (this.player.flurryT > 0) this.player.flurryT -= dt;
    let world = 1;
    if (this.hitstopT > 0) world = 0.05;
    else if (this.flurryT > 0) world = 0.12;
    else if (this.bulletTime) world = 0.3;
    const wdt = dt * world;
    const pdt = this.hitstopT > 0 ? dt * 0.15 : this.bulletTime ? dt * 0.4 : dt;

    if (this.mode === 'title') this.updateTitle(dt);
    if (this.mode === 'play') this.updatePlay(dt);
    if (this.mode === 'dead') this.tickDead(dt);
    if (this.mode === 'menu' || this.mode === 'dialog' || this.mode === 'title' || this.mode === 'dead') this.ui.update(dt);

    const live = this.mode === 'play' || this.mode === 'dead' || this.mode === 'cutscene' || this.mode === 'dialog';
    if (live) {
      this.player.update(pdt);
      this.runes.update(dt);
      this.enemies.update(wdt);
      this.boss.update(wdt);
      this.projectiles.update(wdt);
      this.phys.update(wdt);
      this.pickups.update(dt);
      this.shrines.update(dt);
    } else if (this.mode === 'menu') {
      // world paused
    }
    this.structures.update(dt, globalUniforms.uTime.value);
    this.fx.update(live ? wdt : dt);
    if (this.mode !== 'menu') this.weather.update(dt);

    // day/night progression
    if (this.mode === 'play' || this.mode === 'title') {
      const prevH = this.sky.time;
      this.sky.update(this.mode === 'play' ? dt : dt * 4, this.player.pos, this.camera.position, this.scene, this.weather.clouds);
      if (prevH > 23.5 && this.sky.time < 0.5 && this.mode === 'play') this.newDay();
    } else this.sky.update(0, this.player.pos, this.camera.position, this.scene, this.weather.clouds);

    // camera
    if (this.mode !== 'title') {
      if (this.mode === 'cutscene' && this.bossIntroT > 0) {
        this.bossIntroT -= dt;
        this.camRig.update(dt);
        if (this.bossIntroT <= 0) { this.camRig.cutscene = null; this.setMode('play'); }
      } else this.camRig.update(dt);
    }
    // world LOD & visuals
    const cam = this.camera.position;
    if (!this.inShrine) {
      this.terrain.updateLOD(cam, this.renderer.quality);
      this.veg.updateLOD(cam, this.renderer.quality);
    }
    globalUniforms.uPlayerPos.value.copy(this.player.pos);
    const amb = this.sky.hemi.color;
    this.veg.updateGrass(cam, this.sky.isNight ? this.sky.sunDir.clone().negate() : this.sky.sunDir, this.sky.sun.color, this.sky.sun.intensity, amb, this.sky.hemi.intensity);
    const light = Math.min(1, 0.3 + this.sky.sun.intensity * 0.3);
    this.water.update(cam, this.sky.sun.color, this.sky.mat.uniforms.uHor.value, light);
    // post fx
    const ink = this.renderer.ink?.uniforms;
    if (ink) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
      const lowHp = this.player.health <= 4 && this.mode === 'play' ? 0.25 + Math.sin(performance.now() * 0.006) * 0.1 : 0;
      ink.uHurt.value = Math.min(1, this.hurtFlash + lowHp);
      ink.uSlowmo.value += ((this.flurryT > 0 || this.bulletTime ? 1 : 0) - ink.uSlowmo.value) * Math.min(1, dt * 8);
      ink.uCold.value = this.coldness;
      ink.uInk.value = this.inShrine ? 0.7 : 1;
    }
    // music mood
    if (this.mode === 'play' && !this.boss.active && !this.inShrine) {
      audio.musicMood = this.enemies.combatActive() ? 'combat' : this.sky.isNight ? 'night' : 'day';
    }
    audio.updateMusic(dt);
    if (this.mode !== 'title' && this.mode !== 'menu') this.ui.updateHUD(dt);
    else if (this.mode === 'menu') { /* keep hud hidden */ }
    if (!this.noRender) this.renderer.render(this.scene, this.camera);
  }

  private updateTitle(dt: number) {
    this.titleT += dt;
    const a = this.titleT * 0.05;
    const c = new THREE.Vector3(PLATEAU.x, PLATEAU.top, PLATEAU.z);
    this.camera.position.set(c.x + Math.cos(a) * 170, c.y + 55, c.z + Math.sin(a) * 170);
    this.camera.lookAt(c.x, c.y + 10, c.z);
  }

  private newDay() {
    this.state.day++;
    this.state.collected = [];
    this.pickups.populateWorld();
    if (this.state.campsCleared.length) {
      this.state.campsCleared = [];
      this.enemies.respawnCamps();
    }
  }

  private updatePlay(dt: number) {
    const inp = this.input;
    const P = this.player;
    if (inp.pressed('menu')) { this.setMode('menu'); this.ui.openInventory(); return; }
    if (inp.pressed('map')) { this.setMode('menu'); this.ui.openMap(false); return; }
    // quick select
    if (!this.runes.holding) {
      if (inp.pressed('right') || inp.pressed('cycleWeapon')) { this.inv.cycle('weapon'); this.ui.showQuick('weapon'); audio.play('menu'); }
      if (inp.pressed('left') || inp.pressed('cycleShield')) { this.inv.cycle('shield'); this.ui.showQuick('shield'); audio.play('menu'); }
      if (inp.pressed('down')) { this.inv.cycle('bow'); this.ui.showQuick('bow'); audio.play('menu'); }
      if (inp.pressed('up')) this.ui.showQuick('rune');
    }
    // interaction target
    this.currentInteractable = null; this.currentPickup = null;
    if (['ground', 'swim', 'locked'].includes(P.state) && !P.attack && !this.runes.active) {
      let best: Interactable | null = null, bd = Infinity;
      for (const it of this.interactables) {
        if (it.enabled && !it.enabled()) continue;
        const dx = it.pos.x - P.pos.x, dz = it.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d > it.r || Math.abs(it.pos.y - P.pos.y) > 2.6) continue;
        if (d < bd) { bd = d; best = it; }
      }
      const pk = this.pickups.nearest(P.pos, 1.8);
      if (pk && pk.pos.distanceTo(P.pos) < bd) { this.currentPickup = pk; best = null; }
      this.currentInteractable = best;
      if (inp.pressed('interact')) {
        inp.consume('confirm');
        if (best) best.act();
        else if (pk) { if (this.pickups.collect(pk)) P.playOnce('PickUp', 2); }
      }
    }
    // discovery & regions
    this.discoverT -= dt;
    if (this.discoverT <= 0 && !this.inShrine) {
      this.discoverT = 1;
      for (const s of SHRINES) {
        if (!this.state.discoveredShrines[s.id] && Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < 70) {
          this.state.discoveredShrines[s.id] = true;
          this.toast(`Sanctum discovered: ${s.name}`, 0xffa040); audio.play('rune');
        }
      }
      const r = this.regionAt(P.pos);
      if (r !== this.regionName) {
        this.regionT += 1;
        if (this.regionT >= 2) { if (r) this.banner(r, ''); this.regionName = r; this.regionT = 0; }
      } else this.regionT = 0;
    }
    // autosave
    this.autosaveT -= dt;
    if (this.autosaveT <= 0 && P.state === 'ground' && !this.enemies.combatActive() && !this.boss.active) this.autosave();
    // world bounds
    if (!this.inShrine && (Math.abs(P.pos.x) > HALF + 100 || Math.abs(P.pos.z) > HALF + 100)) {
      this.toast('The currents push you back toward the isle.');
      P.respawnSafe();
    }
    // rune hint
    if (this.state.runes.length && !this.shown.has('runehint') && this.runes.selected) { this.shown.add('runehint'); }
    void RUNE_INFO; void LAKE; void SNOW_LINE; void smoothstep; void (null as unknown as WeaponDef);
  }

  private regionAt(p: THREE.Vector3): string {
    if (Math.hypot(p.x - PLATEAU.x, p.z - PLATEAU.z) < PLATEAU.r - 5 && p.y > 60) return 'Dawn Plateau';
    if (Math.hypot(p.x - VILLAGE.x, p.z - VILLAGE.z) < VILLAGE.r) return 'Brookhaven';
    if (Math.hypot(p.x - CITADEL.x, p.z - CITADEL.z) < CITADEL.r) return 'Sunken Citadel';
    if (Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 20) return 'Mirelake';
    const b = this.terrain.biome(p.x, p.z);
    if (b.desert > 0.6) return 'Sunscar Dunes';
    if (b.north > 0.6) return 'Frostpeak Range';
    if (b.forest > 0.7) return 'Whisperwood';
    return this.regionName && !['Dawn Plateau', 'Brookhaven', 'Sunken Citadel', 'Mirelake'].includes(this.regionName) ? this.regionName : '';
  }

  updateDead(dt: number) { this.deadT += dt; }
  tickDead(dt: number) {
    this.deadT += dt;
    if (this.deadT > 2.5 && !this.ui.menuOpen) {
      this.ui.showGameOver(() => { if (this.hasSave()) this.loadGame(); else this.newGame(); });
    }
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
