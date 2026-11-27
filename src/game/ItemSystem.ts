import { LANE_CENTERS, ROAD_HALF_WIDTH, hash1 } from './RoadMath';
import {
  ITEM_BY_ID,
  ITEMS,
  ItemNetEvent,
  ItemType,
  RiderRenderState,
  SniperHudState,
} from './types';

export interface RoadCrateVisual {
  slot: number;
  s: number;
  x: number;
}

export interface RocketVisual {
  active: boolean;
  ownerId: string;
  ownerName: string;
  targetId: string | null;
  s: number;
  x: number;
  y: number;
  speed: number;
  life: number;
}

export interface JetVisual {
  active: boolean;
  ownerId: string;
  ownerName: string;
  s: number;
  x: number;
  y: number;
  speed: number;
  life: number;
  dropsLeft: number;
  dropTimer: number;
}

export interface BombVisual {
  active: boolean;
  ownerId: string;
  ownerName: string;
  s: number;
  x: number;
  y: number;
  vy: number;
  fuse: number;
  maxFuse: number;
}

export interface InterceptorVisual {
  active: boolean;
  ownerId: string;
  ownerName: string;
  targetId: string | null;
  s: number;
  x: number;
  speed: number;
  life: number;
  sirenTimer: number;
}

export interface HazardVisual {
  active: boolean;
  kind: 'trap' | 'banana';
  ownerId: string;
  ownerName: string;
  s: number;
  x: number;
  life: number;
  armDelay: number;
}

export interface SniperLaserVisual {
  active: boolean;
  fromS: number;
  fromX: number;
  fromY: number;
  toS: number;
  toX: number;
  toY: number;
  progress: number;
}

export interface ItemVisuals {
  crates: readonly RoadCrateVisual[];
  rockets: readonly RocketVisual[];
  jets: readonly JetVisual[];
  bombs: readonly BombVisual[];
  interceptors: readonly InterceptorVisual[];
  hazards: readonly HazardVisual[];
  sniperLaser: SniperLaserVisual;
}

export interface SniperCandidate {
  id: string;
  name: string;
  distM: number;
  avatarIdx: number;
}

export interface ItemCallbacks {
  onBroadcast(text: string, accent?: 'gold' | 'cyan' | 'red' | 'green'): void;
  onToast(text: string, accent?: 'gold' | 'cyan' | 'red'): void;
  onPublishNetEvent(ev: Omit<ItemNetEvent, 'from' | 'fromName' | 'ts'>): void;
  onHitRival(
    target: RiderRenderState,
    item: ItemType,
    dmg: number,
    knockX: number,
    ko: boolean,
    spinOut: boolean
  ): void;
  onPoliceDragRival(target: RiderRenderState, dt: number, shoveX: number): void;
  onLocalDamage(dmg: number, knockX: number, ko: boolean, sourceLabel: string, popup: string): void;
  onLocalSpinOut(duration: number, dmg: number, sourceLabel: string): void;
  onLocalPoliceDrag(dt: number, shoveX: number): void;
  onLocalActivateTurbo(duration: number): void;
  onLocalActivateMagnet(duration: number): void;
  onSfx(
    kind:
      | 'pickup'
      | 'explosion'
      | 'sniperLock'
      | 'sniperShot'
      | 'siren'
      | 'bananaSlip'
      | 'jet'
      | 'boost'
  ): void;
  onParticles(kind: 'spark' | 'smoke' | 'dust' | 'nitro' | 'crash', s: number, x: number, y: number, vs?: number): void;
  onPopup(kind: string, s: number, x: number, y: number): void;
  onShake(intensity: number, duration?: number): void;
}

const CRATE_SPACING = 68.0;
const CRATE_COOLDOWN_SEC = 14.0;
const MAX_ROCKETS = 8;
const MAX_JETS = 3;
const MAX_BOMBS = 16;
const MAX_INTERCEPTORS = 4;
const MAX_HAZARDS = 24;
const SNIPER_AIM_SEC = 1.15;
const SNIPER_RESULT_SHOW_SEC = 0.95;
const SNIPER_MAX_RANGE = 175.0;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class ItemSystem {
  private readonly collectedSlots = new Map<number, number>();
  private readonly crates: RoadCrateVisual[] = [];
  private readonly cratePool: RoadCrateVisual[] = [];
  private readonly rockets: RocketVisual[] = [];
  private readonly jets: JetVisual[] = [];
  private readonly bombs: BombVisual[] = [];
  private readonly interceptors: InterceptorVisual[] = [];
  private readonly hazards: HazardVisual[] = [];
  private readonly sniperLaser: SniperLaserVisual = {
    active: false,
    fromS: 0,
    fromX: 0,
    fromY: 1.2,
    toS: 0,
    toX: 0,
    toY: 1.2,
    progress: 0,
  };

  readonly visuals: ItemVisuals;

  // Local sniper targeting state
  private sniperPhase: 'idle' | 'selecting' | 'aiming' | 'fired' = 'idle';
  private sniperTargetId: string | null = null;
  private sniperTargetName = '';
  private sniperTimer = 0;
  private sniperResult: 'HIT' | 'DODGED' | 'MISS' | undefined;
  private readonly sniperHudState: SniperHudState = {
    phase: 'selecting',
    targetId: null,
    targetName: '',
    progress: 0,
    lockQuality: 0,
  };
  private readonly sniperCandidates: SniperCandidate[] = [];

  // Incoming sniper lock warning on local player
  private incomingLockTimer = 0;
  private incomingLockFrom: string | null = null;
  private remoteLaserTimer = 0;
  private remoteLaserFromId: string | null = null;
  private remoteLaserToId: string | null = null;

  private timeSec = 0;
  private smokeAccum = 0;

  constructor() {
    for (let i = 0; i < 16; i++) {
      this.cratePool.push({ slot: 0, s: 0, x: 0 });
    }
    for (let i = 0; i < MAX_ROCKETS; i++) {
      this.rockets.push({
        active: false,
        ownerId: '',
        ownerName: '',
        targetId: null,
        s: 0,
        x: 0,
        y: 0.9,
        speed: 115,
        life: 0,
      });
    }
    for (let i = 0; i < MAX_JETS; i++) {
      this.jets.push({
        active: false,
        ownerId: '',
        ownerName: '',
        s: 0,
        x: 0,
        y: 15,
        speed: 120,
        life: 0,
        dropsLeft: 0,
        dropTimer: 0,
      });
    }
    for (let i = 0; i < MAX_BOMBS; i++) {
      this.bombs.push({
        active: false,
        ownerId: '',
        ownerName: '',
        s: 0,
        x: 0,
        y: 14,
        vy: -16,
        fuse: 0,
        maxFuse: 0.85,
      });
    }
    for (let i = 0; i < MAX_INTERCEPTORS; i++) {
      this.interceptors.push({
        active: false,
        ownerId: '',
        ownerName: '',
        targetId: null,
        s: 0,
        x: 0,
        speed: 55,
        life: 0,
        sirenTimer: 0,
      });
    }
    for (let i = 0; i < MAX_HAZARDS; i++) {
      this.hazards.push({
        active: false,
        kind: 'banana',
        ownerId: '',
        ownerName: '',
        s: 0,
        x: 0,
        life: 0,
        armDelay: 0,
      });
    }

    this.visuals = {
      crates: this.crates,
      rockets: this.rockets,
      jets: this.jets,
      bombs: this.bombs,
      interceptors: this.interceptors,
      hazards: this.hazards,
      sniperLaser: this.sniperLaser,
    };
  }

  isSniperSelecting(): boolean {
    return this.sniperPhase === 'selecting';
  }

  getSniperHudState(): SniperHudState | null {
    if (this.sniperPhase === 'idle') return null;
    this.sniperHudState.phase = this.sniperPhase;
    this.sniperHudState.targetId = this.sniperTargetId;
    this.sniperHudState.targetName = this.sniperTargetName;
    this.sniperHudState.progress =
      this.sniperPhase === 'aiming'
        ? clamp(this.sniperTimer / SNIPER_AIM_SEC, 0, 1)
        : this.sniperPhase === 'fired'
          ? 1
          : 0;
    this.sniperHudState.result = this.sniperResult;
    return this.sniperHudState;
  }

  getSniperCandidates(): SniperCandidate[] {
    return this.sniperCandidates;
  }

  cancelSniper(): void {
    if (this.sniperPhase === 'selecting') {
      this.sniperPhase = 'idle';
      this.sniperTargetId = null;
      this.sniperTargetName = '';
      this.sniperResult = undefined;
    }
  }

  selectSniperTargetByIndex(index: number, local: RiderRenderState, rivals: RiderRenderState[], cb: ItemCallbacks): boolean {
    if (this.sniperPhase !== 'selecting') return false;
    if (index < 0 || index >= this.sniperCandidates.length) return false;
    return this.selectSniperTarget(this.sniperCandidates[index].id, local, rivals, cb);
  }

  selectSniperTarget(
    targetId: string,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    cb: ItemCallbacks
  ): boolean {
    if (local.heldItem !== 'sniper') return false;
    const target = this.findRiderById(targetId, rivals);
    if (!target || target.id === local.id) return false;

    // Consume sniper rifle and begin 1.15s scope lock
    local.heldItem = null;
    this.sniperPhase = 'aiming';
    this.sniperTargetId = target.id;
    this.sniperTargetName = target.name;
    this.sniperTimer = 0;
    this.sniperResult = undefined;
    this.sniperHudState.lockQuality = 0.85;

    cb.onSfx('sniperLock');
    cb.onPublishNetEvent({
      t: 'item_use',
      item: 'sniper',
      to: target.id,
      toName: target.name,
      s: local.s,
      x: local.x,
    });
    cb.onBroadcast(`🎯 ${local.name} 对 ${target.name} 使用了 狙击枪`, 'cyan');
    return true;
  }

  useHeldItem(
    local: RiderRenderState,
    rivals: RiderRenderState[],
    cb: ItemCallbacks
  ): boolean {
    if (local.crashed) return false;

    // Pressing R again while sniper selector is open auto-targets the closest rival!
    if (this.sniperPhase === 'selecting' && local.heldItem === 'sniper') {
      this.refreshSniperCandidates(local, rivals);
      if (this.sniperCandidates.length > 0) {
        return this.selectSniperTarget(this.sniperCandidates[0].id, local, rivals, cb);
      }
      this.cancelSniper();
      cb.onToast('附近无目标', 'gold');
      return false;
    }

    const item = local.heldItem;
    if (!item) return false;

    if (item === 'sniper') {
      this.refreshSniperCandidates(local, rivals);
      if (this.sniperCandidates.length === 0) {
        cb.onToast('附近无狙击目标', 'gold');
        return false;
      }
      this.sniperPhase = 'selecting';
      this.sniperTargetId = null;
      this.sniperTargetName = '';
      this.sniperResult = undefined;
      cb.onSfx('sniperLock');
      return true;
    }

    // Consume non-sniper item immediately
    local.heldItem = null;
    const spec = ITEM_BY_ID[item];
    const seed = (Math.floor(this.timeSec * 1000) ^ (Math.floor(local.s) * 31)) & 0xffff;

    switch (item) {
      case 'rpg': {
        const target = this.findNearestRivalAhead(local, rivals, 165);
        this.spawnRocket(local.id, local.name, target ? target.id : null, local.s + 2.0, local.x);
        cb.onSfx('boost');
        cb.onShake(0.24, 0.18);
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'rpg',
          to: target?.id,
          toName: target?.name,
          s: local.s,
          x: local.x,
          seed,
        });
        cb.onBroadcast(
          target
            ? `${spec.icon} ${local.name} 对 ${target.name} 发射了 ${spec.zhName}`
            : `${spec.icon} ${local.name} 发射了 ${spec.zhName}`,
          'red'
        );
        return true;
      }
      case 'airstrike': {
        this.spawnBomberJet(local.id, local.name, local.s - 22, local.x);
        cb.onSfx('jet');
        cb.onShake(0.28, 0.35);
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'airstrike',
          s: local.s,
          x: local.x,
          seed,
        });
        cb.onBroadcast(`${spec.icon} ${local.name} 呼叫了 ${spec.zhName}!`, 'red');
        return true;
      }
      case 'police': {
        const target = this.findNearestRivalAhead(local, rivals, 170) ?? this.findNearestRival(local, rivals, 170);
        const spawnS = target ? target.s - 18 : local.s + 14;
        const spawnX = target ? clamp(target.x + (target.x >= 0 ? -2.2 : 2.2), -ROAD_HALF_WIDTH + 1.2, ROAD_HALF_WIDTH - 1.2) : local.x;
        this.spawnInterceptor(local.id, local.name, target ? target.id : null, spawnS, spawnX);
        cb.onSfx('siren');
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'police',
          to: target?.id,
          toName: target?.name,
          s: spawnS,
          x: spawnX,
        });
        cb.onBroadcast(
          target
            ? `${spec.icon} ${local.name} 对 ${target.name} 使用了 ${spec.zhName}`
            : `${spec.icon} ${local.name} 召唤了 ${spec.zhName}`,
          'cyan'
        );
        return true;
      }
      case 'turbo': {
        cb.onLocalActivateTurbo(3.5);
        cb.onSfx('boost');
        cb.onShake(0.3, 0.28);
        cb.onPopup('BOOST', local.s + 1.5, local.x, 1.6);
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'turbo',
          s: local.s,
          x: local.x,
        });
        cb.onBroadcast(`${spec.icon} ${local.name} 开启了 ${spec.zhName}!`, 'gold');
        return true;
      }
      case 'magnet': {
        cb.onLocalActivateMagnet(5.0);
        cb.onSfx('pickup');
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'magnet',
          s: local.s,
          x: local.x,
        });
        cb.onBroadcast(`${spec.icon} ${local.name} 激活了 ${spec.zhName}`, 'cyan');
        return true;
      }
      case 'trap': {
        const dropS = Math.max(0, local.s - 2.4);
        this.spawnHazard('trap', local.id, local.name, dropS, local.x);
        cb.onSfx('pickup');
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'trap',
          s: dropS,
          x: local.x,
        });
        cb.onBroadcast(`${spec.icon} ${local.name} 部署了 ${spec.zhName}`, 'gold');
        return true;
      }
      case 'banana': {
        const dropS = Math.max(0, local.s - 2.4);
        this.spawnHazard('banana', local.id, local.name, dropS, local.x);
        cb.onSfx('bananaSlip');
        cb.onPublishNetEvent({
          t: 'item_use',
          item: 'banana',
          s: dropS,
          x: local.x,
        });
        cb.onBroadcast(`${spec.icon} ${local.name} 扔出了 ${spec.zhName}`, 'gold');
        return true;
      }
    }
  }

  handleNetEvent(
    ev: ItemNetEvent,
    local: RiderRenderState,
    cb: ItemCallbacks
  ): void {
    const spec = ITEM_BY_ID[ev.item];
    if (!spec) return;

    if (ev.t === 'item_pick') {
      cb.onBroadcast(`📦 ${ev.fromName} 拾取了 ${spec.icon} ${spec.zhName}`, 'green');
      return;
    }

    if (ev.t === 'item_use') {
      cb.onBroadcast(
        ev.toName
          ? `${spec.icon} ${ev.fromName} 对 ${ev.toName} 使用了 ${spec.zhName}`
          : `${spec.icon} ${ev.fromName} 使用了 ${spec.zhName}`,
        ev.item === 'rpg' || ev.item === 'airstrike' ? 'red' : 'cyan'
      );

      switch (ev.item) {
        case 'rpg':
          this.spawnRocket(ev.from, ev.fromName, ev.to ?? null, ev.s + 2.0, ev.x);
          break;
        case 'airstrike':
          this.spawnBomberJet(ev.from, ev.fromName, ev.s - 22, ev.x);
          if (Math.abs(ev.s - local.s) < 190) cb.onSfx('jet');
          break;
        case 'sniper':
          this.remoteLaserFromId = ev.from;
          this.remoteLaserToId = ev.to ?? null;
          this.remoteLaserTimer = SNIPER_AIM_SEC;
          if (ev.to === local.id) {
            this.incomingLockFrom = ev.fromName;
            this.incomingLockTimer = SNIPER_AIM_SEC + 0.25;
            local.incomingLockName = ev.fromName;
            cb.onSfx('sniperLock');
          }
          break;
        case 'police':
          this.spawnInterceptor(ev.from, ev.fromName, ev.to ?? null, ev.s, ev.x);
          if (ev.to === local.id || Math.abs(ev.s - local.s) < 120) {
            cb.onSfx('siren');
          }
          break;
        case 'trap':
          this.spawnHazard('trap', ev.from, ev.fromName, ev.s, ev.x);
          break;
        case 'banana':
          this.spawnHazard('banana', ev.from, ev.fromName, ev.s, ev.x);
          break;
      }
      return;
    }

    if (ev.t === 'item_hit') {
      const targetLabel = ev.toName ?? (ev.to === local.id ? local.name : '对手');
      if (ev.item === 'sniper') {
        cb.onBroadcast(`🎯 ${ev.fromName} 用狙击枪击倒了 ${targetLabel}!`, 'red');
      } else if (ev.item === 'rpg') {
        cb.onBroadcast(`💥 ${ev.fromName} 的 RPG 炸飞了 ${targetLabel}!`, 'red');
      } else if (ev.item === 'airstrike') {
        cb.onBroadcast(`✈️ ${ev.fromName} 的空袭轰炸了 ${targetLabel}!`, 'red');
      } else if (ev.item === 'banana') {
        cb.onBroadcast(`🍌 ${targetLabel} 踩中了 ${ev.fromName} 的香蕉皮!`, 'gold');
      } else if (ev.item === 'trap') {
        cb.onBroadcast(`⚙️ ${targetLabel} 撞上了 ${ev.fromName} 的路钉陷阱!`, 'red');
      }

      if (ev.to === local.id) {
        if (ev.item === 'sniper') {
          this.incomingLockTimer = 0;
          this.incomingLockFrom = null;
          local.incomingLockName = null;
          cb.onSfx('sniperShot');
          cb.onLocalDamage(ev.dmg ?? 75, ev.knockX ?? 12, true, `${ev.fromName} 狙击`, 'SNIPED');
        } else if (ev.item === 'banana') {
          cb.onSfx('bananaSlip');
          cb.onLocalSpinOut(1.3, ev.dmg ?? 22, `${ev.fromName} 香蕉皮`);
        } else {
          cb.onSfx('explosion');
          cb.onLocalDamage(
            ev.dmg ?? 55,
            ev.knockX ?? 14,
            ev.ko ?? true,
            `${ev.fromName} ${spec.zhName}`,
            ev.item === 'trap' ? 'KO' : 'BOOM'
          );
        }
      }
      return;
    }

    if (ev.t === 'item_miss') {
      const targetLabel = ev.toName ?? (ev.to === local.id ? local.name : '对手');
      cb.onBroadcast(`💨 ${targetLabel} 极限躲开了 ${ev.fromName} 的狙击!`, 'green');
      if (ev.to === local.id) {
        this.incomingLockTimer = 0;
        this.incomingLockFrom = null;
        local.incomingLockName = null;
        cb.onSfx('sniperShot');
        cb.onPopup('DODGED', local.s, local.x, 1.7);
        cb.onToast('极限躲避狙击!', 'cyan');
      }
    }
  }

  update(
    dt: number,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    allRiders: RiderRenderState[],
    cb: ItemCallbacks
  ): void {
    const step = dt > 0.05 ? 0.05 : dt < 0 ? 0 : dt;
    this.timeSec += step;
    this.smokeAccum += step;

    // 1. Incoming sniper warning timer
    if (this.incomingLockTimer > 0) {
      this.incomingLockTimer = Math.max(0, this.incomingLockTimer - step);
      local.incomingLockName = this.incomingLockTimer > 0 ? this.incomingLockFrom : null;
    } else {
      local.incomingLockName = null;
    }

    // 2. Deterministic road `?` crates & pickup (+ magnet vacuum!)
    this.updateCrates(local, cb);

    // 3. Magnet rival lateral pull
    if (local.magnetTimer > 0 && !local.crashed) {
      const closest = this.findNearestRival(local, rivals, 26);
      if (closest && !closest.crashed && Math.abs(closest.x - local.x) > 1.35) {
        const pullDir = local.x > closest.x ? 1 : -1;
        if (closest.isBot) {
          closest.vx = clamp(closest.vx + pullDir * 14.0 * step, -14, 14);
        }
      }
    }

    // 4. Local sniper selector / aiming / fair judgment
    this.updateLocalSniper(step, local, rivals, cb);

    // 5. Remote sniper laser visualization
    if (this.remoteLaserTimer > 0) {
      this.remoteLaserTimer = Math.max(0, this.remoteLaserTimer - step);
      if (this.sniperPhase !== 'aiming') {
        const shooter = this.remoteLaserFromId ? this.findRiderById(this.remoteLaserFromId, allRiders) : null;
        const target = this.remoteLaserToId ? this.findRiderById(this.remoteLaserToId, allRiders) : null;
        if (shooter && target && this.remoteLaserTimer > 0) {
          this.sniperLaser.active = true;
          this.sniperLaser.fromS = shooter.s;
          this.sniperLaser.fromX = shooter.x;
          this.sniperLaser.fromY = shooter.y + 1.35;
          this.sniperLaser.toS = target.s;
          this.sniperLaser.toX = target.x;
          this.sniperLaser.toY = target.y + 1.15;
          this.sniperLaser.progress = 1 - this.remoteLaserTimer / SNIPER_AIM_SEC;
        } else {
          this.sniperLaser.active = false;
        }
      }
    } else if (this.sniperPhase !== 'aiming') {
      this.sniperLaser.active = false;
    }

    // 6. Active projectiles, bomber jets, bombs, police interceptors & road hazards
    this.updateRockets(step, local, rivals, cb);
    this.updateJetsAndBombs(step, local, rivals, cb);
    this.updateInterceptors(step, local, rivals, allRiders, cb);
    this.updateHazards(step, local, rivals, cb);
  }

  private updateCrates(local: RiderRenderState, cb: ItemCallbacks): void {
    // Expire old crate pickup cooldowns
    if (this.collectedSlots.size > 0) {
      for (const [slot, expiresAt] of this.collectedSlots) {
        if (this.timeSec >= expiresAt) {
          this.collectedSlots.delete(slot);
        }
      }
    }

    this.crates.length = 0;
    const minSlot = Math.max(1, Math.floor((local.s - 18) / CRATE_SPACING));
    const maxSlot = Math.floor((local.s + 260) / CRATE_SPACING);
    let poolIdx = 0;

    for (let slot = minSlot; slot <= maxSlot && poolIdx < this.cratePool.length; slot++) {
      if (this.collectedSlots.has(slot)) continue;
      const laneIdx = Math.floor(hash1(slot * 6151 + 29) * 4);
      const crateS = slot * CRATE_SPACING + 22.0;
      const crateX = LANE_CENTERS[laneIdx];

      // Pickup check (Magnet widens lateral capture across all 4 lanes!)
      const latReach = local.magnetTimer > 0 ? 12.5 : 1.75;
      const lonReach = local.magnetTimer > 0 ? 7.0 : 2.6;
      if (
        !local.crashed &&
        Math.abs(local.s - crateS) < lonReach &&
        Math.abs(local.x - crateX) < latReach
      ) {
        this.collectedSlots.set(slot, this.timeSec + CRATE_COOLDOWN_SEC);
        const pickIdx = Math.floor(Math.random() * ITEMS.length);
        const spec = ITEMS[pickIdx];
        local.heldItem = spec.id;
        // Reset sniper selection if player replaced item
        if (this.sniperPhase === 'selecting' && spec.id !== 'sniper') {
          this.sniperPhase = 'idle';
        }
        cb.onSfx('pickup');
        cb.onParticles('nitro', crateS, crateX, 1.0, local.speed * 0.4);
        cb.onToast(`${spec.icon} ${spec.zhName}`, 'gold');
        cb.onBroadcast(`📦 ${local.name} 拾取了 ${spec.icon} ${spec.zhName}`, 'green');
        cb.onPublishNetEvent({
          t: 'item_pick',
          item: spec.id,
          s: crateS,
          x: crateX,
        });
        continue;
      }

      const vis = this.cratePool[poolIdx++];
      vis.slot = slot;
      vis.s = crateS;
      vis.x = crateX;
      this.crates.push(vis);
    }
  }

  private updateLocalSniper(
    dt: number,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    cb: ItemCallbacks
  ): void {
    if (this.sniperPhase === 'selecting') {
      if (local.crashed || local.heldItem !== 'sniper') {
        this.sniperPhase = 'idle';
        return;
      }
      this.refreshSniperCandidates(local, rivals);
      return;
    }

    if (this.sniperPhase === 'aiming') {
      this.sniperTimer += dt;
      const target = this.sniperTargetId ? this.findRiderById(this.sniperTargetId, rivals) : null;

      if (target) {
        this.sniperTargetName = target.name;
        this.sniperLaser.active = true;
        this.sniperLaser.fromS = local.s;
        this.sniperLaser.fromX = local.x;
        this.sniperLaser.fromY = local.y + 1.35;
        this.sniperLaser.toS = target.s;
        this.sniperLaser.toX = target.x;
        this.sniperLaser.toY = target.y + 1.15;
        this.sniperLaser.progress = clamp(this.sniperTimer / SNIPER_AIM_SEC, 0, 1);

        const evading = this.isTargetEvadingSniper(local, target);
        this.sniperHudState.lockQuality = evading ? 0.25 : 0.96;
      } else {
        this.sniperLaser.active = false;
        this.sniperHudState.lockQuality = 0;
      }

      if (this.sniperTimer >= SNIPER_AIM_SEC) {
        this.sniperLaser.active = false;
        this.sniperPhase = 'fired';
        this.sniperTimer = 0;
        cb.onSfx('sniperShot');
        cb.onShake(0.32, 0.2);

        if (!target || Math.abs(target.s - local.s) > SNIPER_MAX_RANGE) {
          this.sniperResult = 'MISS';
          cb.onBroadcast(`💨 ${this.sniperTargetName || '目标'} 脱离了 ${local.name} 的射程!`, 'cyan');
          cb.onPublishNetEvent({
            t: 'item_miss',
            item: 'sniper',
            to: this.sniperTargetId ?? undefined,
            toName: this.sniperTargetName,
            s: local.s,
            x: local.x,
          });
        } else if (this.isTargetEvadingSniper(local, target)) {
          this.sniperResult = 'DODGED';
          cb.onPopup('DODGED', target.s, target.x, 1.75);
          cb.onBroadcast(`💨 ${target.name} 极限躲开了 ${local.name} 的狙击!`, 'green');
          cb.onPublishNetEvent({
            t: 'item_miss',
            item: 'sniper',
            to: target.id,
            toName: target.name,
            s: target.s,
            x: target.x,
          });
        } else {
          this.sniperResult = 'HIT';
          const knockX = target.x >= local.x ? 14 : -14;
          cb.onPopup('SNIPED', target.s, target.x, 1.85);
          cb.onParticles('crash', target.s, target.x, 1.0, target.speed * 0.35);
          cb.onHitRival(target, 'sniper', 75, knockX, true, false);
          cb.onBroadcast(`🎯 ${local.name} 用狙击枪击倒了 ${target.name}!`, 'red');
          cb.onPublishNetEvent({
            t: 'item_hit',
            item: 'sniper',
            to: target.id,
            toName: target.name,
            s: target.s,
            x: target.x,
            dmg: 75,
            knockX,
            ko: true,
          });
        }
      }
      return;
    }

    if (this.sniperPhase === 'fired') {
      this.sniperTimer += dt;
      if (this.sniperTimer >= SNIPER_RESULT_SHOW_SEC) {
        this.sniperPhase = 'idle';
        this.sniperTargetId = null;
        this.sniperTargetName = '';
        this.sniperResult = undefined;
      }
    }
  }

  private isTargetEvadingSniper(shooter: RiderRenderState, target: RiderRenderState): boolean {
    if (target.crashed || target.invulnTimer > 0 || target.turboShieldTimer > 0) return true;
    if (Math.abs(target.s - shooter.s) > SNIPER_MAX_RANGE) return true;
    if (target.y > 0.35) return true; // Wheelie hop dodge!
    if (Math.abs(target.vx) > 7.0) return true; // Hard lateral swerve dodge!
    if (target.nitroActive) return true; // Nitro burst dodge!
    return false;
  }

  private updateRockets(
    dt: number,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    cb: ItemCallbacks
  ): void {
    const emitSmoke = this.smokeAccum >= 0.04;
    if (emitSmoke) this.smokeAccum = 0;

    for (let i = 0; i < this.rockets.length; i++) {
      const r = this.rockets[i];
      if (!r.active) continue;

      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        continue;
      }

      // Mild lateral homing toward target rival
      if (r.targetId) {
        const tgt =
          r.targetId === local.id ? local : this.findRiderById(r.targetId, rivals);
        if (tgt && !tgt.crashed && tgt.s > r.s - 3) {
          const dx = tgt.x - r.x;
          r.x += clamp(dx * 5.2, -16, 16) * dt;
        }
      }

      r.s += r.speed * dt;
      if (emitSmoke) {
        cb.onParticles('smoke', r.s - 0.8, r.x, r.y, r.speed * 0.2);
      }

      // Check impact against rivals (only owner triggers authoritative damage to avoid double-hits)
      if (r.ownerId === local.id) {
        for (let j = 0; j < rivals.length; j++) {
          const t = rivals[j];
          if (t.crashed || t.invulnTimer > 0) continue;
          if (Math.abs(t.s - r.s) < 3.8 && Math.abs(t.x - r.x) < 1.85) {
            r.active = false;
            const knockX = t.x >= r.x ? 16 : -16;
            cb.onSfx('explosion');
            cb.onShake(0.55, 0.34);
            cb.onParticles('crash', r.s, r.x, 1.0, t.speed * 0.3);
            cb.onPopup('BOOM', r.s, r.x, 1.8);
            cb.onHitRival(t, 'rpg', 65, knockX, true, false);
            cb.onBroadcast(`💥 ${local.name} 的 RPG 炸飞了 ${t.name}!`, 'red');
            cb.onPublishNetEvent({
              t: 'item_hit',
              item: 'rpg',
              to: t.id,
              toName: t.name,
              s: t.s,
              x: t.x,
              dmg: 65,
              knockX,
              ko: true,
            });
            break;
          }
        }
      } else if (
        !local.crashed &&
        Math.abs(local.s - r.s) < 3.6 &&
        Math.abs(local.x - r.x) < 1.75
      ) {
        // Remote visual rocket explodes visually on arrival
        r.active = false;
        cb.onSfx('explosion');
        cb.onParticles('crash', r.s, r.x, 1.0, local.speed * 0.3);
        cb.onPopup('BOOM', r.s, r.x, 1.75);
      }
    }
  }

  private updateJetsAndBombs(
    dt: number,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    cb: ItemCallbacks
  ): void {
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i];
      if (!jet.active) continue;
      jet.life -= dt;
      jet.s += jet.speed * dt;
      if (jet.dropsLeft > 0) {
        jet.dropTimer -= dt;
        if (jet.dropTimer <= 0) {
          jet.dropTimer = 0.17;
          const idx = 5 - jet.dropsLeft;
          const laneX = LANE_CENTERS[(idx + Math.abs(Math.floor(jet.x))) % 4];
          this.spawnBomb(jet.ownerId, jet.ownerName, jet.s + 26, laneX);
          jet.dropsLeft--;
        }
      }
      if (jet.life <= 0) {
        jet.active = false;
      }
    }

    for (let i = 0; i < this.bombs.length; i++) {
      const b = this.bombs[i];
      if (!b.active) continue;
      b.fuse += dt;
      b.y = Math.max(0.08, b.y + b.vy * dt);
      b.vy -= 14.0 * dt;

      if (b.y <= 0.1 || b.fuse >= b.maxFuse) {
        b.active = false;
        if (Math.abs(b.s - local.s) < 190) {
          cb.onSfx('explosion');
          cb.onParticles('crash', b.s, b.x, 0.7, 12);
          cb.onPopup('BOOM', b.s, b.x, 1.6);
          if (Math.abs(b.s - local.s) < 55) {
            cb.onShake(0.42, 0.25);
          }
        }

        // Blast radius damage
        if (b.ownerId === local.id) {
          for (let j = 0; j < rivals.length; j++) {
            const t = rivals[j];
            if (t.crashed || t.invulnTimer > 0) continue;
            if (Math.abs(t.s - b.s) < 5.5 && Math.abs(t.x - b.x) < 3.2) {
              const knockX = t.x >= b.x ? 15 : -15;
              cb.onHitRival(t, 'airstrike', 60, knockX, true, false);
              cb.onBroadcast(`✈️ ${local.name} 的空袭轰炸了 ${t.name}!`, 'red');
              cb.onPublishNetEvent({
                t: 'item_hit',
                item: 'airstrike',
                to: t.id,
                toName: t.name,
                s: t.s,
                x: t.x,
                dmg: 60,
                knockX,
                ko: true,
              });
            }
          }
        } else if (
          !local.crashed &&
          Math.abs(local.s - b.s) < 5.2 &&
          Math.abs(local.x - b.x) < 3.0
        ) {
          const knockX = local.x >= b.x ? 15 : -15;
          cb.onLocalDamage(60, knockX, true, `${b.ownerName} 空中支援`, 'BOOM');
        }
      }
    }
  }

  private updateInterceptors(
    dt: number,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    allRiders: RiderRenderState[],
    cb: ItemCallbacks
  ): void {
    for (let i = 0; i < this.interceptors.length; i++) {
      const cop = this.interceptors[i];
      if (!cop.active) continue;

      cop.life -= dt;
      if (cop.life <= 0) {
        cop.active = false;
        continue;
      }

      const target = cop.targetId ? this.findRiderById(cop.targetId, allRiders) : null;
      if (target && !target.crashed) {
        // Pull up alongside/slightly ahead to box target's lane
        const desiredS = target.s + 1.8;
        const errS = desiredS - cop.s;
        cop.speed = clamp(target.speed + errS * 2.8, 22, 86);
        cop.s += cop.speed * dt;

        const sideOffset = cop.x >= target.x ? 1.85 : -1.85;
        const desiredX = clamp(target.x + sideOffset, -ROAD_HALF_WIDTH + 1.2, ROAD_HALF_WIDTH - 1.2);
        cop.x += clamp((desiredX - cop.x) * 5.0, -10, 10) * dt;

        const boxing = Math.abs(cop.s - target.s) < 6.0 && Math.abs(cop.x - target.x) < 3.4;
        if (boxing) {
          const shoveX = target.x >= cop.x ? 7.5 : -7.5;
          if (target.id === local.id) {
            cb.onLocalPoliceDrag(dt, shoveX);
          } else if (cop.ownerId === local.id) {
            cb.onPoliceDragRival(target, dt, shoveX);
          }
          cop.sirenTimer -= dt;
          if (cop.sirenTimer <= 0) {
            cop.sirenTimer = 1.1;
            if (Math.abs(cop.s - local.s) < 90) {
              cb.onSfx('siren');
            }
          }
        }
      } else {
        cop.s += cop.speed * dt;
      }
    }
  }

  private updateHazards(
    dt: number,
    local: RiderRenderState,
    rivals: RiderRenderState[],
    cb: ItemCallbacks
  ): void {
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i];
      if (!h.active) continue;

      h.life -= dt;
      if (h.armDelay > 0) h.armDelay = Math.max(0, h.armDelay - dt);
      if (h.life <= 0 || h.s < local.s - 60) {
        h.active = false;
        continue;
      }
      if (h.armDelay > 0) continue;

      const hitDs = h.kind === 'trap' ? 1.85 : 1.65;
      const hitDx = h.kind === 'trap' ? 1.7 : 1.35;

      // Local player hits hazard (can hop over with y > 0.35 or smash through with turboShield!)
      if (
        !local.crashed &&
        local.y < 0.35 &&
        Math.abs(local.s - h.s) < hitDs &&
        Math.abs(local.x - h.x) < hitDx
      ) {
        h.active = false;
        if (local.turboShieldTimer > 0) {
          cb.onParticles('spark', h.s, h.x, 0.35, local.speed * 0.4);
          continue;
        }
        if (h.kind === 'banana') {
          cb.onSfx('bananaSlip');
          cb.onLocalSpinOut(1.3, 22, `${h.ownerName} 香蕉皮`);
          cb.onBroadcast(`🍌 ${local.name} 踩中了 ${h.ownerName} 的香蕉皮!`, 'gold');
          if (h.ownerId !== local.id) {
            cb.onPublishNetEvent({
              t: 'item_hit',
              item: 'banana',
              to: local.id,
              toName: local.name,
              s: h.s,
              x: h.x,
              dmg: 22,
            });
          }
        } else {
          cb.onSfx('explosion');
          cb.onParticles('spark', h.s, h.x, 0.5, local.speed * 0.35);
          cb.onLocalDamage(45, local.vx >= 0 ? 10 : -10, true, `${h.ownerName} 路钉陷阱`, 'KO');
          cb.onBroadcast(`⚙️ ${local.name} 撞上了 ${h.ownerName} 的路钉陷阱!`, 'red');
        }
        continue;
      }

      // Bots hit local player's hazards
      for (let j = 0; j < rivals.length; j++) {
        const r = rivals[j];
        if (!r.isBot || r.crashed || r.y >= 0.35) continue;
        if (Math.abs(r.s - h.s) < hitDs && Math.abs(r.x - h.x) < hitDx) {
          h.active = false;
          if (h.kind === 'banana') {
            cb.onSfx('bananaSlip');
            cb.onPopup('SLIP', r.s, r.x, 1.65);
            cb.onHitRival(r, 'banana', 22, 0, false, true);
            cb.onBroadcast(`🍌 ${r.name} 踩中了 ${h.ownerName} 的香蕉皮!`, 'gold');
          } else {
            cb.onSfx('explosion');
            cb.onParticles('spark', h.s, h.x, 0.5, r.speed * 0.35);
            cb.onPopup('KO', r.s, r.x, 1.7);
            cb.onHitRival(r, 'trap', 45, r.x >= h.x ? 12 : -12, true, false);
            cb.onBroadcast(`⚙️ ${r.name} 撞上了 ${h.ownerName} 的路钉陷阱!`, 'red');
          }
          break;
        }
      }
    }
  }

  private refreshSniperCandidates(local: RiderRenderState, rivals: RiderRenderState[]): void {
    this.sniperCandidates.length = 0;
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      if (r.id === local.id || r.crashed) continue;
      const distM = r.s - local.s;
      if (Math.abs(distM) > SNIPER_MAX_RANGE) continue;
      this.sniperCandidates.push({
        id: r.id,
        name: r.name,
        distM: Math.round(distM),
        avatarIdx: r.avatarIdx,
      });
    }
    this.sniperCandidates.sort((a, b) => Math.abs(a.distM) - Math.abs(b.distM));
    if (this.sniperCandidates.length > 5) {
      this.sniperCandidates.length = 5;
    }
  }

  private findRiderById(id: string, list: RiderRenderState[]): RiderRenderState | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  private findNearestRivalAhead(
    local: RiderRenderState,
    rivals: RiderRenderState[],
    maxRange: number
  ): RiderRenderState | null {
    let best: RiderRenderState | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      if (r.id === local.id || r.crashed) continue;
      const ds = r.s - local.s;
      if (ds > -2 && ds < maxRange && ds < bestDist) {
        bestDist = ds;
        best = r;
      }
    }
    return best;
  }

  private findNearestRival(
    local: RiderRenderState,
    rivals: RiderRenderState[],
    maxRange: number
  ): RiderRenderState | null {
    let best: RiderRenderState | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      if (r.id === local.id || r.crashed) continue;
      const absDs = Math.abs(r.s - local.s);
      if (absDs < maxRange && absDs < bestDist) {
        bestDist = absDs;
        best = r;
      }
    }
    return best;
  }

  private spawnRocket(
    ownerId: string,
    ownerName: string,
    targetId: string | null,
    s: number,
    x: number
  ): void {
    for (let i = 0; i < this.rockets.length; i++) {
      const r = this.rockets[i];
      if (!r.active) {
        r.active = true;
        r.ownerId = ownerId;
        r.ownerName = ownerName;
        r.targetId = targetId;
        r.s = s;
        r.x = x;
        r.y = 0.95;
        r.speed = 115;
        r.life = 2.4;
        return;
      }
    }
  }

  private spawnBomberJet(ownerId: string, ownerName: string, s: number, x: number): void {
    for (let i = 0; i < this.jets.length; i++) {
      const jet = this.jets[i];
      if (!jet.active) {
        jet.active = true;
        jet.ownerId = ownerId;
        jet.ownerName = ownerName;
        jet.s = s;
        jet.x = clamp(x, -4, 4);
        jet.y = 14.5;
        jet.speed = 122;
        jet.life = 2.6;
        jet.dropsLeft = 5;
        jet.dropTimer = 0.22;
        return;
      }
    }
  }

  private spawnBomb(ownerId: string, ownerName: string, s: number, x: number): void {
    for (let i = 0; i < this.bombs.length; i++) {
      const b = this.bombs[i];
      if (!b.active) {
        b.active = true;
        b.ownerId = ownerId;
        b.ownerName = ownerName;
        b.s = s;
        b.x = x;
        b.y = 13.5;
        b.vy = -12.0;
        b.fuse = 0;
        b.maxFuse = 0.88;
        return;
      }
    }
  }

  private spawnInterceptor(
    ownerId: string,
    ownerName: string,
    targetId: string | null,
    s: number,
    x: number
  ): void {
    for (let i = 0; i < this.interceptors.length; i++) {
      const cop = this.interceptors[i];
      if (!cop.active) {
        cop.active = true;
        cop.ownerId = ownerId;
        cop.ownerName = ownerName;
        cop.targetId = targetId;
        cop.s = s;
        cop.x = x;
        cop.speed = 62;
        cop.life = 4.5;
        cop.sirenTimer = 0.1;
        return;
      }
    }
  }

  private spawnHazard(
    kind: 'trap' | 'banana',
    ownerId: string,
    ownerName: string,
    s: number,
    x: number
  ): void {
    let slot = this.hazards[0];
    for (let i = 0; i < this.hazards.length; i++) {
      if (!this.hazards[i].active) {
        slot = this.hazards[i];
        break;
      }
    }
    slot.active = true;
    slot.kind = kind;
    slot.ownerId = ownerId;
    slot.ownerName = ownerName;
    slot.s = s;
    slot.x = clamp(x, -ROAD_HALF_WIDTH + 0.9, ROAD_HALF_WIDTH - 0.9);
    slot.life = 18.0;
    slot.armDelay = 0.28;
  }
}
