import { LANE_CENTERS, hash1 } from './RoadMath';
import { TrafficCar } from './types';

interface TrafficSlot {
  car: TrafficCar;
  seenStamp: number;
}

// 4 forward lanes (+s): left lanes are fast cruisers, right lanes steady highway flow
const LANE_SPEEDS = [32.5, 27.0, 22.5, 18.5] as const;
const LANE_SLOT_LEN = [94.0, 82.0, 78.0, 88.0] as const;
const LANE_SPAWN_CHANCE = [0.56, 0.6, 0.62, 0.58] as const;
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

    const minS = originS - VIEW_BEHIND;
    const maxS = originS + VIEW_AHEAD;

    for (let lane = 0; lane < 4; lane++) {
      const speed = LANE_SPEEDS[lane];
      const slotLen = LANE_SLOT_LEN[lane];
      const chance = LANE_SPAWN_CHANCE[lane];
      const laneX = LANE_CENTERS[lane];

      // Split baseShift = speed * nowSec into integer slot count + remainder
      // to keep high float64 precision around originS at any wall-clock timestamp.
      const baseShift = speed * nowSec;
      const kShift = Math.floor(baseShift / slotLen);
      const fracShift = baseShift - kShift * slotLen;

      const minIdx = Math.floor((minS - fracShift) / slotLen) - 1;
      const maxIdx = Math.floor((maxS - fracShift) / slotLen) + 1;

      for (let idx = minIdx; idx <= maxIdx; idx++) {
        // Deterministic car slot key shared by every online client
        const k = idx - kShift;
        const k32 = k | 0;
        const hSpawn = hash1(Math.imul(k32, 7919) ^ Math.imul(lane + 1, 104729) ^ 0x51f);
        if (hSpawn >= chance) continue;

        const hJitter = hash1(Math.imul(k32, 3571) ^ Math.imul(lane + 3, 4099));
        const jitter = 11.0 + hJitter * (slotLen - 22.0);
        const carS = idx * slotLen + fracShift + jitter;

        if (carS < minS || carS > maxS) continue;

        // Deterministic anti-wall safeguard on outer lane: never form an impassable 4-lane wall
        if (lane === 3 && this.wouldFormFourLaneWall(carS)) {
          continue;
        }

        const carId = k * 4 + lane;
        let slot = this.byId.get(carId);
        if (!slot) {
          slot = this.acquireSlot(originS);
          if (!slot) continue;

          const hType = hash1(Math.imul(k32, 1301) ^ Math.imul(lane + 5, 6133));
          let carType: 0 | 1 | 2 | 3 = 0;
          // Police cruisers more frequent in left fast lanes
          const policeThreshold = lane <= 1 ? 0.14 : 0.06;
          if (hType < policeThreshold) {
            carType = 3;
          } else if (hType < 0.4) {
            carType = 1;
          } else if (hType < 0.68) {
            carType = 2;
          }

          const colorIdx = Math.floor(
            hash1(Math.imul(k32, 2029) ^ Math.imul(lane + 7, 997)) * 8
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
      if (Math.abs(other.s - carS) < 8.5) {
        lanesBlocked |= 1 << other.lane;
      }
    }
    return (lanesBlocked & 0b0111) === 0b0111;
  }

  private acquireSlot(originS: number): TrafficSlot | undefined {
    const free = this.freeList.pop();
    if (free) return free;

    // Fallback: recycle the farthest stale slot if pool is saturated
    let worstIdx = -1;
    let worstDist = -1;
    for (let i = 0; i < this.activeSlots.length; i++) {
      const slot = this.activeSlots[i];
      if (slot.seenStamp === this.stamp) continue;
      const d = Math.abs(slot.car.s - originS);
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
