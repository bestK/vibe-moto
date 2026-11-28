import * as THREE from 'three';
import { getLang, type Lang } from '../i18n';
import {
  BoxSpec,
  getAvatarCharacterModel,
  getSharedBasicVertexMat,
  getSharedVertexColorMat,
  mergeColoredBoxes,
} from './AvatarModels';
import { getChinaAtlas } from './ChinaTextures';
import { getAvatarVersion } from './PixelAvatars';
import { drawNameplateCanvas, getPixelAtlas } from './PixelTextures';
import { BIKE_PALETTES, BOT_PALETTE, BikePalette, RiderRenderState, WeaponType } from './types';

const MEITUAN_PALETTE: BikePalette = {
  name: 'MEITUAN',
  primary: '#ffc300',
  secondary: '#181920',
  jacket: '#ffc300',
  helmet: '#ffc300',
  visor: '#00f5d4',
  accent: '#181920',
};

const ELEME_PALETTE: BikePalette = {
  name: 'ELEME',
  primary: '#0091ff',
  secondary: '#edf2f4',
  jacket: '#0091ff',
  helmet: '#0091ff',
  visor: '#ffd166',
  accent: '#ffffff',
};

function parseHexColor(cssHex: string): number {
  return Number.parseInt(cssHex.startsWith('#') ? cssHex.slice(1) : cssHex, 16) || 0xffffff;
}

/**
 * Merges left + right dual outer/inner exhaust flame cones into a single 1-draw-call BufferGeometry.
 */
function buildDualFlameGeometry(outerHex: number, innerHex: number): THREE.BufferGeometry {
  const specs: readonly { x: number; radius: number; height: number; zOff: number; color: number }[] = [
    { x: -0.26, radius: 0.14, height: 0.95, zOff: 0.45, color: outerHex },
    { x: -0.26, radius: 0.08, height: 0.56, zOff: 0.27, color: innerHex },
    { x: 0.26, radius: 0.14, height: 0.95, zOff: 0.45, color: outerHex },
    { x: 0.26, radius: 0.08, height: 0.56, zOff: 0.27, color: innerHex },
  ];

  const geos: THREE.BufferGeometry[] = [];
  let totalVerts = 0;
  let totalIndices = 0;

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const g = new THREE.ConeGeometry(s.radius, s.height, 5);
    g.rotateX(Math.PI / 2);
    g.translate(s.x, 0, s.zOff);
    geos.push(g);
    totalVerts += g.attributes.position.count;
    totalIndices += g.index!.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint16Array(totalIndices);
  const tmpColor = new THREE.Color();

  let vOff = 0;
  let iOff = 0;
  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    const posArr = g.attributes.position.array as Float32Array;
    const idxArr = g.index!.array;
    const vCount = g.attributes.position.count;

    positions.set(posArr, vOff * 3);
    tmpColor.setHex(specs[i].color);
    for (let v = 0; v < vCount; v++) {
      const ci = (vOff + v) * 3;
      colors[ci] = tmpColor.r;
      colors[ci + 1] = tmpColor.g;
      colors[ci + 2] = tmpColor.b;
    }

    for (let k = 0; k < idxArr.length; k++) {
      indices[iOff + k] = idxArr[k] + vOff;
    }

    vOff += vCount;
    iOff += idxArr.length;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

function buildDeliveryUpper(role: 'meituan' | 'eleme', includeArms: boolean): THREE.BufferGeometry {
  const isMeituan = role === 'meituan';
  const jacketHex = isMeituan ? 0xffc300 : 0x0091ff;
  const stripeHex = isMeituan ? 0x181920 : 0xffffff;
  const parts: BoxSpec[] = [
    { w: 0.48, h: 0.58, d: 0.32, x: 0, y: 0.28, z: -0.05, rx: -0.42, color: jacketHex },
    { w: 0.16, h: 0.5, d: 0.05, x: 0, y: 0.28, z: 0.11, rx: -0.42, color: stripeHex },
    { w: 0.36, h: 0.36, d: 0.38, x: 0, y: 0.7, z: -0.22, color: jacketHex },
  ];
  if (isMeituan) {
    parts.push(
      { w: 0.08, h: 0.24, d: 0.08, x: -0.12, y: 1.0, z: -0.2, rz: 0.24, color: 0xffc300 },
      { w: 0.08, h: 0.24, d: 0.08, x: 0.12, y: 1.0, z: -0.2, rz: -0.24, color: 0xffc300 }
    );
  } else {
    parts.push(
      { w: 0.24, h: 0.12, d: 0.07, x: -0.24, y: 0.82, z: -0.18, rz: 0.32, color: 0xffffff },
      { w: 0.24, h: 0.12, d: 0.07, x: 0.24, y: 0.82, z: -0.18, rz: -0.32, color: 0xffffff }
    );
  }
  if (includeArms) {
    parts.push(
      { w: 0.15, h: 0.46, d: 0.15, x: -0.29, y: 0.3, z: -0.26, rx: 0.92, color: jacketHex },
      { w: 0.15, h: 0.46, d: 0.15, x: 0.29, y: 0.3, z: -0.26, rx: 0.92, color: jacketHex }
    );
  }
  return mergeColoredBoxes(parts);
}

// Shared static geometries (allocated once, reused by all players & bots)
let _sharedGeos: {
  wheel: THREE.CylinderGeometry;
  frontFork: THREE.BufferGeometry;
  light: THREE.BoxGeometry;
  dualFlamesNormal: THREE.BufferGeometry;
  dualFlamesRage: THREE.BufferGeometry;
  arm: THREE.BoxGeometry;
  leg: THREE.BoxGeometry;
  bat: THREE.BufferGeometry;
  chain: THREE.BufferGeometry;
  visor: THREE.BoxGeometry;
  deliveryBox: THREE.BoxGeometry;
  meituanUpperWithArms: THREE.BufferGeometry;
  meituanUpperNoArms: THREE.BufferGeometry;
  elemeUpperWithArms: THREE.BufferGeometry;
  elemeUpperNoArms: THREE.BufferGeometry;
  auraRing: THREE.RingGeometry;
  shadow: THREE.PlaneGeometry;
} | null = null;

function getSharedGeos() {
  if (_sharedGeos) return _sharedGeos;

  const wheel = new THREE.CylinderGeometry(0.35, 0.35, 0.24, 12);
  wheel.rotateZ(Math.PI / 2);

  const frontFork = mergeColoredBoxes([
    { w: 0.08, h: 0.66, d: 0.1, x: -0.18, y: 0.34, z: 0.06, rx: 0.28, color: 0x8f9bb3 },
    { w: 0.08, h: 0.66, d: 0.1, x: 0.18, y: 0.34, z: 0.06, rx: 0.28, color: 0x8f9bb3 },
    { w: 0.76, h: 0.08, d: 0.08, x: 0, y: 0.68, z: 0.16, color: 0x1a1c26 },
  ]);

  const bat = mergeColoredBoxes([
    { w: 0.07, h: 0.36, d: 0.07, x: 0, y: -0.15, z: 0, color: 0x1a1c26 },
    { w: 0.13, h: 0.54, d: 0.13, x: 0, y: -0.58, z: 0, color: 0xd4a373 },
    { w: 0.18, h: 0.08, d: 0.18, x: 0, y: -0.74, z: 0, color: 0x8f9bb3 },
  ]);

  const chainParts: BoxSpec[] = [];
  for (let i = 0; i < 7; i++) {
    chainParts.push({
      w: 0.1,
      h: 0.14,
      d: 0.1,
      x: 0,
      y: -0.14 * (i + 1),
      z: 0,
      ry: (i % 2) * (Math.PI / 2),
      color: 0xd8e2ec,
    });
  }
  chainParts.push({ w: 0.18, h: 0.18, d: 0.18, x: 0, y: -1.1, z: 0, color: 0x8f9bb3 });
  const chain = mergeColoredBoxes(chainParts);

  const shadow = new THREE.PlaneGeometry(1.15, 2.35);
  shadow.rotateX(-Math.PI / 2);

  const auraRing = new THREE.RingGeometry(0.95, 1.35, 16);
  auraRing.rotateX(-Math.PI / 2);

  _sharedGeos = {
    wheel,
    frontFork,
    light: new THREE.BoxGeometry(0.28, 0.12, 0.08),
    dualFlamesNormal: buildDualFlameGeometry(0x00e5ff, 0xffbe0b),
    dualFlamesRage: buildDualFlameGeometry(0xff2a54, 0xffbe0b),
    arm: new THREE.BoxGeometry(0.15, 0.46, 0.15),
    leg: new THREE.BoxGeometry(0.18, 0.52, 0.2),
    bat,
    chain,
    visor: new THREE.BoxGeometry(0.34, 0.14, 0.12),
    deliveryBox: new THREE.BoxGeometry(0.56, 0.56, 0.56),
    meituanUpperWithArms: buildDeliveryUpper('meituan', true),
    meituanUpperNoArms: buildDeliveryUpper('meituan', false),
    elemeUpperWithArms: buildDeliveryUpper('eleme', true),
    elemeUpperNoArms: buildDeliveryUpper('eleme', false),
    auraRing,
    shadow,
  };
  return _sharedGeos;
}

// Cached merged bike bodies (11 static parts including idle taillight -> 1 single draw call!)
const _bikeBodyGeoCache = new Map<string, THREE.BufferGeometry>();
function getMergedBikeBodyGeo(
  primaryHex: number,
  secondaryHex: number,
  accentHex: number,
  visorHex: number
): THREE.BufferGeometry {
  const key = `${primaryHex}|${secondaryHex}|${accentHex}|${visorHex}`;
  const cached = _bikeBodyGeoCache.get(key);
  if (cached) return cached;

  const geo = mergeColoredBoxes([
    { w: 0.46, h: 0.42, d: 1.38, x: 0, y: 0.56, z: 0.04, color: secondaryHex }, // chassis
    { w: 0.48, h: 0.26, d: 0.62, x: 0, y: 0.84, z: -0.18, color: primaryHex }, // tank
    { w: 0.44, h: 0.36, d: 0.52, x: 0, y: 0.8, z: -0.68, rx: 0.16, color: primaryHex }, // nose
    { w: 0.14, h: 0.38, d: 0.54, x: 0, y: 0.81, z: -0.68, rx: 0.16, color: accentHex }, // racing stripe
    { w: 0.38, h: 0.24, d: 0.18, x: 0, y: 1.04, z: -0.66, rx: -0.55, color: visorHex }, // windshield
    { w: 0.38, h: 0.14, d: 0.62, x: 0, y: 0.78, z: 0.34, color: 0x1a1c26 }, // seat
    { w: 0.36, h: 0.22, d: 0.48, x: 0, y: 0.82, z: 0.78, rx: -0.18, color: primaryHex }, // tail
    { w: 0.12, h: 0.12, d: 0.72, x: -0.26, y: 0.44, z: 0.76, rx: 0.14, color: 0x8f9bb3 }, // left exhaust
    { w: 0.12, h: 0.12, d: 0.72, x: 0.26, y: 0.44, z: 0.76, rx: 0.14, color: 0x8f9bb3 }, // right exhaust
    { w: 0.28, h: 0.12, d: 0.08, x: 0, y: 0.82, z: -0.94, color: 0xfff8c5 }, // headlight
    { w: 0.28, h: 0.12, d: 0.08, x: 0, y: 0.84, z: 1.02, color: 0xc22038 }, // idle taillight
  ]);
  _bikeBodyGeoCache.set(key, geo);
  return geo;
}

// Cached merged idle legs (2 leg meshes -> 1 draw call when not kicking!)
const _idleLegsGeoCache = new Map<number, THREE.BufferGeometry>();
function getMergedIdleLegsGeo(pantsHex: number): THREE.BufferGeometry {
  const cached = _idleLegsGeoCache.get(pantsHex);
  if (cached) return cached;
  const geo = mergeColoredBoxes([
    { w: 0.18, h: 0.52, d: 0.2, x: -0.26, y: -0.18, z: -0.06, rx: 0.45, color: pantsHex },
    { w: 0.18, h: 0.52, d: 0.2, x: 0.26, y: -0.18, z: -0.06, rx: 0.45, color: pantsHex },
  ]);
  _idleLegsGeoCache.set(pantsHex, geo);
  return geo;
}

// Shared pooled Lambert materials for articulated arms/legs during combat swings (0 per-bike material allocation!)
const _lambertMatCache = new Map<number, THREE.MeshLambertMaterial>();
function getCachedLambertMat(hex: number): THREE.MeshLambertMaterial {
  let mat = _lambertMatCache.get(hex);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    _lambertMatCache.set(hex, mat);
  }
  return mat;
}

let _sharedWheelMat: THREE.MeshLambertMaterial | null = null;
function getSharedWheelMat(): THREE.MeshLambertMaterial {
  if (!_sharedWheelMat) {
    _sharedWheelMat = new THREE.MeshLambertMaterial({
      map: getPixelAtlas().wheel,
      flatShading: true,
    });
  }
  return _sharedWheelMat;
}

let _meituanBoxMat: THREE.MeshLambertMaterial | null = null;
let _elemeBoxMat: THREE.MeshLambertMaterial | null = null;
function getDeliveryBoxMat(role: 'meituan' | 'eleme'): THREE.MeshLambertMaterial {
  const atlas = getChinaAtlas();
  if (role === 'meituan') {
    if (!_meituanBoxMat) {
      _meituanBoxMat = new THREE.MeshLambertMaterial({ map: atlas.meituanBox, flatShading: true });
    }
    return _meituanBoxMat;
  }
  if (!_elemeBoxMat) {
    _elemeBoxMat = new THREE.MeshLambertMaterial({ map: atlas.elemeBox, flatShading: true });
  }
  return _elemeBoxMat;
}

const _shadowMat = new THREE.MeshBasicMaterial({
  color: 0x090b14,
  transparent: true,
  opacity: 0.48,
  depthWrite: false,
});
const _brakeOnMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d });
const _flameMat = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.9,
});
const _meituanVisorMat = new THREE.MeshBasicMaterial({ color: MEITUAN_PALETTE.visor });
const _elemeVisorMat = new THREE.MeshBasicMaterial({ color: ELEME_PALETTE.visor });
const _rageVisorMatA = new THREE.MeshBasicMaterial({ color: 0xff1e42 });
const _rageVisorMatB = new THREE.MeshBasicMaterial({ color: 0xff9f1c });

export class BikeVisual {
  readonly root = new THREE.Group();
  private readonly bikePivot = new THREE.Group();
  private readonly frontForkGroup = new THREE.Group();
  private readonly frontWheel: THREE.Mesh;
  private readonly rearWheel: THREE.Mesh;
  private readonly bikeBodyMesh: THREE.Mesh;
  private readonly brakeGlowMesh: THREE.Mesh;
  private readonly nitroFlameMesh: THREE.Mesh;
  private readonly shadowMesh: THREE.Mesh;
  private readonly auraMesh: THREE.Mesh;
  private readonly auraMat: THREE.MeshBasicMaterial;
  private readonly deliveryBoxMesh: THREE.Mesh;

  // Articulated rider (single-draw-call upper body + single-draw-call idle legs when cruising!)
  private readonly riderGroup = new THREE.Group();
  private readonly torsoGroup = new THREE.Group();
  private readonly upperBodyMesh: THREE.Mesh;
  private upperWithArmsGeo: THREE.BufferGeometry;
  private upperNoArmsGeo: THREE.BufferGeometry;
  private readonly charFloatMesh: THREE.Mesh;
  private readonly deliveryVisorMesh: THREE.Mesh;
  private readonly idleLegsMesh: THREE.Mesh;
  private readonly leftArmPivot = new THREE.Group();
  private readonly rightArmPivot = new THREE.Group();
  private readonly leftLegPivot = new THREE.Group();
  private readonly rightLegPivot = new THREE.Group();
  private readonly armLMesh: THREE.Mesh;
  private readonly armRMesh: THREE.Mesh;
  private readonly legLMesh: THREE.Mesh;
  private readonly legRMesh: THREE.Mesh;
  private readonly leftBat: THREE.Mesh;
  private readonly rightBat: THREE.Mesh;
  private readonly leftChain: THREE.Mesh;
  private readonly rightChain: THREE.Mesh;

  // Nameplate sprite (allocated only when showNameplate is true)
  private readonly plateCanvas: HTMLCanvasElement | null = null;
  private readonly plateTex: THREE.CanvasTexture | null = null;
  private readonly plateSprite: THREE.Sprite | null = null;
  private lastPlateName = '';
  private lastPlateHp = -1;
  private lastPlateAvatar = -1;
  private lastPlateAvatarVer = -1;
  private lastPlateEnraged = false;
  private lastPlateLang: Lang | '' = '';
  private lastColorIdx = -1;
  private lastAvatarIdx = -1;
  private isBot = false;
  private deliveryRole: 'meituan' | 'eleme' | null = null;
  private hasFloatingMarks = false;
  private activeAccentColor = '#ffbe3b';
  private shadowEnabled = true;

  constructor(palette: BikePalette, showNameplate: boolean) {
    const geos = getSharedGeos();
    const vertexMat = getSharedVertexColorMat();
    const basicVertexMat = getSharedBasicVertexMat();
    const wheelMat = getSharedWheelMat();

    // Ground contact shadow
    this.shadowMesh = new THREE.Mesh(geos.shadow, _shadowMat);
    this.shadowMesh.position.y = 0.04;
    this.root.add(this.shadowMesh);

    // Powerup aura ring (magnet cyan / turbo shield gold / rage crimson)
    this.auraMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.auraMesh = new THREE.Mesh(geos.auraRing, this.auraMat);
    this.auraMesh.position.y = 0.12;
    this.auraMesh.visible = false;
    this.root.add(this.auraMesh);

    this.root.add(this.bikePivot);

    // Rear wheel
    this.rearWheel = new THREE.Mesh(geos.wheel, wheelMat);
    this.rearWheel.position.set(0, 0.35, 0.78);
    this.bikePivot.add(this.rearWheel);

    // Front steering assembly (wheel + merged fork/handlebar = 2 draw calls)
    this.frontForkGroup.position.set(0, 0.35, -0.78);
    this.bikePivot.add(this.frontForkGroup);

    this.frontWheel = new THREE.Mesh(geos.wheel, wheelMat);
    this.frontForkGroup.add(this.frontWheel);

    const frontForkMesh = new THREE.Mesh(geos.frontFork, vertexMat);
    this.frontForkGroup.add(frontForkMesh);

    // Merged static bike body (11 parts including idle taillight = 1 draw call!)
    const initBodyGeo = getMergedBikeBodyGeo(
      parseHexColor(palette.primary),
      parseHexColor(palette.secondary),
      parseHexColor(palette.accent),
      parseHexColor(palette.visor)
    );
    this.bikeBodyMesh = new THREE.Mesh(initBodyGeo, vertexMat);
    this.bikePivot.add(this.bikeBodyMesh);

    // Bright brake light overlay (0 draw calls unless actively braking!)
    this.brakeGlowMesh = new THREE.Mesh(geos.light, _brakeOnMat);
    this.brakeGlowMesh.position.set(0, 0.84, 1.03);
    this.brakeGlowMesh.visible = false;
    this.bikePivot.add(this.brakeGlowMesh);

    // Rear insulated delivery box (shown only for Meituan / Ele.me delivery riders)
    this.deliveryBoxMesh = new THREE.Mesh(geos.deliveryBox, getCachedLambertMat(0x1a1c26));
    this.deliveryBoxMesh.position.set(0, 1.18, 0.86);
    this.deliveryBoxMesh.visible = false;
    this.bikePivot.add(this.deliveryBoxMesh);

    // Merged dual nitro exhaust flames (4 cones -> 1 draw call!)
    this.nitroFlameMesh = new THREE.Mesh(geos.dualFlamesNormal, _flameMat);
    this.nitroFlameMesh.position.set(0, 0.48, 1.12);
    this.nitroFlameMesh.visible = false;
    this.bikePivot.add(this.nitroFlameMesh);

    // Articulated Rider
    this.riderGroup.position.set(0, 0.84, 0.26);
    this.bikePivot.add(this.riderGroup);

    this.torsoGroup.position.set(0, 0.1, 0);
    this.riderGroup.add(this.torsoGroup);

    // Single-draw-call merged rider upper body (torso + stripe + avatar head + backpack/hood/tail + idle arms!)
    const initChar = getAvatarCharacterModel(0);
    this.upperWithArmsGeo = initChar.upperWithArmsGeo;
    this.upperNoArmsGeo = initChar.upperNoArmsGeo;
    this.upperBodyMesh = new THREE.Mesh(this.upperWithArmsGeo, vertexMat);
    this.torsoGroup.add(this.upperBodyMesh);

    // Optional unlit floating badges (avatar 5 '???' & avatar 7 glowing alien antenna orbs)
    this.charFloatMesh = new THREE.Mesh(initChar.floatGeo ?? this.upperWithArmsGeo, basicVertexMat);
    this.charFloatMesh.position.set(0, 0.7, -0.22);
    this.charFloatMesh.visible = initChar.floatGeo !== null;
    this.torsoGroup.add(this.charFloatMesh);

    // Delivery rider glowing visor (shown only for Meituan / Ele.me delivery riders)
    this.deliveryVisorMesh = new THREE.Mesh(geos.visor, _meituanVisorMat);
    this.deliveryVisorMesh.position.set(0, 0.72, -0.39);
    this.deliveryVisorMesh.visible = false;
    this.torsoGroup.add(this.deliveryVisorMesh);

    // Articulated arm pivots (arms hidden unless swinging, while weapons stay attached to pivots!)
    const initArmMat = getCachedLambertMat(parseHexColor(palette.jacket));
    this.leftArmPivot.position.set(-0.29, 0.48, -0.14);
    this.torsoGroup.add(this.leftArmPivot);
    this.armLMesh = new THREE.Mesh(geos.arm, initArmMat);
    this.armLMesh.position.set(0, -0.18, -0.12);
    this.armLMesh.rotation.x = 0.92;
    this.armLMesh.visible = false;
    this.leftArmPivot.add(this.armLMesh);

    this.rightArmPivot.position.set(0.29, 0.48, -0.14);
    this.torsoGroup.add(this.rightArmPivot);
    this.armRMesh = new THREE.Mesh(geos.arm, initArmMat);
    this.armRMesh.position.set(0, -0.18, -0.12);
    this.armRMesh.rotation.x = 0.92;
    this.armRMesh.visible = false;
    this.rightArmPivot.add(this.armRMesh);

    this.leftBat = new THREE.Mesh(geos.bat, vertexMat);
    this.leftBat.position.set(-0.04, -0.32, -0.32);
    this.leftBat.rotation.x = -Math.PI * 0.42;
    this.leftBat.visible = false;
    this.leftArmPivot.add(this.leftBat);

    this.rightBat = new THREE.Mesh(geos.bat, vertexMat);
    this.rightBat.position.set(0.04, -0.32, -0.32);
    this.rightBat.rotation.x = -Math.PI * 0.42;
    this.rightBat.visible = false;
    this.rightArmPivot.add(this.rightBat);

    this.leftChain = new THREE.Mesh(geos.chain, vertexMat);
    this.leftChain.position.set(-0.04, -0.32, -0.32);
    this.leftChain.rotation.x = -Math.PI * 0.45;
    this.leftChain.visible = false;
    this.leftArmPivot.add(this.leftChain);

    this.rightChain = new THREE.Mesh(geos.chain, vertexMat);
    this.rightChain.position.set(0.04, -0.32, -0.32);
    this.rightChain.rotation.x = -Math.PI * 0.45;
    this.rightChain.visible = false;
    this.rightArmPivot.add(this.rightChain);

    // Single-draw-call merged idle legs + articulated kick legs (only shown during fist/kick attack!)
    const initLegMat = getCachedLambertMat(0x1a1c26);
    this.idleLegsMesh = new THREE.Mesh(getMergedIdleLegsGeo(0x1a1c26), vertexMat);
    this.riderGroup.add(this.idleLegsMesh);

    this.leftLegPivot.position.set(-0.22, 0.04, 0.02);
    this.riderGroup.add(this.leftLegPivot);
    this.legLMesh = new THREE.Mesh(geos.leg, initLegMat);
    this.legLMesh.position.set(-0.04, -0.22, -0.08);
    this.legLMesh.rotation.x = 0.45;
    this.legLMesh.visible = false;
    this.leftLegPivot.add(this.legLMesh);

    this.rightLegPivot.position.set(0.22, 0.04, 0.02);
    this.riderGroup.add(this.rightLegPivot);
    this.legRMesh = new THREE.Mesh(geos.leg, initLegMat);
    this.legRMesh.position.set(0.04, -0.22, -0.08);
    this.legRMesh.rotation.x = 0.45;
    this.legRMesh.visible = false;
    this.rightLegPivot.add(this.legRMesh);

    // Floating crisp pixel nameplate sprite (192x48; skipped for local player)
    if (showNameplate) {
      this.plateCanvas = document.createElement('canvas');
      this.plateCanvas.width = 192;
      this.plateCanvas.height = 48;
      this.plateTex = new THREE.CanvasTexture(this.plateCanvas);
      this.plateTex.magFilter = THREE.NearestFilter;
      this.plateTex.minFilter = THREE.NearestFilter;
      this.plateTex.generateMipmaps = false;
      this.plateTex.colorSpace = THREE.SRGBColorSpace;

      const plateMat = new THREE.SpriteMaterial({
        map: this.plateTex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      this.plateSprite = new THREE.Sprite(plateMat);
      this.plateSprite.position.set(0, 2.48, 0.1);
      this.plateSprite.scale.set(2.8, 0.7, 1);
      this.root.add(this.plateSprite);
    }
  }

  setDistanceLod(absDs: number): void {
    const showShadow = absDs < 92;
    if (showShadow !== this.shadowEnabled) {
      this.shadowEnabled = showShadow;
      this.shadowMesh.visible = showShadow;
    }
  }

  setPalette(
    colorIdx: number,
    isBot: boolean,
    deliveryRole: 'meituan' | 'eleme' | null = null,
    avatarIdx = 0
  ): void {
    if (
      this.lastColorIdx === colorIdx &&
      this.isBot === isBot &&
      this.deliveryRole === deliveryRole &&
      this.lastAvatarIdx === avatarIdx
    ) {
      return;
    }
    this.lastColorIdx = colorIdx;
    this.isBot = isBot;
    this.deliveryRole = deliveryRole;
    this.lastAvatarIdx = avatarIdx;

    const geos = getSharedGeos();

    if (deliveryRole === 'meituan' || deliveryRole === 'eleme') {
      const p = deliveryRole === 'meituan' ? MEITUAN_PALETTE : ELEME_PALETTE;
      const primaryHex = parseHexColor(p.primary);
      const secondaryHex = parseHexColor(p.secondary);
      const accentHex = parseHexColor(p.accent);
      const visorHex = parseHexColor(p.visor);
      const jacketHex = parseHexColor(p.jacket);

      this.bikeBodyMesh.geometry = getMergedBikeBodyGeo(primaryHex, secondaryHex, accentHex, visorHex);
      this.upperWithArmsGeo =
        deliveryRole === 'meituan' ? geos.meituanUpperWithArms : geos.elemeUpperWithArms;
      this.upperNoArmsGeo =
        deliveryRole === 'meituan' ? geos.meituanUpperNoArms : geos.elemeUpperNoArms;
      this.upperBodyMesh.geometry = this.upperWithArmsGeo;

      const armMat = getCachedLambertMat(jacketHex);
      this.armLMesh.material = armMat;
      this.armRMesh.material = armMat;

      this.idleLegsMesh.geometry = getMergedIdleLegsGeo(0x1a1c26);
      const legMat = getCachedLambertMat(0x1a1c26);
      this.legLMesh.material = legMat;
      this.legRMesh.material = legMat;

      this.charFloatMesh.visible = false;
      this.hasFloatingMarks = false;

      this.deliveryVisorMesh.material = deliveryRole === 'meituan' ? _meituanVisorMat : _elemeVisorMat;
      this.deliveryVisorMesh.visible = true;
      this.deliveryBoxMesh.material = getDeliveryBoxMat(deliveryRole);
      this.deliveryBoxMesh.visible = true;
      this.activeAccentColor = p.primary;
    } else {
      // Avatar-matched 3D character appearance (local player, remote peers & regular AI bots!)
      const charModel = getAvatarCharacterModel(avatarIdx);
      const outfit = charModel.outfit;
      const fallbackPal = isBot
        ? BOT_PALETTE
        : BIKE_PALETTES[Math.abs(colorIdx) % BIKE_PALETTES.length];

      const primaryHex = parseHexColor(outfit.bikePrimary);
      const secondaryHex = parseHexColor(fallbackPal.secondary);
      const accentHex = parseHexColor(outfit.bikeAccent);
      const visorHex = parseHexColor(outfit.visor);
      const jacketHex = parseHexColor(outfit.jacket);
      const pantsHex = parseHexColor(outfit.pants);

      this.bikeBodyMesh.geometry = getMergedBikeBodyGeo(primaryHex, secondaryHex, accentHex, visorHex);
      this.upperWithArmsGeo = charModel.upperWithArmsGeo;
      this.upperNoArmsGeo = charModel.upperNoArmsGeo;
      this.upperBodyMesh.geometry = this.upperWithArmsGeo;

      const armMat = getCachedLambertMat(jacketHex);
      this.armLMesh.material = armMat;
      this.armRMesh.material = armMat;

      this.idleLegsMesh.geometry = getMergedIdleLegsGeo(pantsHex);
      const legMat = getCachedLambertMat(pantsHex);
      this.legLMesh.material = legMat;
      this.legRMesh.material = legMat;

      if (charModel.floatGeo) {
        this.charFloatMesh.geometry = charModel.floatGeo;
        this.charFloatMesh.visible = true;
        this.charFloatMesh.position.y = 0.7;
      } else {
        this.charFloatMesh.visible = false;
      }
      this.hasFloatingMarks = Boolean(outfit.hasFloatingMarks);

      this.deliveryVisorMesh.visible = false;
      this.deliveryBoxMesh.visible = false;
      this.activeAccentColor = outfit.bikePrimary;
    }

    // Force nameplate refresh
    this.lastPlateHp = -1;
  }

  updateVisuals(state: RiderRenderState, timeSec: number): void {
    const role = state.deliveryRole ?? null;
    this.setPalette(state.colorIdx, state.isBot, role, state.avatarIdx);
    const enraged = Boolean(state.enraged);

    // Enraged glowing red/amber visor flash for delivery riders
    if (this.deliveryVisorMesh.visible) {
      if (enraged) {
        this.deliveryVisorMesh.material =
          Math.floor(timeSec * 12) % 2 === 0 ? _rageVisorMatA : _rageVisorMatB;
      } else {
        this.deliveryVisorMesh.material = role === 'meituan' ? _meituanVisorMat : _elemeVisorMat;
      }
    }

    // Subtle floating bob for avatar 5 ('WHAT?' pixel question marks)
    if (this.hasFloatingMarks && this.charFloatMesh.visible) {
      this.charFloatMesh.position.y = 0.7 + Math.sin(timeSec * 5.2) * 0.055;
    }

    // Invulnerability blink after crash recovery
    if (state.invulnTimer > 0) {
      this.bikePivot.visible = Math.floor(timeSec * 16) % 2 === 0;
    } else {
      this.bikePivot.visible = true;
    }

    // Shadow flattens & shrinks with air height
    if (this.shadowEnabled) {
      const airY = state.freeRoam ? 0 : state.y;
      const airScale = Math.max(0.45, 1.0 - airY * 0.12);
      this.shadowMesh.scale.set(airScale, 1, airScale);
      this.shadowMesh.position.y = Math.max(0.03, 0.04 - airY);
    }

    // Wheels spin forward
    this.frontWheel.rotation.x = -state.wheelAngle;
    this.rearWheel.rotation.x = -state.wheelAngle;

    // Front steering matches lean gently
    this.frontForkGroup.rotation.y = state.onFoot ? 0.34 : -state.lean * 0.35;

    // Brake light glow mesh only draws when actively braking
    this.brakeGlowMesh.visible = !state.onFoot && state.braking;

    // Powerup & enraged aura ring (rage crimson > turbo gold > magnet cyan)
    if (!state.onFoot && !state.crashed && (enraged || state.turboShieldTimer > 0 || state.magnetTimer > 0)) {
      this.auraMesh.visible = true;
      const isTurbo = state.turboShieldTimer > 0;
      this.auraMat.color.setHex(enraged ? 0xff2a54 : isTurbo ? 0xffd166 : 0x00f5d4);
      const pulse = 1.0 + 0.16 * Math.sin(timeSec * (enraged ? 28 : isTurbo ? 24 : 16));
      this.auraMesh.scale.set(pulse, 1, pulse);
      this.auraMesh.rotation.y = timeSec * (enraged ? 10 : isTurbo ? 8 : 5);
      this.auraMesh.position.y = 0.12 + (state.freeRoam ? 0 : state.y);
    } else {
      this.auraMesh.visible = false;
    }

    // Dual nitro / enraged exhaust flames (single merged mesh!)
    const showFlames = !state.onFoot && (enraged || state.nitroActive || state.turboShieldTimer > 0) && !state.crashed;
    this.nitroFlameMesh.visible = showFlames;
    if (showFlames) {
      const geos = getSharedGeos();
      const targetGeo = enraged ? geos.dualFlamesRage : geos.dualFlamesNormal;
      if (this.nitroFlameMesh.geometry !== targetGeo) {
        this.nitroFlameMesh.geometry = targetGeo;
      }
      const flicker =
        (enraged || state.turboShieldTimer > 0 ? 1.38 : 0.8) + 0.45 * Math.sin(timeSec * 48);
      this.nitroFlameMesh.scale.set(1, 1, flicker);
    }

    if (state.onFoot) {
      // Parked empty motorcycle resting gently on kickstand!
      this.riderGroup.visible = false;
      this.bikePivot.position.set(0, 0, 0);
      this.bikePivot.rotation.set(0, 0, -0.18);
    } else if (state.crashed) {
      this.riderGroup.visible = true;
      const t = Math.min(1, state.crashTimer / 1.5);
      this.bikePivot.position.y = Math.max(0, Math.sin(t * Math.PI * 2.2) * (1 - t) * 1.1);
      this.bikePivot.rotation.z =
        Math.PI * 0.46 * (state.vx >= 0 ? -1 : 1) + Math.sin(t * 14) * 0.35 * (1 - t);
      this.bikePivot.rotation.y = t * Math.PI * 1.6 * (state.vx >= 0 ? 1 : -1);
      this.bikePivot.rotation.x = Math.sin(t * 9) * 0.25;
      this.riderGroup.position.set(
        (state.vx >= 0 ? 0.6 : -0.6) * t,
        0.55 + Math.sin(t * Math.PI) * 0.8,
        0.26 + t * 0.7
      );
      this.riderGroup.rotation.set(-t * 1.8, 0, t * 2.4);
    } else {
      this.riderGroup.visible = true;
      this.bikePivot.position.set(0, state.freeRoam ? 0 : state.y, 0);
      this.bikePivot.rotation.y =
        state.spinOutTimer > 0 ? state.spinOutTimer * Math.PI * 3.8 : 0;
      this.bikePivot.rotation.z = -state.lean;
      const wheeliePitch = Math.max(state.wheelie * 0.42, state.wheelieCharge * 0.92);
      this.bikePivot.rotation.x = wheeliePitch;

      const speedTuck = Math.min(1, Math.abs(state.speed) / 58);
      this.riderGroup.position.set(state.lean * 0.24, 0.84 - speedTuck * 0.06, 0.26);
      this.riderGroup.rotation.set(0, 0, -state.lean * 0.25);
      this.torsoGroup.rotation.x = -speedTuck * 0.22;

      this.updateCombatLimbs(state.weapon, state.attackSide, state.attackPhase);
    }

    // Update nameplate sprite only when name, rounded HP, avatar, rage, or UI language changes
    if (this.plateSprite && this.plateCanvas && this.plateTex) {
      const hpBucket = Math.round(state.hp / 4) * 4;
      const avatarVer = getAvatarVersion(state.id);
      const lang = getLang();
      if (
        state.name !== this.lastPlateName ||
        hpBucket !== this.lastPlateHp ||
        state.avatarIdx !== this.lastPlateAvatar ||
        avatarVer !== this.lastPlateAvatarVer ||
        enraged !== this.lastPlateEnraged ||
        lang !== this.lastPlateLang
      ) {
        this.lastPlateName = state.name;
        this.lastPlateHp = hpBucket;
        this.lastPlateAvatar = state.avatarIdx;
        this.lastPlateAvatarVer = avatarVer;
        this.lastPlateEnraged = enraged;
        this.lastPlateLang = lang;
        drawNameplateCanvas(
          this.plateCanvas,
          state.name,
          state.hp,
          this.activeAccentColor,
          state.isBot,
          state.avatarIdx,
          state.id,
          enraged
        );
        this.plateTex.needsUpdate = true;
      }
      this.plateSprite.position.y = 2.48 + state.y;
    }
  }

  private updateCombatLimbs(weapon: WeaponType, attackSide: 0 | 1 | 2, phase: number): void {
    this.leftArmPivot.rotation.set(0, 0, 0);
    this.rightArmPivot.rotation.set(0, 0, 0);
    this.leftLegPivot.rotation.set(0, 0, 0);
    this.rightLegPivot.rotation.set(0, 0, 0);

    const showBat = weapon === 1;
    const showChain = weapon === 2;
    this.leftBat.visible = showBat && attackSide === 1;
    this.rightBat.visible = showBat && attackSide !== 1;
    this.leftChain.visible = showChain && attackSide === 1;
    this.rightChain.visible = showChain && attackSide !== 1;

    const isSwinging = attackSide !== 0 && phase > 0;
    const isKicking = isSwinging && weapon === 0;

    // Fast path: 1 draw call for entire upper body (with baked idle arms) + 1 draw call for merged idle legs!
    const targetUpper = isSwinging ? this.upperNoArmsGeo : this.upperWithArmsGeo;
    if (this.upperBodyMesh.geometry !== targetUpper) {
      this.upperBodyMesh.geometry = targetUpper;
    }
    this.armLMesh.visible = isSwinging;
    this.armRMesh.visible = isSwinging;

    this.idleLegsMesh.visible = !isKicking;
    this.legLMesh.visible = isKicking;
    this.legRMesh.visible = isKicking;

    if (!isSwinging) return;

    const swing =
      phase < 0.25
        ? -phase * 4.0 * 0.6
        : phase < 0.65
          ? -0.6 + ((phase - 0.25) / 0.4) * 2.2
          : 1.6 * (1 - (phase - 0.65) / 0.35);

    if (attackSide === 1) {
      if (weapon === 0) {
        this.leftLegPivot.rotation.z = -Math.max(0, swing) * 0.85;
        this.leftArmPivot.rotation.z = -swing * 1.15;
        this.leftArmPivot.rotation.y = swing * 0.55;
      } else {
        this.leftArmPivot.rotation.z = -1.25 - swing * 0.55;
        this.leftArmPivot.rotation.x = -0.35 + swing * 0.9;
        this.leftArmPivot.rotation.y = swing * 0.7;
      }
    } else if (attackSide === 2) {
      if (weapon === 0) {
        this.rightLegPivot.rotation.z = Math.max(0, swing) * 0.85;
        this.rightArmPivot.rotation.z = swing * 1.15;
        this.rightArmPivot.rotation.y = -swing * 0.55;
      } else {
        this.rightArmPivot.rotation.z = 1.25 + swing * 0.55;
        this.rightArmPivot.rotation.x = -0.35 + swing * 0.9;
        this.rightArmPivot.rotation.y = -swing * 0.7;
      }
    }
  }

  dispose(): void {
    // Only dispose per-instance resources — shared cached geometries & materials stay alive for other bikes!
    this.auraMat.dispose();
    if (this.plateTex) {
      this.plateTex.dispose();
    }
    if (this.plateSprite) {
      (this.plateSprite.material as THREE.SpriteMaterial).dispose();
    }
  }
}
