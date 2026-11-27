import {
  AVATAR_COUNT,
  PIXEL_AVATARS,
  getAvatarDataUrl,
  getAvatarVersion,
  getCustomAvatarDataUrl,
  getRiderAvatarDataUrl,
} from '../game/PixelAvatars';
import { getLapNumber, signedTrackDelta } from '../game/RoadMath';
import {
  BIKE_PALETTES,
  BOT_PALETTE,
  HeldItemSlot,
  ITEM_BY_ID,
  ItemType,
  MAX_HELD_ITEMS,
  MULTI_ITEM_TTL,
  RiderRenderState,
  SniperHudState,
  WEAPONS,
  WeaponType,
} from '../game/types';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';
export type ToastAccent = 'gold' | 'cyan' | 'red';
export type BroadcastAccent = 'gold' | 'cyan' | 'red' | 'green';

export interface SniperCandidate {
  id: string;
  name: string;
  distM: number;
  avatarIdx: number;
}

export type TouchInputPatch = Partial<{
  left: boolean;
  right: boolean;
  brake: boolean;
  nitro: boolean;
  wheelie: boolean;
  attackLeft: boolean;
  attackRight: boolean;
}>;

export interface HudCallbacks {
  onNameChange(name: string): void;
  onAvatarChange(avatarIdx: number): void;
  onCustomAvatarUpload(file: File): void;
  onClearCustomAvatar(): void;
  onUseItem(slotIndex?: number): void;
  onSelectSniperTarget(targetId: string): void;
  onCancelSniper(): void;
  onEditingName(editing: boolean): void;
  onToggleMute(): boolean;
  onTogglePixelScale(): number;
  onCycleCamera(): number;
  onSelectWeapon(w: 0 | 1 | 2): void;
  onRegroupPack(): void;
  onGyroSteer(steer: number | null): void;
  onTouchInput?(patch: TouchInputPatch): void;
}

const STANDINGS_SLOTS = 5;
const BAR_SEGMENTS = 12;
const RADAR_POOL = 16;
const RADAR_RANGE_M = 40;
const FEED_SLOTS = 3;
const FEED_DURATION_MS = 4500;
const SNIPER_SLOTS = 5;
const FAST_UPDATE_INTERVAL = 1 / 15; // ~15Hz for speed/nitro/HP/weapons/item/wheelie/KO
const SLOW_UPDATE_INTERVAL = 0.11; // ~9Hz for standings & radar
const KEYCAP_FADE_SEC = 7.0;
const TOAST_DURATION_MS = 1800;

// Crisp pixel-art SVG icons (zero curves, crispEdges)
const ICON_PENCIL =
  '<svg class="vm-icon" width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden="true">' +
  '<rect x="7" y="1" width="2" height="2"/><rect x="8" y="2" width="2" height="2"/>' +
  '<rect x="5" y="3" width="2" height="2"/><rect x="6" y="4" width="2" height="2"/>' +
  '<rect x="3" y="5" width="2" height="2"/><rect x="4" y="6" width="2" height="2"/>' +
  '<rect x="1" y="7" width="2" height="2"/><rect x="2" y="8" width="2" height="2"/>' +
  '<rect x="1" y="9" width="1" height="1"/>' +
  '</svg>';

const ICON_SOUND_ON =
  '<svg class="vm-icon" width="14" height="12" viewBox="0 0 14 12" fill="currentColor" aria-hidden="true">' +
  '<rect x="1" y="4" width="2" height="4"/><rect x="3" y="3" width="2" height="6"/>' +
  '<rect x="5" y="1" width="2" height="10"/><rect x="9" y="4" width="1" height="4"/>' +
  '<rect x="11" y="2" width="1" height="8"/><rect x="13" y="4" width="1" height="4"/>' +
  '</svg>';

const ICON_SOUND_OFF =
  '<svg class="vm-icon" width="14" height="12" viewBox="0 0 14 12" fill="currentColor" aria-hidden="true">' +
  '<rect x="1" y="4" width="2" height="4"/><rect x="3" y="3" width="2" height="6"/>' +
  '<rect x="5" y="1" width="2" height="10"/>' +
  '<rect x="9" y="3" width="2" height="2"/><rect x="12" y="3" width="2" height="2"/>' +
  '<rect x="10" y="5" width="3" height="2"/>' +
  '<rect x="9" y="7" width="2" height="2"/><rect x="12" y="7" width="2" height="2"/>' +
  '</svg>';

const ICON_REGROUP =
  '<svg class="vm-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">' +
  '<rect x="6" y="0" width="2" height="3"/><rect x="6" y="11" width="2" height="3"/>' +
  '<rect x="0" y="6" width="3" height="2"/><rect x="11" y="6" width="3" height="2"/>' +
  '<rect x="3" y="3" width="8" height="2"/><rect x="3" y="9" width="8" height="2"/>' +
  '<rect x="3" y="5" width="2" height="4"/><rect x="9" y="5" width="2" height="4"/>' +
  '<rect x="6" y="6" width="2" height="2"/>' +
  '</svg>';

const ICON_SKULL_SM =
  '<svg class="vm-icon" width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">' +
  '<rect x="2" y="0" width="4" height="1"/><rect x="1" y="1" width="6" height="4"/>' +
  '<rect x="2" y="2" width="1" height="1" fill="#1c0810"/><rect x="5" y="2" width="1" height="1" fill="#1c0810"/>' +
  '<rect x="2" y="5" width="4" height="2"/><rect x="3" y="6" width="1" height="1" fill="#1c0810"/>' +
  '</svg>';

const ICON_GYRO =
  '<svg class="vm-icon" width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">' +
  '<rect x="4" y="0" width="6" height="2"/><rect x="4" y="12" width="6" height="2"/>' +
  '<rect x="0" y="4" width="2" height="6"/><rect x="12" y="4" width="2" height="6"/>' +
  '<rect x="2" y="2" width="2" height="2"/><rect x="10" y="2" width="2" height="2"/>' +
  '<rect x="2" y="10" width="2" height="2"/><rect x="10" y="10" width="2" height="2"/>' +
  '<rect x="8" y="4" width="2" height="2"/><rect x="6" y="6" width="2" height="2"/>' +
  '<rect x="4" y="8" width="2" height="2"/>' +
  '</svg>';

const GYRO_DEADZONE_DEG = 4.0;
const GYRO_MAX_TILT_DEG = 25.0;
const GYRO_SENSOR_TIMEOUT_MS = 900;
const TAP_FLASH_MS = 160;

interface StandingRowRefs {
  root: HTMLDivElement;
  rank: HTMLSpanElement;
  avatar: HTMLImageElement;
  name: HTMLSpanElement;
  fire: HTMLSpanElement;
  dist: HTMLSpanElement;
  ko: HTMLSpanElement;
  koVal: HTMLSpanElement;
  visible: boolean;
  lastRank: number;
  lastOwnerId: string;
  lastName: string;
  lastLap: number;
  lastDistTenth: number;
  lastKos: number;
  lastBorderColor: string;
  lastAvatarIdx: number;
  lastAvatarVer: number;
  lastIsLocal: boolean;
  lastIsBot: boolean;
  lastEnraged: boolean;
}

interface RadarDotRefs {
  el: HTMLSpanElement;
  visible: boolean;
  xPx: number;
  yPx: number;
  color: string;
  clamped: boolean;
}

interface FeedEntry {
  id: number;
  text: string;
  accent: BroadcastAccent;
  fading: boolean;
  fadeTimer: number;
  removeTimer: number;
}

interface SniperCardRefs {
  btn: HTMLButtonElement;
  avatar: HTMLImageElement;
  name: HTMLSpanElement;
  dist: HTMLSpanElement;
  targetId: string;
  visible: boolean;
  lastName: string;
  lastDistM: number;
  lastAvatarIdx: number;
  lastAvatarVer: number;
}

interface ItemSlotRefs {
  btn: HTMLButtonElement;
  keyEl: HTMLSpanElement | null;
  iconEl: HTMLSpanElement;
  nameEl: HTMLSpanElement | null;
  ttlEl: HTMLSpanElement;
  barEl: HTMLSpanElement;
  visible: boolean;
  lastType: ItemType | null | undefined;
  lastShowTtl: boolean;
  lastSec: number;
  lastUrgency: number; // 0 ok, 1 warn, 2 crit
  lastBarPct: number;
}

function getRiderColor(colorIdx: number, isBot: boolean): string {
  if (isBot) return BOT_PALETTE.primary;
  const idx = ((colorIdx % BIKE_PALETTES.length) + BIKE_PALETTES.length) % BIKE_PALETTES.length;
  return BIKE_PALETTES[idx].primary;
}

function normalizeAvatarIdx(avatarIdx: number): number {
  if (!Number.isFinite(avatarIdx)) return 0;
  return ((Math.floor(avatarIdx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
}

function compareByDistanceDesc(a: RiderRenderState, b: RiderRenderState): number {
  return b.s - a.s;
}

function formatDeltaMeters(rounded: number): string {
  if (rounded === 0) return '0m';
  const sign = rounded > 0 ? '+' : '-';
  const abs = Math.abs(rounded);
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}km`;
  return `${sign}${abs}m`;
}

function hasAnyKey(pressed: Set<string>, candidates: readonly string[]): boolean {
  for (let i = 0; i < candidates.length; i++) {
    if (pressed.has(candidates[i])) return true;
  }
  return false;
}

const KEY_W = ['KeyW', 'w', 'W', 'ArrowUp'] as const;
const KEY_A = ['KeyA', 'a', 'A', 'ArrowLeft'] as const;
const KEY_S = ['KeyS', 's', 'S', 'ArrowDown'] as const;
const KEY_D = ['KeyD', 'd', 'D', 'ArrowRight'] as const;
const KEY_J = ['KeyJ', 'j', 'J', 'KeyZ', 'z', 'Z'] as const;
const KEY_K = ['KeyK', 'k', 'K', 'KeyX', 'x', 'X'] as const;
const KEY_SPC = ['Space', ' '] as const;
const KEY_SHF = ['ShiftLeft', 'ShiftRight', 'Shift'] as const;

export class Hud {
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLDivElement;

  // Top-left controls & broadcast feed
  private readonly riderPillEl: HTMLDivElement;
  private readonly avatarBtnEl: HTMLButtonElement;
  private readonly avatarImgEl: HTMLImageElement;
  private readonly avatarPopoverEl: HTMLDivElement;
  private readonly avatarOptEls: HTMLButtonElement[] = [];
  private avatarResetBtnEl: HTMLButtonElement | null = null;
  private readonly nameplateEl: HTMLDivElement;
  private readonly nameTextEl: HTMLSpanElement;
  private readonly nameInputEl: HTMLInputElement;
  private readonly netBadgeEl: HTMLDivElement;
  private readonly netCountEl: HTMLSpanElement;
  private readonly muteBtnEl: HTMLButtonElement;
  private readonly pxBtnEl: HTMLButtonElement;
  private readonly camPips: HTMLSpanElement[] = [];
  private readonly regroupBtnEl: HTMLButtonElement;
  private readonly gyroBtnEl: HTMLButtonElement;
  private readonly tapFlashLeftEl: HTMLDivElement;
  private readonly tapFlashRightEl: HTMLDivElement;
  private touchItemBtnEl: HTMLButtonElement | null = null;
  private touchItemLabelEl: HTMLSpanElement | null = null;
  private touchItemCountEl: HTMLSpanElement | null = null;
  private readonly feedLines: HTMLDivElement[] = [];
  private readonly feedEntries: FeedEntry[] = [];
  private nextFeedId = 1;

  // Top-center toast, incoming lock warning & sniper UI
  private readonly toastEl: HTMLDivElement;
  private toastRafId: number | null = null;
  private toastHideTimer: number | null = null;
  private toastClearTimer: number | null = null;
  private readonly dangerLockEl: HTMLDivElement;
  private readonly enragedWarnEl: HTMLDivElement;
  private readonly sniperPickerEl: HTMLDivElement;
  private readonly sniperCards: SniperCardRefs[] = [];
  private readonly scopeLayerEl: HTMLDivElement;
  private readonly scopeBracketsEl: HTMLDivElement;
  private readonly scopeTargetEl: HTMLSpanElement;
  private readonly scopeFillEl: HTMLDivElement;
  private readonly scopeResultEl: HTMLDivElement;

  // Top-right standings & vertical radar
  private readonly standingRows: StandingRowRefs[] = [];
  private readonly radarTrackEl: HTMLDivElement;
  private readonly radarLocalEl: HTMLSpanElement;
  private readonly radarDots: RadarDotRefs[] = [];
  private readonly radarDeltaEl: HTMLSpanElement;

  // Bottom-right wheelie charge, telemetry, item slot & weapons
  private readonly wheelieWrapEl: HTMLDivElement;
  private readonly wheelieTagEl: HTMLSpanElement;
  private readonly wheelieFillEl: HTMLDivElement;
  private readonly koPillEl: HTMLDivElement;
  private readonly koValEl: HTMLSpanElement;
  private readonly speedValEl: HTMLSpanElement;
  private readonly nitroTrackEl: HTMLDivElement;
  private readonly nitroSegs: HTMLSpanElement[] = [];
  private readonly hpTagEl: HTMLSpanElement;
  private readonly hpTrackEl: HTMLDivElement;
  private readonly hpSegs: HTMLSpanElement[] = [];
  private readonly itemSlots: ItemSlotRefs[] = [];
  private readonly weaponChips: HTMLButtonElement[] = [];

  // Bottom-left keycaps
  private readonly keycapsEl: HTMLDivElement;
  private readonly keyEls: HTMLSpanElement[] = [];

  // Internal state & dirty-check caches
  private currentName: string;
  private currentColorIdx: number;
  private currentAvatarIdx: number;
  private localRiderId = '';
  private lastLocalAvatarVer = -1;
  private editingName = false;
  private avatarPopoverOpen = false;
  private avatarPopoverBuilt = false;
  private muted = false;
  private pixelScale = 1;
  private cameraMode = 0;
  private connStatus: ConnectionStatus = 'connecting';
  private onlineCount = 1;
  private hasOnlinePeers = false;

  // Gyroscope steering state
  private gyroEnabled = false;
  private gyroHasData = false;
  private gyroBaseline: number | null = null;
  private gyroSmoothed = 0;
  private gyroSensorTimer: number | null = null;

  // Tap-screen attack edge flash timers
  private tapFlashLeftTimer: number | null = null;
  private tapFlashRightTimer: number | null = null;

  private fastAccum = FAST_UPDATE_INTERVAL;
  private slowAccum = SLOW_UPDATE_INTERVAL;
  private ridingElapsed = 0;
  private keycapsFaded = false;
  private lastKeyMask = -1;

  private lastSpeedKmh = -1;
  private lastSpeedTier = '';
  private lastNitroLit = -1;
  private lastNitroActive = false;
  private lastHpLit = -1;
  private lastHpTier = '';
  private lastWeapon: WeaponType = 0;
  private lastSwinging = false;
  private lastKos = -1;
  private lastTouchItemType: ItemType | null | undefined = undefined;
  private lastTouchItemCount = -1;
  private lastWheeliePct = -1;
  private lastWheelieTier = 0; // 0 hidden, 1 normal, 2 slam, 3 danger
  private lastIncomingLockName: string | null = null;
  private lastEnragedHunter: string | null = null;

  private lastSniperPhase = '';
  private lastScopeProgressPct = -1;
  private lastScopeHot = false;
  private lastScopeTarget = '';
  private lastScopeResult = '';

  private radarInnerW = 20;
  private radarInnerH = 160;
  private radarOuterH = 164;
  private radarDimsDirty = true;
  private lastLocalRadarX = -999;
  private lastLocalRadarY = -999;
  private lastDeltaMeters = 999999;
  private lastDeltaState = 0; // 0 hidden, 1 ahead, 2 even, 3 behind
  private lastDeltaY = -999;

  // Pre-allocated scratch buffer (ZERO per-frame array allocations)
  private readonly sortedBuf: RiderRenderState[] = [];

  private readonly onDocPointerDown = (e: PointerEvent): void => {
    if (!this.avatarPopoverOpen) return;
    if (!this.riderPillEl.contains(e.target as Node)) {
      this.setAvatarPopoverOpen(false);
    }
  };

  private readonly onDocKeyDown = (e: KeyboardEvent): void => {
    if (!this.avatarPopoverOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.setAvatarPopoverOpen(false);
    }
  };

  private readonly onWindowResize = (): void => {
    this.radarDimsDirty = true;
  };

  private readonly onOrientationChange = (): void => {
    if (this.gyroEnabled) {
      this.gyroBaseline = null;
    }
  };

  private readonly onDeviceOrientation = (e: DeviceOrientationEvent): void => {
    if (!this.gyroEnabled) return;

    const screenAngle =
      typeof screen !== 'undefined' &&
      screen.orientation &&
      typeof screen.orientation.angle === 'number'
        ? screen.orientation.angle
        : typeof (window as unknown as { orientation?: number }).orientation === 'number'
          ? (window as unknown as { orientation?: number }).orientation!
          : 0;
    const normAngle = ((Math.round(screenAngle) % 360) + 360) % 360;

    let raw: number | null;
    if (normAngle === 90) {
      raw = e.beta;
    } else if (normAngle === 270) {
      raw = e.beta !== null ? -e.beta : null;
    } else if (normAngle === 180) {
      raw = e.gamma !== null ? -e.gamma : null;
    } else {
      raw = e.gamma;
    }

    if (raw === null || !Number.isFinite(raw)) return;

    if (!this.gyroHasData) {
      this.gyroHasData = true;
      if (this.gyroSensorTimer !== null) {
        window.clearTimeout(this.gyroSensorTimer);
        this.gyroSensorTimer = null;
      }
      this.gyroBaseline = raw;
      this.gyroSmoothed = 0;
      this.showToast('GYRO ON', 'cyan');
      this.callbacks.onGyroSteer(0);
      return;
    }

    if (this.gyroBaseline === null) {
      this.gyroBaseline = raw;
      return;
    }

    let delta = raw - this.gyroBaseline;
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;

    let target = 0;
    const absDelta = Math.abs(delta);
    if (absDelta > GYRO_DEADZONE_DEG) {
      const sign = delta > 0 ? 1 : -1;
      target =
        sign *
        Math.min(1, (absDelta - GYRO_DEADZONE_DEG) / (GYRO_MAX_TILT_DEG - GYRO_DEADZONE_DEG));
    }

    this.gyroSmoothed += (target - this.gyroSmoothed) * 0.35;
    if (target === 0 && Math.abs(this.gyroSmoothed) < 0.01) {
      this.gyroSmoothed = 0;
    }
    this.callbacks.onGyroSteer(this.gyroSmoothed);
  };

  constructor(
    container: HTMLElement,
    initialName: string,
    colorIdx: number,
    initialAvatar: number,
    callbacks: HudCallbacks
  ) {
    this.callbacks = callbacks;
    this.currentName = initialName.trim().slice(0, 14) || 'RIDER';
    this.currentColorIdx = colorIdx;
    this.currentAvatarIdx = normalizeAvatarIdx(initialAvatar);

    this.root = document.createElement('div');
    this.root.className = 'vm-hud-root';

    // -----------------------------------------------------------------------
    // 1. TOP-LEFT COMPACT PILL CLUSTER + BROADCAST TICKER FEED
    // -----------------------------------------------------------------------
    const topLeftCol = document.createElement('div');
    topLeftCol.className = 'vm-top-left-col';

    const topLeft = document.createElement('div');
    topLeft.className = 'vm-top-left';

    this.riderPillEl = document.createElement('div');
    this.riderPillEl.className = 'vm-rider-pill';

    this.avatarBtnEl = document.createElement('button');
    this.avatarBtnEl.type = 'button';
    this.avatarBtnEl.className = 'vm-avatar-btn';
    this.avatarBtnEl.title = 'Avatar';
    this.avatarBtnEl.setAttribute('aria-label', 'Select avatar');
    this.avatarBtnEl.setAttribute('aria-expanded', 'false');
    this.avatarBtnEl.style.borderColor = getRiderColor(colorIdx, false);

    this.avatarImgEl = document.createElement('img');
    this.avatarImgEl.className = 'hud-avatar-img';
    this.avatarImgEl.width = 28;
    this.avatarImgEl.height = 28;
    this.avatarImgEl.alt = '';
    this.avatarImgEl.draggable = false;
    this.avatarImgEl.src = getAvatarDataUrl(this.currentAvatarIdx, 1);
    this.avatarBtnEl.appendChild(this.avatarImgEl);

    this.avatarBtnEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (this.editingName) {
        this.finishEditingName(true);
      }
      this.setAvatarPopoverOpen(!this.avatarPopoverOpen);
      this.avatarBtnEl.blur();
    });

    // Empty container populated lazily on first open
    this.avatarPopoverEl = document.createElement('div');
    this.avatarPopoverEl.className = 'vm-slab vm-avatar-popover';
    this.avatarPopoverEl.setAttribute('role', 'listbox');
    this.avatarPopoverEl.setAttribute('aria-label', 'Avatars');

    // Inline editable nameplate
    this.nameplateEl = document.createElement('div');
    this.nameplateEl.className = 'vm-slab vm-nameplate';
    this.nameplateEl.title = 'Rename';

    this.nameTextEl = document.createElement('span');
    this.nameTextEl.className = 'vm-name-text';
    this.nameTextEl.textContent = this.currentName;

    this.nameInputEl = document.createElement('input');
    this.nameInputEl.className = 'vm-name-input';
    this.nameInputEl.type = 'text';
    this.nameInputEl.maxLength = 14;
    this.nameInputEl.spellcheck = false;
    this.nameInputEl.autocomplete = 'off';
    this.nameInputEl.setAttribute('aria-label', 'Rider name');

    const pencilWrap = document.createElement('span');
    pencilWrap.className = 'vm-pencil';
    pencilWrap.innerHTML = ICON_PENCIL;

    this.nameplateEl.append(this.nameTextEl, this.nameInputEl, pencilWrap);
    this.bindNameplateEvents();

    this.riderPillEl.append(this.avatarBtnEl, this.nameplateEl, this.avatarPopoverEl);

    // Connection & count badge
    this.netBadgeEl = document.createElement('div');
    this.netBadgeEl.className = 'vm-slab vm-net-badge';
    this.netBadgeEl.dataset.status = 'connecting';

    const netDot = document.createElement('span');
    netDot.className = 'vm-net-dot';

    this.netCountEl = document.createElement('span');
    this.netCountEl.className = 'vm-net-count';
    this.netCountEl.textContent = '1';

    this.netBadgeEl.append(netDot, this.netCountEl);

    // Compact action buttons
    const actions = document.createElement('div');
    actions.className = 'vm-actions';

    this.muteBtnEl = document.createElement('button');
    this.muteBtnEl.type = 'button';
    this.muteBtnEl.className = 'vm-btn vm-btn-mute';
    this.muteBtnEl.title = 'Audio';
    this.muteBtnEl.setAttribute('aria-label', 'Toggle audio');
    this.muteBtnEl.innerHTML = ICON_SOUND_ON;
    this.muteBtnEl.addEventListener('click', () => {
      const nowMuted = this.callbacks.onToggleMute();
      this.setMuted(nowMuted);
      this.muteBtnEl.blur();
    });

    this.pxBtnEl = document.createElement('button');
    this.pxBtnEl.type = 'button';
    this.pxBtnEl.className = 'vm-btn vm-btn-px';
    this.pxBtnEl.title = 'Pixel Scale';
    this.pxBtnEl.textContent = 'HD';
    this.pxBtnEl.addEventListener('click', () => {
      const nextScale = this.callbacks.onTogglePixelScale();
      this.applyPixelScale(nextScale);
      this.pxBtnEl.blur();
    });

    const camBtnEl = document.createElement('button');
    camBtnEl.type = 'button';
    camBtnEl.className = 'vm-btn vm-btn-cam';
    camBtnEl.title = 'Camera';
    const camLabel = document.createElement('span');
    camLabel.textContent = 'CAM';
    const camPipsWrap = document.createElement('span');
    camPipsWrap.className = 'vm-cam-pips';
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('span');
      pip.className = i === 0 ? 'vm-cam-pip is-on' : 'vm-cam-pip';
      this.camPips.push(pip);
      camPipsWrap.appendChild(pip);
    }
    camBtnEl.append(camLabel, camPipsWrap);
    camBtnEl.addEventListener('click', () => {
      const nextMode = this.callbacks.onCycleCamera();
      this.applyCameraMode(nextMode);
      camBtnEl.blur();
    });

    this.regroupBtnEl = document.createElement('button');
    this.regroupBtnEl.type = 'button';
    this.regroupBtnEl.className = 'vm-btn vm-btn-regroup';
    this.regroupBtnEl.title = 'Regroup 5m';
    this.regroupBtnEl.setAttribute('aria-label', 'Regroup behind pack');
    this.regroupBtnEl.innerHTML = ICON_REGROUP;
    this.regroupBtnEl.disabled = true;
    this.regroupBtnEl.addEventListener('click', () => {
      if (!this.regroupBtnEl.disabled) {
        this.callbacks.onRegroupPack();
      }
      this.regroupBtnEl.blur();
    });

    this.gyroBtnEl = document.createElement('button');
    this.gyroBtnEl.type = 'button';
    this.gyroBtnEl.className = 'vm-btn vm-btn-gyro';
    this.gyroBtnEl.title = 'Gyro';
    this.gyroBtnEl.setAttribute('aria-label', 'Toggle gyroscope steering');
    this.gyroBtnEl.setAttribute('aria-pressed', 'false');
    this.gyroBtnEl.innerHTML = ICON_GYRO;
    this.gyroBtnEl.addEventListener('click', () => {
      this.toggleGyro();
      this.gyroBtnEl.blur();
    });

    actions.append(this.muteBtnEl, this.pxBtnEl, camBtnEl, this.gyroBtnEl, this.regroupBtnEl);
    topLeft.append(this.riderPillEl, this.netBadgeEl, actions);

    // 3-line pooled broadcast ticker feed
    const feedEl = document.createElement('div');
    feedEl.className = 'vm-feed';
    feedEl.setAttribute('aria-live', 'polite');
    for (let i = 0; i < FEED_SLOTS; i++) {
      const line = document.createElement('div');
      line.className = 'vm-feed-line is-hidden';
      this.feedLines.push(line);
      feedEl.appendChild(line);
    }

    topLeftCol.append(topLeft, feedEl);

    // -----------------------------------------------------------------------
    // 2. TOP-CENTER TOAST, INCOMING LOCK WARNING & SNIPER UI
    // -----------------------------------------------------------------------
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'vm-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');

    const alertStack = document.createElement('div');
    alertStack.className = 'vm-alert-stack';

    this.dangerLockEl = document.createElement('div');
    this.dangerLockEl.className = 'vm-danger-lock is-hidden';

    this.enragedWarnEl = document.createElement('div');
    this.enragedWarnEl.className = 'vm-enraged-warn is-hidden';

    alertStack.append(this.dangerLockEl, this.enragedWarnEl);

    // Sniper Target Selector Strip (5 pooled candidate cards + ESC)
    this.sniperPickerEl = document.createElement('div');
    this.sniperPickerEl.className = 'vm-slab vm-sniper-picker is-hidden';
    for (let i = 0; i < SNIPER_SLOTS; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vm-sniper-card is-hidden';

      const keyBadge = document.createElement('span');
      keyBadge.className = 'vm-sniper-key';
      keyBadge.textContent = String(i + 1);

      const avatar = document.createElement('img');
      avatar.className = 'vm-sniper-avatar';
      avatar.width = 18;
      avatar.height = 18;
      avatar.alt = '';
      avatar.draggable = false;

      const name = document.createElement('span');
      name.className = 'vm-sniper-name';

      const dist = document.createElement('span');
      dist.className = 'vm-sniper-dist';

      btn.append(keyBadge, avatar, name, dist);

      const cardRef: SniperCardRefs = {
        btn,
        avatar,
        name,
        dist,
        targetId: '',
        visible: false,
        lastName: '',
        lastDistM: 999999,
        lastAvatarIdx: -1,
        lastAvatarVer: -1,
      };
      btn.addEventListener('click', () => {
        if (cardRef.targetId) {
          this.callbacks.onSelectSniperTarget(cardRef.targetId);
        }
        btn.blur();
      });

      this.sniperCards.push(cardRef);
      this.sniperPickerEl.appendChild(btn);
    }

    const sniperEscBtn = document.createElement('button');
    sniperEscBtn.type = 'button';
    sniperEscBtn.className = 'vm-sniper-esc';
    sniperEscBtn.textContent = 'ESC';
    sniperEscBtn.addEventListener('click', () => {
      this.callbacks.onCancelSniper();
      sniperEscBtn.blur();
    });
    this.sniperPickerEl.appendChild(sniperEscBtn);

    // Lightweight Pixel Sniper Crosshair Scope Overlay
    this.scopeLayerEl = document.createElement('div');
    this.scopeLayerEl.className = 'vm-scope-layer is-hidden';

    const reticle = document.createElement('div');
    reticle.className = 'vm-scope-reticle';

    const hline = document.createElement('span');
    hline.className = 'vm-scope-hline';
    const vline = document.createElement('span');
    vline.className = 'vm-scope-vline';

    this.scopeBracketsEl = document.createElement('div');
    this.scopeBracketsEl.className = 'vm-scope-brackets';
    const cTL = document.createElement('span');
    cTL.className = 'vm-scope-corner vm-sc-tl';
    const cTR = document.createElement('span');
    cTR.className = 'vm-scope-corner vm-sc-tr';
    const cBL = document.createElement('span');
    cBL.className = 'vm-scope-corner vm-sc-bl';
    const cBR = document.createElement('span');
    cBR.className = 'vm-scope-corner vm-sc-br';
    this.scopeBracketsEl.append(cTL, cTR, cBL, cBR);

    const centerDot = document.createElement('span');
    centerDot.className = 'vm-scope-dot';

    this.scopeResultEl = document.createElement('div');
    this.scopeResultEl.className = 'vm-scope-result is-hidden';

    reticle.append(hline, vline, this.scopeBracketsEl, centerDot, this.scopeResultEl);

    const scopeMeta = document.createElement('div');
    scopeMeta.className = 'vm-slab vm-scope-meta';

    this.scopeTargetEl = document.createElement('span');
    this.scopeTargetEl.className = 'vm-scope-target';

    const scopeBar = document.createElement('div');
    scopeBar.className = 'vm-scope-bar';
    this.scopeFillEl = document.createElement('div');
    this.scopeFillEl.className = 'vm-scope-fill';
    scopeBar.appendChild(this.scopeFillEl);

    scopeMeta.append(this.scopeTargetEl, scopeBar);
    this.scopeLayerEl.append(reticle, scopeMeta);

    // -----------------------------------------------------------------------
    // 3. TOP-RIGHT PACK STANDINGS + VERTICAL HIGHWAY RADAR
    // -----------------------------------------------------------------------
    const topRight = document.createElement('div');
    topRight.className = 'vm-top-right';

    const standingsEl = document.createElement('div');
    standingsEl.className = 'vm-slab vm-standings';

    for (let i = 0; i < STANDINGS_SLOTS; i++) {
      const row = document.createElement('div');
      row.className = 'vm-row is-hidden';

      const rank = document.createElement('span');
      rank.className = 'vm-row-rank';

      const avatar = document.createElement('img');
      avatar.className = 'vm-row-avatar';
      avatar.width = 18;
      avatar.height = 18;
      avatar.alt = '';
      avatar.draggable = false;

      const nameCell = document.createElement('span');
      nameCell.className = 'vm-row-name-cell';

      const name = document.createElement('span');
      name.className = 'vm-row-name';

      const fire = document.createElement('span');
      fire.className = 'vm-row-fire is-hidden';
      fire.textContent = '🔥';

      nameCell.append(name, fire);

      const dist = document.createElement('span');
      dist.className = 'vm-row-dist';

      const ko = document.createElement('span');
      ko.className = 'vm-row-ko is-hidden';
      ko.innerHTML = ICON_SKULL_SM;
      const koVal = document.createElement('span');
      ko.appendChild(koVal);

      row.append(rank, avatar, nameCell, dist, ko);
      standingsEl.appendChild(row);
      this.standingRows.push({
        root: row,
        rank,
        avatar,
        name,
        fire,
        dist,
        ko,
        koVal,
        visible: false,
        lastRank: -1,
        lastOwnerId: '',
        lastName: '',
        lastLap: -1,
        lastDistTenth: -1,
        lastKos: -1,
        lastBorderColor: '',
        lastAvatarIdx: -1,
        lastAvatarVer: -1,
        lastIsLocal: false,
        lastIsBot: false,
        lastEnraged: false,
      });
    }

    // Vertical Highway Radar Strip
    const radarWrap = document.createElement('div');
    radarWrap.className = 'vm-radar-wrap';

    const capTop = document.createElement('span');
    capTop.className = 'vm-radar-cap vm-radar-cap-top';
    capTop.textContent = '+40';

    const capBot = document.createElement('span');
    capBot.className = 'vm-radar-cap vm-radar-cap-bot';
    capBot.textContent = '-40';

    this.radarTrackEl = document.createElement('div');
    this.radarTrackEl.className = 'vm-radar';

    this.radarLocalEl = document.createElement('span');
    this.radarLocalEl.className = 'vm-radar-local';
    this.radarTrackEl.appendChild(this.radarLocalEl);

    for (let i = 0; i < RADAR_POOL; i++) {
      const dot = document.createElement('span');
      dot.className = 'vm-radar-dot is-hidden';
      this.radarTrackEl.appendChild(dot);
      this.radarDots.push({
        el: dot,
        visible: false,
        xPx: -999,
        yPx: -999,
        color: '',
        clamped: false,
      });
    }

    this.radarDeltaEl = document.createElement('span');
    this.radarDeltaEl.className = 'vm-radar-delta is-hidden';

    radarWrap.append(capTop, capBot, this.radarDeltaEl, this.radarTrackEl);
    topRight.append(standingsEl, radarWrap);

    // -----------------------------------------------------------------------
    // 4. BOTTOM-RIGHT WHEELIE CHARGE, SPEED, BARS, ITEM SLOT & WEAPONS
    // -----------------------------------------------------------------------
    const bottomRight = document.createElement('div');
    bottomRight.className = 'vm-bottom-right';

    // Wheelie Charge & Over-Flip Danger Bar
    this.wheelieWrapEl = document.createElement('div');
    this.wheelieWrapEl.className = 'vm-slab vm-wheelie-wrap';

    this.wheelieTagEl = document.createElement('span');
    this.wheelieTagEl.className = 'vm-wheelie-tag';
    this.wheelieTagEl.textContent = 'WHEELIE';

    const wheelieTrack = document.createElement('div');
    wheelieTrack.className = 'vm-wheelie-track';
    this.wheelieFillEl = document.createElement('div');
    this.wheelieFillEl.className = 'vm-wheelie-fill';
    const markSlam = document.createElement('span');
    markSlam.className = 'vm-wheelie-mark vm-wheelie-mark-slam';
    const markFlip = document.createElement('span');
    markFlip.className = 'vm-wheelie-mark vm-wheelie-mark-flip';
    wheelieTrack.append(this.wheelieFillEl, markSlam, markFlip);

    this.wheelieWrapEl.append(this.wheelieTagEl, wheelieTrack);

    const speedHeader = document.createElement('div');
    speedHeader.className = 'vm-speed-header';

    this.koPillEl = document.createElement('div');
    this.koPillEl.className = 'vm-ko-pill is-hidden';
    this.koPillEl.innerHTML = ICON_SKULL_SM;
    this.koValEl = document.createElement('span');
    this.koValEl.textContent = 'KO 0';
    this.koPillEl.appendChild(this.koValEl);

    const speedReadout = document.createElement('div');
    speedReadout.className = 'vm-speed-readout';

    this.speedValEl = document.createElement('span');
    this.speedValEl.className = 'vm-speed-val';
    this.speedValEl.textContent = '0';

    const speedUnit = document.createElement('span');
    speedUnit.className = 'vm-speed-unit';
    speedUnit.textContent = 'KM/H';

    speedReadout.append(this.speedValEl, speedUnit);
    speedHeader.append(this.koPillEl, speedReadout);

    // Segmented Nitro & HP bars
    const gaugesEl = document.createElement('div');
    gaugesEl.className = 'vm-slab vm-gauges';

    const nitroRow = document.createElement('div');
    nitroRow.className = 'vm-gauge-row';
    const nitroTag = document.createElement('span');
    nitroTag.className = 'vm-gauge-tag vm-gauge-tag-nitro';
    nitroTag.textContent = 'NITRO';
    this.nitroTrackEl = document.createElement('div');
    this.nitroTrackEl.className = 'vm-seg-track';
    for (let i = 0; i < BAR_SEGMENTS; i++) {
      const seg = document.createElement('span');
      seg.className = 'vm-seg vm-seg-nitro';
      this.nitroSegs.push(seg);
      this.nitroTrackEl.appendChild(seg);
    }
    nitroRow.append(nitroTag, this.nitroTrackEl);

    const hpRow = document.createElement('div');
    hpRow.className = 'vm-gauge-row';
    this.hpTagEl = document.createElement('span');
    this.hpTagEl.className = 'vm-gauge-tag vm-gauge-tag-hp';
    this.hpTagEl.textContent = 'HP';
    this.hpTrackEl = document.createElement('div');
    this.hpTrackEl.className = 'vm-seg-track';
    for (let i = 0; i < BAR_SEGMENTS; i++) {
      const seg = document.createElement('span');
      seg.className = 'vm-seg vm-seg-hp is-lit';
      this.hpSegs.push(seg);
      this.hpTrackEl.appendChild(seg);
    }
    hpRow.append(this.hpTagEl, this.hpTrackEl);

    gaugesEl.append(nitroRow, hpRow);

    // Pooled 4-slot Multi-Item Powerup Tray (30s TTL when >=2 held)
    const itemTray = document.createElement('div');
    itemTray.className = 'vm-item-tray';

    for (let i = 0; i < MAX_HELD_ITEMS; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = i === 0 ? 'vm-item-slot' : 'vm-item-slot is-hidden';
      btn.disabled = true;
      btn.title = i === 0 ? 'Use Item (R)' : `Use Slot ${i + 1}`;

      let keyEl: HTMLSpanElement | null = null;
      if (i === 0) {
        keyEl = document.createElement('span');
        keyEl.className = 'vm-item-key';
        keyEl.textContent = 'R';
        btn.appendChild(keyEl);
      }

      const iconEl = document.createElement('span');
      iconEl.className = 'vm-item-icon';
      iconEl.textContent = '·';
      btn.appendChild(iconEl);

      let nameEl: HTMLSpanElement | null = null;
      if (i === 0) {
        nameEl = document.createElement('span');
        nameEl.className = 'vm-item-name';
        nameEl.textContent = '--';
        btn.appendChild(nameEl);
      }

      const ttlEl = document.createElement('span');
      ttlEl.className = 'vm-item-ttl is-hidden';
      btn.appendChild(ttlEl);

      const barEl = document.createElement('span');
      barEl.className = 'vm-item-bar is-hidden';
      btn.appendChild(barEl);

      const slotIndex = i;
      btn.addEventListener('click', () => {
        if (!btn.disabled) {
          this.callbacks.onUseItem(slotIndex);
        }
        btn.blur();
      });

      this.itemSlots.push({
        btn,
        keyEl,
        iconEl,
        nameEl,
        ttlEl,
        barEl,
        visible: i === 0,
        lastType: undefined,
        lastShowTtl: false,
        lastSec: -1,
        lastUrgency: -1,
        lastBarPct: -1,
      });
      itemTray.appendChild(btn);
    }

    const weaponsEl = document.createElement('div');
    weaponsEl.className = 'vm-weapons';
    for (let i = 0; i < WEAPONS.length; i++) {
      const spec = WEAPONS[i];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = i === 0 ? 'vm-weapon-chip is-active' : 'vm-weapon-chip';

      const k = document.createElement('span');
      k.className = 'vm-weapon-key';
      k.textContent = String(spec.id + 1);

      const label = document.createElement('span');
      label.textContent = spec.code;

      chip.append(k, label);
      chip.addEventListener('click', () => {
        this.callbacks.onSelectWeapon(spec.id);
        this.applyWeaponHighlight(spec.id, false);
        chip.blur();
      });

      this.weaponChips.push(chip);
      weaponsEl.appendChild(chip);
    }

    bottomRight.append(this.wheelieWrapEl, speedHeader, gaugesEl, itemTray, weaponsEl);

    // -----------------------------------------------------------------------
    // 5. BOTTOM-LEFT KEYCAP HINTS, TOUCH CONTROLS & TAP ATTACK EDGE FLASHES
    // -----------------------------------------------------------------------
    this.keycapsEl = this.buildKeycaps();
    const touchLayer = this.buildTouchControls();

    this.tapFlashLeftEl = document.createElement('div');
    this.tapFlashLeftEl.className = 'vm-tap-flash vm-tap-flash-left';

    this.tapFlashRightEl = document.createElement('div');
    this.tapFlashRightEl.className = 'vm-tap-flash vm-tap-flash-right';

    this.root.append(
      this.tapFlashLeftEl,
      this.tapFlashRightEl,
      topLeftCol,
      this.toastEl,
      alertStack,
      this.sniperPickerEl,
      this.scopeLayerEl,
      topRight,
      bottomRight,
      this.keycapsEl,
      touchLayer
    );

    container.textContent = '';
    container.appendChild(this.root);

    window.addEventListener('resize', this.onWindowResize, { passive: true });
  }

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  setConnectionStatus(status: ConnectionStatus, onlineCount: number): void {
    const safeCount = Math.max(1, Math.floor(onlineCount));
    if (this.connStatus !== status) {
      this.connStatus = status;
      this.netBadgeEl.dataset.status = status;
    }
    if (this.onlineCount !== safeCount) {
      this.onlineCount = safeCount;
      this.netCountEl.textContent = String(safeCount);
    }
    this.syncRegroupState(status === 'online' && safeCount > 1);
  }

  refreshLocalAvatar(): void {
    this.lastLocalAvatarVer = this.localRiderId ? getAvatarVersion(this.localRiderId) : -1;
    this.avatarImgEl.src = this.localRiderId
      ? getRiderAvatarDataUrl(this.localRiderId, this.currentAvatarIdx, 1)
      : getAvatarDataUrl(this.currentAvatarIdx, 1);
    this.syncCustomResetBtn();
  }

  pushBroadcast(text: string, accent: BroadcastAccent = 'gold'): void {
    if (!text) return;

    while (this.feedEntries.length >= FEED_SLOTS) {
      const oldest = this.feedEntries.shift()!;
      window.clearTimeout(oldest.fadeTimer);
      window.clearTimeout(oldest.removeTimer);
    }

    const id = this.nextFeedId++;
    const entry: FeedEntry = {
      id,
      text,
      accent,
      fading: false,
      fadeTimer: window.setTimeout(() => {
        entry.fading = true;
        this.renderFeed();
      }, FEED_DURATION_MS - 300),
      removeTimer: window.setTimeout(() => {
        const idx = this.feedEntries.findIndex((e) => e.id === id);
        if (idx !== -1) {
          this.feedEntries.splice(idx, 1);
          this.renderFeed();
        }
      }, FEED_DURATION_MS),
    };

    this.feedEntries.push(entry);
    this.renderFeed();
  }

  setSniperState(
    state: SniperHudState | null,
    candidates: Array<SniperCandidate>
  ): void {
    const phase = state ? state.phase : '';

    if (phase !== this.lastSniperPhase) {
      this.lastSniperPhase = phase;
      this.sniperPickerEl.classList.toggle('is-hidden', phase !== 'selecting');
      const showScope = phase === 'aiming' || phase === 'fired';
      this.scopeLayerEl.classList.toggle('is-hidden', !showScope);
      if (!showScope) {
        this.lastScopeResult = '';
        this.scopeResultEl.classList.add('is-hidden');
      }
    }

    if (phase === 'selecting') {
      const count = Math.min(SNIPER_SLOTS, candidates.length);
      for (let i = 0; i < SNIPER_SLOTS; i++) {
        const ref = this.sniperCards[i];
        if (i >= count) {
          if (ref.visible) {
            ref.visible = false;
            ref.targetId = '';
            ref.btn.classList.add('is-hidden');
          }
          continue;
        }

        const c = candidates[i];
        const avatarIdx = normalizeAvatarIdx(c.avatarIdx);
        const avatarVer = getAvatarVersion(c.id);
        const distM = Math.round(c.distM);

        if (!ref.visible) {
          ref.visible = true;
          ref.btn.classList.remove('is-hidden');
        }
        if (ref.targetId !== c.id || ref.lastAvatarIdx !== avatarIdx || ref.lastAvatarVer !== avatarVer) {
          ref.targetId = c.id;
          ref.lastAvatarIdx = avatarIdx;
          ref.lastAvatarVer = avatarVer;
          ref.avatar.src = getRiderAvatarDataUrl(c.id, avatarIdx, 1);
        }
        if (ref.lastName !== c.name) {
          ref.lastName = c.name;
          ref.name.textContent = c.name;
        }
        if (ref.lastDistM !== distM) {
          ref.lastDistM = distM;
          ref.dist.textContent = formatDeltaMeters(distM);
        }
      }
      return;
    }

    if (state && (phase === 'aiming' || phase === 'fired')) {
      const p = Math.max(0, Math.min(1, state.progress));
      const pPct = Math.round(p * 100);
      if (pPct !== this.lastScopeProgressPct) {
        this.lastScopeProgressPct = pPct;
        const scale = 1.48 - p * 0.48;
        this.scopeBracketsEl.style.transform = `scale(${scale.toFixed(3)})`;
        this.scopeFillEl.style.transform = `scaleX(${p.toFixed(3)})`;
      }

      const hot = phase === 'fired' || p >= 0.78;
      if (hot !== this.lastScopeHot) {
        this.lastScopeHot = hot;
        this.scopeLayerEl.dataset.hot = hot ? '1' : '0';
      }

      if (state.targetName !== this.lastScopeTarget) {
        this.lastScopeTarget = state.targetName;
        this.scopeTargetEl.textContent = `🎯 ${state.targetName}`;
      }

      const res = phase === 'fired' && state.result ? state.result : '';
      if (res !== this.lastScopeResult) {
        this.lastScopeResult = res;
        if (res) {
          this.scopeResultEl.classList.remove('is-hidden');
          this.scopeResultEl.dataset.res = res;
          this.scopeResultEl.textContent =
            res === 'HIT' ? 'HIT!' : res === 'DODGED' ? 'DODGED!' : 'MISS';
        } else {
          this.scopeResultEl.classList.add('is-hidden');
        }
      }
    }
  }

  update(
    local: RiderRenderState,
    allRiders: RiderRenderState[],
    pressedKeys: Set<string>,
    dt: number
  ): void {
    // 1. Keycaps: zero-allocation bitmask check (0 DOM ops when steady)
    this.updateKeycaps(pressedKeys, local.speed, dt);

    // 2. Fast cadence (~15Hz): speed, nitro, HP, weapons, item, wheelie, incoming lock, avatar sync
    this.fastAccum += dt;
    if (this.fastAccum >= FAST_UPDATE_INTERVAL) {
      this.fastAccum = 0;

      if (local.id && local.id !== this.localRiderId) {
        this.localRiderId = local.id;
        this.lastLocalAvatarVer = -1;
      }

      if (!this.editingName && local.name && local.name !== this.currentName) {
        this.currentName = local.name.slice(0, 14);
        this.nameTextEl.textContent = this.currentName;
      }
      if (local.colorIdx !== this.currentColorIdx) {
        this.currentColorIdx = local.colorIdx;
        this.avatarBtnEl.style.borderColor = getRiderColor(local.colorIdx, false);
      }

      const localAvatarIdx = normalizeAvatarIdx(local.avatarIdx);
      const localAvatarVer = local.id ? getAvatarVersion(local.id) : 0;
      if (localAvatarIdx !== this.currentAvatarIdx || localAvatarVer !== this.lastLocalAvatarVer) {
        this.lastLocalAvatarVer = localAvatarVer;
        this.selectAvatar(localAvatarIdx, false);
        this.syncCustomResetBtn();
      }

      this.updateSpeedAndBars(local);
      this.updateItemTray(local.heldItems, local.heldItem);
      this.updateWheelieBar(local.wheelieCharge);
      this.updateIncomingLock(local.incomingLockName);
    }

    // 3. Slow cadence (~9Hz): standings, vertical highway radar & peer presence
    this.slowAccum += dt;
    if (this.slowAccum >= SLOW_UPDATE_INTERVAL) {
      this.slowAccum = 0;

      let hasRemotePeer = this.connStatus === 'online' && this.onlineCount > 1;
      if (!hasRemotePeer) {
        for (let i = 0; i < allRiders.length; i++) {
          const r = allRiders[i];
          if (!r.isLocal && !r.isBot) {
            hasRemotePeer = true;
            break;
          }
        }
      }
      this.syncRegroupState(hasRemotePeer);

      this.updateStandings(local, allRiders);
      this.updateRadar(local, allRiders);
    }
  }

  showToast(text: string, accent: ToastAccent = 'gold'): void {
    if (this.toastRafId !== null) {
      window.cancelAnimationFrame(this.toastRafId);
      this.toastRafId = null;
    }
    if (this.toastHideTimer !== null) {
      window.clearTimeout(this.toastHideTimer);
      this.toastHideTimer = null;
    }
    if (this.toastClearTimer !== null) {
      window.clearTimeout(this.toastClearTimer);
      this.toastClearTimer = null;
    }

    this.toastEl.textContent = text;
    this.toastEl.dataset.accent = accent;
    this.toastEl.classList.remove('is-visible', 'is-hiding');

    this.toastRafId = window.requestAnimationFrame(() => {
      this.toastRafId = null;
      this.toastEl.classList.add('is-visible');
    });

    this.toastHideTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this.toastEl.classList.add('is-hiding');
      this.toastHideTimer = null;

      this.toastClearTimer = window.setTimeout(() => {
        this.toastEl.classList.remove('is-hiding');
        this.toastClearTimer = null;
      }, 240);
    }, TOAST_DURATION_MS);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.muteBtnEl.classList.toggle('is-muted', muted);
    this.muteBtnEl.innerHTML = muted ? ICON_SOUND_OFF : ICON_SOUND_ON;
    this.muteBtnEl.setAttribute('aria-pressed', String(muted));
  }

  setPixelScale(scale: number): void {
    this.applyPixelScale(scale);
  }

  setCameraMode(mode: number): void {
    this.applyCameraMode(mode);
  }

  isEditingName(): boolean {
    return this.editingName;
  }

  setEnragedWarning(hunterName: string | null): void {
    const next = hunterName ? hunterName.trim() : null;
    if (next === this.lastEnragedHunter) return;
    this.lastEnragedHunter = next;

    if (!next) {
      this.enragedWarnEl.classList.add('is-hidden');
      return;
    }
    this.enragedWarnEl.textContent = `💢 ${next} 狂暴追杀中!`;
    this.enragedWarnEl.classList.remove('is-hidden');
  }

  flashTapAttack(side: 'left' | 'right'): void {
    const isLeft = side === 'left';
    const el = isLeft ? this.tapFlashLeftEl : this.tapFlashRightEl;
    const prevTimer = isLeft ? this.tapFlashLeftTimer : this.tapFlashRightTimer;
    if (prevTimer !== null) {
      window.clearTimeout(prevTimer);
    }

    el.classList.add('is-flashing');
    const timer = window.setTimeout(() => {
      el.classList.remove('is-flashing');
      if (isLeft) this.tapFlashLeftTimer = null;
      else this.tapFlashRightTimer = null;
    }, TAP_FLASH_MS);

    if (isLeft) this.tapFlashLeftTimer = timer;
    else this.tapFlashRightTimer = timer;
  }

  // -------------------------------------------------------------------------
  // PRIVATE BUILDERS & EVENTS
  // -------------------------------------------------------------------------

  private toggleGyro(): void {
    if (this.gyroEnabled) {
      this.disableGyro(true);
      return;
    }

    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      this.showToast('NO GYRO SENSOR', 'red');
      return;
    }

    const doe = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    if (typeof doe.requestPermission === 'function') {
      doe
        .requestPermission()
        .then((res) => {
          if (res === 'granted') {
            this.enableGyroListener();
          } else {
            this.showToast('NO GYRO SENSOR', 'red');
          }
        })
        .catch(() => {
          this.showToast('NO GYRO SENSOR', 'red');
        });
      return;
    }

    this.enableGyroListener();
  }

  private enableGyroListener(): void {
    if (this.gyroEnabled) return;
    this.gyroEnabled = true;
    this.gyroHasData = false;
    this.gyroBaseline = null;
    this.gyroSmoothed = 0;

    this.gyroBtnEl.classList.add('is-active');
    this.gyroBtnEl.setAttribute('aria-pressed', 'true');
    this.root.classList.add('vm-gyro-on');

    window.addEventListener('deviceorientation', this.onDeviceOrientation, { passive: true });
    window.addEventListener('orientationchange', this.onOrientationChange, { passive: true });

    if (this.gyroSensorTimer !== null) {
      window.clearTimeout(this.gyroSensorTimer);
    }
    this.gyroSensorTimer = window.setTimeout(() => {
      this.gyroSensorTimer = null;
      if (this.gyroEnabled && !this.gyroHasData) {
        this.disableGyro(false);
        this.showToast('NO GYRO SENSOR', 'red');
      }
    }, GYRO_SENSOR_TIMEOUT_MS);
  }

  private disableGyro(showOffToast: boolean): void {
    if (this.gyroSensorTimer !== null) {
      window.clearTimeout(this.gyroSensorTimer);
      this.gyroSensorTimer = null;
    }
    if (this.gyroEnabled) {
      window.removeEventListener('deviceorientation', this.onDeviceOrientation);
      window.removeEventListener('orientationchange', this.onOrientationChange);
    }

    this.gyroEnabled = false;
    this.gyroHasData = false;
    this.gyroBaseline = null;
    this.gyroSmoothed = 0;

    this.gyroBtnEl.classList.remove('is-active');
    this.gyroBtnEl.setAttribute('aria-pressed', 'false');
    this.root.classList.remove('vm-gyro-on');
    this.callbacks.onGyroSteer(null);

    if (showOffToast) {
      this.showToast('GYRO OFF', 'gold');
    }
  }

  private ensureAvatarPopoverBuilt(): void {
    if (this.avatarPopoverBuilt) return;
    this.avatarPopoverBuilt = true;

    const grid = document.createElement('div');
    grid.className = 'vm-avatar-grid';

    for (let i = 0; i < AVATAR_COUNT; i++) {
      const meta = PIXEL_AVATARS[i];
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = i === this.currentAvatarIdx ? 'vm-avatar-opt is-active' : 'vm-avatar-opt';
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(i === this.currentAvatarIdx));
      opt.setAttribute('aria-label', meta ? meta.name : `Avatar ${i + 1}`);
      if (meta) opt.title = meta.name;

      const img = document.createElement('img');
      img.className = 'hud-avatar-img vm-avatar-opt-img';
      img.width = 38;
      img.height = 38;
      img.alt = '';
      img.draggable = false;
      img.src = getAvatarDataUrl(i, 1);

      opt.appendChild(img);
      opt.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.selectAvatar(i, true);
        this.setAvatarPopoverOpen(false);
        opt.blur();
      });

      this.avatarOptEls.push(opt);
      grid.appendChild(opt);
    }

    // Compact upload & reset action row
    const uploadRow = document.createElement('div');
    uploadRow.className = 'vm-avatar-upload-row';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'vm-hidden-file';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) {
        this.callbacks.onCustomAvatarUpload(file);
        this.setAvatarPopoverOpen(false);
      }
    });

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'vm-avatar-upload-btn';
    uploadBtn.textContent = '📷 上传头像';
    uploadBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      fileInput.click();
      uploadBtn.blur();
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'vm-avatar-reset-btn is-hidden';
    resetBtn.textContent = '↺';
    resetBtn.title = 'Reset avatar';
    resetBtn.setAttribute('aria-label', 'Reset custom avatar');
    resetBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      this.callbacks.onClearCustomAvatar();
      this.refreshLocalAvatar();
      this.setAvatarPopoverOpen(false);
      resetBtn.blur();
    });
    this.avatarResetBtnEl = resetBtn;

    uploadRow.append(uploadBtn, resetBtn, fileInput);
    this.avatarPopoverEl.append(grid, uploadRow);
    this.syncCustomResetBtn();
  }

  private syncCustomResetBtn(): void {
    if (!this.avatarResetBtnEl) return;
    const hasCustom = Boolean(this.localRiderId && getCustomAvatarDataUrl(this.localRiderId));
    this.avatarResetBtnEl.classList.toggle('is-hidden', !hasCustom);
  }

  private selectAvatar(avatarIdx: number, notify: boolean): void {
    const nextIdx = normalizeAvatarIdx(avatarIdx);
    this.currentAvatarIdx = nextIdx;

    if (this.avatarPopoverBuilt) {
      for (let i = 0; i < this.avatarOptEls.length; i++) {
        const active = i === nextIdx;
        this.avatarOptEls[i].classList.toggle('is-active', active);
        this.avatarOptEls[i].setAttribute('aria-selected', String(active));
      }
    }

    if (notify) {
      this.callbacks.onAvatarChange(nextIdx);
    }

    this.avatarImgEl.src = this.localRiderId
      ? getRiderAvatarDataUrl(this.localRiderId, nextIdx, 1)
      : getAvatarDataUrl(nextIdx, 1);
    this.syncCustomResetBtn();
  }

  private setAvatarPopoverOpen(open: boolean): void {
    if (this.avatarPopoverOpen === open) return;
    if (open) {
      this.ensureAvatarPopoverBuilt();
      this.syncCustomResetBtn();
    }
    this.avatarPopoverOpen = open;
    this.avatarPopoverEl.classList.toggle('is-open', open);
    this.avatarBtnEl.classList.toggle('is-open', open);
    this.avatarBtnEl.setAttribute('aria-expanded', String(open));

    if (open) {
      document.addEventListener('pointerdown', this.onDocPointerDown);
      document.addEventListener('keydown', this.onDocKeyDown, true);
    } else {
      document.removeEventListener('pointerdown', this.onDocPointerDown);
      document.removeEventListener('keydown', this.onDocKeyDown, true);
    }
  }

  private renderFeed(): void {
    const count = this.feedEntries.length;
    for (let i = 0; i < FEED_SLOTS; i++) {
      const el = this.feedLines[i];
      if (i >= count) {
        el.className = 'vm-feed-line is-hidden';
        continue;
      }
      const entry = this.feedEntries[i];
      el.dataset.accent = entry.accent;
      el.textContent = entry.text;
      el.className = entry.fading ? 'vm-feed-line is-fading' : 'vm-feed-line';
    }
  }

  private bindNameplateEvents(): void {
    this.nameplateEl.addEventListener('click', () => {
      if (this.avatarPopoverOpen) {
        this.setAvatarPopoverOpen(false);
      }
      if (!this.editingName) {
        this.startEditingName();
      }
    });

    this.nameInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finishEditingName(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEditingName(false);
      }
    });

    this.nameInputEl.addEventListener('keyup', (e: KeyboardEvent) => {
      e.stopPropagation();
    });

    this.nameInputEl.addEventListener('blur', () => {
      if (this.editingName) {
        this.finishEditingName(true);
      }
    });
  }

  private startEditingName(): void {
    this.editingName = true;
    this.nameplateEl.classList.add('is-editing');
    this.nameInputEl.value = this.currentName;
    this.callbacks.onEditingName(true);
    this.nameInputEl.focus();
    this.nameInputEl.select();
  }

  private finishEditingName(commit: boolean): void {
    if (!this.editingName) return;
    this.editingName = false;
    this.nameplateEl.classList.remove('is-editing');

    if (commit) {
      const trimmed = this.nameInputEl.value.trim().slice(0, 14);
      const nextName = trimmed.length > 0 ? trimmed : this.currentName;
      this.currentName = nextName;
      this.nameTextEl.textContent = nextName;
      this.callbacks.onNameChange(nextName);
    } else {
      this.nameInputEl.value = this.currentName;
    }

    this.callbacks.onEditingName(false);
    this.nameInputEl.blur();
  }

  private applyPixelScale(scale: number): void {
    this.pixelScale = scale === 2 ? 2 : 1;
    this.pxBtnEl.textContent = this.pixelScale === 2 ? 'PX' : 'HD';
    this.pxBtnEl.classList.toggle('is-retro', this.pixelScale === 2);
  }

  private applyCameraMode(mode: number): void {
    this.cameraMode = ((mode % 3) + 3) % 3;
    for (let i = 0; i < this.camPips.length; i++) {
      this.camPips[i].classList.toggle('is-on', i === this.cameraMode);
    }
  }

  private syncRegroupState(enabled: boolean): void {
    if (this.hasOnlinePeers === enabled) return;
    this.hasOnlinePeers = enabled;
    this.regroupBtnEl.disabled = !enabled;
  }

  private buildKeycaps(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'vm-keycaps';

    const makeKey = (label: string, extraClass = '', accent = ''): HTMLSpanElement => {
      const el = document.createElement('span');
      el.className = extraClass ? `vm-key ${extraClass}` : 'vm-key';
      if (accent) el.dataset.accent = accent;
      el.textContent = label;
      this.keyEls.push(el);
      return el;
    };

    const wasd = document.createElement('div');
    wasd.className = 'vm-key-wasd';
    wasd.append(
      makeKey('W', 'vm-key-w'),
      makeKey('A', 'vm-key-a'),
      makeKey('S', 'vm-key-s'),
      makeKey('D', 'vm-key-d')
    );

    const combat = document.createElement('div');
    combat.className = 'vm-key-group';
    combat.append(makeKey('J', '', 'red'), makeKey('K', '', 'red'));

    const mods = document.createElement('div');
    mods.className = 'vm-key-group';
    mods.append(makeKey('SPC', 'vm-key-wide'), makeKey('SHF', 'vm-key-wide', 'cyan'));

    wrap.append(wasd, combat, mods);
    return wrap;
  }

  private buildTouchControls(): HTMLDivElement {
    const layer = document.createElement('div');
    layer.className = 'vm-touch-layer';

    const makePad = (
      label: string,
      field: keyof TouchInputPatch,
      extraClass: string
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `vm-touch-btn ${extraClass}`;
      btn.textContent = label;

      const activePointers = new Set<number>();

      const emit = (down: boolean): void => {
        btn.classList.toggle('is-active', down);
        this.callbacks.onTouchInput?.({ [field]: down });
      };

      btn.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic pointer events
        }
        const wasEmpty = activePointers.size === 0;
        activePointers.add(e.pointerId);
        if (wasEmpty) emit(true);
      });

      const release = (e: PointerEvent): void => {
        if (!activePointers.delete(e.pointerId)) return;
        if (activePointers.size === 0) emit(false);
      };

      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);

      return btn;
    };

    const leftZone = document.createElement('div');
    leftZone.className = 'vm-touch-left';
    const steerRow = document.createElement('div');
    steerRow.className = 'vm-touch-steer';
    steerRow.append(
      makePad('◀', 'left', 'vm-touch-btn-steer'),
      makePad('▶', 'right', 'vm-touch-btn-steer')
    );
    leftZone.appendChild(steerRow);

    const rightZone = document.createElement('div');
    rightZone.className = 'vm-touch-right';

    const itemTouchBtn = document.createElement('button');
    itemTouchBtn.type = 'button';
    itemTouchBtn.className = 'vm-touch-btn vm-touch-btn-item';
    itemTouchBtn.setAttribute('aria-label', 'Use item');

    const itemTouchLabel = document.createElement('span');
    itemTouchLabel.textContent = 'R';
    const itemTouchCount = document.createElement('span');
    itemTouchCount.className = 'vm-touch-item-count is-hidden';
    itemTouchBtn.append(itemTouchLabel, itemTouchCount);

    itemTouchBtn.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.itemSlots[0].btn.disabled) {
        this.callbacks.onUseItem(0);
      }
    });
    this.touchItemBtnEl = itemTouchBtn;
    this.touchItemLabelEl = itemTouchLabel;
    this.touchItemCountEl = itemTouchCount;

    rightZone.append(
      itemTouchBtn,
      makePad('⬆', 'wheelie', 'vm-touch-btn-hop'),
      makePad('⚡', 'nitro', 'vm-touch-btn-nitro')
    );

    layer.append(leftZone, rightZone);
    return layer;
  }

  // -------------------------------------------------------------------------
  // PRIVATE THROTTLED & ZERO-ALLOCATION DIRTY-CHECKED UPDATERS
  // -------------------------------------------------------------------------

  private updateKeycaps(pressed: Set<string>, speed: number, dt: number): void {
    let mask = 0;
    if (hasAnyKey(pressed, KEY_W)) mask |= 1;
    if (hasAnyKey(pressed, KEY_A)) mask |= 2;
    if (hasAnyKey(pressed, KEY_S)) mask |= 4;
    if (hasAnyKey(pressed, KEY_D)) mask |= 8;
    if (hasAnyKey(pressed, KEY_J)) mask |= 16;
    if (hasAnyKey(pressed, KEY_K)) mask |= 32;
    if (hasAnyKey(pressed, KEY_SPC)) mask |= 64;
    if (hasAnyKey(pressed, KEY_SHF)) mask |= 128;

    if (mask !== this.lastKeyMask) {
      for (let i = 0; i < this.keyEls.length; i++) {
        const bit = 1 << i;
        const wasDown = (this.lastKeyMask & bit) !== 0;
        const isDown = (mask & bit) !== 0;
        if (this.lastKeyMask === -1 || wasDown !== isDown) {
          this.keyEls[i].classList.toggle('is-down', isDown);
        }
      }
      this.lastKeyMask = mask;
    }

    if (!this.keycapsFaded && (speed > 4 || mask !== 0)) {
      this.ridingElapsed += dt;
      if (this.ridingElapsed >= KEYCAP_FADE_SEC) {
        this.keycapsFaded = true;
        this.keycapsEl.classList.add('is-faded');
      }
    }
  }

  private updateItemTray(
    heldItems: readonly HeldItemSlot[] | undefined,
    fallbackItem: ItemType | null
  ): void {
    const count = heldItems ? Math.min(MAX_HELD_ITEMS, heldItems.length) : fallbackItem ? 1 : 0;
    const showTtl = count >= 2;

    for (let i = 0; i < MAX_HELD_ITEMS; i++) {
      const ref = this.itemSlots[i];
      const shouldShow = i === 0 || i < count;

      if (!shouldShow) {
        if (ref.visible) {
          ref.visible = false;
          ref.btn.classList.add('is-hidden');
          ref.btn.disabled = true;
          ref.lastType = undefined;
          ref.lastShowTtl = false;
          ref.lastSec = -1;
          ref.lastUrgency = -1;
          ref.lastBarPct = -1;
        }
        continue;
      }

      if (!ref.visible) {
        ref.visible = true;
        ref.btn.classList.remove('is-hidden');
      }

      const slot = heldItems && i < count ? heldItems[i] : null;
      const itemType: ItemType | null = slot ? slot.type : i === 0 ? fallbackItem : null;

      if (itemType !== ref.lastType) {
        ref.lastType = itemType;
        if (!itemType) {
          ref.btn.disabled = true;
          ref.btn.classList.remove('is-ready');
          ref.btn.style.borderColor = '';
          ref.btn.title = 'Use Item (R)';
          if (ref.keyEl) ref.keyEl.style.backgroundColor = '';
          ref.iconEl.textContent = '·';
          if (ref.nameEl) ref.nameEl.textContent = '--';
        } else {
          const spec = ITEM_BY_ID[itemType];
          ref.btn.disabled = false;
          ref.btn.classList.add('is-ready');
          ref.btn.style.borderColor = spec.color;
          ref.btn.title = spec.zhName;
          if (ref.keyEl) ref.keyEl.style.backgroundColor = spec.color;
          ref.iconEl.textContent = spec.icon;
          if (ref.nameEl) ref.nameEl.textContent = spec.zhName;
        }
      }

      const activeTtl = showTtl && itemType !== null && slot !== null;
      if (activeTtl !== ref.lastShowTtl) {
        ref.lastShowTtl = activeTtl;
        ref.ttlEl.classList.toggle('is-hidden', !activeTtl);
        ref.barEl.classList.toggle('is-hidden', !activeTtl);
      }

      if (activeTtl && slot) {
        const clampedTtl = Math.max(0, Math.min(MULTI_ITEM_TTL, slot.ttl));
        const sec = Math.max(1, Math.ceil(clampedTtl));
        if (sec !== ref.lastSec) {
          ref.lastSec = sec;
          ref.ttlEl.textContent = `${sec}s`;
        }

        const urgency = clampedTtl < 5 ? 2 : clampedTtl < 10 ? 1 : 0;
        if (urgency !== ref.lastUrgency) {
          ref.lastUrgency = urgency;
          const uStr = urgency === 2 ? 'crit' : urgency === 1 ? 'warn' : 'ok';
          ref.ttlEl.dataset.urgency = uStr;
          ref.barEl.dataset.urgency = uStr;
        }

        const pct = Math.round((clampedTtl / MULTI_ITEM_TTL) * 100);
        if (pct !== ref.lastBarPct) {
          ref.lastBarPct = pct;
          ref.barEl.style.transform = `scaleX(${(pct / 100).toFixed(2)})`;
        }
      }
    }

    // Mobile touch R button: sync slot 0 icon & ×2/×3/×4 count badge
    if (this.touchItemBtnEl && this.touchItemLabelEl && this.touchItemCountEl) {
      const firstType: ItemType | null =
        heldItems && count > 0 ? heldItems[0].type : fallbackItem;
      if (firstType !== this.lastTouchItemType) {
        this.lastTouchItemType = firstType;
        if (!firstType) {
          this.touchItemBtnEl.classList.remove('is-ready');
          this.touchItemBtnEl.style.borderColor = '';
          this.touchItemLabelEl.textContent = 'R';
        } else {
          const spec = ITEM_BY_ID[firstType];
          this.touchItemBtnEl.classList.add('is-ready');
          this.touchItemBtnEl.style.borderColor = spec.color;
          this.touchItemLabelEl.textContent = spec.icon;
        }
      }
      if (count !== this.lastTouchItemCount) {
        this.lastTouchItemCount = count;
        if (count > 1) {
          this.touchItemCountEl.classList.remove('is-hidden');
          this.touchItemCountEl.textContent = `×${count}`;
        } else {
          this.touchItemCountEl.classList.add('is-hidden');
        }
      }
    }
  }

  private updateWheelieBar(charge: number): void {
    const c = Math.max(0, Math.min(1, charge || 0));
    const tier = c <= 0.05 ? 0 : c >= 0.8 ? 3 : c >= 0.32 ? 2 : 1;

    if (tier !== this.lastWheelieTier) {
      this.lastWheelieTier = tier;
      if (tier === 0) {
        this.wheelieWrapEl.classList.remove('is-active');
        return;
      }
      this.wheelieWrapEl.classList.add('is-active');
      if (tier === 3) {
        this.wheelieWrapEl.dataset.tier = 'danger';
        this.wheelieTagEl.textContent = '! FLIP';
      } else if (tier === 2) {
        this.wheelieWrapEl.dataset.tier = 'slam';
        this.wheelieTagEl.textContent = '⚡ SLAM';
      } else {
        this.wheelieWrapEl.dataset.tier = 'ok';
        this.wheelieTagEl.textContent = 'WHEELIE';
      }
    }

    if (tier === 0) return;

    const pct = Math.round(c * 100);
    if (pct !== this.lastWheeliePct) {
      this.lastWheeliePct = pct;
      this.wheelieFillEl.style.transform = `scaleX(${(pct / 100).toFixed(2)})`;
    }
  }

  private updateIncomingLock(lockName: string | null): void {
    const next = lockName || null;
    if (next === this.lastIncomingLockName) return;
    this.lastIncomingLockName = next;

    if (!next) {
      this.dangerLockEl.classList.add('is-hidden');
      return;
    }
    this.dangerLockEl.textContent = `🎯 ${next} 瞄准中! SPACE躲避`;
    this.dangerLockEl.classList.remove('is-hidden');
  }

  private updateSpeedAndBars(local: RiderRenderState): void {
    const kmh = Math.max(0, Math.round(local.speed * 3.6));
    if (kmh !== this.lastSpeedKmh) {
      this.lastSpeedKmh = kmh;
      this.speedValEl.textContent = String(kmh);
    }

    const speedTier = local.crashed
      ? 'crash'
      : local.nitroActive
        ? 'nitro'
        : kmh >= 180
          ? 'fast'
          : 'normal';
    if (speedTier !== this.lastSpeedTier) {
      this.lastSpeedTier = speedTier;
      this.speedValEl.dataset.tier = speedTier;
    }

    const nitroClamped = Math.max(0, Math.min(100, local.nitro));
    const nitroLit =
      nitroClamped <= 0 ? 0 : Math.min(BAR_SEGMENTS, Math.ceil((nitroClamped / 100) * BAR_SEGMENTS));
    if (nitroLit !== this.lastNitroLit) {
      this.lastNitroLit = nitroLit;
      for (let i = 0; i < BAR_SEGMENTS; i++) {
        this.nitroSegs[i].classList.toggle('is-lit', i < nitroLit);
      }
    }
    if (local.nitroActive !== this.lastNitroActive) {
      this.lastNitroActive = local.nitroActive;
      this.nitroTrackEl.classList.toggle('is-nitro-active', local.nitroActive);
    }

    const hpClamped = Math.max(0, Math.min(100, local.hp));
    const hpLit =
      hpClamped <= 0 ? 0 : Math.min(BAR_SEGMENTS, Math.ceil((hpClamped / 100) * BAR_SEGMENTS));
    if (hpLit !== this.lastHpLit) {
      this.lastHpLit = hpLit;
      for (let i = 0; i < BAR_SEGMENTS; i++) {
        this.hpSegs[i].classList.toggle('is-lit', i < hpLit);
      }
    }
    const hpTier = hpClamped <= 25 ? 'low' : hpClamped <= 55 ? 'mid' : 'ok';
    if (hpTier !== this.lastHpTier) {
      this.lastHpTier = hpTier;
      this.hpTrackEl.dataset.tier = hpTier;
      this.hpTagEl.dataset.tier = hpTier;
    }

    const swinging = local.attackSide !== 0;
    if (local.weapon !== this.lastWeapon || swinging !== this.lastSwinging) {
      this.applyWeaponHighlight(local.weapon, swinging);
    }

    const kos = Math.max(0, Math.floor(local.kos));
    if (kos !== this.lastKos) {
      const increased = this.lastKos >= 0 && kos > this.lastKos;
      this.lastKos = kos;
      if (kos > 0) {
        this.koPillEl.classList.remove('is-hidden');
        this.koValEl.textContent = `KO ${kos}`;
        if (increased) {
          this.koPillEl.classList.remove('is-pop');
          window.requestAnimationFrame(() => {
            this.koPillEl.classList.add('is-pop');
          });
        }
      } else {
        this.koPillEl.classList.add('is-hidden');
      }
    }
  }

  private applyWeaponHighlight(weapon: WeaponType, swinging: boolean): void {
    this.lastWeapon = weapon;
    this.lastSwinging = swinging;
    for (let i = 0; i < this.weaponChips.length; i++) {
      const active = i === weapon;
      this.weaponChips[i].classList.toggle('is-active', active);
      this.weaponChips[i].classList.toggle('is-swinging', active && swinging);
    }
  }

  private updateStandings(local: RiderRenderState, allRiders: RiderRenderState[]): void {
    const buf = this.sortedBuf;
    buf.length = 0;
    let hasLocal = false;
    for (let i = 0; i < allRiders.length; i++) {
      const r = allRiders[i];
      buf.push(r);
      if (r.isLocal || r.id === local.id) hasLocal = true;
    }
    if (!hasLocal) buf.push(local);

    buf.sort(compareByDistanceDesc);

    const total = buf.length;
    let localRankIdx = -1;
    for (let i = 0; i < total; i++) {
      if (buf[i].isLocal || buf[i].id === local.id) {
        localRankIdx = i;
        break;
      }
    }

    const rowCount = Math.min(STANDINGS_SLOTS, total);
    for (let slot = 0; slot < STANDINGS_SLOTS; slot++) {
      const ref = this.standingRows[slot];
      if (slot >= rowCount) {
        if (ref.visible) {
          ref.visible = false;
          ref.root.classList.add('is-hidden');
        }
        continue;
      }

      const riderIdx =
        slot === STANDINGS_SLOTS - 1 && localRankIdx >= STANDINGS_SLOTS ? localRankIdx : slot;
      const rider = buf[riderIdx];
      const rankNum = riderIdx + 1;
      const isLocal = rider.isLocal || rider.id === local.id;
      const isBot = rider.isBot && !isLocal;
      const enraged = Boolean(rider.enraged);
      const role = rider.deliveryRole;
      const lap = getLapNumber(rider.s);
      const distTenth = Math.round(Math.max(0, rider.s) / 100);
      const borderColor =
        role === 'meituan'
          ? '#ffc300'
          : role === 'eleme'
            ? '#0091ff'
            : isLocal
              ? '#ffd166'
              : getRiderColor(rider.colorIdx, rider.isBot);
      const avatarIdx = normalizeAvatarIdx(rider.avatarIdx);
      const avatarVer = getAvatarVersion(rider.id);
      const kos = Math.max(0, Math.floor(rider.kos));

      if (!ref.visible) {
        ref.visible = true;
        ref.root.classList.remove('is-hidden');
      }
      if (ref.lastIsLocal !== isLocal) {
        ref.lastIsLocal = isLocal;
        ref.root.classList.toggle('is-local', isLocal);
      }
      if (ref.lastIsBot !== isBot) {
        ref.lastIsBot = isBot;
        ref.root.classList.toggle('is-bot', isBot);
      }
      if (ref.lastEnraged !== enraged) {
        ref.lastEnraged = enraged;
        ref.root.classList.toggle('is-enraged', enraged);
        ref.fire.classList.toggle('is-hidden', !enraged);
      }
      if (ref.lastRank !== rankNum) {
        ref.lastRank = rankNum;
        ref.root.dataset.rank = String(rankNum);
        ref.rank.textContent = `#${rankNum}`;
      }
      if (
        ref.lastOwnerId !== rider.id ||
        ref.lastAvatarIdx !== avatarIdx ||
        ref.lastAvatarVer !== avatarVer
      ) {
        ref.lastOwnerId = rider.id;
        ref.lastAvatarIdx = avatarIdx;
        ref.lastAvatarVer = avatarVer;
        ref.avatar.src = getRiderAvatarDataUrl(rider.id, avatarIdx, 1);
      }
      if (ref.lastBorderColor !== borderColor) {
        ref.lastBorderColor = borderColor;
        ref.avatar.style.borderColor = borderColor;
      }
      if (ref.lastName !== rider.name) {
        ref.lastName = rider.name;
        ref.name.textContent = rider.name;
      }
      if (ref.lastLap !== lap || ref.lastDistTenth !== distTenth) {
        ref.lastLap = lap;
        ref.lastDistTenth = distTenth;
        ref.dist.textContent = `L${lap} · ${(distTenth / 10).toFixed(1)}km`;
      }
      if (ref.lastKos !== kos) {
        const wasZero = ref.lastKos <= 0;
        ref.lastKos = kos;
        if (kos > 0) {
          if (wasZero) ref.ko.classList.remove('is-hidden');
          ref.koVal.textContent = String(kos);
        } else if (!wasZero) {
          ref.ko.classList.add('is-hidden');
        }
      }
    }
  }

  private updateRadar(local: RiderRenderState, allRiders: RiderRenderState[]): void {
    if (this.radarDimsDirty) {
      this.radarDimsDirty = false;
      const cw = this.radarTrackEl.clientWidth;
      const ch = this.radarTrackEl.clientHeight;
      if (cw > 0 && ch > 0) {
        this.radarInnerW = cw;
        this.radarInnerH = ch;
        this.radarOuterH = ch + 4;
      }
    }

    const w = this.radarInnerW;
    const h = this.radarInnerH;

    const localNormX = Math.max(-1, Math.min(1, local.x / 9));
    const localX = Math.round((0.5 + localNormX * 0.28) * w - 5);
    const localY = Math.round(h * 0.5 - 5);
    if (localX !== this.lastLocalRadarX || localY !== this.lastLocalRadarY) {
      this.lastLocalRadarX = localX;
      this.lastLocalRadarY = localY;
      this.radarLocalEl.style.transform = `translate3d(${localX}px, ${localY}px, 0)`;
    }

    let dotIdx = 0;
    let closestRival: RiderRenderState | null = null;
    let closestAbsDs = Infinity;
    let closestDs = 0;

    for (let i = 0; i < allRiders.length; i++) {
      const r = allRiders[i];
      if (r.isLocal || r.id === local.id) continue;

      const ds = signedTrackDelta(r.s, local.s);
      const absDs = Math.abs(ds);

      if (absDs < closestAbsDs) {
        closestAbsDs = absDs;
        closestRival = r;
        closestDs = ds;
      }

      if (dotIdx >= RADAR_POOL || absDs > 140) continue;

      const clamped = absDs > RADAR_RANGE_M;
      const dsClamped = Math.max(-RADAR_RANGE_M, Math.min(RADAR_RANGE_M, ds));
      const normY = 0.5 - (dsClamped / RADAR_RANGE_M) * 0.44;
      const normX = Math.max(-1, Math.min(1, r.x / 9));
      const halfW = clamped ? 3 : 4;
      const halfH = clamped ? 2 : 4;
      const xPx = Math.round((0.5 + normX * 0.28) * w - halfW);
      const yPx = Math.round(normY * h - halfH);
      const color = r.enraged
        ? '#ff3b1f'
        : r.deliveryRole === 'meituan'
          ? '#ffc300'
          : r.deliveryRole === 'eleme'
            ? '#0091ff'
            : getRiderColor(r.colorIdx, r.isBot);

      const d = this.radarDots[dotIdx++];
      if (!d.visible) {
        d.visible = true;
        d.el.classList.remove('is-hidden');
      }
      if (d.clamped !== clamped) {
        d.clamped = clamped;
        d.el.classList.toggle('is-clamped', clamped);
      }
      if (d.xPx !== xPx || d.yPx !== yPx) {
        d.xPx = xPx;
        d.yPx = yPx;
        d.el.style.transform = `translate3d(${xPx}px, ${yPx}px, 0)`;
      }
      if (d.color !== color) {
        d.color = color;
        d.el.style.backgroundColor = color;
      }
    }

    for (let i = dotIdx; i < RADAR_POOL; i++) {
      const d = this.radarDots[i];
      if (d.visible) {
        d.visible = false;
        d.el.classList.add('is-hidden');
      }
    }

    if (!closestRival) {
      if (this.lastDeltaState !== 0) {
        this.lastDeltaState = 0;
        this.radarDeltaEl.classList.add('is-hidden');
      }
      return;
    }

    const rounded = Math.round(closestDs);
    const deltaState = rounded === 0 ? 2 : rounded < 0 ? 3 : 1;
    if (this.lastDeltaState !== deltaState) {
      this.lastDeltaState = deltaState;
      this.radarDeltaEl.className =
        deltaState === 2
          ? 'vm-radar-delta is-even'
          : deltaState === 3
            ? 'vm-radar-delta is-behind'
            : 'vm-radar-delta';
    }
    if (this.lastDeltaMeters !== rounded) {
      this.lastDeltaMeters = rounded;
      this.radarDeltaEl.textContent = formatDeltaMeters(rounded);
    }

    const dsClamped = Math.max(-RADAR_RANGE_M, Math.min(RADAR_RANGE_M, closestDs));
    const deltaY = Math.round((0.5 - (dsClamped / RADAR_RANGE_M) * 0.42) * this.radarOuterH - 9);
    if (this.lastDeltaY !== deltaY) {
      this.lastDeltaY = deltaY;
      this.radarDeltaEl.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    }
  }
}
