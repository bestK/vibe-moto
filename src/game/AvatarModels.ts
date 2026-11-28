import * as THREE from 'three';
import { AVATAR_COUNT } from './PixelAvatars';

export interface BoxSpec {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  color: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

export interface AvatarOutfit {
  jacket: string;
  pants: string;
  stripe: string;
  bikePrimary: string;
  bikeAccent: string;
  visor: string;
  hasFloatingMarks?: boolean;
}

export interface AvatarCharacterModel {
  upperWithArmsGeo: THREE.BufferGeometry;
  upperNoArmsGeo: THREE.BufferGeometry;
  floatGeo: THREE.BufferGeometry | null;
  outfit: AvatarOutfit;
}

/**
 * Merges an array of colored box primitives into a single zero-overhead vertex-colored BufferGeometry.
 */
export function mergeColoredBoxes(parts: readonly BoxSpec[]): THREE.BufferGeometry {
  const boxVerts = 24;
  const boxIndices = 36;
  const totalVerts = parts.length * boxVerts;
  const totalIndices = parts.length * boxIndices;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint16Array(totalIndices);
  const tmpColor = new THREE.Color();

  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const g = new THREE.BoxGeometry(part.w, part.h, part.d);
    if (part.rx) g.rotateX(part.rx);
    if (part.ry) g.rotateY(part.ry);
    if (part.rz) g.rotateZ(part.rz);
    g.translate(part.x, part.y, part.z);

    const posArr = g.attributes.position.array as Float32Array;
    const normArr = g.attributes.normal.array as Float32Array;
    const idxArr = g.index!.array;

    const vOff = p * boxVerts;
    positions.set(posArr, vOff * 3);
    normals.set(normArr, vOff * 3);

    tmpColor.setHex(part.color);
    for (let v = 0; v < boxVerts; v++) {
      const ci = (vOff + v) * 3;
      colors[ci] = tmpColor.r;
      colors[ci + 1] = tmpColor.g;
      colors[ci + 2] = tmpColor.b;
    }

    const iOff = p * boxIndices;
    for (let k = 0; k < boxIndices; k++) {
      indices[iOff + k] = idxArr[k] + vOff;
    }

    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

// One shared Lambert material for ALL character heads, accessories & merged rider parts (1 program bind!)
let _sharedVertexMat: THREE.MeshLambertMaterial | null = null;
export function getSharedVertexColorMat(): THREE.MeshLambertMaterial {
  if (!_sharedVertexMat) {
    _sharedVertexMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
    });
  }
  return _sharedVertexMat;
}

// One shared emissive/unlit material for floating pixel badges ('???', glowing phone screen, etc.)
let _sharedBasicVertexMat: THREE.MeshBasicMaterial | null = null;
export function getSharedBasicVertexMat(): THREE.MeshBasicMaterial {
  if (!_sharedBasicVertexMat) {
    _sharedBasicVertexMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
    });
  }
  return _sharedBasicVertexMat;
}

/**
 * 9 handcrafted 3D voxel character specs directly matching PIXEL_AVATARS (0..8):
 * 0: PENGUIN   — Jet-black penguin + orange beak + fluttering crimson scarf tails
 * 1: LAUGH     — Oversized golden laughing emoji head + orange-gold hood
 * 2: SHOCK CAT — Orange tabby cat + tall striped ears + wide mint eyes + curled tabby tail
 * 3: NOODLE    — Black bowl-cut hair + fluttering ramen headband + ramen bowl & chopsticks pack
 * 4: LOG       — Tall wooden bark log head + wood grain crown + green leaf sprout
 * 5: WHAT?     — Curly fade hair + white streetwear tee + bobbing floating pixel `???`
 * 6: PHONE     — Yellow chick tuft + beak + glowing purple smartphone backpack
 * 7: ALIEN CAT — Yellow cat ears + twin glowing alien antennae + silver astro space pack
 * 8: COWBOY    — Wide-brimmed brown cowboy hat + white cat ears + red bandana + fluffy cat tail
 *
 * Head coordinate space: centered at (0, 0.70, -0.22) inside torsoGroup (-Z is forward, +Z is back!).
 */
const AVATAR_CHARACTER_SPECS: readonly {
  head: readonly BoxSpec[];
  torsoExtra?: readonly BoxSpec[];
  floatParts?: readonly BoxSpec[];
  outfit: AvatarOutfit;
}[] = [
  // 0: PENGUIN (QQ / tuxedo penguin with red scarf & orange beak)
  {
    head: [
      // Round penguin head
      { w: 0.40, h: 0.38, d: 0.40, x: 0, y: 0.02, z: 0, color: 0x131722 },
      // Soft rounded crown cap
      { w: 0.34, h: 0.06, d: 0.34, x: 0, y: 0.22, z: 0, color: 0x1a2030 },
      // White lower face & cheek patches (visible from side & front)
      { w: 0.32, h: 0.22, d: 0.08, x: 0, y: -0.02, z: -0.18, color: 0xffffff },
      { w: 0.42, h: 0.14, d: 0.16, x: 0, y: -0.04, z: -0.06, color: 0xffffff },
      // Crisp bright eyes
      { w: 0.07, h: 0.08, d: 0.04, x: -0.09, y: 0.05, z: -0.21, color: 0x0b0d12 },
      { w: 0.07, h: 0.08, d: 0.04, x: 0.09, y: 0.05, z: -0.21, color: 0x0b0d12 },
      { w: 0.03, h: 0.03, d: 0.04, x: -0.08, y: 0.07, z: -0.22, color: 0xffffff },
      { w: 0.03, h: 0.03, d: 0.04, x: 0.10, y: 0.07, z: -0.22, color: 0xffffff },
      // Iconic bright orange penguin beak
      { w: 0.16, h: 0.08, d: 0.14, x: 0, y: -0.03, z: -0.25, color: 0xf68908 },
      { w: 0.12, h: 0.04, d: 0.10, x: 0, y: -0.08, z: -0.23, color: 0xd96b04 },
      // Crimson scarf collar around neck + 2 wider fluttering tails streaming behind!
      { w: 0.46, h: 0.11, d: 0.44, x: 0, y: -0.18, z: 0.02, color: 0xe31b3a },
      { w: 0.12, h: 0.09, d: 0.30, x: -0.14, y: -0.15, z: 0.31, color: 0xff2a4b },
      { w: 0.11, h: 0.08, d: 0.25, x: 0.14, y: -0.20, z: 0.29, color: 0xc81230 },
    ],
    torsoExtra: [
      // White belly front + crisp white tuxedo tail-trim & bright cyan crest on back (pops on dark asphalt!)
      { w: 0.34, h: 0.44, d: 0.12, x: 0, y: 0.24, z: -0.17, color: 0xffffff },
      { w: 0.20, h: 0.12, d: 0.11, x: 0, y: 0.45, z: 0.05, color: 0xff2a4b },
      { w: 0.32, h: 0.11, d: 0.10, x: 0, y: 0.16, z: 0.15, color: 0x00b4ff },
      { w: 0.22, h: 0.08, d: 0.10, x: 0, y: 0.06, z: 0.17, color: 0xf4f7fc },
    ],
    outfit: {
      jacket: '#141822',
      pants: '#1a2030',
      stripe: '#e31b3a',
      bikePrimary: '#00a8ff',
      bikeAccent: '#e31b3a',
      visor: '#ffffff',
    },
  },

  // 1: LAUGH (Bright yellow laughing meme head + amber hoodie)
  {
    head: [
      // Plump golden-yellow round pixel head (slightly larger for iconic emoji silhouette)
      { w: 0.44, h: 0.42, d: 0.42, x: 0, y: 0.03, z: 0, color: 0xffe014 },
      { w: 0.36, h: 0.06, d: 0.36, x: 0, y: 0.25, z: 0, color: 0xfcd000 },
      // Cheeky crown cowlick / brow ridge on back & sides
      { w: 0.14, h: 0.06, d: 0.08, x: 0, y: 0.28, z: -0.02, color: 0xff9f1c },
      // Iconic squinting laugh eyes + huge white-toothed grin
      { w: 0.11, h: 0.04, d: 0.04, x: -0.10, y: 0.09, z: -0.21, color: 0x16120b },
      { w: 0.11, h: 0.04, d: 0.04, x: 0.10, y: 0.09, z: -0.21, color: 0x16120b },
      { w: 0.24, h: 0.11, d: 0.05, x: 0, y: -0.05, z: -0.21, color: 0x5d4213 },
      { w: 0.20, h: 0.04, d: 0.05, x: 0, y: -0.02, z: -0.22, color: 0xffffff },
      // Warm blush cheeks + orange hoodie collar
      { w: 0.08, h: 0.06, d: 0.04, x: -0.16, y: -0.01, z: -0.20, color: 0xff9f1c },
      { w: 0.08, h: 0.06, d: 0.04, x: 0.16, y: -0.01, z: -0.20, color: 0xff9f1c },
      { w: 0.44, h: 0.08, d: 0.44, x: 0, y: -0.17, z: 0.02, color: 0xff9f1c },
    ],
    torsoExtra: [
      // Folded vibrant orange-amber hoodie hood + dark rim sitting flush on upper back (pops in Chase Cam!)
      { w: 0.44, h: 0.22, d: 0.20, x: 0, y: 0.47, z: 0.07, color: 0xff7b00 },
      { w: 0.32, h: 0.12, d: 0.10, x: 0, y: 0.45, z: 0.15, color: 0xffe828 },
      { w: 0.36, h: 0.05, d: 0.08, x: 0, y: 0.36, z: 0.14, color: 0x3a2d18 },
    ],
    outfit: {
      jacket: '#f5c400',
      pants: '#3a2d18',
      stripe: '#ff9f1c',
      bikePrimary: '#ffbe0b',
      bikeAccent: '#ff7b00',
      visor: '#14141c',
    },
  },

  // 2: SHOCK CAT (Orange tabby cat with tall ears, tabby stripes & curled tail)
  {
    head: [
      // Orange tabby cat head
      { w: 0.40, h: 0.36, d: 0.38, x: 0, y: 0.01, z: 0, color: 0xf29405 },
      // Tall pointed cat ears (outer orange + dark inner/tip)
      { w: 0.12, h: 0.18, d: 0.10, x: -0.14, y: 0.26, z: -0.02, color: 0xf29405 },
      { w: 0.12, h: 0.18, d: 0.10, x: 0.14, y: 0.26, z: -0.02, color: 0xf29405 },
      { w: 0.06, h: 0.10, d: 0.06, x: -0.14, y: 0.25, z: -0.06, color: 0xfad580 },
      { w: 0.06, h: 0.10, d: 0.06, x: 0.14, y: 0.25, z: -0.06, color: 0xfad580 },
      { w: 0.08, h: 0.05, d: 0.10, x: -0.14, y: 0.35, z: -0.02, color: 0x8a3b1a },
      { w: 0.08, h: 0.05, d: 0.10, x: 0.14, y: 0.35, z: -0.02, color: 0x8a3b1a },
      // Tabby tiger stripes across back & crown of head (clearly visible from behind!)
      { w: 0.34, h: 0.05, d: 0.06, x: 0, y: 0.16, z: 0.17, color: 0x8a3b1a },
      { w: 0.38, h: 0.05, d: 0.06, x: 0, y: 0.05, z: 0.18, color: 0xa64618 },
      { w: 0.32, h: 0.05, d: 0.06, x: 0, y: -0.06, z: 0.17, color: 0x8a3b1a },
      { w: 0.06, h: 0.05, d: 0.30, x: 0, y: 0.19, z: 0, color: 0x8a3b1a },
      // Giant shocked mint-teal eyes + wide open 'O' shocked mouth
      { w: 0.11, h: 0.12, d: 0.04, x: -0.09, y: 0.05, z: -0.19, color: 0xa5ddd4 },
      { w: 0.11, h: 0.12, d: 0.04, x: 0.09, y: 0.05, z: -0.19, color: 0xa5ddd4 },
      { w: 0.05, h: 0.06, d: 0.04, x: -0.09, y: 0.05, z: -0.20, color: 0x0b0d12 },
      { w: 0.05, h: 0.06, d: 0.04, x: 0.09, y: 0.05, z: -0.20, color: 0x0b0d12 },
      { w: 0.22, h: 0.14, d: 0.05, x: 0, y: -0.08, z: -0.19, color: 0xfad580 },
      { w: 0.11, h: 0.11, d: 0.05, x: 0, y: -0.09, z: -0.21, color: 0x160a08 },
    ],
    torsoExtra: [
      // Tabby stripes flush on back + bouncy curled orange-brown cat tail!
      { w: 0.44, h: 0.07, d: 0.10, x: 0, y: 0.42, z: 0.06, color: 0x8a3b1a },
      { w: 0.44, h: 0.07, d: 0.10, x: 0, y: 0.26, z: 0.13, color: 0x8a3b1a },
      { w: 0.11, h: 0.11, d: 0.34, x: 0.02, y: 0.05, z: 0.29, color: 0xf29405 },
      { w: 0.11, h: 0.26, d: 0.11, x: 0.04, y: 0.19, z: 0.44, color: 0xf29405 },
      { w: 0.12, h: 0.08, d: 0.12, x: 0.04, y: 0.33, z: 0.44, color: 0x8a3b1a },
    ],
    outfit: {
      jacket: '#e88810',
      pants: '#1a439c',
      stripe: '#fad580',
      bikePrimary: '#ff881a',
      bikeAccent: '#1a439c',
      visor: '#a5ddd4',
    },
  },

  // 3: NOODLE (Black-haired ramen enthusiast + white/red headband + ramen bowl pack!)
  {
    head: [
      // Warm skin face base
      { w: 0.36, h: 0.34, d: 0.36, x: 0, y: 0, z: 0, color: 0xd0a17e },
      // Thick jet-black shaggy hair dome covering top, back & sides
      { w: 0.42, h: 0.18, d: 0.42, x: 0, y: 0.14, z: 0.01, color: 0x11131a },
      { w: 0.42, h: 0.24, d: 0.14, x: 0, y: 0.01, z: 0.16, color: 0x11131a },
      { w: 0.08, h: 0.18, d: 0.24, x: -0.18, y: 0.02, z: 0.04, color: 0x11131a },
      { w: 0.08, h: 0.18, d: 0.24, x: 0.18, y: 0.02, z: 0.04, color: 0x11131a },
      // Crisp white ramen headband + red center knot + 2 streaming rear headband tails!
      { w: 0.44, h: 0.07, d: 0.44, x: 0, y: 0.12, z: 0.01, color: 0xf8fafc },
      { w: 0.10, h: 0.07, d: 0.06, x: 0, y: 0.12, z: -0.21, color: 0xe44a2a },
      { w: 0.09, h: 0.06, d: 0.26, x: -0.07, y: 0.09, z: 0.31, color: 0xf8fafc },
      { w: 0.08, h: 0.06, d: 0.22, x: 0.08, y: 0.05, z: 0.29, color: 0xe2e8f0 },
      // Expressive eyes + happy slurping mouth
      { w: 0.07, h: 0.05, d: 0.04, x: -0.08, y: 0.02, z: -0.18, color: 0x11131a },
      { w: 0.07, h: 0.05, d: 0.04, x: 0.08, y: 0.02, z: -0.18, color: 0x11131a },
      { w: 0.10, h: 0.08, d: 0.04, x: 0, y: -0.08, z: -0.18, color: 0x812e1c },
      { w: 0.04, h: 0.12, d: 0.05, x: 0.02, y: -0.13, z: -0.20, color: 0xfcdf95 }, // dangling noodle!
    ],
    torsoExtra: [
      // Steaming ramen bowl backpack strapped flush to back (super recognizable from behind!)
      { w: 0.36, h: 0.24, d: 0.24, x: 0, y: 0.30, z: 0.17, color: 0xe44a2a },
      { w: 0.38, h: 0.06, d: 0.26, x: 0, y: 0.42, z: 0.17, color: 0xffffff },
      { w: 0.30, h: 0.07, d: 0.18, x: 0, y: 0.46, z: 0.17, color: 0xfcdf95 }, // golden noodles
      // Pair of chopsticks sticking up out of the ramen bowl!
      { w: 0.04, h: 0.30, d: 0.04, x: 0.10, y: 0.56, z: 0.18, color: 0xd4a373 },
      { w: 0.04, h: 0.28, d: 0.04, x: 0.16, y: 0.54, z: 0.16, color: 0xb57a44 },
    ],
    outfit: {
      jacket: '#265e54',
      pants: '#1a2b28',
      stripe: '#f7c931',
      bikePrimary: '#2a9d6f',
      bikeAccent: '#f7c931',
      visor: '#fcdf95',
    },
  },

  // 4: LOG (Wooden Log Character — tall bark cylinder head, wood rings & green sprout!)
  {
    head: [
      // Tall blocky bark log head
      { w: 0.38, h: 0.50, d: 0.38, x: 0, y: 0.08, z: 0, color: 0xab6f44 },
      // Vertical dark wood bark ridges on back & sides
      { w: 0.06, h: 0.48, d: 0.06, x: -0.12, y: 0.08, z: 0.18, color: 0x6b3210 },
      { w: 0.06, h: 0.48, d: 0.06, x: 0.04, y: 0.08, z: 0.18, color: 0x893d0d },
      { w: 0.06, h: 0.48, d: 0.06, x: 0.14, y: 0.08, z: 0.16, color: 0x6b3210 },
      // Cut pale wood cross-section ring on top
      { w: 0.32, h: 0.05, d: 0.32, x: 0, y: 0.34, z: 0, color: 0xe7ad6f },
      { w: 0.16, h: 0.06, d: 0.16, x: 0, y: 0.345, z: 0, color: 0xc98245 },
      // Cute green leafy twig sprouting out of the top of the log!
      { w: 0.05, h: 0.16, d: 0.05, x: 0.04, y: 0.43, z: 0, color: 0x6b3210 },
      { w: 0.16, h: 0.08, d: 0.10, x: 0.13, y: 0.49, z: 0, color: 0x46d97c },
      { w: 0.12, h: 0.07, d: 0.09, x: -0.04, y: 0.46, z: 0.02, color: 0x2ca85c },
      // Funny mismatched blue & amber meme eyes
      { w: 0.11, h: 0.11, d: 0.04, x: -0.09, y: 0.12, z: -0.19, color: 0xa9ccd6 },
      { w: 0.11, h: 0.11, d: 0.04, x: 0.09, y: 0.12, z: -0.19, color: 0xeb9f14 },
      { w: 0.05, h: 0.06, d: 0.05, x: -0.09, y: 0.12, z: -0.20, color: 0x0b0d12 },
      { w: 0.05, h: 0.06, d: 0.05, x: 0.09, y: 0.12, z: -0.20, color: 0x0b0d12 },
      { w: 0.18, h: 0.05, d: 0.04, x: 0, y: -0.02, z: -0.19, color: 0x4b1908 },
    ],
    torsoExtra: [
      // Bark knot + wooden log pack flush on back
      { w: 0.14, h: 0.14, d: 0.10, x: -0.10, y: 0.36, z: 0.09, color: 0x6b3210 },
      { w: 0.12, h: 0.22, d: 0.12, x: 0.13, y: 0.24, z: 0.14, color: 0xdf8c44 },
    ],
    outfit: {
      jacket: '#9e5e32',
      pants: '#4b2812',
      stripe: '#e7ad6f',
      bikePrimary: '#cb5817',
      bikeAccent: '#46d97c',
      visor: '#eada33',
    },
  },

  // 5: WHAT? (Confused "???" meme — curly fade hair, white tee & 3 bobbing pixel question marks!)
  {
    head: [
      // Warm bronze head
      { w: 0.36, h: 0.36, d: 0.36, x: 0, y: 0.01, z: 0, color: 0x9d6849 },
      // Crisp dark curly fade hair cap
      { w: 0.39, h: 0.14, d: 0.39, x: 0, y: 0.16, z: 0.01, color: 0x261d20 },
      { w: 0.38, h: 0.18, d: 0.10, x: 0, y: 0.05, z: 0.16, color: 0x261d20 },
      // Side ears
      { w: 0.42, h: 0.10, d: 0.08, x: 0, y: 0.0, z: 0, color: 0x8f5b3f },
      // Confused squinted eyes + furrowed brow + puzzled smirk
      { w: 0.10, h: 0.04, d: 0.04, x: -0.08, y: 0.07, z: -0.18, color: 0x261d20 },
      { w: 0.10, h: 0.04, d: 0.04, x: 0.09, y: 0.09, z: -0.18, color: 0x261d20 },
      { w: 0.07, h: 0.05, d: 0.04, x: -0.08, y: 0.02, z: -0.18, color: 0xffffff },
      { w: 0.07, h: 0.05, d: 0.04, x: 0.08, y: 0.02, z: -0.18, color: 0xffffff },
      { w: 0.12, h: 0.04, d: 0.04, x: 0.02, y: -0.08, z: -0.18, color: 0x503426 },
    ],
    // 3 iconic floating pixel '?' question marks with crisp dark comic outlines (readable from BOTH front & behind!)
    floatParts: [
      // Left '?' dark comic backing + bold crimson/gold foreground protruding both front & back
      { w: 0.21, h: 0.23, d: 0.03, x: -0.34, y: 0.26, z: 0.02, color: 0x11131a },
      { w: 0.10, h: 0.10, d: 0.03, x: -0.35, y: 0.11, z: 0.02, color: 0x11131a },
      { w: 0.14, h: 0.05, d: 0.06, x: -0.34, y: 0.32, z: 0.02, color: 0xff3b5c },
      { w: 0.05, h: 0.10, d: 0.06, x: -0.29, y: 0.25, z: 0.02, color: 0xff3b5c },
      { w: 0.09, h: 0.05, d: 0.06, x: -0.34, y: 0.20, z: 0.02, color: 0xff3b5c },
      { w: 0.05, h: 0.05, d: 0.06, x: -0.35, y: 0.11, z: 0.02, color: 0xffbe3b },
      // Top-right '?' dark comic backing + bright white/gold foreground protruding both front & back
      { w: 0.21, h: 0.23, d: 0.03, x: 0.34, y: 0.30, z: 0.04, color: 0x11131a },
      { w: 0.10, h: 0.10, d: 0.03, x: 0.33, y: 0.15, z: 0.04, color: 0x11131a },
      { w: 0.14, h: 0.05, d: 0.06, x: 0.34, y: 0.36, z: 0.04, color: 0xffffff },
      { w: 0.05, h: 0.10, d: 0.06, x: 0.39, y: 0.29, z: 0.04, color: 0xffffff },
      { w: 0.09, h: 0.05, d: 0.06, x: 0.34, y: 0.24, z: 0.04, color: 0xffffff },
      { w: 0.05, h: 0.05, d: 0.06, x: 0.33, y: 0.15, z: 0.04, color: 0xffbe3b },
      // Center-top '?' dark comic backing + vivid cyan/gold foreground protruding both front & back
      { w: 0.17, h: 0.19, d: 0.03, x: 0.0, y: 0.43, z: 0.05, color: 0x11131a },
      { w: 0.09, h: 0.09, d: 0.03, x: 0.0, y: 0.29, z: 0.05, color: 0x11131a },
      { w: 0.11, h: 0.04, d: 0.06, x: 0.0, y: 0.47, z: 0.05, color: 0x38e2d4 },
      { w: 0.04, h: 0.09, d: 0.06, x: 0.04, y: 0.41, z: 0.05, color: 0x38e2d4 },
      { w: 0.05, h: 0.05, d: 0.06, x: 0.0, y: 0.29, z: 0.05, color: 0xffbe3b },
    ],
    outfit: {
      jacket: '#ece8ef',
      pants: '#252229',
      stripe: '#2d2325',
      bikePrimary: '#edf2f7',
      bikeAccent: '#ff3b5c',
      visor: '#ffffff',
      hasFloatingMarks: true,
    },
  },

  // 6: PHONE (Yellow chick/duck staring at phone + glowing purple smartphone backpack!)
  {
    head: [
      // Round sunny-yellow chick/duck head
      { w: 0.38, h: 0.36, d: 0.38, x: 0, y: 0.01, z: 0, color: 0xf9de31 },
      // Cute 3-block yellow duck feather tuft on top
      { w: 0.08, h: 0.12, d: 0.08, x: 0, y: 0.24, z: 0, color: 0xf8ed77 },
      { w: 0.07, h: 0.08, d: 0.07, x: -0.07, y: 0.22, z: 0.02, color: 0xf9de31 },
      // Cute eyes + small orange beak
      { w: 0.06, h: 0.07, d: 0.04, x: -0.09, y: 0.04, z: -0.19, color: 0x0b0d12 },
      { w: 0.06, h: 0.07, d: 0.04, x: 0.09, y: 0.04, z: -0.19, color: 0x0b0d12 },
      { w: 0.14, h: 0.07, d: 0.10, x: 0, y: -0.03, z: -0.22, color: 0xdea115 },
      // Lavender-purple headphones band over head!
      { w: 0.44, h: 0.06, d: 0.10, x: 0, y: 0.19, z: 0, color: 0x826aa7 },
      { w: 0.08, h: 0.16, d: 0.14, x: -0.22, y: 0.04, z: 0, color: 0xb185ff },
      { w: 0.08, h: 0.16, d: 0.14, x: 0.22, y: 0.04, z: 0, color: 0xb185ff },
    ],
    torsoExtra: [
      // Giant purple smartphone strapped flush on back with bright lavender screen!
      { w: 0.28, h: 0.42, d: 0.14, x: 0, y: 0.32, z: 0.13, color: 0x5c4680 },
      { w: 0.22, h: 0.34, d: 0.06, x: 0, y: 0.32, z: 0.19, color: 0xc4a4ff },
      { w: 0.08, h: 0.04, d: 0.04, x: 0, y: 0.46, z: 0.21, color: 0x1a1526 },
    ],
    outfit: {
      jacket: '#f2d429',
      pants: '#45345c',
      stripe: '#b185ff',
      bikePrimary: '#9f6ef5',
      bikeAccent: '#f9de31',
      visor: '#b185ff',
    },
  },

  // 7: ALIEN CAT (Yellow cat with twin glowing alien antennae + silver astro space suit!)
  {
    head: [
      // Bright yellow alien cat head
      { w: 0.40, h: 0.36, d: 0.38, x: 0, y: 0.01, z: 0, color: 0xfceb00 },
      // Pointy cat ears on sides
      { w: 0.11, h: 0.14, d: 0.09, x: -0.15, y: 0.24, z: 0.0, color: 0xfceb00 },
      { w: 0.11, h: 0.14, d: 0.09, x: 0.15, y: 0.24, z: 0.0, color: 0xfceb00 },
      { w: 0.06, h: 0.08, d: 0.05, x: -0.15, y: 0.24, z: -0.04, color: 0xeb9d5a },
      { w: 0.06, h: 0.08, d: 0.05, x: 0.15, y: 0.24, z: -0.04, color: 0xeb9d5a },
      // Twin tall alien antennae stalks!
      { w: 0.04, h: 0.24, d: 0.04, x: -0.08, y: 0.30, z: 0.01, color: 0x0b0d12 },
      { w: 0.04, h: 0.24, d: 0.04, x: 0.08, y: 0.30, z: 0.01, color: 0x0b0d12 },
      // Big dark alien oval eyes + cream muzzle
      { w: 0.11, h: 0.12, d: 0.04, x: -0.09, y: 0.03, z: -0.19, color: 0x0b0d12 },
      { w: 0.11, h: 0.12, d: 0.04, x: 0.09, y: 0.03, z: -0.19, color: 0x0b0d12 },
      { w: 0.18, h: 0.09, d: 0.05, x: 0, y: -0.08, z: -0.19, color: 0xfefb87 },
    ],
    // Glowing antenna orbs (unlit BasicMaterial so they pop in Storm/Fog/Sunset!)
    floatParts: [
      { w: 0.10, h: 0.10, d: 0.10, x: -0.09, y: 0.44, z: 0.01, color: 0xfefb87 },
      { w: 0.10, h: 0.10, d: 0.10, x: 0.09, y: 0.44, z: 0.01, color: 0xfefb87 },
    ],
    torsoExtra: [
      // Silver astro jetpack flush on back with glowing yellow stripe & dark thrusters!
      { w: 0.36, h: 0.38, d: 0.22, x: 0, y: 0.32, z: 0.13, color: 0x9aa6b5 },
      { w: 0.10, h: 0.28, d: 0.08, x: 0, y: 0.32, z: 0.22, color: 0xffea00 },
      { w: 0.09, h: 0.08, d: 0.09, x: -0.10, y: 0.11, z: 0.15, color: 0x262e3d },
      { w: 0.09, h: 0.08, d: 0.09, x: 0.10, y: 0.11, z: 0.15, color: 0x262e3d },
    ],
    outfit: {
      jacket: '#9da9b8',
      pants: '#465263',
      stripe: '#ffea00',
      bikePrimary: '#ffea00',
      bikeAccent: '#7f93ad',
      visor: '#0b0d12',
      hasFloatingMarks: false,
    },
  },

  // 8: COWBOY (White/silver cat wearing a big wide-brimmed brown Cowboy Hat!)
  {
    head: [
      // Crisp white & silver cat head
      { w: 0.38, h: 0.34, d: 0.36, x: 0, y: -0.01, z: 0, color: 0xf5f7fa },
      { w: 0.38, h: 0.12, d: 0.36, x: 0, y: -0.12, z: 0.01, color: 0xc4c4c3 },
      // Pointy cat ears peeking under the hat brim
      { w: 0.10, h: 0.12, d: 0.08, x: -0.17, y: 0.15, z: -0.02, color: 0xc4c4c3 },
      { w: 0.10, h: 0.12, d: 0.08, x: 0.17, y: 0.15, z: -0.02, color: 0xc4c4c3 },
      // Iconic wide-brimmed brown leather Cowboy Hat!
      { w: 0.72, h: 0.06, d: 0.62, x: 0, y: 0.19, z: 0.0, color: 0x74411f },
      { w: 0.10, h: 0.08, d: 0.54, x: -0.33, y: 0.23, z: 0.0, color: 0x5c301b }, // curled left brim
      { w: 0.10, h: 0.08, d: 0.54, x: 0.33, y: 0.23, z: 0.0, color: 0x5c301b }, // curled right brim
      { w: 0.42, h: 0.22, d: 0.40, x: 0, y: 0.32, z: 0.0, color: 0xbd6b2f }, // tall hat crown
      { w: 0.44, h: 0.06, d: 0.42, x: 0, y: 0.24, z: 0.0, color: 0x3b1e0e }, // dark leather hatband
      { w: 0.10, h: 0.06, d: 0.04, x: 0, y: 0.24, z: -0.21, color: 0xffbe3b }, // gold belt buckle
      // Cat face details
      { w: 0.06, h: 0.06, d: 0.04, x: -0.09, y: 0.02, z: -0.18, color: 0x0b0d12 },
      { w: 0.06, h: 0.06, d: 0.04, x: 0.09, y: 0.02, z: -0.18, color: 0x0b0d12 },
      { w: 0.06, h: 0.04, d: 0.05, x: 0, y: -0.03, z: -0.19, color: 0xc68e88 },
      // Red western bandana collar
      { w: 0.42, h: 0.08, d: 0.40, x: 0, y: -0.19, z: 0.01, color: 0xd63848 },
    ],
    torsoExtra: [
      // Red cowboy bandana triangle flush on upper back + fluffy silver-white cat tail!
      { w: 0.28, h: 0.16, d: 0.10, x: 0, y: 0.44, z: 0.07, color: 0xd63848 },
      { w: 0.11, h: 0.11, d: 0.32, x: 0, y: 0.05, z: 0.27, color: 0xdfe3e8 },
      { w: 0.11, h: 0.24, d: 0.11, x: 0, y: 0.18, z: 0.41, color: 0xffffff },
    ],
    outfit: {
      jacket: '#8f5126',
      pants: '#344c6e',
      stripe: '#f0f2f5',
      bikePrimary: '#bd6b2f',
      bikeAccent: '#ffbe3b',
      visor: '#d63848',
    },
  },
];

function parseCssHex(cssHex: string): number {
  return Number.parseInt(cssHex.startsWith('#') ? cssHex.slice(1) : cssHex, 16) || 0xffffff;
}

const _modelCache = new Map<number, AvatarCharacterModel>();

/**
 * Lazily constructs and caches a SINGLE-DRAW-CALL merged upper-body 3D character model for avatar 0..8
 * (combines torso + back stripe + character head + backpack/tail/hood accessories + idle arms into 1 mesh!).
 * Zero per-rider geometry allocation — all players/bots wearing the same avatar share exact GPU buffers.
 */
export function getAvatarCharacterModel(avatarIdx: number): AvatarCharacterModel {
  const safe = Number.isFinite(avatarIdx)
    ? ((Math.floor(avatarIdx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT
    : 0;
  const cached = _modelCache.get(safe);
  if (cached) return cached;

  const spec = AVATAR_CHARACTER_SPECS[safe];
  const jacketHex = parseCssHex(spec.outfit.jacket);
  const stripeHex = parseCssHex(spec.outfit.stripe);

  // Base torso + back stripe + translated head + torso accessories (in torsoGroup space)
  const baseParts: BoxSpec[] = [
    { w: 0.48, h: 0.58, d: 0.32, x: 0, y: 0.28, z: -0.05, rx: -0.42, color: jacketHex },
    { w: 0.16, h: 0.5, d: 0.05, x: 0, y: 0.28, z: 0.11, rx: -0.42, color: stripeHex },
  ];
  for (let i = 0; i < spec.head.length; i++) {
    const h = spec.head[i];
    baseParts.push({
      ...h,
      y: h.y + 0.7,
      z: h.z - 0.22,
    });
  }
  if (spec.torsoExtra) {
    for (let i = 0; i < spec.torsoExtra.length; i++) {
      baseParts.push(spec.torsoExtra[i]);
    }
  }

  // Idle riding arms baked directly into upperWithArmsGeo (saves 2 extra draw calls per bike when not swinging!)
  const withArmsParts: BoxSpec[] = [
    ...baseParts,
    { w: 0.15, h: 0.46, d: 0.15, x: -0.29, y: 0.3, z: -0.26, rx: 0.92, color: jacketHex },
    { w: 0.15, h: 0.46, d: 0.15, x: 0.29, y: 0.3, z: -0.26, rx: 0.92, color: jacketHex },
  ];

  const model: AvatarCharacterModel = {
    upperWithArmsGeo: mergeColoredBoxes(withArmsParts),
    upperNoArmsGeo: mergeColoredBoxes(baseParts),
    floatGeo: spec.floatParts ? mergeColoredBoxes(spec.floatParts) : null,
    outfit: spec.outfit,
  };
  _modelCache.set(safe, model);
  return model;
}
