// World layout: all named locations. x = east, z = south. World spans [-HALF, HALF].

export const WORLD_SIZE = 1536;
export const HALF = WORLD_SIZE / 2;
export const GRID = 1024; // cells per side
export const CELL = WORLD_SIZE / GRID; // 1.5 m
export const SEA_LEVEL = 0;
export const SNOW_LINE = 150;

export interface Site { x: number; z: number; r: number; h?: number; }

export const PLATEAU = { x: -360, z: 330, r: 125, top: 92 };
export const LAKE = { x: 170, z: -40, r: 105 };
export const CITADEL = { x: 60, z: 110, r: 80, top: 78 };
export const VILLAGE = { x: -80, z: -120, r: 45 };

export type ShrineKind = 'bomb' | 'magnet' | 'stasis' | 'ice' | 'combat' | 'wind';
export interface ShrineDef { id: number; name: string; kind: ShrineKind; x: number; z: number; }

// four plateau shrines grant runes; two more out in the world
export const SHRINES: ShrineDef[] = [
  { id: 0, name: 'Ember Sanctum', kind: 'bomb', x: -400, z: 280 },
  { id: 1, name: 'Lodestone Sanctum', kind: 'magnet', x: -300, z: 380 },
  { id: 2, name: 'Stillwater Sanctum', kind: 'stasis', x: -430, z: 380 },
  { id: 3, name: 'Rime Sanctum', kind: 'ice', x: -310, z: 270 },
  { id: 4, name: 'Trial of Blades', kind: 'combat', x: -470, z: -260 },
  { id: 5, name: 'Trial of Winds', kind: 'wind', x: 230, z: -380 },
];

export interface TowerDef { id: number; name: string; x: number; z: number; region: [number, number, number, number]; }
// region = minx, minz, maxx, maxz revealed on the map
export const TOWERS: TowerDef[] = [
  { id: 0, name: 'Dawn Spire', x: -360, z: 330, region: [-768, 0, 0, 768] },
  { id: 1, name: 'Frostpeak Spire', x: 200, z: -300, region: [0, -768, 768, 0] },
  { id: 2, name: 'Sunscar Spire', x: 360, z: 330, region: [0, 0, 768, 768] },
  { id: 3, name: 'Whisperwood Spire', x: -360, z: -200, region: [-768, -768, 0, 0] },
];

export interface CampDef { id: number; x: number; z: number; kinds: ('minion' | 'warrior' | 'rogue' | 'mage')[]; }
export const CAMPS: CampDef[] = [
  { id: 0, x: -170, z: 250, kinds: ['minion', 'minion', 'rogue'] },
  { id: 1, x: -230, z: 60, kinds: ['minion', 'warrior', 'minion'] },
  { id: 2, x: 120, z: 300, kinds: ['minion', 'rogue', 'mage'] },
  { id: 3, x: 330, z: 140, kinds: ['warrior', 'minion', 'rogue', 'minion'] },
  { id: 4, x: -300, z: -330, kinds: ['warrior', 'mage', 'minion'] },
  { id: 5, x: 20, z: -260, kinds: ['minion', 'minion', 'rogue', 'warrior'] },
  { id: 6, x: 430, z: -120, kinds: ['warrior', 'warrior', 'mage'] },
  { id: 7, x: 480, z: 420, kinds: ['rogue', 'rogue', 'minion', 'mage'] },
  { id: 8, x: -60, z: 420, kinds: ['minion', 'warrior'] },
];

// Places that need flattened ground
export function flatSites(): Site[] {
  const s: Site[] = [];
  for (const t of TOWERS) if (t.id !== 0) s.push({ x: t.x, z: t.z, r: 14 });
  for (const sh of SHRINES) s.push({ x: sh.x, z: sh.z, r: 9 });
  for (const c of CAMPS) s.push({ x: c.x, z: c.z, r: 20 });
  s.push({ x: VILLAGE.x, z: VILLAGE.z, r: VILLAGE.r });
  return s;
}

export const START_POS = { x: -395, z: 345 };
export const HERMIT_POS = { x: -372, z: 352 };
export const STATUE_POS = { x: -100, z: -100 };
