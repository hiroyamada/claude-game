import { itemDef, type Meal, type WeaponDef, type ShieldDef, type BowDef } from './Items';

export interface GearSlot { id: string; dur: number; }

export class Inventory {
  weapons: GearSlot[] = [];
  shields: GearSlot[] = [];
  bows: GearSlot[] = [];
  materials: Record<string, number> = {};
  meals: Meal[] = [];
  keys: Record<string, number> = {};
  equipped = { weapon: -1, shield: -1, bow: -1 };
  gems = 0;
  maxWeapons = 8; maxShields = 5; maxBows = 4;
  onChange?: () => void;

  addGear(id: string): boolean {
    const d = itemDef(id);
    const list = d.kind === 'weapon' ? this.weapons : d.kind === 'shield' ? this.shields : this.bows;
    const max = d.kind === 'weapon' ? this.maxWeapons : d.kind === 'shield' ? this.maxShields : this.maxBows;
    if (list.length >= max) return false;
    list.push({ id, dur: (d as WeaponDef | ShieldDef | BowDef).durability });
    const k = d.kind as 'weapon' | 'shield' | 'bow';
    if (this.equipped[k] < 0) this.equipped[k] = list.length - 1;
    this.onChange?.();
    return true;
  }
  add(id: string, n = 1): boolean {
    const d = itemDef(id);
    if (!d) return false;
    if (d.kind === 'weapon' || d.kind === 'shield' || d.kind === 'bow') return this.addGear(id);
    if (d.kind === 'key') { this.keys[id] = (this.keys[id] || 0) + n; this.onChange?.(); return true; }
    this.materials[id] = Math.min(999, (this.materials[id] || 0) + n);
    this.onChange?.();
    return true;
  }
  remove(id: string, n = 1) {
    if (this.keys[id] !== undefined) { this.keys[id] = Math.max(0, this.keys[id] - n); }
    else { this.materials[id] = Math.max(0, (this.materials[id] || 0) - n); if (!this.materials[id]) delete this.materials[id]; }
    this.onChange?.();
  }
  count(id: string) { return this.materials[id] || this.keys[id] || 0; }
  has(id: string) { return this.count(id) > 0; }

  weapon(): WeaponDef | null { const s = this.weapons[this.equipped.weapon]; return s ? (itemDef(s.id) as WeaponDef) : null; }
  shield(): ShieldDef | null { const s = this.shields[this.equipped.shield]; return s ? (itemDef(s.id) as ShieldDef) : null; }
  bow(): BowDef | null { const s = this.bows[this.equipped.bow]; return s ? (itemDef(s.id) as BowDef) : null; }

  /** wear equipped gear; returns true if it broke */
  wear(kind: 'weapon' | 'shield' | 'bow', amt = 1): boolean {
    const list = kind === 'weapon' ? this.weapons : kind === 'shield' ? this.shields : this.bows;
    const idx = this.equipped[kind];
    const s = list[idx]; if (!s) return false;
    s.dur -= amt;
    if (s.dur <= 0) {
      list.splice(idx, 1);
      this.equipped[kind] = -1;
      this.onChange?.();
      return true;
    }
    return false;
  }
  drop(kind: 'weapon' | 'shield' | 'bow', idx: number): string | null {
    const list = kind === 'weapon' ? this.weapons : kind === 'shield' ? this.shields : this.bows;
    const s = list[idx]; if (!s) return null;
    list.splice(idx, 1);
    if (this.equipped[kind] === idx) this.equipped[kind] = -1;
    else if (this.equipped[kind] > idx) this.equipped[kind]--;
    this.onChange?.();
    return s.id;
  }
  cycle(kind: 'weapon' | 'shield' | 'bow', dir = 1) {
    const list = kind === 'weapon' ? this.weapons : kind === 'shield' ? this.shields : this.bows;
    if (!list.length) return;
    const n = list.length + 1; // include "none"
    let i = this.equipped[kind] + 1;
    i = (((i + dir) % n) + n) % n;
    this.equipped[kind] = i - 1;
    this.onChange?.();
  }

  serialize() {
    return { weapons: this.weapons, shields: this.shields, bows: this.bows, materials: this.materials, meals: this.meals, keys: this.keys, equipped: this.equipped, gems: this.gems };
  }
  load(d: any) {
    Object.assign(this, { weapons: d.weapons || [], shields: d.shields || [], bows: d.bows || [], materials: d.materials || {}, meals: d.meals || [], keys: d.keys || {}, equipped: d.equipped || { weapon: -1, shield: -1, bow: -1 }, gems: d.gems || 0 });
    this.onChange?.();
  }
}
