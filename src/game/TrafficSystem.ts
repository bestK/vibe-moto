import {
  LANE_CENTERS,
  MAX_LATERAL,
  TRACK_LENGTH,
  hash1,
  signedTrackDelta,
  wrapTrackS,
} from './RoadMath';
import { FallenCargo, TrafficCar } from './types';

interface TrafficSlot {
  car: TrafficCar;
  seenStamp: number;
  sLag: number;
}

export type CarItemEffectKind = 'blast' | 'banana' | 'trap' | 'sniper' | 'police' | 'magnet';

export type TruckBroadcastKey =
  | 'truckBlast'
  | 'truckBanana'
  | 'truckTrap'
  | 'truckPolice'
  | 'truckMagnet';

export interface CarItemEffectResult {
  hit: boolean;
  isTruck: boolean;
  broadcastKey: TruckBroadcastKey | null;
}

// 4 forward lanes (+s) with exact integer divisors of TRACK_LENGTH (2400m):
// Outer lanes (x = ±5.6) are slower heavy freight lanes (18.0 & 21.5 m/s) hosting Chinese overloaded cargo trucks!
// Inner lanes (x = ±1.9) are fast overtaking lanes (30.5 & 26.0 m/s).
const LANE_SPEEDS = [21.5, 30.5, 26.0, 18.0] as const;
const LANE_SLOT_COUNT = [24, 30, 30, 25] as const; // 24*100, 30*80, 30*80, 25*96 = 2400m
const LANE_SPAWN_CHANCE = [0.64, 0.66, 0.68, 0.66] as const;
const POOL_CAPACITY = 44;
const MAX_FALLEN_CARGO = 20;
const VIEW_BEHIND = 44.0;
const VIEW_AHEAD = 315.0;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class TrafficSystem {
  private readonly freeList: TrafficSlot[] = [];
  private readonly activeSlots: TrafficSlot[] = [];
  private readonly byId = new Map<number, TrafficSlot>();
  private readonly activeCars: TrafficCar[] = [];
  private readonly fallenCargo: FallenCargo[] = [];
  private stamp = 0;

  constructor() {
    for (let i = 0; i < POOL_CAPACITY; i++) {
      this.freeList.push({
        seenStamp: 0,
        sLag: 0,
        car: {
          id: 0,
          lane: 0,
          s: 0,
          x: 0,
          speed: 20,
          type: 0,
          colorIdx: 0,
          bumpOffset: 0,
          bumpVel: 0,
          honked: false,
          nearMissed: false,
          cargoStyle: 0,
          spinTimer: 0,
          slowTimer: 0,
          hitTilt: 0,
          cargoDropped: false,
        },
      });
    }
    for (let i = 0; i < MAX_FALLEN_CARGO; i++) {
      this.fallenCargo.push({
        active: false,
        s: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        vs: 0,
        life: 0,
        colorIdx: 0,
      });
    }
  }

  getFallenCargo(): readonly FallenCargo[] {
    return this.fallenCargo;
  }

  update(originS: number, nowSec: number, dt: number): TrafficCar[] {
    const step = dt > 0.05 ? 0.05 : dt < 0 ? 0 : dt;
    this.stamp++;
    this.activeCars.length = 0;

    const wrappedOrigin = wrapTrackS(originS);

    for (let lane = 0; lane < 4; lane++) {
      const baseSpeed = LANE_SPEEDS[lane];
      const slotCount = LANE_SLOT_COUNT[lane];
      const slotLen = TRACK_LENGTH / slotCount;
      const chance = LANE_SPAWN_CHANCE[lane];
      const laneX = LANE_CENTERS[lane];

      const shiftS = wrapTrackS(baseSpeed * nowSec);

      for (let k = 0; k < slotCount; k++) {
        const hSpawn = hash1(Math.imul(k, 7919) ^ Math.imul(lane + 1, 104729) ^ 0x51f);
        if (hSpawn >= chance) continue;

        const hJitter = hash1(Math.imul(k, 3571) ^ Math.imul(lane + 3, 4099));
        const jitter = 12.0 + hJitter * (slotLen - 24.0);
        const baseCarS = wrapTrackS(k * slotLen + jitter + shiftS);

        const carId = k * 4 + lane;
        let slot = this.byId.get(carId);
        const effectiveS = slot ? wrapTrackS(baseCarS + slot.sLag) : baseCarS;

        const ds = signedTrackDelta(effectiveS, wrappedOrigin);
        if (ds < -VIEW_BEHIND || ds > VIEW_AHEAD) continue;

        // Deterministic anti-wall safeguard on outer lane across cyclic ring
        if (lane === 3 && this.wouldFormFourLaneWall(effectiveS)) {
          continue;
        }

        if (!slot) {
          slot = this.acquireSlot(wrappedOrigin);
          if (!slot) continue;

          const hType = hash1(Math.imul(k, 1301) ^ Math.imul(lane + 5, 6133));
          let carType: 0 | 1 | 2 | 3 | 4 = 0;
          const isOuterLane = lane === 0 || lane === 3;
          if (isOuterLane && hType < 0.34) {
            // Classic Chinese overloaded cargo truck (~1 in 4-5 overall traffic vehicles!)
            carType = 4;
          } else if (!isOuterLane && hType < 0.13) {
            carType = 3; // police cruiser
          } else if (hType < 0.48) {
            carType = 1; // muscle
          } else if (hType < 0.74) {
            carType = 2; // pickup
          }

          const colorIdx = Math.floor(
            hash1(Math.imul(k, 2029) ^ Math.imul(lane + 7, 997)) * 8
          );
          const cargoStyle = Math.floor(
            hash1(Math.imul(k, 4999) ^ Math.imul(lane + 11, 353)) * 3
          );

          slot.sLag = 0;
          const c = slot.car;
          c.id = carId;
          c.lane = lane;
          c.s = baseCarS;
          c.x = laneX;
          c.speed = baseSpeed;
          c.type = carType;
          c.colorIdx = colorIdx;
          c.bumpOffset = 0;
          c.bumpVel = 0;
          c.honked = false;
          c.nearMissed = false;
          c.cargoStyle = cargoStyle;
          c.spinTimer = 0;
          c.slowTimer = 0;
          c.hitTilt = 0;
          c.cargoDropped = false;

          this.byId.set(carId, slot);
          this.activeSlots.push(slot);
        }

        const c = slot.car;

        // Tick item reaction timers (spinout, tire blowout slowdown, tilt)
        if (c.spinTimer && c.spinTimer > 0) {
          c.spinTimer = Math.max(0, c.spinTimer - step);
        }
        if (c.slowTimer && c.slowTimer > 0) {
          c.slowTimer = Math.max(0, c.slowTimer - step);
          slot.sLag = Math.max(-18.0, slot.sLag - baseSpeed * 0.48 * step);
          c.speed = baseSpeed * 0.52;
        } else {
          if (slot.sLag < 0) {
            slot.sLag = Math.min(0, slot.sLag + 4.5 * step);
          }
          c.speed = baseSpeed;
        }
        if (c.hitTilt && Math.abs(c.hitTilt) > 0.001) {
          c.hitTilt *= Math.exp(-2.8 * step);
          if (Math.abs(c.hitTilt) < 0.002) c.hitTilt = 0;
        }

        c.s = wrapTrackS(baseCarS + slot.sLag);
        c.x = laneX;

        // Update spring-damper bump sway
        if (c.bumpOffset !== 0 || c.bumpVel !== 0) {
          const springAcc = -24.0 * c.bumpOffset - 7.0 * c.bumpVel;
          c.bumpVel += springAcc * step;
          c.bumpOffset = clamp(c.bumpOffset + c.bumpVel * step, -1.5, 1.5);
          if (Math.abs(c.bumpOffset) < 0.002 && Math.abs(c.bumpVel) < 0.01) {
            c.bumpOffset = 0;
            c.bumpVel = 0;
          }
        }

        slot.seenStamp = this.stamp;
        this.activeCars.push(c);
      }
    }

    // Recycle cars outside the active window back to the free pool (zero allocations)
    for (let i = this.activeSlots.length - 1; i >= 0; i--) {
      const slot = this.activeSlots[i];
      if (slot.seenStamp !== this.stamp) {
        this.byId.delete(slot.car.id);
        this.freeList.push(slot);
        const last = this.activeSlots.pop()!;
        if (i < this.activeSlots.length) {
          this.activeSlots[i] = last;
        }
      }
    }

    // Update tumbling fallen cargo debris crates
    for (let i = 0; i < this.fallenCargo.length; i++) {
      const f = this.fallenCargo[i];
      if (!f.active) continue;
      f.life -= step;
      if (f.life <= 0 || signedTrackDelta(f.s, wrappedOrigin) < -45) {
        f.active = false;
        continue;
      }
      f.s = wrapTrackS(f.s + f.vs * step);
      f.x = clamp(f.x + f.vx * step, -MAX_LATERAL + 0.6, MAX_LATERAL - 0.6);
      f.y += f.vy * step;
      f.vy -= 18.0 * step;
      if (f.y < 0.34) {
        f.y = 0.34;
        f.vy = Math.abs(f.vy) > 2.2 ? -f.vy * 0.42 : 0;
        f.vx *= Math.exp(-3.5 * step);
        f.vs *= Math.exp(-2.6 * step);
      }
    }

    return this.activeCars;
  }

  bumpCar(carId: number, dirX: number): void {
    const slot = this.byId.get(carId);
    if (!slot) return;
    const sign = dirX === 0 ? 1 : dirX > 0 ? 1 : -1;
    slot.car.bumpVel = clamp(slot.car.bumpVel + sign * 4.5, -9.0, 9.0);
  }

  applyItemEffectToCar(
    carId: number,
    kind: CarItemEffectKind,
    dirX: number
  ): CarItemEffectResult {
    const slot = this.byId.get(carId);
    if (!slot) {
      return { hit: false, isTruck: false, broadcastKey: null };
    }

    const c = slot.car;
    const isTruck = c.type === 4;
    const sign = dirX === 0 ? (c.x >= 0 ? -1 : 1) : dirX > 0 ? 1 : -1;

    switch (kind) {
      case 'blast':
        c.hitTilt = sign * 0.46;
        c.slowTimer = Math.max(c.slowTimer ?? 0, 4.0);
        c.bumpVel = clamp(c.bumpVel + sign * 7.0, -10, 10);
        if (isTruck) {
          c.cargoDropped = true;
          this.scatterCargo(c.s, c.x + c.bumpOffset, c.speed, c.cargoStyle ?? 0);
          return {
            hit: true,
            isTruck: true,
            broadcastKey: 'truckBlast',
          };
        }
        return { hit: true, isTruck: false, broadcastKey: null };

      case 'banana':
        c.spinTimer = Math.max(c.spinTimer ?? 0, 2.4);
        c.slowTimer = Math.max(c.slowTimer ?? 0, 3.0);
        c.bumpVel = clamp(c.bumpVel + sign * 5.5, -10, 10);
        return {
          hit: true,
          isTruck,
          broadcastKey: isTruck ? 'truckBanana' : null,
        };

      case 'trap':
      case 'sniper':
        c.slowTimer = Math.max(c.slowTimer ?? 0, 4.5);
        c.hitTilt = sign * 0.28;
        c.bumpVel = clamp(c.bumpVel + sign * 5.0, -9, 9);
        return {
          hit: true,
          isTruck,
          broadcastKey: isTruck ? 'truckTrap' : null,
        };

      case 'police':
        c.slowTimer = Math.max(c.slowTimer ?? 0, 3.5);
        c.bumpVel = clamp(c.bumpVel + sign * 2.5, -8, 8);
        return {
          hit: true,
          isTruck,
          broadcastKey: isTruck ? 'truckPolice' : null,
        };

      case 'magnet':
        c.bumpVel = clamp(c.bumpVel + sign * 4.8, -8, 8);
        return { hit: true, isTruck, broadcastKey: null };
    }
  }

  private scatterCargo(s: number, x: number, carSpeed: number, cargoStyle: number): void {
    let spawned = 0;
    for (let i = 0; i < this.fallenCargo.length && spawned < 6; i++) {
      const f = this.fallenCargo[i];
      if (!f.active) {
        this.initFallenCargo(f, s, x, carSpeed, cargoStyle, spawned);
        spawned++;
      }
    }
    // Overwrite oldest if pool full
    for (let i = 0; spawned < 6 && i < this.fallenCargo.length; i++, spawned++) {
      this.initFallenCargo(this.fallenCargo[i], s, x, carSpeed, cargoStyle, spawned);
    }
  }

  private initFallenCargo(
    f: FallenCargo,
    s: number,
    x: number,
    carSpeed: number,
    cargoStyle: number,
    idx: number
  ): void {
    const spreadSide = idx % 2 === 0 ? -1 : 1;
    f.active = true;
    f.s = wrapTrackS(s - 1.5 - idx * 1.15);
    f.x = clamp(x + spreadSide * (0.6 + (idx % 3) * 0.45), -MAX_LATERAL + 1, MAX_LATERAL - 1);
    f.y = 2.0 + (idx % 3) * 0.4;
    f.vx = spreadSide * (2.6 + (idx % 3) * 1.6);
    f.vy = 4.5 + (idx % 3) * 1.8;
    f.vs = Math.max(4, carSpeed * 0.55 - idx * 1.4);
    f.life = 7.0;
    f.colorIdx = (cargoStyle * 2 + idx) % 6;
  }

  private wouldFormFourLaneWall(carS: number): boolean {
    let lanesBlocked = 0;
    for (let i = 0; i < this.activeCars.length; i++) {
      const other = this.activeCars[i];
      if (Math.abs(signedTrackDelta(other.s, carS)) < 10.0) {
        lanesBlocked |= 1 << other.lane;
      }
    }
    return (lanesBlocked & 0b0111) === 0b0111;
  }

  private acquireSlot(wrappedOrigin: number): TrafficSlot | undefined {
    const free = this.freeList.pop();
    if (free) return free;

    let worstIdx = -1;
    let worstDist = -1;
    for (let i = 0; i < this.activeSlots.length; i++) {
      const slot = this.activeSlots[i];
      if (slot.seenStamp === this.stamp) continue;
      const d = Math.abs(signedTrackDelta(slot.car.s, wrappedOrigin));
      if (d > worstDist) {
        worstDist = d;
        worstIdx = i;
      }
    }
    if (worstIdx >= 0) {
      const slot = this.activeSlots[worstIdx];
      this.byId.delete(slot.car.id);
      const last = this.activeSlots.pop()!;
      if (worstIdx < this.activeSlots.length) {
        this.activeSlots[worstIdx] = last;
      }
      return slot;
    }
    return undefined;
  }
}
