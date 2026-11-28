import * as THREE from 'three';

export type WeatherId = 'clear' | 'sunset' | 'storm' | 'fog' | 'snow';

export const WEATHER_ORDER: readonly WeatherId[] = [
  'clear',
  'sunset',
  'storm',
  'fog',
  'snow',
] as const;

export interface WeatherPhysicsMod {
  grip: number; // Lateral tire damping & steer stability multiplier (1.0 dry, <1 wet/icy)
  brakeMul: number; // Braking deceleration multiplier
  windX: number; // Instantaneous crosswind acceleration (m/s^2)
  sprayKind: 'none' | 'water' | 'snow';
}

export interface WeatherVisualSpec {
  id: WeatherId;
  fogColor: THREE.Color;
  fogBlendBiome: number; // 0 = pure weather fog, 1 = full biome fog
  fogNear: number;
  fogFar: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  roadTint: THREE.Color;
  terrainTint: THREE.Color;
  terrainBlend: number; // How strongly weather tint overrides/mixes biome terrain tint
  headlightOpacity: number; // Headlight road beam visibility (0..1)
  lampBoost: boolean; // Force highway street lamps visible
  precipKind: 'none' | 'rain' | 'snow' | 'fog';
  precipDensity: number; // 0..1
  ambienceLevel: number; // 0..1 procedural audio level
}

export interface WeatherRenderSnapshot {
  current: WeatherId;
  prev: WeatherId;
  transition: number; // 0..1 smooth sky crossfade progress
  fogColor: THREE.Color;
  fogBlendBiome: number;
  fogNear: number;
  fogFar: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  roadTint: THREE.Color;
  terrainTint: THREE.Color;
  terrainBlend: number;
  headlightOpacity: number;
  lampBoost: boolean;
  rainIntensity: number;
  snowIntensity: number;
  fogWispIntensity: number;
  lightningFlash: number; // 0..1 brief sky/light flash
  windX: number;
  ambienceMode: 'none' | 'rain' | 'fog' | 'snow';
  ambienceLevel: number;
}

const WEATHER_SPECS: Readonly<Record<WeatherId, WeatherVisualSpec>> = {
  clear: {
    id: 'clear',
    fogColor: new THREE.Color('#9cd3f0'),
    fogBlendBiome: 0.45,
    fogNear: 112,
    fogFar: 345,
    sunColor: new THREE.Color('#fff1d4'),
    sunIntensity: 1.52,
    hemiSky: new THREE.Color('#b6e0ff'),
    hemiGround: new THREE.Color('#4a5b50'),
    hemiIntensity: 1.24,
    roadTint: new THREE.Color('#ffffff'),
    terrainTint: new THREE.Color('#ffffff'),
    terrainBlend: 0.0,
    headlightOpacity: 0.0,
    lampBoost: false,
    precipKind: 'none',
    precipDensity: 0,
    ambienceLevel: 0,
  },
  sunset: {
    id: 'sunset',
    fogColor: new THREE.Color('#f0956a'),
    fogBlendBiome: 0.52,
    fogNear: 96,
    fogFar: 315,
    sunColor: new THREE.Color('#ffbd78'),
    sunIntensity: 1.42,
    hemiSky: new THREE.Color('#ffd3a1'),
    hemiGround: new THREE.Color('#3b3354'),
    hemiIntensity: 1.08,
    roadTint: new THREE.Color('#f5e5dc'),
    terrainTint: new THREE.Color('#f0b68a'),
    terrainBlend: 0.28,
    headlightOpacity: 0.34,
    lampBoost: true,
    precipKind: 'none',
    precipDensity: 0,
    ambienceLevel: 0,
  },
  storm: {
    id: 'storm',
    fogColor: new THREE.Color('#36475e'),
    fogBlendBiome: 0.14,
    fogNear: 58,
    fogFar: 215,
    sunColor: new THREE.Color('#9cb4d6'),
    sunIntensity: 0.78,
    hemiSky: new THREE.Color('#6a82a3'),
    hemiGround: new THREE.Color('#1d2638'),
    hemiIntensity: 0.92,
    roadTint: new THREE.Color('#7a8ba3'), // glossy darkened wet asphalt
    terrainTint: new THREE.Color('#5a707d'),
    terrainBlend: 0.46,
    headlightOpacity: 0.88,
    lampBoost: true,
    precipKind: 'rain',
    precipDensity: 1.0,
    ambienceLevel: 1.0,
  },
  fog: {
    id: 'fog',
    fogColor: new THREE.Color('#b6c8d6'),
    fogBlendBiome: 0.08,
    fogNear: 20,
    fogFar: 118,
    sunColor: new THREE.Color('#d9e6f0'),
    sunIntensity: 0.84,
    hemiSky: new THREE.Color('#c7d8e6'),
    hemiGround: new THREE.Color('#5d6f7d'),
    hemiIntensity: 1.18,
    roadTint: new THREE.Color('#c4ced9'),
    terrainTint: new THREE.Color('#9ab0bd'),
    terrainBlend: 0.42,
    headlightOpacity: 0.92,
    lampBoost: true,
    precipKind: 'fog',
    precipDensity: 1.0,
    ambienceLevel: 0.65,
  },
  snow: {
    id: 'snow',
    fogColor: new THREE.Color('#c4d8ea'),
    fogBlendBiome: 0.12,
    fogNear: 56,
    fogFar: 218,
    sunColor: new THREE.Color('#e3f0ff'),
    sunIntensity: 1.18,
    hemiSky: new THREE.Color('#d2e8ff'),
    hemiGround: new THREE.Color('#6c8096'),
    hemiIntensity: 1.2,
    roadTint: new THREE.Color('#ced9e6'),
    terrainTint: new THREE.Color('#dce9f5'), // frosted snow-dusted hills
    terrainBlend: 0.72,
    headlightOpacity: 0.56,
    lampBoost: true,
    precipKind: 'snow',
    precipDensity: 1.0,
    ambienceLevel: 0.75,
  },
};

const AUTO_CYCLE_SEC = 240.0;
const MANUAL_HOLD_SEC = 360.0;
const AUTO_TRANSITION_SEC = 8.0;
const MANUAL_TRANSITION_SEC = 0.85;

export interface WeatherCallbacks {
  onWeatherChange?(weather: WeatherId, manual: boolean): void;
  onThunder?(intensity: number): void;
}

export class WeatherSystem {
  private current: WeatherId = 'clear';
  private prev: WeatherId = 'clear';
  private transition = 1.0;
  private transitionDuration = AUTO_TRANSITION_SEC;
  private cycleTimer = AUTO_CYCLE_SEC;
  private windPhase = 0;

  // Storm lightning state
  private lightningCooldown = 5.5;
  private lightningFlash = 0;
  private thunderDelay = -1;
  private pendingThunderIntensity = 0.7;

  // Reusable zero-GC output snapshots
  readonly physics: WeatherPhysicsMod = {
    grip: 1.0,
    brakeMul: 1.0,
    windX: 0,
    sprayKind: 'none',
  };

  readonly render: WeatherRenderSnapshot;

  constructor(initial: WeatherId = 'clear') {
    this.current = initial;
    this.prev = initial;
    const spec = WEATHER_SPECS[initial];
    this.render = {
      current: initial,
      prev: initial,
      transition: 1.0,
      fogColor: spec.fogColor.clone(),
      fogBlendBiome: spec.fogBlendBiome,
      fogNear: spec.fogNear,
      fogFar: spec.fogFar,
      sunColor: spec.sunColor.clone(),
      sunIntensity: spec.sunIntensity,
      hemiSky: spec.hemiSky.clone(),
      hemiGround: spec.hemiGround.clone(),
      hemiIntensity: spec.hemiIntensity,
      roadTint: spec.roadTint.clone(),
      terrainTint: spec.terrainTint.clone(),
      terrainBlend: spec.terrainBlend,
      headlightOpacity: spec.headlightOpacity,
      lampBoost: spec.lampBoost,
      rainIntensity: spec.precipKind === 'rain' ? 1 : 0,
      snowIntensity: spec.precipKind === 'snow' ? 1 : 0,
      fogWispIntensity: spec.precipKind === 'fog' ? 1 : 0,
      lightningFlash: 0,
      windX: 0,
      ambienceMode:
        spec.precipKind === 'rain'
          ? 'rain'
          : spec.precipKind === 'snow'
            ? 'snow'
            : spec.precipKind === 'fog'
              ? 'fog'
              : 'none',
      ambienceLevel: spec.ambienceLevel,
    };
  }

  getWeather(): WeatherId {
    return this.current;
  }

  setWeather(next: WeatherId, manual: boolean, cb?: WeatherCallbacks): void {
    if (next === this.current) {
      if (manual) {
        this.cycleTimer = MANUAL_HOLD_SEC;
      }
      return;
    }
    this.prev = this.current;
    this.current = next;
    this.transition = 0.0;
    this.transitionDuration = manual ? MANUAL_TRANSITION_SEC : AUTO_TRANSITION_SEC;
    this.cycleTimer = manual ? MANUAL_HOLD_SEC : AUTO_CYCLE_SEC;
    if (next === 'storm') {
      this.lightningCooldown = 2.6 + Math.random() * 2.5;
    } else {
      this.lightningFlash = 0;
      this.thunderDelay = -1;
    }
    cb?.onWeatherChange?.(next, manual);
  }

  cycleWeather(cb?: WeatherCallbacks): WeatherId {
    const idx = WEATHER_ORDER.indexOf(this.current);
    const next = WEATHER_ORDER[(idx + 1) % WEATHER_ORDER.length];
    this.setWeather(next, true, cb);
    return next;
  }

  update(dt: number, cb?: WeatherCallbacks): void {
    const step = dt > 0.05 ? 0.05 : dt < 0.0001 ? 0.0001 : dt;
    this.windPhase += step;

    // Natural dynamic weather progression
    this.cycleTimer -= step;
    if (this.cycleTimer <= 0) {
      const idx = WEATHER_ORDER.indexOf(this.current);
      const next = WEATHER_ORDER[(idx + 1) % WEATHER_ORDER.length];
      this.setWeather(next, false, cb);
    }

    if (this.transition < 1.0) {
      this.transition = Math.min(1.0, this.transition + step / this.transitionDuration);
    }

    const spec = WEATHER_SPECS[this.current];
    const blendRate = Math.min(
      1,
      step * (this.transitionDuration < 1.2 ? 4.4 : 3.2 / this.transitionDuration)
    );
    const r = this.render;

    r.current = this.current;
    r.prev = this.prev;
    r.transition = this.transition;
    r.fogColor.lerp(spec.fogColor, blendRate);
    r.fogBlendBiome += (spec.fogBlendBiome - r.fogBlendBiome) * blendRate;
    r.fogNear += (spec.fogNear - r.fogNear) * blendRate;
    r.fogFar += (spec.fogFar - r.fogFar) * blendRate;
    r.sunColor.lerp(spec.sunColor, blendRate);
    r.sunIntensity += (spec.sunIntensity - r.sunIntensity) * blendRate;
    r.hemiSky.lerp(spec.hemiSky, blendRate);
    r.hemiGround.lerp(spec.hemiGround, blendRate);
    r.hemiIntensity += (spec.hemiIntensity - r.hemiIntensity) * blendRate;
    r.roadTint.lerp(spec.roadTint, blendRate);
    r.terrainTint.lerp(spec.terrainTint, blendRate);
    r.terrainBlend += (spec.terrainBlend - r.terrainBlend) * blendRate;
    r.headlightOpacity += (spec.headlightOpacity - r.headlightOpacity) * blendRate;
    r.lampBoost = spec.lampBoost || r.headlightOpacity > 0.28;

    const targetRain = spec.precipKind === 'rain' ? spec.precipDensity : 0;
    const targetSnow = spec.precipKind === 'snow' ? spec.precipDensity : 0;
    const targetFog = spec.precipKind === 'fog' ? spec.precipDensity : 0;

    const precipRate = this.transitionDuration < 1.2 ? 2.4 : 0.65;
    r.rainIntensity += (targetRain - r.rainIntensity) * Math.min(1, step * precipRate);
    r.snowIntensity += (targetSnow - r.snowIntensity) * Math.min(1, step * precipRate);
    r.fogWispIntensity += (targetFog - r.fogWispIntensity) * Math.min(1, step * (precipRate * 0.85));
    if (r.rainIntensity < 0.01) r.rainIntensity = 0;
    if (r.snowIntensity < 0.01) r.snowIntensity = 0;
    if (r.fogWispIntensity < 0.01) r.fogWispIntensity = 0;

    // Storm lightning flashes + delayed thunder rumble
    if (this.current === 'storm' && r.rainIntensity > 0.45) {
      this.lightningCooldown -= step;
      if (this.lightningCooldown <= 0) {
        this.lightningFlash = 0.85 + Math.random() * 0.15;
        this.pendingThunderIntensity = 0.6 + Math.random() * 0.4;
        this.thunderDelay = 0.24 + Math.random() * 0.45;
        this.lightningCooldown = 5.5 + Math.random() * 7.5;
      }
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - step * 4.8);
    }
    if (this.thunderDelay >= 0) {
      this.thunderDelay -= step;
      if (this.thunderDelay <= 0) {
        this.thunderDelay = -1;
        cb?.onThunder?.(this.pendingThunderIntensity);
      }
    }
    r.lightningFlash = this.lightningFlash;

    // Smooth crosswind & surface grip physics modifiers
    const gust =
      Math.sin(this.windPhase * 0.72) * 0.65 + Math.sin(this.windPhase * 1.9 + 1.1) * 0.35;
    const targetWind =
      this.current === 'storm'
        ? gust * 2.4
        : this.current === 'snow'
          ? gust * 1.5
          : 0;
    const targetGrip =
      this.current === 'snow'
        ? 0.72
        : this.current === 'storm'
          ? 0.82
          : this.current === 'fog'
            ? 0.94
            : 1.0;
    const targetBrake =
      this.current === 'snow'
        ? 0.82
        : this.current === 'storm'
          ? 0.88
          : 1.0;

    this.physics.windX += (targetWind - this.physics.windX) * Math.min(1, step * 2.2);
    this.physics.grip += (targetGrip - this.physics.grip) * Math.min(1, step * 2.2);
    this.physics.brakeMul += (targetBrake - this.physics.brakeMul) * Math.min(1, step * 2.2);
    this.physics.sprayKind =
      r.rainIntensity > 0.35 ? 'water' : r.snowIntensity > 0.35 ? 'snow' : 'none';
    r.windX = this.physics.windX;

    // Audio ambience routing
    if (r.rainIntensity >= r.snowIntensity && r.rainIntensity >= r.fogWispIntensity && r.rainIntensity > 0.04) {
      r.ambienceMode = 'rain';
      r.ambienceLevel = r.rainIntensity;
    } else if (r.snowIntensity >= r.fogWispIntensity && r.snowIntensity > 0.04) {
      r.ambienceMode = 'snow';
      r.ambienceLevel = r.snowIntensity * 0.75;
    } else if (r.fogWispIntensity > 0.04) {
      r.ambienceMode = 'fog';
      r.ambienceLevel = r.fogWispIntensity * 0.65;
    } else {
      r.ambienceMode = 'none';
      r.ambienceLevel = 0;
    }
  }
}
