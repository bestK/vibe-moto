import {
  LANE_CENTERS,
  MAX_LATERAL,
  ROAD_HALF_WIDTH,
  RoadFrame,
  sampleRoadFrame,
  signedTrackDelta,
} from './RoadMath';
import { AVATAR_COUNT } from './PixelAvatars';
import { MAX_HELD_ITEMS, RiderRenderState, TrafficCar, WEAPONS, WeaponType } from './types';

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
}

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
  },
] as const;

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

  constructor() {
    for (let i = 0; i < BOT_PROFILES.length; i++) {
      const p = BOT_PROFILES[i];
      this.bots.push({
        profile: p,
        active: false,
        targetX: LANE_CENTERS[p.prefLane],
        attackTimer: 0,
        attackCooldown: 1.2 + i * 0.5,
        didHitThisSwing: false,
        duelTimer: 0,
        duelSide: i % 2 === 0 ? -1 : 1,
        laneTimer: 0.3 + i * 0.2,
        state: {
          id: p.id,
          name: p.name,
          isLocal: false,
          isBot: true,
          colorIdx: p.colorIdx,
          avatarIdx: ((p.avatarIdx % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT,
          s: 20 + p.baseOffsetS,
          x: LANE_CENTERS[p.prefLane],
          y: 0,
          speed: 18,
          vx: 0,
          lean: 0,
          hp: 100,
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
        },
      });
    }
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

    const targetBotCount = Math.max(0, 3 - nearbyRealCount);

    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      if (i >= targetBotCount) {
        bot.active = false;
        continue;
      }

      if (!bot.active || Math.abs(signedTrackDelta(bot.state.s, local.s)) > 155) {
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

      st.hp = Math.max(0, st.hp - dmg);
      st.vx = clamp(st.vx + knockX, -22, 22);
      st.speed = Math.max(12, st.speed * 0.87);
      st.attackSide = 0;
      st.attackPhase = 0;
      bot.attackTimer = 0;
      bot.attackCooldown = Math.max(bot.attackCooldown, 0.85);

      if (st.hp <= 0) {
        st.crashed = true;
        st.crashTimer = 0;
        st.nitroActive = false;
        st.braking = false;
        st.spinOutTimer = 0;
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
      st.spinOutTimer = Math.max(st.spinOutTimer, duration);
      st.speed = Math.max(10, st.speed * 0.62);
      st.hp = Math.max(0, st.hp - dmg);
      if (st.hp <= 0) {
        st.crashed = true;
        st.crashTimer = 0;
        st.spinOutTimer = 0;
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
    st.speed = Math.max(16, local.speed * 0.96);
    st.vx = 0;
    st.lean = 0;
    st.hp = 100;
    st.crashed = false;
    st.crashTimer = 0;
    st.attackSide = 0;
    st.attackPhase = 0;
    st.nitroActive = false;
    st.braking = false;
    st.invulnTimer = 1.0;

    bot.targetX = laneX;
    bot.attackTimer = 0;
    bot.attackCooldown = 1.4;
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

    sampleRoadFrame(st.s, this._frame);

    // Handle bot wipeout slide & recovery
    if (st.crashed) {
      st.crashTimer += dt;
      st.speed = Math.max(0, st.speed - 25.0 * dt);
      st.vx *= Math.exp(-3.0 * dt);
      st.s += (st.speed / this._frame.tangentLen) * dt;
      st.x = clamp(st.x + st.vx * dt, -MAX_LATERAL, MAX_LATERAL);

      if (st.crashTimer >= BOT_CRASH_DURATION) {
        st.crashed = false;
        st.crashTimer = 0;
        st.hp = 100;
        st.invulnTimer = 1.6;
        st.vx = 0;
        st.lean = 0;
        st.x = clamp(st.x, -ROAD_HALF_WIDTH + 1.2, ROAD_HALF_WIDTH - 1.2);
        // Rubber-band recover not too far behind player
        if (signedTrackDelta(st.s, local.s) < -34) {
          st.s = Math.max(0, local.s - 22);
        }
        st.speed = Math.max(20, local.speed * 0.92);
      }
      return;
    }

    // Periodic duel engagement when racing near player
    bot.duelTimer -= dt;
    if (bot.duelTimer <= -3.5) {
      bot.duelTimer = 3.2 + p.aggression * 2.5;
      bot.duelSide = st.x >= local.x ? 1 : -1;
    }
    const inDuel = bot.duelTimer > 0 && !local.crashed && local.speed > 18;

    // Smooth rubber-banding longitudinal target (cyclic across 2400m circuit!)
    const wave = Math.sin(this.time * p.waveFreq + p.wavePhase) * 14.0;
    const desiredOffset = inDuel ? 0.5 : p.baseOffsetS + wave;
    const errS = signedTrackDelta(local.s + desiredOffset, st.s);

    let desiredSpeed: number;
    if (st.turboShieldTimer > 0) {
      desiredSpeed = 80.0;
    } else if (local.speed < 6) {
      // Let bots cruise calmly past if player stops, then wait gently ahead
      desiredSpeed = errS < -45 ? 12.0 : 20.0;
    } else {
      desiredSpeed = clamp(local.speed + errS * 0.92, 16.0, 67.0);
    }

    const speedDiff = desiredSpeed - st.speed;
    const accel = speedDiff >= 0 ? Math.min(34.0, speedDiff * 2.6) : Math.max(-34.0, speedDiff * 3.0);
    st.speed = Math.max(10.0, st.speed + accel * dt);
    st.braking = speedDiff < -7.0;
    st.nitroActive = st.turboShieldTimer > 0 || (errS > 24.0 && local.speed > 34.0 && st.speed > 44.0);

    // Lane selection & traffic weaving (plus gentle bias toward road '?' crates!)
    bot.laneTimer -= dt;
    if (bot.laneTimer <= 0) {
      bot.laneTimer = 0.16;
      bot.targetX = this.chooseBestLateralX(bot, local, traffic, inDuel, crates);
    }

    // Check immediate traffic evasion override (cyclic across 2400m seam)
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const ds = signedTrackDelta(car.s, st.s);
      if (ds < -2.2 || ds > 26.0) continue;
      const carX = car.x + car.bumpOffset;
      if (Math.abs(carX - st.x) < 1.85) {
        // Swerve cleanly toward open side
        if (carX > 3.5) {
          bot.targetX = carX - 3.3;
        } else if (carX < -3.5) {
          bot.targetX = carX + 3.3;
        } else {
          bot.targetX = st.x >= carX ? carX + 3.3 : carX - 3.3;
        }
        bot.targetX = clamp(bot.targetX, -ROAD_HALF_WIDTH + 1.1, ROAD_HALF_WIDTH - 1.1);
        break;
      }
    }

    // PD lateral steering controller
    const latErr = bot.targetX - st.x;
    const desiredVx = clamp(latErr * 4.4, -8.5, 8.5);
    st.vx += (desiredVx - st.vx) * Math.min(1, dt * 7.5);

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

    // Traffic side-bump protection for bots
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const ds = signedTrackDelta(car.s, st.s);
      if (ds < -2.7 || ds > 2.7) continue;
      const carX = car.x + car.bumpOffset;
      const dx = st.x - carX;
      if (Math.abs(dx) < 1.38) {
        const push = dx >= 0 ? 1 : -1;
        st.x = clamp(carX + push * 1.48, -MAX_LATERAL, MAX_LATERAL);
        st.vx = push * 5.0;
        st.speed = Math.max(car.speed * 0.9, st.speed * 0.88);
      }
    }

    // Melee attacks when riding side-by-side with player
    const spec = WEAPONS[st.weapon];
    if (st.attackSide === 0 && bot.attackCooldown <= 0 && !local.crashed && local.invulnTimer <= 0) {
      const dsPlayer = Math.abs(signedTrackDelta(st.s, local.s));
      const dxPlayer = local.x - st.x;
      const absDx = Math.abs(dxPlayer);
      if (dsPlayer < 2.6 && absDx >= 0.75 && absDx <= spec.reach - 0.1) {
        st.attackSide = dxPlayer < 0 ? 1 : 2;
        st.attackPhase = 0;
        bot.attackTimer = 0;
        bot.didHitThisSwing = false;
        bot.attackCooldown = 1.9 + (1.0 - p.aggression) * 1.4;
      }
    }

    if (st.attackSide !== 0) {
      bot.attackTimer += dt;
      st.attackPhase = Math.min(1, bot.attackTimer / spec.duration);

      if (!bot.didHitThisSwing && st.attackPhase >= 0.38 && st.attackPhase <= 0.66) {
        const side = st.attackSide;
        const sideDist = side === 1 ? st.x - local.x : local.x - st.x;
        if (
          !local.crashed &&
          local.invulnTimer <= 0 &&
          Math.abs(signedTrackDelta(st.s, local.s)) < 3.0 &&
          Math.abs(local.y - st.y) < 1.05 &&
          sideDist >= 0.45 &&
          sideDist <= spec.reach
        ) {
          bot.didHitThisSwing = true;
          const knockDir = side === 1 ? -1 : 1;
          const dmg = Math.round(spec.damage * 0.65);
          const knockX = knockDir * spec.knockback * 0.8;
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
    const wantsCrate = (st.heldItems?.length ?? 0) < MAX_HELD_ITEMS;

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
            score += 22.0 * (1.0 - ds / 44.0);
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
