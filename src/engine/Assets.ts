import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonify } from './Materials';

const BASE = import.meta.env.BASE_URL + 'models/';

export const CHARACTERS = ['Rogue_Hooded', 'Mage', 'Knight', 'Barbarian', 'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage'] as const;
export type CharName = typeof CHARACTERS[number];
export const ITEMS = ['sword_1handed', 'sword_2handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand', 'shield_round', 'shield_square', 'shield_badge', 'shield_spikes', 'shield_round_barbarian', 'crossbow_1handed', 'crossbow_2handed', 'arrow', 'quiver', 'mug_full', 'spellbook_closed', 'Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Large_A', 'Skeleton_Crossbow', 'Skeleton_Arrow'] as const;
export type ItemModel = typeof ITEMS[number];

class AssetStore {
  chars = new Map<string, THREE.Object3D>();
  items = new Map<string, THREE.Object3D>();
  clips: THREE.AnimationClip[] = [];
  private loader = new GLTFLoader();
  constructor() { this.loader.setMeshoptDecoder(MeshoptDecoder); }

  async loadAll(onProgress: (f: number) => void) {
    const jobs: [string, (g: any) => void][] = [];
    jobs.push(['anims.glb', (g) => { this.clips = g.animations; }]);
    for (const c of CHARACTERS) jobs.push([c + '.glb', (g) => {
      const root = g.scene as THREE.Object3D;
      toonify(root, 0.35);
      this.chars.set(c, root);
    }]);
    for (const it of ITEMS) jobs.push(['items/' + it + '.glb', (g) => {
      const root = g.scene as THREE.Object3D;
      toonify(root, 0.3);
      this.items.set(it, root);
    }]);
    let done = 0;
    await Promise.all(jobs.map(([url, cb]) => this.loader.loadAsync(BASE + url).then((g) => { cb(g); done++; onProgress(done / jobs.length); })));
  }

  /** clone a skinned character; hides all attached accessory meshes */
  character(name: CharName): THREE.Object3D {
    const src = this.chars.get(name)!;
    const o = SkeletonUtils.clone(src);
    o.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh && !(m as any).isSkinnedMesh) {
        // accessories parented to handslots: hide (we attach our own)
        const p = m.parent?.name || '';
        if (/handslot/.test(p)) m.visible = false;
      }
      if ((m as any).isSkinnedMesh) m.frustumCulled = false;
    });
    return o;
  }

  item(name: ItemModel): THREE.Object3D {
    const src = this.items.get(name)!;
    return src.clone(true);
  }

  clip(name: string): THREE.AnimationClip | undefined {
    return this.clips.find((c) => c.name === name);
  }
}

export const assets = new AssetStore();

export function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let f: THREE.Object3D | null = null;
  root.traverse((n) => { if (!f && n.name === name) f = n; });
  return f;
}

/** Simple animation controller with cross-fading */
export class Animator {
  mixer: THREE.AnimationMixer;
  current: THREE.AnimationAction | null = null;
  currentName = '';
  private actions = new Map<string, THREE.AnimationAction>();
  constructor(public root: THREE.Object3D) { this.mixer = new THREE.AnimationMixer(root); }
  action(name: string): THREE.AnimationAction | null {
    let a = this.actions.get(name);
    if (!a) {
      const c = assets.clip(name); if (!c) return null;
      a = this.mixer.clipAction(c); this.actions.set(name, a);
    }
    return a;
  }
  play(name: string, opts: { fade?: number; loop?: boolean; speed?: number; restart?: boolean; clamp?: boolean } = {}) {
    const fade = opts.fade ?? 0.15;
    if (this.currentName === name && !opts.restart) { if (this.current && opts.speed) this.current.timeScale = opts.speed; return this.current; }
    const a = this.action(name); if (!a) return null;
    a.reset();
    a.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = opts.clamp ?? opts.loop === false;
    a.timeScale = opts.speed ?? 1;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
    a.play();
    this.current = a; this.currentName = name;
    return a;
  }
  /** normalized progress of current one-shot */
  progress(): number {
    if (!this.current) return 1;
    const d = this.current.getClip().duration;
    return Math.min(1, this.current.time / d);
  }
  duration(name: string) { return assets.clip(name)?.duration ?? 1; }
  update(dt: number) { this.mixer.update(dt); }
}
