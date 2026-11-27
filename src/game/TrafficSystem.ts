import {
  LANE_CENTERS,
  TRACK_LENGTH,
  hash1,
  signedTrackDelta,
  wrapTrackS,
} from './RoadMath';
import { TrafficCar } from './types';

interface TrafficSlot {
  car: TrafficCar;
  seenStamp: number;
}

// 4 forward lanes (+s) with exact integer divisors of TRACK_LENGTH (2400m)
// so traffic wraps seamlessly around the 2400m circuit across every lap with zero pop!
const LANE_SPEEDS = [32.5, 27.0, 22.5, 18.5] as const;
const LANE_SLOT_COUNT = [24, 30, 30, 25] as const; // 24*100, 30*80, 30*80, 25*96 = 2400m
const LANE_SPAWN_CHANCE = [0.64, 0.68, 0.7, 0.66] as const;
const POOL_CAPACITY = 44;
const VIEW_BEHIND = 40.0;
const VIEW_AHEAD = 315.0;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class TrafficSystem {
  private readonly freeList: TrafficSlot[] = [];
  private readonly activeSlots: TrafficSlot[] = [];
  private readonly byId = new Map<number, TrafficSlot>();
  private readonly activeCars: TrafficCar[] = [];
  private stamp = 0;

  constructor() {
    for (let i = 0; i < POOL_CAPACITY; i++) {
      this.freeList.push({
        seenStamp: 0,
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
        },
      });
    }
  }

  update(originS: number, nowSec: number, dt: number): TrafficCar[] {
    const step = dt > 0.05 ? 0.05 : dt < 0 ? 0 : dt;
    this.stamp++;
    this.activeCars.length = 0;

    const wrappedOrigin = wrapTrackS(originS);

    for (let lane = 0; lane < 4; lane++) {
      const speed = LANE_SPEEDS[lane];
      const slotCount = LANE_SLOT_COUNT[lane];
      const slotLen = TRACK_LENGTH / slotCount;
      const chance = LANE_SPAWN_CHANCE[lane];
      const laneX = LANE_CENTERS[lane];

      // Keep phase offset wrapped onto [0, TRACK_LENGTH) for full float64 precision
      const shiftS = wrapTrackS(speed * nowSec);

      for (let k = 0; k < slotCount; k++) {
        const hSpawn = hash1(Math.imul(k, 7919) ^ Math.imul(lane + 1, 104729) ^ 0x51f);
        if (hSpawn >= chance) continue;

        const hJitter = hash1(Math.imul(k, 3571) ^ Math.imul(lane + 3, 4099));
        const jitter = 11.0 + hJitter * (slotLen - 22.0);
        const carS = wrapTrackS(k * slotLen + jitter + shiftS);

        const ds = signedTrackDelta(carS, wrappedOrigin);
        if (ds < -VIEW_BEHIND || ds > VIEW_AHEAD) continue;

        // Deterministic anti-wall safeguard on outer lane across cyclic ring
        if (lane === 3 && this.wouldFormFourLaneWall(carS)) {
          continue;
        }

        const carId = k * 4 + lane;
        let slot = this.byId.get(carId);
        if (!slot) {
          slot = this.acquireSlot(wrappedOrigin);
          if (!slot) continue;

          const hType = hash1(Math.imul(k, 1301) ^ Math.imul(lane + 5, 6133));
          let carType: 0 | 1 | 2 | 3 = 0;
          const policeThreshold = lane <= 1 ? 0.14 : 0.06;
          if (hType < policeThreshold) {
            carType = 3;
          } else if (hType < 0.4) {
            carType = 1;
          } else if (hType < 0.68) {
            carType = 2;
          }

          const colorIdx = Math.floor(
            hash1(Math.imul(k, 2029) ^ Math.imul(lane + 7, 997)) * 8
          );

          const c = slot.car;
          c.id = carId;
          c.lane = lane;
          c.s = carS;
          c.x = laneX;
          c.speed = speed;
          c.type = carType;
          c.colorIdx = colorIdx;
          c.bumpOffset = 0;
          c.bumpVel = 0;
          c.honked = false;
          c.nearMissed = false;

          this.byId.set(carId, slot);
          this.activeSlots.push(slot);
        } else {
          slot.car.s = carS;
          slot.car.x = laneX;
          slot.car.speed = speed;
        }

        // Update spring-damper bump sway
        const c = slot.car;
        if (c.bumpOffset !== 0 || c.bumpVel !== 0) {
          const springAcc = -26.0 * c.bumpOffset - 7.5 * c.bumpVel;
          c.bumpVel += springAcc * step;
          c.bumpOffset = clamp(c.bumpOffset + c.bumpVel * step, -1.15, 1.15);
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

    return this.activeCars;
  }

  bumpCar(carId: number, dirX: number): void {
    const slot = this.byId.get(carId);
    if (!slot) return;
    const sign = dirX === 0 ? 1 : dirX > 0 ? 1 : -1;
    slot.car.bumpVel = clamp(slot.car.bumpVel + sign * 4.5, -9.0, 9.0);
  }

  private wouldFormFourLaneWall(carS: number): boolean {
    let lanesBlocked = 0;
    for (let i = 0; i < this.activeCars.length; i++) {
      const other = this.activeCars[i];
      if (Math.abs(signedTrackDelta(other.s, carS)) < 8.5) {
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
