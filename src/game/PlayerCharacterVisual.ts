import * as THREE from 'three';
import { getAvatarCharacterModel, getSharedBasicVertexMat, getSharedVertexColorMat } from './AvatarModels';
import {
  buildCustomAvatarCharacterModel,
  CustomAvatarSkin,
  getCustomSkinKey,
} from './CustomAvatarSystem';
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
  private readonly bootMat: THREE.MeshLambertMaterial;
  private readonly heldBlockMesh: THREE.Mesh;
  private readonly heldBlockMat: THREE.MeshLambertMaterial;

  // First-person held block & forearm attached to camera
  private readonly fpBlockMesh: THREE.Mesh;
  private readonly fpBlockMat: THREE.MeshLambertMaterial;
  private readonly fpArmMesh: THREE.Mesh;
  private readonly fpArmMat: THREE.MeshLambertMaterial;

  private lastAvatarIdx = -1;
  private lastCustomSkinKey = '';
  private lastBlock: BlockType = 3;
  private hasFloatingMarks = false;

  constructor() {
    const vMat = getSharedVertexColorMat();
    const bMat = getSharedBasicVertexMat();

    const shadowGeo = new THREE.PlaneGeometry(0.82, 0.82);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ color: 0x090b14, transparent: true, opacity: 0.44, depthWrite: false })
    );
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

    const armGeo = new THREE.BoxGeometry(0.16, 0.56, 0.16);
    armGeo.translate(0, -0.24, 0);
    const legGeo = new THREE.BoxGeometry(0.2, 0.52, 0.2);
    legGeo.translate(0, -0.26, 0);
    const bootGeo = new THREE.BoxGeometry(0.22, 0.18, 0.24);
    bootGeo.translate(0, -0.59, -0.02);

    const initArmMat = new THREE.MeshLambertMaterial({ color: 0x232838, flatShading: true });
    const initLegMat = new THREE.MeshLambertMaterial({ color: 0x1a2030, flatShading: true });
    this.bootMat = new THREE.MeshLambertMaterial({ color: 0x111520, flatShading: true });

    this.leftArmPivot.position.set(-0.32, 1.24, 0);
    this.armL = new THREE.Mesh(armGeo, initArmMat);
    this.leftArmPivot.add(this.armL);
    this.bodyPivot.add(this.leftArmPivot);

    this.rightArmPivot.position.set(0.32, 1.24, 0);
    this.armR = new THREE.Mesh(armGeo, initArmMat);
    this.rightArmPivot.add(this.armR);
    this.bodyPivot.add(this.rightArmPivot);

    this.heldBlockMat = new THREE.MeshLambertMaterial({ color: BLOCK_SPEC_BY_ID[3].particleHex });
    this.heldBlockMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), this.heldBlockMat);
    this.heldBlockMesh.position.set(0.02, -0.48, -0.18);
    this.rightArmPivot.add(this.heldBlockMesh);

    this.leftLegPivot.position.set(-0.14, 0.68, 0);
    this.legL = new THREE.Mesh(legGeo, initLegMat);
    this.leftLegPivot.add(this.legL);
    this.leftLegPivot.add(new THREE.Mesh(bootGeo, this.bootMat));
    this.bodyPivot.add(this.leftLegPivot);

    this.rightLegPivot.position.set(0.14, 0.68, 0);
    this.legR = new THREE.Mesh(legGeo, initLegMat);
    this.rightLegPivot.add(this.legR);
    this.rightLegPivot.add(new THREE.Mesh(bootGeo, this.bootMat));
    this.bodyPivot.add(this.rightLegPivot);

    // First-person held block viewmodel (bottom-right of camera)
    this.fpArmMat = new THREE.MeshLambertMaterial({ color: 0x232838, flatShading: true });
    this.fpArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.48), this.fpArmMat);
    this.fpArmMesh.position.set(0.42, -0.38, -0.52);
    this.fpArmMesh.rotation.set(0.18, -0.25, 0.1);
    this.fpHandGroup.add(this.fpArmMesh);

    this.fpBlockMat = new THREE.MeshLambertMaterial({ color: BLOCK_SPEC_BY_ID[3].particleHex });
    this.fpBlockMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), this.fpBlockMat);
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

    const jacketHex = parseHex(model.outfit.jacket);
    const pantsHex = parseHex(model.outfit.pants);
    const bootsHex = customSkin ? parseHex(customSkin.boots) : darkenHex(pantsHex);
    (this.armL.material as THREE.MeshLambertMaterial).color.setHex(jacketHex);
    (this.legL.material as THREE.MeshLambertMaterial).color.setHex(pantsHex);
    this.bootMat.color.setHex(bootsHex);
    this.fpArmMat.color.setHex(jacketHex);
  }

  setHeldBlock(block: BlockType): void {
    if (block === this.lastBlock) return;
    this.lastBlock = block;
    const hex = BLOCK_SPEC_BY_ID[block].particleHex;
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

    const actionPunch = swingTimer > 0 ? Math.sin((swingTimer / 0.24) * Math.PI) : 0;
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
}
