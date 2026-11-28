import { WeaponType } from '../game/types';

const GEAR_BOUNDS = [0, 16, 28, 41, 54, 78] as const;

type SfxKey =
  | 'swing'
  | 'hit_punch'
  | 'hit_bat'
  | 'hit_chain'
  | 'ko_impact'
  | 'slam'
  | 'explosion'
  | 'crash'
  | 'sniper_shot'
  | 'sniper_lock'
  | 'siren'
  | 'horn'
  | 'pickup'
  | 'boost'
  | 'banana_slip'
  | 'jet_flyby'
  | 'fuel_chime'
  | 'truck_horn';

const SFX_MANIFEST: Record<SfxKey, string> = {
  swing: 'swing.mp3',
  hit_punch: 'hit_punch.mp3',
  hit_bat: 'hit_bat.mp3',
  hit_chain: 'hit_chain.mp3',
  ko_impact: 'ko_impact.mp3',
  slam: 'slam.mp3',
  explosion: 'explosion.mp3',
  crash: 'crash.mp3',
  sniper_shot: 'sniper_shot.mp3',
  sniper_lock: 'sniper_lock.mp3',
  siren: 'siren.mp3',
  horn: 'horn.mp3',
  pickup: 'pickup.mp3',
  boost: 'boost.mp3',
  banana_slip: 'banana_slip.mp3',
  jet_flyby: 'jet_flyby.mp3',
  fuel_chime: 'fuel_chime.mp3',
  truck_horn: 'truck_horn.mp3',
};

const SFX_KEYS = Object.keys(SFX_MANIFEST) as SfxKey[];

interface SamplePlayOptions {
  volume?: number;
  rate?: number;
  rateJitter?: number;
  pan?: number;
  panEnd?: number;
  panDuration?: number;
  delay?: number;
  lowpassHz?: number;
  highpassHz?: number;
  cooldownMs?: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function resolveSfxUrl(filename: string): string {
  const rawBase = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL;
  const base =
    rawBase && rawBase.length > 0 ? (rawBase.endsWith('/') ? rawBase : `${rawBase}/`) : './';
  const rel = `${base}sfx/${filename}`;
  try {
    return new URL(rel, document.baseURI || window.location.href).href;
  } catch {
    return rel;
  }
}

function createWarmDriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

export class RetroAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engineBus: GainNode | null = null;

  // Upgraded dual-oscillator + harmonic boxer/sportbike engine nodes
  private engineOscSaw: OscillatorNode | null = null;
  private engineOscTri: OscillatorNode | null = null;
  private engineOscHarm: OscillatorNode | null = null;
  private engineHarmGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private exhaustGain: GainNode | null = null;

  // Nitro whoosh + turbocharger spool whistle nodes
  private nitroFilter: BiquadFilterNode | null = null;
  private nitroGain: GainNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  // Continuous procedural weather ambience (rain patter / fog breeze / winter wind)
  private weatherFilter: BiquadFilterNode | null = null;
  private weatherGain: GainNode | null = null;
  private smoothWeatherLevel = 0;

  private noiseBuffer: AudioBuffer | null = null;

  // Lazy non-blocking studio sample bank (CC0 Freesound SFX curated via vibe-motion/sound)
  private samples = new Map<SfxKey, AudioBuffer>();
  private preloadStarted = false;
  private lastPlayedMs = new Map<SfxKey, number>();

  private muted = false;
  private bgPaused = false;
  private initialized = false;
  private smoothRpm = 0.12;
  private smoothNitro = 0;
  private lastGear = 0;
  private lastSpeed = 0;
  private shiftDipTimer = 0;
  private crackleCooldown = 0;

  unlock(): void {
    if (!this.initialized) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      try {
        const ctx = new AudioCtx();
        this.ctx = ctx;

        // Studio mastering chain: sfxBus / engineBus -> masterGain -> DynamicsCompressorNode -> destination
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 14;
        comp.ratio.value = 5.5;
        comp.attack.value = 0.003;
        comp.release.value = 0.14;
        comp.connect(ctx.destination);

        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.48;
        master.connect(comp);
        this.masterGain = master;

        const sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.96;
        sfxBus.connect(master);
        this.sfxBus = sfxBus;

        const engineBus = ctx.createGain();
        engineBus.gain.value = 0.84;
        engineBus.connect(master);
        this.engineBus = engineBus;

        // Shared 2-second white noise buffer (allocated once, reused by exhaust, nitro & procedural fallbacks)
        const sampleCount = Math.floor(ctx.sampleRate * 2.0);
        const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buf;

        // Warm analog saturation + dual-stage tone sculpting for continuous motorcycle engine
        const engineDrive = ctx.createWaveShaper();
        engineDrive.curve = createWarmDriveCurve(1.65);
        engineDrive.oversample = '2x';

        const engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 240;
        engineFilter.Q.value = 2.1;

        const engineBodyEq = ctx.createBiquadFilter();
        engineBodyEq.type = 'peaking';
        engineBodyEq.frequency.value = 220;
        engineBodyEq.Q.value = 1.1;
        engineBodyEq.gain.value = 3.2;

        const engineTame = ctx.createBiquadFilter();
        engineTame.type = 'highshelf';
        engineTame.frequency.value = 2800;
        engineTame.gain.value = -5.5;

        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.001;

        engineDrive.connect(engineFilter);
        engineFilter.connect(engineBodyEq);
        engineBodyEq.connect(engineTame);
        engineTame.connect(engineGain);
        engineGain.connect(engineBus);

        // Primary boxer/sportbike sawtooth
        const saw = ctx.createOscillator();
        saw.type = 'sawtooth';
        saw.frequency.value = 50;
        const sawMix = ctx.createGain();
        sawMix.gain.value = 0.56;
        saw.connect(sawMix);
        sawMix.connect(engineDrive);

        // Warm sub-octave twin rumble (slight 0.5015 detune for authentic twin cylinder throb)
        const tri = ctx.createOscillator();
        tri.type = 'triangle';
        tri.frequency.value = 25.1;
        const triMix = ctx.createGain();
        triMix.gain.value = 0.82;
        tri.connect(triMix);
        triMix.connect(engineDrive);

        // Upper sportbike 5th-harmonic growl (swells smoothly with RPM)
        const harm = ctx.createOscillator();
        harm.type = 'sawtooth';
        harm.frequency.value = 74.8;
        const harmMix = ctx.createGain();
        harmMix.gain.value = 0.1;
        harm.connect(harmMix);
        harmMix.connect(engineDrive);

        saw.start();
        tri.start();
        harm.start();

        this.engineOscSaw = saw;
        this.engineOscTri = tri;
        this.engineOscHarm = harm;
        this.engineHarmGain = harmMix;
        this.engineFilter = engineFilter;
        this.engineGain = engineGain;

        // Subtle mechanical exhaust burble texture
        const exhaustSrc = ctx.createBufferSource();
        exhaustSrc.buffer = buf;
        exhaustSrc.loop = true;

        const exhaustFilter = ctx.createBiquadFilter();
        exhaustFilter.type = 'bandpass';
        exhaustFilter.frequency.value = 180;
        exhaustFilter.Q.value = 2.4;

        const exhaustGain = ctx.createGain();
        exhaustGain.gain.value = 0.001;

        exhaustSrc.connect(exhaustFilter);
        exhaustFilter.connect(exhaustGain);
        exhaustGain.connect(engineBus);
        exhaustSrc.start();

        this.exhaustFilter = exhaustFilter;
        this.exhaustGain = exhaustGain;

        // Continuous looping nitro jet whoosh
        const nitroSrc = ctx.createBufferSource();
        nitroSrc.buffer = buf;
        nitroSrc.loop = true;

        const nitroFilter = ctx.createBiquadFilter();
        nitroFilter.type = 'bandpass';
        nitroFilter.frequency.value = 1050;
        nitroFilter.Q.value = 1.3;

        const nitroGain = ctx.createGain();
        nitroGain.gain.value = 0;

        nitroSrc.connect(nitroFilter);
        nitroFilter.connect(nitroGain);
        nitroGain.connect(engineBus);
        nitroSrc.start();

        this.nitroFilter = nitroFilter;
        this.nitroGain = nitroGain;

        // Smooth turbocharger spool whistle on nitro (sine, subtle & non-fatiguing)
        const turboOsc = ctx.createOscillator();
        turboOsc.type = 'sine';
        turboOsc.frequency.value = 1600;
        const turboGain = ctx.createGain();
        turboGain.gain.value = 0;
        turboOsc.connect(turboGain);
        turboGain.connect(engineBus);
        turboOsc.start();

        this.turboOsc = turboOsc;
        this.turboGain = turboGain;

        // Subtle continuous weather ambience (reuses shared noise buffer, silent in clear/sunset)
        const weatherSrc = ctx.createBufferSource();
        weatherSrc.buffer = buf;
        weatherSrc.loop = true;

        const weatherFilter = ctx.createBiquadFilter();
        weatherFilter.type = 'bandpass';
        weatherFilter.frequency.value = 1200;
        weatherFilter.Q.value = 0.7;

        const weatherGain = ctx.createGain();
        weatherGain.gain.value = 0;

        weatherSrc.connect(weatherFilter);
        weatherFilter.connect(weatherGain);
        weatherGain.connect(master);
        weatherSrc.start();

        this.weatherFilter = weatherFilter;
        this.weatherGain = weatherGain;

        this.initialized = true;
      } catch {
        // Ignore browser audio errors cleanly
        return;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended' && !this.muted && !this.bgPaused) {
      this.ctx.resume().catch(() => {});
    }

    if (!this.preloadStarted && this.ctx) {
      this.preloadStarted = true;
      void this.preloadSamples();
    }
  }

  private async preloadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;

    await Promise.allSettled(
      SFX_KEYS.map(async (key) => {
        try {
          const res = await fetch(resolveSfxUrl(SFX_MANIFEST[key]), { cache: 'force-cache' });
          if (!res.ok) return;
          const raw = await res.arrayBuffer();
          if (!this.ctx) return;
          const decoded = await this.ctx.decodeAudioData(raw.slice(0));
          this.samples.set(key, decoded);
        } catch {
          // Offline or decode issue: silently retain procedural Web Audio fallback
        }
      })
    );
  }

  getSampleStatus(): { loaded: number; total: number; keys: string[] } {
    return {
      loaded: this.samples.size,
      total: SFX_KEYS.length,
      keys: Array.from(this.samples.keys()),
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.48, now, 0.015);
      if (muted) {
        if (this.ctx.state === 'running') {
          this.ctx.suspend().catch(() => {});
        }
      } else if (!this.bgPaused && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }
  }

  setBackgroundPaused(paused: boolean): void {
    this.bgPaused = paused;
    if (!this.ctx) return;
    if (paused) {
      if (this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    } else if (!this.muted && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setSuspended(suspended: boolean): void {
    this.setBackgroundPaused(suspended);
  }

  isMuted(): boolean {
    return this.muted;
  }

  private playExhaustCrackle(intensity: number): void {
    if (!this.canPlaySfx() || !this.ctx || !this.engineBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const burstCount = intensity > 0.7 ? 2 : 1;

    for (let i = 0; i < burstCount; i++) {
      const t = now + i * (0.032 + Math.random() * 0.02);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(260 + Math.random() * 240, t);
      bp.Q.value = 1.9;

      const g = ctx.createGain();
      const peak = clamp(0.065 + intensity * 0.075, 0.05, 0.14);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.048);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.engineBus);
      src.start(t, Math.random() * 1.4, 0.055);
    }
  }

  updateEngine(speed: number, nitro: boolean, crashed: boolean, dt: number): void {
    if (!this.initialized || this.muted || this.bgPaused || !this.ctx || this.ctx.state !== 'running') {
      return;
    }
    if (
      !this.engineOscSaw ||
      !this.engineOscTri ||
      !this.engineOscHarm ||
      !this.engineHarmGain ||
      !this.engineFilter ||
      !this.engineGain ||
      !this.exhaustFilter ||
      !this.exhaustGain ||
      !this.nitroFilter ||
      !this.nitroGain ||
      !this.turboOsc ||
      !this.turboGain
    ) {
      return;
    }

    const step = dt > 0.05 ? 0.05 : dt < 0.001 ? 0.001 : dt;
    const clampedSpeed = Math.max(0, speed);
    const decelRate = (this.lastSpeed - clampedSpeed) / step;

    // Compute 5-gear arcade RPM step curve
    let gear = 0;
    for (let g = 0; g < 5; g++) {
      if (clampedSpeed >= GEAR_BOUNDS[g]) {
        gear = g;
      }
    }

    if (this.crackleCooldown > 0) this.crackleCooldown = Math.max(0, this.crackleCooldown - step);
    if (this.shiftDipTimer > 0) this.shiftDipTimer = Math.max(0, this.shiftDipTimer - step);

    // Trigger crisp exhaust crackle + momentary RPM shift dip on upshift or hard throttle-off decel
    if (!crashed && this.crackleCooldown <= 0) {
      if (gear > this.lastGear && clampedSpeed > 15) {
        this.shiftDipTimer = 0.075;
        this.crackleCooldown = 0.22;
        this.playExhaustCrackle(0.55 + gear * 0.1);
      } else if (decelRate > 16 && clampedSpeed > 22) {
        this.crackleCooldown = 0.28;
        this.playExhaustCrackle(clamp(decelRate / 35, 0.35, 0.85));
      }
    }
    this.lastGear = gear;
    this.lastSpeed = clampedSpeed;

    const gMin = GEAR_BOUNDS[gear];
    const gMax = GEAR_BOUNDS[gear + 1];
    const gearFrac = clamp((clampedSpeed - gMin) / Math.max(1, gMax - gMin), 0, 1);

    const floorRpm = gear === 0 ? 0.11 : 0.36 + gear * 0.055;
    let targetRpm = crashed ? 0.06 : floorRpm + gearFrac * (0.98 - floorRpm);
    if (this.shiftDipTimer > 0 && !crashed) {
      targetRpm *= 0.87;
    }
    if (nitro && !crashed) {
      targetRpm = Math.min(1.24, targetRpm + 0.22);
    }

    // Smooth shift dip & responsive throttle
    const rpmRate = targetRpm < this.smoothRpm ? 10.5 : 14.5;
    this.smoothRpm += (targetRpm - this.smoothRpm) * Math.min(1, step * rpmRate);

    const targetNitro = nitro && !crashed ? 1 : 0;
    this.smoothNitro += (targetNitro - this.smoothNitro) * Math.min(1, step * 9.5);

    const now = this.ctx.currentTime;
    const baseFreq = 46 + this.smoothRpm * 158;
    this.engineOscSaw.frequency.setTargetAtTime(baseFreq, now, 0.02);
    this.engineOscTri.frequency.setTargetAtTime(baseFreq * 0.5015, now, 0.02);
    this.engineOscHarm.frequency.setTargetAtTime(baseFreq * 1.497, now, 0.02);

    // 5th-harmonic sportbike bite blooms naturally at mid/high RPM
    const harmMix = crashed ? 0.03 : 0.07 + clamp(this.smoothRpm, 0, 1.2) * 0.19;
    this.engineHarmGain.gain.setTargetAtTime(harmMix, now, 0.03);

    const cutoff = 210 + this.smoothRpm * 1180 + this.smoothNitro * 540;
    this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.025);

    const gainTarget = crashed
      ? 0.022
      : 0.078 + Math.min(1, clampedSpeed / 58) * 0.095 + this.smoothNitro * 0.035;
    this.engineGain.gain.setTargetAtTime(gainTarget, now, 0.03);

    // Mechanical exhaust rumble texture
    this.exhaustFilter.frequency.setTargetAtTime(145 + this.smoothRpm * 270, now, 0.03);
    this.exhaustGain.gain.setTargetAtTime(
      crashed ? 0.008 : 0.024 + clamp(this.smoothRpm, 0, 1.1) * 0.038,
      now,
      0.03
    );

    // Nitro jet air whoosh + smooth turbocharger spool whistle
    this.nitroFilter.frequency.setTargetAtTime(920 + this.smoothRpm * 760, now, 0.03);
    this.nitroGain.gain.setTargetAtTime(this.smoothNitro * 0.19, now, 0.03);

    this.turboOsc.frequency.setTargetAtTime(1480 + this.smoothRpm * 1180 + this.smoothNitro * 320, now, 0.04);
    this.turboGain.gain.setTargetAtTime(this.smoothNitro * 0.028, now, 0.04);
  }

  updateWeatherAmbience(mode: 'none' | 'rain' | 'fog' | 'snow', level: number, dt: number): void {
    if (
      !this.initialized ||
      this.muted ||
      this.bgPaused ||
      !this.ctx ||
      this.ctx.state !== 'running' ||
      !this.weatherFilter ||
      !this.weatherGain
    ) {
      return;
    }

    const step = dt > 0.05 ? 0.05 : dt < 0.001 ? 0.001 : dt;
    const targetLevel = mode === 'none' ? 0 : clamp(level, 0, 1);
    this.smoothWeatherLevel += (targetLevel - this.smoothWeatherLevel) * Math.min(1, step * 3.0);

    const now = this.ctx.currentTime;
    const freq = mode === 'rain' ? 1450 : mode === 'snow' ? 680 : 340;
    const q = mode === 'rain' ? 0.55 : mode === 'snow' ? 1.15 : 1.6;
    const gainScale = mode === 'rain' ? 0.052 : mode === 'snow' ? 0.03 : 0.022;

    this.weatherFilter.frequency.setTargetAtTime(freq, now, 0.12);
    this.weatherFilter.Q.setTargetAtTime(q, now, 0.12);
    this.weatherGain.gain.setTargetAtTime(this.smoothWeatherLevel * gainScale, now, 0.1);
  }

  playThunder(intensity = 0.75): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const lvl = clamp(intensity, 0.35, 1.0);

    // Distant rolling low-pass thunder rumble
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(340 + lvl * 220, now);
    lp.frequency.exponentialRampToValueAtTime(68, now + 1.45);
    lp.Q.value = 1.4;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.28 * lvl, now + 0.045);
    g.gain.linearRampToValueAtTime(0.18 * lvl, now + 0.28);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    src.start(now, Math.random() * 0.4, 1.55);

    // Subtle deep sub-bass crack
    this.playSubPunch(92, 28, 0.48, 0.22 * lvl);
  }

  private canPlaySfx(): boolean {
    return (
      this.initialized &&
      !this.muted &&
      !this.bgPaused &&
      this.ctx !== null &&
      this.masterGain !== null &&
      this.sfxBus !== null &&
      this.ctx.state === 'running'
    );
  }

  private playSample(key: SfxKey, opts: SamplePlayOptions = {}): boolean {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return false;
    const buffer = this.samples.get(key);
    if (!buffer) return false;

    const cooldown = opts.cooldownMs ?? 32;
    const perfNow = performance.now();
    const prev = this.lastPlayedMs.get(key) ?? -1e9;
    if (perfNow - prev < cooldown) return true;
    this.lastPlayedMs.set(key, perfNow);

    const ctx = this.ctx;
    const startAt = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const baseRate = opts.rate ?? 1.0;
    const jitter = opts.rateJitter ?? 0.05;
    const rate = baseRate * (1 + (Math.random() * 2 - 1) * jitter);
    src.playbackRate.setValueAtTime(clamp(rate, 0.45, 2.2), startAt);

    let tail: AudioNode = src;

    if (opts.highpassHz) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(opts.highpassHz, startAt);
      tail.connect(hp);
      tail = hp;
    }

    if (opts.lowpassHz) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opts.lowpassHz, startAt);
      tail.connect(lp);
      tail = lp;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.volume ?? 0.72, startAt);
    tail.connect(gain);
    tail = gain;

    if (typeof ctx.createStereoPanner === 'function' && (opts.pan !== undefined || opts.panEnd !== undefined)) {
      const panner = ctx.createStereoPanner();
      const startPan = clamp(opts.pan ?? 0, -1, 1);
      panner.pan.setValueAtTime(startPan, startAt);
      if (opts.panEnd !== undefined) {
        const dur = opts.panDuration ?? Math.max(0.15, buffer.duration / Math.max(0.5, rate));
        panner.pan.linearRampToValueAtTime(clamp(opts.panEnd, -1, 1), startAt + dur);
      }
      tail.connect(panner);
      tail = panner;
    }

    tail.connect(this.sfxBus);
    src.start(startAt);
    return true;
  }

  private playSubPunch(startHz: number, endHz: number, dur: number, vol: number, delay = 0): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.02);

    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private playKoFanfare(): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [330, 440, 659.25];
    for (let i = 0; i < notes.length; i++) {
      const t = now + 0.045 + i * 0.06;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[i], t);

      const over = ctx.createOscillator();
      over.type = 'square';
      over.frequency.setValueAtTime(notes[i], t);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2200, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);

      osc.connect(lp);
      over.connect(lp);
      lp.connect(g);
      g.connect(this.sfxBus);
      osc.start(t);
      over.start(t);
      osc.stop(t + 0.18);
      over.stop(t + 0.18);
    }
  }

  playSwing(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    const pan = (Math.random() * 2 - 1) * 0.18;
    if (this.playSample('swing', { volume: 0.62, rateJitter: 0.06, pan, cooldownMs: 45 })) {
      return;
    }

    // Procedural fallback
    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.14);
    filter.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(now, Math.random() * 1.2, 0.16);
  }

  playHit(weapon: WeaponType, ko: boolean): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    const pan = (Math.random() * 2 - 1) * 0.16;
    const key: SfxKey = weapon === 0 ? 'hit_punch' : weapon === 1 ? 'hit_bat' : 'hit_chain';
    const sampleVol = weapon === 0 ? 0.78 : weapon === 1 ? 0.84 : 0.82;
    const played = this.playSample(key, {
      volume: ko ? Math.min(0.95, sampleVol * 1.1) : sampleVol,
      rate: ko ? 0.94 : 1.0,
      rateJitter: 0.055,
      pan,
      cooldownMs: 35,
    });

    if (played) {
      // Subtle low-end impact body so melee hits feel weighty on laptop & mobile speakers
      this.playSubPunch(ko ? 155 : 130, 38, ko ? 0.2 : 0.11, ko ? 0.36 : 0.24);
      if (ko) {
        this.playSample('ko_impact', {
          volume: 0.72,
          rate: 0.96,
          rateJitter: 0.04,
          pan: -pan,
          delay: 0.02,
          cooldownMs: 60,
        });
        this.playKoFanfare();
      }
      return;
    }

    // Procedural fallback (if sample bank still decoding or offline)
    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.playSubPunch(ko ? 175 : 145, 38, ko ? 0.24 : 0.13, ko ? 0.62 : 0.46);

    if (weapon === 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1050, now);
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.36, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.sfxBus);
      src.start(now, Math.random(), 0.1);
    } else if (weapon === 1) {
      const crack = ctx.createOscillator();
      crack.type = 'sawtooth';
      crack.frequency.setValueAtTime(520, now);
      crack.frequency.exponentialRampToValueAtTime(135, now + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.34, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      crack.connect(g);
      g.connect(this.sfxBus);
      crack.start(now);
      crack.stop(now + 0.14);
    } else {
      const f1 = ctx.createOscillator();
      const f2 = ctx.createOscillator();
      f1.type = 'square';
      f2.type = 'triangle';
      f1.frequency.setValueAtTime(920, now);
      f2.frequency.setValueAtTime(1470, now);
      f1.frequency.exponentialRampToValueAtTime(640, now + 0.16);
      f2.frequency.exponentialRampToValueAtTime(1080, now + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      f1.connect(g);
      f2.connect(g);
      g.connect(this.sfxBus);
      f1.start(now);
      f2.start(now);
      f1.stop(now + 0.19);
      f2.stop(now + 0.19);
    }

    if (ko) {
      this.playKoFanfare();
    }
  }

  playCrash(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('crash', {
        volume: 0.85,
        rateJitter: 0.05,
        pan: (Math.random() * 2 - 1) * 0.12,
        cooldownMs: 70,
      })
    ) {
      this.playSubPunch(125, 32, 0.28, 0.34);
      return;
    }

    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1900, now);
    lp.frequency.exponentialRampToValueAtTime(190, now + 0.55);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.55, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
    src.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.sfxBus);
    src.start(now, Math.random() * 0.8, 0.6);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.42);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.32, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    osc.connect(oGain);
    oGain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  playBoost(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('boost', {
        volume: 0.72,
        rateJitter: 0.04,
        cooldownMs: 80,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(220, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.34);
    osc2.frequency.setValueAtTime(330, now);
    osc2.frequency.exponentialRampToValueAtTime(1320, now + 0.34);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.39);
    osc2.stop(now + 0.39);
  }

  playHorn(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    // Slight stereo pass-by pan makes highway Near Miss feel kinetic
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (
      this.playSample('horn', {
        volume: 0.58,
        rateJitter: 0.06,
        pan: dir * 0.38,
        panEnd: -dir * 0.38,
        panDuration: 0.45,
        cooldownMs: 90,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscA.frequency.setValueAtTime(415, now);
    oscB.frequency.setValueAtTime(523.25, now);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 920;
    bp.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.015);
    gain.gain.setValueAtTime(0.22, now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    oscA.connect(bp);
    oscB.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxBus);
    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.25);
    oscB.stop(now + 0.25);
  }

  playSpawnChime(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('fuel_chime', {
        volume: 0.46,
        rate: 1.12,
        rateJitter: 0.02,
        cooldownMs: 120,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < freqs.length; i++) {
      const t = now + i * 0.055;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freqs[i], t);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.24, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.19);
    }
  }

  playPickup(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('pickup', {
        volume: 0.62,
        rateJitter: 0.04,
        cooldownMs: 45,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [587.33, 880, 1174.66];
    for (let i = 0; i < notes.length; i++) {
      const t = now + i * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(notes[i], t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g);
      g.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  playWheelieSlam(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('slam', {
        volume: 0.84,
        rateJitter: 0.045,
        cooldownMs: 80,
      })
    ) {
      this.playSubPunch(135, 34, 0.22, 0.38);
      return;
    }

    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.playSubPunch(140, 34, 0.24, 0.68);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, now);
    lp.frequency.exponentialRampToValueAtTime(220, now + 0.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.38, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.sfxBus);
    src.start(now, Math.random(), 0.23);
  }

  playExplosion(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('explosion', {
        volume: 0.9,
        rateJitter: 0.06,
        pan: (Math.random() * 2 - 1) * 0.18,
        cooldownMs: 55,
      })
    ) {
      this.playSubPunch(98, 26, 0.36, 0.42);
      return;
    }

    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1600, now);
    lp.frequency.exponentialRampToValueAtTime(95, now + 0.65);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.68, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.sfxBus);
    src.start(now, Math.random() * 0.5, 0.7);

    this.playSubPunch(115, 28, 0.45, 0.58);
  }

  playSniperLock(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('sniper_lock', {
        volume: 0.58,
        rateJitter: 0.03,
        cooldownMs: 70,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1320, now);
    osc.frequency.setValueAtTime(1760, now + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playSniperShot(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('sniper_shot', {
        volume: 0.88,
        rateJitter: 0.04,
        cooldownMs: 60,
      })
    ) {
      return;
    }

    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(900, now);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.62, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(this.sfxBus);
    src.start(now, Math.random(), 0.24);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.32, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(og);
    og.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playSiren(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('siren', {
        volume: 0.56,
        rateJitter: 0.03,
        pan: -0.22,
        panEnd: 0.22,
        panDuration: 0.72,
        cooldownMs: 140,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.linearRampToValueAtTime(980, now + 0.22);
    osc.frequency.linearRampToValueAtTime(640, now + 0.44);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.03);
    g.gain.setValueAtTime(0.22, now + 0.36);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.47);
  }

  playBananaSlip(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('banana_slip', {
        volume: 0.66,
        rateJitter: 0.05,
        cooldownMs: 80,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.16);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.33);
  }

  playJetFlyby(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (
      this.playSample('jet_flyby', {
        volume: 0.82,
        rateJitter: 0.04,
        pan: dir * 0.82,
        panEnd: -dir * 0.82,
        panDuration: 1.32,
        cooldownMs: 250,
      })
    ) {
      return;
    }

    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, now);
    bp.frequency.exponentialRampToValueAtTime(1600, now + 0.35);
    bp.frequency.exponentialRampToValueAtTime(240, now + 0.85);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.38, now + 0.32);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.88);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus);
    src.start(now, Math.random() * 0.4, 0.9);
  }

  playRageRoar(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Fierce delivery-rider enraged throttle rev + urgent warning alarm chord
    const growlA = ctx.createOscillator();
    const growlB = ctx.createOscillator();
    const alarm = ctx.createOscillator();
    growlA.type = 'sawtooth';
    growlB.type = 'sawtooth';
    alarm.type = 'triangle';

    growlA.frequency.setValueAtTime(140, now);
    growlA.frequency.exponentialRampToValueAtTime(340, now + 0.18);
    growlA.frequency.exponentialRampToValueAtTime(120, now + 0.48);

    growlB.frequency.setValueAtTime(144, now);
    growlB.frequency.exponentialRampToValueAtTime(348, now + 0.18);
    growlB.frequency.exponentialRampToValueAtTime(124, now + 0.48);

    alarm.frequency.setValueAtTime(587.33, now);
    alarm.frequency.setValueAtTime(739.99, now + 0.11);
    alarm.frequency.setValueAtTime(587.33, now + 0.22);
    alarm.frequency.setValueAtTime(880, now + 0.32);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, now);
    lp.Q.value = 2.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.3, now + 0.03);
    g.gain.setValueAtTime(0.26, now + 0.34);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

    growlA.connect(lp);
    growlB.connect(lp);
    alarm.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);

    growlA.start(now);
    growlB.start(now);
    alarm.start(now);
    growlA.stop(now + 0.54);
    growlB.stop(now + 0.54);
    alarm.stop(now + 0.54);
  }

  playAnimalSound(species: 'cow' | 'sheep' | 'dog' | 'boar' | 'goose'): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Formant-filtered expressive procedural animal vocalizations
    const osc = ctx.createOscillator();
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ctx.createGain();

    let stopAt = now + 0.48;

    if (species === 'cow') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(142, now);
      osc.frequency.linearRampToValueAtTime(154, now + 0.1);
      osc.frequency.linearRampToValueAtTime(114, now + 0.44);
      formant.frequency.setValueAtTime(420, now);
      formant.frequency.linearRampToValueAtTime(340, now + 0.44);
      formant.Q.value = 2.5;
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.32, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      stopAt = now + 0.5;
    } else if (species === 'sheep') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(375, now);
      osc.frequency.linearRampToValueAtTime(315, now + 0.38);
      // Natural bleat vibrato LFO
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 16;
      lfoGain.gain.value = 24;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(now);
      lfo.stop(now + 0.42);

      formant.frequency.setValueAtTime(1050, now);
      formant.Q.value = 3.2;
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.28, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      stopAt = now + 0.42;
    } else if (species === 'dog') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(460, now);
      osc.frequency.exponentialRampToValueAtTime(210, now + 0.09);
      osc.frequency.setValueAtTime(510, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(225, now + 0.25);
      formant.frequency.setValueAtTime(860, now);
      formant.Q.value = 2.0;
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.28, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.01, now + 0.11);
      g.gain.linearRampToValueAtTime(0.3, now + 0.155);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      stopAt = now + 0.3;
    } else if (species === 'boar') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(185, now);
      osc.frequency.exponentialRampToValueAtTime(84, now + 0.26);
      formant.frequency.setValueAtTime(320, now);
      formant.Q.value = 2.2;
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.34, now + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      stopAt = now + 0.32;
    } else {
      // Goose nasal resonant honk
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.linearRampToValueAtTime(505, now + 0.2);
      formant.frequency.setValueAtTime(1320, now);
      formant.Q.value = 3.8;
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.28, now + 0.018);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      stopAt = now + 0.26;
    }

    osc.connect(formant);
    formant.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(stopAt);
  }

  playFuelChime(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    if (
      this.playSample('fuel_chime', {
        volume: 0.56,
        rateJitter: 0.02,
        cooldownMs: 120,
      })
    ) {
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [659.25, 880, 1174.66, 1318.5];
    for (let i = 0; i < notes.length; i++) {
      const t = now + i * 0.05;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[i], t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g);
      g.connect(this.sfxBus);
      osc.start(t);
      osc.stop(t + 0.17);
    }
  }

  playTruckCrash(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.sfxBus) return;
    const playedHorn = this.playSample('truck_horn', {
      volume: 0.72,
      rate: 0.96,
      rateJitter: 0.04,
      pan: -0.15,
      cooldownMs: 120,
    });
    const playedCrash = this.playSample('crash', {
      volume: 0.84,
      rate: 0.9,
      rateJitter: 0.04,
      pan: 0.15,
      delay: 0.03,
      cooldownMs: 90,
    });
    if (playedHorn || playedCrash) {
      this.playSubPunch(105, 28, 0.34, 0.42);
      return;
    }

    // Procedural fallback
    if (!this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const hornA = ctx.createOscillator();
    const hornB = ctx.createOscillator();
    hornA.type = 'sawtooth';
    hornB.type = 'sawtooth';
    hornA.frequency.setValueAtTime(185, now);
    hornB.frequency.setValueAtTime(233, now);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.24, now);
    hg.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    hornA.connect(hg);
    hornB.connect(hg);
    hg.connect(this.sfxBus);
    hornA.start(now);
    hornB.start(now);
    hornA.stop(now + 0.44);
    hornB.stop(now + 0.44);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1500, now);
    lp.frequency.exponentialRampToValueAtTime(160, now + 0.48);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.45, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.sfxBus);
    src.start(now, Math.random() * 0.5, 0.54);
  }
}
