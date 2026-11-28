import {
  TRACK_LENGTH,
  hash1,
  openWorldGroundY,
  roadX,
  signedTrackDelta,
  wrapTrackS,
} from './RoadMath';
import type { BlockType } from './VoxelWorld';

export type ResourceNodeKind = 'wood_grove' | 'stone_quarry' | 'neon_crystal' | 'supply_drop';

export interface ResourceBlockReward {
  b: BlockType;
  qty: number;
}

export interface ResourceNode {
  id: string;
  kind: ResourceNodeKind;
  zhName: string;
  enName: string;
  wx: number;
  wy: number;
  ws: number;
  colorHex: number;
  blockRewards: ResourceBlockReward[];
  coinReward: number;
  cooldown: number;
  maxCooldown: number;
}

export interface HarvestResult {
  node: ResourceNode;
  blockRewards: ResourceBlockReward[];
  coinReward: number;
}

interface NodeTemplate {
  kind: ResourceNodeKind;
  zhName: string;
  enName: string;
  colorHex: number;
  blockRewards: readonly ResourceBlockReward[];
  coinReward: number;
}

const NODE_COOLDOWN_SEC = 45;
const ROAD_SLOT_STEP = 80; // 2400 / 80 = 30 deterministic roadside clearing nodes per lap
const ROAD_SLOTS_PER_LAP = Math.round(TRACK_LENGTH / ROAD_SLOT_STEP);
const WILD_NODE_CELL = 96; // 2400 / 96 = 25 exact cyclic wild cells along S
const WILD_CELLS_PER_LAP = Math.round(TRACK_LENGTH / WILD_NODE_CELL);
const ACTIVE_RANGE = 220;

const NODE_TEMPLATES: Record<ResourceNodeKind, NodeTemplate> = {
  wood_grove: {
    kind: 'wood_grove',
    zhName: '伐木林点',
    enName: 'TIMBER GROVE',
    colorHex: 0x52b788,
    blockRewards: [
      { b: 5, qty: 4 },
      { b: 3, qty: 6 },
      { b: 6, qty: 3 },
    ],
    coinReward: 35,
  },
  stone_quarry: {
    kind: 'stone_quarry',
    zhName: '采石矿脉',
    enName: 'STONE QUARRY',
    colorHex: 0x94a3b8,
    blockRewards: [
      { b: 2, qty: 8 },
      { b: 4, qty: 4 },
      { b: 9, qty: 3 },
    ],
    coinReward: 45,
  },
  neon_crystal: {
    kind: 'neon_crystal',
    zhName: '霓虹晶簇',
    enName: 'NEON CRYSTAL',
    colorHex: 0x00f5d4,
    blockRewards: [
      { b: 8, qty: 4 },
      { b: 7, qty: 5 },
    ],
    coinReward: 75,
  },
  supply_drop: {
    kind: 'supply_drop',
    zhName: '空投补给',
    enName: 'SUPPLY DROP',
    colorHex: 0xffbe3b,
    blockRewards: [
      { b: 9, qty: 6 },
      { b: 4, qty: 4 },
      { b: 8, qty: 2 },
      { b: 1, qty: 4 },
    ],
    coinReward: 95,
  },
};

function pickKind(h: number): ResourceNodeKind {
  if (h < 0.34) return 'wood_grove';
  if (h < 0.66) return 'stone_quarry';
  if (h < 0.86) return 'neon_crystal';
  return 'supply_drop';
}

function makeNode(
  id: string,
  kind: ResourceNodeKind,
  wx: number,
  ws: number,
  cooldown: number
): ResourceNode {
  const tpl = NODE_TEMPLATES[kind];
  const wrappedWs = wrapTrackS(ws);
  const wy = openWorldGroundY(wx, wrappedWs);
  return {
    id,
    kind,
    zhName: tpl.zhName,
    enName: tpl.enName,
    wx,
    wy,
    ws: wrappedWs,
    colorHex: tpl.colorHex,
    blockRewards: tpl.blockRewards.map((r) => ({ b: r.b, qty: r.qty })),
    coinReward: tpl.coinReward,
    cooldown,
    maxCooldown: NODE_COOLDOWN_SEC,
  };
}

/**
 * Deterministic infinite/cyclic Natural World Resource Node manager.
 * Spawns harvestable timber groves, stone quarries, neon crystals, and supply drops
 * both along roadside clearings and across the infinite hills & valleys.
 */
export class ResourceNodeManager {
  private readonly cooldowns = new Map<string, number>();
  private activeNodes: ResourceNode[] = [];
  private readonly activeById = new Map<string, ResourceNode>();
  private lastAnchorWx = Number.NaN;
  private lastAnchorWs = Number.NaN;

  update(dt: number, originWx: number, originWs: number): void {
    const step = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;

    // 1. Tick down all cooldown timers cleanly
    if (step > 0 && this.cooldowns.size > 0) {
      for (const [id, rem] of this.cooldowns) {
        const next = rem - step;
        if (next <= 0) {
          this.cooldowns.delete(id);
        } else {
          this.cooldowns.set(id, next);
        }
      }
    }

    // 2. Rebuild active node window when player moves > 18m (or on first update)
    const movedS = Number.isNaN(this.lastAnchorWs)
      ? Infinity
      : Math.abs(signedTrackDelta(originWs, this.lastAnchorWs));
    const movedX = Number.isNaN(this.lastAnchorWx)
      ? Infinity
      : Math.abs(originWx - this.lastAnchorWx);

    if (movedS > 18 || movedX > 18) {
      this.rebuildActiveNodes(originWx, originWs);
      this.lastAnchorWx = originWx;
      this.lastAnchorWs = originWs;
    } else {
      // Sync cooldown numbers on active nodes in-place (zero allocations)
      for (let i = 0; i < this.activeNodes.length; i++) {
        const node = this.activeNodes[i];
        node.cooldown = this.cooldowns.get(node.id) ?? 0;
      }
    }
  }

  getActiveNodes(): readonly ResourceNode[] {
    return this.activeNodes;
  }

  getNearbyNode(wx: number, ws: number, maxDist = 4.8): ResourceNode | null {
    const maxDistSq = maxDist * maxDist;
    let bestReady: ResourceNode | null = null;
    let bestReadyD2 = maxDistSq;
    let bestAny: ResourceNode | null = null;
    let bestAnyD2 = maxDistSq;

    for (let i = 0; i < this.activeNodes.length; i++) {
      const n = this.activeNodes[i];
      const dx = n.wx - wx;
      const ds = signedTrackDelta(n.ws, ws);
      const d2 = dx * dx + ds * ds;
      if (d2 <= maxDistSq) {
        if (n.cooldown <= 0 && d2 < bestReadyD2) {
          bestReadyD2 = d2;
          bestReady = n;
        }
        if (d2 < bestAnyD2) {
          bestAnyD2 = d2;
          bestAny = n;
        }
      }
    }

    return bestReady ?? bestAny;
  }

  harvestNode(id: string): HarvestResult | null {
    const node = this.activeById.get(id);
    if (!node) return null;
    const rem = this.cooldowns.get(id) ?? 0;
    if (rem > 0) return null;

    this.cooldowns.set(id, node.maxCooldown);
    node.cooldown = node.maxCooldown;

    return {
      node,
      blockRewards: node.blockRewards.map((r) => ({ b: r.b, qty: r.qty })),
      coinReward: node.coinReward,
    };
  }

  private rebuildActiveNodes(originWx: number, originWs: number): void {
    const nextList: ResourceNode[] = [];
    this.activeById.clear();

    const wrappedOriginS = wrapTrackS(originWs);

    // A. Deterministic roadside clearing nodes (30 per 2400m loop)
    for (let wSlot = 0; wSlot < ROAD_SLOTS_PER_LAP; wSlot++) {
      const hPos = hash1(wSlot * 173 + 31);
      const ws = wrapTrackS(wSlot * ROAD_SLOT_STEP + 18 + hPos * 36);
      const ds = signedTrackDelta(ws, wrappedOriginS);
      if (Math.abs(ds) > ACTIVE_RANGE) continue;

      // Avoid landmarks: gas stations (~420, 1620 right), diners (~900, 2100 left), craft outpost (~44 right)
      const hSide = hash1(wSlot * 419 + 7);
      let side = hSide < 0.5 ? -1 : 1;
      if (wSlot === 0) side = -1; // welcoming starter clearing opposite the craft outpost
      if ((Math.abs(ws - 420) < 35 || Math.abs(ws - 1620) < 35) && side > 0) side = -1;
      if ((Math.abs(ws - 900) < 35 || Math.abs(ws - 2100) < 35) && side < 0) side = 1;

      const latOffset = 16.5 + hash1(wSlot * 911 + 13) * 16.0;
      const wx = roadX(ws) + side * latOffset;
      if (Math.abs(wx - originWx) > ACTIVE_RANGE) continue;

      const kind = wSlot === 0 ? 'supply_drop' : pickKind(hash1(wSlot * 613 + 97));
      const id = `road_${wSlot}`;
      const node = makeNode(id, kind, wx, ws, this.cooldowns.get(id) ?? 0);
      nextList.push(node);
      this.activeById.set(id, node);
    }

    // B. Infinite open-world wilderness nodes across rolling hills & valleys
    const centerCellX = Math.floor(originWx / WILD_NODE_CELL);
    const centerCellS = Math.floor(originWs / WILD_NODE_CELL);
    const cellRadius = 2; // ±192m..288m coverage

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      const rawCellS = centerCellS + dz;
      const wrappedCellS = ((rawCellS % WILD_CELLS_PER_LAP) + WILD_CELLS_PER_LAP) % WILD_CELLS_PER_LAP;
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const cellX = centerCellX + dx;
        const seed = Math.imul(cellX, 73856093) ^ Math.imul(wrappedCellS, 19349663) ^ 0x517cc1b7;
        const hSpawn = hash1(seed);
        if (hSpawn > 0.44) continue;

        const hx = hash1(seed + 19);
        const hs = hash1(seed + 59);
        const wx = (cellX + 0.16 + hx * 0.68) * WILD_NODE_CELL;
        const ws = wrapTrackS((wrappedCellS + 0.16 + hs * 0.68) * WILD_NODE_CELL);

        // Keep outside highway & roadside clearing band
        if (Math.abs(wx - roadX(ws)) < 46) continue;
        if (Math.abs(wx - originWx) > ACTIVE_RANGE) continue;
        if (Math.abs(signedTrackDelta(ws, wrappedOriginS)) > ACTIVE_RANGE) continue;

        const id = `wild_${cellX}_${wrappedCellS}`;
        if (this.activeById.has(id)) continue;

        const kind = pickKind(hash1(seed + 131));
        const node = makeNode(id, kind, wx, ws, this.cooldowns.get(id) ?? 0);
        nextList.push(node);
        this.activeById.set(id, node);
      }
    }

    this.activeNodes = nextList;
  }
}
