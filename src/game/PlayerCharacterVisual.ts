import * as THREE from 'three';
import { getLang, type Lang } from '../i18n';
import { getAvatarCharacterModel, getSharedBasicVertexMat, getSharedVertexColorMat } from './AvatarModels';
import {
  buildCustomAvatarCharacterModel,
  CustomAvatarSkin,
  getCustomSkinKey,
  getCustomSkinVersion,
} from './CustomAvatarSystem';
import { getAvatarVersion } from './PixelAvatars';
import { drawNameplateCanvas } from './PixelTextures';
import { BLOCK_SPEC_BY_ID, BlockType } from './VoxelWorld';

function parseHex(hex: string): number {
  return Number.parseInt(hex.startsWith('#') ? hex.slice(1) : hex, 16) || 0xffffff;
}

function darkenHex(hex: number, factor = 0.62): number {
  const r = Math.max(0, Math.round(((hex >> 16) & 0xff) * factor));
  const g = Math.max(0, Math.round(((hex >> 8) & 0xff) * factor));
  const b = Math.max(0, Math.round((hex & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

// Shared static geometries & shadow material pooled across local & remote walking players
let _sharedCharGeos: {
  shadow: THREE.PlaneGeometry;
  arm: THREE.BoxGeometry;
  leg: THREE.BoxGeometry;
  boot: THREE.BoxGeometry;
  heldBlock: THREE.BoxGeometry;
  fpArm: THREE.BoxGeometry;
  fpBlock: THREE.BoxGeometry;
} | null = null;

const _sharedCharShadowMat = new THREE.MeshBasicMaterial({
  color: 0x090b14,
  transparent: true,
  opacity: 0.44,
  depthWrite: false,
});

function getSharedCharGeos() {
  if (_sharedCharGeos) return _sharedCharGeos;
  const shadow = new THREE.PlaneGeometry(0.82, 0.82);
  shadow.rotateX(-Math.PI / 2);
  const arm = new THREE.BoxGeometry(0.16, 0.56, 0.16);
  arm.translate(0, -0.24, 0);
  const leg = new THREE.BoxGeometry(0.2, 0.52, 0.2);
  leg.translate(0, -0.26, 0);
  const boot = new THREE.BoxGeometry(0.22, 0.18, 0.24);
  boot.translate(0, -0.59, -0.02);
  _sharedCharGeos = {
    shadow,
    arm,
    leg,
    boot,
    heldBlock: new THREE.BoxGeometry(0.28, 0.28, 0.28),
    fpArm: new THREE.BoxGeometry(0.16, 0.16, 0.48),
    fpBlock: new THREE.BoxGeometry(0.24, 0.24, 0.24),
  };
  return _sharedCharGeos;
}

/**
 * Articulated 3D voxel walking character for On-Foot Open World exploration & building.
 * Reuses the player's exact 3D avatar head/outfit from AvatarModels!
 */
export class PlayerCharacterVisual {
  readonly root = new THREE.Group();
  readonly fpHandGroup = new THREE.Group();

  private readonly bodyPivot = new THREE.Group();
  private readonly upperMesh: THREE.Mesh;
  private readonly floatMesh: THREE.Mesh;
  private readonly leftArmPivot = new THREE.Group();
  private readonly rightArmPivot = new THREE.Group();
  private readonly leftLegPivot = new THREE.Group();
  private readonly rightLegPivot = new THREE.Group();
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly armMat: THREE.MeshLambertMaterial;
  private readonly legMat: THREE.MeshLambertMaterial;
  private readonly bootMat: THREE.MeshLambertMaterial;
  private readonly heldBlockMesh: THREE.Mesh;
  private readonly heldBlockMat: THREE.MeshLambertMaterial;

  // First-person held block & forearm attached to camera
  private readonly fpBlockMesh: THREE.Mesh;
  private readonly fpBlockMat: THREE.MeshLambertMaterial;
  private readonly fpArmMesh: THREE.Mesh;
  private readonly fpArmMat: THREE.MeshLambertMaterial;

  // Optional floating nameplate sprite (lazily allocated for remote walking players)
  private plateCanvas: HTMLCanvasElement | null = null;
  private plateTex: THREE.CanvasTexture | null = null;
  private plateSprite: THREE.Sprite | null = null;
  private lastPlateName = '';
  private lastPlatePeerId = '';
  private lastPlateHp = -1;
  private lastPlateAvatar = -1;
  private lastPlateAvatarVer = -1;
  private lastPlateSkinVer = -1;
  private lastPlateAccent = '';
  private lastPlateLang: Lang | '' = '';

  private lastAvatarIdx = -1;
  private lastCustomSkinKey = '';
  private lastBlock: BlockType = 3;
  private hasFloatingMarks = false;
  private activeAccentColor = '#38e2d4';

  constructor() {
    const vMat = getSharedVertexColorMat();
    const bMat = getSharedBasicVertexMat();
    const geos = getSharedCharGeos();

    const shadow = new THREE.Mesh(geos.shadow, _sharedCharShadowMat);
    shadow.position.y = 0.04;
    this.root.add(shadow);

    this.root.add(this.bodyPivot);

    const initChar = getAvatarCharacterModel(0);
    // Upright standing torso + avatar head (offset up from hip at y = 0.72)
    this.upperMesh = new THREE.Mesh(initChar.upperNoArmsGeo, vMat);
    this.upperMesh.position.set(0, 0.74, 0.14);
    this.upperMesh.rotation.x = 0.32; // counteract riding crouch so character stands upright!
    this.bodyPivot.add(this.upperMesh);

    this.floatMesh = new THREE.Mesh(initChar.floatGeo ?? initChar.upperNoArmsGeo, bMat);
    this.floatMesh.position.set(0, 1.46, 0.04);
    this.floatMesh.visible = initChar.floatGeo !== null;
    this.bodyPivot.add(this.floatMesh);

    this.armMat = new THREE.MeshLambertMaterial({ color: 0x232838, flatShading: true });
    this.legMat = new THREE.MeshLambertMaterial({ color: 0x1a2030, flatShading: true });
    this.bootMat = new THREE.MeshLambertMaterial({ color: 0x111520, flatShading: true });

    this.leftArmPivot.position.set(-0.32, 1.24, 0);
    this.armL = new THREE.Mesh(geos.arm, this.armMat);
    this.leftArmPivot.add(this.armL);
    this.bodyPivot.add(this.leftArmPivot);

    this.rightArmPivot.position.set(0.32, 1.24, 0);
    this.armR = new THREE.Mesh(geos.arm, this.armMat);
    this.rightArmPivot.add(this.armR);
    this.bodyPivot.add(this.rightArmPivot);

    this.heldBlockMat = new THREE.MeshLambertMaterial({ color: BLOCK_SPEC_BY_ID[3].particleHex });
    this.heldBlockMesh = new THREE.Mesh(geos.heldBlock, this.heldBlockMat);
    this.heldBlockMesh.position.set(0.02, -0.48, -0.18);
    this.rightArmPivot.add(this.heldBlockMesh);

    this.leftLegPivot.position.set(-0.14, 0.68, 0);
    this.legL = new THREE.Mesh(geos.leg, this.legMat);
    this.leftLegPivot.add(this.legL);
    this.leftLegPivot.add(new THREE.Mesh(geos.boot, this.bootMat));
    this.bodyPivot.add(this.leftLegPivot);

    this.rightLegPivot.position.set(0.14, 0.68, 0);
    this.legR = new THREE.Mesh(geos.leg, this.legMat);
    this.rightLegPivot.add(this.legR);
    this.rightLegPivot.add(new THREE.Mesh(geos.boot, this.bootMat));
    this.bodyPivot.add(this.rightLegPivot);

    // First-person held block viewmodel (bottom-right of camera)
    this.fpArmMat = new THREE.MeshLambertMaterial({ color: 0x232838, flatShading: true });
    this.fpArmMesh = new THREE.Mesh(geos.fpArm, this.fpArmMat);
    this.fpArmMesh.position.set(0.42, -0.38, -0.52);
    this.fpArmMesh.rotation.set(0.18, -0.25, 0.1);
    this.fpHandGroup.add(this.fpArmMesh);

    this.fpBlockMat = new THREE.MeshLambertMaterial({ color: BLOCK_SPEC_BY_ID[3].particleHex });
    this.fpBlockMesh = new THREE.Mesh(geos.fpBlock, this.fpBlockMat);
    this.fpBlockMesh.position.set(0.36, -0.26, -0.68);
    this.fpBlockMesh.rotation.set(0.22, 0.55, 0.08);
    this.fpHandGroup.add(this.fpBlockMesh);
    this.fpHandGroup.visible = false;
  }

  setAvatar(avatarIdx: number, customSkin?: CustomAvatarSkin | null): void {
    const skinKey = customSkin ? getCustomSkinKey(customSkin) : '';
    if (avatarIdx === this.lastAvatarIdx && skinKey === this.lastCustomSkinKey) return;
    this.lastAvatarIdx = avatarIdx;
    this.lastCustomSkinKey = skinKey;
    const model = customSkin
      ? buildCustomAvatarCharacterModel(customSkin)
      : getAvatarCharacterModel(avatarIdx);
    this.upperMesh.geometry = model.upperNoArmsGeo;
    if (model.floatGeo) {
      this.floatMesh.geometry = model.floatGeo;
      this.floatMesh.visible = true;
      this.floatMesh.position.y = 1.46;
    } else {
      this.floatMesh.visible = false;
    }
    this.hasFloatingMarks = Boolean(model.outfit.hasFloatingMarks);
    this.activeAccentColor = model.outfit.bikePrimary || '#38e2d4';

    const jacketHex = parseHex(model.outfit.jacket);
    const pantsHex = parseHex(model.outfit.pants);
    const bootsHex = customSkin ? parseHex(customSkin.boots) : darkenHex(pantsHex);
    this.armMat.color.setHex(jacketHex);
    this.legMat.color.setHex(pantsHex);
    this.bootMat.color.setHex(bootsHex);
    this.fpArmMat.color.setHex(jacketHex);
  }

  setNameplate(
    name: string,
    isLocal: boolean,
    avatarIdx: number,
    peerId: string,
    hp = 100,
    accentHex?: string
  ): void {
    if (isLocal || !name) {
      if (this.plateSprite) {
        this.plateSprite.visible = false;
      }
      return;
    }

    if (!this.plateSprite || !this.plateCanvas || !this.plateTex) {
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
      this.plateSprite.position.set(0, 2.34, 0);
      this.plateSprite.scale.set(2.6, 0.65, 1);
      this.root.add(this.plateSprite);
    }

    this.plateSprite.visible = true;
    const hpBucket = Math.round(hp / 4) * 4;
    const avatarVer = getAvatarVersion(peerId);
    const skinVer = getCustomSkinVersion();
    const accent = accentHex || this.activeAccentColor;
    const lang = getLang();

    if (
      name !== this.lastPlateName ||
      peerId !== this.lastPlatePeerId ||
      hpBucket !== this.lastPlateHp ||
      avatarIdx !== this.lastPlateAvatar ||
      avatarVer !== this.lastPlateAvatarVer ||
      skinVer !== this.lastPlateSkinVer ||
      accent !== this.lastPlateAccent ||
      lang !== this.lastPlateLang
    ) {
      this.lastPlateName = name;
      this.lastPlatePeerId = peerId;
      this.lastPlateHp = hpBucket;
      this.lastPlateAvatar = avatarIdx;
      this.lastPlateAvatarVer = avatarVer;
      this.lastPlateSkinVer = skinVer;
      this.lastPlateAccent = accent;
      this.lastPlateLang = lang;
      drawNameplateCanvas(this.plateCanvas, name, hp, accent, false, avatarIdx, peerId, false);
      this.plateTex.needsUpdate = true;
    }
  }

  setHeldBlock(block: BlockType): void {
    const spec = BLOCK_SPEC_BY_ID[block] ?? BLOCK_SPEC_BY_ID[3];
    const resolved = spec.id;
    if (resolved === this.lastBlock) return;
    this.lastBlock = resolved;
    const hex = spec.particleHex;
    this.heldBlockMat.color.setHex(hex);
    this.fpBlockMat.color.setHex(hex);
  }

  updateAnimation(
    walkPhase: number,
    moveSpeed: number,
    swingTimer: number,
    timeSec: number,
    firstPerson: boolean
  ): void {
    const moveBlend = Math.min(1, moveSpeed / 4.5);
    const swing = Math.sin(walkPhase) * 0.72 * moveBlend;
    const bob = Math.abs(Math.cos(walkPhase)) * 0.06 * moveBlend;

    this.bodyPivot.position.y = bob;
    this.leftLegPivot.rotation.x = swing;
    this.rightLegPivot.rotation.x = -swing;
    this.leftArmPivot.rotation.x = -swing * 0.85;

    const actionPunch = swingTimer > 0 ? Math.sin((Math.min(0.24, swingTimer) / 0.24) * Math.PI) : 0;
    this.rightArmPivot.rotation.x = swing * 0.65 + 0.45 + actionPunch * 1.15;
    this.rightArmPivot.rotation.z = -actionPunch * 0.22;

    if (this.hasFloatingMarks && this.floatMesh.visible) {
      this.floatMesh.position.y = 1.46 + Math.sin(timeSec * 5.2) * 0.055;
    }

    // First-person hand bob & punch
    this.fpHandGroup.visible = firstPerson;
    if (firstPerson) {
      const fpBobX = Math.cos(walkPhase) * 0.025 * moveBlend;
      const fpBobY = Math.abs(Math.sin(walkPhase)) * 0.03 * moveBlend;
      this.fpBlockMesh.position.set(
        0.36 + fpBobX - actionPunch * 0.1,
        -0.26 - fpBobY + actionPunch * 0.06,
        -0.68 - actionPunch * 0.14
      );
      this.fpBlockMesh.rotation.set(
        0.22 + actionPunch * 0.75,
        0.55 - actionPunch * 0.45,
        0.08
      );
      this.fpArmMesh.position.set(
        0.42 + fpBobX - actionPunch * 0.06,
        -0.38 - fpBobY,
        -0.52 - actionPunch * 0.1
      );
    }
  }

  dispose(): void {
    this.armMat.dispose();
    this.legMat.dispose();
    this.bootMat.dispose();
    this.heldBlockMat.dispose();
    this.fpArmMat.dispose();
    this.fpBlockMat.dispose();
    if (this.plateTex) {
      this.plateTex.dispose();
      this.plateTex = null;
    }
    if (this.plateSprite) {
      (this.plateSprite.material as THREE.SpriteMaterial).dispose();
      this.plateSprite = null;
    }
    this.plateCanvas = null;
  }
}
