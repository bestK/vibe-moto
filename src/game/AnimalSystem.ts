import { t } from '../i18n';
import {
  ROAD_HALF_WIDTH,
  SHOULDER_HALF_WIDTH,
  TRACK_LENGTH,
  signedTrackDelta,
  wrapTrackS,
} from './RoadMath';

export type AnimalSpecies = 'cow' | 'sheep' | 'dog' | 'boar' | 'goose';

export interface CrossingAnimal {
  id: number;
  species: AnimalSpecies;
  s: number;
  x: number;
  dir: -1 | 1;
  speedX: number;
  phase: number;
  size: number;
  hitTimer: number;
  active: boolean;
}

export interface AnimalCallbacks {
  onWarn(text: string, species: AnimalSpecies): void;
  onPlayerHit(species: AnimalSpecies, x: number): void;
  onAnimalDodged?(species: AnimalSpecies): void;
}

export const MAX_ANIMALS = 16;

type AnimalWarnKey =
  | 'animalWarn_cow'
  | 'animalWarn_sheep'
  | 'animalWarn_dog'
  | 'animalWarn_boar'
  | 'animalWarn_goose';

interface EncounterSpec {
  species: AnimalSpecies;
  warnKey: AnimalWarnKey;
  minCount: number;
  maxCount: number;
  minSpeed: number;
  maxSpeed: number;
  minSize: number;
  maxSize: number;
}

const ENCOUNTERS: readonly EncounterSpec[] = [
  {
    species: 'cow',
    warnKey: 'animalWarn_cow',
    minCount: 3,
    maxCount: 4,
    minSpeed: 2.0,
    maxSpeed: 2.7,
    minSize: 1.24,
    maxSize: 1.38,
  },
  {
    species: 'sheep',
    warnKey: 'animalWarn_sheep',
    minCount: 4,
    maxCount: 6,
    minSpeed: 2.6,
    maxSpeed: 3.4,
    minSize: 0.86,
    maxSize: 0.98,
  },
  {
    species: 'dog',
    warnKey: 'animalWarn_dog',
    minCount: 1,
    maxCount: 1,
    minSpeed: 4.6,
    maxSpeed: 6.2,
    minSize: 0.78,
    maxSize: 0.86,
  },
  {
    species: 'boar',
    warnKey: 'animalWarn_boar',
    minCount: 1,
    maxCount: 1,
    minSpeed: 4.2,
    maxSpeed: 5.6,
    minSize: 0.98,
    maxSize: 1.08,
  },
  {
    species: 'goose',
    warnKey: 'animalWarn_goose',
    minCount: 1,
    maxCount: 1,
    minSpeed: 4.2,
    maxSpeed: 5.4,
    minSize: 0.72,
    maxSize: 0.8,
  },
] as const;

/**
 * Zero-GC cyclic road-crossing animal herd & solo critter manager for the Chinese highway.
 */
export class AnimalSystem {
  private readonly pool: CrossingAnimal[] = [];
  private readonly dodgedFlags = new Uint8Array(MAX_ANIMALS);
  private spawnTimer = 11.5;
  private lastEncounterIdx = -1;

  constructor() {
    for (let i = 0; i < MAX_ANIMALS; i++) {
      this.pool.push({
        id: i,
        species: 'cow',
        s: 0,
        x: 0,
        dir: 1,
        speedX: 2.5,
        phase: 0,
        size: 1.0,
        hitTimer: 0,
        active: false,
      });
    }
  }

  public getAnimals(): readonly CrossingAnimal[] {
    return this.pool;
  }

  public reset(): void {
    for (let i = 0; i < MAX_ANIMALS; i++) {
      this.pool[i].active = false;
      this.pool[i].hitTimer = 0;
      this.dodgedFlags[i] = 0;
    }
    this.spawnTimer = 11.5;
    this.lastEncounterIdx = -1;
  }

  private allocSlot(): number {
    for (let i = 0; i < MAX_ANIMALS; i++) {
      if (!this.pool[i].active) return i;
    }
    return -1;
  }

  private spawnEncounter(localS: number, cb: AnimalCallbacks): void {
    // Pick encounter species, avoiding immediate back-to-back duplicates
    let idx = Math.floor(Math.random() * ENCOUNTERS.length);
    if (idx === this.lastEncounterIdx) {
      idx = (idx + 1 + Math.floor(Math.random() * (ENCOUNTERS.length - 1))) % ENCOUNTERS.length;
    }
    this.lastEncounterIdx = idx;
    const spec = ENCOUNTERS[idx];

    const count =
      spec.minCount === spec.maxCount
        ? spec.minCount
        : spec.minCount + Math.floor(Math.random() * (spec.maxCount - spec.minCount + 1));

    const dir: -1 | 1 = Math.random() < 0.5 ? 1 : -1;
    const leadS = wrapTrackS(localS + 145 + Math.random() * 35);
    const isHerd = count > 1;
    let spawned = 0;

    for (let k = 0; k < count; k++) {
      const slotIdx = this.allocSlot();
      if (slotIdx < 0) break;

      const a = this.pool[slotIdx];
      const speedX = spec.minSpeed + Math.random() * (spec.maxSpeed - spec.minSpeed);
      const size = spec.minSize + Math.random() * (spec.maxSize - spec.minSize);

      // Position lead animal near entry shoulder so herd/critter crosses the asphalt right as player arrives
      let startX: number;
      let startS: number;
      if (isHerd) {
        const lateralStagger = k * (spec.species === 'cow' ? 2.5 : 1.75) + Math.random() * 0.9;
        startX = -dir * (ROAD_HALF_WIDTH + 0.8 + lateralStagger);
        startS = wrapTrackS(leadS + k * 2.1 + (Math.random() - 0.5) * 2.2);
      } else {
        startX = -dir * (SHOULDER_HALF_WIDTH + 1.8);
        startS = leadS;
      }

      a.species = spec.species;
      a.s = startS;
      a.x = startX;
      a.dir = dir;
      a.speedX = speedX;
      a.phase = Math.random() * Math.PI * 2;
      a.size = size;
      a.hitTimer = 0;
      a.active = true;
      this.dodgedFlags[slotIdx] = 0;
      spawned++;
    }

    if (spawned > 0) {
      cb.onWarn(t(spec.warnKey), spec.species);
    }
  }

  public update(
    dt: number,
    localS: number,
    localX: number,
    localY: number,
    localSpeed: number,
    localCrashed: boolean,
    localInvuln: boolean,
    turboShield: boolean,
    cb: AnimalCallbacks
  ): readonly CrossingAnimal[] {
    const step = Math.min(Math.max(dt, 0), 0.1);
    const exitBound = SHOULDER_HALF_WIDTH + 4.0;
    const wrappedLocalS = wrapTrackS(localS);

    // Tick spawn cadence while moving at highway speed
    if (localSpeed > 10 && !localCrashed) {
      this.spawnTimer -= step;
      if (this.spawnTimer <= 0) {
        this.spawnEncounter(wrappedLocalS, cb);
        this.spawnTimer = 14.0 + Math.random() * 8.0; // 14..22s cadence
      }
    }

    for (let i = 0; i < MAX_ANIMALS; i++) {
      const a = this.pool[i];
      if (!a.active) continue;

      if (a.hitTimer > 0) {
        a.hitTimer = Math.max(0, a.hitTimer - step);
        a.x += a.dir * (a.speedX * 2.6 + 7.5) * step;
        a.phase += step * 16.0;
      } else {
        a.x += a.dir * a.speedX * step;
        a.phase += step * a.speedX * 2.8;
      }

      const relS = signedTrackDelta(a.s, wrappedLocalS);

      // Recycle once cleanly across the far shoulder or well behind the rider
      if (a.x * a.dir > exitBound || relS < -35 || relS > TRACK_LENGTH * 0.45) {
        a.active = false;
        a.hitTimer = 0;
        this.dodgedFlags[i] = 0;
        continue;
      }

      // Check collision against local rider
      if (!localCrashed && a.hitTimer <= 0) {
        const absDs = Math.abs(relS);
        const absDx = Math.abs(a.x - localX);
        if (absDs < 1.35 * a.size && absDx < 0.95 * a.size) {
          if (localY > 0.55) {
            if (this.dodgedFlags[i] === 0) {
              this.dodgedFlags[i] = 1;
              cb.onAnimalDodged?.(a.species);
            }
          } else if (turboShield || localInvuln) {
            a.hitTimer = 1.0;
            a.dir = a.x >= localX ? 1 : -1;
          } else {
            a.hitTimer = 1.0;
            a.dir = a.x >= localX ? 1 : -1;
            cb.onPlayerHit(a.species, a.x);
          }
        }
      }
    }

    return this.pool;
  }
}
