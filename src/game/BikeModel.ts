import * as THREE from 'three';
import { BIKE_PALETTES, BOT_PALETTE, BikePalette, RiderRenderState, WeaponType } from './types';
import { drawNameplateCanvas, getPixelAtlas } from './PixelTextures';

// Shared geometries (allocated once, reused by all players & bots)
let _sharedGeos: {
  wheel: THREE.CylinderGeometry;
  tireRim: THREE.BoxGeometry;
  chassis: THREE.BoxGeometry;
  tank: THREE.BoxGeometry;
  nose: THREE.BoxGeometry;
  windshield: THREE.BoxGeometry;
  seat: THREE.BoxGeometry;
  tail: THREE.BoxGeometry;
  fork: THREE.BoxGeometry;
  handlebar: THREE.BoxGeometry;
  exhaust: THREE.BoxGeometry;
  light: THREE.BoxGeometry;
  flame: THREE.ConeGeometry;
  torso: THREE.BoxGeometry;
  head: THREE.BoxGeometry;
  visor: THREE.BoxGeometry;
  arm: THREE.BoxGeometry;
  leg: THREE.BoxGeometry;
  batHandle: THREE.BoxGeometry;
  batHead: THREE.BoxGeometry;
  chainLink: THREE.BoxGeometry;
  shadow: THREE.PlaneGeometry;
} | null = null;

function getSharedGeos() {
  if (_sharedGeos) return _sharedGeos;
  const wheel = new THREE.CylinderGeometry(0.35, 0.35, 0.24, 12);
  wheel.rotateZ(Math.PI / 2);

  const flame = new THREE.ConeGeometry(0.14, 0.95, 5);
  flame.rotateX(Math.PI / 2);
  flame.translate(0, 0, 0.45);

  const shadow = new THREE.PlaneGeometry(1.15, 2.35);
  shadow.rotateX(-Math.PI / 2);

  _sharedGeos = {
    wheel,
    tireRim: new THREE.BoxGeometry(0.28, 0.14, 0.14),
    chassis: new THREE.BoxGeometry(0.46, 0.42, 1.38),
    tank: new THREE.BoxGeometry(0.48, 0.26, 0.62),
    nose: new THREE.BoxGeometry(0.44, 0.36, 0.52),
    windshield: new THREE.BoxGeometry(0.38, 0.24, 0.18),
    seat: new THREE.BoxGeometry(0.38, 0.14, 0.62),
    tail: new THREE.BoxGeometry(0.36, 0.22, 0.48),
    fork: new THREE.BoxGeometry(0.08, 0.66, 0.1),
    handlebar: new THREE.BoxGeometry(0.76, 0.08, 0.08),
    exhaust: new THREE.BoxGeometry(0.12, 0.12, 0.72),
    light: new THREE.BoxGeometry(0.28, 0.12, 0.08),
    flame,
    torso: new THREE.BoxGeometry(0.48, 0.58, 0.32),
    head: new THREE.BoxGeometry(0.36, 0.36, 0.38),
    visor: new THREE.BoxGeometry(0.34, 0.14, 0.12),
    arm: new THREE.BoxGeometry(0.15, 0.46, 0.15),
    leg: new THREE.BoxGeometry(0.18, 0.52, 0.2),
    batHandle: new THREE.BoxGeometry(0.07, 0.36, 0.07),
    batHead: new THREE.BoxGeometry(0.13, 0.54, 0.13),
    chainLink: new THREE.BoxGeometry(0.1, 0.14, 0.1),
    shadow,
  };
  return _sharedGeos;
}

const _shadowMat = new THREE.MeshBasicMaterial({
  color: 0x090b14,
  transparent: true,
  opacity: 0.48,
  depthWrite: false,
});

const _metalMat = new THREE.MeshLambertMaterial({ color: 0x8f9bb3, flatShading: true });
const _darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1c26, flatShading: true });
const _headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff8c5 });
const _flameOuterMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.88 });
const _flameInnerMat = new THREE.MeshBasicMaterial({ color: 0xffbe0b });
const _batMat = new THREE.MeshLambertMaterial({ color: 0xd4a373, flatShading: true });
const _chainMat = new THREE.MeshLambertMaterial({ color: 0xd8e2ec, flatShading: true });

export class BikeVisual {
  readonly root = new THREE.Group();
  private readonly bikePivot = new THREE.Group();
  private readonly frontForkGroup = new THREE.Group();
  private readonly frontWheel: THREE.Mesh;
  private readonly rearWheel: THREE.Mesh;
  private readonly brakeLightMat: THREE.MeshBasicMaterial;
  private readonly flameL: THREE.Mesh;
  private readonly flameR: THREE.Mesh;
  private readonly shadowMesh: THREE.Mesh;

  // Articulated rider
  private readonly riderGroup = new THREE.Group();
  private readonly torsoGroup = new THREE.Group();
  private readonly leftArmPivot = new THREE.Group();
  private readonly rightArmPivot = new THREE.Group();
  private readonly leftLegPivot = new THREE.Group();
  private readonly rightLegPivot = new THREE.Group();
  private readonly leftBat: THREE.Group;
  private readonly rightBat: THREE.Group;
  private readonly leftChain: THREE.Group;
  private readonly rightChain: THREE.Group;

  // Colorable materials
  private readonly primaryMat: THREE.MeshLambertMaterial;
  private readonly secondaryMat: THREE.MeshLambertMaterial;
  private readonly accentMat: THREE.MeshLambertMaterial;
  private readonly jacketMat: THREE.MeshLambertMaterial;
  private readonly helmetMat: THREE.MeshLambertMaterial;
  private readonly visorMat: THREE.MeshBasicMaterial;

  // Nameplate sprite
  private readonly plateCanvas: HTMLCanvasElement;
  private readonly plateTex: THREE.CanvasTexture;
  private readonly plateSprite: THREE.Sprite;
  private lastPlateName = '';
  private lastPlateHp = -1;
  private lastPlateAvatar = -1;
  private lastColorIdx = -1;
  private isBot = false;

  constructor(palette: BikePalette, showNameplate: boolean) {
    const geos = getSharedGeos();
    const atlas = getPixelAtlas();

    this.primaryMat = new THREE.MeshLambertMaterial({ color: palette.primary, flatShading: true });
    this.secondaryMat = new THREE.MeshLambertMaterial({ color: palette.secondary, flatShading: true });
    this.accentMat = new THREE.MeshLambertMaterial({ color: palette.accent, flatShading: true });
    this.jacketMat = new THREE.MeshLambertMaterial({ color: palette.jacket, flatShading: true });
    this.helmetMat = new THREE.MeshLambertMaterial({ color: palette.helmet, flatShading: true });
    this.visorMat = new THREE.MeshBasicMaterial({ color: palette.visor });
    this.brakeLightMat = new THREE.MeshBasicMaterial({ color: 0xff2a44 });

    const wheelMat = new THREE.MeshLambertMaterial({ map: atlas.wheel, flatShading: true });

    // Ground contact shadow
    this.shadowMesh = new THREE.Mesh(geos.shadow, _shadowMat);
    this.shadowMesh.position.y = 0.04;
    this.root.add(this.shadowMesh);

    this.root.add(this.bikePivot);

    // Rear wheel
    this.rearWheel = new THREE.Mesh(geos.wheel, wheelMat);
    this.rearWheel.position.set(0, 0.35, 0.78);
    this.bikePivot.add(this.rearWheel);

    // Front steering assembly
    this.frontForkGroup.position.set(0, 0.35, -0.78);
    this.bikePivot.add(this.frontForkGroup);

    this.frontWheel = new THREE.Mesh(geos.wheel, wheelMat);
    this.frontForkGroup.add(this.frontWheel);

    const forkL = new THREE.Mesh(geos.fork, _metalMat);
    forkL.position.set(-0.18, 0.34, 0.06);
    forkL.rotation.x = 0.28;
    this.frontForkGroup.add(forkL);

    const forkR = new THREE.Mesh(geos.fork, _metalMat);
    forkR.position.set(0.18, 0.34, 0.06);
    forkR.rotation.x = 0.28;
    this.frontForkGroup.add(forkR);

    const bar = new THREE.Mesh(geos.handlebar, _darkMat);
    bar.position.set(0, 0.68, 0.16);
    this.frontForkGroup.add(bar);

    // Chassis / fairing / engine block
    const chassis = new THREE.Mesh(geos.chassis, this.secondaryMat);
    chassis.position.set(0, 0.56, 0.04);
    this.bikePivot.add(chassis);

    const tank = new THREE.Mesh(geos.tank, this.primaryMat);
    tank.position.set(0, 0.84, -0.18);
    this.bikePivot.add(tank);

    const nose = new THREE.Mesh(geos.nose, this.primaryMat);
    nose.position.set(0, 0.8, -0.68);
    nose.rotation.x = 0.16;
    this.bikePivot.add(nose);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.38, 0.54), this.accentMat);
    stripe.position.set(0, 0.81, -0.68);
    stripe.rotation.x = 0.16;
    this.bikePivot.add(stripe);

    const windshield = new THREE.Mesh(geos.windshield, this.visorMat);
    windshield.position.set(0, 1.04, -0.66);
    windshield.rotation.x = -0.55;
    this.bikePivot.add(windshield);

    const seat = new THREE.Mesh(geos.seat, _darkMat);
    seat.position.set(0, 0.78, 0.34);
    this.bikePivot.add(seat);

    const tail = new THREE.Mesh(geos.tail, this.primaryMat);
    tail.position.set(0, 0.82, 0.78);
    tail.rotation.x = -0.18;
    this.bikePivot.add(tail);

    // Dual chrome exhaust pipes
    const exhL = new THREE.Mesh(geos.exhaust, _metalMat);
    exhL.position.set(-0.26, 0.44, 0.76);
    exhL.rotation.x = 0.14;
    this.bikePivot.add(exhL);

    const exhR = new THREE.Mesh(geos.exhaust, _metalMat);
    exhR.position.set(0.26, 0.44, 0.76);
    exhR.rotation.x = 0.14;
    this.bikePivot.add(exhR);

    // Headlight & brake light
    const headlight = new THREE.Mesh(geos.light, _headlightMat);
    headlight.position.set(0, 0.82, -0.94);
    this.bikePivot.add(headlight);

    const taillight = new THREE.Mesh(geos.light, this.brakeLightMat);
    taillight.position.set(0, 0.84, 1.02);
    this.bikePivot.add(taillight);

    // Nitro exhaust flames
    this.flameL = new THREE.Mesh(geos.flame, _flameOuterMat);
    this.flameL.position.set(-0.26, 0.48, 1.12);
    this.flameL.visible = false;
    const innerL = new THREE.Mesh(geos.flame, _flameInnerMat);
    innerL.scale.set(0.55, 0.55, 0.6);
    this.flameL.add(innerL);
    this.bikePivot.add(this.flameL);

    this.flameR = new THREE.Mesh(geos.flame, _flameOuterMat);
    this.flameR.position.set(0.26, 0.48, 1.12);
    this.flameR.visible = false;
    const innerR = new THREE.Mesh(geos.flame, _flameInnerMat);
    innerR.scale.set(0.55, 0.55, 0.6);
    this.flameR.add(innerR);
    this.bikePivot.add(this.flameR);

    // Rider
    this.riderGroup.position.set(0, 0.84, 0.26);
    this.bikePivot.add(this.riderGroup);

    this.torsoGroup.position.set(0, 0.1, 0);
    this.riderGroup.add(this.torsoGroup);

    const torso = new THREE.Mesh(geos.torso, this.jacketMat);
    torso.position.set(0, 0.28, -0.05);
    torso.rotation.x = -0.42;
    this.torsoGroup.add(torso);

    // Racing stripe on rider's back
    const backStripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.05), this.accentMat);
    backStripe.position.set(0, 0.28, 0.11);
    backStripe.rotation.x = -0.42;
    this.torsoGroup.add(backStripe);

    const head = new THREE.Mesh(geos.head, this.helmetMat);
    head.position.set(0, 0.7, -0.22);
    this.torsoGroup.add(head);

    const visor = new THREE.Mesh(geos.visor, this.visorMat);
    visor.position.set(0, 0.72, -0.39);
    this.torsoGroup.add(visor);

    // Arms + melee weapons
    this.leftArmPivot.position.set(-0.29, 0.48, -0.14);
    this.torsoGroup.add(this.leftArmPivot);
    const armL = new THREE.Mesh(geos.arm, this.jacketMat);
    armL.position.set(0, -0.18, -0.12);
    armL.rotation.x = 0.92;
    this.leftArmPivot.add(armL);

    this.rightArmPivot.position.set(0.29, 0.48, -0.14);
    this.torsoGroup.add(this.rightArmPivot);
    const armR = new THREE.Mesh(geos.arm, this.jacketMat);
    armR.position.set(0, -0.18, -0.12);
    armR.rotation.x = 0.92;
    this.rightArmPivot.add(armR);

    this.leftBat = this.createBatMesh();
    this.leftBat.position.set(-0.04, -0.32, -0.32);
    this.leftBat.visible = false;
    this.leftArmPivot.add(this.leftBat);

    this.rightBat = this.createBatMesh();
    this.rightBat.position.set(0.04, -0.32, -0.32);
    this.rightBat.visible = false;
    this.rightArmPivot.add(this.rightBat);

    this.leftChain = this.createChainMesh();
    this.leftChain.position.set(-0.04, -0.32, -0.32);
    this.leftChain.visible = false;
    this.leftArmPivot.add(this.leftChain);

    this.rightChain = this.createChainMesh();
    this.rightChain.position.set(0.04, -0.32, -0.32);
    this.rightChain.visible = false;
    this.rightArmPivot.add(this.rightChain);

    // Legs (kick out during fist/kick attacks!)
    this.leftLegPivot.position.set(-0.22, 0.04, 0.02);
    this.riderGroup.add(this.leftLegPivot);
    const legL = new THREE.Mesh(geos.leg, _darkMat);
    legL.position.set(-0.04, -0.22, -0.08);
    legL.rotation.x = 0.45;
    this.leftLegPivot.add(legL);

    this.rightLegPivot.position.set(0.22, 0.04, 0.02);
    this.riderGroup.add(this.rightLegPivot);
    const legR = new THREE.Mesh(geos.leg, _darkMat);
    legR.position.set(0.04, -0.22, -0.08);
    legR.rotation.x = 0.45;
    this.rightLegPivot.add(legR);

    // Floating crisp pixel nameplate sprite
    this.plateCanvas = document.createElement('canvas');
    this.plateCanvas.width = 256;
    this.plateCanvas.height = 64;
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
    this.plateSprite.position.set(0, 2.38, 0.1);
    this.plateSprite.scale.set(2.8, 0.7, 1);
    this.plateSprite.visible = showNameplate;
    this.root.add(this.plateSprite);
  }

  private createBatMesh(): THREE.Group {
    const geos = getSharedGeos();
    const g = new THREE.Group();
    const handle = new THREE.Mesh(geos.batHandle, _darkMat);
    handle.position.y = -0.15;
    g.add(handle);
    const head = new THREE.Mesh(geos.batHead, _batMat);
    head.position.y = -0.58;
    g.add(head);
    const spike = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.18), _metalMat);
    spike.position.y = -0.74;
    g.add(spike);
    g.rotation.x = -Math.PI * 0.42;
    return g;
  }

  private createChainMesh(): THREE.Group {
    const geos = getSharedGeos();
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const link = new THREE.Mesh(geos.chainLink, _chainMat);
      link.position.y = -0.14 * (i + 1);
      link.rotation.y = (i % 2) * (Math.PI / 2);
      g.add(link);
    }
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), _metalMat);
    weight.position.y = -1.1;
    g.add(weight);
    g.rotation.x = -Math.PI * 0.45;
    return g;
  }

  setPalette(colorIdx: number, isBot: boolean): void {
    if (this.lastColorIdx === colorIdx && this.isBot === isBot) return;
    this.lastColorIdx = colorIdx;
    this.isBot = isBot;
    const p = isBot ? BOT_PALETTE : BIKE_PALETTES[Math.abs(colorIdx) % BIKE_PALETTES.length];
    this.primaryMat.color.set(p.primary);
    this.secondaryMat.color.set(p.secondary);
    this.accentMat.color.set(p.accent);
    this.jacketMat.color.set(p.jacket);
    this.helmetMat.color.set(p.helmet);
    this.visorMat.color.set(p.visor);
    // Force nameplate refresh
    this.lastPlateHp = -1;
  }

  updateVisuals(state: RiderRenderState, timeSec: number): void {
    this.setPalette(state.colorIdx, state.isBot);

    // Invulnerability blink after crash recovery
    if (state.invulnTimer > 0) {
      this.bikePivot.visible = Math.floor(timeSec * 16) % 2 === 0;
    } else {
      this.bikePivot.visible = true;
    }

    // Shadow flattens & shrinks with air height
    const airScale = Math.max(0.45, 1.0 - state.y * 0.12);
    this.shadowMesh.scale.set(airScale, 1, airScale);
    this.shadowMesh.position.y = Math.max(0.03, 0.04 - state.y);

    // Wheels spin forward
    this.frontWheel.rotation.x = -state.wheelAngle;
    this.rearWheel.rotation.x = -state.wheelAngle;

    // Front steering matches lean gently
    this.frontForkGroup.rotation.y = -state.lean * 0.35;

    // Brake light intensifies on braking
    this.brakeLightMat.color.setHex(state.braking ? 0xff4d6d : 0x991b2b);

    // Nitro exhaust flames
    const showFlames = state.nitroActive && !state.crashed;
    this.flameL.visible = showFlames;
    this.flameR.visible = showFlames;
    if (showFlames) {
      const flicker = 0.8 + 0.45 * Math.sin(timeSec * 48);
      this.flameL.scale.set(1, 1, flicker);
      this.flameR.scale.set(1, 1, flicker * 0.94);
    }

    if (state.crashed) {
      // Dramatic wipeout tumble!
      const t = Math.min(1, state.crashTimer / 1.5);
      this.bikePivot.position.y = Math.max(0, Math.sin(t * Math.PI * 2.2) * (1 - t) * 1.1);
      this.bikePivot.rotation.z = Math.PI * 0.46 * (state.vx >= 0 ? -1 : 1) + Math.sin(t * 14) * 0.35 * (1 - t);
      this.bikePivot.rotation.y = t * Math.PI * 1.6 * (state.vx >= 0 ? 1 : -1);
      this.bikePivot.rotation.x = Math.sin(t * 9) * 0.25;
      this.riderGroup.position.set(
        (state.vx >= 0 ? 0.6 : -0.6) * t,
        0.55 + Math.sin(t * Math.PI) * 0.8,
        0.26 + t * 0.7
      );
      this.riderGroup.rotation.set(-t * 1.8, 0, t * 2.4);
    } else {
      this.bikePivot.position.set(0, state.y, 0);
      this.bikePivot.rotation.y = 0;
      // Right lean > 0 => negative Z rotation
      this.bikePivot.rotation.z = -state.lean;
      // Wheelie pitches nose up (+X rotation)
      this.bikePivot.rotation.x = state.wheelie * 0.42;

      // Rider hangs slightly further into corner & tucks at high speed
      const speedTuck = Math.min(1, state.speed / 58);
      this.riderGroup.position.set(state.lean * 0.24, 0.84 - speedTuck * 0.06, 0.26);
      this.riderGroup.rotation.set(0, 0, -state.lean * 0.25);
      this.torsoGroup.rotation.x = -speedTuck * 0.22;

      this.updateCombatLimbs(state.weapon, state.attackSide, state.attackPhase);
    }

    // Update nameplate sprite only when name, rounded HP, or avatar changes
    if (this.plateSprite.visible) {
      const hpBucket = Math.round(state.hp / 4) * 4;
      if (
        state.name !== this.lastPlateName ||
        hpBucket !== this.lastPlateHp ||
        state.avatarIdx !== this.lastPlateAvatar
      ) {
        this.lastPlateName = state.name;
        this.lastPlateHp = hpBucket;
        this.lastPlateAvatar = state.avatarIdx;
        const p = state.isBot ? BOT_PALETTE : BIKE_PALETTES[Math.abs(state.colorIdx) % BIKE_PALETTES.length];
        drawNameplateCanvas(this.plateCanvas, state.name, state.hp, p.primary, state.isBot, state.avatarIdx);
        this.plateTex.needsUpdate = true;
      }
      this.plateSprite.position.y = 2.38 + state.y;
    }
  }

  private updateCombatLimbs(weapon: WeaponType, attackSide: 0 | 1 | 2, phase: number): void {
    // Reset default riding pose
    this.leftArmPivot.rotation.set(0, 0, 0);
    this.rightArmPivot.rotation.set(0, 0, 0);
    this.leftLegPivot.rotation.set(0, 0, 0);
    this.rightLegPivot.rotation.set(0, 0, 0);

    // Show equipped weapon on active side (or carried on right when idle)
    const showBat = weapon === 1;
    const showChain = weapon === 2;
    this.leftBat.visible = showBat && attackSide === 1;
    this.rightBat.visible = showBat && attackSide !== 1;
    this.leftChain.visible = showChain && attackSide === 1;
    this.rightChain.visible = showChain && attackSide !== 1;

    if (attackSide === 0 || phase <= 0) return;

    // Punchy anticipation -> strike -> follow-through curve
    const swing = phase < 0.25
      ? -phase * 4.0 * 0.6
      : phase < 0.65
        ? -0.6 + ((phase - 0.25) / 0.4) * 2.2
        : 1.6 * (1 - (phase - 0.65) / 0.35);

    if (attackSide === 1) {
      // Attack LEFT (-X)
      if (weapon === 0) {
        // Classic Road Rash side kick + left hook!
        this.leftLegPivot.rotation.z = -Math.max(0, swing) * 0.85;
        this.leftArmPivot.rotation.z = -swing * 1.15;
        this.leftArmPivot.rotation.y = swing * 0.55;
      } else {
        this.leftArmPivot.rotation.z = -1.25 - swing * 0.55;
        this.leftArmPivot.rotation.x = -0.35 + swing * 0.9;
        this.leftArmPivot.rotation.y = swing * 0.7;
      }
    } else if (attackSide === 2) {
      // Attack RIGHT (+X)
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
    this.primaryMat.dispose();
    this.secondaryMat.dispose();
    this.accentMat.dispose();
    this.jacketMat.dispose();
    this.helmetMat.dispose();
    this.visorMat.dispose();
    this.brakeLightMat.dispose();
    this.plateTex.dispose();
    (this.plateSprite.material as THREE.SpriteMaterial).dispose();
  }
}
