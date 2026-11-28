import {
  MAX_LATERAL,
  ROAD_HALF_WIDTH,
  RoadFrame,
  getBoostPadInSlot,
  sampleRoadFrame,
  signedTrackDelta,
} from './RoadMath';
import { AVATAR_COUNT } from './PixelAvatars';
import { FallenCargo, RiderRenderState, TrafficCar, WEAPONS, WeaponType } from './types';
import type { WeatherPhysicsMod } from './WeatherSystem';

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

    this.vy = 0;
    this.hopCooldown = 0;
    this.wheelieHoldTime = 0;
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.pendingSwingSide = 0;
    this.boostPadTimer = 0;
    this.lastBoostSlot = -999;
    this.hitIdsThisSwing.clear();
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
    if (st.crashed || st.invulnTimer > 0 || st.turboShieldTimer > 0) return false;
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
    if (st.crashed || st.invulnTimer > 0 || st.turboShieldTimer > 0) return false;

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
    this.hitIdsThisSwing.clear();
  }

  update(
    dt: number,
    targets: RiderRenderState[],
    traffic: TrafficCar[],
    cb: PlayerCallbacks,
    fallenCargo?: readonly FallenCargo[],
    weatherMod?: WeatherPhysicsMod
  ): void {
    const step = dt > 0.05 ? 0.05 : dt < 0.0001 ? 0.0001 : dt;
    const st = this.state;
    const inp = this.input;

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
    const grounded = st.y <= 0.001 && this.vy <= 0;

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
      const airPitch = this.vy > 0 ? 1.0 : clamp(st.y / 1.1, 0.15, 0.85);
      st.wheelie += (airPitch - st.wheelie) * Math.min(1, step * 14);
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
    const steerGrip = 0.85 + 0.15 * weatherGrip;
    const steerAccel = steer * 45.0 * steerGrip * (0.45 + 0.72 * speedAuthority) * airFactor * spinFactor;
    const spinWobble = st.spinOutTimer > 0 ? Math.sin(st.spinOutTimer * 22) * 14.0 : 0;

    // Positive curvature => road bends right => centrifugal force pushes left (-x)
    const centrifugal = -this._frame.curvature * st.speed * st.speed * 0.46;
    const crosswind = weatherWindX * speedAuthority * (st.turboShieldTimer > 0 ? 0.25 : 1.0);

    st.vx += (steerAccel + centrifugal + spinWobble + crosswind) * step;
    const latDamp = (Math.abs(steer) > 0.05 ? 5.6 : 8.8) * weatherGrip;
    st.vx *= Math.exp(-latDamp * step);

    // Keep stopped bike from drifting sideways
    if (st.speed < 0.8 && Math.abs(steer) <= 0.05) {
      st.vx *= Math.exp(-12.0 * step);
    }

    const targetLean =
      clamp(steer * 0.48 + (st.vx / 15.0) * 0.12, -0.55, 0.55) *
      clamp(st.speed / 9.0, 0, 1);
    st.lean += (targetLean - st.lean) * Math.min(1, step * 11.0);

    // Integrate road coordinates
    st.s += (st.speed / this._frame.tangentLen) * step;
    st.x += st.vx * step;
    st.wheelAngle = (st.wheelAngle + (st.speed / WHEEL_RADIUS) * step) % (Math.PI * 2);

    // Hard outer rail bounce with sparks
    if (Math.abs(st.x) > MAX_LATERAL) {
      const sideSign = st.x > 0 ? 1 : -1;
      const impactVx = Math.abs(st.vx);
      st.x = sideSign * MAX_LATERAL;
      st.vx = -sideSign * Math.max(4.5, impactVx * 0.62);
      st.speed *= 0.88;

      if (this.railSparkTimer <= 0) {
        this.railSparkTimer = 0.08;
        cb.onParticles('spark', st.s, st.x, 0.5, st.speed * 0.45);
      }

      if (impactVx > 14.5 && st.invulnTimer <= 0) {
        st.hp = Math.max(0, st.hp - 8);
        if (st.hp <= 0) {
          this.startCrash(-sideSign * 7.5);
          cb.onCrash();
          cb.onParticles('crash', st.s, st.x, 0.7, st.speed * 0.35);
          return;
        }
      }
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
}
