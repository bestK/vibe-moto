import type { PixelIconId } from '../ui/PixelIcons';

export type WeaponType = 0 | 1 | 2; // 0: Fist/Kick, 1: Spiked Bat, 2: Steel Chain

export type ItemType =
  | 'rpg'
  | 'airstrike'
  | 'sniper'
  | 'police'
  | 'turbo'
  | 'trap'
  | 'magnet'
  | 'banana';

export interface ItemSpec {
  id: ItemType;
  idx: number;
  code: string;
  zhName: string;
  icon: PixelIconId;
  color: string;
  needsTarget: boolean;
}

export const ITEMS: readonly ItemSpec[] = [
  { id: 'rpg', idx: 0, code: 'RPG', zhName: 'RPG 火箭筒', icon: 'item_rpg', color: '#ff4d00', needsTarget: false },
  { id: 'airstrike', idx: 1, code: 'AIR', zhName: '空中支援', icon: 'item_airstrike', color: '#ff0054', needsTarget: false },
  { id: 'sniper', idx: 2, code: 'SNP', zhName: '狙击枪', icon: 'item_sniper', color: '#00f5d4', needsTarget: true },
  { id: 'police', idx: 3, code: 'COP', zhName: '警车拦截', icon: 'item_police', color: '#3a86ff', needsTarget: false },
  { id: 'turbo', idx: 4, code: 'MAX', zhName: '超级加速', icon: 'item_turbo', color: '#ffd166', needsTarget: false },
  { id: 'trap', idx: 5, code: 'TRP', zhName: '路钉陷阱', icon: 'item_trap', color: '#ef233c', needsTarget: false },
  { id: 'magnet', idx: 6, code: 'MAG', zhName: '磁铁', icon: 'item_magnet', color: '#9b5de5', needsTarget: false },
  { id: 'banana', idx: 7, code: 'BAN', zhName: '香蕉皮', icon: 'item_banana', color: '#ffe600', needsTarget: false },
] as const;

export const ITEM_BY_ID: Record<ItemType, ItemSpec> = {
  rpg: ITEMS[0],
  airstrike: ITEMS[1],
  sniper: ITEMS[2],
  police: ITEMS[3],
  turbo: ITEMS[4],
  trap: ITEMS[5],
  magnet: ITEMS[6],
  banana: ITEMS[7],
};

export const MAX_HELD_ITEMS = 4;
export const MULTI_ITEM_TTL = 30.0;

export interface HeldItemSlot {
  type: ItemType;
  ttl: number;
}

export interface ItemNetEvent {
  t: 'item_pick' | 'item_use' | 'item_hit' | 'item_miss';
  from: string;
  fromName: string;
  item: ItemType;
  to?: string;
  toName?: string;
  s: number;
  x: number;
  dmg?: number;
  knockX?: number;
  ko?: boolean;
  seed?: number;
  ts: number;
}

export interface SniperHudState {
  phase: 'selecting' | 'aiming' | 'fired';
  targetId: string | null;
  targetName: string;
  progress: number;
  lockQuality: number;
  result?: 'HIT' | 'DODGED' | 'MISS';
}

export interface WeaponSpec {
  id: WeaponType;
  code: string;
  damage: number;
  reach: number;
  knockback: number;
  cooldown: number;
  duration: number;
}

export const WEAPONS: readonly WeaponSpec[] = [
  { id: 0, code: 'FIST', damage: 24, reach: 2.55, knockback: 9.5, cooldown: 0.34, duration: 0.24 },
  { id: 1, code: 'BAT', damage: 38, reach: 3.15, knockback: 14.5, cooldown: 0.48, duration: 0.32 },
  { id: 2, code: 'CHAIN', damage: 32, reach: 3.65, knockback: 12.5, cooldown: 0.44, duration: 0.30 },
] as const;

export interface BikePalette {
  name: string;
  primary: string;
  secondary: string;
  jacket: string;
  helmet: string;
  visor: string;
  accent: string;
}

export const BIKE_PALETTES: readonly BikePalette[] = [
  { name: 'CRIMSON', primary: '#e63946', secondary: '#1d1e2c', jacket: '#232533', helmet: '#f1faee', visor: '#00f5d4', accent: '#ffb703' },
  { name: 'COBALT', primary: '#2b7fff', secondary: '#141b2d', jacket: '#1c2541', helmet: '#ffd166', visor: '#ff595e', accent: '#00e5ff' },
  { name: 'ACID', primary: '#52e065', secondary: '#18241d', jacket: '#22222b', helmet: '#1a1a24', visor: '#aaff00', accent: '#ffdd00' },
  { name: 'AMBER', primary: '#ff9f1c', secondary: '#261a14', jacket: '#2b1e19', helmet: '#fff3e0', visor: '#ff2a6d', accent: '#ffe66d' },
  { name: 'VIOLET', primary: '#9b5de5', secondary: '#1b1429', jacket: '#251a38', helmet: '#f8f7ff', visor: '#00f5d4', accent: '#f15bb5' },
  { name: 'CYAN', primary: '#00bbf9', secondary: '#10202b', jacket: '#172530', helmet: '#ff4d6d', visor: '#ffe66d', accent: '#72efdd' },
  { name: 'PEARL', primary: '#edf2f4', secondary: '#2b2d42', jacket: '#d90429', helmet: '#1a1b26', visor: '#ffbe0b', accent: '#ef233c' },
  { name: 'MAGMA', primary: '#ff4d00', secondary: '#211515', jacket: '#1e1b1e', helmet: '#ffbe0b', visor: '#3a86ff', accent: '#fff07c' },
] as const;

export const BOT_PALETTE: BikePalette = {
  name: 'BOT',
  primary: '#8d99ae',
  secondary: '#2b2d42',
  jacket: '#3d405b',
  helmet: '#edf2f4',
  visor: '#ef233c',
  accent: '#ffd166',
};

export interface RiderRenderState {
  id: string;
  name: string;
  isLocal: boolean;
  isBot: boolean;
  colorIdx: number;
  avatarIdx: number;
  s: number;
  x: number;
  y: number;
  speed: number;
  vx: number;
  lean: number;
  hp: number;
  nitro: number;
  weapon: WeaponType;
  attackSide: 0 | 1 | 2; // 0 none, 1 left, 2 right
  attackPhase: number; // 0..1
  nitroActive: boolean;
  wheelie: number; // 0..1
  crashed: boolean;
  crashTimer: number;
  braking: boolean;
  invulnTimer: number;
  wheelAngle: number;
  kos: number;
  heldItem: ItemType | null;
  heldItems: HeldItemSlot[];
  wheelieCharge: number;
  magnetTimer: number;
  turboShieldTimer: number;
  spinOutTimer: number;
  incomingLockName: string | null;
  deliveryRole?: 'meituan' | 'eleme' | null;
  enraged?: boolean;
  enragedTargetId?: string | null;
}

export interface CombatHitEvent {
  t: 'hit';
  from: string;
  fromName: string;
  to: string;
  dmg: number;
  side: 1 | 2;
  weapon: WeaponType;
  knockX: number;
  ko: boolean;
  s: number;
  x: number;
  ts: number;
}

export interface TrafficCar {
  id: number;
  lane: number;
  s: number;
  x: number;
  speed: number;
  type: 0 | 1 | 2 | 3 | 4; // 0 sedan, 1 muscle, 2 pickup, 3 police, 4 overloaded cargo truck
  colorIdx: number;
  bumpOffset: number;
  bumpVel: number;
  honked: boolean;
  nearMissed: boolean;
  cargoStyle?: number; // 0 tarp, 1 timber logs, 2 melon crates
  spinTimer?: number;
  slowTimer?: number;
  hitTilt?: number;
  cargoDropped?: boolean;
}

export interface FallenCargo {
  active: boolean;
  s: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  vs: number;
  life: number;
  colorIdx: number;
}
