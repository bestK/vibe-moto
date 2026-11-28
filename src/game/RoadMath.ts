import * as THREE from 'three';

export const ROAD_HALF_WIDTH = 7.6;
export const CURB_WIDTH = 0.65;
export const SHOULDER_HALF_WIDTH = 11.2;
export const MAX_LATERAL = 10.4;
export const OPEN_WORLD_MAX_LATERAL = 112.0;
export const OPEN_WORLD_TERRAIN_FLAT = 120.0;
export const OPEN_WORLD_TERRAIN_FAR = 196.0;
export const LANE_CENTERS = [-5.6, -1.9, 1.9, 5.6] as const;

export const TRACK_LENGTH = 2400; // Seamless 2400m cyclic circuit (4 × 600m biomes)
const HALF_TRACK = TRACK_LENGTH * 0.5;
const TWO_PI_L = (Math.PI * 2) / TRACK_LENGTH;
const W2 = 2 * TWO_PI_L;
const W5 = 5 * TWO_PI_L;
const W9 = 9 * TWO_PI_L;
const W10 = 10 * TWO_PI_L;

// Precomputed 480-sample periodic road LUT (~24 KB RAM) replaces ~500 trig calls/frame with fast O(1) lerp!
const LUT_STEPS = 480;
const LUT_INV_STEP = LUT_STEPS / TRACK_LENGTH; // 0.2 samples per meter (5m spacing)
const LUT_X = new Float32Array(LUT_STEPS);
const LUT_Y = new Float32Array(LUT_STEPS);
const LUT_TX = new Float32Array(LUT_STEPS);
const LUT_TY = new Float32Array(LUT_STEPS);
const LUT_TZ = new Float32Array(LUT_STEPS);
const LUT_RX = new Float32Array(LUT_STEPS);
const LUT_RY = new Float32Array(LUT_STEPS);
const LUT_RZ = new Float32Array(LUT_STEPS);
const LUT_UX = new Float32Array(LUT_STEPS);
const LUT_UY = new Float32Array(LUT_STEPS);
const LUT_UZ = new Float32Array(LUT_STEPS);
const LUT_CURV = new Float32Array(LUT_STEPS);
const LUT_TLEN = new Float32Array(LUT_STEPS);
const LUT_BANK = new Float32Array(LUT_STEPS);

let _lutReady = false;
function ensureRoadLut(): void {
  if (_lutReady) return;
  _lutReady = true;
  for (let i = 0; i < LUT_STEPS; i++) {
    const s = (i / LUT_STEPS) * TRACK_LENGTH;
    const x =
      38.0 * Math.sin(s * W2) +
      22.0 * Math.sin(s * W5 + 1.35) +
      9.5 * Math.cos(s * W9 - 0.5);
    const dx =
      38.0 * W2 * Math.cos(s * W2) +
      22.0 * W5 * Math.cos(s * W5 + 1.35) -
      9.5 * W9 * Math.sin(s * W9 - 0.5);
    const curv =
      -38.0 * W2 * W2 * Math.sin(s * W2) -
      22.0 * W5 * W5 * Math.sin(s * W5 + 1.35) -
      9.5 * W9 * W9 * Math.cos(s * W9 - 0.5);
    const y =
      8.5 * Math.sin(s * W2 + 0.4) +
      4.0 * Math.sin(s * W5) +
      1.6 * Math.cos(s * W10);
    const dy =
      8.5 * W2 * Math.cos(s * W2 + 0.4) +
      4.0 * W5 * Math.cos(s * W5) -
      1.6 * W10 * Math.sin(s * W10);
    const dz = -1.0;

    const tLen = Math.sqrt(dx * dx + dy * dy + 1.0);
    const invT = 1.0 / tLen;
    const tx = dx * invT;
    const ty = dy * invT;
    const tz = dz * invT;

    const rLen = Math.sqrt(tz * tz + tx * tx);
    const invR = 1.0 / rLen;
    let rx = -tz * invR;
    let ry = 0;
    let rz = tx * invR;

    let ux = ry * tz - rz * ty;
    let uy = rz * tx - rx * tz;
    let uz = rx * ty - ry * tx;

    const bank = Math.max(-0.085, Math.min(0.085, -curv * 32.0));
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

    LUT_X[i] = x;
    LUT_Y[i] = y;
    LUT_TX[i] = tx;
    LUT_TY[i] = ty;
    LUT_TZ[i] = tz;
    LUT_RX[i] = rx;
    LUT_RY[i] = ry;
    LUT_RZ[i] = rz;
    LUT_UX[i] = ux;
    LUT_UY[i] = uy;
    LUT_UZ[i] = uz;
    LUT_CURV[i] = curv;
    LUT_TLEN[i] = tLen;
    LUT_BANK[i] = bank;
  }
}

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
  ensureRoadLut();
  const f = wrapTrackS(s) * LUT_INV_STEP;
  const i0 = f | 0;
  const i1 = i0 + 1 < LUT_STEPS ? i0 + 1 : 0;
  const frac = f - i0;
  return LUT_X[i0] + (LUT_X[i1] - LUT_X[i0]) * frac;
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
  ensureRoadLut();
  const f = wrapTrackS(s) * LUT_INV_STEP;
  const i0 = f | 0;
  const i1 = i0 + 1 < LUT_STEPS ? i0 + 1 : 0;
  const frac = f - i0;
  return LUT_Y[i0] + (LUT_Y[i1] - LUT_Y[i0]) * frac;
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
 * Populates a pre-allocated RoadFrame with zero allocations using the O(1) periodic LUT.
 */
export function sampleRoadFrame(s: number, out: RoadFrame): RoadFrame {
  ensureRoadLut();
  const f = wrapTrackS(s) * LUT_INV_STEP;
  const i0 = f | 0;
  const i1 = i0 + 1 < LUT_STEPS ? i0 + 1 : 0;
  const t = f - i0;

  out.x = LUT_X[i0] + (LUT_X[i1] - LUT_X[i0]) * t;
  out.y = LUT_Y[i0] + (LUT_Y[i1] - LUT_Y[i0]) * t;
  out.z = -s;
  out.tx = LUT_TX[i0] + (LUT_TX[i1] - LUT_TX[i0]) * t;
  out.ty = LUT_TY[i0] + (LUT_TY[i1] - LUT_TY[i0]) * t;
  out.tz = LUT_TZ[i0] + (LUT_TZ[i1] - LUT_TZ[i0]) * t;
  out.rx = LUT_RX[i0] + (LUT_RX[i1] - LUT_RX[i0]) * t;
  out.ry = LUT_RY[i0] + (LUT_RY[i1] - LUT_RY[i0]) * t;
  out.rz = LUT_RZ[i0] + (LUT_RZ[i1] - LUT_RZ[i0]) * t;
  out.ux = LUT_UX[i0] + (LUT_UX[i1] - LUT_UX[i0]) * t;
  out.uy = LUT_UY[i0] + (LUT_UY[i1] - LUT_UY[i0]) * t;
  out.uz = LUT_UZ[i0] + (LUT_UZ[i1] - LUT_UZ[i0]) * t;
  out.curvature = LUT_CURV[i0] + (LUT_CURV[i1] - LUT_CURV[i0]) * t;
  out.tangentLen = LUT_TLEN[i0] + (LUT_TLEN[i1] - LUT_TLEN[i0]) * t;
  out.bank = LUT_BANK[i0] + (LUT_BANK[i1] - LUT_BANK[i0]) * t;
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

export interface WorldAbsPos {
  wx: number;
  wy: number;
  ws: number;
}

/**
 * Converts road-relative (s, lateralX, heightY) to periodic Euclidean world coordinates (wx, wy, ws),
 * where ws preserves unwrapped lap distance and wraps mod TRACK_LENGTH for terrain/blocks.
 */
export function roadToWorldAbs(
  s: number,
  lateralX: number,
  heightY: number,
  out: WorldAbsPos
): WorldAbsPos {
  sampleRoadFrame(s, _tmpFrame);
  out.wx = _tmpFrame.x + _tmpFrame.rx * lateralX + _tmpFrame.ux * heightY;
  out.wy = _tmpFrame.y + _tmpFrame.ry * lateralX + _tmpFrame.uy * heightY;
  out.ws = s - _tmpFrame.rz * lateralX - _tmpFrame.uz * heightY;
  return out;
}

/**
 * Converts periodic Euclidean world coordinates (wx, wy, ws) into floating-origin local space.
 */
export function worldAbsToLocal(
  wx: number,
  wy: number,
  ws: number,
  originS: number,
  originX: number,
  originY: number,
  out: THREE.Vector3
): THREE.Vector3 {
  out.set(wx - originX, wy - originY, -signedTrackDelta(ws, originS));
  return out;
}

/**
 * Exact deterministic ground elevation in Euclidean world space at (wx, ws).
 * Matches the highway surface near the road, flat buildable plains out to ±120m,
 * and gentle scenic hills beyond ±120m.
 */
export function openWorldGroundY(wx: number, ws: number): number {
  sampleRoadFrame(ws, _tmpFrame);
  const lat = wx - _tmpFrame.x;
  const absLat = Math.abs(lat);
  const curbOuter = ROAD_HALF_WIDTH + CURB_WIDTH;

  if (absLat <= curbOuter) {
    return _tmpFrame.y + _tmpFrame.ry * lat;
  }

  const blendSpan = 3.2;
  if (absLat < curbOuter + blendSpan) {
    const t = (absLat - curbOuter) / blendSpan;
    const curbY = _tmpFrame.y + _tmpFrame.ry * (Math.sign(lat) * curbOuter);
    return curbY + (_tmpFrame.y - 0.02 - curbY) * t;
  }

  if (absLat <= OPEN_WORLD_TERRAIN_FLAT) {
    return _tmpFrame.y - 0.02;
  }

  const hillT = Math.min(
    1,
    (absLat - OPEN_WORLD_TERRAIN_FLAT) / (OPEN_WORLD_TERRAIN_FAR - OPEN_WORLD_TERRAIN_FLAT)
  );
  const hillPhase = (ws * Math.PI * 2) / TRACK_LENGTH;
  const hill = lat < 0 ? Math.sin(hillPhase * 6) * 5.0 + 4.0 : Math.cos(hillPhase * 5) * 5.0 + 2.5;
  return _tmpFrame.y - 0.02 + hill * hillT;
}

/**
 * Road forward yaw angle in Euclidean world XZ plane (0 = -Z forward, positive = left/CCW).
 */
export function roadForwardYaw(s: number): number {
  sampleRoadFrame(s, _tmpFrame);
  return Math.atan2(-_tmpFrame.tx, -_tmpFrame.tz);
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
