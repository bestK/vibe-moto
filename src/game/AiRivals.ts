import { deliveryName, getLang, type Lang } from '../i18n';
import {
  LANE_CENTERS,
  MAX_LATERAL,
  ROAD_HALF_WIDTH,
  RoadFrame,
  sampleRoadFrame,
  signedTrackDelta,
} from './RoadMath';
import { AVATAR_COUNT } from './PixelAvatars';
import { RiderRenderState, TrafficCar, WEAPONS, WeaponType } from './types';

export interface CrateHint {
  s: number;
  x: number;
}

interface BotProfile {
  id: string;
  name: string;
  colorIdx: number;
  avatarIdx: number;
  weapon: WeaponType;
  baseOffsetS: number;
  prefLane: number;
  waveFreq: number;
  wavePhase: number;
  aggression: number;
  deliveryRole?: 'meituan' | 'eleme' | null;
}

interface BotAgent {
  profile: BotProfile;
  state: RiderRenderState;
  active: boolean;
  targetX: number;
  attackTimer: number;
  attackCooldown: number;
  didHitThisSwing: boolean;
  duelTimer: number;
  duelSide: -1 | 1;
  laneTimer: number;
  rageTimer: number;
  enragedKoCount: number;
}

// 3 pack bots (yield as real players join) + 2 permanent Chinese delivery riders (always cruising!)
const BOT_PROFILES: readonly BotProfile[] = [
  {
    id: 'bot-viper',
    name: 'BOT_VIPER',
    colorIdx: 0,
    avatarIdx: 1,
    weapon: 0,
    baseOffsetS: 8,
    prefLane: 1,
    waveFreq: 0.34,
    wavePhase: 0.0,
    aggression: 0.78,
    deliveryRole: null,
  },
  {
    id: 'bot-spike',
    name: 'BOT_SPIKE',
    colorIdx: 2,
    avatarIdx: 4,
    weapon: 1,
    baseOffsetS: 20,
    prefLane: 2,
    waveFreq: 0.27,
    wavePhase: 2.1,
    aggression: 0.85,
    deliveryRole: null,
  },
  {
    id: 'bot-axel',
    name: 'BOT_AXEL',
    colorIdx: 4,
    avatarIdx: 8 % AVATAR_COUNT,
    weapon: 2,
    baseOffsetS: -5,
    prefLane: 0,
    waveFreq: 0.31,
    wavePhase: 4.3,
    aggression: 0.68,
    deliveryRole: null,
  },
  {
    id: 'bot-meituan',
    name: '美团·小哥',
    colorIdx: 3,
    avatarIdx: 0,
    weapon: 0,
    baseOffsetS: 34,
    prefLane: 3,
    waveFreq: 0.22,
    wavePhase: 1.2,
    aggression: 0.25,
    deliveryRole: 'meituan',
  },
  {
    id: 'bot-eleme',
    name: '饿了么·骑士',
    colorIdx: 5,
    avatarIdx: 2,
    weapon: 0,
    baseOffsetS: -26,
    prefLane: 0,
    waveFreq: 0.25,
    wavePhase: 3.7,
    aggression: 0.25,
    deliveryRole: 'eleme',
  },
] as const;

const REGULAR_BOT_COUNT = 3;
const NORMAL_BOT_MAX_HP = 70;
const DELIVERY_BOT_MAX_HP = 75;
const DELIVERY_RAGE_DURATION = 11.0;
const BOT_MAX_HELD_ITEMS = 2;

const WHEEL_RADIUS = 0.35;
const BOT_CRASH_DURATION = 2.1;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class AiRivals {
  private readonly bots: BotAgent[] = [];
  private readonly activeList: RiderRenderState[] = [];
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
  private time = 0;
  private lastLang: Lang = getLang();
  private onDeliveryEnrageCb: ((riderName: string, role: 'meituan' | 'eleme') => void) | null = null;

  constructor() {
    for (let i = 0; i < BOT_PROFILES.length; i++) {
      const p = BOT_PROFILES[i];
      const maxHp = p.deliveryRole ? DELIVERY_BOT_MAX_HP : NORMAL_BOT_MAX_HP;
      this.bots.push({
        profile: p,
        active: false,
        targetX: LANE_CENTERS[p.prefLane],
        attackTimer: 0,
        attackCooldown: 1.6 + i * 0.5,
        didHitThisSwing: false,
        duelTimer: 0,
        duelSide: i % 2 === 0 ? -1 : 1,
        laneTimer: 0.3 + i * 0.2,
        rageTimer: 0,
        enragedKoCount: 0,
        state: {
          id: p.id,
          name: p.deliveryRole ? deliveryName(p.deliveryRole) : p.name,
          isLocal: false,
          isBot: true,
          colorIdx: p.colorIdx,
          avatarIdx: ((p.avatarIdx % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT,
          s: 20 + p.baseOffsetS,
          x: LANE_CENTERS[p.prefLane],
          y: 0,
          speed: p.deliveryRole ? 37 : 18,
          vx: 0,
          lean: 0,
          hp: maxHp,
          nitro: 50,
          weapon: p.weapon,
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
          deliveryRole: p.deliveryRole ?? null,
          enraged: false,
          enragedTargetId: null,
        },
      });
    }
  }

  setOnDeliveryEnrage(cb: (riderName: string, role: 'meituan' | 'eleme') => void): void {
    this.onDeliveryEnrageCb = cb;
  }

  isAnyDeliveryEnraged(): string | null {
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (b.active && b.profile.deliveryRole && b.state.enraged) {
        return b.state.name;
      }
    }
    return null;
  }

  triggerDeliveryRage(botId: string): boolean {
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (bot.state.id !== botId || !bot.profile.deliveryRole) continue;
      const wasEnraged = Boolean(bot.state.enraged);
      bot.state.enraged = true;
      bot.state.enragedTargetId = 'local';
      bot.rageTimer = DELIVERY_RAGE_DURATION;
      if (!wasEnraged) {
        bot.enragedKoCount = 0;
        this.onDeliveryEnrageCb?.(bot.state.name, bot.profile.deliveryRole);
      }
      return true;
    }
    return false;
  }

  update(
    dt: number,
    local: RiderRenderState,
    traffic: TrafficCar[],
    nearbyRealCount: number,
    onBotHitPlayer: (dmg: number, knockX: number, botName: string) => void,
    crates?: readonly CrateHint[]
  ): RiderRenderState[] {
    const step = dt > 0.05 ? 0.05 : dt < 0.0001 ? 0.0001 : dt;
    this.time += step;
    this.activeList.length = 0;

    // Keep delivery rider names live-synced with UI language toggle
    const curLang = getLang();
    if (curLang !== this.lastLang) {
      this.lastLang = curLang;
      for (let i = 0; i < this.bots.length; i++) {
        const role = this.bots[i].profile.deliveryRole;
        if (role) {
          this.bots[i].state.name = deliveryName(role);
        }
      }
    }

    const targetBotCount = Math.max(0, REGULAR_BOT_COUNT - nearbyRealCount);

    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      const isDelivery = Boolean(bot.profile.deliveryRole);
      if (!isDelivery && i >= targetBotCount) {
        bot.active = false;
        continue;
      }

      const maxRoamDist = isDelivery && !bot.state.enraged ? 380 : 165;
      if (!bot.active || (!isDelivery && Math.abs(signedTrackDelta(bot.state.s, local.s)) > maxRoamDist)) {
        this.spawnBotNear(bot, local);
        bot.active = true;
      }

      this.updateBot(bot, step, local, traffic, onBotHitPlayer, crates);
      this.activeList.push(bot.state);
    }

    return this.activeList;
  }

  applyHit(botId: string, dmg: number, knockX: number): boolean {
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (bot.state.id !== botId) continue;
      const st = bot.state;
      if (!bot.active || st.crashed || st.invulnTimer > 0 || st.turboShieldTimer > 0) return false;

      if (bot.profile.deliveryRole) {
        this.triggerDeliveryRage(botId);
      }

      st.hp = Math.max(0, st.hp - dmg);
      st.vx = clamp(st.vx + knockX, -22, 22);
      st.speed = Math.max(12, st.speed * 0.87);
      st.attackSide = 0;
      st.attackPhase = 0;
      bot.attackTimer = 0;
      bot.attackCooldown = Math.max(bot.attackCooldown, st.enraged ? 0.38 : 0.85);

      if (st.hp <= 0) {
        st.crashed = true;
        st.crashTimer = 0;
        st.nitroActive = false;
        st.braking = false;
        st.spinOutTimer = 0;
        if (st.enraged) {
          bot.enragedKoCount++;
          if (bot.enragedKoCount >= 1) {
            st.enraged = false;
            st.enragedTargetId = null;
            bot.rageTimer = 0;
          }
        }
        return true;
      }
      return false;
    }
    return false;
  }

  applySpinOut(botId: string, duration: number, dmg: number): boolean {
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (bot.state.id !== botId) continue;
      const st = bot.state;
      if (!bot.active || st.crashed || st.invulnTimer > 0 || st.turboShieldTimer > 0) return false;
      if (bot.profile.deliveryRole) {
        this.triggerDeliveryRage(botId);
      }
      st.spinOutTimer = Math.max(st.spinOutTimer, duration);
      st.speed = Math.max(10, st.speed * 0.62);
      st.hp = Math.max(0, st.hp - dmg);
      if (st.hp <= 0) {
        st.crashed = true;
        st.crashTimer = 0;
        st.spinOutTimer = 0;
        if (st.enraged) {
          bot.enragedKoCount++;
          if (bot.enragedKoCount >= 1) {
            st.enraged = false;
            st.enragedTargetId = null;
            bot.rageTimer = 0;
          }
        }
        return true;
      }
      return false;
    }
    return false;
  }

  applyPoliceDrag(botId: string, dt: number, shoveX: number): void {
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (bot.state.id !== botId || !bot.active || bot.state.crashed) continue;
      if (bot.profile.deliveryRole && !bot.state.enraged) {
        this.triggerDeliveryRage(botId);
      }
      const st = bot.state;
      st.speed = Math.max(11, st.speed * Math.exp(-1.5 * dt));
      st.vx = clamp(st.vx + shoveX * dt, -14, 14);
      break;
    }
  }

  private spawnBotNear(bot: BotAgent, local: RiderRenderState): void {
    const p = bot.profile;
    const st = bot.state;
    const desiredS = Math.max(2, local.s + p.baseOffsetS);

    // Choose a lane distinct from local player's current x
    let laneX: number = LANE_CENTERS[p.prefLane];
    if (Math.abs(laneX - local.x) < 1.6) {
      laneX = LANE_CENTERS[(p.prefLane + 2) % 4];
    }

    st.s = desiredS;
    st.x = laneX;
    st.y = 0;
    st.speed = p.deliveryRole ? 37 : clamp(local.speed * 0.85, 18, 42);
    st.vx = 0;
    st.lean = 0;
    st.hp = p.deliveryRole ? DELIVERY_BOT_MAX_HP : NORMAL_BOT_MAX_HP;
    st.crashed = false;
    st.crashTimer = 0;
    st.attackSide = 0;
    st.attackPhase = 0;
    st.nitroActive = false;
    st.braking = false;
    st.invulnTimer = 1.0;

    bot.targetX = laneX;
    bot.attackTimer = 0;
    bot.attackCooldown = 2.0;
    bot.didHitThisSwing = false;
    bot.duelTimer = 0;
  }

  private updateBot(
    bot: BotAgent,
    dt: number,
    local: RiderRenderState,
    traffic: TrafficCar[],
    onBotHitPlayer: (dmg: number, knockX: number, botName: string) => void,
    crates?: readonly CrateHint[]
  ): void {
    const st = bot.state;
    const p = bot.profile;

    if (st.invulnTimer > 0) {
      st.invulnTimer = Math.max(0, st.invulnTimer - dt);
    }
    if (st.magnetTimer > 0) {
      st.magnetTimer = Math.max(0, st.magnetTimer - dt);
    }
    if (st.turboShieldTimer > 0) {
      st.turboShieldTimer = Math.max(0, st.turboShieldTimer - dt);
      st.spinOutTimer = 0;
    }
    if (st.spinOutTimer > 0) {
      st.spinOutTimer = Math.max(0, st.spinOutTimer - dt);
      st.speed = Math.max(10, st.speed - 14.0 * dt);
    }
    if (bot.attackCooldown > 0) {
      bot.attackCooldown = Math.max(0, bot.attackCooldown - dt);
    }

    if (bot.rageTimer > 0) {
      bot.rageTimer = Math.max(0, bot.rageTimer - dt);
      if (bot.rageTimer <= 0) {
        st.enraged = false;
        st.enragedTargetId = null;
      }
    }

    sampleRoadFrame(st.s, this._frame);

    // Handle bot wipeout slide & recovery
    if (st.crashed) {
      st.crashTimer += dt;
      st.speed = Math.max(0, st.speed - 25.0 * dt);
      st.vx *= Math.exp(-3.0 * dt);
      st.s += (st.speed / this._frame.tangentLen) * dt;
      st.x = clamp(st.x + st.vx * dt, -MAX_LATERAL, MAX_LATERAL);

      const remountTime = st.enraged ? 1.65 : BOT_CRASH_DURATION;
      if (st.crashTimer >= remountTime) {
        st.crashed = false;
        st.crashTimer = 0;
        st.hp = p.deliveryRole ? DELIVERY_BOT_MAX_HP : NORMAL_BOT_MAX_HP;
        st.invulnTimer = st.enraged ? 1.1 : 1.6;
        st.vx = 0;
        st.lean = 0;
        st.x = clamp(st.x, -ROAD_HALF_WIDTH + 1.2, ROAD_HALF_WIDTH - 1.2);
        // Rubber-band recover gently behind player
        if (signedTrackDelta(st.s, local.s) < -34) {
          st.s = Math.max(0, local.s - 22);
        }
        st.speed = st.enraged
          ? clamp(local.speed * 0.96, 38, 56)
          : clamp(local.speed * 0.82, 18, 40);
      }
      return;
    }

    const isDelivery = Boolean(p.deliveryRole);
    const isEnraged = Boolean(st.enraged);

    // Periodic duel engagement (enraged delivery riders chase player; normal bots duel more calmly)
    bot.duelTimer -= dt;
    if (bot.duelTimer <= -4.5) {
      bot.duelTimer = 2.4 + p.aggression * 1.8;
      bot.duelSide = st.x >= local.x ? 1 : -1;
    }
    const inDuel = isEnraged
      ? !local.crashed
      : !isDelivery && bot.duelTimer > 0 && !local.crashed && local.speed > 18;

    // Gentle arcade rubber-banding (bots stay nearby for brawls, never slingshot past player!)
    const wave = Math.sin(this.time * p.waveFreq + p.wavePhase) * 14.0;
    const desiredOffset = isEnraged ? 0.3 : inDuel ? 0.5 : p.baseOffsetS + wave;
    const errS = signedTrackDelta(local.s + desiredOffset, st.s);

    let desiredSpeed: number;
    if (st.turboShieldTimer > 0) {
      desiredSpeed = 58.0;
    } else if (isEnraged) {
      // Dramatic but escapable surge (56..58.5 m/s so player can escape with Nitro or Wheelie Boost!)
      desiredSpeed = clamp(local.speed * 0.96 + errS * 0.72, 42.0, 58.5);
    } else if (isDelivery) {
      // Chill Chinese delivery rider cruising 34..40 m/s minding their order
      const calmBase = 37.0 + Math.sin(this.time * 0.4 + p.wavePhase) * 2.8;
      desiredSpeed = clamp(calmBase + clamp(errS * 0.05, -2.5, 3.0), 34.0, 40.5);
    } else if (local.speed < 6) {
      // Let regular bots cruise calmly past if player stops, then wait gently ahead
      desiredSpeed = errS < -45 ? 12.0 : 20.0;
    } else {
      // Friendly arcade cruising 33..41 m/s with gentle catch-up capped at 47 m/s
      const cruiseBase = 37.0 + Math.sin(this.time * 0.42 + p.wavePhase) * 3.8;
      const catchup = errS > 0 ? Math.min(8.5, errS * 0.25) : Math.max(-8.0, errS * 0.22);
      const pacedBase = Math.min(local.speed * 0.88 + 6.5, cruiseBase);
      desiredSpeed = clamp(pacedBase + catchup, 18.0, 47.0);
    }

    const speedDiff = desiredSpeed - st.speed;
    const maxAccel = isEnraged ? 34.0 : 22.0;
    const accel = speedDiff >= 0 ? Math.min(maxAccel, speedDiff * 2.4) : Math.max(-30.0, speedDiff * 2.8);
    st.speed = Math.max(10.0, st.speed + accel * dt);
    st.braking = speedDiff < -7.0;
    st.nitroActive =
      st.turboShieldTimer > 0 ||
      isEnraged ||
      (errS > 48.0 && local.speed > 40.0 && st.speed > 42.0);

    // Lane selection & traffic weaving (plus gentle bias toward road '?' crates!)
    bot.laneTimer -= dt;
    if (bot.laneTimer <= 0) {
      bot.laneTimer = isEnraged ? 0.1 : 0.16;
      bot.targetX = this.chooseBestLateralX(bot, local, traffic, inDuel, crates);
    }

    // Check immediate traffic evasion override (cyclic across 2400m seam, respecting long cargo trucks!)
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const isTruck = car.type === 4;
      const ds = signedTrackDelta(car.s, st.s);
      if (ds < (isTruck ? -4.5 : -2.2) || ds > (isTruck ? 32.0 : 26.0)) continue;
      const carX = car.x + car.bumpOffset;
      const avoidWidth = isTruck ? 2.35 : 1.85;
      if (Math.abs(carX - st.x) < avoidWidth) {
        const stepX = isTruck ? 3.8 : 3.3;
        if (carX > 3.5) {
          bot.targetX = carX - stepX;
        } else if (carX < -3.5) {
          bot.targetX = carX + stepX;
        } else {
          bot.targetX = st.x >= carX ? carX + stepX : carX - stepX;
        }
        bot.targetX = clamp(bot.targetX, -ROAD_HALF_WIDTH + 1.1, ROAD_HALF_WIDTH - 1.1);
        break;
      }
    }

    // PD lateral steering controller
    const latErr = bot.targetX - st.x;
    const maxLatV = isEnraged ? 11.5 : 8.5;
    const desiredVx = clamp(latErr * (isEnraged ? 5.6 : 4.4), -maxLatV, maxLatV);
    st.vx += (desiredVx - st.vx) * Math.min(1, dt * (isEnraged ? 9.5 : 7.5));

    // Avoid overlapping local player's body
    if (!local.crashed && Math.abs(signedTrackDelta(st.s, local.s)) < 2.2) {
      const dxPlayer = st.x - local.x;
      const absDx = Math.abs(dxPlayer);
      if (absDx < 1.1) {
        const push = dxPlayer >= 0 ? 1 : -1;
        st.vx += push * 16.0 * dt;
      }
    }

    // Avoid overlapping other active bots
    for (let i = 0; i < this.bots.length; i++) {
      const other = this.bots[i];
      if (other === bot || !other.active || other.state.crashed) continue;
      if (Math.abs(signedTrackDelta(st.s, other.state.s)) < 2.4) {
        const dxBot = st.x - other.state.x;
        if (Math.abs(dxBot) < 1.35) {
          const push = dxBot >= 0 ? 1 : -1;
          st.vx += push * 14.0 * dt;
        }
      }
    }

    // Integrate motion
    st.s += (st.speed / this._frame.tangentLen) * dt;
    st.x = clamp(st.x + st.vx * dt, -MAX_LATERAL, MAX_LATERAL);
    const targetLean = clamp((st.vx / 11.0) * 0.48, -0.5, 0.5);
    st.lean += (targetLean - st.lean) * Math.min(1, dt * 10.0);
    st.wheelAngle = (st.wheelAngle + (st.speed / WHEEL_RADIUS) * dt) % (Math.PI * 2);

    // Traffic side-bump protection for bots (including cargo trucks)
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const isTruck = car.type === 4;
      const ds = signedTrackDelta(car.s, st.s);
      const halfL = isTruck ? 4.8 : 2.7;
      if (ds < -halfL || ds > halfL) continue;
      const carX = car.x + car.bumpOffset;
      const dx = st.x - carX;
      const halfW = isTruck ? 1.88 : 1.38;
      if (Math.abs(dx) < halfW) {
        const push = dx >= 0 ? 1 : -1;
        st.x = clamp(carX + push * (halfW + 0.12), -MAX_LATERAL, MAX_LATERAL);
        st.vx = push * 5.0;
        st.speed = Math.max(car.speed * 0.9, st.speed * 0.88);
      }
    }

    // Melee attacks when riding side-by-side with player
    // Calm delivery riders NEVER start fights; enraged delivery riders swing every 0.95s with 18 dmg;
    // regular bots swing leisurely every 1.85..2.6s with gentle 10..13 dmg!
    const canAttack = !isDelivery || isEnraged;
    const spec = WEAPONS[st.weapon];
    const effectiveReach = isEnraged ? 2.85 : spec.reach;
    if (
      canAttack &&
      st.attackSide === 0 &&
      bot.attackCooldown <= 0 &&
      !local.crashed &&
      local.invulnTimer <= 0
    ) {
      const dsPlayer = Math.abs(signedTrackDelta(st.s, local.s));
      const dxPlayer = local.x - st.x;
      const absDx = Math.abs(dxPlayer);
      if (dsPlayer < (isEnraged ? 3.1 : 2.5) && absDx >= 0.7 && absDx <= effectiveReach - 0.05) {
        if (!isEnraged && Math.random() > 0.52) {
          bot.attackCooldown = 0.55;
        } else {
          st.attackSide = dxPlayer < 0 ? 1 : 2;
          st.attackPhase = 0;
          bot.attackTimer = 0;
          bot.didHitThisSwing = false;
          bot.attackCooldown = isEnraged
            ? 0.95
            : 1.85 + (1.0 - p.aggression) * 0.65 + Math.random() * 0.55;
        }
      }
    }

    if (st.attackSide !== 0) {
      bot.attackTimer += dt;
      st.attackPhase = Math.min(1, bot.attackTimer / spec.duration);

      if (!bot.didHitThisSwing && st.attackPhase >= 0.36 && st.attackPhase <= 0.68) {
        const side = st.attackSide;
        const sideDist = side === 1 ? st.x - local.x : local.x - st.x;
        if (
          !local.crashed &&
          local.invulnTimer <= 0 &&
          Math.abs(signedTrackDelta(st.s, local.s)) < (isEnraged ? 3.3 : 2.9) &&
          Math.abs(local.y - st.y) < 1.1 &&
          sideDist >= 0.45 &&
          sideDist <= effectiveReach
        ) {
          bot.didHitThisSwing = true;
          const knockDir = side === 1 ? -1 : 1;
          const dmg = isEnraged ? 18 : st.weapon === 1 ? 13 : st.weapon === 2 ? 12 : 10;
          const knockX = knockDir * (isEnraged ? 11.0 : spec.knockback * 0.45);
          onBotHitPlayer(dmg, knockX, st.name);
        }
      }

      if (bot.attackTimer >= spec.duration) {
        st.attackSide = 0;
        st.attackPhase = 0;
        bot.attackTimer = 0;
      }
    }
  }

  private chooseBestLateralX(
    bot: BotAgent,
    local: RiderRenderState,
    traffic: TrafficCar[],
    inDuel: boolean,
    crates?: readonly CrateHint[]
  ): number {
    const st = bot.state;
    let idealX: number = LANE_CENTERS[bot.profile.prefLane];
    const wantsCrate = (st.heldItems?.length ?? 0) < BOT_MAX_HELD_ITEMS;

    if (inDuel && Math.abs(signedTrackDelta(st.s, local.s)) < 14.0) {
      idealX = clamp(
        local.x + bot.duelSide * 1.95,
        -ROAD_HALF_WIDTH + 1.2,
        ROAD_HALF_WIDTH - 1.2
      );
    }

    // Score each lane center plus ideal duel X for traffic clearance & nearby '?' crates
    let bestX = idealX;
    let bestScore = -1e9;

    for (let c = 0; c < 5; c++) {
      const candX = c < 4 ? LANE_CENTERS[c] : idealX;
      let score = -Math.abs(candX - idealX) * 1.4 - Math.abs(candX - st.x) * 0.45;

      // Gentle steering bias toward upcoming '?' mystery crates when safe
      if (wantsCrate && crates && crates.length > 0) {
        for (let k = 0; k < crates.length; k++) {
          const cr = crates[k];
          const ds = signedTrackDelta(cr.s, st.s);
          if (ds < 3.0 || ds > 44.0) continue;
          if (Math.abs(cr.x - candX) < 1.35) {
            score += 9.0 * (1.0 - ds / 44.0);
          }
        }
      }

      for (let i = 0; i < traffic.length; i++) {
        const car = traffic[i];
        const ds = signedTrackDelta(car.s, st.s);
        if (ds < -3.0 || ds > 46.0) continue;
        const carX = car.x + car.bumpOffset;
        const dx = Math.abs(carX - candX);
        if (dx < 2.2) {
          const proximity = 1.0 - clamp((ds + 3.0) / 49.0, 0, 1);
          score -= (28.0 + proximity * 75.0) * (1.0 - dx / 2.2);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestX = candX;
      }
    }

    return clamp(bestX, -ROAD_HALF_WIDTH + 1.1, ROAD_HALF_WIDTH - 1.1);
  }
}
