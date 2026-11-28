import {
  MAX_LATERAL,
  ROAD_HALF_WIDTH,
  RoadFrame,
  SHOULDER_HALF_WIDTH,
  getBoostPadInSlot,
  openWorldGroundY,
  roadForwardYaw,
  roadToWorldAbs,
  roadX,
  roadY,
  sampleRoadFrame,
  signedTrackDelta,
  wrapTrackS,
} from './RoadMath';
import { AVATAR_COUNT } from './PixelAvatars';
import { FallenCargo, RiderRenderState, TrafficCar, WEAPONS, WeaponType } from './types';
import type { WeatherPhysicsMod } from './WeatherSystem';
import type { BlockType, VoxelWorld } from './VoxelWorld';
import { StaticObstacle, collectNearbyStaticObstacles } from './WorldObstacles';

export interface InputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  analogSteer?: number;
  nitro: boolean;
  wheelie: boolean;
  attackLeft: boolean;
  attackRight: boolean;
  attackAuto: boolean;
  weaponSwitch?: WeaponType;
}

export type ParticleKind = 'spark' | 'smoke' | 'dust' | 'nitro' | 'crash' | 'water' | 'snow';

export interface PlayerCallbacks {
  onAttackSwing(side: 1 | 2, weapon: WeaponType): void;
  onHitLanded(
    target: RiderRenderState,
    dmg: number,
    side: 1 | 2,
    weapon: WeaponType,
    knockX: number,
    ko: boolean
  ): void;
  onWheelieSlam?(charge: number, hitsCount: number): void;
  onWheelieSlamHit?(
    target: RiderRenderState,
    dmg: number,
    knockX: number,
    ko: boolean,
    charge: number
  ): void;
  onWheelieFlip?(): void;
  onBoostPad(): void;
  onNearMiss(): void;
  onCrash(): void;
  onLeaveTrack?(): void;
  onReturnTrack?(): void;
  onBlockEffect?(kind: 'block' | 'slow' | 'boost' | 'crash', blockType: BlockType): void;
  onParticles(
    kind: ParticleKind,
    s: number,
    x: number,
    y: number,
    vs?: number
  ): void;
}

const TOP_SPEED_NORMAL = 58.0; // ~209 km/h
const TOP_SPEED_NITRO = 74.0; // ~266 km/h
const TOP_SPEED_BOOST = 78.0;
const TOP_SPEED_TURBO_SHIELD = 84.0; // ~302 km/h overdrive shield
const TOP_SPEED_OFFROAD = 37.0;
const WHEELIE_SPEED_BONUS = 8.5;
const WHEELIE_CHARGE_RATE = 1 / 1.55; // 0 -> 1.0 over ~1.55s
const WHEEL_RADIUS = 0.35;
const WIPEOUT_DURATION = 1.8;
const REMOUNT_INVULN = 1.8;
const SPAWN_INVULN = 1.6;
const GRAVITY = 25.0;
const HOP_VELOCITY = 8.4; // peak height ~1.41m

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isSlowVoxel(bt: BlockType): boolean {
  return bt === 1 || bt === 6;
}

function isSolidVoxel(bt: BlockType): boolean {
  return bt === 2 || bt === 3 || bt === 4 || bt === 5 || bt === 7 || bt === 8 || bt === 10;
}

export class PlayerPhysics {
  readonly state: RiderRenderState;

  private readonly input: InputState = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    nitro: false,
    wheelie: false,
    attackLeft: false,
    attackRight: false,
    attackAuto: false,
  };

  private readonly _frame: RoadFrame = {
    x: 0,
    y: 0,
    z: 0,
    tx: 0,
    ty: 0,
    tz: -1,
    rx: 1,
    ry: 0,
    rz: 0,
    ux: 0,
    uy: 1,
    uz: 0,
    curvature: 0,
    tangentLen: 1,
    bank: 0,
  };

  private readonly hitIdsThisSwing = new Set<string>();

  private vy = 0;
  private hopCooldown = 0;
  private prevWheelieKey = false;
  private wheelieHoldTime = 0;
  private attackTimer = 0;
  private attackCooldown = 0;
  private pendingSwingSide: 0 | 1 | 2 = 0;
  private lastAutoSide: 1 | 2 = 2;
  private nitroDepleted = false;
  private boostPadTimer = 0;
  private lastBoostSlot = -999;
  private particleTimer = 0;
  private railSparkTimer = 0;
  private blockHitCooldown = 0;
  private blockSlowFeedbackTimer = 0;
  private blockBoostFeedbackTimer = 0;
  private slowBlockTimer = 0;
  private asphaltBoostTimer = 0;
  private voxelSupportY = 0;

  // Open-world free-roam Euclidean pose
  private freeWx = 0;
  private freeWy = 0;
  private freeWs = 20;
  private freeYaw = 0;
  private freeRejoinCooldown = 0;
  private readonly _tmpAbs = { wx: 0, wy: 0, ws: 0 };
  private readonly _tmpPrevAbs = { wx: 0, wy: 0, ws: 0 };
  private readonly _nearbyObs: StaticObstacle[] = [];

  constructor(id: string, name: string, colorIdx: number, avatarIdx = 0) {
    this.state = {
      id,
      name,
      isLocal: true,
      isBot: false,
      colorIdx,
      avatarIdx: ((Math.trunc(avatarIdx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT,
      s: 20,
      x: 1.9,
      y: 0,
      speed: 14,
      vx: 0,
      lean: 0,
      hp: 100,
      nitro: 45,
      weapon: 0,
      attackSide: 0,
      attackPhase: 0,
      nitroActive: false,
      wheelie: 0,
      crashed: false,
      crashTimer: 0,
      braking: false,
      invulnTimer: 0,
      wheelAngle: 0,
      kos: 0,
      heldItem: null,
      heldItems: [],
      wheelieCharge: 0,
      magnetTimer: 0,
      turboShieldTimer: 0,
      spinOutTimer: 0,
      incomingLockName: null,
      freeRoam: false,
      heading: 0,
      onFoot: false,
    };
  }

  setInput(input: InputState): void {
    this.input.throttle = input.throttle;
    this.input.brake = input.brake;
    this.input.left = input.left;
    this.input.right = input.right;
    this.input.analogSteer = input.analogSteer ?? 0;
    this.input.nitro = input.nitro;
    this.input.wheelie = input.wheelie;
    this.input.attackLeft = input.attackLeft;
    this.input.attackRight = input.attackRight;
    this.input.attackAuto = input.attackAuto;
    this.input.weaponSwitch = input.weaponSwitch;

    if (input.weaponSwitch !== undefined) {
      this.cycleWeapon(input.weaponSwitch);
    }
  }

  cycleWeapon(next?: WeaponType): WeaponType {
    if (next !== undefined) {
      this.state.weapon = next;
    } else {
      this.state.weapon = ((this.state.weapon + 1) % 3) as WeaponType;
    }
    return this.state.weapon;
  }

  spawnAt(s: number, x: number, speed: number): void {
    const st = this.state;
    st.s = Math.max(0, s);
    st.x = clamp(x, -ROAD_HALF_WIDTH + 1.0, ROAD_HALF_WIDTH - 1.0);
    st.y = 0;
    st.speed = Math.max(0, speed);
    st.vx = 0;
    st.lean = 0;
    st.hp = 100;
    st.crashed = false;
    st.crashTimer = 0;
    st.invulnTimer = SPAWN_INVULN;
    st.attackSide = 0;
    st.attackPhase = 0;
    st.nitroActive = false;
    st.wheelie = 0;
    st.wheelieCharge = 0;
    st.spinOutTimer = 0;
    st.braking = false;
    st.freeRoam = false;
    st.heading = 0;
    st.onFoot = false;
    st.worldX = undefined;
    st.worldY = undefined;
    st.worldS = undefined;

    this.vy = 0;
    this.hopCooldown = 0;
    this.wheelieHoldTime = 0;
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.pendingSwingSide = 0;
    this.boostPadTimer = 0;
    this.lastBoostSlot = -999;
    this.freeRejoinCooldown = 0;
    this.blockHitCooldown = 0;
    this.blockSlowFeedbackTimer = 0;
    this.blockBoostFeedbackTimer = 0;
    this.slowBlockTimer = 0;
    this.asphaltBoostTimer = 0;
    this.voxelSupportY = 0;
    this.hitIdsThisSwing.clear();
  }

  getWorldPose(): { wx: number; wy: number; ws: number; yaw: number } {
    const st = this.state;
    if (st.freeRoam || st.onFoot) {
      return { wx: this.freeWx, wy: this.freeWy, ws: this.freeWs, yaw: this.freeYaw };
    }
    const abs = roadToWorldAbs(st.s, st.x, st.y, this._tmpAbs);
    const yaw = roadForwardYaw(st.s);
    return { wx: abs.wx, wy: abs.wy, ws: abs.ws, yaw };
  }

  parkForDismount(): { wx: number; wy: number; ws: number; yaw: number } {
    const st = this.state;
    const pose = this.getWorldPose();
    this.freeWx = pose.wx;
    this.freeWy = Math.max(openWorldGroundY(pose.wx, pose.ws), pose.wy);
    this.freeWs = pose.ws;
    this.freeYaw = pose.yaw;

    st.onFoot = true;
    st.freeRoam = true;
    st.speed = 0;
    st.vx = 0;
    st.lean = 0.18; // parked kickstand lean
    st.nitroActive = false;
    st.braking = false;
    st.wheelie = 0;
    st.wheelieCharge = 0;
    st.attackSide = 0;
    st.attackPhase = 0;
    st.crashed = false;
    st.heading = this.freeYaw;
    st.worldX = this.freeWx;
    st.worldY = this.freeWy;
    st.worldS = this.freeWs;
    st.s = this.freeWs;
    st.x = this.freeWx - roadX(this.freeWs);
    st.y = Math.max(0, this.freeWy - openWorldGroundY(this.freeWx, this.freeWs));
    this.vy = 0;
    return { wx: this.freeWx, wy: this.freeWy, ws: this.freeWs, yaw: this.freeYaw };
  }

  remountAt(wx: number, wy: number, ws: number, yaw: number): void {
    const st = this.state;
    this.freeWx = wx;
    this.freeWy = wy;
    this.freeWs = ws;
    this.freeYaw = yaw;
    this.freeRejoinCooldown = 0.35;

    st.onFoot = false;
    st.freeRoam = true;
    st.speed = 0;
    st.vx = 0;
    st.lean = 0;
    st.crashed = false;
    st.heading = yaw;
    st.worldX = wx;
    st.worldY = wy;
    st.worldS = ws;
    st.s = ws;
    st.x = wx - roadX(ws);
    st.y = Math.max(0, wy - openWorldGroundY(wx, ws));
    this.vy = 0;
  }

  returnToTrack(): void {
    const st = this.state;
    const targetS = Math.max(0, st.freeRoam ? this.freeWs : st.s);
    this.spawnAt(targetS, 1.9, 18);
  }

  teleportToWorld(wx: number, ws: number, voxels?: VoxelWorld): void {
    if (!Number.isFinite(wx) || !Number.isFinite(ws)) return;
    const st = this.state;
    const targetWs = ws < 0 ? wrapTrackS(ws) : ws;
    const groundY = openWorldGroundY(wx, targetWs);
    let safeY = groundY;
    if (voxels) {
      safeY = Math.max(
        groundY,
        voxels.getSupportHeight(wx, targetWs, 0.48, 0.88, groundY + 64)
      );
      let guard = 0;
      while (guard < 32 && voxels.overlapsBox(wx, safeY + 0.08, targetWs, 0.45, 1.4, 0.45)) {
        safeY += 1.0;
        guard++;
      }
    }

    const lat = wx - roadX(targetWs);
    const roadBase = roadY(targetWs);
    const onRoad =
      Math.abs(lat) <= ROAD_HALF_WIDTH - 0.5 && Math.abs(safeY - roadBase) < 1.5;
    const yaw = roadForwardYaw(targetWs);

    // Clear crash, combat & velocity state cleanly
    st.crashed = false;
    st.crashTimer = 0;
    st.hp = Math.max(st.hp, 100);
    st.invulnTimer = Math.max(st.invulnTimer, SPAWN_INVULN);
    st.vx = 0;
    st.lean = 0;
    st.braking = false;
    st.nitroActive = false;
    st.wheelie = 0;
    st.wheelieCharge = 0;
    st.spinOutTimer = 0;
    st.attackSide = 0;
    st.attackPhase = 0;
    st.onFoot = false;

    this.vy = 0;
    this.hopCooldown = 0;
    this.wheelieHoldTime = 0;
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.pendingSwingSide = 0;
    this.boostPadTimer = 0;
    this.blockHitCooldown = 0;
    this.slowBlockTimer = 0;
    this.asphaltBoostTimer = 0;
    this.voxelSupportY = 0;
    this.hitIdsThisSwing.clear();

    this.freeWx = wx;
    this.freeWy = safeY;
    this.freeWs = targetWs;
    this.freeYaw = yaw;
    this.freeRejoinCooldown = 0.6;

    st.worldX = wx;
    st.worldY = safeY;
    st.worldS = targetWs;
    st.s = targetWs;

    if (onRoad) {
      st.freeRoam = false;
      st.heading = 0;
      st.x = clamp(lat, -ROAD_HALF_WIDTH + 0.8, ROAD_HALF_WIDTH - 0.8);
      st.y = Math.max(0, safeY - roadBase);
      st.speed = 14;
    } else {
      st.freeRoam = true;
      st.heading = yaw;
      st.x = lat;
      st.y = Math.max(0, safeY - groundY);
      st.speed = 0;
    }
  }

  private enterFreeRoam(cb: PlayerCallbacks): void {
    const st = this.state;
    const abs = roadToWorldAbs(st.s, st.x, st.y, this._tmpAbs);
    const roadYaw = roadForwardYaw(st.s);
    const slipYaw = Math.atan2(-st.vx, Math.max(10, st.speed));
    this.freeWx = abs.wx;
    this.freeWy = abs.wy;
    this.freeWs = abs.ws;
    this.freeYaw = roadYaw + clamp(slipYaw, -0.75, 0.75);
    this.freeRejoinCooldown = 0.85;

    st.freeRoam = true;
    st.heading = this.freeYaw;
    st.worldX = this.freeWx;
    st.worldY = this.freeWy;
    st.worldS = this.freeWs;
    st.s = this.freeWs;
    st.x = this.freeWx - roadX(this.freeWs);
    st.y = Math.max(0, this.freeWy - openWorldGroundY(this.freeWx, this.freeWs));
    cb.onLeaveTrack?.();
  }

  activateTurboShield(duration = 3.5): void {
    this.state.nitro = 100;
    this.state.turboShieldTimer = Math.max(this.state.turboShieldTimer, duration);
    this.state.spinOutTimer = 0;
  }

  activateMagnet(duration = 5.0): void {
    this.state.magnetTimer = Math.max(this.state.magnetTimer, duration);
  }

  applySpinOut(duration = 1.3, dmg = 22): boolean {
    const st = this.state;
    if (st.onFoot || st.crashed || st.invulnTimer > 0 || st.turboShieldTimer > 0) return false;
    st.spinOutTimer = Math.max(st.spinOutTimer, duration);
    st.wheelieCharge = 0;
    st.wheelie = 0;
    st.speed = Math.max(10, st.speed * 0.62);
    st.hp = Math.max(0, st.hp - dmg);
    if (st.hp <= 0) {
      this.startCrash(st.vx >= 0 ? 8 : -8);
      return true;
    }
    return false;
  }

  applyPoliceDrag(dt: number, shoveX: number): void {
    const st = this.state;
    if (st.crashed || st.turboShieldTimer > 0) return;
    st.speed = Math.max(11, st.speed * Math.exp(-1.55 * dt));
    st.vx = clamp(st.vx + shoveX * dt, -16, 16);
  }

  triggerAttack(side: 0 | 1 | 2, targets: RiderRenderState[]): void {
    const st = this.state;
    if (st.crashed || st.attackSide !== 0 || this.attackCooldown > 0) return;

    const spec = WEAPONS[st.weapon];
    let chosenSide: 1 | 2;

    if (side === 1 || side === 2) {
      chosenSide = side;
    } else {
      // Auto-pick nearest live target on left or right within reach
      let bestDistSq = Infinity;
      let bestSide: 0 | 1 | 2 = 0;
      const maxLat = spec.reach + 1.4;

      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.id === st.id || t.crashed) continue;
        const ds = signedTrackDelta(t.s, st.s);
        if (ds < -4.2 || ds > 4.2) continue;
        const dx = t.x - st.x;
        const absDx = Math.abs(dx);
        if (absDx > maxLat) continue;
        const d2 = ds * ds + dx * dx;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestSide = dx < 0 ? 1 : 2;
        }
      }

      if (bestSide !== 0) {
        chosenSide = bestSide;
      } else {
        chosenSide = this.lastAutoSide === 1 ? 2 : 1;
      }
      this.lastAutoSide = chosenSide;
    }

    st.attackSide = chosenSide;
    st.attackPhase = 0;
    this.attackTimer = 0;
    this.attackCooldown = spec.cooldown;
    this.hitIdsThisSwing.clear();
    this.pendingSwingSide = chosenSide;
  }

  applyExternalHit(dmg: number, knockX: number, forceKo: boolean): boolean {
    const st = this.state;
    if (st.onFoot || st.crashed || st.invulnTimer > 0 || st.turboShieldTimer > 0) return false;

    st.hp = Math.max(0, st.hp - dmg);
    st.vx = clamp(st.vx + knockX, -24, 24);
    st.speed = Math.max(10, st.speed * 0.9);

    if (forceKo || st.hp <= 0) {
      this.startCrash(knockX);
      return true;
    }
    return false;
  }

  private startCrash(knockX: number): void {
    const st = this.state;
    st.crashed = true;
    st.crashTimer = 0;
    st.hp = 0;
    st.nitroActive = false;
    st.wheelie = 0;
    st.wheelieCharge = 0;
    st.spinOutTimer = 0;
    st.braking = false;
    st.attackSide = 0;
    st.attackPhase = 0;
    st.vx = clamp(knockX !== 0 ? knockX : st.vx >= 0 ? 6.5 : -6.5, -18, 18);
    this.vy = 0;
    this.wheelieHoldTime = 0;
    this.attackTimer = 0;
    this.pendingSwingSide = 0;
    this.boostPadTimer = 0;
    this.slowBlockTimer = 0;
    this.asphaltBoostTimer = 0;
    this.voxelSupportY = 0;
    this.hitIdsThisSwing.clear();
  }

  update(
    dt: number,
    targets: RiderRenderState[],
    traffic: TrafficCar[],
    cb: PlayerCallbacks,
    fallenCargo?: readonly FallenCargo[],
    weatherMod?: WeatherPhysicsMod,
    voxels?: VoxelWorld
  ): void {
    const step = dt > 0.05 ? 0.05 : dt < 0.0001 ? 0.0001 : dt;
    const st = this.state;
    const inp = this.input;

    if (st.onFoot) {
      return;
    }

    if (st.freeRoam) {
      this.updateFreeRoam(step, cb, weatherMod, voxels);
      return;
    }

    if (st.invulnTimer > 0) {
      st.invulnTimer = Math.max(0, st.invulnTimer - step);
    }
    if (st.magnetTimer > 0) {
      st.magnetTimer = Math.max(0, st.magnetTimer - step);
    }
    if (st.turboShieldTimer > 0) {
      st.turboShieldTimer = Math.max(0, st.turboShieldTimer - step);
      st.nitro = 100;
    }
    if (st.spinOutTimer > 0) {
      st.spinOutTimer = Math.max(0, st.spinOutTimer - step);
    }
    if (this.attackCooldown > 0) {
      this.attackCooldown = Math.max(0, this.attackCooldown - step);
    }
    if (this.hopCooldown > 0) {
      this.hopCooldown = Math.max(0, this.hopCooldown - step);
    }
    if (this.boostPadTimer > 0) {
      this.boostPadTimer = Math.max(0, this.boostPadTimer - step);
    }
    if (this.railSparkTimer > 0) {
      this.railSparkTimer = Math.max(0, this.railSparkTimer - step);
    }
    if (this.blockHitCooldown > 0) {
      this.blockHitCooldown = Math.max(0, this.blockHitCooldown - step);
    }
    if (this.blockSlowFeedbackTimer > 0) {
      this.blockSlowFeedbackTimer = Math.max(0, this.blockSlowFeedbackTimer - step);
    }
    if (this.blockBoostFeedbackTimer > 0) {
      this.blockBoostFeedbackTimer = Math.max(0, this.blockBoostFeedbackTimer - step);
    }
    if (this.slowBlockTimer > 0) {
      this.slowBlockTimer = Math.max(0, this.slowBlockTimer - step);
    }
    if (this.asphaltBoostTimer > 0) {
      this.asphaltBoostTimer = Math.max(0, this.asphaltBoostTimer - step);
    }

    sampleRoadFrame(st.s, this._frame);

    // Handle wipeout tumble & auto-remount
    if (st.crashed) {
      st.crashTimer += step;
      st.speed = Math.max(0, st.speed - 28.0 * step);
      st.vx *= Math.exp(-3.2 * step);
      st.s += (st.speed / this._frame.tangentLen) * step;
      st.x += st.vx * step;
      st.y = Math.max(0, st.y - 8.0 * step);

      if (Math.abs(st.x) > MAX_LATERAL) {
        st.x = Math.sign(st.x) * MAX_LATERAL;
        st.vx *= -0.45;
      }

      this.particleTimer += step;
      if (st.speed > 6 && this.particleTimer >= 0.06) {
        this.particleTimer = 0;
        cb.onParticles('spark', st.s, st.x, 0.25, st.speed * 0.35);
      }

      if (st.crashTimer >= WIPEOUT_DURATION) {
        st.crashed = false;
        st.crashTimer = 0;
        st.hp = 100;
        st.invulnTimer = REMOUNT_INVULN;
        st.y = 0;
        st.vx = 0;
        st.lean = 0;
        st.speed = Math.max(16, st.speed);
        st.x = clamp(st.x, -ROAD_HALF_WIDTH + 1.2, ROAD_HALF_WIDTH - 1.2);
        this.vy = 0;
      }
      return;
    }

    // Trigger attacks from held/tapped inputs
    if (st.attackSide === 0 && this.attackCooldown <= 0) {
      if (inp.attackLeft) {
        this.triggerAttack(1, targets);
      } else if (inp.attackRight) {
        this.triggerAttack(2, targets);
      } else if (inp.attackAuto) {
        this.triggerAttack(0, targets);
      }
    }

    if (this.pendingSwingSide !== 0) {
      const swingSide = this.pendingSwingSide;
      this.pendingSwingSide = 0;
      cb.onAttackSwing(swingSide, st.weapon);
    }

    // Nitro logic with anti-sputter lock
    if (st.nitro <= 0.1) {
      this.nitroDepleted = true;
    } else if (st.nitro >= 8) {
      this.nitroDepleted = false;
    }

    const wantsNitro = inp.nitro && !inp.brake && !this.nitroDepleted && st.nitro > 0.5;
    st.nitroActive = wantsNitro;
    if (st.nitroActive) {
      st.nitro = Math.max(0, st.nitro - 24.0 * step);
    } else if (st.speed > 26) {
      st.nitro = Math.min(100, st.nitro + 2.2 * step);
    }

    // Wheelie charge boost + charge-slam + over-wheelie flip + short-tap hop (Space)
    const wheeliePressed = inp.wheelie && st.spinOutTimer <= 0;
    const grounded = st.y <= this.voxelSupportY + 0.05 && this.vy <= 0;

    if (wheeliePressed && grounded && !inp.brake && st.speed > 7.5) {
      this.wheelieHoldTime += step;
      st.wheelieCharge = Math.min(1.0, st.wheelieCharge + WHEELIE_CHARGE_RATE * step);
      if (st.turboShieldTimer > 0 && st.wheelieCharge > 0.94) {
        st.wheelieCharge = 0.94;
      }
      st.wheelie += (Math.max(0.45, st.wheelieCharge) - st.wheelie) * Math.min(1, step * 12);

      // Over-wheelie flip crash if held past 100%!
      if (st.wheelieCharge >= 1.0) {
        this.prevWheelieKey = false;
        this.startCrash(st.vx >= 0 ? 5.5 : -5.5);
        cb.onWheelieFlip?.();
        cb.onCrash();
        cb.onParticles('crash', st.s, st.x, 0.85, st.speed * 0.32);
        return;
      }
    } else if (!wheeliePressed && this.prevWheelieKey) {
      if (this.wheelieHoldTime < 0.2 && grounded && this.hopCooldown <= 0 && st.spinOutTimer <= 0) {
        // Short tap Space (< 0.2s) -> crisp hop to dodge bananas/traps/snipers!
        this.vy = HOP_VELOCITY;
        st.y = 0.01;
        st.speed = Math.min(TOP_SPEED_TURBO_SHIELD, st.speed + 2.2);
        st.wheelieCharge = 0;
      } else if (st.wheelieCharge >= 0.32 && grounded) {
        // Charge-Slam Attack! Slam front wheel down violently
        const charge = st.wheelieCharge;
        st.wheelieCharge = 0;
        st.wheelie = 0;
        this.hopCooldown = 0.2;

        cb.onParticles('spark', st.s + 1.0, st.x - 1.2, 0.2, st.speed * 0.45);
        cb.onParticles('spark', st.s + 1.0, st.x + 1.2, 0.2, st.speed * 0.45);

        let slamHits = 0;
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          if (t.id === st.id || t.crashed || t.invulnTimer > 0) continue;
          const ds = signedTrackDelta(t.s, st.s);
          if (ds < -2.2 || ds > 4.4) continue;
          if (Math.abs(t.x - st.x) >= 2.9) continue;

          const dmg = Math.round(28 + charge * 34);
          const knockDir = t.x >= st.x ? 1 : -1;
          const knockX = knockDir * (12.0 + charge * 8.0);
          const ko = charge > 0.78 || t.hp - dmg <= 0;
          if (ko) {
            st.kos += 1;
            st.nitro = Math.min(100, st.nitro + 32);
          } else {
            st.nitro = Math.min(100, st.nitro + 12);
          }
          slamHits++;
          cb.onWheelieSlamHit?.(t, dmg, knockX, ko, charge);
          cb.onParticles('spark', t.s, t.x, 0.85, st.speed * 0.45);
        }
        cb.onWheelieSlam?.(charge, slamHits);
      } else {
        st.wheelieCharge = 0;
      }
      this.wheelieHoldTime = 0;
    } else if (!wheeliePressed) {
      this.wheelieHoldTime = 0;
      st.wheelieCharge = Math.max(0, st.wheelieCharge - step * 3.5);
    }
    this.prevWheelieKey = wheeliePressed;

    if (st.y > 0 || this.vy > 0) {
      st.y += this.vy * step;
      this.vy -= GRAVITY * step;
      if (st.y <= 0) {
        st.y = 0;
        this.vy = 0;
        this.hopCooldown = 0.18;
        if (st.speed > 20) {
          cb.onParticles('dust', st.s - 0.5, st.x, 0.12, st.speed * 0.25);
        }
      }
      const airAboveSupport = Math.max(0, st.y - this.voxelSupportY);
      if (airAboveSupport > 0.12 || this.vy > 0) {
        const airPitch = this.vy > 0 ? 1.0 : clamp(airAboveSupport / 1.1, 0.15, 0.85);
        st.wheelie += (airPitch - st.wheelie) * Math.min(1, step * 14);
      } else if (!wheeliePressed) {
        st.wheelie += (0 - st.wheelie) * Math.min(1, step * 12);
      }
    } else if (!wheeliePressed) {
      st.wheelie += (0 - st.wheelie) * Math.min(1, step * 12);
    }

    // Longitudinal acceleration / braking / off-road drag / wheelie boost / turbo shield
    const onShoulder = Math.abs(st.x) > ROAD_HALF_WIDTH && st.y < 0.2;
    const wheelieBoosting = st.wheelieCharge > 0.12 && !onShoulder;
    const wheelieBonus = wheelieBoosting ? WHEELIE_SPEED_BONUS : 0;
    let topSpeed = TOP_SPEED_NORMAL + wheelieBonus;
    if (st.turboShieldTimer > 0) {
      topSpeed = TOP_SPEED_TURBO_SHIELD;
    } else if (this.boostPadTimer > 0) {
      topSpeed = TOP_SPEED_BOOST + wheelieBonus * 0.5;
    } else if (st.nitroActive) {
      topSpeed = TOP_SPEED_NITRO + wheelieBonus * 0.5;
    } else if (onShoulder) {
      topSpeed = TOP_SPEED_OFFROAD;
    }
    if (this.asphaltBoostTimer > 0) {
      topSpeed *= 1.12;
    }
    if (this.slowBlockTimer > 0 && st.turboShieldTimer <= 0) {
      topSpeed = Math.min(topSpeed, 26.0);
    }
    if (st.spinOutTimer > 0) {
      topSpeed = Math.min(topSpeed, 22.0);
    }

    st.braking = inp.brake && st.speed > 0.5;

    const weatherGrip = weatherMod ? weatherMod.grip : 1.0;
    const weatherBrake = weatherMod ? weatherMod.brakeMul : 1.0;
    const weatherWindX = weatherMod ? weatherMod.windX : 0;

    if (st.spinOutTimer > 0) {
      st.speed = Math.max(10, st.speed - 22.0 * step);
    } else if (inp.brake) {
      st.speed = Math.max(0, st.speed - 44.0 * weatherBrake * step);
    } else if (inp.throttle || st.nitroActive || this.boostPadTimer > 0 || st.turboShieldTimer > 0) {
      const speedRatio = clamp(st.speed / topSpeed, 0, 1.2);
      let accel = 28.0 * (1.08 - 0.68 * Math.min(1, speedRatio));
      if (wheelieBoosting) accel *= 1.18;
      if (st.nitroActive) accel += 20.0;
      if (this.boostPadTimer > 0) accel += 26.0;
      if (st.turboShieldTimer > 0) accel += 36.0;
      if (onShoulder && !st.nitroActive && st.turboShieldTimer <= 0) accel *= 0.55;

      if (st.speed < topSpeed) {
        st.speed = Math.min(topSpeed, st.speed + accel * step);
      } else {
        const decay = onShoulder ? 22.0 : 9.5;
        st.speed = Math.max(topSpeed, st.speed - decay * step);
      }
    } else {
      const coastDrag = onShoulder ? 16.0 : st.speed > 18 ? 6.5 : 2.8;
      st.speed = Math.max(0, st.speed - coastDrag * step);
    }

    // Steering (digital keys take priority, else smooth analog gyro steer), corner drift & bike lean
    const digitalSteer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const steer = digitalSteer !== 0 ? digitalSteer : clamp(inp.analogSteer ?? 0, -1, 1);
    const speedAuthority = clamp(st.speed / 12.0, 0, 1);
    const airFactor = st.y > 0.15 ? 0.48 : 1.0;
    const spinFactor = st.spinOutTimer > 0 ? 0.35 : 1.0;
    const asphaltGrip = this.asphaltBoostTimer > 0 ? 1.12 : 1.0;
    const steerGrip = (0.85 + 0.15 * weatherGrip) * asphaltGrip;
    const steerAccel = steer * 45.0 * steerGrip * (0.45 + 0.72 * speedAuthority) * airFactor * spinFactor;
    const spinWobble = st.spinOutTimer > 0 ? Math.sin(st.spinOutTimer * 22) * 14.0 : 0;

    // Positive curvature => road bends right => centrifugal force pushes left (-x)
    const centrifugal = -this._frame.curvature * st.speed * st.speed * 0.46;
    const crosswind = weatherWindX * speedAuthority * (st.turboShieldTimer > 0 ? 0.25 : 1.0);

    st.vx += (steerAccel + centrifugal + spinWobble + crosswind) * step;
    const latDamp = (Math.abs(steer) > 0.05 ? 5.6 : 8.8) * weatherGrip * asphaltGrip;
    st.vx *= Math.exp(-latDamp * step);

    // Keep stopped bike from drifting sideways
    if (st.speed < 0.8 && Math.abs(steer) <= 0.05) {
      st.vx *= Math.exp(-12.0 * step);
    }

    const targetLean =
      clamp(steer * 0.48 + (st.vx / 15.0) * 0.12, -0.55, 0.55) *
      clamp(st.speed / 9.0, 0, 1);
    st.lean += (targetLean - st.lean) * Math.min(1, step * 11.0);

    // Integrate road coordinates (save prevS/prevX for strict zero-clipping collision push-out)
    const prevS = st.s;
    const prevX = st.x;
    st.s += (st.speed / this._frame.tangentLen) * step;
    st.x += st.vx * step;
    st.wheelAngle = (st.wheelAngle + (st.speed / WHEEL_RADIUS) * step) % (Math.PI * 2);

    // Check voxel blocks built directly on the highway (asphalt ramps, slowing grass/leaves, solid walls!)
    if (voxels && voxels.getBlockCount() > 0) {
      if (this.handleHighwayVoxels(step, prevS, prevX, cb, voxels)) {
        return;
      }
    } else {
      this.voxelSupportY = 0;
    }

    // Check roadside static obstacles (shoulder posts, nearby trees/rocks/buildings if riding near/off shoulder)
    if (Math.abs(st.x) > ROAD_HALF_WIDTH - 0.6 || Math.abs(prevX) > ROAD_HALF_WIDTH - 0.6) {
      if (this.handleHighwayStaticObstacles(prevS, prevX, cb)) {
        return;
      }
    }

    // Leave track seamlessly into 360° Open-World Free-Roam when riding past the shoulder!
    if (Math.abs(st.x) > SHOULDER_HALF_WIDTH) {
      this.enterFreeRoam(cb);
      return;
    }

    // Boost pads
    const padSlot = Math.floor(st.s / 24);
    const pad = getBoostPadInSlot(padSlot);
    if (
      pad !== null &&
      padSlot !== this.lastBoostSlot &&
      Math.abs(st.s - pad.s) < 3.9 &&
      Math.abs(st.x - pad.x) < 1.85 &&
      st.y < 0.85
    ) {
      this.lastBoostSlot = padSlot;
      this.boostPadTimer = 0.85;
      st.speed = Math.min(TOP_SPEED_BOOST, Math.max(st.speed + 16.0, 62.0));
      st.nitro = Math.min(100, st.nitro + 28);
      cb.onBoostPad();
      cb.onParticles('nitro', st.s, st.x, 0.3, st.speed * 0.5);
    }

    // Traffic collisions & near-miss nitro refill (cyclic across 2400m seam, including long cargo trucks!)
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const isTruck = car.type === 4;
      const maxCheckDs = isTruck ? 6.2 : 4.2;
      const ds = signedTrackDelta(car.s, st.s);
      if (ds < -maxCheckDs || ds > maxCheckDs) continue;

      const carX = car.x + car.bumpOffset;
      const dx = st.x - carX;
      const absDs = Math.abs(ds);
      const absDx = Math.abs(dx);

      const hitLen = isTruck ? 4.9 : 2.85;
      const hitWid = isTruck ? 1.95 : 1.42;
      const clearY = isTruck ? 2.8 : 1.12;

      if (absDs < hitLen && absDx < hitWid) {
        if (st.y > clearY) {
          // Hopped cleanly over the car!
          if (!car.nearMissed) {
            car.nearMissed = true;
            st.nitro = Math.min(100, st.nitro + 14);
            cb.onNearMiss();
            cb.onParticles('spark', st.s, st.x, st.y, st.speed * 0.4);
          }
          continue;
        }

        const relSpeed = st.speed - car.speed;
        const pushDir = dx >= 0 ? 1 : -1;

        // Turbo overdrive shield blasts traffic aside without slowing or crashing!
        if (st.turboShieldTimer > 0) {
          car.bumpVel += -pushDir * (isTruck ? 5.5 : 8.5);
          st.x = clamp(carX + pushDir * (hitWid + 0.12), -MAX_LATERAL, MAX_LATERAL);
          cb.onParticles('spark', st.s, (st.x + carX) * 0.5, 0.6, st.speed * 0.5);
          continue;
        }

        // Hard rear-end slam => wipeout!
        if (
          st.invulnTimer <= 0 &&
          ds > (isTruck ? 1.2 : 0.7) &&
          absDx < (isTruck ? 1.45 : 1.02) &&
          relSpeed > (isTruck ? 15.0 : 18.0)
        ) {
          car.bumpVel += -pushDir * (isTruck ? 2.0 : 3.2);
          this.startCrash(pushDir * 7.5);
          cb.onCrash();
          cb.onParticles('crash', st.s, st.x, 0.75, st.speed * 0.35);
          return;
        }

        // Side-swipe or low-delta shove
        st.x = clamp(carX + pushDir * (hitWid + 0.12), -MAX_LATERAL, MAX_LATERAL);
        st.vx = pushDir * Math.max(6.5, Math.abs(st.vx) + 4.2);
        st.speed = Math.max(car.speed * 0.85, st.speed * 0.84);
        car.bumpVel += -pushDir * (isTruck ? 1.6 : 2.8);
        cb.onParticles('spark', st.s, (st.x + carX) * 0.5, 0.55, st.speed * 0.4);

        if (st.invulnTimer <= 0 && relSpeed > 12.0) {
          st.hp = Math.max(0, st.hp - (isTruck ? 16 : 12));
          if (st.hp <= 0) {
            this.startCrash(pushDir * 7.0);
            cb.onCrash();
            cb.onParticles('crash', st.s, st.x, 0.75, st.speed * 0.35);
            return;
          }
        }
        continue;
      }

      // Near-miss bonus: passing traffic within close clearance at >35 m/s
      const nearMaxX = isTruck ? 2.85 : 2.35;
      if (
        !car.nearMissed &&
        st.speed > 35.0 &&
        ds < (isTruck ? 2.8 : 1.4) &&
        ds > -(isTruck ? 4.4 : 2.6) &&
        absDx >= hitWid - 0.04 &&
        absDx <= nearMaxX
      ) {
        car.nearMissed = true;
        st.nitro = Math.min(100, st.nitro + 14);
        cb.onNearMiss();
        cb.onParticles('nitro', st.s, st.x, 0.4, st.speed * 0.4);
      }
    }

    // Scattered fallen truck cargo debris (dodgeable or jumpable with Space!)
    if (fallenCargo) {
      for (let i = 0; i < fallenCargo.length; i++) {
        const box = fallenCargo[i];
        if (!box.active || box.y > 1.2) continue;
        if (Math.abs(signedTrackDelta(box.s, st.s)) < 1.25 && Math.abs(box.x - st.x) < 1.05) {
          if (st.y > 0.65) {
            st.nitro = Math.min(100, st.nitro + 4);
            continue;
          }
          const pushDir = st.x >= box.x ? 1 : -1;
          box.active = false;
          cb.onParticles('spark', box.s, box.x, 0.5, st.speed * 0.4);
          if (st.turboShieldTimer <= 0 && st.invulnTimer <= 0) {
            st.vx = clamp(st.vx + pushDir * 7.5, -20, 20);
            st.speed = Math.max(12, st.speed * 0.8);
            st.hp = Math.max(0, st.hp - 14);
            if (st.hp <= 0) {
              this.startCrash(pushDir * 7.0);
              cb.onCrash();
              cb.onParticles('crash', st.s, st.x, 0.7, st.speed * 0.35);
              return;
            }
          }
        }
      }
    }

    // Soft bike-to-bike body separation (cyclic across laps!)
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (t.id === st.id || t.crashed) continue;
      if (Math.abs(signedTrackDelta(t.s, st.s)) < 2.0 && Math.abs(st.y - t.y) < 0.9) {
        const dx = st.x - t.x;
        const absDx = Math.abs(dx);
        if (absDx < 0.92) {
          const push = dx >= 0 ? 1 : -1;
          st.vx += push * 20.0 * step;
          st.x = clamp(st.x + push * (0.92 - absDx) * 0.35, -MAX_LATERAL, MAX_LATERAL);
        }
      }
    }

    // Active melee attack progression & hit detection (cyclic across laps!)
    if (st.attackSide !== 0) {
      const spec = WEAPONS[st.weapon];
      this.attackTimer += step;
      st.attackPhase = Math.min(1, this.attackTimer / spec.duration);

      if (st.attackPhase >= 0.3 && st.attackPhase <= 0.68) {
        const side = st.attackSide;
        const knockDir = side === 1 ? -1 : 1;

        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          if (t.id === st.id || t.crashed || t.invulnTimer > 0) continue;
          if (this.hitIdsThisSwing.has(t.id)) continue;

          const ds = signedTrackDelta(t.s, st.s);
          if (Math.abs(ds) >= 3.5) continue;
          if (Math.abs(t.y - st.y) > 1.5) continue;

          const signedDx = t.x - st.x;
          const sideDist = side === 1 ? -signedDx : signedDx;
          if (sideDist < 0.45 || sideDist > spec.reach) continue;

          this.hitIdsThisSwing.add(t.id);
          const dmg = spec.damage;
          const knockX = knockDir * spec.knockback;
          const ko = t.hp - dmg <= 0;

          if (ko) {
            st.kos += 1;
            st.nitro = Math.min(100, st.nitro + 32);
          } else {
            st.nitro = Math.min(100, st.nitro + 6);
          }

          // Tactile attacker recoil
          st.vx = clamp(st.vx - knockDir * 1.8, -22, 22);

          cb.onHitLanded(t, dmg, side, st.weapon, knockX, ko);
          cb.onParticles(
            'spark',
            st.s + ds * 0.5,
            (st.x + t.x) * 0.5,
            1.0 + st.y * 0.5,
            st.speed * 0.5
          );
        }
      }

      if (this.attackTimer >= spec.duration) {
        st.attackSide = 0;
        st.attackPhase = 0;
        this.attackTimer = 0;
      }
    }

    // Periodic exhaust / shoulder dust / brake smoke / over-wheelie danger sparks
    this.particleTimer += step;
    if (this.particleTimer >= 0.045) {
      if (st.wheelieCharge > 0.72) {
        this.particleTimer = 0;
        cb.onParticles('spark', st.s - 0.9, st.x, 0.16, st.speed * 0.35);
      } else if (st.spinOutTimer > 0) {
        this.particleTimer = 0;
        cb.onParticles('smoke', st.s - 0.6, st.x, 0.16, st.speed * 0.2);
      } else if (st.nitroActive || this.boostPadTimer > 0 || st.turboShieldTimer > 0) {
        this.particleTimer = 0;
        cb.onParticles('nitro', st.s - 1.15, st.x, st.y + 0.45, st.speed * 0.25);
      } else if (onShoulder && st.speed > 12) {
        this.particleTimer = 0;
        cb.onParticles('dust', st.s - 0.8, st.x, 0.12, st.speed * 0.2);
      } else if (st.braking && st.speed > 16 && st.y < 0.1) {
        this.particleTimer = 0;
        cb.onParticles('smoke', st.s - 0.9, st.x, 0.12, st.speed * 0.15);
      } else if (weatherMod && weatherMod.sprayKind !== 'none' && st.speed > 18 && st.y < 0.1) {
        this.particleTimer = 0;
        cb.onParticles(weatherMod.sprayKind, st.s - 1.05, st.x, 0.14, st.speed * 0.3);
      }
    }
  }

  /**
   * Checks whether the bike AABB overlaps any solid voxel block (`2,3,4,5,7,8,10`)
   * that rises above `wy + 0.22` (i.e. not cleanly riding on top of it).
   */
  private overlapsBlockingSolidVoxel(
    voxels: VoxelWorld,
    wx: number,
    wy: number,
    ws: number,
    halfX: number,
    height: number,
    halfS: number
  ): boolean {
    const minX = Math.floor(wx - halfX + 0.002);
    const maxX = Math.floor(wx + halfX - 0.002);
    const minS = Math.floor(ws - halfS + 0.002);
    const maxS = Math.floor(ws + halfS - 0.002);
    const minY = Math.floor(wy + 0.12);
    const maxY = Math.floor(wy + height - 0.002);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gs = minS; gs <= maxS; gs++) {
        for (let gy = minY; gy <= maxY; gy++) {
          const bt = voxels.getBlock(gx, gy, gs);
          if (bt === null || !isSolidVoxel(bt)) continue;
          const topY = gy + 1;
          if (topY > wy + 0.22 && gy < wy + height) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Finds the block type of any voxel overlapping the given AABB (for collision feedback).
   */
  private findOverlappingVoxelType(
    voxels: VoxelWorld,
    wx: number,
    wy: number,
    ws: number,
    halfX: number,
    height: number,
    halfS: number
  ): BlockType | null {
    const minX = Math.floor(wx - halfX + 0.001);
    const maxX = Math.floor(wx + halfX - 0.001);
    const minY = Math.floor(wy + 0.001);
    const maxY = Math.floor(wy + height - 0.001);
    const minS = Math.floor(ws - halfS + 0.001);
    const maxS = Math.floor(ws + halfS - 0.001);

    let bestType: BlockType | null = null;
    let bestDistSq = Infinity;
    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gs = minS; gs <= maxS; gs++) {
          const bt = voxels.getBlock(gx, gy, gs);
          if (bt === null) continue;
          const d2 = (wx - (gx + 0.5)) ** 2 + signedTrackDelta(ws, gs + 0.5) ** 2;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestType = bt;
          }
        }
      }
    }
    return bestType;
  }

  /**
   * Returns a climbable step-up Y if an asphalt ramp (or low <= 0.25m ledge) sits at (wx, ws)
   * and the space above it is clear for the bike.
   */
  private findFreeRoamStepUpY(
    voxels: VoxelWorld,
    wx: number,
    ws: number,
    curWy: number
  ): number {
    const minX = Math.floor(wx - 0.55 + 0.002);
    const maxX = Math.floor(wx + 0.55 - 0.002);
    const minS = Math.floor(ws - 0.55 + 0.002);
    const maxS = Math.floor(ws + 0.55 - 0.002);
    const minY = Math.floor(curWy - 0.2);
    const maxY = Math.floor(curWy + 1.15);

    let bestTop = curWy;
    for (let gx = minX; gx <= maxX; gx++) {
      for (let gs = minS; gs <= maxS; gs++) {
        for (let gy = minY; gy <= maxY; gy++) {
          const bt = voxels.getBlock(gx, gy, gs);
          if (bt === null) continue;
          const topY = gy + 1;
          if (bt === 9 && topY > bestTop && topY <= curWy + 1.15) {
            bestTop = topY;
          } else if (topY > bestTop && topY <= curWy + 0.25) {
            bestTop = topY;
          }
        }
      }
    }
    return bestTop;
  }

  /**
   * Evaluates placed voxel material physics on the highway with ZERO clipping:
   * - Swept sub-stepping prevents high-speed tunneling through 1m voxel walls
   * - Asphalt (9): smooth climbable ramp/bridge surface + 12% top speed & grip boost
   * - Grass (1) & Leaves (6): heavy drag + 26 m/s speed cap + dust + throttled slow callback
   * - Solid blocks (2, 3, 4, 5, 7, 8, 10): ride cleanly over top ONLY when `abs.wy >= topY - 0.22`,
   *   otherwise physically resolve penetration on S or X so the bike NEVER clips through!
   */
  private handleHighwayVoxels(
    step: number,
    prevS: number,
    prevX: number,
    cb: PlayerCallbacks,
    voxels: VoxelWorld
  ): boolean {
    const st = this.state;
    const totalDs = st.s - prevS;
    const totalDx = st.x - prevX;
    const maxMove = Math.max(Math.abs(totalDs), Math.abs(totalDx));
    const subSteps = Math.max(1, Math.min(10, Math.ceil(maxMove / 0.42)));

    let curS = prevS;
    let curX = prevX;
    let touchedAsphalt = false;
    let slowHit: BlockType | null = null;
    let finalSupportRelY = 0;

    for (let sub = 1; sub <= subSteps; sub++) {
      const stepPrevS = curS;
      const stepPrevX = curX;
      curS = prevS + (totalDs * sub) / subSteps;
      curX = prevX + (totalDx * sub) / subSteps;

      const abs = roadToWorldAbs(curS, curX, st.y, this._tmpAbs);
      const prevAbs = roadToWorldAbs(stepPrevS, stepPrevX, st.y, this._tmpPrevAbs);
      const roadBase = roadY(abs.ws);

      const minX = Math.floor(abs.wx - 0.52);
      const maxX = Math.floor(abs.wx + 0.52);
      const minS = Math.floor(abs.ws - 0.85);
      const maxS = Math.floor(abs.ws + 0.85);
      const minY = Math.floor(Math.min(roadBase, abs.wy) - 1);
      const maxY = Math.floor(abs.wy + 1.45);

      let highestSupport = roadBase;
      let solidHitType: BlockType | null = null;
      let solidHitGx = 0;
      let solidHitGs = 0;
      let solidHitIsFront = false;
      let solidHitFromFront = true;
      let solidHitScore = Infinity;

      for (let gx = minX; gx <= maxX; gx++) {
        for (let gs = minS; gs <= maxS; gs++) {
          for (let gy = minY; gy <= maxY; gy++) {
            const bt = voxels.getBlock(gx, gy, gs);
            if (bt === null) continue;
            const topY = gy + 1;

            if (bt === 9) {
              // Asphalt block: climbable ramp/bridge + grip/speed boost
              if (topY <= abs.wy + 1.15 && topY > highestSupport) {
                highestSupport = topY;
              }
              if (abs.wy >= gy - 0.15 && abs.wy <= topY + 0.45) {
                touchedAsphalt = true;
              }
            } else if (isSlowVoxel(bt)) {
              // Grass / Leaves: heavy drag + dust, never wall-crashes
              if (abs.wy >= gy - 0.25 && abs.wy <= topY + 0.4) {
                slowHit = bt;
                if (topY <= abs.wy + 0.35 && topY > highestSupport) {
                  highestSupport = topY;
                }
              }
            } else if (isSolidVoxel(bt)) {
              // Exact horizontal AABB overlap against [abs.wx-0.52, abs.wx+0.52] x [abs.ws-0.85, abs.ws+0.85]
              const ovX = Math.min(abs.wx + 0.52, gx + 1) - Math.max(abs.wx - 0.52, gx);
              const ovS = Math.min(abs.ws + 0.85, gs + 1) - Math.max(abs.ws - 0.85, gs);
              if (ovX <= 0.001 || ovS <= 0.001) continue;

              if (abs.wy >= topY - 0.22) {
                // Riding cleanly over top of solid block
                if (topY > highestSupport) {
                  highestSupport = topY;
                }
              } else if (topY > abs.wy + 0.12 && gy < abs.wy + 1.45) {
                // Solid penetration! Never bypassed by st.y > 0.9 so 2+ tall walls always block!
                const wasBeforeS = prevAbs.ws + 0.85 <= gs + 0.06;
                const wasAfterS = prevAbs.ws - 0.85 >= gs + 0.94;
                const isFront = wasBeforeS || wasAfterS || ovS <= ovX;
                const fromFront = wasBeforeS || (!wasAfterS && prevAbs.ws <= gs + 0.5);
                const cx = gx + 0.5;
                const cs = gs + 0.5;
                const distSq = (abs.wx - cx) ** 2 + (abs.ws - cs) ** 2;
                // Prioritize front-face hits (so hitting a flat wall resolves cleanly on S)
                const score = isFront ? distSq : distSq + 1000;
                if (score < solidHitScore) {
                  solidHitScore = score;
                  solidHitType = bt;
                  solidHitGx = gx;
                  solidHitGs = gs;
                  solidHitIsFront = isFront;
                  solidHitFromFront = fromFront;
                }
              }
            }
          }
        }
      }

      const blockRelY = Math.max(0, highestSupport - roadBase);
      finalSupportRelY = blockRelY;
      if (solidHitType === null && blockRelY > st.y + 0.01 && blockRelY <= st.y + 1.15) {
        st.y = blockRelY;
        if (this.vy < 0) this.vy = 0;
      }

      if (solidHitType !== null) {
        const pushDir = abs.wx >= solidHitGx + 0.5 ? 1 : -1;
        const preSpeed = st.speed;

        if (solidHitIsFront) {
          // Front/back face collision: physically clamp st.s before block's face!
          const targetWs = solidHitFromFront ? solidHitGs - 0.88 : solidHitGs + 1.88;
          const clampedS = solidHitFromFront
            ? Math.min(stepPrevS, curS + (targetWs - abs.ws))
            : Math.max(stepPrevS, curS + (targetWs - abs.ws));
          st.s = clampedS;
          st.x = curX;

          if (st.turboShieldTimer > 0) {
            // Even with turbo shield, never clip through: deflect sharply sideways around the block
            const sideWx = pushDir < 0 ? solidHitGx - 0.56 : solidHitGx + 1.56;
            const sideX = clamp(sideWx - roadX(st.s), -SHOULDER_HALF_WIDTH, SHOULDER_HALF_WIDTH);
            const sideAbs = roadToWorldAbs(st.s, sideX, st.y, this._tmpPrevAbs);
            if (!this.overlapsBlockingSolidVoxel(voxels, sideAbs.wx, sideAbs.wy, sideAbs.ws, 0.52, 1.45, 0.85)) {
              st.x = sideX;
            }
            st.vx = clamp(pushDir * Math.max(8.5, Math.abs(st.vx) + 5.0), -20, 20);
            st.speed *= 0.6;
            if (this.blockHitCooldown <= 0) {
              this.blockHitCooldown = 0.28;
              cb.onParticles('spark', st.s, st.x, st.y + 0.55, preSpeed * 0.4);
              cb.onBlockEffect?.('block', solidHitType);
            }
            break;
          }

          st.speed = 0;

          if (preSpeed > 28 && st.invulnTimer <= 0) {
            this.startCrash(pushDir * 8.0);
            cb.onBlockEffect?.('crash', solidHitType);
            cb.onCrash();
            cb.onParticles('crash', st.s, st.x, st.y + 0.75, preSpeed * 0.3);
            return true;
          }

          if (this.blockHitCooldown <= 0) {
            this.blockHitCooldown = 0.35;
            cb.onParticles('spark', st.s, st.x, st.y + 0.55, Math.max(8, preSpeed) * 0.35);
            if (preSpeed > 12 && st.invulnTimer <= 0) {
              st.hp = Math.max(0, st.hp - 12);
              if (st.hp <= 0) {
                this.startCrash(pushDir * 7.5);
                cb.onBlockEffect?.('crash', solidHitType);
                cb.onCrash();
                cb.onParticles('crash', st.s, st.x, st.y + 0.75, preSpeed * 0.3);
                return true;
              }
            }
            cb.onBlockEffect?.('block', solidHitType);
          }
          break;
        } else {
          // Side face graze: push st.x cleanly outside the block's side face!
          const targetWx = pushDir < 0 ? solidHitGx - 0.55 : solidHitGx + 1.55;
          const pushedX = clamp(targetWx - roadX(curS), -SHOULDER_HALF_WIDTH, SHOULDER_HALF_WIDTH);
          const checkAbs = roadToWorldAbs(curS, pushedX, st.y, this._tmpPrevAbs);

          if (this.overlapsBlockingSolidVoxel(voxels, checkAbs.wx, checkAbs.wy, checkAbs.ws, 0.52, 1.45, 0.85)) {
            // Corner / corridor wedge fallback: never clip — revert cleanly to pre-step pose
            st.s = stepPrevS;
            st.x = stepPrevX;
            st.speed = 0;
            st.vx = 0;
          } else {
            st.s = curS;
            st.x = pushedX;
            st.speed *= 0.65;
            st.vx = clamp(pushDir * Math.max(7.5, Math.abs(st.vx) + 4.5), -20, 20);
          }

          if (this.blockHitCooldown <= 0) {
            this.blockHitCooldown = 0.35;
            cb.onParticles('spark', st.s, st.x, st.y + 0.55, preSpeed * 0.35);
            if (preSpeed > 14 && st.invulnTimer <= 0 && st.turboShieldTimer <= 0) {
              st.hp = Math.max(0, st.hp - 10);
              if (st.hp <= 0) {
                this.startCrash(pushDir * 7.5);
                cb.onBlockEffect?.('crash', solidHitType);
                cb.onCrash();
                cb.onParticles('crash', st.s, st.x, st.y + 0.75, preSpeed * 0.3);
                return true;
              }
            }
            cb.onBlockEffect?.('block', solidHitType);
          }
          break;
        }
      }
    }

    this.voxelSupportY = finalSupportRelY;

    if (touchedAsphalt) {
      this.asphaltBoostTimer = 0.28;
      if (this.blockBoostFeedbackTimer <= 0 && st.speed > 10) {
        this.blockBoostFeedbackTimer = 1.4;
        cb.onBlockEffect?.('boost', 9);
      }
    }

    if (slowHit !== null) {
      this.slowBlockTimer = 0.18;
      st.speed *= Math.exp(-3.4 * step);
      if (st.speed > 26.0 && st.turboShieldTimer <= 0) {
        st.speed = Math.min(st.speed, 26.0);
      }
      if (this.blockSlowFeedbackTimer <= 0) {
        this.blockSlowFeedbackTimer = 0.75;
        cb.onParticles('dust', st.s - 0.5, st.x, st.y + 0.18, st.speed * 0.25);
        cb.onBlockEffect?.('slow', slowHit);
      }
    }

    return false;
  }

  /**
   * Resolves highway shoulder collisions against deterministic static obstacles
   * (roadside shoulder posts, trees, canyon rocks, gas stations & diners).
   */
  private handleHighwayStaticObstacles(
    prevS: number,
    prevX: number,
    cb: PlayerCallbacks
  ): boolean {
    const st = this.state;
    const abs = roadToWorldAbs(st.s, st.x, st.y, this._tmpAbs);
    const moveDist = Math.hypot(st.s - prevS, st.x - prevX);
    collectNearbyStaticObstacles(abs.wx, abs.ws, 14 + moveDist, this._nearbyObs);
    if (this._nearbyObs.length === 0) return false;

    const totalDs = st.s - prevS;
    const totalDx = st.x - prevX;
    const subSteps = Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(totalDs), Math.abs(totalDx)) / 0.45)));

    let curS = prevS;
    let curX = prevX;

    for (let sub = 1; sub <= subSteps; sub++) {
      const stepPrevS = curS;
      curS = prevS + (totalDs * sub) / subSteps;
      curX = prevX + (totalDx * sub) / subSteps;
      const curAbs = roadToWorldAbs(curS, curX, st.y, this._tmpAbs);

      for (let i = 0; i < this._nearbyObs.length; i++) {
        const o = this._nearbyObs[i];
        if (curAbs.wy >= o.wy + o.height - 0.12 || curAbs.wy + 1.45 <= o.wy + 0.1) continue;

        const bikeHX = o.kind === 'pole' ? 0.34 : 0.52;
        const bikeHS = o.kind === 'pole' ? 0.45 : 0.85;
        const dx = curAbs.wx - o.wx;
        const ds = signedTrackDelta(curAbs.ws, o.ws);
        const penX = o.halfX + bikeHX - Math.abs(dx);
        const penS = o.halfZ + bikeHS - Math.abs(ds);

        if (penX > 0 && penS > 0) {
          const pushDir = dx >= 0 ? 1 : -1;
          const preSpeed = st.speed;

          if (penS < penX) {
            // Head-on hit along S
            const targetWs = ds >= 0 ? o.ws + o.halfZ + bikeHS + 0.03 : o.ws - o.halfZ - bikeHS - 0.03;
            st.s = ds < 0 ? Math.min(stepPrevS, curS + signedTrackDelta(targetWs, curAbs.ws)) : curS + signedTrackDelta(targetWs, curAbs.ws);
            st.x = curX;

            if (o.kind !== 'pole' && preSpeed > 28 && st.invulnTimer <= 0 && st.turboShieldTimer <= 0) {
              this.startCrash(pushDir * 8.0);
              cb.onCrash();
              cb.onParticles('crash', st.s, st.x, st.y + 0.75, preSpeed * 0.3);
              return true;
            }
            st.speed = o.kind === 'pole' ? preSpeed * 0.45 : 0;
            st.vx = clamp(pushDir * Math.max(6.5, Math.abs(st.vx) + 4.0), -20, 20);
          } else {
            // Side graze along X
            const targetWx = o.wx + pushDir * (o.halfX + bikeHX + 0.03);
            st.s = curS;
            st.x = curX + (targetWx - curAbs.wx);
            st.speed *= 0.68;
            st.vx = clamp(pushDir * Math.max(7.0, Math.abs(st.vx) + 4.0), -20, 20);
          }

          if (this.blockHitCooldown <= 0) {
            this.blockHitCooldown = 0.32;
            cb.onParticles('spark', st.s, st.x, st.y + 0.55, preSpeed * 0.35);
          }
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Full 360° Open-World Off-Road Motorcycle Physics!
   * Supports arbitrary heading, reversing, voxel ramp climbing, zero-clipping wall & static obstacle
   * collisions, material physical effects, and seamless auto-rejoin onto the highway.
   */
  private updateFreeRoam(
    step: number,
    cb: PlayerCallbacks,
    weatherMod?: WeatherPhysicsMod,
    voxels?: VoxelWorld
  ): void {
    const st = this.state;
    const inp = this.input;

    if (st.invulnTimer > 0) st.invulnTimer = Math.max(0, st.invulnTimer - step);
    if (st.magnetTimer > 0) st.magnetTimer = Math.max(0, st.magnetTimer - step);
    if (st.turboShieldTimer > 0) {
      st.turboShieldTimer = Math.max(0, st.turboShieldTimer - step);
      st.nitro = 100;
    }
    if (st.spinOutTimer > 0) st.spinOutTimer = Math.max(0, st.spinOutTimer - step);
    if (this.hopCooldown > 0) this.hopCooldown = Math.max(0, this.hopCooldown - step);
    if (this.freeRejoinCooldown > 0) this.freeRejoinCooldown = Math.max(0, this.freeRejoinCooldown - step);
    if (this.blockHitCooldown > 0) this.blockHitCooldown = Math.max(0, this.blockHitCooldown - step);
    if (this.blockSlowFeedbackTimer > 0) this.blockSlowFeedbackTimer = Math.max(0, this.blockSlowFeedbackTimer - step);
    if (this.blockBoostFeedbackTimer > 0) this.blockBoostFeedbackTimer = Math.max(0, this.blockBoostFeedbackTimer - step);
    if (this.slowBlockTimer > 0) this.slowBlockTimer = Math.max(0, this.slowBlockTimer - step);
    if (this.asphaltBoostTimer > 0) this.asphaltBoostTimer = Math.max(0, this.asphaltBoostTimer - step);

    // Handle wipeout tumble & auto-remount in free-roam mode
    if (st.crashed) {
      st.crashTimer += step;
      st.speed = Math.max(0, st.speed - 28.0 * step);
      const fwdX = -Math.sin(this.freeYaw);
      const fwdS = Math.cos(this.freeYaw);
      const tryWx = this.freeWx + fwdX * st.speed * step * 0.5;
      const tryWs = this.freeWs + fwdS * st.speed * step * 0.5;
      if (!voxels || !voxels.overlapsBox(tryWx, this.freeWy + 0.22, this.freeWs, 0.55, 1.45, 0.55)) {
        this.freeWx = tryWx;
      }
      if (!voxels || !voxels.overlapsBox(this.freeWx, this.freeWy + 0.22, tryWs, 0.55, 1.45, 0.55)) {
        this.freeWs = tryWs;
      }
      const gY = openWorldGroundY(this.freeWx, this.freeWs);
      this.freeWy = Math.max(gY, this.freeWy - 8.0 * step);

      st.s = this.freeWs;
      st.x = this.freeWx - roadX(this.freeWs);
      st.y = Math.max(0, this.freeWy - gY);
      st.worldX = this.freeWx;
      st.worldY = this.freeWy;
      st.worldS = this.freeWs;

      this.particleTimer += step;
      if (st.speed > 6 && this.particleTimer >= 0.06) {
        this.particleTimer = 0;
        cb.onParticles('spark', st.s, st.x, st.y + 0.25, st.speed * 0.35);
      }

      if (st.crashTimer >= WIPEOUT_DURATION) {
        st.crashed = false;
        st.crashTimer = 0;
        st.hp = 100;
        st.invulnTimer = REMOUNT_INVULN;
        st.speed = 0;
        st.vx = 0;
        st.lean = 0;
        this.vy = 0;
      }
      return;
    }

    // Nitro
    if (st.nitro <= 0.1) this.nitroDepleted = true;
    else if (st.nitro >= 8) this.nitroDepleted = false;

    const wantsNitro = inp.nitro && !inp.brake && !this.nitroDepleted && st.nitro > 0.5;
    st.nitroActive = wantsNitro;
    if (st.nitroActive) {
      st.nitro = Math.max(0, st.nitro - 22.0 * step);
    } else if (Math.abs(st.speed) > 12) {
      st.nitro = Math.min(100, st.nitro + 3.0 * step);
    }

    // Acceleration, braking & slow reverse gear
    let topOffroad = st.turboShieldTimer > 0 ? 74.0 : st.nitroActive ? 58.0 : 42.0;
    if (this.asphaltBoostTimer > 0) {
      topOffroad *= 1.12;
    }
    if (this.slowBlockTimer > 0 && st.turboShieldTimer <= 0) {
      topOffroad = Math.min(topOffroad, 26.0);
    }
    const weatherBrake = weatherMod ? weatherMod.brakeMul : 1.0;
    st.braking = inp.brake && st.speed > 0.6;

    if (inp.throttle || st.nitroActive || st.turboShieldTimer > 0) {
      if (st.speed < 0) {
        st.speed = Math.min(0, st.speed + 32.0 * step);
      } else {
        const accel = (st.nitroActive ? 42.0 : 24.0) * (1.05 - 0.55 * clamp(st.speed / topOffroad, 0, 1));
        st.speed = Math.min(topOffroad, st.speed + accel * step);
      }
    } else if (inp.brake) {
      if (st.speed > 0.4) {
        st.speed = Math.max(0, st.speed - 38.0 * weatherBrake * step);
      } else {
        // Gentle reverse gear so players can back out of buildings / garages
        st.speed = Math.max(-9.5, st.speed - 14.0 * step);
      }
    } else {
      const drag = Math.abs(st.speed) > 10 ? 11.0 : 8.5;
      if (st.speed > 0) st.speed = Math.max(0, st.speed - drag * step);
      else if (st.speed < 0) st.speed = Math.min(0, st.speed + drag * step);
    }

    // 360° Free steering (positive yaw turns left, negative turns right)
    const digitalSteer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const steer = digitalSteer !== 0 ? digitalSteer : clamp(inp.analogSteer ?? 0, -1, 1);
    const dirSign = st.speed >= -0.05 ? 1 : -1;
    const speedMag = Math.abs(st.speed);
    const asphaltGrip = this.asphaltBoostTimer > 0 ? 1.12 : 1.0;
    const turnAuthority = (speedMag < 0.35 ? 0.55 : clamp(0.45 + speedMag / 14.0, 0.45, 1.35)) * asphaltGrip;
    const highSpeedTighten = 1.0 / (1.0 + speedMag * 0.014);
    const turnRate = -steer * dirSign * 2.55 * turnAuthority * highSpeedTighten;
    this.freeYaw += turnRate * step;

    const targetLean = clamp(steer * 0.45, -0.5, 0.5) * clamp(speedMag / 8.0, 0, 1);
    st.lean += (targetLean - st.lean) * Math.min(1, step * 10.0);

    // Jump / hop in open world
    const groundY = openWorldGroundY(this.freeWx, this.freeWs);
    const supportY = voxels
      ? Math.max(groundY, voxels.getSupportHeight(this.freeWx, this.freeWs, 0.52, 0.52, this.freeWy + 0.35))
      : groundY;
    const grounded = this.freeWy <= supportY + 0.08 && this.vy <= 0;

    if (inp.wheelie && grounded && this.hopCooldown <= 0) {
      this.vy = HOP_VELOCITY * 1.08;
      this.hopCooldown = 0.24;
    }

    // Integrate horizontal world position along heading with swept sub-steps (ZERO tunneling!)
    const fwdX = -Math.sin(this.freeYaw);
    const fwdS = Math.cos(this.freeYaw);
    const prevWx = this.freeWx;
    const prevWs = this.freeWs;
    const dx = fwdX * st.speed * step;
    const ds = fwdS * st.speed * step;
    const moveDist = Math.hypot(dx, ds);
    const subSteps = Math.max(1, Math.min(10, Math.ceil(moveDist / 0.42)));

    // Collect all nearby static world obstacles once for this frame (trees, rocks, gas stations, diners, posts)
    collectNearbyStaticObstacles(this.freeWx, this.freeWs, 16 + moveDist, this._nearbyObs);

    const hasVoxels = Boolean(voxels && voxels.getBlockCount() > 0);
    let curWx = this.freeWx;
    let curWs = this.freeWs;
    let voxelHitX = false;
    let voxelHitS = false;
    let voxelHitNormalX = 0;
    let voxelHitNormalS = 0;
    let voxelHitType: BlockType | null = null;
    let obsCollided = false;
    let obsHitNormalX = 0;
    let obsHitNormalS = 0;
    let obsHitKind: StaticObstacle['kind'] = 'tree';

    const subDx = dx / subSteps;
    const subDs = ds / subSteps;

    for (let sub = 0; sub < subSteps; sub++) {
      // 1. Strict axis-separated voxel movement & push-out (bike half-extents 0.55, 1.45, 0.55)
      if (hasVoxels && voxels) {
        const tryWx = curWx + subDx;
        if (!voxels.overlapsBox(tryWx, this.freeWy + 0.22, curWs, 0.55, 1.45, 0.55)) {
          curWx = tryWx;
        } else {
          const stepUpY = this.findFreeRoamStepUpY(voxels, tryWx, curWs, this.freeWy);
          if (stepUpY > this.freeWy && !voxels.overlapsBox(tryWx, stepUpY + 0.12, curWs, 0.55, 1.45, 0.55)) {
            this.freeWy = stepUpY;
            if (this.vy < 0) this.vy = 0;
            curWx = tryWx;
          } else {
            voxelHitX = true;
            voxelHitNormalX = subDx >= 0 ? -1 : 1;
            voxelHitType = this.findOverlappingVoxelType(voxels, tryWx, this.freeWy + 0.22, curWs, 0.55, 1.45, 0.55) ?? 2;
          }
        }

        const tryWs = curWs + subDs;
        if (!voxels.overlapsBox(curWx, this.freeWy + 0.22, tryWs, 0.55, 1.45, 0.55)) {
          curWs = tryWs;
        } else {
          const stepUpY = this.findFreeRoamStepUpY(voxels, curWx, tryWs, this.freeWy);
          if (stepUpY > this.freeWy && !voxels.overlapsBox(curWx, stepUpY + 0.12, tryWs, 0.55, 1.45, 0.55)) {
            this.freeWy = stepUpY;
            if (this.vy < 0) this.vy = 0;
            curWs = tryWs;
          } else {
            voxelHitS = true;
            voxelHitNormalS = subDs >= 0 ? -1 : 1;
            voxelHitType =
              voxelHitType ??
              this.findOverlappingVoxelType(voxels, curWx, this.freeWy + 0.22, tryWs, 0.55, 1.45, 0.55) ??
              2;
          }
        }

        // If already overlapping a newly placed block at current position, push cleanly outside
        if (voxels.overlapsBox(curWx, this.freeWy + 0.22, curWs, 0.55, 1.45, 0.55)) {
          const gx = Math.floor(curWx);
          const gs = Math.floor(curWs);
          const pushL = curWx - (gx - 0.56);
          const pushR = gx + 1.56 - curWx;
          const pushB = curWs - (gs - 0.56);
          const pushF = gs + 1.56 - curWs;
          const minP = Math.min(pushL, pushR, pushB, pushF);
          if (minP === pushL && !voxels.overlapsBox(gx - 0.56, this.freeWy + 0.22, curWs, 0.55, 1.45, 0.55)) {
            curWx = gx - 0.56;
          } else if (minP === pushR && !voxels.overlapsBox(gx + 1.56, this.freeWy + 0.22, curWs, 0.55, 1.45, 0.55)) {
            curWx = gx + 1.56;
          } else if (minP === pushB && !voxels.overlapsBox(curWx, this.freeWy + 0.22, gs - 0.56, 0.55, 1.45, 0.55)) {
            curWs = gs - 0.56;
          } else if (!voxels.overlapsBox(curWx, this.freeWy + 0.22, gs + 1.56, 0.55, 1.45, 0.55)) {
            curWs = gs + 1.56;
          }
        }
      } else {
        curWx += subDx;
        curWs += subDs;
      }

      // 2. Resolve collisions against static world obstacles (trees, rocks, gas stations, diners, posts)
      for (let i = 0; i < this._nearbyObs.length; i++) {
        const o = this._nearbyObs[i];
        if (this.freeWy >= o.wy + o.height - 0.12 || this.freeWy + 1.45 <= o.wy + 0.1) continue;
        const bikeH = o.kind === 'pole' ? 0.36 : 0.55;
        const odx = curWx - o.wx;
        const ods = signedTrackDelta(curWs, o.ws);
        const penX = o.halfX + bikeH - Math.abs(odx);
        const penS = o.halfZ + bikeH - Math.abs(ods);
        if (penX > 0 && penS > 0) {
          if (penX < penS) {
            const sgn = odx >= 0 ? 1 : -1;
            curWx += sgn * (penX + 0.015);
            obsHitNormalX = sgn;
          } else {
            const sgn = ods >= 0 ? 1 : -1;
            curWs += sgn * (penS + 0.015);
            obsHitNormalS = sgn;
          }
          obsCollided = true;
          obsHitKind = o.kind;
        }
      }

      if (voxelHitX || voxelHitS || obsCollided) {
        break;
      }
    }

    // Evaluate surface material underfoot (asphalt speed boost, grass/leaves slow drag)
    if (hasVoxels && voxels) {
      const footGy = Math.floor(this.freeWy - 0.08);
      let touchedAsphalt = false;
      let slowHit: BlockType | null = null;
      const minX = Math.floor(curWx - 0.45);
      const maxX = Math.floor(curWx + 0.45);
      const minS = Math.floor(curWs - 0.45);
      const maxS = Math.floor(curWs + 0.45);
      for (let gx = minX; gx <= maxX; gx++) {
        for (let gs = minS; gs <= maxS; gs++) {
          const bt = voxels.getBlock(gx, footGy, gs);
          if (bt === 9) touchedAsphalt = true;
          else if (bt !== null && isSlowVoxel(bt)) slowHit = bt;
        }
      }

      if (touchedAsphalt) {
        this.asphaltBoostTimer = 0.28;
        if (this.blockBoostFeedbackTimer <= 0 && speedMag > 10) {
          this.blockBoostFeedbackTimer = 1.4;
          cb.onBlockEffect?.('boost', 9);
        }
      }
      if (slowHit !== null) {
        this.slowBlockTimer = 0.18;
        st.speed *= Math.exp(-3.4 * step);
        if (Math.abs(st.speed) > 26.0 && st.turboShieldTimer <= 0) {
          st.speed = Math.sign(st.speed) * 26.0;
        }
        if (this.blockSlowFeedbackTimer <= 0) {
          this.blockSlowFeedbackTimer = 0.75;
          const gHere = openWorldGroundY(curWx, curWs);
          cb.onParticles('dust', curWs, curWx - roadX(curWs), Math.max(0.15, this.freeWy - gHere + 0.15), 0);
          cb.onBlockEffect?.('slow', slowHit);
        }
      }
    }

    // Apply voxel collision velocity halt & callback
    if (voxelHitX || voxelHitS) {
      const preSpeed = Math.abs(st.speed);
      const nLen = Math.hypot(voxelHitNormalX, voxelHitNormalS) || 1;
      const nx = voxelHitNormalX / nLen;
      const ns = voxelHitNormalS / nLen;
      const into = -(fwdX * nx + fwdS * ns) * st.speed;
      const hitBt = voxelHitType ?? 2;
      const gFx = openWorldGroundY(curWx, curWs);
      const curLatForFx = curWx - roadX(curWs);
      const curRelYForFx = Math.max(0.35, this.freeWy - gFx + 0.35);

      if (
        preSpeed > 28 &&
        into > 14 &&
        st.invulnTimer <= 0 &&
        st.turboShieldTimer <= 0
      ) {
        this.freeWx = curWx;
        this.freeWs = curWs;
        this.blockHitCooldown = 0.45;
        this.startCrash(nx * 8.0);
        cb.onBlockEffect?.('crash', hitBt);
        cb.onCrash();
        cb.onParticles('crash', this.freeWs, curLatForFx, curRelYForFx, preSpeed * 0.25);
        return;
      }

      // Strictly halt velocity on direct collision; damp sharply on glancing scrape
      if ((voxelHitX && voxelHitS) || into > preSpeed * 0.45) {
        st.speed = 0;
      } else {
        st.speed *= 0.45;
      }

      if (this.blockHitCooldown <= 0 && preSpeed > 1.5) {
        this.blockHitCooldown = 0.35;
        cb.onParticles('spark', curWs, curLatForFx, curRelYForFx, preSpeed * 0.3);
        if (preSpeed > 12 && st.invulnTimer <= 0 && st.turboShieldTimer <= 0) {
          st.hp = Math.max(0, st.hp - 12);
          if (st.hp <= 0) {
            this.freeWx = curWx;
            this.freeWs = curWs;
            this.startCrash(nx * 7.5);
            cb.onBlockEffect?.('crash', hitBt);
            cb.onCrash();
            cb.onParticles('crash', this.freeWs, curLatForFx, curRelYForFx, preSpeed * 0.25);
            return;
          }
        }
        cb.onBlockEffect?.('block', hitBt);
      }
    }

    // Apply static obstacle (tree/rock/building/pole) collision velocity halt & feedback
    if (obsCollided) {
      const preSpeed = Math.abs(st.speed);
      const nLen = Math.hypot(obsHitNormalX, obsHitNormalS) || 1;
      const nx = obsHitNormalX / nLen;
      const ns = obsHitNormalS / nLen;
      const into = -(fwdX * nx + fwdS * ns) * st.speed;
      const gFx = openWorldGroundY(curWx, curWs);
      const curLatForFx = curWx - roadX(curWs);
      const curRelYForFx = Math.max(0.35, this.freeWy - gFx + 0.35);

      if (
        obsHitKind !== 'pole' &&
        preSpeed > 28 &&
        into > 14 &&
        st.invulnTimer <= 0 &&
        st.turboShieldTimer <= 0
      ) {
        this.freeWx = curWx;
        this.freeWs = curWs;
        this.blockHitCooldown = 0.45;
        this.startCrash(nx * 8.0);
        cb.onCrash();
        cb.onParticles('crash', this.freeWs, curLatForFx, curRelYForFx, preSpeed * 0.25);
        return;
      }

      if (into > preSpeed * 0.45) {
        st.speed = 0;
      } else {
        st.speed *= 0.5;
      }

      if (this.blockHitCooldown <= 0 && preSpeed > 2.0) {
        this.blockHitCooldown = 0.32;
        cb.onParticles('spark', curWs, curLatForFx, curRelYForFx, preSpeed * 0.3);
      }
    }

    // Commit resolved open-world coordinates
    this.freeWx = curWx;
    this.freeWs = curWs;

    // Vertical gravity & smooth terrain/block following (cresting hills launches cleanly!)
    const prevGround = openWorldGroundY(prevWx, prevWs);
    const newGround = openWorldGroundY(this.freeWx, this.freeWs);
    const slopeVy = (newGround - prevGround) / step;
    const newSupport = voxels
      ? Math.max(newGround, voxels.getSupportHeight(this.freeWx, this.freeWs, 0.52, 0.52, this.freeWy + 0.35))
      : newGround;

    if (grounded && this.vy <= 0) {
      // Stick smoothly to climbing slopes & voxel ramps; gently lift off when cresting steep hilltops at high speed
      if (newSupport <= newGround + 0.05 && slopeVy < -6.5 && speedMag > 24) {
        this.vy = Math.max(-2.0, slopeVy * 0.35);
        this.freeWy += this.vy * step;
      } else {
        this.freeWy = newSupport;
        this.vy = 0;
      }
    } else {
      this.freeWy += this.vy * step;
      this.vy -= GRAVITY * step;
    }

    if (this.freeWy <= newSupport) {
      this.freeWy = newSupport;
      this.vy = 0;
    }

    const relAirY = Math.max(0, this.freeWy - newSupport);
    st.wheelie += ((relAirY > 0.15 ? 0.55 : 0) - st.wheelie) * Math.min(1, step * 12);
    st.wheelAngle = (st.wheelAngle + (st.speed / WHEEL_RADIUS) * step) % (Math.PI * 2);

    // Sync RiderRenderState fields
    const curLat = this.freeWx - roadX(this.freeWs);
    st.s = this.freeWs;
    st.x = curLat;
    st.y = Math.max(0, this.freeWy - newGround);
    st.vx = fwdX * st.speed;
    st.heading = this.freeYaw;
    st.worldX = this.freeWx;
    st.worldY = this.freeWy;
    st.worldS = this.freeWs;

    // Off-road dust / nitro particles
    this.particleTimer += step;
    if (this.particleTimer >= 0.055 && speedMag > 6 && relAirY < 0.2) {
      this.particleTimer = 0;
      cb.onParticles(
        st.nitroActive ? 'nitro' : 'dust',
        st.s - fwdS * 0.9,
        st.x - fwdX * 0.9,
        st.y + 0.15,
        0
      );
    }

    // Seamless auto-rejoin highway racing when riding back onto asphalt facing forward!
    if (
      this.freeRejoinCooldown <= 0 &&
      Math.abs(curLat) < ROAD_HALF_WIDTH - 0.3 &&
      st.speed > 10.0 &&
      Math.abs(this.freeWy - roadY(this.freeWs)) < 1.2
    ) {
      const roadYaw = roadForwardYaw(this.freeWs);
      let angleDiff = (this.freeYaw - roadYaw) % (Math.PI * 2);
      if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      if (Math.abs(angleDiff) < 0.52) {
        st.freeRoam = false;
        st.heading = 0;
        st.worldX = undefined;
        st.worldY = undefined;
        st.worldS = undefined;
        st.vx = clamp(-Math.sin(angleDiff) * st.speed, -14, 14);
        cb.onReturnTrack?.();
      }
    }
  }
}
