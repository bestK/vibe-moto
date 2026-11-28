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
import {
  deliveryName,
  itemName,
  onLangChange,
  t,
  toggleLang,
  weaponName,
  weatherName,
} from '../i18n';
import {
  ITEM_ICON_MAP,
  PixelIconId,
  WEAPON_ICON_MAP,
  WEATHER_ICON_MAP,
  getPixelIconSvg,
} from './PixelIcons';
import type { WeatherId } from '../game/WeatherSystem';
import type { LobbyRoomSummary } from '../net/MqttSync';

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
  attackAuto: boolean;
  analogSteer: number | null;
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
  onCycleWeather?(): WeatherId;
  onSelectWeapon(w: 0 | 1 | 2): void;
  onRegroupPack(): void;
  onGyroSteer(steer: number | null): void;
  onRoomModalToggle?(open: boolean): void;
  onJoinRoom?(room: string, password: string): Promise<void>;
  onCopyRoomLink?(): void;
  onRenameRoom?(title: string): void;
  onRefreshLobbyRooms?(): void;
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
const GYRO_DEADZONE_DEG = 4.0;
const GYRO_MAX_TILT_DEG = 25.0;
const GYRO_SENSOR_TIMEOUT_MS = 900;
const TAP_FLASH_MS = 160;
const RECENT_ROOMS_KEY = 'vibemoto_recent_rooms';
const MAX_RECENT_ROOMS = 4;

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

interface FeedLineRefs {
  root: HTMLDivElement;
  iconEl: HTMLSpanElement;
  textEl: HTMLSpanElement;
}

interface FeedEntry {
  id: number;
  text: string;
  accent: BroadcastAccent;
  icon?: PixelIconId;
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
  private avatarUploadLabelEl: HTMLSpanElement | null = null;
  private avatarResetBtnEl: HTMLButtonElement | null = null;
  private readonly nameplateEl: HTMLDivElement;
  private readonly nameTextEl: HTMLSpanElement;
  private readonly nameInputEl: HTMLInputElement;
  private readonly netBadgeEl: HTMLDivElement;
  private readonly netCountEl: HTMLSpanElement;
  private readonly muteBtnEl: HTMLButtonElement;
  private readonly pxBtnEl: HTMLButtonElement;
  private readonly camPips: HTMLSpanElement[] = [];
  private readonly weatherBtnEl: HTMLButtonElement;
  private readonly weatherIconEl: HTMLSpanElement;
  private readonly weatherLabelEl: HTMLSpanElement;
  private readonly weatherFxEl: HTMLDivElement;
  private readonly homeBtnEl: HTMLButtonElement;
  private readonly langBtnEl: HTMLButtonElement;
  private readonly gyroBtnEl: HTMLButtonElement;
  private readonly regroupBtnEl: HTMLButtonElement;

  // Home / Room Lobby Modal
  private readonly homeOverlayEl: HTMLDivElement;
  private readonly homeTitleTextEl: HTMLSpanElement;
  private readonly homeRoomIconEl: HTMLSpanElement;
  private readonly homeRoomTextEl: HTMLSpanElement;
  private readonly homeHostBadgeEl: HTMLSpanElement;
  private readonly homeRoomPillEl: HTMLDivElement;
  private readonly homeRenameBtnEl: HTMLButtonElement;
  private readonly homeCopyBtnEl: HTMLButtonElement;
  private readonly homeRenameRowEl: HTMLDivElement;
  private readonly homeRenameInputEl: HTMLInputElement;
  private readonly homeRenameSaveBtnEl: HTMLButtonElement;
  private readonly homeRenameCancelBtnEl: HTMLButtonElement;
  private readonly homeLobbyWrapEl: HTMLDivElement;
  private readonly homeLobbyLabelEl: HTMLSpanElement;
  private readonly homeLobbyCountEl: HTMLSpanElement;
  private readonly homeLobbyRefreshBtnEl: HTMLButtonElement;
  private readonly homeLobbyListEl: HTMLDivElement;
  private readonly homeRoomInputEl: HTMLInputElement;
  private readonly homePassInputEl: HTMLInputElement;
  private readonly homeDiceBtnEl: HTMLButtonElement;
  private readonly homeErrorEl: HTMLDivElement;
  private readonly homeErrorTextEl: HTMLSpanElement;
  private readonly homeJoinBtnEl: HTMLButtonElement;
  private readonly homeJoinTextEl: HTMLSpanElement;
  private readonly homePublicBtnEl: HTMLButtonElement;
  private readonly homePublicTextEl: HTMLSpanElement;
  private readonly homeResumeBtnEl: HTMLButtonElement;
  private readonly homeRecentWrapEl: HTMLDivElement;
  private readonly homeRecentLabelEl: HTMLSpanElement;
  private readonly homeRecentChipsEl: HTMLDivElement;
  private readonly tapFlashLeftEl: HTMLDivElement;
  private readonly tapFlashRightEl: HTMLDivElement;
  private rightJoyItemEl: HTMLSpanElement | null = null;
  private rightJoyItemIconEl: HTMLSpanElement | null = null;
  private rightJoyItemCountEl: HTMLSpanElement | null = null;
  private readonly feedLines: FeedLineRefs[] = [];
  private readonly feedEntries: FeedEntry[] = [];
  private nextFeedId = 1;

  // Top-center toast, alert warnings & sniper UI
  private readonly toastEl: HTMLDivElement;
  private readonly toastIconEl: HTMLSpanElement;
  private readonly toastTextEl: HTMLSpanElement;
  private toastRafId: number | null = null;
  private toastHideTimer: number | null = null;
  private toastClearTimer: number | null = null;
  private readonly dangerLockEl: HTMLDivElement;
  private readonly dangerLockTextEl: HTMLSpanElement;
  private readonly enragedWarnEl: HTMLDivElement;
  private readonly enragedWarnTextEl: HTMLSpanElement;
  private readonly sniperPickerEl: HTMLDivElement;
  private readonly sniperEscBtnEl: HTMLButtonElement;
  private readonly sniperCards: SniperCardRefs[] = [];
  private readonly scopeLayerEl: HTMLDivElement;
  private readonly scopeBracketsEl: HTMLDivElement;
  private readonly scopeTargetTextEl: HTMLSpanElement;
  private readonly scopeFillEl: HTMLDivElement;
  private readonly scopeResultEl: HTMLDivElement;

  // Top-right standings & vertical radar
  private readonly standingRows: StandingRowRefs[] = [];
  private readonly radarTrackEl: HTMLDivElement;
  private readonly radarLocalEl: HTMLSpanElement;
  private readonly radarDots: RadarDotRefs[] = [];
  private readonly radarDeltaEl: HTMLSpanElement;

  // Bottom-right wheelie charge, telemetry, item tray & weapons
  private readonly wheelieWrapEl: HTMLDivElement;
  private readonly wheelieIconEl: HTMLSpanElement;
  private readonly wheelieTextEl: HTMLSpanElement;
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
  private readonly weaponLabelEls: HTMLSpanElement[] = [];

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
  private currentWeather: WeatherId = 'clear';
  private lastWeatherFlash = false;
  private connStatus: ConnectionStatus = 'connecting';
  private onlineCount = 1;
  private hasOnlinePeers = false;
  private homeModalOpen = false;
  private homeBusy = false;
  private homeAuthLocked = false;
  private homeRenameOpen = false;
  private currentRoom = 'global';
  private currentRoomTitle = 'global';
  private currentRoomLocked = false;
  private currentRoomIsHost = false;
  private lobbyRooms: LobbyRoomSummary[] = [];
  private recentRooms: string[] = [];

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
    if (this.homeModalOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeHomeModal();
      return;
    }
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
    this.radarDimsDirty = true;
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
      this.showToast(t('gyroOn'), 'cyan', 'gyro');
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
    pencilWrap.innerHTML = getPixelIconSvg('edit', 'vm-icon-sm');

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

    this.homeBtnEl = document.createElement('button');
    this.homeBtnEl.type = 'button';
    this.homeBtnEl.className = 'vm-btn vm-btn-home';
    this.homeBtnEl.title = t('homeTitle');
    this.homeBtnEl.setAttribute('aria-label', 'Room lobby');
    this.homeBtnEl.innerHTML = getPixelIconSvg('home');
    this.homeBtnEl.addEventListener('click', () => {
      if (this.homeModalOpen) this.closeHomeModal();
      else this.openHomeModal();
      this.homeBtnEl.blur();
    });

    this.muteBtnEl = document.createElement('button');
    this.muteBtnEl.type = 'button';
    this.muteBtnEl.className = 'vm-btn vm-btn-mute';
    this.muteBtnEl.title = 'Audio';
    this.muteBtnEl.setAttribute('aria-label', 'Toggle audio');
    this.muteBtnEl.innerHTML = getPixelIconSvg('soundOn');
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

    this.weatherBtnEl = document.createElement('button');
    this.weatherBtnEl.type = 'button';
    this.weatherBtnEl.className = 'vm-btn vm-btn-weather';
    this.weatherBtnEl.dataset.weather = this.currentWeather;
    this.weatherBtnEl.setAttribute('aria-label', 'Cycle weather');
    this.weatherIconEl = document.createElement('span');
    this.weatherIconEl.className = 'vm-btn-icon';
    this.weatherIconEl.innerHTML = getPixelIconSvg(WEATHER_ICON_MAP[this.currentWeather]);
    this.weatherLabelEl = document.createElement('span');
    this.weatherLabelEl.className = 'vm-weather-label';
    this.weatherLabelEl.textContent = weatherName(this.currentWeather);
    this.weatherBtnEl.append(this.weatherIconEl, this.weatherLabelEl);
    this.weatherBtnEl.addEventListener('click', () => {
      const next = this.callbacks.onCycleWeather?.();
      if (next) {
        this.setWeather(next);
      }
      this.weatherBtnEl.blur();
    });

    this.langBtnEl = document.createElement('button');
    this.langBtnEl.type = 'button';
    this.langBtnEl.className = 'vm-btn vm-btn-lang';
    this.langBtnEl.title = 'Language';
    this.langBtnEl.setAttribute('aria-label', 'Switch language');
    this.langBtnEl.textContent = t('langBtn');
    this.langBtnEl.addEventListener('click', () => {
      toggleLang();
      this.langBtnEl.blur();
    });

    this.gyroBtnEl = document.createElement('button');
    this.gyroBtnEl.type = 'button';
    this.gyroBtnEl.className = 'vm-btn vm-btn-gyro';
    this.gyroBtnEl.title = 'Gyro';
    this.gyroBtnEl.setAttribute('aria-label', 'Toggle gyroscope steering');
    this.gyroBtnEl.setAttribute('aria-pressed', 'false');
    this.gyroBtnEl.innerHTML = getPixelIconSvg('gyro');
    this.gyroBtnEl.addEventListener('click', () => {
      this.toggleGyro();
      this.gyroBtnEl.blur();
    });

    this.regroupBtnEl = document.createElement('button');
    this.regroupBtnEl.type = 'button';
    this.regroupBtnEl.className = 'vm-btn vm-btn-regroup';
    this.regroupBtnEl.title = 'Regroup 5m';
    this.regroupBtnEl.setAttribute('aria-label', 'Regroup behind pack');
    this.regroupBtnEl.innerHTML = getPixelIconSvg('regroup');
    this.regroupBtnEl.disabled = true;
    this.regroupBtnEl.addEventListener('click', () => {
      if (!this.regroupBtnEl.disabled) {
        this.callbacks.onRegroupPack();
      }
      this.regroupBtnEl.blur();
    });

    actions.append(
      this.homeBtnEl,
      this.muteBtnEl,
      this.pxBtnEl,
      camBtnEl,
      this.weatherBtnEl,
      this.langBtnEl,
      this.gyroBtnEl,
      this.regroupBtnEl
    );
    topLeft.append(this.riderPillEl, this.netBadgeEl, actions);

    // 3-line pooled broadcast ticker feed (dedicated icon span + safe textContent span)
    const feedEl = document.createElement('div');
    feedEl.className = 'vm-feed';
    feedEl.setAttribute('aria-live', 'polite');
    for (let i = 0; i < FEED_SLOTS; i++) {
      const line = document.createElement('div');
      line.className = 'vm-feed-line is-hidden';

      const iconEl = document.createElement('span');
      iconEl.className = 'vm-feed-icon is-hidden';

      const textEl = document.createElement('span');
      textEl.className = 'vm-feed-text';

      line.append(iconEl, textEl);
      this.feedLines.push({ root: line, iconEl, textEl });
      feedEl.appendChild(line);
    }

    topLeftCol.append(topLeft, feedEl);

    // -----------------------------------------------------------------------
    // 2. TOP-CENTER TOAST, INCOMING LOCK / ENRAGED WARNINGS & SNIPER UI
    // -----------------------------------------------------------------------
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'vm-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');

    this.toastIconEl = document.createElement('span');
    this.toastIconEl.className = 'vm-toast-icon is-hidden';

    this.toastTextEl = document.createElement('span');
    this.toastTextEl.className = 'vm-toast-text';

    this.toastEl.append(this.toastIconEl, this.toastTextEl);

    const alertStack = document.createElement('div');
    alertStack.className = 'vm-alert-stack';

    this.dangerLockEl = document.createElement('div');
    this.dangerLockEl.className = 'vm-danger-lock is-hidden';
    const dangerIcon = document.createElement('span');
    dangerIcon.className = 'vm-alert-icon';
    dangerIcon.innerHTML = getPixelIconSvg('item_sniper', 'vm-icon-sm');
    this.dangerLockTextEl = document.createElement('span');
    this.dangerLockEl.append(dangerIcon, this.dangerLockTextEl);

    this.enragedWarnEl = document.createElement('div');
    this.enragedWarnEl.className = 'vm-enraged-warn is-hidden';
    const enragedIcon = document.createElement('span');
    enragedIcon.className = 'vm-alert-icon';
    enragedIcon.innerHTML = getPixelIconSvg('flame', 'vm-icon-sm');
    this.enragedWarnTextEl = document.createElement('span');
    this.enragedWarnEl.append(enragedIcon, this.enragedWarnTextEl);

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

    this.sniperEscBtnEl = document.createElement('button');
    this.sniperEscBtnEl.type = 'button';
    this.sniperEscBtnEl.className = 'vm-sniper-esc';
    this.sniperEscBtnEl.textContent = t('escCancel');
    this.sniperEscBtnEl.addEventListener('click', () => {
      this.callbacks.onCancelSniper();
      this.sniperEscBtnEl.blur();
    });
    this.sniperPickerEl.appendChild(this.sniperEscBtnEl);

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

    const scopeTargetWrap = document.createElement('span');
    scopeTargetWrap.className = 'vm-scope-target';
    const scopeIcon = document.createElement('span');
    scopeIcon.className = 'vm-scope-icon';
    scopeIcon.innerHTML = getPixelIconSvg('item_sniper', 'vm-icon-sm');
    this.scopeTargetTextEl = document.createElement('span');
    scopeTargetWrap.append(scopeIcon, this.scopeTargetTextEl);

    const scopeBar = document.createElement('div');
    scopeBar.className = 'vm-scope-bar';
    this.scopeFillEl = document.createElement('div');
    this.scopeFillEl.className = 'vm-scope-fill';
    scopeBar.appendChild(this.scopeFillEl);

    scopeMeta.append(scopeTargetWrap, scopeBar);
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
      fire.innerHTML = getPixelIconSvg('flame', 'vm-icon-xs');

      nameCell.append(name, fire);

      const dist = document.createElement('span');
      dist.className = 'vm-row-dist';

      const ko = document.createElement('span');
      ko.className = 'vm-row-ko is-hidden';
      ko.innerHTML = getPixelIconSvg('skull', 'vm-icon-xs');
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
    // 4. BOTTOM-RIGHT WHEELIE CHARGE, SPEED, BARS, ITEM TRAY & WEAPONS
    // -----------------------------------------------------------------------
    const bottomRight = document.createElement('div');
    bottomRight.className = 'vm-bottom-right';

    const telemetryCluster = document.createElement('div');
    telemetryCluster.className = 'vm-telemetry-cluster';

    // Wheelie Charge & Over-Flip Danger Bar
    this.wheelieWrapEl = document.createElement('div');
    this.wheelieWrapEl.className = 'vm-slab vm-wheelie-wrap';

    const wheelieTag = document.createElement('span');
    wheelieTag.className = 'vm-wheelie-tag';
    this.wheelieIconEl = document.createElement('span');
    this.wheelieIconEl.className = 'vm-wheelie-icon is-hidden';
    this.wheelieTextEl = document.createElement('span');
    this.wheelieTextEl.textContent = t('wheelie');
    wheelieTag.append(this.wheelieIconEl, this.wheelieTextEl);

    const wheelieTrack = document.createElement('div');
    wheelieTrack.className = 'vm-wheelie-track';
    this.wheelieFillEl = document.createElement('div');
    this.wheelieFillEl.className = 'vm-wheelie-fill';
    const markSlam = document.createElement('span');
    markSlam.className = 'vm-wheelie-mark vm-wheelie-mark-slam';
    const markFlip = document.createElement('span');
    markFlip.className = 'vm-wheelie-mark vm-wheelie-mark-flip';
    wheelieTrack.append(this.wheelieFillEl, markSlam, markFlip);

    this.wheelieWrapEl.append(wheelieTag, wheelieTrack);

    const telemetryBar = document.createElement('div');
    telemetryBar.className = 'vm-telemetry-bar';

    const speedHeader = document.createElement('div');
    speedHeader.className = 'vm-speed-header';

    this.koPillEl = document.createElement('div');
    this.koPillEl.className = 'vm-ko-pill is-hidden';
    this.koPillEl.innerHTML = getPixelIconSvg('skull', 'vm-icon-xs');
    this.koValEl = document.createElement('span');
    this.koValEl.textContent = `${t('koLabel')} 0`;
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
    nitroRow.className = 'vm-gauge-row vm-gauge-row-nitro';
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
    hpRow.className = 'vm-gauge-row vm-gauge-row-hp';
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
    telemetryBar.append(speedHeader, gaugesEl);
    telemetryCluster.append(this.wheelieWrapEl, telemetryBar);

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
      iconEl.textContent = '-';
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

      const icon = document.createElement('span');
      icon.className = 'vm-weapon-icon';
      icon.innerHTML = getPixelIconSvg(WEAPON_ICON_MAP[spec.id], 'vm-icon-sm');

      const label = document.createElement('span');
      label.className = 'vm-weapon-label';
      label.textContent = weaponName(spec.id);
      this.weaponLabelEls.push(label);

      chip.append(k, icon, label);
      chip.addEventListener('click', () => {
        this.callbacks.onSelectWeapon(spec.id);
        this.applyWeaponHighlight(spec.id, false);
        chip.blur();
      });

      this.weaponChips.push(chip);
      weaponsEl.appendChild(chip);
    }

    const bottomDock = document.createElement('div');
    bottomDock.className = 'vm-bottom-dock';
    bottomDock.append(itemTray, weaponsEl);

    bottomRight.append(telemetryCluster, bottomDock);

    // -----------------------------------------------------------------------
    // 5. BOTTOM-LEFT KEYCAP HINTS, DUAL VIRTUAL JOYSTICKS & TAP EDGE FLASHES
    // -----------------------------------------------------------------------
    this.keycapsEl = this.buildKeycaps();
    const touchLayer = this.buildTouchControls();

    this.weatherFxEl = document.createElement('div');
    this.weatherFxEl.className = 'vm-weather-fx';
    this.weatherFxEl.dataset.weather = this.currentWeather;

    this.tapFlashLeftEl = document.createElement('div');
    this.tapFlashLeftEl.className = 'vm-tap-flash vm-tap-flash-left';

    this.tapFlashRightEl = document.createElement('div');
    this.tapFlashRightEl.className = 'vm-tap-flash vm-tap-flash-right';

    // -----------------------------------------------------------------------
    // 6. HOME / ROOM LOBBY MODAL (Optional Password-Protected Rooms)
    // -----------------------------------------------------------------------
    this.recentRooms = this.loadRecentRooms();

    this.homeOverlayEl = document.createElement('div');
    this.homeOverlayEl.className = 'vm-home-overlay';
    this.homeOverlayEl.setAttribute('role', 'dialog');
    this.homeOverlayEl.setAttribute('aria-modal', 'true');
    this.homeOverlayEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.target === this.homeOverlayEl && !this.homeBusy) {
        this.closeHomeModal();
      }
    });

    const homeCard = document.createElement('div');
    homeCard.className = 'vm-slab vm-home-card';
    homeCard.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());

    const homeHead = document.createElement('div');
    homeHead.className = 'vm-home-head';

    const homeTitleWrap = document.createElement('div');
    homeTitleWrap.className = 'vm-home-title';
    const homeTitleIcon = document.createElement('span');
    homeTitleIcon.className = 'vm-btn-icon';
    homeTitleIcon.innerHTML = getPixelIconSvg('home');
    this.homeTitleTextEl = document.createElement('span');
    this.homeTitleTextEl.textContent = t('homeTitle');
    homeTitleWrap.append(homeTitleIcon, this.homeTitleTextEl);

    const homeStatusWrap = document.createElement('div');
    homeStatusWrap.className = 'vm-home-status';

    this.homeRoomPillEl = document.createElement('div');
    this.homeRoomPillEl.className = 'vm-home-room-pill';
    this.homeRoomIconEl = document.createElement('span');
    this.homeRoomIconEl.className = 'vm-btn-icon';
    this.homeRoomIconEl.innerHTML = getPixelIconSvg('unlock', 'vm-icon-sm');
    this.homeRoomTextEl = document.createElement('span');
    this.homeRoomTextEl.className = 'vm-home-room-name';
    this.homeRoomTextEl.textContent = t('publicHall');
    this.homeHostBadgeEl = document.createElement('span');
    this.homeHostBadgeEl.className = 'vm-home-host-badge is-hidden';
    this.homeHostBadgeEl.textContent = t('hostBadge');
    this.homeRoomPillEl.append(this.homeRoomIconEl, this.homeRoomTextEl, this.homeHostBadgeEl);

    this.homeRenameBtnEl = document.createElement('button');
    this.homeRenameBtnEl.type = 'button';
    this.homeRenameBtnEl.className = 'vm-home-icon-btn is-hidden';
    this.homeRenameBtnEl.title = t('renameRoom');
    this.homeRenameBtnEl.setAttribute('aria-label', 'Rename room');
    this.homeRenameBtnEl.innerHTML = getPixelIconSvg('edit', 'vm-icon-sm');
    this.homeRenameBtnEl.addEventListener('click', () => {
      if (this.homeBusy || !this.currentRoomIsHost) return;
      this.toggleRenameRow(!this.homeRenameOpen);
      this.homeRenameBtnEl.blur();
    });

    this.homeCopyBtnEl = document.createElement('button');
    this.homeCopyBtnEl.type = 'button';
    this.homeCopyBtnEl.className = 'vm-home-icon-btn';
    this.homeCopyBtnEl.title = t('copyLink');
    this.homeCopyBtnEl.setAttribute('aria-label', 'Copy room invite link');
    this.homeCopyBtnEl.innerHTML = getPixelIconSvg('copy', 'vm-icon-sm');
    this.homeCopyBtnEl.addEventListener('click', () => {
      this.callbacks.onCopyRoomLink?.();
      this.homeCopyBtnEl.blur();
    });

    homeStatusWrap.append(this.homeRoomPillEl, this.homeRenameBtnEl, this.homeCopyBtnEl);
    homeHead.append(homeTitleWrap, homeStatusWrap);

    this.homeRenameRowEl = document.createElement('div');
    this.homeRenameRowEl.className = 'vm-home-rename-row is-hidden';
    this.homeRenameInputEl = document.createElement('input');
    this.homeRenameInputEl.type = 'text';
    this.homeRenameInputEl.maxLength = 20;
    this.homeRenameInputEl.spellcheck = false;
    this.homeRenameInputEl.autocomplete = 'off';
    this.homeRenameInputEl.className = 'vm-home-input vm-home-rename-input';
    this.homeRenameInputEl.placeholder = t('roomTitlePlaceholder');
    this.homeRenameInputEl.setAttribute('aria-label', 'Room title');
    this.homeRenameInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitRenameRoom();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.toggleRenameRow(false);
      }
    });
    this.homeRenameInputEl.addEventListener('keyup', (e: KeyboardEvent) => e.stopPropagation());

    this.homeRenameSaveBtnEl = document.createElement('button');
    this.homeRenameSaveBtnEl.type = 'button';
    this.homeRenameSaveBtnEl.className = 'vm-home-btn vm-home-btn-primary vm-home-rename-btn';
    this.homeRenameSaveBtnEl.textContent = t('save');
    this.homeRenameSaveBtnEl.addEventListener('click', () => this.submitRenameRoom());

    this.homeRenameCancelBtnEl = document.createElement('button');
    this.homeRenameCancelBtnEl.type = 'button';
    this.homeRenameCancelBtnEl.className = 'vm-home-btn vm-home-btn-resume vm-home-rename-btn';
    this.homeRenameCancelBtnEl.textContent = t('cancel');
    this.homeRenameCancelBtnEl.addEventListener('click', () => this.toggleRenameRow(false));

    this.homeRenameRowEl.append(
      this.homeRenameInputEl,
      this.homeRenameSaveBtnEl,
      this.homeRenameCancelBtnEl
    );

    this.homeLobbyWrapEl = document.createElement('div');
    this.homeLobbyWrapEl.className = 'vm-home-lobby';
    const lobbyHead = document.createElement('div');
    lobbyHead.className = 'vm-home-lobby-head';
    const lobbyTitleGroup = document.createElement('div');
    lobbyTitleGroup.className = 'vm-home-lobby-title';
    this.homeLobbyLabelEl = document.createElement('span');
    this.homeLobbyLabelEl.textContent = t('onlineRooms');
    this.homeLobbyCountEl = document.createElement('span');
    this.homeLobbyCountEl.className = 'vm-home-lobby-count';
    this.homeLobbyCountEl.textContent = '0';
    lobbyTitleGroup.append(this.homeLobbyLabelEl, this.homeLobbyCountEl);

    this.homeLobbyRefreshBtnEl = document.createElement('button');
    this.homeLobbyRefreshBtnEl.type = 'button';
    this.homeLobbyRefreshBtnEl.className = 'vm-home-icon-btn vm-home-refresh-btn';
    this.homeLobbyRefreshBtnEl.title = t('refreshRooms');
    this.homeLobbyRefreshBtnEl.setAttribute('aria-label', 'Refresh room list');
    this.homeLobbyRefreshBtnEl.innerHTML = getPixelIconSvg('reset', 'vm-icon-sm');
    this.homeLobbyRefreshBtnEl.addEventListener('click', () => {
      if (this.homeBusy) return;
      this.callbacks.onRefreshLobbyRooms?.();
      this.homeLobbyRefreshBtnEl.blur();
    });
    lobbyHead.append(lobbyTitleGroup, this.homeLobbyRefreshBtnEl);

    this.homeLobbyListEl = document.createElement('div');
    this.homeLobbyListEl.className = 'vm-home-lobby-list';
    this.homeLobbyWrapEl.append(lobbyHead, this.homeLobbyListEl);

    const homeForm = document.createElement('form');
    homeForm.className = 'vm-home-form';
    homeForm.addEventListener('submit', (e: SubmitEvent) => {
      e.preventDefault();
      this.submitHomeForm();
    });

    const homeInputs = document.createElement('div');
    homeInputs.className = 'vm-home-inputs';

    const roomFieldWrap = document.createElement('div');
    roomFieldWrap.className = 'vm-home-room-row';

    this.homeRoomInputEl = document.createElement('input');
    this.homeRoomInputEl.type = 'text';
    this.homeRoomInputEl.maxLength = 20;
    this.homeRoomInputEl.spellcheck = false;
    this.homeRoomInputEl.autocomplete = 'off';
    this.homeRoomInputEl.className = 'vm-home-input';
    this.homeRoomInputEl.placeholder = t('roomCodePlaceholder');
    this.homeRoomInputEl.setAttribute('aria-label', 'Room code');

    this.homeDiceBtnEl = document.createElement('button');
    this.homeDiceBtnEl.type = 'button';
    this.homeDiceBtnEl.className = 'vm-home-icon-btn vm-home-dice-btn';
    this.homeDiceBtnEl.title = 'Random';
    this.homeDiceBtnEl.setAttribute('aria-label', 'Generate random room code');
    this.homeDiceBtnEl.innerHTML = getPixelIconSvg('dice');
    this.homeDiceBtnEl.addEventListener('click', () => {
      const code = `moto-${Math.floor(100 + Math.random() * 900)}`;
      this.homeRoomInputEl.value = code;
      this.setHomeError(null);
      this.homeRoomInputEl.focus();
      this.homeRoomInputEl.select();
    });

    roomFieldWrap.append(this.homeRoomInputEl, this.homeDiceBtnEl);

    this.homePassInputEl = document.createElement('input');
    this.homePassInputEl.type = 'password';
    this.homePassInputEl.maxLength = 24;
    this.homePassInputEl.autocomplete = 'off';
    this.homePassInputEl.className = 'vm-home-input';
    this.homePassInputEl.placeholder = t('roomPassPlaceholder');
    this.homePassInputEl.setAttribute('aria-label', 'Room password');

    const stopInputKeys = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === 'Escape' && !this.homeBusy) {
        e.preventDefault();
        this.closeHomeModal();
      }
    };
    this.homeRoomInputEl.addEventListener('keydown', stopInputKeys);
    this.homeRoomInputEl.addEventListener('keyup', (e: KeyboardEvent) => e.stopPropagation());
    this.homePassInputEl.addEventListener('keydown', stopInputKeys);
    this.homePassInputEl.addEventListener('keyup', (e: KeyboardEvent) => e.stopPropagation());

    homeInputs.append(roomFieldWrap, this.homePassInputEl);

    this.homeErrorEl = document.createElement('div');
    this.homeErrorEl.className = 'vm-home-error is-hidden';
    const errIcon = document.createElement('span');
    errIcon.className = 'vm-btn-icon';
    errIcon.innerHTML = getPixelIconSvg('warning', 'vm-icon-sm');
    this.homeErrorTextEl = document.createElement('span');
    this.homeErrorEl.append(errIcon, this.homeErrorTextEl);

    const homeActions = document.createElement('div');
    homeActions.className = 'vm-home-actions';

    this.homeJoinBtnEl = document.createElement('button');
    this.homeJoinBtnEl.type = 'submit';
    this.homeJoinBtnEl.className = 'vm-home-btn vm-home-btn-primary';
    const joinIcon = document.createElement('span');
    joinIcon.className = 'vm-btn-icon';
    joinIcon.innerHTML = getPixelIconSvg('door', 'vm-icon-sm');
    this.homeJoinTextEl = document.createElement('span');
    this.homeJoinTextEl.textContent = t('createOrJoin');
    this.homeJoinBtnEl.append(joinIcon, this.homeJoinTextEl);

    this.homePublicBtnEl = document.createElement('button');
    this.homePublicBtnEl.type = 'button';
    this.homePublicBtnEl.className = 'vm-home-btn vm-home-btn-public is-hidden';
    const pubIcon = document.createElement('span');
    pubIcon.className = 'vm-btn-icon';
    pubIcon.innerHTML = getPixelIconSvg('globe', 'vm-icon-sm');
    this.homePublicTextEl = document.createElement('span');
    this.homePublicTextEl.textContent = t('enterPublic');
    this.homePublicBtnEl.append(pubIcon, this.homePublicTextEl);
    this.homePublicBtnEl.addEventListener('click', () => {
      if (this.homeBusy) return;
      void this.callbacks.onJoinRoom?.('global', '');
    });

    this.homeResumeBtnEl = document.createElement('button');
    this.homeResumeBtnEl.type = 'button';
    this.homeResumeBtnEl.className = 'vm-home-btn vm-home-btn-resume';
    this.homeResumeBtnEl.textContent = t('resumeRide');
    this.homeResumeBtnEl.addEventListener('click', () => {
      if (!this.homeBusy) this.closeHomeModal();
    });

    homeActions.append(this.homeJoinBtnEl, this.homePublicBtnEl, this.homeResumeBtnEl);

    this.homeRecentWrapEl = document.createElement('div');
    this.homeRecentWrapEl.className = 'vm-home-recent is-hidden';
    this.homeRecentLabelEl = document.createElement('span');
    this.homeRecentLabelEl.className = 'vm-home-recent-label';
    this.homeRecentLabelEl.textContent = t('recentRooms');
    this.homeRecentChipsEl = document.createElement('div');
    this.homeRecentChipsEl.className = 'vm-home-recent-chips';
    this.homeRecentWrapEl.append(this.homeRecentLabelEl, this.homeRecentChipsEl);
    this.renderRecentRooms();

    homeForm.append(homeInputs, this.homeErrorEl, homeActions, this.homeRecentWrapEl);
    homeCard.append(homeHead, this.homeRenameRowEl, this.homeLobbyWrapEl, homeForm);
    this.homeOverlayEl.appendChild(homeCard);

    this.root.append(
      this.weatherFxEl,
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
      touchLayer,
      this.homeOverlayEl
    );

    container.textContent = '';
    container.appendChild(this.root);

    window.addEventListener('resize', this.onWindowResize, { passive: true });
    window.addEventListener('orientationchange', this.onOrientationChange, { passive: true });
    onLangChange(() => this.applyLocale());
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

  pushBroadcast(text: string, accent: BroadcastAccent = 'gold', icon?: PixelIconId): void {
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
      icon,
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
        this.scopeTargetTextEl.textContent = state.targetName;
      }

      const res = phase === 'fired' && state.result ? state.result : '';
      if (res !== this.lastScopeResult) {
        this.lastScopeResult = res;
        if (res) {
          this.scopeResultEl.classList.remove('is-hidden');
          this.scopeResultEl.dataset.res = res;
          this.scopeResultEl.textContent =
            res === 'HIT'
              ? t('sniperHit')
              : res === 'DODGED'
                ? t('sniperDodged')
                : t('sniperMiss');
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

  showToast(text: string, accent: ToastAccent = 'gold', icon?: PixelIconId): void {
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

    if (icon) {
      this.toastIconEl.innerHTML = getPixelIconSvg(icon);
      this.toastIconEl.classList.remove('is-hidden');
    } else {
      this.toastIconEl.textContent = '';
      this.toastIconEl.classList.add('is-hidden');
    }

    this.toastTextEl.textContent = text;
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
    this.muteBtnEl.innerHTML = getPixelIconSvg(muted ? 'soundOff' : 'soundOn');
    this.muteBtnEl.setAttribute('aria-pressed', String(muted));
  }

  setPixelScale(scale: number): void {
    this.applyPixelScale(scale);
  }

  setCameraMode(mode: number): void {
    this.applyCameraMode(mode);
  }

  setWeather(weather: WeatherId, lightningFlash = 0): void {
    if (weather !== this.currentWeather) {
      this.currentWeather = weather;
      this.weatherBtnEl.dataset.weather = weather;
      this.weatherIconEl.innerHTML = getPixelIconSvg(WEATHER_ICON_MAP[weather]);
      this.weatherLabelEl.textContent = weatherName(weather);
      this.weatherFxEl.dataset.weather = weather;
    }
    const flashing = lightningFlash > 0.16;
    if (flashing !== this.lastWeatherFlash) {
      this.lastWeatherFlash = flashing;
      this.weatherFxEl.classList.toggle('is-flash', flashing);
    }
  }

  isEditingName(): boolean {
    return this.editingName;
  }

  openHomeModal(prefillRoom?: string, errorMsg?: string, requireAuth = false): void {
    if (this.editingName) {
      this.finishEditingName(true);
    }
    if (this.avatarPopoverOpen) {
      this.setAvatarPopoverOpen(false);
    }

    this.homeAuthLocked = requireAuth;
    this.homeResumeBtnEl.classList.toggle('is-hidden', requireAuth);

    if (typeof prefillRoom === 'string') {
      this.homeRoomInputEl.value = prefillRoom;
      this.homePassInputEl.value = '';
    } else if (!this.homeRoomInputEl.value && this.currentRoom !== 'global') {
      this.homeRoomInputEl.value = this.currentRoom;
    }

    if (typeof errorMsg === 'string') {
      this.setHomeError(errorMsg);
    } else {
      this.setHomeError(null);
    }

    this.renderRecentRooms();
    this.syncRoomPill();

    if (!this.homeModalOpen) {
      this.homeModalOpen = true;
      this.homeOverlayEl.classList.add('is-open');
      this.homeBtnEl.classList.add('is-active');
      document.addEventListener('keydown', this.onDocKeyDown, true);
      this.callbacks.onRoomModalToggle?.(true);
    }

    window.requestAnimationFrame(() => {
      if (prefillRoom && errorMsg) {
        this.homePassInputEl.focus();
      } else {
        this.homeRoomInputEl.focus();
      }
    });
  }

  closeHomeModal(force = false): void {
    if (!this.homeModalOpen) return;
    if (!force && this.homeAuthLocked) return;
    this.homeAuthLocked = false;
    this.toggleRenameRow(false);
    this.homeResumeBtnEl.classList.remove('is-hidden');
    this.homeModalOpen = false;
    this.homeOverlayEl.classList.remove('is-open');
    this.homeBtnEl.classList.remove('is-active');
    this.setHomeError(null);
    this.homeRoomInputEl.blur();
    this.homePassInputEl.blur();
    if (!this.avatarPopoverOpen) {
      document.removeEventListener('keydown', this.onDocKeyDown, true);
    }
    this.callbacks.onRoomModalToggle?.(false);
  }

  isHomeModalOpen(): boolean {
    return this.homeModalOpen;
  }

  isHomeAuthLocked(): boolean {
    return this.homeAuthLocked;
  }

  setRoomInfo(room: string, locked: boolean, title?: string, isHost?: boolean): void {
    const slug = (room || 'global').trim() || 'global';
    const nextTitle =
      slug === 'global'
        ? 'global'
        : (typeof title === 'string' && title.trim() ? title.trim().slice(0, 20) : slug);
    this.currentRoom = slug;
    this.currentRoomTitle = nextTitle;
    this.currentRoomLocked = Boolean(locked) && slug !== 'global';
    this.currentRoomIsHost = Boolean(isHost) && slug !== 'global';
    if (!this.currentRoomIsHost && this.homeRenameOpen) {
      this.toggleRenameRow(false);
    }
    if (slug !== 'global') {
      this.rememberRecentRoom(slug);
    }
    this.syncRoomPill();
  }

  setLobbyRooms(rooms: LobbyRoomSummary[]): void {
    this.lobbyRooms = rooms;
    this.renderLobbyRooms();
  }

  setHomeError(msg: string | null): void {
    if (!msg) {
      this.homeErrorEl.classList.add('is-hidden');
      this.homeErrorTextEl.textContent = '';
      return;
    }
    this.homeErrorTextEl.textContent = msg;
    this.homeErrorEl.classList.remove('is-hidden');
  }

  setHomeBusy(busy: boolean): void {
    this.homeBusy = busy;
    this.homeRoomInputEl.disabled = busy;
    this.homePassInputEl.disabled = busy;
    this.homeDiceBtnEl.disabled = busy;
    this.homeJoinBtnEl.disabled = busy;
    this.homePublicBtnEl.disabled = busy;
    this.homeResumeBtnEl.disabled = busy;
    this.homeRenameBtnEl.disabled = busy;
    this.homeRenameInputEl.disabled = busy;
    this.homeRenameSaveBtnEl.disabled = busy;
    this.homeRenameCancelBtnEl.disabled = busy;
    this.homeLobbyRefreshBtnEl.disabled = busy;
    this.homeJoinTextEl.textContent = busy ? t('checkingRoom') : t('createOrJoin');
  }

  setEnragedWarning(hunterName: string | null): void {
    const next = hunterName ? hunterName.trim() : null;
    if (next === this.lastEnragedHunter) return;
    this.lastEnragedHunter = next;

    if (!next) {
      this.enragedWarnEl.classList.add('is-hidden');
      return;
    }
    this.enragedWarnTextEl.textContent = t('rageHunt', { name: next });
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
  // PRIVATE LOCALE SYNC & GYRO CONTROLS
  // -------------------------------------------------------------------------

  private applyLocale(): void {
    this.langBtnEl.textContent = t('langBtn');
    this.weatherLabelEl.textContent = weatherName(this.currentWeather);
    this.homeBtnEl.title = t('homeTitle');
    this.homeTitleTextEl.textContent = t('homeTitle');
    this.homeHostBadgeEl.textContent = t('hostBadge');
    this.homeRenameBtnEl.title = t('renameRoom');
    this.homeRenameInputEl.placeholder = t('roomTitlePlaceholder');
    this.homeRenameSaveBtnEl.textContent = t('save');
    this.homeRenameCancelBtnEl.textContent = t('cancel');
    this.homeLobbyLabelEl.textContent = t('onlineRooms');
    this.homeLobbyRefreshBtnEl.title = t('refreshRooms');
    this.homeCopyBtnEl.title = t('copyLink');
    this.homeRoomInputEl.placeholder = t('roomCodePlaceholder');
    this.homePassInputEl.placeholder = t('roomPassPlaceholder');
    this.homeJoinTextEl.textContent = this.homeBusy ? t('checkingRoom') : t('createOrJoin');
    this.homePublicTextEl.textContent = t('enterPublic');
    this.homeResumeBtnEl.textContent = t('resumeRide');
    this.homeRecentLabelEl.textContent = t('recentRooms');
    this.syncRoomPill();
    this.renderLobbyRooms();
    this.sniperEscBtnEl.textContent = t('escCancel');

    for (let i = 0; i < WEAPONS.length; i++) {
      this.weaponLabelEls[i].textContent = weaponName(WEAPONS[i].id);
    }

    for (let i = 0; i < this.itemSlots.length; i++) {
      const ref = this.itemSlots[i];
      if (ref.lastType) {
        const label = itemName(ref.lastType);
        ref.btn.title = label;
        if (ref.nameEl) ref.nameEl.textContent = label;
      }
    }

    if (this.avatarUploadLabelEl) {
      this.avatarUploadLabelEl.textContent = t('uploadAvatar');
    }
    if (this.avatarResetBtnEl) {
      this.avatarResetBtnEl.title = t('clearAvatarTitle');
    }

    if (this.lastKos > 0) {
      this.koValEl.textContent = `${t('koLabel')} ${this.lastKos}`;
    }

    if (this.lastWheelieTier === 3) {
      this.wheelieTextEl.textContent = t('flip');
    } else if (this.lastWheelieTier === 2) {
      this.wheelieTextEl.textContent = t('slam');
    } else {
      this.wheelieTextEl.textContent = t('wheelie');
    }

    if (this.lastIncomingLockName) {
      this.dangerLockTextEl.textContent = t('sniperDodge', { name: this.lastIncomingLockName });
    }
    if (this.lastEnragedHunter) {
      this.enragedWarnTextEl.textContent = t('rageHunt', { name: this.lastEnragedHunter });
    }
    if (this.lastScopeResult) {
      this.scopeResultEl.textContent =
        this.lastScopeResult === 'HIT'
          ? t('sniperHit')
          : this.lastScopeResult === 'DODGED'
            ? t('sniperDodged')
            : t('sniperMiss');
    }

    // Force standings rows to re-sync localized delivery rider names on next tick
    for (let i = 0; i < this.standingRows.length; i++) {
      this.standingRows[i].lastName = '';
    }
  }

  private submitHomeForm(): void {
    if (this.homeBusy) return;
    const room = this.homeRoomInputEl.value.trim();
    const password = this.homePassInputEl.value;
    if (!room) {
      this.setHomeError(t('invalidRoom'));
      this.homeRoomInputEl.focus();
      return;
    }
    this.setHomeError(null);
    void this.callbacks.onJoinRoom?.(room, password);
  }

  private syncRoomPill(): void {
    const isGlobal = this.currentRoom === 'global';
    const label = isGlobal ? t('publicHall') : this.currentRoomTitle || this.currentRoom;
    this.homeRoomTextEl.textContent = label;
    this.homeRoomPillEl.title = isGlobal ? t('publicHall') : `${label} (#${this.currentRoom})`;
    this.homeRoomIconEl.innerHTML = getPixelIconSvg(
      this.currentRoomLocked ? 'lock' : isGlobal ? 'globe' : 'unlock',
      'vm-icon-sm'
    );
    this.homeRoomPillEl.classList.toggle('is-locked', this.currentRoomLocked);
    this.homeHostBadgeEl.classList.toggle('is-hidden', !this.currentRoomIsHost);
    this.homeRenameBtnEl.classList.toggle('is-hidden', !this.currentRoomIsHost);
    this.homePublicBtnEl.classList.toggle('is-hidden', isGlobal);
  }

  private toggleRenameRow(open: boolean): void {
    const next = open && this.currentRoomIsHost && this.currentRoom !== 'global';
    this.homeRenameOpen = next;
    this.homeRenameRowEl.classList.toggle('is-hidden', !next);
    if (next) {
      this.homeRenameInputEl.value = this.currentRoomTitle || this.currentRoom;
      window.requestAnimationFrame(() => {
        this.homeRenameInputEl.focus();
        this.homeRenameInputEl.select();
      });
    } else {
      this.homeRenameInputEl.blur();
    }
  }

  private submitRenameRoom(): void {
    if (this.homeBusy || !this.currentRoomIsHost) return;
    const nextTitle = this.homeRenameInputEl.value.trim();
    this.callbacks.onRenameRoom?.(nextTitle);
    this.toggleRenameRow(false);
  }

  private renderLobbyRooms(): void {
    this.homeLobbyCountEl.textContent = String(this.lobbyRooms.length);
    this.homeLobbyListEl.textContent = '';

    if (this.lobbyRooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = t('noOtherRooms');
      this.homeLobbyListEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this.lobbyRooms.length; i++) {
      const room = this.lobbyRooms[i];
      const isGlobal = room.slug === 'global';
      const displayTitle = isGlobal ? t('publicHall') : room.title || room.slug;
      const showCodeSub = !isGlobal && displayTitle !== room.slug;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'vm-home-lobby-item';
      if (room.isCurrent) row.classList.add('is-current');
      if (room.locked) row.classList.add('is-locked');

      const left = document.createElement('div');
      left.className = 'vm-home-lobby-left';

      const icon = document.createElement('span');
      icon.className = 'vm-btn-icon vm-home-lobby-icon';
      icon.innerHTML = getPixelIconSvg(
        room.locked ? 'lock' : isGlobal ? 'globe' : 'unlock',
        'vm-icon-sm'
      );

      const names = document.createElement('div');
      names.className = 'vm-home-lobby-names';

      const titleEl = document.createElement('span');
      titleEl.className = 'vm-home-lobby-name';
      titleEl.textContent = displayTitle;
      names.appendChild(titleEl);

      if (showCodeSub) {
        const codeEl = document.createElement('span');
        codeEl.className = 'vm-home-lobby-code';
        codeEl.textContent = `#${room.slug}`;
        names.appendChild(codeEl);
      }

      left.append(icon, names);

      const right = document.createElement('div');
      right.className = 'vm-home-lobby-right';

      if (room.isCurrent) {
        const curBadge = document.createElement('span');
        curBadge.className = 'vm-home-lobby-tag is-current';
        curBadge.textContent = t('currentBadge');
        right.appendChild(curBadge);
      }

      const lockTag = document.createElement('span');
      lockTag.className = `vm-home-lobby-tag ${room.locked ? 'is-locked' : 'is-open'}`;
      lockTag.textContent = room.locked ? t('lockedRoom') : t('openRoom');

      const countTag = document.createElement('span');
      countTag.className = 'vm-home-lobby-players';
      const dot = document.createElement('span');
      dot.className = 'vm-home-lobby-dot';
      const num = document.createElement('span');
      num.textContent = t('playersCount', { count: room.count });
      countTag.append(dot, num);

      right.append(lockTag, countTag);
      row.append(left, right);

      row.addEventListener('click', () => {
        if (this.homeBusy || room.isCurrent) return;
        if (room.locked) {
          this.homeRoomInputEl.value = room.slug;
          this.homePassInputEl.value = '';
          this.setHomeError(t('enterPassForRoom', { room: displayTitle }));
          this.homePassInputEl.focus();
          return;
        }
        this.setHomeError(null);
        void this.callbacks.onJoinRoom?.(room.slug, '');
      });

      this.homeLobbyListEl.appendChild(row);
    }
  }

  private loadRecentRooms(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_ROOMS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const out: string[] = [];
      for (let i = 0; i < arr.length && out.length < MAX_RECENT_ROOMS; i++) {
        const v = typeof arr[i] === 'string' ? arr[i].trim().slice(0, 20) : '';
        if (v && v !== 'global' && !out.includes(v)) out.push(v);
      }
      return out;
    } catch {
      return [];
    }
  }

  private rememberRecentRoom(slug: string): void {
    const clean = slug.trim().slice(0, 20);
    if (!clean || clean === 'global') return;
    this.recentRooms = [clean, ...this.recentRooms.filter((r) => r !== clean)].slice(
      0,
      MAX_RECENT_ROOMS
    );
    try {
      localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(this.recentRooms));
    } catch {
      // Ignore storage quota errors
    }
    this.renderRecentRooms();
  }

  private renderRecentRooms(): void {
    if (this.recentRooms.length === 0) {
      this.homeRecentWrapEl.classList.add('is-hidden');
      this.homeRecentChipsEl.textContent = '';
      return;
    }
    this.homeRecentWrapEl.classList.remove('is-hidden');
    this.homeRecentChipsEl.textContent = '';
    for (let i = 0; i < this.recentRooms.length; i++) {
      const slug = this.recentRooms[i];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'vm-home-recent-chip';
      chip.textContent = slug;
      chip.addEventListener('click', () => {
        if (this.homeBusy) return;
        this.homeRoomInputEl.value = slug;
        this.setHomeError(null);
        this.homePassInputEl.focus();
      });
      this.homeRecentChipsEl.appendChild(chip);
    }
  }

  private toggleGyro(): void {
    if (this.gyroEnabled) {
      this.disableGyro(true);
      return;
    }

    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      this.showToast(t('noGyro'), 'red', 'warning');
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
            this.showToast(t('noGyro'), 'red', 'warning');
          }
        })
        .catch(() => {
          this.showToast(t('noGyro'), 'red', 'warning');
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

    if (this.gyroSensorTimer !== null) {
      window.clearTimeout(this.gyroSensorTimer);
    }
    this.gyroSensorTimer = window.setTimeout(() => {
      this.gyroSensorTimer = null;
      if (this.gyroEnabled && !this.gyroHasData) {
        this.disableGyro(false);
        this.showToast(t('noGyro'), 'red', 'warning');
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
      this.showToast(t('gyroOff'), 'gold', 'gyro');
    }
  }

  // -------------------------------------------------------------------------
  // PRIVATE BUILDERS & EVENTS
  // -------------------------------------------------------------------------

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

    // Compact upload & reset action row (pixel SVGs, zero emoji)
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

    const uploadIcon = document.createElement('span');
    uploadIcon.className = 'vm-btn-icon';
    uploadIcon.innerHTML = getPixelIconSvg('upload', 'vm-icon-sm');

    const uploadLabel = document.createElement('span');
    uploadLabel.textContent = t('uploadAvatar');
    this.avatarUploadLabelEl = uploadLabel;

    uploadBtn.append(uploadIcon, uploadLabel);
    uploadBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      fileInput.click();
      uploadBtn.blur();
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'vm-avatar-reset-btn is-hidden';
    resetBtn.innerHTML = getPixelIconSvg('reset', 'vm-icon-sm');
    resetBtn.title = t('clearAvatarTitle');
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
      if (!this.homeModalOpen) {
        document.removeEventListener('keydown', this.onDocKeyDown, true);
      }
    }
  }

  private renderFeed(): void {
    const count = this.feedEntries.length;
    for (let i = 0; i < FEED_SLOTS; i++) {
      const slot = this.feedLines[i];
      if (i >= count) {
        slot.root.className = 'vm-feed-line is-hidden';
        continue;
      }
      const entry = this.feedEntries[i];
      slot.root.dataset.accent = entry.accent;
      slot.root.className = entry.fading ? 'vm-feed-line is-fading' : 'vm-feed-line';
      if (entry.icon) {
        slot.iconEl.innerHTML = getPixelIconSvg(entry.icon, 'vm-icon-sm');
        slot.iconEl.classList.remove('is-hidden');
      } else {
        slot.iconEl.textContent = '';
        slot.iconEl.classList.add('is-hidden');
      }
      slot.textEl.textContent = entry.text;
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

    // -----------------------------------------------------------------------
    // LEFT VIRTUAL JOYSTICK: Proportional Analog Steer + Nitro (Up) + Brake (Down)
    // -----------------------------------------------------------------------
    const leftStick = document.createElement('div');
    leftStick.className = 'vm-joy vm-joy-left';
    leftStick.setAttribute('aria-label', 'Drive joystick');

    const lUp = document.createElement('span');
    lUp.className = 'vm-joy-dir vm-joy-dir-up vm-joy-dir-nitro';
    lUp.innerHTML = getPixelIconSvg('bolt', 'vm-joy-icon');

    const lDown = document.createElement('span');
    lDown.className = 'vm-joy-dir vm-joy-dir-down vm-joy-dir-brake';
    lDown.innerHTML = getPixelIconSvg('brake', 'vm-joy-icon');

    const lLeft = document.createElement('span');
    lLeft.className = 'vm-joy-dir vm-joy-dir-left vm-joy-dir-steer';
    lLeft.innerHTML = getPixelIconSvg('arrowLeft', 'vm-joy-icon');

    const lRight = document.createElement('span');
    lRight.className = 'vm-joy-dir vm-joy-dir-right vm-joy-dir-steer';
    lRight.innerHTML = getPixelIconSvg('arrowRight', 'vm-joy-icon');

    const leftKnob = document.createElement('span');
    leftKnob.className = 'vm-joy-knob vm-joy-knob-left';

    leftStick.append(lUp, lDown, lLeft, lRight, leftKnob);

    let leftPid: number | null = null;
    let leftCx = 0;
    let leftCy = 0;
    let leftMaxR = 34;
    let lastLeftNitro = false;
    let lastLeftBrake = false;
    let lastLeftDir = 0;

    const updateLeftStick = (clientX: number, clientY: number): void => {
      const rawDx = clientX - leftCx;
      const rawDy = clientY - leftCy;
      const dist = Math.hypot(rawDx, rawDy);
      const scale = dist > leftMaxR && dist > 0 ? leftMaxR / dist : 1;
      const dx = rawDx * scale;
      const dy = rawDy * scale;

      leftKnob.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;

      const nx = leftMaxR > 0 ? dx / leftMaxR : 0;
      const ny = leftMaxR > 0 ? dy / leftMaxR : 0;

      const absX = Math.abs(nx);
      let steer = 0;
      if (absX > 0.12) {
        steer = Math.sign(nx) * Math.min(1, (absX - 0.12) / 0.88);
        steer = Math.round(steer * 1000) / 1000;
      }

      const nitro = ny < -0.45;
      const brake = ny > 0.5;
      const dir = steer < -0.05 ? -1 : steer > 0.05 ? 1 : 0;

      if (nitro !== lastLeftNitro) {
        lastLeftNitro = nitro;
        lUp.classList.toggle('is-lit', nitro);
      }
      if (brake !== lastLeftBrake) {
        lastLeftBrake = brake;
        lDown.classList.toggle('is-lit', brake);
      }
      if (dir !== lastLeftDir) {
        lastLeftDir = dir;
        lLeft.classList.toggle('is-lit', dir < 0);
        lRight.classList.toggle('is-lit', dir > 0);
      }

      this.callbacks.onTouchInput?.({ analogSteer: steer, nitro, brake });
    };

    const resetLeftStick = (): void => {
      leftPid = null;
      leftStick.classList.remove('is-active');
      leftKnob.style.transform = 'translate3d(0, 0, 0)';
      if (lastLeftNitro) {
        lastLeftNitro = false;
        lUp.classList.remove('is-lit');
      }
      if (lastLeftBrake) {
        lastLeftBrake = false;
        lDown.classList.remove('is-lit');
      }
      if (lastLeftDir !== 0) {
        lastLeftDir = 0;
        lLeft.classList.remove('is-lit');
        lRight.classList.remove('is-lit');
      }
      this.callbacks.onTouchInput?.({ analogSteer: null, nitro: false, brake: false });
    };

    leftStick.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (leftPid !== null) return;
      leftPid = e.pointerId;
      try {
        leftStick.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events
      }
      const rect = leftStick.getBoundingClientRect();
      leftCx = rect.left + rect.width * 0.5;
      leftCy = rect.top + rect.height * 0.5;
      leftMaxR = Math.max(24, rect.width * 0.34);
      leftStick.classList.add('is-active');
      updateLeftStick(e.clientX, e.clientY);
    });

    leftStick.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== leftPid) return;
      e.preventDefault();
      e.stopPropagation();
      updateLeftStick(e.clientX, e.clientY);
    });

    const onLeftRelease = (e: PointerEvent): void => {
      if (e.pointerId !== leftPid) return;
      e.preventDefault();
      e.stopPropagation();
      resetLeftStick();
    };
    leftStick.addEventListener('pointerup', onLeftRelease);
    leftStick.addEventListener('pointercancel', onLeftRelease);
    leftStick.addEventListener('lostpointercapture', onLeftRelease);

    // -----------------------------------------------------------------------
    // RIGHT VIRTUAL JOYSTICK: Attack L/R + Wheelie (Up) + Item (Down) + Tap Auto
    // -----------------------------------------------------------------------
    const rightStick = document.createElement('div');
    rightStick.className = 'vm-joy vm-joy-right';
    rightStick.setAttribute('aria-label', 'Combat and stunt joystick');

    const rUp = document.createElement('span');
    rUp.className = 'vm-joy-dir vm-joy-dir-up vm-joy-dir-wheelie';
    rUp.innerHTML = getPixelIconSvg('wheelie', 'vm-joy-icon');

    const rDown = document.createElement('span');
    rDown.className = 'vm-joy-dir vm-joy-dir-down vm-joy-dir-item';
    const rDownIcon = document.createElement('span');
    rDownIcon.textContent = 'R';
    const rDownCount = document.createElement('span');
    rDownCount.className = 'vm-joy-item-count is-hidden';
    rDown.append(rDownIcon, rDownCount);
    this.rightJoyItemEl = rDown;
    this.rightJoyItemIconEl = rDownIcon;
    this.rightJoyItemCountEl = rDownCount;

    const rLeft = document.createElement('span');
    rLeft.className = 'vm-joy-dir vm-joy-dir-left vm-joy-dir-atk';
    rLeft.innerHTML = getPixelIconSvg('arrowLeft', 'vm-joy-icon');

    const rRight = document.createElement('span');
    rRight.className = 'vm-joy-dir vm-joy-dir-right vm-joy-dir-atk';
    rRight.innerHTML = getPixelIconSvg('arrowRight', 'vm-joy-icon');

    const rightKnob = document.createElement('span');
    rightKnob.className = 'vm-joy-knob vm-joy-knob-right';

    rightStick.append(rUp, rDown, rLeft, rRight, rightKnob);

    let rightPid: number | null = null;
    let rightCx = 0;
    let rightCy = 0;
    let rightMaxR = 34;
    let rightDownMs = 0;
    let rightMaxDist = 0;
    let rightItemFired = false;
    let lastRightAtkL = false;
    let lastRightAtkR = false;
    let lastRightWheelie = false;

    const updateRightStick = (clientX: number, clientY: number): void => {
      const rawDx = clientX - rightCx;
      const rawDy = clientY - rightCy;
      const dist = Math.hypot(rawDx, rawDy);
      if (dist > rightMaxDist) rightMaxDist = dist;

      const scale = dist > rightMaxR && dist > 0 ? rightMaxR / dist : 1;
      const dx = rawDx * scale;
      const dy = rawDy * scale;

      rightKnob.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;

      const nx = rightMaxR > 0 ? dx / rightMaxR : 0;
      const ny = rightMaxR > 0 ? dy / rightMaxR : 0;
      const absX = Math.abs(nx);
      const absY = Math.abs(ny);

      const atkL = nx < -0.36 && absX >= absY * 0.8;
      const atkR = nx > 0.36 && absX >= absY * 0.8;
      const wheelie = ny < -0.38 && absY > absX;
      const flickDown = ny > 0.46 && absY > absX;

      if (flickDown) {
        if (!rightItemFired) {
          rightItemFired = true;
          rDown.classList.add('is-lit');
          if (!this.itemSlots[0].btn.disabled) {
            this.callbacks.onUseItem(0);
          }
        }
      } else if (ny < 0.2 && rightItemFired) {
        rightItemFired = false;
        rDown.classList.remove('is-lit');
      }

      if (atkL !== lastRightAtkL || atkR !== lastRightAtkR || wheelie !== lastRightWheelie) {
        lastRightAtkL = atkL;
        lastRightAtkR = atkR;
        lastRightWheelie = wheelie;
        rLeft.classList.toggle('is-lit', atkL);
        rRight.classList.toggle('is-lit', atkR);
        rUp.classList.toggle('is-lit', wheelie);
        this.callbacks.onTouchInput?.({
          attackLeft: atkL,
          attackRight: atkR,
          wheelie,
        });
      }
    };

    const resetRightStick = (allowTap: boolean): void => {
      const elapsed = performance.now() - rightDownMs;
      const tapSlop = Math.max(11, rightMaxR * 0.32);
      const isQuickTap = allowTap && elapsed < 220 && rightMaxDist < tapSlop && !rightItemFired;

      rightPid = null;
      rightItemFired = false;
      rightStick.classList.remove('is-active');
      rightKnob.style.transform = 'translate3d(0, 0, 0)';
      rLeft.classList.remove('is-lit');
      rRight.classList.remove('is-lit');
      rUp.classList.remove('is-lit');
      rDown.classList.remove('is-lit');
      lastRightAtkL = false;
      lastRightAtkR = false;
      lastRightWheelie = false;

      if (isQuickTap) {
        this.callbacks.onTouchInput?.({
          attackLeft: false,
          attackRight: false,
          wheelie: false,
          attackAuto: true,
        });
      } else {
        this.callbacks.onTouchInput?.({
          attackLeft: false,
          attackRight: false,
          wheelie: false,
        });
      }
    };

    rightStick.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (rightPid !== null) return;
      rightPid = e.pointerId;
      rightDownMs = performance.now();
      rightMaxDist = 0;
      rightItemFired = false;
      try {
        rightStick.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic events
      }
      const rect = rightStick.getBoundingClientRect();
      rightCx = rect.left + rect.width * 0.5;
      rightCy = rect.top + rect.height * 0.5;
      rightMaxR = Math.max(24, rect.width * 0.34);
      rightStick.classList.add('is-active');
      updateRightStick(e.clientX, e.clientY);
    });

    rightStick.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== rightPid) return;
      e.preventDefault();
      e.stopPropagation();
      updateRightStick(e.clientX, e.clientY);
    });

    rightStick.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerId !== rightPid) return;
      e.preventDefault();
      e.stopPropagation();
      resetRightStick(true);
    });

    const onRightCancel = (e: PointerEvent): void => {
      if (e.pointerId !== rightPid) return;
      e.preventDefault();
      e.stopPropagation();
      resetRightStick(false);
    };
    rightStick.addEventListener('pointercancel', onRightCancel);
    rightStick.addEventListener('lostpointercapture', onRightCancel);

    layer.append(leftStick, rightStick);
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
          ref.iconEl.textContent = '-';
          if (ref.nameEl) ref.nameEl.textContent = '--';
        } else {
          const spec = ITEM_BY_ID[itemType];
          const label = itemName(itemType);
          ref.btn.disabled = false;
          ref.btn.classList.add('is-ready');
          ref.btn.style.borderColor = spec.color;
          ref.btn.title = label;
          if (ref.keyEl) ref.keyEl.style.backgroundColor = spec.color;
          ref.iconEl.innerHTML = getPixelIconSvg(ITEM_ICON_MAP[itemType], 'vm-icon-sm');
          if (ref.nameEl) ref.nameEl.textContent = label;
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

    // Right joystick bottom item indicator: sync slot 0 pixel SVG & x2/x3/x4 count badge
    if (this.rightJoyItemEl && this.rightJoyItemIconEl && this.rightJoyItemCountEl) {
      const firstType: ItemType | null =
        heldItems && count > 0 ? heldItems[0].type : fallbackItem;
      if (firstType !== this.lastTouchItemType) {
        this.lastTouchItemType = firstType;
        if (!firstType) {
          this.rightJoyItemEl.classList.remove('is-ready');
          this.rightJoyItemEl.style.color = '';
          this.rightJoyItemIconEl.textContent = 'R';
        } else {
          const spec = ITEM_BY_ID[firstType];
          this.rightJoyItemEl.classList.add('is-ready');
          this.rightJoyItemEl.style.color = spec.color;
          this.rightJoyItemIconEl.innerHTML = getPixelIconSvg(
            ITEM_ICON_MAP[firstType],
            'vm-joy-icon'
          );
        }
      }
      if (count !== this.lastTouchItemCount) {
        this.lastTouchItemCount = count;
        if (count > 1) {
          this.rightJoyItemCountEl.classList.remove('is-hidden');
          this.rightJoyItemCountEl.textContent = `x${count}`;
        } else {
          this.rightJoyItemCountEl.classList.add('is-hidden');
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
        this.wheelieIconEl.innerHTML = getPixelIconSvg('warning', 'vm-icon-xs');
        this.wheelieIconEl.classList.remove('is-hidden');
        this.wheelieTextEl.textContent = t('flip');
      } else if (tier === 2) {
        this.wheelieWrapEl.dataset.tier = 'slam';
        this.wheelieIconEl.innerHTML = getPixelIconSvg('bolt', 'vm-icon-xs');
        this.wheelieIconEl.classList.remove('is-hidden');
        this.wheelieTextEl.textContent = t('slam');
      } else {
        this.wheelieWrapEl.dataset.tier = 'ok';
        this.wheelieIconEl.textContent = '';
        this.wheelieIconEl.classList.add('is-hidden');
        this.wheelieTextEl.textContent = t('wheelie');
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
    this.dangerLockTextEl.textContent = t('sniperDodge', { name: next });
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
        this.koValEl.textContent = `${t('koLabel')} ${kos}`;
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
      const displayName =
        role === 'meituan' || role === 'eleme' ? deliveryName(role) : rider.name;
      const lap = getLapNumber(rider.s);
      const distTenth = Math.round(Math.max(0, rider.s) / 100);
      const borderColor =
        role === 'meituan'
          ? '#ffc300'
          : role === 'eleme'
            ? '#0091ff'
            : isLocal
              ? '#ffbe3b'
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
      if (ref.lastName !== displayName) {
        ref.lastName = displayName;
        ref.name.textContent = displayName;
      }
      if (ref.lastLap !== lap || ref.lastDistTenth !== distTenth) {
        ref.lastLap = lap;
        ref.lastDistTenth = distTenth;
        ref.dist.textContent = `L${lap} ${(distTenth / 10).toFixed(1)}km`;
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
