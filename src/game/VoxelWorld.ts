import * as THREE from 'three';
import {
  OPEN_WORLD_MAX_LATERAL,
  TRACK_LENGTH,
  openWorldGroundY,
  roadX,
  roadY,
  signedTrackDelta,
  wrapTrackS,
} from './RoadMath';

export type BlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface BlockSpec {
  id: BlockType;
  code: string;
  zhName: string;
  enName: string;
  particleHex: number;
  transparent?: boolean;
  emissive?: boolean;
}

export const BLOCK_SPECS: readonly BlockSpec[] = [
  { id: 1, code: 'GRASS', zhName: '草方块', enName: 'GRASS', particleHex: 0x5ab552 },
  { id: 2, code: 'STONE', zhName: '圆石', enName: 'STONE', particleHex: 0x8b95a5 },
  { id: 3, code: 'WOOD', zhName: '木板', enName: 'PLANKS', particleHex: 0xc89252 },
  { id: 4, code: 'BRICK', zhName: '红砖', enName: 'BRICK', particleHex: 0xc2543e },
  { id: 5, code: 'LOG', zhName: '原木', enName: 'LOG', particleHex: 0x6f4b2d },
  { id: 6, code: 'LEAF', zhName: '树叶', enName: 'LEAVES', particleHex: 0x3b9445 },
  { id: 7, code: 'GLASS', zhName: '玻璃', enName: 'GLASS', particleHex: 0x7de8ff, transparent: true },
  { id: 8, code: 'GLOW', zhName: '霓虹块', enName: 'NEON', particleHex: 0xffd166, emissive: true },
  { id: 9, code: 'ROAD', zhName: '赛道砖', enName: 'ASPHALT', particleHex: 0x3b4359 },
] as const;

export const BLOCK_SPEC_BY_ID: Record<BlockType, BlockSpec> = {
  1: BLOCK_SPECS[0],
  2: BLOCK_SPECS[1],
  3: BLOCK_SPECS[2],
  4: BLOCK_SPECS[3],
  5: BLOCK_SPECS[4],
  6: BLOCK_SPECS[5],
  7: BLOCK_SPECS[6],
  8: BLOCK_SPECS[7],
  9: BLOCK_SPECS[8],
};

export interface VoxelBlockEntry {
  gx: number;
  gy: number;
  gz: number; // wrapped integer in [0, TRACK_LENGTH)
  type: BlockType;
}

export interface VoxelRaycastHit {
  hitType: 'block' | 'ground';
  gx: number;
  gy: number;
  gz: number;
  placeX: number;
  placeY: number;
  placeZ: number;
  nx: number;
  ny: number;
  ns: number; // normal along +ws
  blockType: BlockType | null;
  distance: number;
}

const MAX_INSTANCES_PER_TYPE = 1024;
const RENDER_RANGE_S = 148;
const MIN_GY = -24;
const MAX_GY = 88;
const STORAGE_PREFIX = 'vibemoto_voxels_v1_';

export function wrapGridZ(gz: number): number {
  const m = Math.floor(gz) % TRACK_LENGTH;
  return m < 0 ? m + TRACK_LENGTH : m;
}

function makeKey(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}

function createPixelCanvas16(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function toBlockTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function hash2d(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function drawBlockFaceCanvas(
  type: BlockType,
  face: 'top' | 'side' | 'bottom'
): HTMLCanvasElement {
  const [c, ctx] = createPixelCanvas16();

  const fillNoise = (palette: readonly string[], seed: number): void => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const idx = Math.floor(hash2d(x, y, seed) * palette.length) % palette.length;
        ctx.fillStyle = palette[idx];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };

  switch (type) {
    case 1: {
      // Grass block
      if (face === 'top') {
        fillNoise(['#52b046', '#61c252', '#469c3c', '#72d160'], 11);
      } else if (face === 'bottom') {
        fillNoise(['#7a5436', '#8b6240', '#69462b', '#966c49'], 12);
      } else {
        fillNoise(['#7a5436', '#8b6240', '#69462b', '#966c49'], 13);
        for (let x = 0; x < 16; x++) {
          const drop = 3 + ((x * 7 + 3) % 3);
          for (let y = 0; y < drop; y++) {
            ctx.fillStyle = y === drop - 1 ? '#418f38' : y === 0 ? '#69c958' : '#52b046';
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }
      break;
    }
    case 2: {
      // Cobblestone
      fillNoise(['#7c8594', '#8e97a6', '#687180', '#9ea7b5'], 21);
      ctx.fillStyle = '#4e5563';
      ctx.fillRect(0, 4, 16, 1);
      ctx.fillRect(0, 10, 16, 1);
      ctx.fillRect(5, 0, 1, 4);
      ctx.fillRect(11, 5, 1, 5);
      ctx.fillRect(3, 11, 1, 5);
      ctx.fillRect(12, 11, 1, 5);
      ctx.fillStyle = '#b4bdc9';
      ctx.fillRect(1, 1, 3, 1);
      ctx.fillRect(7, 6, 3, 1);
      ctx.fillRect(5, 12, 4, 1);
      break;
    }
    case 3: {
      // Oak planks
      fillNoise(['#c59052', '#b98346', '#d19d5e', '#ad773c'], 31);
      ctx.fillStyle = '#7c5328';
      for (const y of [0, 4, 8, 12]) {
        ctx.fillRect(0, y, 16, 1);
      }
      ctx.fillRect(7, 0, 1, 4);
      ctx.fillRect(13, 4, 1, 4);
      ctx.fillRect(4, 8, 1, 4);
      ctx.fillRect(11, 12, 1, 4);
      ctx.fillStyle = '#e0ae6e';
      for (const y of [1, 5, 9, 13]) {
        ctx.fillRect(1, y, 14, 1);
      }
      break;
    }
    case 4: {
      // Red brick
      ctx.fillStyle = '#c8c3b8'; // mortar
      ctx.fillRect(0, 0, 16, 16);
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        const offset = (row % 2) * 4;
        for (let b = -1; b < 3; b++) {
          const x = b * 8 + offset;
          ctx.fillStyle = (row + b) % 2 === 0 ? '#b84635' : '#a33a2c';
          ctx.fillRect(x + 1, y + 1, 7, 3);
          ctx.fillStyle = '#cf5a46';
          ctx.fillRect(x + 1, y + 1, 6, 1);
        }
      }
      break;
    }
    case 5: {
      // Wood log
      if (face === 'top' || face === 'bottom') {
        ctx.fillStyle = '#5c3c22';
        ctx.fillRect(0, 0, 16, 16);
        ctx.fillStyle = '#c99b62';
        ctx.fillRect(2, 2, 12, 12);
        ctx.fillStyle = '#9c6e3d';
        ctx.fillRect(4, 4, 8, 8);
        ctx.fillStyle = '#d4a870';
        ctx.fillRect(6, 6, 4, 4);
        ctx.fillStyle = '#82562d';
        ctx.fillRect(7, 7, 2, 2);
      } else {
        for (let x = 0; x < 16; x++) {
          const col = x % 4 === 0 ? '#4d321c' : x % 2 === 0 ? '#6e492a' : '#5e3d22';
          ctx.fillStyle = col;
          ctx.fillRect(x, 0, 1, 16);
          for (let y = 0; y < 16; y++) {
            if (hash2d(x, y, 52) < 0.22) {
              ctx.fillStyle = '#7f5734';
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
      break;
    }
    case 6: {
      // Leaves
      fillNoise(['#2e7d36', '#3d9946', '#24662c', '#54b55b', '#1c5223'], 61);
      break;
    }
    case 7: {
      // Glass
      ctx.fillStyle = 'rgba(130, 232, 255, 0.28)';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#c4f5ff';
      ctx.fillRect(0, 0, 16, 2);
      ctx.fillRect(0, 14, 16, 2);
      ctx.fillRect(0, 0, 2, 16);
      ctx.fillRect(14, 0, 2, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(3, 3, 2, 2);
      ctx.fillRect(5, 5, 2, 2);
      ctx.fillRect(10, 10, 2, 2);
      break;
    }
    case 8: {
      // Neon glow lamp
      ctx.fillStyle = '#252c44';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#ffbe3b';
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = '#fff5b8';
      ctx.fillRect(4, 4, 8, 8);
      ctx.fillStyle = '#38e2d4';
      ctx.fillRect(0, 0, 3, 3);
      ctx.fillRect(13, 0, 3, 3);
      ctx.fillRect(0, 13, 3, 3);
      ctx.fillRect(13, 13, 3, 3);
      break;
    }
    case 9: {
      // Highway asphalt block
      fillNoise(['#2d3446', '#353d52', '#262c3b'], 91);
      if (face === 'top') {
        ctx.fillStyle = '#ffbe3b';
        ctx.fillRect(7, 0, 2, 16);
        ctx.fillStyle = '#edf2f7';
        ctx.fillRect(1, 2, 1, 5);
        ctx.fillRect(14, 9, 1, 5);
      } else {
        ctx.fillStyle = '#ffbe3b';
        ctx.fillRect(0, 2, 16, 2);
      }
      break;
    }
  }

  return c;
}

const _swatchUrlCache = new Map<BlockType, string>();

export function getBlockSwatchUrl(type: BlockType): string {
  const existing = _swatchUrlCache.get(type);
  if (existing) return existing;
  const face = type === 1 ? 'side' : type === 9 ? 'top' : 'side';
  const canvas = drawBlockFaceCanvas(type, face);
  const url = canvas.toDataURL('image/png');
  _swatchUrlCache.set(type, url);
  return url;
}

let _sharedMaterials: Map<BlockType, THREE.Material | THREE.Material[]> | null = null;

function getVoxelMaterials(): Map<BlockType, THREE.Material | THREE.Material[]> {
  if (_sharedMaterials) return _sharedMaterials;
  _sharedMaterials = new Map();

  for (const spec of BLOCK_SPECS) {
    if (spec.id === 1 || spec.id === 5 || spec.id === 9) {
      // Multi-face material array: [+x, -x, +y(top), -y(bottom), +z, -z]
      const sideTex = toBlockTexture(drawBlockFaceCanvas(spec.id, 'side'));
      const topTex = toBlockTexture(drawBlockFaceCanvas(spec.id, 'top'));
      const botTex = toBlockTexture(drawBlockFaceCanvas(spec.id, 'bottom'));
      const sideMat = new THREE.MeshLambertMaterial({ map: sideTex });
      const topMat = new THREE.MeshLambertMaterial({ map: topTex });
      const botMat = new THREE.MeshLambertMaterial({ map: botTex });
      _sharedMaterials.set(spec.id, [sideMat, sideMat, topMat, botMat, sideMat, sideMat]);
    } else if (spec.transparent) {
      const tex = toBlockTexture(drawBlockFaceCanvas(spec.id, 'side'));
      _sharedMaterials.set(
        spec.id,
        new THREE.MeshLambertMaterial({
          map: tex,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
        })
      );
    } else if (spec.emissive) {
      const tex = toBlockTexture(drawBlockFaceCanvas(spec.id, 'side'));
      _sharedMaterials.set(spec.id, new THREE.MeshBasicMaterial({ map: tex }));
    } else {
      const tex = toBlockTexture(drawBlockFaceCanvas(spec.id, 'side'));
      _sharedMaterials.set(spec.id, new THREE.MeshLambertMaterial({ map: tex }));
    }
  }

  return _sharedMaterials;
}

export class VoxelWorld {
  private readonly blocks = new Map<string, VoxelBlockEntry>();
  private version = 1;
  private roomKey = 'global';
  private saveTimer: number | null = null;

  constructor(roomSlug = 'global') {
    this.loadRoom(roomSlug);
  }

  getVersion(): number {
    return this.version;
  }

  getBlockCount(): number {
    return this.blocks.size;
  }

  values(): IterableIterator<VoxelBlockEntry> {
    return this.blocks.values();
  }

  getBlock(gx: number, gy: number, gz: number): BlockType | null {
    const entry = this.blocks.get(makeKey(Math.floor(gx), Math.floor(gy), wrapGridZ(gz)));
    return entry ? entry.type : null;
  }

  hasBlock(gx: number, gy: number, gz: number): boolean {
    return this.blocks.has(makeKey(Math.floor(gx), Math.floor(gy), wrapGridZ(gz)));
  }

  setBlock(gx: number, gy: number, gz: number, type: BlockType, save = true): boolean {
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = wrapGridZ(gz);

    if (iy < MIN_GY || iy > MAX_GY) return false;
    const roadCenter = roadX(iz + 0.5);
    if (Math.abs(ix + 0.5 - roadCenter) > OPEN_WORLD_MAX_LATERAL + 8) return false;

    const key = makeKey(ix, iy, iz);
    const prev = this.blocks.get(key);
    if (prev && prev.type === type) return false;

    this.blocks.set(key, { gx: ix, gy: iy, gz: iz, type });
    this.version++;
    if (save) this.scheduleSave();
    return true;
  }

  removeBlock(gx: number, gy: number, gz: number, save = true): BlockType | null {
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = wrapGridZ(gz);
    const key = makeKey(ix, iy, iz);
    const prev = this.blocks.get(key);
    if (!prev) return null;
    this.blocks.delete(key);
    this.version++;
    if (save) this.scheduleSave();
    return prev.type;
  }

  clearAll(save = true): void {
    if (this.blocks.size === 0) return;
    this.blocks.clear();
    this.version++;
    if (save) this.scheduleSave();
  }

  replaceFromServer(compact: [number, number, number, number][]): void {
    this.blocks.clear();
    for (let i = 0; i < compact.length; i++) {
      const item = compact[i];
      if (
        Array.isArray(item) &&
        item.length === 4 &&
        item[3] >= 1 &&
        item[3] <= 9
      ) {
        this.setBlock(item[0], item[1], item[2], item[3] as BlockType, false);
      }
    }
    this.version++;
    this.scheduleSave();
  }

  loadRoom(roomSlug: string): void {
    this.roomKey = roomSlug || 'global';
    this.blocks.clear();
    let loaded = false;

    try {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${this.roomKey}`);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            if (
              Array.isArray(item) &&
              item.length === 4 &&
              typeof item[0] === 'number' &&
              typeof item[1] === 'number' &&
              typeof item[2] === 'number' &&
              typeof item[3] === 'number' &&
              item[3] >= 1 &&
              item[3] <= 9
            ) {
              this.setBlock(item[0], item[1], item[2], item[3] as BlockType, false);
            }
          }
          loaded = true;
        }
      }
    } catch {
      // Ignore storage read errors
    }

    if (!loaded) {
      this.seedStarterOutpost();
    }
    this.version++;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 350);
  }

  private saveNow(): void {
    try {
      const compact: number[][] = [];
      for (const b of this.blocks.values()) {
        compact.push([b.gx, b.gy, b.gz, b.type]);
      }
      window.localStorage.setItem(`${STORAGE_PREFIX}${this.roomKey}`, JSON.stringify(compact));
    } catch {
      // Ignore storage quota errors
    }
  }

  /**
   * Seeds a charming, destructible roadside Minecraft-style Craft Outpost & Stunt Ramp
   * right off the right shoulder near s = 44m so players immediately notice the open world.
   */
  private seedStarterOutpost(): void {
    const baseS = 44;
    const baseX = Math.floor(roadX(baseS) + 19);
    const baseY = Math.floor(roadY(baseS));

    // Stone foundation (5x5)
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        this.setBlock(baseX + dx, baseY, baseS + dz, 2, false);
      }
    }
    // Corner oak log pillars (height 3)
    for (let h = 1; h <= 3; h++) {
      this.setBlock(baseX, baseY + h, baseS, 5, false);
      this.setBlock(baseX + 4, baseY + h, baseS, 5, false);
      this.setBlock(baseX, baseY + h, baseS + 4, 5, false);
      this.setBlock(baseX + 4, baseY + h, baseS + 4, 5, false);
    }
    // Plank walls with glass windows & open doorway facing highway (-X)
    for (let dx = 1; dx <= 3; dx++) {
      this.setBlock(baseX + dx, baseY + 1, baseS, 3, false);
      this.setBlock(baseX + dx, baseY + 2, baseS, dx === 2 ? 7 : 3, false);
      this.setBlock(baseX + dx, baseY + 3, baseS, 3, false);

      this.setBlock(baseX + dx, baseY + 1, baseS + 4, 3, false);
      this.setBlock(baseX + dx, baseY + 2, baseS + 4, dx === 2 ? 7 : 3, false);
      this.setBlock(baseX + dx, baseY + 3, baseS + 4, 3, false);
    }
    for (let dz = 1; dz <= 3; dz++) {
      // Back wall (+X)
      this.setBlock(baseX + 4, baseY + 1, baseS + dz, 3, false);
      this.setBlock(baseX + 4, baseY + 2, baseS + dz, dz === 2 ? 7 : 3, false);
      this.setBlock(baseX + 4, baseY + 3, baseS + dz, 3, false);
      // Front wall (-X) with 2-tall doorway at dz === 2
      if (dz !== 2) {
        this.setBlock(baseX, baseY + 1, baseS + dz, 3, false);
        this.setBlock(baseX, baseY + 2, baseS + dz, 7, false);
      }
      this.setBlock(baseX, baseY + 3, baseS + dz, 3, false);
    }
    // Brick roof + glowing neon beacon crown
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        this.setBlock(baseX + dx, baseY + 4, baseS + dz, 4, false);
      }
    }
    this.setBlock(baseX, baseY + 4, baseS + 2, 8, false);
    this.setBlock(baseX + 2, baseY + 5, baseS + 2, 8, false);

    // Mini voxel tree beside the cabin
    const tx = baseX + 7;
    const tz = baseS + 2;
    for (let h = 0; h < 4; h++) {
      this.setBlock(tx, baseY + h, tz, 5, false);
    }
    for (let lx = -1; lx <= 1; lx++) {
      for (let lz = -1; lz <= 1; lz++) {
        this.setBlock(tx + lx, baseY + 4, tz + lz, 6, false);
        if (Math.abs(lx) + Math.abs(lz) <= 1) {
          this.setBlock(tx + lx, baseY + 5, tz + lz, 6, false);
        }
      }
    }

    // Stepped asphalt jump ramp beside the road!
    const rampX = baseX - 5;
    for (let step = 0; step < 3; step++) {
      for (let w = 0; w < 2; w++) {
        for (let h = 0; h <= step; h++) {
          this.setBlock(rampX + w, baseY + h, baseS + step, 9, false);
        }
      }
    }
  }

  /**
   * 3D DDA raycast in Euclidean (wx, wy, ws) coordinates where dirS = -dirZ_threejs.
   * Intersects placed blocks AND the open-world ground surface so players can build anywhere!
   */
  raycast(
    ox: number,
    oy: number,
    os: number,
    dx: number,
    dy: number,
    ds: number,
    maxDist = 8.0
  ): VoxelRaycastHit | null {
    const len = Math.hypot(dx, dy, ds);
    if (len < 1e-6) return null;
    const rdx = dx / len;
    const rdy = dy / len;
    const rds = ds / len;

    let gx = Math.floor(ox);
    let gy = Math.floor(oy);
    let gs = Math.floor(os);

    const stepX = rdx > 0 ? 1 : rdx < 0 ? -1 : 0;
    const stepY = rdy > 0 ? 1 : rdy < 0 ? -1 : 0;
    const stepS = rds > 0 ? 1 : rds < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / rdx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / rdy) : Infinity;
    const tDeltaS = stepS !== 0 ? Math.abs(1 / rds) : Infinity;

    let tMaxX =
      stepX > 0 ? (gx + 1 - ox) / rdx : stepX < 0 ? (gx - ox) / rdx : Infinity;
    let tMaxY =
      stepY > 0 ? (gy + 1 - oy) / rdy : stepY < 0 ? (gy - oy) / rdy : Infinity;
    let tMaxS =
      stepS > 0 ? (gs + 1 - os) / rds : stepS < 0 ? (gs - os) / rds : Infinity;

    let nx = 0;
    let ny = 0;
    let ns = 0;
    let t = 0;

    for (let iter = 0; iter < 48 && t <= maxDist; iter++) {
      if (iter > 0) {
        const wgz = wrapGridZ(gs);
        const bt = this.getBlock(gx, gy, wgz);
        if (bt !== null) {
          return {
            hitType: 'block',
            gx,
            gy,
            gz: wgz,
            placeX: gx + nx,
            placeY: gy + ny,
            placeZ: wrapGridZ(gs + ns),
            nx,
            ny,
            ns,
            blockType: bt,
            distance: t,
          };
        }

        // Check if ray just pierced below the natural ground surface
        const px = ox + rdx * t;
        const py = oy + rdy * t;
        const ps = os + rds * t;
        const gY = openWorldGroundY(px, ps);
        if (py <= gY + 0.04) {
          const placeGy = Math.floor(gY + 0.05);
          const wPlaceZ = wrapGridZ(Math.floor(ps));
          const placeGx = Math.floor(px);
          if (!this.hasBlock(placeGx, placeGy, wPlaceZ)) {
            return {
              hitType: 'ground',
              gx: placeGx,
              gy: placeGy - 1,
              gz: wPlaceZ,
              placeX: placeGx,
              placeY: placeGy,
              placeZ: wPlaceZ,
              nx: 0,
              ny: 1,
              ns: 0,
              blockType: null,
              distance: t,
            };
          }
        }
      }

      if (tMaxX < tMaxY && tMaxX < tMaxS) {
        t = tMaxX;
        tMaxX += tDeltaX;
        gx += stepX;
        nx = -stepX;
        ny = 0;
        ns = 0;
      } else if (tMaxY < tMaxS) {
        t = tMaxY;
        tMaxY += tDeltaY;
        gy += stepY;
        nx = 0;
        ny = -stepY;
        ns = 0;
      } else {
        t = tMaxS;
        tMaxS += tDeltaS;
        gs += stepS;
        nx = 0;
        ny = 0;
        ns = -stepS;
      }
    }

    // Final analytical fallback for looking gently down at ground plane
    if (rdy < -0.04) {
      const approxG = openWorldGroundY(ox, os);
      const tHit = (approxG - oy) / rdy;
      if (tHit > 0.3 && tHit <= maxDist) {
        const px = ox + rdx * tHit;
        const ps = os + rds * tHit;
        const gY = openWorldGroundY(px, ps);
        const placeGx = Math.floor(px);
        const placeGy = Math.floor(gY + 0.05);
        const wPlaceZ = wrapGridZ(Math.floor(ps));
        return {
          hitType: 'ground',
          gx: placeGx,
          gy: placeGy - 1,
          gz: wPlaceZ,
          placeX: placeGx,
          placeY: placeGy,
          placeZ: wPlaceZ,
          nx: 0,
          ny: 1,
          ns: 0,
          blockType: null,
          distance: tHit,
        };
      }
    }

    return null;
  }

  /**
   * Checks whether an axis-aligned box [wx-hw, wx+hw] × [wy, wy+h] × [ws-hd, ws+hd]
   * overlaps any solid voxel block.
   */
  overlapsBox(
    wx: number,
    wy: number,
    ws: number,
    halfW: number,
    height: number,
    halfD: number
  ): boolean {
    const minX = Math.floor(wx - halfW + 0.001);
    const maxX = Math.floor(wx + halfW - 0.001);
    const minY = Math.floor(wy + 0.001);
    const maxY = Math.floor(wy + height - 0.001);
    const minS = Math.floor(ws - halfD + 0.001);
    const maxS = Math.floor(ws + halfD - 0.001);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let s = minS; s <= maxS; s++) {
          if (this.hasBlock(x, y, s)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Returns highest solid block top Y strictly beneath or intersecting foot column
   * within [wx-halfW, wx+halfW] × [ws-halfD, ws+halfD] up to maxFootY.
   */
  getSupportHeight(
    wx: number,
    ws: number,
    halfW: number,
    halfD: number,
    maxFootY: number
  ): number {
    let best = openWorldGroundY(wx, ws);
    const minX = Math.floor(wx - halfW + 0.02);
    const maxX = Math.floor(wx + halfW - 0.02);
    const minS = Math.floor(ws - halfD + 0.02);
    const maxS = Math.floor(ws + halfD - 0.02);
    const topY = Math.floor(maxFootY);
    const botY = Math.max(MIN_GY, Math.floor(best) - 2);

    for (let x = minX; x <= maxX; x++) {
      for (let s = minS; s <= maxS; s++) {
        for (let y = topY; y >= botY; y--) {
          if (this.hasBlock(x, y, s)) {
            const surface = y + 1;
            if (surface > best && surface <= maxFootY + 0.05) {
              best = surface;
            }
            break;
          }
        }
      }
    }
    return best;
  }
}

/**
 * High-performance InstancedMesh renderer for VoxelWorld (at most 1 draw call per active block type)
 * plus Minecraft-style 3D wireframe aim box & translucent placement ghost.
 */
export class VoxelWorldVisual {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<BlockType, THREE.InstancedMesh>();
  private readonly counts = new Map<BlockType, number>();
  private readonly targetWire: THREE.LineSegments;
  private readonly placeGhost: THREE.Mesh;
  private readonly placeGhostMat: THREE.MeshBasicMaterial;
  private readonly _dummy = new THREE.Object3D();
  private lastVersion = -1;
  private lastOriginS = Number.NaN;
  private lastOriginX = Number.NaN;
  private lastOriginY = Number.NaN;

  constructor() {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const mats = getVoxelMaterials();

    for (const spec of BLOCK_SPECS) {
      const mat = mats.get(spec.id)!;
      const inst = new THREE.InstancedMesh(boxGeo, mat, MAX_INSTANCES_PER_TYPE);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      inst.count = 0;
      this.meshes.set(spec.id, inst);
      this.counts.set(spec.id, 0);
      this.group.add(inst);
    }

    // Crisp black/cyan Minecraft selection wireframe
    const wireGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    this.targetWire = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({ color: 0x00f5d4, transparent: true, opacity: 0.92 })
    );
    this.targetWire.visible = false;
    this.group.add(this.targetWire);

    // Subtle translucent ghost box showing where the next block will be placed
    this.placeGhostMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.placeGhost = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), this.placeGhostMat);
    this.placeGhost.visible = false;
    this.group.add(this.placeGhost);
  }

  update(
    world: VoxelWorld,
    originS: number,
    originX: number,
    originY: number,
    aimHit: VoxelRaycastHit | null,
    selectedBlock: BlockType,
    showAim: boolean
  ): void {
    const ver = world.getVersion();
    const moved =
      Math.abs(originS - this.lastOriginS) > 0.0005 ||
      Math.abs(originX - this.lastOriginX) > 0.0005 ||
      Math.abs(originY - this.lastOriginY) > 0.0005;

    if (ver !== this.lastVersion || moved) {
      this.lastVersion = ver;
      this.lastOriginS = originS;
      this.lastOriginX = originX;
      this.lastOriginY = originY;

      for (const spec of BLOCK_SPECS) {
        this.counts.set(spec.id, 0);
      }

      const d = this._dummy;
      const wrappedOriginS = wrapTrackS(originS);

      for (const b of world.values()) {
        const ds = signedTrackDelta(b.gz + 0.5, wrappedOriginS);
        if (ds < -RENDER_RANGE_S || ds > RENDER_RANGE_S) continue;

        const c = this.counts.get(b.type) ?? 0;
        if (c >= MAX_INSTANCES_PER_TYPE) continue;

        const inst = this.meshes.get(b.type)!;
        d.position.set(b.gx + 0.5 - originX, b.gy + 0.5 - originY, -ds);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        inst.setMatrixAt(c, d.matrix);
        this.counts.set(b.type, c + 1);
      }

      for (const spec of BLOCK_SPECS) {
        const inst = this.meshes.get(spec.id)!;
        const c = this.counts.get(spec.id) ?? 0;
        const prev = inst.count;
        inst.count = c;
        if (c > 0 || prev > 0) {
          inst.instanceMatrix.needsUpdate = true;
        }
      }
    }

    if (showAim && aimHit) {
      const wrappedOriginS = wrapTrackS(originS);
      if (aimHit.hitType === 'block') {
        const dsBlock = signedTrackDelta(aimHit.gz + 0.5, wrappedOriginS);
        this.targetWire.position.set(
          aimHit.gx + 0.5 - originX,
          aimHit.gy + 0.5 - originY,
          -dsBlock
        );
        this.targetWire.visible = true;
      } else {
        this.targetWire.visible = false;
      }

      const dsPlace = signedTrackDelta(aimHit.placeZ + 0.5, wrappedOriginS);
      this.placeGhost.position.set(
        aimHit.placeX + 0.5 - originX,
        aimHit.placeY + 0.5 - originY,
        -dsPlace
      );
      this.placeGhostMat.color.setHex(BLOCK_SPEC_BY_ID[selectedBlock].particleHex);
      this.placeGhost.visible = true;
    } else {
      this.targetWire.visible = false;
      this.placeGhost.visible = false;
    }
  }
}
