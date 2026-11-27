import { WeaponType } from '../game/types';

const GEAR_BOUNDS = [0, 16, 28, 41, 54, 78] as const;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export class RetroAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOscSaw: OscillatorNode | null = null;
  private engineOscTri: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private nitroFilter: BiquadFilterNode | null = null;
  private nitroGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private bgPaused = false;
  private initialized = false;
  private smoothRpm = 0.12;
  private smoothNitro = 0;

  unlock(): void {
    if (!this.initialized) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      try {
        const ctx = new AudioCtx();
        this.ctx = ctx;

        // Subtle master compressor to keep arcade hits punchy without clipping
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.004;
        comp.release.value = 0.12;
        comp.connect(ctx.destination);

        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.42;
        master.connect(comp);
        this.masterGain = master;

        // Shared 2-second white noise buffer (allocated once, reused by all SFX & nitro)
        const sampleCount = Math.floor(ctx.sampleRate * 2.0);
        const buf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buf;

        // Continuous motorcycle engine synthesizer (sawtooth + sub triangle + resonant lowpass)
        const engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 280;
        engineFilter.Q.value = 3.0;

        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.001;
        engineFilter.connect(engineGain);
        engineGain.connect(master);

        const saw = ctx.createOscillator();
        saw.type = 'sawtooth';
        saw.frequency.value = 54;
        const sawMix = ctx.createGain();
        sawMix.gain.value = 0.62;
        saw.connect(sawMix);
        sawMix.connect(engineFilter);

        const tri = ctx.createOscillator();
        tri.type = 'triangle';
        tri.frequency.value = 27;
        const triMix = ctx.createGain();
        triMix.gain.value = 0.78;
        tri.connect(triMix);
        triMix.connect(engineFilter);

        saw.start();
        tri.start();

        this.engineOscSaw = saw;
        this.engineOscTri = tri;
        this.engineFilter = engineFilter;
        this.engineGain = engineGain;

        // Continuous looping nitro whoosh filtered noise
        const nitroSrc = ctx.createBufferSource();
        nitroSrc.buffer = buf;
        nitroSrc.loop = true;

        const nitroFilter = ctx.createBiquadFilter();
        nitroFilter.type = 'bandpass';
        nitroFilter.frequency.value = 1100;
        nitroFilter.Q.value = 1.4;

        const nitroGain = ctx.createGain();
        nitroGain.gain.value = 0;

        nitroSrc.connect(nitroFilter);
        nitroFilter.connect(nitroGain);
        nitroGain.connect(master);
        nitroSrc.start();

        this.nitroFilter = nitroFilter;
        this.nitroGain = nitroGain;

        this.initialized = true;
      } catch {
        // Ignore browser audio errors cleanly
        return;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended' && !this.muted && !this.bgPaused) {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.42, now, 0.02);
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

  isMuted(): boolean {
    return this.muted;
  }

  updateEngine(speed: number, nitro: boolean, crashed: boolean, dt: number): void {
    if (!this.initialized || this.muted || this.bgPaused || !this.ctx || this.ctx.state !== 'running') return;
    if (
      !this.engineOscSaw ||
      !this.engineOscTri ||
      !this.engineFilter ||
      !this.engineGain ||
      !this.nitroFilter ||
      !this.nitroGain
    ) {
      return;
    }

    const step = dt > 0.05 ? 0.05 : dt < 0.001 ? 0.001 : dt;
    const clampedSpeed = Math.max(0, speed);

    // Compute 5-gear arcade RPM step curve
    let gear = 0;
    for (let g = 0; g < 5; g++) {
      if (clampedSpeed >= GEAR_BOUNDS[g]) {
        gear = g;
      }
    }
    const gMin = GEAR_BOUNDS[gear];
    const gMax = GEAR_BOUNDS[gear + 1];
    const gearFrac = clamp((clampedSpeed - gMin) / Math.max(1, gMax - gMin), 0, 1);

    const floorRpm = gear === 0 ? 0.1 : 0.38 + gear * 0.05;
    let targetRpm = crashed ? 0.06 : floorRpm + gearFrac * (0.98 - floorRpm);
    if (nitro && !crashed) {
      targetRpm = Math.min(1.22, targetRpm + 0.22);
    }

    // Smooth shift dip & throttle response
    const rpmRate = targetRpm < this.smoothRpm ? 9.5 : 14.0;
    this.smoothRpm += (targetRpm - this.smoothRpm) * Math.min(1, step * rpmRate);

    const targetNitro = nitro && !crashed ? 1 : 0;
    this.smoothNitro += (targetNitro - this.smoothNitro) * Math.min(1, step * 10.0);

    const now = this.ctx.currentTime;
    const baseFreq = 48 + this.smoothRpm * 165;
    this.engineOscSaw.frequency.setTargetAtTime(baseFreq, now, 0.02);
    this.engineOscTri.frequency.setTargetAtTime(baseFreq * 0.502, now, 0.02);

    const cutoff = 240 + this.smoothRpm * 1350 + this.smoothNitro * 650;
    this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.025);

    const gainTarget = crashed
      ? 0.025
      : 0.075 + Math.min(1, clampedSpeed / 58) * 0.1 + this.smoothNitro * 0.04;
    this.engineGain.gain.setTargetAtTime(gainTarget, now, 0.03);

    this.nitroFilter.frequency.setTargetAtTime(880 + this.smoothRpm * 720, now, 0.03);
    this.nitroGain.gain.setTargetAtTime(this.smoothNitro * 0.2, now, 0.03);
  }

  private canPlaySfx(): boolean {
    return (
      this.initialized &&
      !this.muted &&
      !this.bgPaused &&
      this.ctx !== null &&
      this.masterGain !== null &&
      this.ctx.state === 'running'
    );
  }

  playSwing(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
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
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 1.2, 0.16);
  }

  playHit(weapon: WeaponType, ko: boolean): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Punchy low-end impact body
    const thud = ctx.createOscillator();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(ko ? 175 : 145, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + (ko ? 0.24 : 0.13));

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(ko ? 0.65 : 0.48, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + (ko ? 0.26 : 0.14));

    thud.connect(thudGain);
    thudGain.connect(this.masterGain);
    thud.start(now);
    thud.stop(now + (ko ? 0.27 : 0.15));

    // Weapon-specific transient texture
    if (weapon === 0) {
      // Fist / kick crisp slap
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
      g.connect(this.masterGain);
      src.start(now, Math.random(), 0.1);
    } else if (weapon === 1) {
      // Spiked bat heavy crack
      const crack = ctx.createOscillator();
      crack.type = 'sawtooth';
      crack.frequency.setValueAtTime(520, now);
      crack.frequency.exponentialRampToValueAtTime(135, now + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.34, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      crack.connect(g);
      g.connect(this.masterGain);
      crack.start(now);
      crack.stop(now + 0.14);
    } else {
      // Steel chain metallic clang (inharmonic pair)
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
      g.connect(this.masterGain);
      f1.start(now);
      f2.start(now);
      f1.stop(now + 0.19);
      f2.stop(now + 0.19);
    }

    // Arcade KO victory sting
    if (ko) {
      const notes = [330, 440, 659.25];
      for (let i = 0; i < notes.length; i++) {
        const t = now + 0.04 + i * 0.065;
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(notes[i], t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.17);
      }
    }
  }

  playCrash(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Grinding asphalt & metal crunch
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
    nGain.connect(this.masterGain);
    src.start(now, Math.random() * 0.8, 0.6);

    // Descending impact roar
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.42);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.32, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    osc.connect(oGain);
    oGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  playBoost(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.39);
    osc2.stop(now + 0.39);
  }

  playHorn(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Classic dual-tone highway car horn
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
    gain.connect(this.masterGain);

    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.25);
    oscB.stop(now + 0.25);
  }

  playSpawnChime(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.19);
    }
  }

  playPickup(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  playWheelieSlam(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Deep asphalt bass shockwave
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(34, now + 0.24);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.7, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    sub.connect(sg);
    sg.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.27);

    // Tire crunch noise snap
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
    ng.connect(this.masterGain);
    src.start(now, Math.random(), 0.23);
  }

  playExplosion(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
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
    ng.connect(this.masterGain);
    src.start(now, Math.random() * 0.5, 0.7);

    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(115, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 0.45);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.6, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    boom.connect(bg);
    bg.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.5);
  }

  playSniperLock(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playSniperShot(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Sharp supersonic crack
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
    ng.connect(this.masterGain);
    src.start(now, Math.random(), 0.24);

    // Metallic bolt tail
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.32, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(og);
    og.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  playSiren(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.47);
  }

  playBananaSlip(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.33);
  }

  playJetFlyby(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
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
    g.connect(this.masterGain);
    src.start(now, Math.random() * 0.4, 0.9);
  }

  playRageRoar(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(160, now);
    osc1.frequency.linearRampToValueAtTime(310, now + 0.16);
    osc1.frequency.linearRampToValueAtTime(125, now + 0.44);
    osc2.frequency.setValueAtTime(440, now);
    osc2.frequency.setValueAtTime(554, now + 0.12);
    osc2.frequency.setValueAtTime(440, now + 0.24);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1500, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.32, now + 0.03);
    g.gain.setValueAtTime(0.28, now + 0.32);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.5);
    osc2.stop(now + 0.5);
  }

  playAnimalSound(species: 'cow' | 'sheep' | 'dog' | 'boar' | 'goose'): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    if (species === 'cow') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(145, now);
      osc.frequency.linearRampToValueAtTime(118, now + 0.42);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.24, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
    } else if (species === 'sheep') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(390, now);
      osc.frequency.setValueAtTime(340, now + 0.08);
      osc.frequency.setValueAtTime(410, now + 0.16);
      osc.frequency.linearRampToValueAtTime(310, now + 0.34);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    } else if (species === 'dog') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.11);
      osc.frequency.setValueAtTime(520, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.27);
      g.gain.setValueAtTime(0.2, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.29);
    } else if (species === 'boar') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.25);
      g.gain.setValueAtTime(0.28, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.linearRampToValueAtTime(520, now + 0.18);
      g.gain.setValueAtTime(0.22, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    }

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.48);
  }

  playFuelChime(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain) return;
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
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.17);
    }
  }

  playTruckCrash(): void {
    if (!this.canPlaySfx() || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
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
    hg.connect(this.masterGain);
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
    ng.connect(this.masterGain);
    src.start(now, Math.random() * 0.5, 0.54);
  }
}
