import * as THREE from 'three';

export const ROAD_HALF_WIDTH = 7.6;
export const CURB_WIDTH = 0.65;
export const SHOULDER_HALF_WIDTH = 11.2;
export const MAX_LATERAL = 10.4;
export const LANE_CENTERS = [-5.6, -1.9, 1.9, 5.6] as const;

export const TRACK_LENGTH = 2400; // Seamless 2400m cyclic circuit (4 × 600m biomes)
const HALF_TRACK = TRACK_LENGTH * 0.5;
const TWO_PI_L = (Math.PI * 2) / TRACK_LENGTH;
const W2 = 2 * TWO_PI_L;
const W5 = 5 * TWO_PI_L;
const W9 = 9 * TWO_PI_L;
const W10 = 10 * TWO_PI_L;

export type BiomeId = 0 | 1 | 2 | 3; // 0: Coastal Sunset, 1: Pine Highland, 2: Red Canyon, 3: Twilight Neon

/**
 * Wraps any unwrapped track distance `s` onto the cyclic circuit `[0, TRACK_LENGTH)`.
 */
export function wrapTrackS(s: number): number {
  const m = s % TRACK_LENGTH;
  return m < 0 ? m + TRACK_LENGTH : m;
}

/**
 * Shortest signed longitudinal delta from `originS` to `targetS` on the 2400m ring,
 * returning a value in `[-TRACK_LENGTH / 2, +TRACK_LENGTH / 2)`.
 */
export function signedTrackDelta(targetS: number, originS: number): number {
  let d = (targetS - originS) % TRACK_LENGTH;
  if (d >= HALF_TRACK) d -= TRACK_LENGTH;
  else if (d < -HALF_TRACK) d += TRACK_LENGTH;
  return d;
}

/**
 * 1-based lap number for an unwrapped track distance `s`.
 */
export function getLapNumber(s: number): number {
  return Math.floor(Math.max(0, s) / TRACK_LENGTH) + 1;
}

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
 * Deterministic O(1) strictly periodic 3D cyclic highway centerline (period = TRACK_LENGTH = 2400m).
 * Integer harmonics guarantee C∞ smoothness across the 2400m -> 0m lap seam!
 */
export function roadX(s: number): number {
  return (
    38.0 * Math.sin(s * W2) +
    22.0 * Math.sin(s * W5 + 1.35) +
    9.5 * Math.cos(s * W9 - 0.5)
  );
}

export function roadDX(s: number): number {
  return (
    38.0 * W2 * Math.cos(s * W2) +
    22.0 * W5 * Math.cos(s * W5 + 1.35) -
    9.5 * W9 * Math.sin(s * W9 - 0.5)
  );
}

export function roadD2X(s: number): number {
  return (
    -38.0 * W2 * W2 * Math.sin(s * W2) -
    22.0 * W5 * W5 * Math.sin(s * W5 + 1.35) -
    9.5 * W9 * W9 * Math.cos(s * W9 - 0.5)
  );
}

export function roadY(s: number): number {
  return (
    8.5 * Math.sin(s * W2 + 0.4) +
    4.0 * Math.sin(s * W5) +
    1.6 * Math.cos(s * W10)
  );
}

export function roadDY(s: number): number {
  return (
    8.5 * W2 * Math.cos(s * W2 + 0.4) +
    4.0 * W5 * Math.cos(s * W5) -
    1.6 * W10 * Math.sin(s * W10)
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
 * Converts road-relative coordinates using an already-sampled RoadFrame into floating-origin world position.
 * Avoids duplicate trigonometric evaluations when sampleRoadFrame(s) was already called for the same `s`.
 */
export function roadFrameToLocalWorld(
  f: RoadFrame,
  s: number,
  lateralX: number,
  heightY: number,
  originS: number,
  originX: number,
  originY: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const ds = signedTrackDelta(s, originS);
  out.set(
    f.x - originX + f.rx * lateralX + f.ux * heightY,
    f.y - originY + f.ry * lateralX + f.uy * heightY,
    -ds + f.rz * lateralX + f.uz * heightY
  );
  return out;
}

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
  return roadFrameToLocalWorld(_tmpFrame, s, lateralX, heightY, originS, originX, originY, out);
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
  const seg = Math.floor(wrapTrackS(s) / (TRACK_LENGTH / 4)) % 4;
  return seg as BiomeId;
}

/**
 * Deterministic cyclic boost pad check (2400 / 24 = 100 exact slots per lap).
 */
export function getBoostPadInSlot(slotIndex: number): { s: number; x: number } | null {
  const wSlot = ((slotIndex % 100) + 100) % 100;
  if (wSlot < 2) return null;
  if (wSlot % 11 !== 4) return null;
  const h = hash1(wSlot * 9173 + 17);
  const laneIdx = Math.floor(h * 4);
  return {
    s: slotIndex * 24 + 12,
    x: LANE_CENTERS[laneIdx],
  };
}
