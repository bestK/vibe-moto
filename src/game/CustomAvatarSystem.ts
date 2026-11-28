import {
  AvatarCharacterModel,
  AvatarOutfit,
  BoxSpec,
  mergeColoredBoxes,
} from './AvatarModels';

export type CustomAccessory =
  | 'none'
  | 'halo'
  | 'horns'
  | 'crown'
  | 'wings'
  | 'cape'
  | 'antenna';

export const CUSTOM_ACCESSORIES: readonly CustomAccessory[] = [
  'none',
  'halo',
  'horns',
  'crown',
  'wings',
  'cape',
  'antenna',
] as const;

export interface CustomAvatarSkin {
  head: string;
  face: string;
  hair: string;
  jacket: string;
  stripe: string;
  pants: string;
  boots: string;
  bikePrimary: string;
  bikeAccent: string;
  visor: string;
  accessory: CustomAccessory;
}

export interface SavedCustomAvatar {
  id: string;
  name: string;
  prompt?: string;
  portraitDataUrl?: string;
  skin: CustomAvatarSkin;
  createdAt: number;
}

export const DEFAULT_CUSTOM_SKIN: CustomAvatarSkin = {
  head: '#f3c6a5',
  face: '#f7d2b6',
  hair: '#1b1f2e',
  jacket: '#ef3e56',
  stripe: '#ffbe3b',
  pants: '#22283a',
  boots: '#12151f',
  bikePrimary: '#ef3e56',
  bikeAccent: '#ffbe3b',
  visor: '#38e2d4',
  accessory: 'none',
};

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ACCESSORY_SET = new Set<string>(CUSTOM_ACCESSORIES);

function normalizeHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = HEX_RE.exec(trimmed);
  if (!m) return null;
  const digits = m[1];
  if (digits.length === 3) {
    const r = digits[0];
    const g = digits[1];
    const b = digits[2];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return `#${digits}`.toLowerCase();
}

function parseHexNum(cssHex: string): number {
  return Number.parseInt(cssHex.startsWith('#') ? cssHex.slice(1) : cssHex, 16) || 0xffffff;
}

function shadeHex(cssHex: string, factor: number): number {
  const n = parseHexNum(cssHex);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((n & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

function shadeCssHex(cssHex: string, factor: number): string {
  const n = shadeHex(cssHex, factor);
  return `#${n.toString(16).padStart(6, '0')}`;
}

/**
 * Validates and normalizes any untrusted custom avatar skin payload (from AI JSON,
 * saved account data, or multiplayer sync) into a strict CustomAvatarSkin.
 */
export function sanitizeCustomSkin(raw: unknown): CustomAvatarSkin | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const head = normalizeHex(obj.head);
  const face = normalizeHex(obj.face);
  const hair = normalizeHex(obj.hair);
  const jacket = normalizeHex(obj.jacket);
  const stripe = normalizeHex(obj.stripe);
  const pants = normalizeHex(obj.pants);
  const boots = normalizeHex(obj.boots);
  const bikePrimary = normalizeHex(obj.bikePrimary);
  const bikeAccent = normalizeHex(obj.bikeAccent);
  const visor = normalizeHex(obj.visor);

  const validCount =
    (head ? 1 : 0) +
    (face ? 1 : 0) +
    (hair ? 1 : 0) +
    (jacket ? 1 : 0) +
    (stripe ? 1 : 0) +
    (pants ? 1 : 0) +
    (boots ? 1 : 0) +
    (bikePrimary ? 1 : 0) +
    (bikeAccent ? 1 : 0) +
    (visor ? 1 : 0);

  if (validCount === 0) return null;

  const rawAcc = typeof obj.accessory === 'string' ? obj.accessory.trim().toLowerCase() : 'none';
  const accessory: CustomAccessory = ACCESSORY_SET.has(rawAcc)
    ? (rawAcc as CustomAccessory)
    : 'none';

  const resolvedHead = head ?? face ?? DEFAULT_CUSTOM_SKIN.head;
  const resolvedFace = face ?? head ?? DEFAULT_CUSTOM_SKIN.face;
  const resolvedJacket = jacket ?? bikePrimary ?? DEFAULT_CUSTOM_SKIN.jacket;
  const resolvedStripe = stripe ?? bikeAccent ?? DEFAULT_CUSTOM_SKIN.stripe;
  const resolvedPants = pants ?? DEFAULT_CUSTOM_SKIN.pants;
  const resolvedBoots = boots ?? shadeCssHex(resolvedPants, 0.65);

  return {
    head: resolvedHead,
    face: resolvedFace,
    hair: hair ?? DEFAULT_CUSTOM_SKIN.hair,
    jacket: resolvedJacket,
    stripe: resolvedStripe,
    pants: resolvedPants,
    boots: resolvedBoots,
    bikePrimary: bikePrimary ?? resolvedJacket,
    bikeAccent: bikeAccent ?? resolvedStripe,
    visor: visor ?? DEFAULT_CUSTOM_SKIN.visor,
    accessory,
  };
}

export function getCustomSkinKey(skin: CustomAvatarSkin): string {
  return `${skin.head}|${skin.face}|${skin.hair}|${skin.jacket}|${skin.stripe}|${skin.pants}|${skin.boots}|${skin.bikePrimary}|${skin.bikeAccent}|${skin.visor}|${skin.accessory}`;
}

// ---------------------------------------------------------------------------
// Runtime Peer Custom Skin Registry (local + remote players)
// ---------------------------------------------------------------------------

const peerCustomSkinMap = new Map<string, CustomAvatarSkin>();
let customSkinVersion = 0;

export function setPeerCustomSkin(peerId: string, skin: CustomAvatarSkin | null): void {
  if (!peerId) return;
  const existing = peerCustomSkinMap.get(peerId) ?? null;

  if (!skin) {
    if (existing) {
      peerCustomSkinMap.delete(peerId);
      customSkinVersion++;
    }
    return;
  }

  const clean = sanitizeCustomSkin(skin);
  if (!clean) {
    if (existing) {
      peerCustomSkinMap.delete(peerId);
      customSkinVersion++;
    }
    return;
  }

  if (existing && getCustomSkinKey(existing) === getCustomSkinKey(clean)) {
    return;
  }

  peerCustomSkinMap.set(peerId, clean);
  customSkinVersion++;
}

export function getPeerCustomSkin(peerId: string): CustomAvatarSkin | null {
  if (!peerId) return null;
  return peerCustomSkinMap.get(peerId) ?? null;
}

export function getCustomSkinVersion(): number {
  return customSkinVersion;
}

// ---------------------------------------------------------------------------
// 3D Voxel Custom Avatar Character Model Builder (single-draw-call merged!)
// ---------------------------------------------------------------------------

const customModelCache = new Map<string, AvatarCharacterModel>();

export function buildCustomAvatarCharacterModel(skin: CustomAvatarSkin): AvatarCharacterModel {
  const clean = sanitizeCustomSkin(skin) ?? DEFAULT_CUSTOM_SKIN;
  const cacheKey = getCustomSkinKey(clean);
  const cached = customModelCache.get(cacheKey);
  if (cached) return cached;

  const headHex = parseHexNum(clean.head);
  const faceHex = parseHexNum(clean.face);
  const hairHex = parseHexNum(clean.hair);
  const hairShadeHex = shadeHex(clean.hair, 0.8);
  const jacketHex = parseHexNum(clean.jacket);
  const stripeHex = parseHexNum(clean.stripe);
  const bootsHex = parseHexNum(clean.boots);
  const accentHex = parseHexNum(clean.bikeAccent);
  const visorHex = parseHexNum(clean.visor);
  const mouthHex = shadeHex(clean.face, 0.56);

  // Head parts in local head space (translated to (0, 0.70, -0.22) inside torsoGroup, -Z forward)
  const headParts: BoxSpec[] = [
    // Core voxel head
    { w: 0.38, h: 0.36, d: 0.38, x: 0, y: 0.01, z: 0, color: headHex },
    // Front face plate
    { w: 0.30, h: 0.24, d: 0.05, x: 0, y: -0.02, z: -0.175, color: faceHex },
    // Crisp layered voxel hair dome, back, sides & front bangs
    { w: 0.42, h: 0.13, d: 0.42, x: 0, y: 0.17, z: 0.01, color: hairHex },
    { w: 0.36, h: 0.06, d: 0.36, x: 0, y: 0.24, z: 0.01, color: hairShadeHex },
    { w: 0.42, h: 0.26, d: 0.12, x: 0, y: 0.02, z: 0.16, color: hairHex },
    { w: 0.07, h: 0.20, d: 0.26, x: -0.18, y: 0.04, z: 0.03, color: hairHex },
    { w: 0.07, h: 0.20, d: 0.26, x: 0.18, y: 0.04, z: 0.03, color: hairHex },
    { w: 0.34, h: 0.07, d: 0.06, x: 0, y: 0.12, z: -0.19, color: hairHex },
    // Side ear hints
    { w: 0.43, h: 0.09, d: 0.07, x: 0, y: -0.01, z: -0.01, color: headHex },
    // Stylised visor / goggles band + crisp dark pupils & glint
    { w: 0.34, h: 0.10, d: 0.06, x: 0, y: 0.03, z: -0.195, color: visorHex },
    { w: 0.06, h: 0.06, d: 0.04, x: -0.085, y: 0.03, z: -0.21, color: 0x0b0d14 },
    { w: 0.06, h: 0.06, d: 0.04, x: 0.085, y: 0.03, z: -0.21, color: 0x0b0d14 },
    { w: 0.025, h: 0.025, d: 0.04, x: -0.075, y: 0.045, z: -0.216, color: 0xffffff },
    { w: 0.025, h: 0.025, d: 0.04, x: 0.095, y: 0.045, z: -0.216, color: 0xffffff },
    // Expressive mouth accent
    { w: 0.11, h: 0.035, d: 0.04, x: 0, y: -0.09, z: -0.19, color: mouthHex },
    // Jacket collar ring around neck
    { w: 0.43, h: 0.08, d: 0.41, x: 0, y: -0.18, z: 0.01, color: stripeHex },
  ];

  const torsoExtra: BoxSpec[] = [
    // Front racing/zipper stripe (pops in Selfie camera!)
    { w: 0.14, h: 0.44, d: 0.05, x: 0, y: 0.27, z: -0.20, rx: -0.42, color: stripeHex },
    // Shoulder trim pads
    { w: 0.14, h: 0.12, d: 0.28, x: -0.26, y: 0.50, z: -0.10, rx: -0.42, color: accentHex },
    { w: 0.14, h: 0.12, d: 0.28, x: 0.26, y: 0.50, z: -0.10, rx: -0.42, color: accentHex },
    // Waist belt matching boots
    { w: 0.50, h: 0.09, d: 0.34, x: 0, y: 0.04, z: 0.04, rx: -0.42, color: bootsHex },
  ];

  let floatParts: BoxSpec[] | null = null;

  switch (clean.accessory) {
    case 'halo': {
      // Glowing floating pixel halo above head (unlit BasicMaterial + subtle bob)
      const haloGold = 0xffdd4a;
      const haloGlow = 0xfff6b8;
      floatParts = [
        { w: 0.42, h: 0.05, d: 0.06, x: 0, y: 0.38, z: -0.18, color: haloGold },
        { w: 0.42, h: 0.05, d: 0.06, x: 0, y: 0.38, z: 0.18, color: haloGold },
        { w: 0.06, h: 0.05, d: 0.34, x: -0.18, y: 0.38, z: 0, color: haloGlow },
        { w: 0.06, h: 0.05, d: 0.34, x: 0.18, y: 0.38, z: 0, color: haloGlow },
      ];
      break;
    }
    case 'horns': {
      const hornBase = accentHex;
      const hornTip = visorHex;
      headParts.push(
        { w: 0.09, h: 0.18, d: 0.09, x: -0.15, y: 0.30, z: -0.02, rz: 0.32, color: hornBase },
        { w: 0.09, h: 0.18, d: 0.09, x: 0.15, y: 0.30, z: -0.02, rz: -0.32, color: hornBase },
        { w: 0.06, h: 0.14, d: 0.06, x: -0.21, y: 0.42, z: -0.04, rz: 0.52, color: hornTip },
        { w: 0.06, h: 0.14, d: 0.06, x: 0.21, y: 0.42, z: -0.04, rz: -0.52, color: hornTip }
      );
      break;
    }
    case 'crown': {
      const crownGold = 0xffcb32;
      const crownDark = 0xd99b10;
      headParts.push(
        { w: 0.38, h: 0.08, d: 0.38, x: 0, y: 0.29, z: 0.0, color: crownGold },
        { w: 0.08, h: 0.12, d: 0.08, x: 0, y: 0.38, z: -0.15, color: crownGold },
        { w: 0.08, h: 0.10, d: 0.08, x: -0.15, y: 0.37, z: -0.15, color: crownDark },
        { w: 0.08, h: 0.10, d: 0.08, x: 0.15, y: 0.37, z: -0.15, color: crownDark },
        { w: 0.08, h: 0.10, d: 0.08, x: -0.15, y: 0.37, z: 0.15, color: crownDark },
        { w: 0.08, h: 0.10, d: 0.08, x: 0.15, y: 0.37, z: 0.15, color: crownDark },
        { w: 0.07, h: 0.06, d: 0.05, x: 0, y: 0.30, z: -0.19, color: visorHex }
      );
      break;
    }
    case 'wings': {
      // Swept voxel mecha/angel wings mounted cleanly on upper back
      const wingMain = accentHex;
      const wingTrim = visorHex;
      torsoExtra.push(
        // Left wing (3 layered feathers/blades)
        { w: 0.42, h: 0.14, d: 0.08, x: -0.36, y: 0.48, z: 0.22, ry: 0.42, rz: 0.28, color: wingMain },
        { w: 0.54, h: 0.12, d: 0.07, x: -0.50, y: 0.38, z: 0.32, ry: 0.48, rz: 0.12, color: wingTrim },
        { w: 0.36, h: 0.10, d: 0.07, x: -0.34, y: 0.25, z: 0.28, ry: 0.42, rz: -0.1, color: wingMain },
        // Right wing (mirrored)
        { w: 0.42, h: 0.14, d: 0.08, x: 0.36, y: 0.48, z: 0.22, ry: -0.42, rz: -0.28, color: wingMain },
        { w: 0.54, h: 0.12, d: 0.07, x: 0.50, y: 0.38, z: 0.32, ry: -0.48, rz: -0.12, color: wingTrim },
        { w: 0.36, h: 0.10, d: 0.07, x: 0.34, y: 0.25, z: 0.28, ry: -0.42, rz: 0.1, color: wingMain }
      );
      break;
    }
    case 'cape': {
      // Flowing multi-tier hero cape streaming behind torso
      const capeMain = accentHex;
      const capeTrim = stripeHex;
      torsoExtra.push(
        { w: 0.54, h: 0.16, d: 0.10, x: 0, y: 0.48, z: 0.11, rx: -0.28, color: capeTrim },
        { w: 0.58, h: 0.36, d: 0.08, x: 0, y: 0.28, z: 0.22, rx: -0.18, color: capeMain },
        { w: 0.64, h: 0.28, d: 0.07, x: 0, y: 0.02, z: 0.30, rx: -0.06, color: capeMain },
        { w: 0.64, h: 0.06, d: 0.08, x: 0, y: -0.11, z: 0.32, rx: -0.06, color: capeTrim }
      );
      break;
    }
    case 'antenna': {
      // Twin cyber/alien antennae with glowing visor-colored tip orbs
      headParts.push(
        { w: 0.04, h: 0.24, d: 0.04, x: -0.10, y: 0.31, z: 0.01, rz: 0.14, color: 0x1a1e2e },
        { w: 0.04, h: 0.24, d: 0.04, x: 0.10, y: 0.31, z: 0.01, rz: -0.14, color: 0x1a1e2e }
      );
      floatParts = [
        { w: 0.09, h: 0.09, d: 0.09, x: -0.12, y: 0.45, z: 0.01, color: visorHex },
        { w: 0.09, h: 0.09, d: 0.09, x: 0.12, y: 0.45, z: 0.01, color: visorHex },
      ];
      break;
    }
    case 'none':
    default:
      break;
  }

  // Combine torso + stripe + translated head + torso accessories (exact AvatarModels torsoGroup space)
  const baseParts: BoxSpec[] = [
    { w: 0.48, h: 0.58, d: 0.32, x: 0, y: 0.28, z: -0.05, rx: -0.42, color: jacketHex },
    { w: 0.16, h: 0.50, d: 0.05, x: 0, y: 0.28, z: 0.11, rx: -0.42, color: stripeHex },
  ];
  for (let i = 0; i < headParts.length; i++) {
    const h = headParts[i];
    baseParts.push({
      ...h,
      y: h.y + 0.7,
      z: h.z - 0.22,
    });
  }
  for (let i = 0; i < torsoExtra.length; i++) {
    baseParts.push(torsoExtra[i]);
  }

  // Idle riding arms + gloves baked directly into upperWithArmsGeo (1 draw call!)
  const withArmsParts: BoxSpec[] = [
    ...baseParts,
    { w: 0.15, h: 0.46, d: 0.15, x: -0.29, y: 0.3, z: -0.26, rx: 0.92, color: jacketHex },
    { w: 0.15, h: 0.46, d: 0.15, x: 0.29, y: 0.3, z: -0.26, rx: 0.92, color: jacketHex },
    { w: 0.16, h: 0.12, d: 0.16, x: -0.29, y: 0.18, z: -0.44, rx: 0.92, color: bootsHex },
    { w: 0.16, h: 0.12, d: 0.16, x: 0.29, y: 0.18, z: -0.44, rx: 0.92, color: bootsHex },
  ];

  const outfit: AvatarOutfit = {
    jacket: clean.jacket,
    pants: clean.pants,
    stripe: clean.stripe,
    bikePrimary: clean.bikePrimary,
    bikeAccent: clean.bikeAccent,
    visor: clean.visor,
    hasFloatingMarks: clean.accessory === 'halo',
  };

  const model: AvatarCharacterModel = {
    upperWithArmsGeo: mergeColoredBoxes(withArmsParts),
    upperNoArmsGeo: mergeColoredBoxes(baseParts),
    floatGeo: floatParts ? mergeColoredBoxes(floatParts) : null,
    outfit,
  };

  customModelCache.set(cacheKey, model);
  return model;
}

// ---------------------------------------------------------------------------
// Crisp 32x32 Pixel-Art Portrait Generator
// ---------------------------------------------------------------------------

export function renderSkinPortraitDataUrl(
  skin: CustomAvatarSkin,
  _refImageDataUrl?: string
): string {
  if (typeof document === 'undefined') return '';
  const clean = sanitizeCustomSkin(skin) ?? DEFAULT_CUSTOM_SKIN;

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;

  const bgDark = shadeCssHex(clean.bikePrimary, 0.34);
  const bgMid = shadeCssHex(clean.bikePrimary, 0.52);
  const outline = '#0b0d14';

  // Background checkerboard / arcade sky bands
  ctx.fillStyle = bgDark;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = bgMid;
  ctx.fillRect(0, 0, 32, 18);
  ctx.fillStyle = clean.bikeAccent;
  ctx.fillRect(0, 0, 32, 1);
  ctx.fillRect(0, 31, 32, 1);

  // Back accessories (wings / cape) behind shoulders & head
  if (clean.accessory === 'wings') {
    ctx.fillStyle = outline;
    ctx.fillRect(1, 13, 7, 11);
    ctx.fillRect(24, 13, 7, 11);
    ctx.fillStyle = clean.bikeAccent;
    ctx.fillRect(2, 14, 6, 4);
    ctx.fillRect(24, 14, 6, 4);
    ctx.fillStyle = clean.visor;
    ctx.fillRect(2, 18, 5, 3);
    ctx.fillRect(25, 18, 5, 3);
    ctx.fillStyle = clean.bikeAccent;
    ctx.fillRect(3, 21, 4, 2);
    ctx.fillRect(25, 21, 4, 2);
  } else if (clean.accessory === 'cape') {
    ctx.fillStyle = outline;
    ctx.fillRect(3, 21, 26, 11);
    ctx.fillStyle = clean.bikeAccent;
    ctx.fillRect(4, 22, 24, 10);
    ctx.fillStyle = clean.stripe;
    ctx.fillRect(4, 22, 24, 2);
  }

  // Shoulders & jacket + center stripe
  ctx.fillStyle = outline;
  ctx.fillRect(5, 22, 22, 10);
  ctx.fillStyle = clean.jacket;
  ctx.fillRect(6, 23, 20, 9);
  ctx.fillStyle = clean.stripe;
  ctx.fillRect(14, 23, 4, 9);
  ctx.fillRect(11, 22, 10, 2);
  // Shoulder accent tabs
  ctx.fillStyle = clean.bikeAccent;
  ctx.fillRect(6, 23, 3, 3);
  ctx.fillRect(23, 23, 3, 3);

  // Head silhouette & face
  ctx.fillStyle = outline;
  ctx.fillRect(8, 8, 16, 15);
  ctx.fillStyle = clean.head;
  ctx.fillRect(9, 9, 14, 13);
  ctx.fillStyle = clean.face;
  ctx.fillRect(10, 12, 12, 9);

  // Hair cap, bangs & side locks
  ctx.fillStyle = clean.hair;
  ctx.fillRect(9, 8, 14, 5);
  ctx.fillRect(8, 10, 2, 7);
  ctx.fillRect(22, 10, 2, 7);
  ctx.fillRect(11, 13, 3, 2);
  ctx.fillRect(18, 13, 3, 2);
  ctx.fillStyle = shadeCssHex(clean.hair, 0.78);
  ctx.fillRect(10, 7, 12, 2);

  // Visor & crisp pixel eyes
  ctx.fillStyle = outline;
  ctx.fillRect(9, 14, 14, 5);
  ctx.fillStyle = clean.visor;
  ctx.fillRect(10, 15, 12, 3);
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(11, 15, 3, 3);
  ctx.fillRect(18, 15, 3, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(11, 15, 1, 1);
  ctx.fillRect(18, 15, 1, 1);

  // Mouth
  ctx.fillStyle = shadeCssHex(clean.face, 0.56);
  ctx.fillRect(14, 20, 4, 1);

  // Top head accessories
  if (clean.accessory === 'halo') {
    ctx.fillStyle = '#ffdd4a';
    ctx.fillRect(9, 2, 14, 2);
    ctx.fillStyle = '#fff6b8';
    ctx.fillRect(11, 2, 10, 1);
    ctx.fillRect(8, 3, 2, 1);
    ctx.fillRect(22, 3, 2, 1);
  } else if (clean.accessory === 'horns') {
    ctx.fillStyle = clean.bikeAccent;
    ctx.fillRect(8, 4, 3, 4);
    ctx.fillRect(21, 4, 3, 4);
    ctx.fillStyle = clean.visor;
    ctx.fillRect(6, 2, 3, 3);
    ctx.fillRect(23, 2, 3, 3);
  } else if (clean.accessory === 'crown') {
    ctx.fillStyle = outline;
    ctx.fillRect(9, 2, 14, 6);
    ctx.fillStyle = '#ffcb32';
    ctx.fillRect(10, 5, 12, 2);
    ctx.fillRect(10, 3, 2, 2);
    ctx.fillRect(15, 2, 2, 3);
    ctx.fillRect(20, 3, 2, 2);
    ctx.fillStyle = clean.visor;
    ctx.fillRect(15, 5, 2, 2);
  } else if (clean.accessory === 'antenna') {
    ctx.fillStyle = '#1a1e2e';
    ctx.fillRect(11, 4, 1, 4);
    ctx.fillRect(20, 4, 1, 4);
    ctx.fillStyle = clean.visor;
    ctx.fillRect(10, 2, 3, 2);
    ctx.fillRect(19, 2, 3, 2);
  }

  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Offline / Local Keyword + Reference-Palette Custom Skin Generator
// ---------------------------------------------------------------------------

interface ColorKeyword {
  words: readonly string[];
  hex: string;
}

const COLOR_KEYWORDS: readonly ColorKeyword[] = [
  { words: ['红', '赤', '焰', '火', 'red', 'crimson', 'flame', 'fire', 'ruby'], hex: '#e63946' },
  { words: ['黑', '暗', '影', '夜', '墨', 'black', 'dark', 'shadow', 'obsidian'], hex: '#1a1e2b' },
  { words: ['白', '雪', '银', '圣', 'white', 'snow', 'silver', 'pearl', 'holy'], hex: '#edf2f7' },
  { words: ['青', '赛博', '霓虹', '电', 'cyan', 'neon', 'cyber', 'teal', 'aqua'], hex: '#00e5ff' },
  { words: ['蓝', '海', '冰', '霜', 'blue', 'ice', 'frost', 'cobalt', 'ocean'], hex: '#2f80ed' },
  { words: ['金', '黄', '皇', '阳', '光', 'gold', 'yellow', 'sun', 'amber'], hex: '#ffbe0b' },
  { words: ['紫', '魅', '幻', '星', 'purple', 'violet', 'magenta', 'galaxy'], hex: '#8b5cf6' },
  { words: ['绿', '森', '翠', '毒', '草', 'green', 'emerald', 'lime', 'jade', 'forest'], hex: '#2ecc71' },
  { words: ['粉', '樱', '桃', '甜', 'pink', 'sakura', 'rose', 'peach'], hex: '#ff5ca8' },
  { words: ['橙', '橘', '夕阳', 'orange', 'sunset', 'tangerine'], hex: '#ff7b00' },
  { words: ['棕', '褐', '咖', '木', '沙', 'brown', 'wood', 'desert', 'coffee'], hex: '#8d5524' },
];

const FALLBACK_PALETTES: readonly { primary: string; accent: string; visor: string; hair: string }[] = [
  { primary: '#e63946', accent: '#ffbe0b', visor: '#00f5d4', hair: '#181c28' },
  { primary: '#3b82f6', accent: '#38e2d4', visor: '#ffbe3b', hair: '#1e293b' },
  { primary: '#8b5cf6', accent: '#ff5ca8', visor: '#00f5d4', hair: '#2a1b3d' },
  { primary: '#10b981', accent: '#facc15', visor: '#38bdf8', hair: '#142920' },
  { primary: '#f97316', accent: '#fde047', visor: '#06b6d4', hair: '#2b1810' },
  { primary: '#ec4899', accent: '#a855f7', visor: '#fef08a', hair: '#2c1528' },
];

function hashPrompt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function detectAccessory(lower: string): CustomAccessory {
  if (/光环|天使|圣|halo|angel|divine/.test(lower)) return 'halo';
  if (/角|恶魔|魔|牛|horn|demon|devil/.test(lower)) return 'horns';
  if (/皇冠|王冠|国王|女王|王子|公主|crown|king|queen|royal/.test(lower)) return 'crown';
  if (/翅|机翼|羽|龙|wing|dragon|phoenix|飞/.test(lower)) return 'wings';
  if (/披风|斗篷|忍者|侠|英雄|武士|cape|cloak|ninja|hero|samurai/.test(lower)) return 'cape';
  if (/天线|外星|机甲|机器|赛博|宇航|antenna|alien|robot|mecha|cyber|astro/.test(lower)) return 'antenna';
  return 'none';
}

function deriveShortName(prompt: string, accessory: CustomAccessory): string {
  const cleaned = prompt
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[，。！？,.!?:：;；"'()（）【】[\]]+/g, ' ')
    .trim();
  if (cleaned.length >= 2) {
    const firstChunk = cleaned.split(/\s+/)[0] || cleaned;
    if (firstChunk.length >= 2 && firstChunk.length <= 12) return firstChunk;
    return cleaned.slice(0, 12).trim();
  }
  const accLabels: Record<CustomAccessory, string> = {
    none: '自定义车手',
    halo: '星光天使',
    horns: '暗影魔王',
    crown: '荣耀之王',
    wings: '苍穹翼骑',
    cape: '疾风侠客',
    antenna: '赛博机甲',
  };
  return accLabels[accessory];
}

export function generateLocalCustomSkin(
  prompt: string,
  dominantHexes?: string[]
): { name: string; skin: CustomAvatarSkin } {
  const text = (prompt || '').trim();
  const lower = text.toLowerCase();
  const h = hashPrompt(text || 'vibemoto-custom');

  const accessory = detectAccessory(lower);

  // Extract explicit colors mentioned in prompt
  const promptColors: string[] = [];
  for (let i = 0; i < COLOR_KEYWORDS.length; i++) {
    const kw = COLOR_KEYWORDS[i];
    for (let j = 0; j < kw.words.length; j++) {
      if (lower.includes(kw.words[j])) {
        if (!promptColors.includes(kw.hex)) promptColors.push(kw.hex);
        break;
      }
    }
  }

  // Sanitize dominant reference image hexes
  const refColors: string[] = [];
  if (dominantHexes && dominantHexes.length > 0) {
    for (let i = 0; i < dominantHexes.length; i++) {
      const hex = normalizeHex(dominantHexes[i]);
      if (hex && !refColors.includes(hex)) {
        refColors.push(hex);
      }
    }
  }

  const preset = FALLBACK_PALETTES[h % FALLBACK_PALETTES.length];
  const merged = [...promptColors, ...refColors];

  const primary = merged[0] ?? preset.primary;
  const secondary = merged[1] ?? preset.accent;
  const tertiary = merged[2] ?? preset.visor;

  // Skin / helmet head tone
  const isMechaOrAlien = /机甲|机器|外星|赛博|robot|mecha|alien|cyber/.test(lower);
  const isDarkTheme = /黑|暗|影|忍者|恶魔|dark|shadow|ninja|demon|goth/.test(lower);

  const head = isMechaOrAlien
    ? primary
    : isDarkTheme
      ? '#d8b49c'
      : '#f3c6a5';
  const face = isMechaOrAlien
    ? shadeCssHex(primary, 0.72)
    : isDarkTheme
      ? '#e2bfa8'
      : '#f7d2b6';

  const hair =
    refColors.length >= 2 && promptColors.length === 0
      ? shadeCssHex(refColors[1], 0.65)
      : /白发|银发|white hair|silver hair/.test(lower)
        ? '#edf2f7'
        : /金发|黄发|blonde|gold hair/.test(lower)
          ? '#ffcf40'
          : /红发|red hair/.test(lower)
            ? '#d62839'
            : /蓝发|青发|blue hair|cyan hair/.test(lower)
              ? '#00b4ff'
              : /粉发|pink hair/.test(lower)
                ? '#ff5ca8'
                : /紫发|purple hair/.test(lower)
                  ? '#8b5cf6'
                  : isDarkTheme
                    ? '#141722'
                    : preset.hair;

  const pants = isDarkTheme ? '#151924' : shadeCssHex(primary, 0.36);
  const boots = shadeCssHex(pants, 0.62);

  const skin: CustomAvatarSkin = {
    head,
    face,
    hair,
    jacket: primary,
    stripe: secondary,
    pants,
    boots,
    bikePrimary: primary,
    bikeAccent: secondary,
    visor: tertiary,
    accessory,
  };

  return {
    name: deriveShortName(text, accessory),
    skin,
  };
}
