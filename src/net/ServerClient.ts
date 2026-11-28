import type { BlockType } from '../game/VoxelWorld';
import type { ItemType } from '../game/types';
import {
  sanitizeCustomSkin,
  type CustomAvatarSkin,
  type SavedCustomAvatar,
} from '../game/CustomAvatarSystem';

export const DEFAULT_SERVER_URL = 'https://moto.linkof.link';
const STORAGE_SERVER_URL_KEY = 'vibemoto_server_url';
const STORAGE_AUTH_TOKEN_KEY = 'vibemoto_auth_token';
const STORAGE_AUTH_ACCOUNT_KEY = 'vibemoto_auth_account';
const STORAGE_GUEST_ECONOMY_KEY = 'vibemoto_guest_economy_v1';
const STORAGE_GUEST_BLUEPRINTS_KEY = 'vibemoto_guest_blueprints_v1';
const STORAGE_GUEST_MARKERS_KEY = 'vibemoto_guest_markers_v1';
const STORAGE_GUEST_AVATARS_KEY = 'vibemoto_guest_avatars_v1';
const STORAGE_GUEST_ACTIVE_AVATAR_KEY = 'vibemoto_guest_active_avatar_v1';

export type VoxelBlockId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface BlockCatalogEntry {
  id: VoxelBlockId;
  code: string;
  zhName: string;
  enName: string;
  colorHex: string;
}

export const BLOCK_CATALOG: readonly BlockCatalogEntry[] = [
  { id: 1, code: 'GRASS', zhName: '草方块', enName: 'GRASS', colorHex: '#5ab552' },
  { id: 2, code: 'STONE', zhName: '圆石', enName: 'STONE', colorHex: '#8b95a5' },
  { id: 3, code: 'WOOD', zhName: '木板', enName: 'PLANKS', colorHex: '#c89252' },
  { id: 4, code: 'BRICK', zhName: '红砖', enName: 'BRICK', colorHex: '#c2543e' },
  { id: 5, code: 'LOG', zhName: '原木', enName: 'LOG', colorHex: '#6f4b2d' },
  { id: 6, code: 'LEAF', zhName: '树叶', enName: 'LEAVES', colorHex: '#3b9445' },
  { id: 7, code: 'GLASS', zhName: '玻璃', enName: 'GLASS', colorHex: '#7de8ff' },
  { id: 8, code: 'GLOW', zhName: '霓虹块', enName: 'NEON', colorHex: '#ffd166' },
  { id: 9, code: 'ROAD', zhName: '赛道砖', enName: 'ASPHALT', colorHex: '#3b4359' },
  { id: 10, code: 'PC', zhName: '电脑终端', enName: 'COMPUTER', colorHex: '#38e2d4' },
] as const;

export function getBlockCatalogEntry(id: number): BlockCatalogEntry {
  for (let i = 0; i < BLOCK_CATALOG.length; i++) {
    if (BLOCK_CATALOG[i].id === id) return BLOCK_CATALOG[i];
  }
  return BLOCK_CATALOG[0];
}

export const VALID_ITEM_TYPES: readonly ItemType[] = [
  'rpg',
  'airstrike',
  'sniper',
  'police',
  'turbo',
  'trap',
  'magnet',
  'banana',
] as const;

export function isValidItemType(val: unknown): val is ItemType {
  return typeof val === 'string' && (VALID_ITEM_TYPES as readonly string[]).includes(val);
}

export interface ShopItemSpec {
  id: string;
  kind: 'block' | 'bag' | 'shield' | 'teleport';
  blockType?: number;
  qty?: number;
  price: number;
  zhName: string;
  enName: string;
  durationSec?: number;
}

export interface EconomyState {
  coins: number;
  inventory: Record<number, number>;
  caps: Record<number, number>;
  bagCapacity: number;
  savedItems: ItemType[];
  shieldUntil: number;
  teleportCards: number;
  shop: ShopItemSpec[];
}

export interface MapMarker {
  id: string;
  name: string;
  wx: number;
  wy: number;
  ws: number;
  color: string;
  createdAt: number;
}

export interface IntruderRecord {
  id: string;
  room: string;
  ownerId: string;
  intruderAccountId?: string;
  intruderClientId?: string;
  intruderName: string;
  gx: number;
  gy: number;
  gz: number;
  blockType: number;
  action: string;
  createdAt: number;
  liveWx?: number;
  liveWy?: number;
  liveWs?: number;
  online?: boolean;
  lastSeen?: number;
}

export interface MapOnlinePlayer {
  id: string;
  accountId?: string;
  name: string;
  wx: number;
  wy: number;
  ws: number;
  onFoot?: boolean;
}

export interface MarketListing {
  id: string;
  sellerId: string;
  sellerName: string;
  blockType: number;
  qty: number;
  priceCoins: number;
  createdAt: number;
}

export interface BlueprintBlock {
  dx: number;
  dy: number;
  dz: number;
  b: number;
}

export interface ServerBlueprint {
  id: string;
  name: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  blocks: BlueprintBlock[];
  createdAt: number;
}

export const DEFAULT_MATERIAL_CAPS: Readonly<Record<number, number>> = {
  1: 99,
  2: 99,
  3: 99,
  4: 99,
  5: 99,
  6: 99,
  7: 60,
  8: 60,
  9: 60,
  10: 5,
};

export const DEFAULT_STARTER_INVENTORY: Readonly<Record<number, number>> = {
  1: 20,
  2: 20,
  3: 30,
  4: 15,
  5: 15,
  6: 15,
  7: 10,
  8: 8,
  9: 15,
  10: 1,
};

export const DEFAULT_SHOP_ITEMS: readonly ShopItemSpec[] = [
  { id: 'block_1', kind: 'block', blockType: 1, qty: 10, price: 30, zhName: '草方块 x10', enName: 'Grass x10' },
  { id: 'block_2', kind: 'block', blockType: 2, qty: 10, price: 40, zhName: '圆石 x10', enName: 'Stone x10' },
  { id: 'block_3', kind: 'block', blockType: 3, qty: 10, price: 35, zhName: '木板 x10', enName: 'Planks x10' },
  { id: 'block_4', kind: 'block', blockType: 4, qty: 10, price: 50, zhName: '红砖 x10', enName: 'Brick x10' },
  { id: 'block_5', kind: 'block', blockType: 5, qty: 10, price: 45, zhName: '原木 x10', enName: 'Log x10' },
  { id: 'block_6', kind: 'block', blockType: 6, qty: 10, price: 30, zhName: '树叶 x10', enName: 'Leaves x10' },
  { id: 'block_7', kind: 'block', blockType: 7, qty: 8, price: 60, zhName: '玻璃 x8', enName: 'Glass x8' },
  { id: 'block_8', kind: 'block', blockType: 8, qty: 6, price: 90, zhName: '霓虹块 x6', enName: 'Neon x6' },
  { id: 'block_9', kind: 'block', blockType: 9, qty: 10, price: 70, zhName: '赛道砖 x10', enName: 'Asphalt x10' },
  { id: 'block_10', kind: 'block', blockType: 10, qty: 1, price: 220, zhName: '电脑终端 x1', enName: 'Computer x1' },
  { id: 'item_bag', kind: 'bag', qty: 3, price: 300, zhName: '道具袋 (+3格)', enName: 'Item Bag (+3)' },
  { id: 'shield_10m', kind: 'shield', durationSec: 600, price: 250, zhName: '建筑防护盾 (+10分钟)', enName: 'Shield (+10m)' },
  { id: 'shield_30m', kind: 'shield', durationSec: 1800, price: 600, zhName: '建筑防护盾 (+30分钟)', enName: 'Shield (+30m)' },
  { id: 'teleport_card', kind: 'teleport', qty: 1, price: 120, zhName: '传送卡 (x1)', enName: 'Teleport Card (x1)' },
  { id: 'teleport_pack3', kind: 'teleport', qty: 3, price: 300, zhName: '传送卡礼包 (x3)', enName: 'Teleport Pack (x3)' },
];

export function createDefaultEconomyState(): EconomyState {
  const inventory: Record<number, number> = {};
  const caps: Record<number, number> = {};
  for (let b = 1; b <= 10; b++) {
    inventory[b] = DEFAULT_STARTER_INVENTORY[b] ?? 0;
    caps[b] = DEFAULT_MATERIAL_CAPS[b] ?? 99;
  }
  return {
    coins: 500,
    inventory,
    caps,
    bagCapacity: 0,
    savedItems: [],
    shieldUntil: 0,
    teleportCards: 1,
    shop: DEFAULT_SHOP_ITEMS.map((item) => ({ ...item })),
  };
}

export function normalizeEconomyState(raw: unknown): EconomyState {
  const def = createDefaultEconomyState();
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Record<string, unknown>;
  const src =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;

  const caps: Record<number, number> = { ...def.caps };
  if (src.caps && typeof src.caps === 'object') {
    const rawCaps = src.caps as Record<string, unknown>;
    for (let b = 1; b <= 10; b++) {
      const v = Number(rawCaps[String(b)]);
      if (Number.isFinite(v) && v > 0) caps[b] = Math.floor(v);
    }
  }

  const inventory: Record<number, number> = {};
  const rawInv =
    src.inventory && typeof src.inventory === 'object'
      ? (src.inventory as Record<string, unknown>)
      : null;
  for (let b = 1; b <= 10; b++) {
    if (rawInv && rawInv[String(b)] !== undefined) {
      const v = Number(rawInv[String(b)]);
      inventory[b] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    } else {
      inventory[b] = def.inventory[b] ?? 0;
    }
  }

  const savedItems: ItemType[] = [];
  if (Array.isArray(src.savedItems)) {
    for (const entry of src.savedItems) {
      if (isValidItemType(entry)) savedItems.push(entry);
    }
  }

  let shop: ShopItemSpec[] = def.shop;
  if (Array.isArray(src.shop) && src.shop.length > 0) {
    const parsed: ShopItemSpec[] = [];
    for (const s of src.shop) {
      if (!s || typeof s !== 'object') continue;
      const item = s as Record<string, unknown>;
      const kind = item.kind;
      if (kind !== 'block' && kind !== 'bag' && kind !== 'shield' && kind !== 'teleport') continue;
      const rawZh = String(item.zhName || item.id || '');
      parsed.push({
        id: String(item.id || ''),
        kind,
        blockType: item.blockType !== undefined ? Number(item.blockType) : undefined,
        qty: item.qty !== undefined ? Number(item.qty) : undefined,
        price: Math.max(0, Math.floor(Number(item.price) || 0)),
        zhName: rawZh,
        enName: String(item.enName || rawZh || item.id || ''),
        durationSec: item.durationSec !== undefined ? Number(item.durationSec) : undefined,
      });
    }
    if (parsed.length > 0) {
      const hasTeleport = parsed.some((p) => p.kind === 'teleport');
      if (!hasTeleport) {
        for (const tp of DEFAULT_SHOP_ITEMS) {
          if (tp.kind === 'teleport') parsed.push({ ...tp });
        }
      }
      shop = parsed;
    }
  }

  const coins = Number(src.coins);
  const bagCapacity = Number(src.bagCapacity);
  const shieldUntil = Number(src.shieldUntil);
  const teleportCards = Number(src.teleportCards);

  return {
    coins: Number.isFinite(coins) ? Math.max(0, Math.floor(coins)) : def.coins,
    inventory,
    caps,
    bagCapacity: Number.isFinite(bagCapacity) ? Math.max(0, Math.min(12, Math.floor(bagCapacity))) : 0,
    savedItems,
    shieldUntil: Number.isFinite(shieldUntil) ? Math.max(0, Math.floor(shieldUntil)) : 0,
    teleportCards: Number.isFinite(teleportCards)
      ? Math.max(0, Math.min(999, Math.floor(teleportCards)))
      : def.teleportCards,
    shop,
  };
}

export function getShieldRemainingSeconds(shieldUntil: number, nowSec = Math.floor(Date.now() / 1000)): number {
  if (!Number.isFinite(shieldUntil) || shieldUntil <= nowSec) return 0;
  return Math.max(0, Math.floor(shieldUntil - nowSec));
}

export interface GameAccount {
  id: string;
  username: string;
  displayName: string;
  colorIdx: number;
  avatarIdx: number;
  kos: number;
  blocksPlaced: number;
  blocksBroken: number;
  createdAt: number;
}

export interface ServerHealthInfo {
  ok: boolean;
  latencyMs: number;
  online: number;
  webOnline: number;
  mcOnline: number;
  accounts: number;
  totalBlocks: number;
  mcProtocol: string;
  mcPort: number;
  error?: string;
}

export type ServerConnStatus = 'disconnected' | 'connecting' | 'connected';

export type ServerWorldBlockTuple = [number, number, number, number, string?, string?];

export interface ServerVoxelMsg {
  op: 'set' | 'del' | 'clear';
  gx?: number;
  gy?: number;
  gz?: number;
  b?: number;
  from?: string;
  ownerId?: string;
  ownerName?: string;
}

export interface ServerClientCallbacks {
  onStatusChange?(status: ServerConnStatus, url: string): void;
  onAccountChange?(account: GameAccount | null): void;
  onWorldSnapshot?(room: string, blocks: ServerWorldBlockTuple[]): void;
  onVoxelUpdate?(ev: ServerVoxelMsg): void;
  onVoxelRejected?(reason: string, ownerName: string, remainingSec: number): void;
  onIntruderAlert?(record: IntruderRecord): void;
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  }
  const isLocalOrIp =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(trimmed);
  return `${isLocalOrIp ? 'http' : 'https'}://${trimmed}`;
}

function toWsUrl(httpUrl: string): string {
  if (/^https:\/\//i.test(httpUrl)) {
    return httpUrl.replace(/^https:\/\//i, 'wss://');
  }
  return httpUrl.replace(/^http:\/\//i, 'ws://');
}

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, val: string): void {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // Ignore storage limits
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

function loadGuestEconomyState(): EconomyState {
  const raw = safeRead(STORAGE_GUEST_ECONOMY_KEY);
  if (!raw) return createDefaultEconomyState();
  try {
    return normalizeEconomyState(JSON.parse(raw));
  } catch {
    return createDefaultEconomyState();
  }
}

function saveGuestEconomyState(state: EconomyState): void {
  safeWrite(STORAGE_GUEST_ECONOMY_KEY, JSON.stringify(state));
}

function loadGuestBlueprints(): ServerBlueprint[] {
  const raw = safeRead(STORAGE_GUEST_BLUEPRINTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ServerBlueprint[]) : [];
  } catch {
    return [];
  }
}

function saveGuestBlueprints(list: ServerBlueprint[]): void {
  safeWrite(STORAGE_GUEST_BLUEPRINTS_KEY, JSON.stringify(list));
}

function loadGuestMarkers(): MapMarker[] {
  const raw = safeRead(STORAGE_GUEST_MARKERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: MapMarker[] = [];
    for (const item of parsed) {
      const m = normalizeMapMarker(item);
      if (m) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

function saveGuestMarkers(list: MapMarker[]): void {
  safeWrite(STORAGE_GUEST_MARKERS_KEY, JSON.stringify(list.slice(0, 30)));
}

function loadGuestCustomAvatars(): { avatars: SavedCustomAvatar[]; activeId: string } {
  const raw = safeRead(STORAGE_GUEST_AVATARS_KEY);
  const activeId = safeRead(STORAGE_GUEST_ACTIVE_AVATAR_KEY) || '';
  if (!raw) return { avatars: [], activeId };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { avatars: [], activeId };
    const avatars: SavedCustomAvatar[] = [];
    for (const item of parsed) {
      const av = normalizeSavedCustomAvatar(item);
      if (av) avatars.push(av);
    }
    const validActive = avatars.some((a) => a.id === activeId) ? activeId : '';
    return { avatars, activeId: validActive };
  } catch {
    return { avatars: [], activeId: '' };
  }
}

function saveGuestCustomAvatars(avatars: SavedCustomAvatar[], activeId?: string): void {
  safeWrite(STORAGE_GUEST_AVATARS_KEY, JSON.stringify(avatars.slice(0, 16)));
  if (activeId !== undefined) {
    safeWrite(STORAGE_GUEST_ACTIVE_AVATAR_KEY, activeId);
  }
}

function normalizeMapMarker(raw: unknown): MapMarker | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '');
  const wx = Number(o.wx);
  const wy = Number(o.wy ?? 0);
  const ws = Number(o.ws);
  if (!id || !Number.isFinite(wx) || !Number.isFinite(ws)) return null;
  const colorRaw = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color.trim())
    ? o.color.trim()
    : '#ffbe3b';
  return {
    id,
    name: String(o.name || '标记点').trim().slice(0, 28) || '标记点',
    wx,
    wy: Number.isFinite(wy) ? wy : 0,
    ws,
    color: colorRaw,
    createdAt: Number(o.createdAt) || Math.floor(Date.now() / 1000),
  };
}

function normalizeIntruderRecord(raw: unknown): IntruderRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '');
  if (!id) return null;
  const liveWx = o.liveWx !== undefined && o.liveWx !== null ? Number(o.liveWx) : undefined;
  const liveWy = o.liveWy !== undefined && o.liveWy !== null ? Number(o.liveWy) : undefined;
  const liveWs = o.liveWs !== undefined && o.liveWs !== null ? Number(o.liveWs) : undefined;
  const lastSeen = o.lastSeen !== undefined && o.lastSeen !== null ? Number(o.lastSeen) : undefined;
  return {
    id,
    room: String(o.room || 'global'),
    ownerId: String(o.ownerId || ''),
    intruderAccountId: typeof o.intruderAccountId === 'string' && o.intruderAccountId ? o.intruderAccountId : undefined,
    intruderClientId: typeof o.intruderClientId === 'string' && o.intruderClientId ? o.intruderClientId : undefined,
    intruderName: String(o.intruderName || 'Unknown'),
    gx: Math.floor(Number(o.gx) || 0),
    gy: Math.floor(Number(o.gy) || 0),
    gz: Math.floor(Number(o.gz) || 0),
    blockType: Math.max(1, Math.min(10, Math.floor(Number(o.blockType) || 1))),
    action: String(o.action || 'break'),
    createdAt: Number(o.createdAt) || Math.floor(Date.now() / 1000),
    liveWx: liveWx !== undefined && Number.isFinite(liveWx) ? liveWx : undefined,
    liveWy: liveWy !== undefined && Number.isFinite(liveWy) ? liveWy : undefined,
    liveWs: liveWs !== undefined && Number.isFinite(liveWs) ? liveWs : undefined,
    online: typeof o.online === 'boolean' ? o.online : undefined,
    lastSeen: lastSeen !== undefined && Number.isFinite(lastSeen) ? lastSeen : undefined,
  };
}

function normalizeMapPlayer(raw: unknown): MapOnlinePlayer | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '');
  const wx = Number(o.wx);
  const wy = Number(o.wy ?? 0);
  const ws = Number(o.ws);
  if (!id || !Number.isFinite(wx) || !Number.isFinite(ws)) return null;
  return {
    id,
    accountId: typeof o.accountId === 'string' && o.accountId ? o.accountId : undefined,
    name: String(o.name || 'Rider'),
    wx,
    wy: Number.isFinite(wy) ? wy : 0,
    ws,
    onFoot: typeof o.onFoot === 'boolean' ? o.onFoot : undefined,
  };
}

function normalizeSavedCustomAvatar(raw: unknown): SavedCustomAvatar | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '');
  const skin = sanitizeCustomSkin(o.skin);
  if (!id || !skin) return null;
  const portrait =
    typeof o.portraitDataUrl === 'string' && o.portraitDataUrl.startsWith('data:image/')
      ? o.portraitDataUrl.slice(0, 32768)
      : undefined;
  return {
    id,
    name: String(o.name || '自定义形象').trim().slice(0, 28) || '自定义形象',
    prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 200) : undefined,
    portraitDataUrl: portrait,
    skin,
    createdAt: Number(o.createdAt) || Math.floor(Date.now() / 1000),
  };
}

function normalizeBlueprint(raw: unknown): ServerBlueprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const blocksRaw = Array.isArray(o.blocks) ? o.blocks : [];
  const blocks: BlueprintBlock[] = [];
  for (const item of blocksRaw) {
    if (!item || typeof item !== 'object') continue;
    const bi = item as Record<string, unknown>;
    const b = Math.floor(Number(bi.b));
    if (b < 1 || b > 10) continue;
    blocks.push({
      dx: Math.floor(Number(bi.dx) || 0),
      dy: Math.floor(Number(bi.dy) || 0),
      dz: Math.floor(Number(bi.dz) || 0),
      b,
    });
  }
  return {
    id: String(o.id || `bp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    name: String(o.name || 'Blueprint').slice(0, 32),
    sizeX: Math.max(1, Math.floor(Number(o.sizeX) || 1)),
    sizeY: Math.max(1, Math.floor(Number(o.sizeY) || 1)),
    sizeZ: Math.max(1, Math.floor(Number(o.sizeZ) || 1)),
    blocks,
    createdAt: Number(o.createdAt) || Math.floor(Date.now() / 1000),
  };
}

function normalizeMarketListing(raw: unknown): MarketListing | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '');
  if (!id) return null;
  return {
    id,
    sellerId: String(o.sellerId || ''),
    sellerName: String(o.sellerName || 'Player'),
    blockType: Math.max(1, Math.min(10, Math.floor(Number(o.blockType) || 1))),
    qty: Math.max(1, Math.floor(Number(o.qty) || 1)),
    priceCoins: Math.max(1, Math.floor(Number(o.priceCoins) || 1)),
    createdAt: Number(o.createdAt) || Math.floor(Date.now() / 1000),
  };
}

export class ServerClient {
  private serverUrl: string;
  private token: string | null = null;
  private account: GameAccount | null = null;
  private status: ServerConnStatus = 'disconnected';
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private roomSlug = 'global';
  private clientId: string;
  private playerName: string;
  private disposed = false;
  private readonly cb: ServerClientCallbacks;
  private lastEconomyState: EconomyState;
  private lastPosSendMs = 0;
  private lastPosOnFoot: boolean | null = null;

  constructor(clientId: string, playerName: string, cb: ServerClientCallbacks) {
    this.clientId = clientId;
    this.playerName = playerName;
    this.cb = cb;

    const savedUrl = safeRead(STORAGE_SERVER_URL_KEY);
    this.serverUrl = savedUrl ? normalizeServerUrl(savedUrl) : DEFAULT_SERVER_URL;
    this.token = safeRead(STORAGE_AUTH_TOKEN_KEY);
    const savedAcc = safeRead(STORAGE_AUTH_ACCOUNT_KEY);
    if (savedAcc) {
      try {
        this.account = JSON.parse(savedAcc) as GameAccount;
      } catch {
        this.account = null;
      }
    }
    this.lastEconomyState = loadGuestEconomyState();
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getAccount(): GameAccount | null {
    return this.account;
  }

  isAuthenticated(): boolean {
    return Boolean(this.token && this.account);
  }

  getStatus(): ServerConnStatus {
    return this.status;
  }

  getCachedEconomyState(): EconomyState {
    return this.lastEconomyState;
  }

  getSshWsUrl(): string {
    const base = `${toWsUrl(this.serverUrl)}/ws/ssh`;
    if (this.token) {
      return `${base}?token=${encodeURIComponent(this.token)}`;
    }
    return base;
  }

  setPlayerName(name: string): void {
    this.playerName = name;
  }

  setServerUrl(rawUrl: string): string {
    const next = normalizeServerUrl(rawUrl);
    if (next !== this.serverUrl) {
      this.serverUrl = next;
      safeWrite(STORAGE_SERVER_URL_KEY, next);
      // Clear cached auth token from previous server unless verified
      this.clearAuth(false);
    }
    this.reconnectNow();
    return this.serverUrl;
  }

  resetDefaultServerUrl(): string {
    safeRemove(STORAGE_SERVER_URL_KEY);
    this.serverUrl = DEFAULT_SERVER_URL;
    this.reconnectNow();
    return this.serverUrl;
  }

  connectRoom(roomSlug: string): void {
    this.roomSlug = roomSlug || 'global';
    this.reconnectNow();
  }

  async pingServer(customUrl?: string): Promise<ServerHealthInfo> {
    const base = customUrl ? normalizeServerUrl(customUrl) : this.serverUrl;
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${base}/api/health`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      window.clearTimeout(timer);
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      if (!res.ok) {
        return {
          ok: false,
          latencyMs,
          online: 0,
          webOnline: 0,
          mcOnline: 0,
          accounts: 0,
          totalBlocks: 0,
          mcProtocol: '',
          mcPort: 25565,
          error: `HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        ok: Boolean(data.ok),
        latencyMs,
        online: Number(data.online) || 0,
        webOnline: Number(data.webOnline) || 0,
        mcOnline: Number(data.mcOnline) || 0,
        accounts: Number(data.accounts) || 0,
        totalBlocks: Number(data.totalBlocks) || 0,
        mcProtocol: String(data.mcProtocol || '1.20.4'),
        mcPort: Number(data.mcPort) || 25565,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        online: 0,
        webOnline: 0,
        mcOnline: 0,
        accounts: 0,
        totalBlocks: 0,
        mcProtocol: '',
        mcPort: 25565,
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  async verifySession(): Promise<GameAccount | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          this.clearAuth(true);
        }
        return null;
      }
      const data = (await res.json()) as { account?: GameAccount };
      if (data.account) {
        this.saveAuth(this.token, data.account);
        return data.account;
      }
      return null;
    } catch {
      return this.account;
    }
  }

  async register(
    username: string,
    password: string,
    displayName: string,
    colorIdx: number,
    avatarIdx: number
  ): Promise<{ ok: boolean; account?: GameAccount; error?: string }> {
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName, colorIdx, avatarIdx }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        account?: GameAccount;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token || !data.account) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      this.saveAuth(data.token, data.account);
      this.reconnectNow();
      return { ok: true, account: data.account };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '无法连接服务器' };
    }
  }

  async login(
    username: string,
    password: string
  ): Promise<{ ok: boolean; account?: GameAccount; error?: string }> {
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        account?: GameAccount;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token || !data.account) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      this.saveAuth(data.token, data.account);
      this.reconnectNow();
      return { ok: true, account: data.account };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '无法连接服务器' };
    }
  }

  async syncProfile(patch: {
    displayName?: string;
    colorIdx?: number;
    avatarIdx?: number;
  }): Promise<void> {
    if (!this.token || !this.account) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = (await res.json()) as { account?: GameAccount };
        if (data.account) {
          this.saveAuth(this.token, data.account);
        }
      }
    } catch {
      // Ignore offline profile sync error
    }
  }

  logout(): void {
    this.clearAuth(true);
    this.reconnectNow();
  }

  // -------------------------------------------------------------------------
  // ECONOMY, SHOP, ITEM BAG, MARKETPLACE & BLUEPRINTS API
  // -------------------------------------------------------------------------

  private authHeaders(withJson = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (withJson) h['Content-Type'] = 'application/json';
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async getEconomyState(): Promise<EconomyState> {
    if (!this.token) {
      const local = loadGuestEconomyState();
      this.lastEconomyState = local;
      // Still try to fetch shop catalog from server if reachable
      try {
        const res = await fetch(`${this.serverUrl}/api/economy/state`, { method: 'GET' });
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const remote = normalizeEconomyState(data);
          local.shop = remote.shop;
          local.caps = remote.caps;
          this.lastEconomyState = local;
        }
      } catch {
        // Offline guest fallback
      }
      return this.lastEconomyState;
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/economy/state`, {
        method: 'GET',
        headers: this.authHeaders(false),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const state = normalizeEconomyState(data);
        this.lastEconomyState = state;
        return state;
      }
    } catch {
      // Fall back to cached state
    }
    return this.lastEconomyState;
  }

  async claimReward(
    kind: string,
    amount?: number,
    blockRewards?: { b: number; qty: number }[]
  ): Promise<{ ok: boolean; state: EconomyState; error?: string }> {
    const applyLocal = (): EconomyState => {
      const st = loadGuestEconomyState();
      const coinGain = Math.max(0, Math.min(500, Math.floor(amount ?? 0)));
      st.coins += coinGain;
      if (Array.isArray(blockRewards)) {
        for (const r of blockRewards) {
          const b = Math.floor(r.b);
          const q = Math.max(0, Math.floor(r.qty));
          if (b >= 1 && b <= 10 && q > 0) {
            const cap = st.caps[b] ?? DEFAULT_MATERIAL_CAPS[b] ?? 99;
            st.inventory[b] = Math.min(cap, (st.inventory[b] ?? 0) + q);
          }
        }
      }
      saveGuestEconomyState(st);
      this.lastEconomyState = st;
      return st;
    };

    if (!this.token) {
      return { ok: true, state: applyLocal() };
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/economy/reward`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ kind, amount, blockRewards }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          state: this.lastEconomyState,
          error: String(data.error || `HTTP ${res.status}`),
        };
      }
      const state = normalizeEconomyState(data);
      this.lastEconomyState = state;
      return { ok: true, state };
    } catch {
      return { ok: true, state: applyLocal() };
    }
  }

  async buyShopItem(
    itemId: string,
    qty = 1
  ): Promise<{ ok: boolean; state: EconomyState; error?: string }> {
    const safeQty = Math.max(1, Math.min(20, Math.floor(qty)));

    const buyLocal = (): { ok: boolean; state: EconomyState; error?: string } => {
      const st = loadGuestEconomyState();
      const spec = st.shop.find((s) => s.id === itemId);
      if (!spec) return { ok: false, state: st, error: '商品不存在' };
      const totalPrice = spec.price * safeQty;
      if (st.coins < totalPrice) return { ok: false, state: st, error: '金币不足' };

      if (spec.kind === 'block' && spec.blockType) {
        const b = spec.blockType;
        const cap = st.caps[b] ?? DEFAULT_MATERIAL_CAPS[b] ?? 99;
        const cur = st.inventory[b] ?? 0;
        const add = (spec.qty ?? 1) * safeQty;
        if (cur >= cap) return { ok: false, state: st, error: '该材料库存已达上限' };
        st.inventory[b] = Math.min(cap, cur + add);
        st.coins -= totalPrice;
      } else if (spec.kind === 'bag') {
        if (st.bagCapacity >= 12) return { ok: false, state: st, error: '道具袋已达最大容量 (12格)' };
        st.bagCapacity = Math.min(12, st.bagCapacity + (spec.qty ?? 3) * safeQty);
        st.coins -= totalPrice;
      } else if (spec.kind === 'shield') {
        const now = Math.floor(Date.now() / 1000);
        const base = Math.max(now, st.shieldUntil || 0);
        st.shieldUntil = base + (spec.durationSec ?? 600) * safeQty;
        st.coins -= totalPrice;
      } else if (spec.kind === 'teleport') {
        const cur = st.teleportCards ?? 0;
        if (cur >= 50) return { ok: false, state: st, error: '传送卡数量已达上限 (50张)' };
        st.teleportCards = Math.min(50, cur + (spec.qty ?? 1) * safeQty);
        st.coins -= totalPrice;
      }
      saveGuestEconomyState(st);
      this.lastEconomyState = st;
      return { ok: true, state: st };
    };

    if (!this.token) {
      return buyLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/economy/shop/buy`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ itemId, qty: safeQty }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          state: this.lastEconomyState,
          error: String(data.error || `HTTP ${res.status}`),
        };
      }
      const state = normalizeEconomyState(data);
      this.lastEconomyState = state;
      return { ok: true, state };
    } catch {
      return buyLocal();
    }
  }

  async stashBagItem(item: ItemType): Promise<{ ok: boolean; state: EconomyState; error?: string }> {
    const stashLocal = (): { ok: boolean; state: EconomyState; error?: string } => {
      const st = loadGuestEconomyState();
      if (st.bagCapacity <= 0) return { ok: false, state: st, error: '请先在商店购买道具袋' };
      if (st.savedItems.length >= st.bagCapacity) return { ok: false, state: st, error: '道具袋已满' };
      st.savedItems.push(item);
      saveGuestEconomyState(st);
      this.lastEconomyState = st;
      return { ok: true, state: st };
    };

    if (!this.token) {
      return stashLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/economy/bag/stash`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ item }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          state: this.lastEconomyState,
          error: String(data.error || `HTTP ${res.status}`),
        };
      }
      const state = normalizeEconomyState(data);
      this.lastEconomyState = state;
      return { ok: true, state };
    } catch {
      return stashLocal();
    }
  }

  async useBagItem(
    index: number
  ): Promise<{ ok: boolean; item?: ItemType; state: EconomyState; error?: string }> {
    const idx = Math.floor(index);
    const useLocal = (): { ok: boolean; item?: ItemType; state: EconomyState; error?: string } => {
      const st = loadGuestEconomyState();
      if (idx < 0 || idx >= st.savedItems.length) {
        return { ok: false, state: st, error: '道具槽位无效' };
      }
      const [used] = st.savedItems.splice(idx, 1);
      saveGuestEconomyState(st);
      this.lastEconomyState = st;
      return { ok: true, item: used, state: st };
    };

    if (!this.token) {
      return useLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/economy/bag/use`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ index: idx }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          state: this.lastEconomyState,
          error: String(data.error || `HTTP ${res.status}`),
        };
      }
      const state = normalizeEconomyState(data);
      this.lastEconomyState = state;
      const usedItem = isValidItemType(data.item) ? data.item : undefined;
      return { ok: true, item: usedItem, state };
    } catch {
      return useLocal();
    }
  }

  async getMarketListings(): Promise<{ ok: boolean; listings: MarketListing[]; error?: string }> {
    try {
      const res = await fetch(`${this.serverUrl}/api/market/listings`, {
        method: 'GET',
        headers: this.authHeaders(false),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, listings: [], error: String(data.error || `HTTP ${res.status}`) };
      }
      const rawList = Array.isArray(data.listings)
        ? data.listings
        : Array.isArray(data)
          ? data
          : [];
      const listings: MarketListing[] = [];
      for (const item of rawList) {
        const norm = normalizeMarketListing(item);
        if (norm) listings.push(norm);
      }
      return { ok: true, listings };
    } catch (err) {
      return {
        ok: false,
        listings: [],
        error: err instanceof Error ? err.message : '无法连接交易行',
      };
    }
  }

  async createMarketListing(
    blockType: number,
    qty: number,
    priceCoins: number
  ): Promise<{ ok: boolean; listing?: MarketListing; state?: EconomyState; error?: string }> {
    if (!this.token) {
      return { ok: false, error: '请先登录游戏账号后再使用玩家交易行' };
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/market/list`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({
          blockType: Math.floor(blockType),
          qty: Math.floor(qty),
          priceCoins: Math.floor(priceCoins),
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const listing = normalizeMarketListing(data.listing) ?? undefined;
      const hasEco = data.coins !== undefined || data.state !== undefined || data.inventory !== undefined;
      const state = hasEco ? normalizeEconomyState(data) : undefined;
      if (state) this.lastEconomyState = state;
      return { ok: true, listing, state };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '上架失败' };
    }
  }

  async buyMarketListing(
    listingId: string
  ): Promise<{ ok: boolean; state?: EconomyState; error?: string }> {
    if (!this.token) {
      return { ok: false, error: '请先登录游戏账号后再购买玩家挂单' };
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/market/buy`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ listingId }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const hasEco = data.coins !== undefined || data.state !== undefined || data.inventory !== undefined;
      const state = hasEco ? normalizeEconomyState(data) : undefined;
      if (state) this.lastEconomyState = state;
      return { ok: true, state };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '购买失败' };
    }
  }

  async cancelMarketListing(
    listingId: string
  ): Promise<{ ok: boolean; state?: EconomyState; error?: string }> {
    if (!this.token) {
      return { ok: false, error: '请先登录游戏账号' };
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/market/cancel`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({ listingId }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const hasEco = data.coins !== undefined || data.state !== undefined || data.inventory !== undefined;
      const state = hasEco ? normalizeEconomyState(data) : undefined;
      if (state) this.lastEconomyState = state;
      return { ok: true, state };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '取消失败' };
    }
  }

  async getBlueprints(): Promise<{ ok: boolean; blueprints: ServerBlueprint[]; error?: string }> {
    if (!this.token) {
      return { ok: true, blueprints: loadGuestBlueprints() };
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/blueprints`, {
        method: 'GET',
        headers: this.authHeaders(false),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          blueprints: loadGuestBlueprints(),
          error: String(data.error || `HTTP ${res.status}`),
        };
      }
      const rawList = Array.isArray(data.blueprints)
        ? data.blueprints
        : Array.isArray(data)
          ? data
          : [];
      const blueprints: ServerBlueprint[] = [];
      for (const item of rawList) {
        const bp = normalizeBlueprint(item);
        if (bp) blueprints.push(bp);
      }
      return { ok: true, blueprints };
    } catch {
      return { ok: true, blueprints: loadGuestBlueprints() };
    }
  }

  async saveBlueprint(
    bp: Omit<ServerBlueprint, 'id' | 'createdAt'>
  ): Promise<{ ok: boolean; blueprint?: ServerBlueprint; error?: string }> {
    const saveLocal = (): ServerBlueprint => {
      const created: ServerBlueprint = {
        ...bp,
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Math.floor(Date.now() / 1000),
      };
      const existing = loadGuestBlueprints();
      existing.unshift(created);
      saveGuestBlueprints(existing.slice(0, 24));
      return created;
    };

    if (!this.token) {
      return { ok: true, blueprint: saveLocal() };
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/blueprints`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify(bp),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const created = normalizeBlueprint(data.blueprint ?? data) ?? saveLocal();
      return { ok: true, blueprint: created };
    } catch {
      return { ok: true, blueprint: saveLocal() };
    }
  }

  async deleteBlueprint(id: string): Promise<{ ok: boolean; error?: string }> {
    const deleteLocal = (): void => {
      const existing = loadGuestBlueprints().filter((b) => b.id !== id);
      saveGuestBlueprints(existing);
    };

    if (!this.token || id.startsWith('local_')) {
      deleteLocal();
      return { ok: true };
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/blueprints/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.authHeaders(false),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '删除失败' };
    }
  }

  // Local helper for guest inventory sync when placing/breaking blocks offline
  adjustLocalInventory(blockType: number, delta: number): EconomyState {
    if (this.token) {
      const cur = this.lastEconomyState.inventory[blockType] ?? 0;
      const cap = this.lastEconomyState.caps[blockType] ?? DEFAULT_MATERIAL_CAPS[blockType] ?? 99;
      this.lastEconomyState.inventory[blockType] = Math.max(0, Math.min(cap, cur + delta));
      return this.lastEconomyState;
    }
    const st = loadGuestEconomyState();
    const cur = st.inventory[blockType] ?? 0;
    const cap = st.caps[blockType] ?? DEFAULT_MATERIAL_CAPS[blockType] ?? 99;
    st.inventory[blockType] = Math.max(0, Math.min(cap, cur + delta));
    saveGuestEconomyState(st);
    this.lastEconomyState = st;
    return st;
  }

  // -------------------------------------------------------------------------
  // TELEPORT CARDS, WORLD MAP MARKERS, INTRUDER TRACKING & CUSTOM AVATARS
  // -------------------------------------------------------------------------

  async useTeleportCard(): Promise<{ ok: boolean; state?: EconomyState; error?: string }> {
    const useLocal = (): { ok: boolean; state: EconomyState; error?: string } => {
      const st = loadGuestEconomyState();
      if ((st.teleportCards ?? 0) <= 0) {
        return { ok: false, state: st, error: '传送卡不足，请前往世界商店购买' };
      }
      st.teleportCards = Math.max(0, (st.teleportCards ?? 0) - 1);
      saveGuestEconomyState(st);
      this.lastEconomyState = st;
      return { ok: true, state: st };
    };

    if (!this.token) {
      return useLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/economy/teleport/use`, {
        method: 'POST',
        headers: this.authHeaders(true),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return {
          ok: false,
          state: this.lastEconomyState,
          error: String(data.error || `HTTP ${res.status}`),
        };
      }
      const state = normalizeEconomyState(data);
      this.lastEconomyState = state;
      return { ok: true, state };
    } catch {
      return useLocal();
    }
  }

  async getMapMarkers(): Promise<MapMarker[]> {
    if (!this.token) {
      return loadGuestMarkers();
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/map/markers`, {
        method: 'GET',
        headers: this.authHeaders(false),
      });
      if (!res.ok) return loadGuestMarkers();
      const data = (await res.json()) as Record<string, unknown>;
      const rawList = Array.isArray(data.markers)
        ? data.markers
        : Array.isArray(data)
          ? data
          : [];
      const markers: MapMarker[] = [];
      for (const item of rawList) {
        const m = normalizeMapMarker(item);
        if (m) markers.push(m);
      }
      return markers;
    } catch {
      return loadGuestMarkers();
    }
  }

  async saveMapMarker(m: {
    name: string;
    wx: number;
    wy: number;
    ws: number;
    color?: string;
  }): Promise<{ ok: boolean; marker?: MapMarker; error?: string }> {
    const cleanName = m.name.trim().slice(0, 28) || '标记点';
    const cleanColor =
      typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color.trim())
        ? m.color.trim()
        : '#ffbe3b';

    const saveLocal = (): { ok: boolean; marker?: MapMarker; error?: string } => {
      const existing = loadGuestMarkers();
      if (existing.length >= 30) {
        return { ok: false, error: '最多保存 30 个地图标记' };
      }
      const created: MapMarker = {
        id: `local_mk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        wx: Number.isFinite(m.wx) ? m.wx : 0,
        wy: Number.isFinite(m.wy) ? m.wy : 0,
        ws: Number.isFinite(m.ws) ? m.ws : 0,
        color: cleanColor,
        createdAt: Math.floor(Date.now() / 1000),
      };
      existing.unshift(created);
      saveGuestMarkers(existing);
      return { ok: true, marker: created };
    };

    if (!this.token) {
      return saveLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/map/markers`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify({
          name: cleanName,
          wx: m.wx,
          wy: m.wy,
          ws: m.ws,
          color: cleanColor,
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const created = normalizeMapMarker(data.marker ?? data);
      if (created) return { ok: true, marker: created };
      return saveLocal();
    } catch {
      return saveLocal();
    }
  }

  async deleteMapMarker(id: string): Promise<{ ok: boolean; error?: string }> {
    const deleteLocal = (): void => {
      const next = loadGuestMarkers().filter((m) => m.id !== id);
      saveGuestMarkers(next);
    };

    if (!this.token || id.startsWith('local_mk_')) {
      deleteLocal();
      return { ok: true };
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/map/markers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.authHeaders(false),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '删除标记失败' };
    }
  }

  async getIntruderRecords(room?: string): Promise<IntruderRecord[]> {
    if (!this.token) return [];
    const targetRoom = room ?? this.roomSlug;
    try {
      const res = await fetch(
        `${this.serverUrl}/api/intruders?room=${encodeURIComponent(targetRoom)}`,
        {
          method: 'GET',
          headers: this.authHeaders(false),
        }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as Record<string, unknown>;
      const rawList = Array.isArray(data.records)
        ? data.records
        : Array.isArray(data)
          ? data
          : [];
      const records: IntruderRecord[] = [];
      for (const item of rawList) {
        const rec = normalizeIntruderRecord(item);
        if (rec) records.push(rec);
      }
      return records;
    } catch {
      return [];
    }
  }

  async dismissIntruderRecord(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.token) return { ok: true };
    try {
      const res = await fetch(`${this.serverUrl}/api/intruders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.authHeaders(false),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '移除入侵记录失败' };
    }
  }

  async getMapPlayers(room?: string): Promise<MapOnlinePlayer[]> {
    const targetRoom = room ?? this.roomSlug;
    try {
      const res = await fetch(
        `${this.serverUrl}/api/map/players?room=${encodeURIComponent(targetRoom)}`,
        {
          method: 'GET',
          headers: this.authHeaders(false),
        }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as Record<string, unknown>;
      const rawList = Array.isArray(data.players)
        ? data.players
        : Array.isArray(data)
          ? data
          : [];
      const players: MapOnlinePlayer[] = [];
      for (const item of rawList) {
        const p = normalizeMapPlayer(item);
        if (p) players.push(p);
      }
      return players;
    } catch {
      return [];
    }
  }

  async getCustomAvatars(): Promise<{ avatars: SavedCustomAvatar[]; activeId: string }> {
    if (!this.token) {
      return loadGuestCustomAvatars();
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/avatars`, {
        method: 'GET',
        headers: this.authHeaders(false),
      });
      if (!res.ok) return loadGuestCustomAvatars();
      const data = (await res.json()) as Record<string, unknown>;
      const rawList = Array.isArray(data.avatars) ? data.avatars : [];
      const avatars: SavedCustomAvatar[] = [];
      for (const item of rawList) {
        const av = normalizeSavedCustomAvatar(item);
        if (av) avatars.push(av);
      }
      const activeId = typeof data.activeId === 'string' ? data.activeId : '';
      return { avatars, activeId };
    } catch {
      return loadGuestCustomAvatars();
    }
  }

  async saveCustomAvatar(
    av: Omit<SavedCustomAvatar, 'id' | 'createdAt'>
  ): Promise<{
    ok: boolean;
    avatar?: SavedCustomAvatar;
    avatars?: SavedCustomAvatar[];
    activeId?: string;
    error?: string;
  }> {
    const cleanSkin = sanitizeCustomSkin(av.skin);
    if (!cleanSkin) {
      return { ok: false, error: '自定义形象数据无效' };
    }
    const payload: Omit<SavedCustomAvatar, 'id' | 'createdAt'> = {
      name: av.name.trim().slice(0, 28) || '自定义形象',
      prompt: av.prompt ? av.prompt.trim().slice(0, 200) : undefined,
      portraitDataUrl:
        av.portraitDataUrl && av.portraitDataUrl.startsWith('data:image/')
          ? av.portraitDataUrl.slice(0, 32768)
          : undefined,
      skin: cleanSkin,
    };

    const saveLocal = (): {
      ok: boolean;
      avatar?: SavedCustomAvatar;
      avatars?: SavedCustomAvatar[];
      activeId?: string;
      error?: string;
    } => {
      const cur = loadGuestCustomAvatars();
      const created: SavedCustomAvatar = {
        ...payload,
        id: `local_av_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Math.floor(Date.now() / 1000),
      };
      const next = [created, ...cur.avatars].slice(0, 16);
      saveGuestCustomAvatars(next, created.id);
      return { ok: true, avatar: created, avatars: next, activeId: created.id };
    };

    if (!this.token) {
      return saveLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/avatars`, {
        method: 'POST',
        headers: this.authHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const created = normalizeSavedCustomAvatar(data.avatar) ?? undefined;
      const avatars: SavedCustomAvatar[] | undefined = Array.isArray(data.avatars)
        ? (data.avatars
            .map((item) => normalizeSavedCustomAvatar(item))
            .filter((x): x is SavedCustomAvatar => x !== null))
        : undefined;
      const activeId = typeof data.activeId === 'string' ? data.activeId : created?.id;
      return { ok: true, avatar: created, avatars, activeId };
    } catch {
      return saveLocal();
    }
  }

  async setActiveCustomAvatar(
    id: string
  ): Promise<{ ok: boolean; activeId?: string; error?: string }> {
    const cleanId = id.trim();
    const setLocal = (): { ok: boolean; activeId: string } => {
      const cur = loadGuestCustomAvatars();
      const nextActive = cleanId && cur.avatars.some((a) => a.id === cleanId) ? cleanId : '';
      saveGuestCustomAvatars(cur.avatars, nextActive);
      return { ok: true, activeId: nextActive };
    };

    if (!this.token) {
      return setLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/avatars/active`, {
        method: 'PUT',
        headers: this.authHeaders(true),
        body: JSON.stringify({ id: cleanId }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const activeId = typeof data.activeId === 'string' ? data.activeId : cleanId;
      return { ok: true, activeId };
    } catch {
      return setLocal();
    }
  }

  async deleteCustomAvatar(
    id: string
  ): Promise<{ ok: boolean; avatars?: SavedCustomAvatar[]; activeId?: string; error?: string }> {
    const deleteLocal = (): { ok: boolean; avatars: SavedCustomAvatar[]; activeId: string } => {
      const cur = loadGuestCustomAvatars();
      const next = cur.avatars.filter((a) => a.id !== id);
      const nextActive = cur.activeId === id ? '' : cur.activeId;
      saveGuestCustomAvatars(next, nextActive);
      return { ok: true, avatars: next, activeId: nextActive };
    };

    if (!this.token || id.startsWith('local_av_')) {
      return deleteLocal();
    }

    try {
      const res = await fetch(`${this.serverUrl}/api/avatars/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.authHeaders(false),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok || data.ok === false) {
        return { ok: false, error: String(data.error || `HTTP ${res.status}`) };
      }
      const avatars: SavedCustomAvatar[] | undefined = Array.isArray(data.avatars)
        ? (data.avatars
            .map((item) => normalizeSavedCustomAvatar(item))
            .filter((x): x is SavedCustomAvatar => x !== null))
        : undefined;
      const activeId = typeof data.activeId === 'string' ? data.activeId : undefined;
      return { ok: true, avatars, activeId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '删除形象失败' };
    }
  }

  sendPlayerPosition(wx: number, wy: number, ws: number, onFoot: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(ws)) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const minInterval = this.lastPosOnFoot !== null && this.lastPosOnFoot !== onFoot ? 250 : 950;
    if (now - this.lastPosSendMs < minInterval) return;
    this.lastPosSendMs = now;
    this.lastPosOnFoot = onFoot;
    try {
      this.ws.send(
        JSON.stringify({
          t: 'pos',
          wx: Math.round(wx * 100) / 100,
          wy: Math.round(wy * 100) / 100,
          ws: Math.round(ws * 100) / 100,
          onFoot,
        })
      );
    } catch {
      // Ignore send error
    }
  }

  sendVoxel(
    op: 'set' | 'del' | 'clear',
    gx = 0,
    gy = 0,
    gz = 0,
    b?: BlockType | VoxelBlockId | number
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ t: 'vox', op, gx, gy, gz, b }));
    } catch {
      // Ignore send error
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnect();
    this.closeSocket();
  }

  private saveAuth(token: string, account: GameAccount): void {
    this.token = token;
    this.account = account;
    safeWrite(STORAGE_AUTH_TOKEN_KEY, token);
    safeWrite(STORAGE_AUTH_ACCOUNT_KEY, JSON.stringify(account));
    this.cb.onAccountChange?.(account);
  }

  private clearAuth(notify: boolean): void {
    this.token = null;
    this.account = null;
    safeRemove(STORAGE_AUTH_TOKEN_KEY);
    safeRemove(STORAGE_AUTH_ACCOUNT_KEY);
    if (notify) {
      this.cb.onAccountChange?.(null);
    }
  }

  private setStatus(next: ServerConnStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.cb.onStatusChange?.(next, this.serverUrl);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try {
        old.close(1000);
      } catch {
        // Ignore
      }
    }
  }

  private reconnectNow(): void {
    if (this.disposed) return;
    this.clearReconnect();
    this.closeSocket();
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = Math.min(15000, 1200 * Math.pow(1.6, this.reconnectAttempt));
    this.reconnectAttempt = Math.min(8, this.reconnectAttempt + 1);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private openSocket(): void {
    if (this.disposed) return;
    this.setStatus('connecting');

    const params = new URLSearchParams();
    params.set('room', this.roomSlug);
    params.set('cid', this.clientId);
    params.set('name', this.account?.displayName || this.playerName);
    if (this.token) {
      params.set('token', this.token);
    }

    const wsUrl = `${toWsUrl(this.serverUrl)}/ws?${params.toString()}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.setStatus('connected');
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.t === 'world_init' && Array.isArray(msg.blocks)) {
          const tuples: ServerWorldBlockTuple[] = [];
          for (const raw of msg.blocks) {
            if (!Array.isArray(raw) || raw.length < 4) continue;
            const gx = Number(raw[0]);
            const gy = Number(raw[1]);
            const gz = Number(raw[2]);
            const b = Number(raw[3]);
            if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz) || !Number.isFinite(b)) {
              continue;
            }
            const ownerId = typeof raw[4] === 'string' ? raw[4] : undefined;
            const ownerName = typeof raw[5] === 'string' ? raw[5] : undefined;
            tuples.push([gx, gy, gz, b, ownerId, ownerName]);
          }
          this.cb.onWorldSnapshot?.(String(msg.room || this.roomSlug), tuples);
        } else if (msg.t === 'vox') {
          const op = msg.op;
          if (op === 'set' || op === 'del' || op === 'clear') {
            this.cb.onVoxelUpdate?.({
              op,
              gx: typeof msg.gx === 'number' ? msg.gx : 0,
              gy: typeof msg.gy === 'number' ? msg.gy : 0,
              gz: typeof msg.gz === 'number' ? msg.gz : 0,
              b: typeof msg.b === 'number' ? msg.b : undefined,
              from: typeof msg.from === 'string' ? msg.from : undefined,
              ownerId: typeof msg.ownerId === 'string' ? msg.ownerId : undefined,
              ownerName: typeof msg.ownerName === 'string' ? msg.ownerName : undefined,
            });
          }
        } else if (msg.t === 'vox_rejected') {
          this.cb.onVoxelRejected?.(
            String(msg.reason || 'shielded'),
            String(msg.ownerName || ''),
            Math.max(0, Math.floor(Number(msg.remainingSec) || 0))
          );
        } else if (msg.t === 'intruder_alert' && msg.record) {
          const rec = normalizeIntruderRecord(msg.record);
          if (rec) {
            this.cb.onIntruderAlert?.(rec);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      // Handled in onclose
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }
}
