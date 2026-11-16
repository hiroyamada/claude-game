import type { ItemModel } from '../engine/Assets';

export type WeaponType = 'one' | 'two' | 'spear';
export interface WeaponDef { id: string; name: string; kind: 'weapon'; type: WeaponType; power: number; durability: number; model: ItemModel; tint?: number; desc: string; element?: 'fire'; }
export interface ShieldDef { id: string; name: string; kind: 'shield'; guard: number; durability: number; model: ItemModel; tint?: number; desc: string; }
export interface BowDef { id: string; name: string; kind: 'bow'; power: number; durability: number; model: ItemModel; multi?: number; tint?: number; desc: string; }
export type EffectKind = 'none' | 'stamina' | 'warm' | 'attack' | 'defense' | 'speed' | 'hearty';
export interface MaterialDef { id: string; name: string; kind: 'material'; hearts: number; effect: EffectKind; potency: number; color: number; desc: string; edible: boolean; value: number; }
export interface KeyDef { id: string; name: string; kind: 'key'; desc: string; }
export type ItemDef = WeaponDef | ShieldDef | BowDef | MaterialDef | KeyDef;

export const WEAPONS: WeaponDef[] = [
  { id: 'twig', name: 'Gnarled Branch', kind: 'weapon', type: 'one', power: 2, durability: 6, model: 'wand', tint: 0x8a6a40, desc: 'A sturdy branch. Better than bare fists.' },
  { id: 'rustsword', name: 'Weathered Sword', kind: 'weapon', type: 'one', power: 5, durability: 14, model: 'sword_1handed', tint: 0xb08a6a, desc: 'An old traveler\'s blade, pitted with rust.' },
  { id: 'knightsword', name: 'Warden\'s Sword', kind: 'weapon', type: 'one', power: 12, durability: 30, model: 'sword_1handed', desc: 'Standard issue for the old isle wardens.' },
  { id: 'dagger', name: 'Swift Dagger', kind: 'weapon', type: 'one', power: 7, durability: 22, model: 'dagger', desc: 'Light and quick.' },
  { id: 'axe', name: 'Woodsman\'s Axe', kind: 'weapon', type: 'one', power: 9, durability: 25, model: 'axe_1handed', desc: 'Good for chopping. And other things.' },
  { id: 'boneblade', name: 'Bone Cleaver', kind: 'weapon', type: 'one', power: 8, durability: 16, model: 'Skeleton_Blade', desc: 'Crude, but it bites.' },
  { id: 'boneaxe', name: 'Bone Hatchet', kind: 'weapon', type: 'one', power: 10, durability: 18, model: 'Skeleton_Axe', desc: 'Carried by restless warriors.' },
  { id: 'greatsword', name: 'Ironwood Greatsword', kind: 'weapon', type: 'two', power: 22, durability: 30, model: 'sword_2handed', desc: 'Heavy two-handed sword. Hold attack to charge a spin.' },
  { id: 'greataxe', name: 'Splitting Maul', kind: 'weapon', type: 'two', power: 26, durability: 25, model: 'axe_2handed', desc: 'Massive damage, slow swings.' },
  { id: 'emberstaff', name: 'Ember Staff', kind: 'weapon', type: 'spear', power: 10, durability: 20, model: 'staff', element: 'fire', desc: 'Each swing hurls a small flame.' },
  { id: 'royalsword', name: 'Dawnbreaker', kind: 'weapon', type: 'one', power: 30, durability: 45, model: 'sword_1handed', tint: 0xffe08a, desc: 'A legendary blade of the first wardens.' },
];
export const SHIELDS: ShieldDef[] = [
  { id: 'potlid', name: 'Battered Buckler', kind: 'shield', guard: 3, durability: 10, model: 'shield_round', tint: 0xa08060, desc: 'Barely a shield.' },
  { id: 'roundshield', name: 'Traveler\'s Shield', kind: 'shield', guard: 8, durability: 20, model: 'shield_round_barbarian', desc: 'A dependable wooden shield.' },
  { id: 'kiteshield', name: 'Warden\'s Shield', kind: 'shield', guard: 15, durability: 35, model: 'shield_badge', desc: 'Bears the crest of the isle wardens.' },
  { id: 'boneshield', name: 'Bone Shield', kind: 'shield', guard: 9, durability: 18, model: 'Skeleton_Shield_Small_A', desc: 'Made from... best not to ask.' },
  { id: 'spikeshield', name: 'Thorned Shield', kind: 'shield', guard: 20, durability: 30, model: 'shield_spikes', desc: 'Heavy and spiked.' },
];
export const BOWS: BowDef[] = [
  { id: 'crossbow', name: 'Hunter\'s Crossbow', kind: 'bow', power: 6, durability: 25, model: 'crossbow_1handed', desc: 'Fires bolts in a gentle arc.' },
  { id: 'bonecrossbow', name: 'Bone Crossbow', kind: 'bow', power: 9, durability: 20, model: 'Skeleton_Crossbow', desc: 'Taken from a skeleton archer.' },
  { id: 'heavycrossbow', name: 'Arbalest', kind: 'bow', power: 14, durability: 30, model: 'crossbow_2handed', multi: 3, desc: 'Fires three bolts at once.' },
];
export const MATERIALS: MaterialDef[] = [
  { id: 'apple', name: 'Sunapple', kind: 'material', hearts: 1, effect: 'none', potency: 0, color: 0xe0402a, edible: true, value: 3, desc: 'Sweet and crisp. Restores a little health.' },
  { id: 'mushroom', name: 'Glowcap', kind: 'material', hearts: 1, effect: 'stamina', potency: 1, color: 0x63d3e0, edible: true, value: 5, desc: 'A softly glowing mushroom. Restores stamina when cooked.' },
  { id: 'pepper', name: 'Emberpepper', kind: 'material', hearts: 1, effect: 'warm', potency: 1, color: 0xff6020, edible: true, value: 5, desc: 'Fiery! Cooked, it keeps you warm in the cold.' },
  { id: 'herb', name: 'Vigor Herb', kind: 'material', hearts: 2, effect: 'hearty', potency: 1, color: 0x7fe060, edible: true, value: 8, desc: 'A potent healing herb. Cooked, it can grant extra hearts.' },
  { id: 'meat', name: 'Wild Meat', kind: 'material', hearts: 2, effect: 'none', potency: 0, color: 0xc0504a, edible: true, value: 6, desc: 'Hearty meat. Much better cooked.' },
  { id: 'shroom_red', name: 'Ironcap', kind: 'material', hearts: 1, effect: 'defense', potency: 1, color: 0x8a7a6a, edible: true, value: 6, desc: 'Tough mushroom. Cooked, it raises defense.' },
  { id: 'banana', name: 'Brawn Fruit', kind: 'material', hearts: 1, effect: 'attack', potency: 1, color: 0xf2d040, edible: true, value: 6, desc: 'Tropical fruit. Cooked, it raises attack power.' },
  { id: 'feather', name: 'Swiftfeather', kind: 'material', hearts: 0, effect: 'speed', potency: 1, color: 0xb0e0ff, edible: false, value: 6, desc: 'Cooked with food, makes you move faster.' },
  { id: 'bone', name: 'Bone Shard', kind: 'material', hearts: 0, effect: 'none', potency: 0, color: 0xe8e0c8, edible: false, value: 4, desc: 'Dropped by restless skeletons.' },
  { id: 'ember', name: 'Ember Dust', kind: 'material', hearts: 0, effect: 'warm', potency: 2, color: 0xff8030, edible: false, value: 12, desc: 'Warm to the touch. Strong when cooked.' },
  { id: 'ore', name: 'Starstone', kind: 'material', hearts: 0, effect: 'none', potency: 0, color: 0x9ad0ff, edible: false, value: 25, desc: 'A sparkling ore. Valuable.' },
  { id: 'arrow', name: 'Bolt', kind: 'material', hearts: 0, effect: 'none', potency: 0, color: 0xc8b090, edible: false, value: 1, desc: 'Crossbow ammunition.' },
];
export const KEYS: KeyDef[] = [
  { id: 'glider', name: 'Windsail', kind: 'key', desc: 'A cloth glider. Press jump in midair to glide.' },
  { id: 'orb', name: 'Spirit Orb', kind: 'key', desc: 'Earned in sanctums. Offer them at a Goddess Statue.' },
  { id: 'slate', name: 'Wayfinder Stone', kind: 'key', desc: 'An ancient stone tablet that grants powers called runes.' },
];

export const ALL_ITEMS: Record<string, ItemDef> = {};
for (const l of [WEAPONS, SHIELDS, BOWS, MATERIALS, KEYS] as ItemDef[][]) for (const d of l) ALL_ITEMS[d.id] = d;

export function itemDef(id: string): ItemDef { return ALL_ITEMS[id]; }

export interface Meal { id: string; name: string; hearts: number; effect: EffectKind; level: number; duration: number; color: number; desc: string; }

export function cook(ids: string[]): Meal {
  const defs = ids.map((i) => ALL_ITEMS[i] as MaterialDef);
  const edible = defs.filter((d) => d.edible);
  if (edible.length === 0) {
    return { id: 'dubious', name: 'Dubious Food', hearts: 1, effect: 'none', level: 0, duration: 0, color: 0x6a5a4a, desc: 'It... is technically food.' };
  }
  let hearts = 0; const eff: Record<string, number> = {};
  for (const d of defs) { hearts += d.hearts * 4; if (d.effect !== 'none') eff[d.effect] = (eff[d.effect] || 0) + d.potency; }
  const effects = Object.keys(eff);
  let effect: EffectKind = 'none'; let level = 0;
  if (effects.length === 1) { effect = effects[0] as EffectKind; level = Math.min(3, Math.ceil(eff[effect] / 2) || 1); }
  else if (effects.length > 1) { effect = 'none'; } // effects cancel
  const main = edible.sort((a, b) => b.hearts - a.hearts)[0];
  const effName: Record<EffectKind, string> = { none: '', stamina: 'Energizing', warm: 'Spicy', attack: 'Mighty', defense: 'Tough', speed: 'Hasty', hearty: 'Hearty' };
  const base = edible.length >= 3 ? 'Feast' : main.id === 'meat' ? 'Skewer' : main.id.includes('shroom') || main.id === 'mushroom' ? 'Mushroom Stew' : main.id === 'apple' || main.id === 'banana' ? 'Fruit Bake' : 'Saute';
  const name = (effName[effect] ? effName[effect] + ' ' : '') + (main.id === 'meat' && base === 'Skewer' ? 'Meat Skewer' : base);
  const duration = effect === 'none' || effect === 'stamina' || effect === 'hearty' ? 0 : 60 + 30 * defs.length;
  const descs: Record<EffectKind, string> = {
    none: 'A tasty dish.', stamina: 'Restores stamina.', warm: 'Keeps you warm in the cold.', attack: 'Raises attack power.',
    defense: 'Raises defense.', speed: 'Increases movement speed.', hearty: 'Fully heals and adds temporary hearts.',
  };
  return { id: 'meal', name, hearts: Math.min(80, hearts), effect, level, duration, color: main.color, desc: descs[effect] };
}
