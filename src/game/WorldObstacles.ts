import {
  RoadFrame,
  SHOULDER_HALF_WIDTH,
  TRACK_LENGTH,
  getBiomeAt,
  hash1,
  openWorldGroundY,
  roadX,
  roadY,
  sampleRoadFrame,
  signedTrackDelta,
} from './RoadMath';

export interface StaticObstacle {
  wx: number;
  ws: number;
  wy: number;
  halfX: number;
  halfZ: number;
  height: number;
  kind: 'tree' | 'rock' | 'building' | 'pole';
}

const SLOT_STEP = 12.0;
const SLOTS_PER_LAP = 200; // 2400 / 12
const WILD_CELL = 36.0;
const WILD_CELLS_PER_LAP = Math.round(TRACK_LENGTH / WILD_CELL); // 67 (matches WorldRenderer.ts)

const GAS_STATION_STOPS = [420, 1620] as const;
const DINER_STOPS = [900, 2100] as const;

// Pre-allocated scratch RoadFrame & object pool for strictly zero-GC lookups
const _frame: RoadFrame = {
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  ty: 0,
  tz: -1,
  rx: 1,
  ry: 0,
  rz: 0,
  ux: 0,
  uy: 1,
  uz: 0,
  curvature: 0,
  tangentLen: 1,
  bank: 0,
};

const _pool: StaticObstacle[] = [];

function emitObstacle(
  out: StaticObstacle[],
  count: number,
  wx: number,
  ws: number,
  wy: number,
  halfX: number,
  halfZ: number,
  height: number,
  kind: StaticObstacle['kind']
): number {
  let item = _pool[count];
  if (!item) {
    item = { wx: 0, ws: 0, wy: 0, halfX: 0, halfZ: 0, height: 0, kind: 'tree' };
    _pool[count] = item;
  }
  item.wx = wx;
  item.ws = ws;
  item.wy = wy;
  item.halfX = halfX;
  item.halfZ = halfZ;
  item.height = height;
  item.kind = kind;
  out[count] = item;
  return count + 1;
}

/**
 * Helper to emit a box specified in a roadside landmark's local Three.js group coordinates
 * (where +X is road right `f.r`, +Y is road up `f.u`, +Z is road backward `-f.t`).
 */
function emitLandmarkLocalBox(
  out: StaticObstacle[],
  count: number,
  f: RoadFrame,
  baseWx: number,
  baseWy: number,
  baseWs: number,
  lx: number,
  lyBottom: number,
  lz: number,
  localHalfX: number,
  localHalfZ: number,
  height: number,
  kind: StaticObstacle['kind'],
  queryWx: number,
  queryWs: number,
  radiusM: number
): number {
  // World offset from group origin (Three.js +Z maps to -ws)
  const ox = baseWx + lx * f.rx - lz * f.tx;
  const oy = baseWy + lx * f.ry - lz * f.ty + lyBottom;
  const os = baseWs - lx * f.rz + lz * f.tz;

  // Conservative rotated XZ AABB half-extents for the sub-box
  const halfX = localHalfX * Math.abs(f.rx) + localHalfZ * Math.abs(f.tx);
  const halfZ = localHalfX * Math.abs(f.rz) + localHalfZ * Math.abs(f.tz);

  if (
    Math.abs(ox - queryWx) > radiusM + halfX + 1.5 ||
    Math.abs(signedTrackDelta(os, queryWs)) > radiusM + halfZ + 1.5
  ) {
    return count;
  }

  return emitObstacle(out, count, ox, os, oy, halfX, halfZ, height, kind);
}

/**
 * Populates `out` with all deterministic static world obstacles within `radiusM` of `(wx, ws)`:
 * 1. Roadside trees & canyon rocks (matching WorldRenderer.updateProps)
 * 2. Infinite wilderness trees & boulders (matching WorldRenderer.updateWildernessProps)
 * 3. Chinese roadside gas stations at s = 420m, 1620m (store, pillars, fuel islands)
 * 4. Chinese roadside diners at s = 900m, 2100m (building, awning poles, outdoor tables)
 * 5. Roadside shoulder posts (matching WorldRenderer.updateProps)
 *
 * Reuses pooled StaticObstacle instances into `out` with zero per-call heap allocations.
 */
export function collectNearbyStaticObstacles(
  wx: number,
  ws: number,
  radiusM: number,
  out: StaticObstacle[]
): void {
  let count = 0;
  const pad = radiusM + 10.0;

  // 1. Roadside trees, canyon rocks & shoulder posts (slotStep = 12.0, 200 slots/lap)
  const minSlot = Math.floor((ws - pad) / SLOT_STEP);
  const maxSlot = Math.floor((ws + pad) / SLOT_STEP);

  for (let slot = minSlot; slot <= maxSlot; slot++) {
    const s = slot * SLOT_STEP;
    const wSlot = ((slot % SLOTS_PER_LAP) + SLOTS_PER_LAP) % SLOTS_PER_LAP;
    const biome = getBiomeAt(s);
    sampleRoadFrame(s, _frame);

    for (let side = -1; side <= 1; side += 2) {
      const isCraftOutpostZone = side > 0 && wSlot >= 2 && wSlot <= 6;

      // 5. Roadside shoulder posts (every 4th slot = 48m spacing, wide open gaps)
      if (!isCraftOutpostZone && wSlot % 4 === 0) {
        const lat = side * (SHOULDER_HALF_WIDTH - 0.4);
        const px = _frame.x + _frame.rx * lat;
        const py = _frame.y + _frame.ry * lat;
        const ps = s - _frame.rz * lat;
        if (Math.abs(px - wx) <= radiusM + 1.0 && Math.abs(ps - ws) <= radiusM + 1.0) {
          count = emitObstacle(out, count, px, ps, py, 0.35, 0.35, 1.3, 'pole');
        }
      }

      const h = hash1(wSlot * 37 + (side > 0 ? 101 : 211));
      const h2 = hash1(wSlot * 71 + (side > 0 ? 19 : 83));
      const dist = SHOULDER_HALF_WIDTH + 6.5 + h2 * 44.0;

      if (!isCraftOutpostZone && h < 0.62) {
        const sc = 0.85 + h2 * 0.65;
        const ox = _frame.x + side * dist;
        if (Math.abs(ox - wx) <= radiusM + 6.5 && Math.abs(s - ws) <= radiusM + 6.5) {
          const oy = openWorldGroundY(ox, s) - 0.15;
          if (biome === 2 && h < 0.46) {
            // Canyon rock mesa: BoxGeometry(6.8, 7.5, 6.4) scaled by (sc*1.4, sc*(1.2+h*1.8), sc*1.2)
            const rHalf = 2.8 * sc;
            const rHeight = 7.2 * sc * (1.2 + h * 1.8);
            count = emitObstacle(out, count, ox, s, oy, rHalf, rHalf, rHeight, 'rock');
          } else {
            // Palm or pine tree trunk: BoxGeometry(0.95, 5.2, 0.95) scaled by sc
            const tHalf = 0.65 * sc;
            const tHeight = 5.4 * sc;
            count = emitObstacle(out, count, ox, s, oy, tHalf, tHalf, tHeight, 'tree');
          }
        }
      } else if (!isCraftOutpostZone && h > 0.84) {
        const ox = _frame.x + side * (dist + 18);
        if (Math.abs(ox - wx) <= radiusM + 6.5 && Math.abs(s - ws) <= radiusM + 6.5) {
          const oy = openWorldGroundY(ox, s) - 0.25;
          const rSc = 0.8 + h2;
          const rHalf = 2.4 * rSc;
          const rHeight = 7.0 * (0.7 + h2 * 1.3);
          count = emitObstacle(out, count, ox, s, oy, rHalf, rHalf, rHeight, 'rock');
        }
      }
    }
  }

  // 2. Infinite wilderness trees & boulders (36m grid, skipped within 56m of road centerline)
  const minCellX = Math.floor((wx - pad) / WILD_CELL);
  const maxCellX = Math.floor((wx + pad) / WILD_CELL);
  const minCellS = Math.floor((ws - pad) / WILD_CELL);
  const maxCellS = Math.floor((ws + pad) / WILD_CELL);

  for (let cellS = minCellS; cellS <= maxCellS; cellS++) {
    const wrappedCellS = ((cellS % WILD_CELLS_PER_LAP) + WILD_CELLS_PER_LAP) % WILD_CELLS_PER_LAP;
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const seed = Math.imul(cellX, 73856093) ^ Math.imul(wrappedCellS, 19349663);
      const h1 = hash1(seed);
      if (h1 > 0.56) continue;

      const h2 = hash1(seed + 17);
      const h3 = hash1(seed + 53);
      const ox = (cellX + 0.15 + h2 * 0.7) * WILD_CELL;
      const os = (cellS + 0.15 + h3 * 0.7) * WILD_CELL;

      if (Math.abs(ox - wx) > radiusM + 7.0 || Math.abs(os - ws) > radiusM + 7.0) continue;
      if (Math.abs(ox - roadX(os)) < 56) continue;

      const oy = openWorldGroundY(ox, os);
      const relH = oy - roadY(os);

      if (relH > 20 || h1 > 0.42) {
        const sc = 0.8 + h2 * 1.1;
        const rHalf = 2.4 * sc;
        const rHeight = 7.0 * sc * (0.7 + h1 * 1.2);
        count = emitObstacle(out, count, ox, os, oy - 0.5, rHalf, rHalf, rHeight, 'rock');
      } else {
        const sc = 0.9 + h2 * 0.85;
        const tHalf = 0.65 * sc;
        const tHeight = 5.4 * sc;
        count = emitObstacle(out, count, ox, os, oy - 0.25, tHalf, tHalf, tHeight, 'tree');
      }
    }
  }

  // 3. Roadside Gas Stations at cyclic s = 420m & 1620m, lateral x = +17.5m
  for (let i = 0; i < GAS_STATION_STOPS.length; i++) {
    const stopS = GAS_STATION_STOPS[i];
    const ds = signedTrackDelta(stopS, ws);
    if (Math.abs(ds) > radiusM + 22.0) continue;

    sampleRoadFrame(stopS, _frame);
    const unwrappedStopS = ws + ds;
    const baseWx = _frame.x + _frame.rx * 17.5;
    const baseWy = _frame.y + _frame.ry * 17.5;
    const baseWs = unwrappedStopS - _frame.rz * 17.5;
    if (Math.abs(baseWx - wx) > radiusM + 16.0) continue;

    // 24H convenience store booth: Box(5.2, 4.0, 11.2) at local (5.4, 2.0, 0)
    // Split into 3 sub-boxes along local Z so rotated footprint hugs the exact building walls
    for (let k = -1; k <= 1; k++) {
      count = emitLandmarkLocalBox(
        out, count, _frame, baseWx, baseWy, baseWs,
        5.4, 0, k * 3.7, 2.6, 1.9, 4.0, 'building', wx, ws, radiusM
      );
    }

    // 4 steel canopy support pillars: w=0.55, h=5.0, d=0.55 at (±x, ±z)
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, -3.2, 0, -4.6, 0.34, 0.34, 5.0, 'building', wx, ws, radiusM);
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, 2.2, 0, -4.6, 0.34, 0.34, 5.0, 'building', wx, ws, radiusM);
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, -3.2, 0, 4.6, 0.34, 0.34, 5.0, 'building', wx, ws, radiusM);
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, 2.2, 0, 4.6, 0.34, 0.34, 5.0, 'building', wx, ws, radiusM);

    // 2 fuel dispenser islands: w=1.15, h=1.85, d=2.2 at (-1.6, 0.92, ±2.6)
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, -1.6, 0, -2.6, 0.62, 1.12, 1.85, 'building', wx, ws, radiusM);
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, -1.6, 0, 2.6, 0.62, 1.12, 1.85, 'building', wx, ws, radiusM);
  }

  // 4. Roadside Diners at cyclic s = 900m & 2100m, lateral x = -17.5m
  for (let i = 0; i < DINER_STOPS.length; i++) {
    const stopS = DINER_STOPS[i];
    const ds = signedTrackDelta(stopS, ws);
    if (Math.abs(ds) > radiusM + 22.0) continue;

    sampleRoadFrame(stopS, _frame);
    const unwrappedStopS = ws + ds;
    const baseWx = _frame.x - _frame.rx * 17.5;
    const baseWy = _frame.y - _frame.ry * 17.5;
    const baseWs = unwrappedStopS + _frame.rz * 17.5;
    if (Math.abs(baseWx - wx) > radiusM + 16.0) continue;

    // Main diner building: Box(8.0, 4.6, 13.6) at local (-2.4, 2.3, 0)
    // Split into 3 sub-boxes along local Z so rotated footprint hugs the exact walls
    for (let k = -1; k <= 1; k++) {
      count = emitLandmarkLocalBox(
        out, count, _frame, baseWx, baseWy, baseWs,
        -2.4, 0, k * 4.5, 4.0, 2.3, 4.6, 'building', wx, ws, radiusM
      );
    }

    // 2 awning support poles: w=0.25, h=3.5, d=0.25 at (5.2, 1.75, ±6.2)
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, 5.2, 0, -6.2, 0.25, 0.25, 3.5, 'building', wx, ws, radiusM);
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, 5.2, 0, 6.2, 0.25, 0.25, 3.5, 'building', wx, ws, radiusM);

    // 2 outdoor dining tables + stools at (3.4, 0.42, ±3.2)
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, 3.4, 0, -3.2, 1.0, 0.72, 0.85, 'building', wx, ws, radiusM);
    count = emitLandmarkLocalBox(out, count, _frame, baseWx, baseWy, baseWs, 3.4, 0, 3.2, 1.0, 0.72, 0.85, 'building', wx, ws, radiusM);
  }

  out.length = count;
}
