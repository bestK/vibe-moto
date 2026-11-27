import * as THREE from 'three';

export const ROAD_HALF_WIDTH = 7.6;
export const CURB_WIDTH = 0.65;
export const SHOULDER_HALF_WIDTH = 11.2;
export const MAX_LATERAL = 10.4;
export const LANE_CENTERS = [-5.6, -1.9, 1.9, 5.6] as const;

export type BiomeId = 0 | 1 | 2 | 3; // 0: Coastal Sunset, 1: Pine Highland, 2: Red Canyon, 3: Twilight Neon

export interface RoadFrame {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  curvature: number;
  tangentLen: number;
  bank: number;
}

/**
 * Deterministic O(1) parametric 3D highway centerline.
 * Every connected multiplayer client computes identical curves, hills, and biomes at every meter `s`.
 */
export function roadX(s: number): number {
  return (
    38.0 * Math.sin(s * 0.0041) +
    22.0 * Math.sin(s * 0.0103 + 1.35) +
    9.5 * Math.cos(s * 0.0191 - 0.5)
  );
}

export function roadDX(s: number): number {
  return (
    38.0 * 0.0041 * Math.cos(s * 0.0041) +
    22.0 * 0.0103 * Math.cos(s * 0.0103 + 1.35) -
    9.5 * 0.0191 * Math.sin(s * 0.0191 - 0.5)
  );
}

export function roadD2X(s: number): number {
  return (
    -38.0 * 0.0041 * 0.0041 * Math.sin(s * 0.0041) -
    22.0 * 0.0103 * 0.0103 * Math.sin(s * 0.0103 + 1.35) -
    9.5 * 0.0191 * 0.0191 * Math.cos(s * 0.0191 - 0.5)
  );
}

export function roadY(s: number): number {
  return (
    8.5 * Math.sin(s * 0.0052 + 0.4) +
    4.0 * Math.sin(s * 0.0131) +
    1.6 * Math.cos(s * 0.0255)
  );
}

export function roadDY(s: number): number {
  return (
    8.5 * 0.0052 * Math.cos(s * 0.0052 + 0.4) +
    4.0 * 0.0131 * Math.cos(s * 0.0131) -
    1.6 * 0.0255 * Math.sin(s * 0.0255)
  );
}

export function roadTangentLength(s: number): number {
  const dx = roadDX(s);
  const dy = roadDY(s);
  return Math.sqrt(dx * dx + dy * dy + 1.0);
}

/**
 * Exact `ds` corresponding to `meters` true 3D Euclidean arc length along the highway at position `s`.
 * Ensures a newly joined player spawns accurately ~5.0m behind the last player.
 */
export function dsForMeters(s: number, meters: number): number {
  const len = roadTangentLength(s);
  return meters / len;
}

/**
 * Populates a pre-allocated RoadFrame with zero allocations.
 */
export function sampleRoadFrame(s: number, out: RoadFrame): RoadFrame {
  const x = roadX(s);
  const y = roadY(s);
  const z = -s;

  const dx = roadDX(s);
  const dy = roadDY(s);
  const dz = -1.0;

  const tLen = Math.sqrt(dx * dx + dy * dy + 1.0);
  const invT = 1.0 / tLen;
  const tx = dx * invT;
  const ty = dy * invT;
  const tz = dz * invT;

  // Right = normalize(cross(T, (0,1,0))) = normalize(-tz, 0, tx)
  const rLen = Math.sqrt(tz * tz + tx * tx);
  const invR = 1.0 / rLen;
  let rx = -tz * invR;
  let ry = 0;
  let rz = tx * invR;

  // Up = cross(R, T)
  let ux = ry * tz - rz * ty;
  let uy = rz * tx - rx * tz;
  let uz = rx * ty - ry * tx;

  const curvature = roadD2X(s);
  const bank = Math.max(-0.085, Math.min(0.085, -curvature * 32.0));
  if (Math.abs(bank) > 0.0001) {
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    const nrx = rx * cb + ux * sb;
    const nry = ry * cb + uy * sb;
    const nrz = rz * cb + uz * sb;
    const nux = ux * cb - rx * sb;
    const nuy = uy * cb - ry * sb;
    const nuz = uz * cb - rz * sb;
    rx = nrx; ry = nry; rz = nrz;
    ux = nux; uy = nuy; uz = nuz;
  }

  out.x = x;
  out.y = y;
  out.z = z;
  out.tx = tx;
  out.ty = ty;
  out.tz = tz;
  out.rx = rx;
  out.ry = ry;
  out.rz = rz;
  out.ux = ux;
  out.uy = uy;
  out.uz = uz;
  out.curvature = curvature;
  out.tangentLen = tLen;
  out.bank = bank;
  return out;
}

const _tmpFrame: RoadFrame = {
  x: 0, y: 0, z: 0,
  tx: 0, ty: 0, tz: -1,
  rx: 1, ry: 0, rz: 0,
  ux: 0, uy: 1, uz: 0,
  curvature: 0, tangentLen: 1, bank: 0,
};

/**
 * Converts road-relative coordinates (s, lateralX, heightY) into floating-origin world position.
 * Keeps WebGL Float32 coordinates tiny even at s = 1,000,000m.
 */
export function roadToLocalWorld(
  s: number,
  lateralX: number,
  heightY: number,
  originS: number,
  originX: number,
  originY: number,
  out: THREE.Vector3
): THREE.Vector3 {
  sampleRoadFrame(s, _tmpFrame);
  out.set(
    _tmpFrame.x - originX + _tmpFrame.rx * lateralX + _tmpFrame.ux * heightY,
    _tmpFrame.y - originY + _tmpFrame.ry * lateralX + _tmpFrame.uy * heightY,
    -(s - originS) + _tmpFrame.rz * lateralX + _tmpFrame.uz * heightY
  );
  return out;
}

/**
 * Deterministic fast integer hash in [0, 1).
 */
export function hash1(n: number): number {
  let x = (n | 0) ^ 0x27d4eb2d;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

export function getBiomeAt(s: number): BiomeId {
  const seg = Math.floor(Math.max(0, s) / 1400) % 4;
  return seg as BiomeId;
}

/**
 * Deterministic boost pad check: returns lane lateral X if there is a speed pad near `s`, else null.
 */
export function getBoostPadInSlot(slotIndex: number): { s: number; x: number } | null {
  if (slotIndex < 2) return null;
  if (slotIndex % 11 !== 4) return null;
  const h = hash1(slotIndex * 9173 + 17);
  const laneIdx = Math.floor(h * 4);
  return {
    s: slotIndex * 24 + 12,
    x: LANE_CENTERS[laneIdx],
  };
}
