import { signedTrackDelta } from './RoadMath';
import { BlockType, VoxelWorld, wrapGridZ } from './VoxelWorld';

export interface BlueprintBlock {
  dx: number;
  dy: number;
  dz: number;
  b: BlockType;
}

export interface SavedBlueprint {
  id: string;
  name: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  blocks: BlueprintBlock[];
  createdAt: number;
}

export interface GridPoint {
  gx: number;
  gy: number;
  gz: number;
}

export interface SelectionBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  volume: number;
  pos1: GridPoint | null;
  pos2: GridPoint | null;
  complete: boolean;
}

export interface BlueprintCaptureResult {
  ok: boolean;
  blueprint?: SavedBlueprint;
  error?: 'incomplete' | 'too_large' | 'too_many_blocks' | 'empty';
}

export interface BlueprintRenderData {
  selection: SelectionBounds | null;
  preview: SavedBlueprint | null;
  previewOrigin: GridPoint | null;
}

export const MAX_BLUEPRINT_DIM = 16;
export const MAX_BLUEPRINT_BLOCKS = 512;

export function computeBlueprintMaterialCost(
  blocks: readonly { b: BlockType }[]
): Partial<Record<BlockType, number>> {
  const cost: Partial<Record<BlockType, number>> = {};
  for (let i = 0; i < blocks.length; i++) {
    const bt = blocks[i].b;
    cost[bt] = (cost[bt] ?? 0) + 1;
  }
  return cost;
}

/**
 * Manages 3D voxel region selection (Corner A / Corner B), blueprint capture,
 * material cost calculation, and active reconstruction preview state.
 */
export class BlueprintManager {
  private pos1: GridPoint | null = null;
  private pos2: GridPoint | null = null;
  private activePreview: SavedBlueprint | null = null;
  private previewOrigin: GridPoint | null = null;

  setPos1(gx: number, gy: number, gz: number): SelectionBounds {
    this.pos1 = { gx: Math.floor(gx), gy: Math.floor(gy), gz: wrapGridZ(gz) };
    return this.getSelectionBounds()!;
  }

  setPos2(gx: number, gy: number, gz: number): SelectionBounds {
    this.pos2 = { gx: Math.floor(gx), gy: Math.floor(gy), gz: wrapGridZ(gz) };
    return this.getSelectionBounds()!;
  }

  clearSelection(): void {
    this.pos1 = null;
    this.pos2 = null;
  }

  getPos1(): GridPoint | null {
    return this.pos1 ? { ...this.pos1 } : null;
  }

  getPos2(): GridPoint | null {
    return this.pos2 ? { ...this.pos2 } : null;
  }

  getSelectionBounds(): SelectionBounds | null {
    if (!this.pos1 && !this.pos2) return null;

    if (this.pos1 && !this.pos2) {
      return {
        minX: this.pos1.gx,
        minY: this.pos1.gy,
        minZ: this.pos1.gz,
        maxX: this.pos1.gx,
        maxY: this.pos1.gy,
        maxZ: this.pos1.gz,
        sizeX: 1,
        sizeY: 1,
        sizeZ: 1,
        volume: 1,
        pos1: { ...this.pos1 },
        pos2: null,
        complete: false,
      };
    }

    if (!this.pos1 && this.pos2) {
      return {
        minX: this.pos2.gx,
        minY: this.pos2.gy,
        minZ: this.pos2.gz,
        maxX: this.pos2.gx,
        maxY: this.pos2.gy,
        maxZ: this.pos2.gz,
        sizeX: 1,
        sizeY: 1,
        sizeZ: 1,
        volume: 1,
        pos1: null,
        pos2: { ...this.pos2 },
        complete: false,
      };
    }

    const p1 = this.pos1!;
    const p2 = this.pos2!;
    const minX = Math.min(p1.gx, p2.gx);
    const maxX = Math.max(p1.gx, p2.gx);
    const minY = Math.min(p1.gy, p2.gy);
    const maxY = Math.max(p1.gy, p2.gy);

    // Cyclic-safe Z span along the 2400m loop
    const dzSigned = Math.round(signedTrackDelta(p2.gz, p1.gz));
    const minZ = dzSigned >= 0 ? p1.gz : p2.gz;
    const spanZ = Math.abs(dzSigned);
    const maxZ = minZ + spanZ;

    const sizeX = maxX - minX + 1;
    const sizeY = maxY - minY + 1;
    const sizeZ = spanZ + 1;

    return {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      sizeX,
      sizeY,
      sizeZ,
      volume: sizeX * sizeY * sizeZ,
      pos1: { ...p1 },
      pos2: { ...p2 },
      complete: true,
    };
  }

  captureFromWorld(voxels: VoxelWorld, name: string): BlueprintCaptureResult {
    const bounds = this.getSelectionBounds();
    if (!bounds || !bounds.complete) {
      return { ok: false, error: 'incomplete' };
    }

    if (
      bounds.sizeX > MAX_BLUEPRINT_DIM ||
      bounds.sizeY > MAX_BLUEPRINT_DIM ||
      bounds.sizeZ > MAX_BLUEPRINT_DIM
    ) {
      return { ok: false, error: 'too_large' };
    }

    const rawBlocks: BlueprintBlock[] = [];
    let minDx = bounds.sizeX;
    let minDy = bounds.sizeY;
    let minDz = bounds.sizeZ;
    let maxDx = -1;
    let maxDy = -1;
    let maxDz = -1;

    for (let dx = 0; dx < bounds.sizeX; dx++) {
      for (let dy = 0; dy < bounds.sizeY; dy++) {
        for (let dz = 0; dz < bounds.sizeZ; dz++) {
          const b = voxels.getBlock(
            bounds.minX + dx,
            bounds.minY + dy,
            wrapGridZ(bounds.minZ + dz)
          );
          if (b === null) continue;
          if (rawBlocks.length >= MAX_BLUEPRINT_BLOCKS) {
            return { ok: false, error: 'too_many_blocks' };
          }
          rawBlocks.push({ dx, dy, dz, b });
          if (dx < minDx) minDx = dx;
          if (dy < minDy) minDy = dy;
          if (dz < minDz) minDz = dz;
          if (dx > maxDx) maxDx = dx;
          if (dy > maxDy) maxDy = dy;
          if (dz > maxDz) maxDz = dz;
        }
      }
    }

    if (rawBlocks.length === 0) {
      return { ok: false, error: 'empty' };
    }

    // Normalize blocks to tight local origin (0, 0, 0)
    const blocks: BlueprintBlock[] = rawBlocks.map((blk) => ({
      dx: blk.dx - minDx,
      dy: blk.dy - minDy,
      dz: blk.dz - minDz,
      b: blk.b,
    }));

    const cleanName = name.trim().slice(0, 32) || 'Blueprint';
    const createdAt = Date.now();
    const id = `bp_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    return {
      ok: true,
      blueprint: {
        id,
        name: cleanName,
        sizeX: maxDx - minDx + 1,
        sizeY: maxDy - minDy + 1,
        sizeZ: maxDz - minDz + 1,
        blocks,
        createdAt,
      },
    };
  }

  computeMaterialCost(blocks: readonly { b: BlockType }[]): Partial<Record<BlockType, number>> {
    return computeBlueprintMaterialCost(blocks);
  }

  setActivePreview(bp: SavedBlueprint | null, origin?: GridPoint | null): void {
    this.activePreview = bp;
    if (bp === null) {
      this.previewOrigin = null;
    } else if (origin !== undefined) {
      this.previewOrigin = origin
        ? { gx: Math.floor(origin.gx), gy: Math.floor(origin.gy), gz: wrapGridZ(origin.gz) }
        : null;
    }
  }

  setPreviewOrigin(gx: number, gy: number, gz: number): void {
    this.previewOrigin = { gx: Math.floor(gx), gy: Math.floor(gy), gz: wrapGridZ(gz) };
  }

  getActivePreview(): SavedBlueprint | null {
    return this.activePreview;
  }

  getPreviewOrigin(): GridPoint | null {
    return this.previewOrigin ? { ...this.previewOrigin } : null;
  }

  getRenderData(): BlueprintRenderData {
    return {
      selection: this.getSelectionBounds(),
      preview: this.activePreview,
      previewOrigin: this.previewOrigin ? { ...this.previewOrigin } : null,
    };
  }

  planReconstruction(
    bp: SavedBlueprint,
    originGx: number,
    originGy: number,
    originGz: number
  ): { gx: number; gy: number; gz: number; b: BlockType }[] {
    const ox = Math.floor(originGx);
    const oy = Math.floor(originGy);
    const oz = wrapGridZ(originGz);
    const result: { gx: number; gy: number; gz: number; b: BlockType }[] = [];
    for (let i = 0; i < bp.blocks.length; i++) {
      const blk = bp.blocks[i];
      result.push({
        gx: ox + blk.dx,
        gy: oy + blk.dy,
        gz: wrapGridZ(oz + blk.dz),
        b: blk.b,
      });
    }
    return result;
  }
}
