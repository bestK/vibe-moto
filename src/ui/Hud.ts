import { AVATAR_COUNT, PIXEL_AVATARS, getAvatarDataUrl } from '../game/PixelAvatars';
import { BIKE_PALETTES, BOT_PALETTE, RiderRenderState, WEAPONS, WeaponType } from '../game/types';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';
export type ToastAccent = 'gold' | 'cyan' | 'red';

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
  onEditingName(editing: boolean): void;
  onToggleMute(): boolean;
  onTogglePixelScale(): number;
  onCycleCamera(): number;
  onSelectWeapon(w: 0 | 1 | 2): void;
  onRegroupPack(): void;
  onTouchInput?(patch: TouchInputPatch): void;
}

const STANDINGS_SLOTS = 5;
const BAR_SEGMENTS = 12;
const RADAR_POOL = 16;
const RADAR_RANGE_M = 40;
const HUD_UPDATE_INTERVAL = 0.05; // 20Hz DOM refresh cap
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

interface StandingRowRefs {
  root: HTMLDivElement;
  rank: HTMLSpanElement;
  avatar: HTMLImageElement;
  name: HTMLSpanElement;
  dist: HTMLSpanElement;
  ko: HTMLSpanElement;
  koVal: HTMLSpanElement;
  lastKey: string;
  lastAvatarIdx: number;
}

interface RadarDotRefs {
  el: HTMLSpanElement;
  visible: boolean;
  topPx: number;
  leftPct: number;
  color: string;
  clamped: boolean;
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

function formatDistanceKm(meters: number): string {
  const km = Math.max(0, meters) / 1000;
  return `${km.toFixed(1)}km`;
}

function formatDeltaMeters(ds: number): string {
  const rounded = Math.round(ds);
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

  // Top-left controls
  private readonly riderPillEl: HTMLDivElement;
  private readonly avatarBtnEl: HTMLButtonElement;
  private readonly avatarImgEl: HTMLImageElement;
  private readonly avatarPopoverEl: HTMLDivElement;
  private readonly avatarOptEls: HTMLButtonElement[] = [];
  private readonly nameplateEl: HTMLDivElement;
  private readonly nameTextEl: HTMLSpanElement;
  private readonly nameInputEl: HTMLInputElement;
  private readonly netBadgeEl: HTMLDivElement;
  private readonly netCountEl: HTMLSpanElement;
  private readonly muteBtnEl: HTMLButtonElement;
  private readonly pxBtnEl: HTMLButtonElement;
  private readonly camPips: HTMLSpanElement[] = [];
  private readonly regroupBtnEl: HTMLButtonElement;

  // Top-center toast
  private readonly toastEl: HTMLDivElement;
  private toastRafId: number | null = null;
  private toastHideTimer: number | null = null;
  private toastClearTimer: number | null = null;

  // Top-right standings & vertical radar
  private readonly standingRows: StandingRowRefs[] = [];
  private readonly radarLocalEl: HTMLSpanElement;
  private readonly radarDots: RadarDotRefs[] = [];
  private readonly radarDeltaEl: HTMLSpanElement;

  // Bottom-right telemetry & weapons
  private readonly koPillEl: HTMLDivElement;
  private readonly koValEl: HTMLSpanElement;
  private readonly speedValEl: HTMLSpanElement;
  private readonly nitroTrackEl: HTMLDivElement;
  private readonly nitroSegs: HTMLSpanElement[] = [];
  private readonly hpTagEl: HTMLSpanElement;
  private readonly hpTrackEl: HTMLDivElement;
  private readonly hpSegs: HTMLSpanElement[] = [];
  private readonly weaponChips: HTMLButtonElement[] = [];

  // Bottom-left keycaps
  private readonly keycapsEl: HTMLDivElement;
  private readonly keyEls: HTMLSpanElement[] = [];

  // Internal state & dirty-check caches
  private currentName: string;
  private currentColorIdx: number;
  private currentAvatarIdx: number;
  private editingName = false;
  private avatarPopoverOpen = false;
  private muted = false;
  private pixelScale = 1;
  private cameraMode = 0;
  private connStatus: ConnectionStatus = 'connecting';
  private onlineCount = 1;
  private hasOnlinePeers = false;

  private uiAccum = HUD_UPDATE_INTERVAL;
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
  private lastLocalRadarLeft = -1;
  private lastDeltaText = '';
  private lastDeltaClass = '';
  private lastDeltaTop = -1;

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
    // 1. TOP-LEFT COMPACT PILL CLUSTER
    // -----------------------------------------------------------------------
    const topLeft = document.createElement('div');
    topLeft.className = 'vm-top-left';

    // Unified Rider Identity Pill: Pixel Avatar Button + Inline Nameplate + 3x3 Avatar Popover
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
    this.avatarImgEl.src = getAvatarDataUrl(this.currentAvatarIdx, 2);
    this.avatarBtnEl.appendChild(this.avatarImgEl);

    this.avatarBtnEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (this.editingName) {
        this.finishEditingName(true);
      }
      this.setAvatarPopoverOpen(!this.avatarPopoverOpen);
      this.avatarBtnEl.blur();
    });

    // Floating 3x3 pixel avatar grid popover
    this.avatarPopoverEl = document.createElement('div');
    this.avatarPopoverEl.className = 'vm-slab vm-avatar-popover';
    this.avatarPopoverEl.setAttribute('role', 'listbox');
    this.avatarPopoverEl.setAttribute('aria-label', 'Avatars');

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
      img.src = getAvatarDataUrl(i, 2);

      opt.appendChild(img);
      opt.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.selectAvatar(i, true);
        this.setAvatarPopoverOpen(false);
        opt.blur();
      });

      this.avatarOptEls.push(opt);
      this.avatarPopoverEl.appendChild(opt);
    }

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

    actions.append(this.muteBtnEl, this.pxBtnEl, camBtnEl, this.regroupBtnEl);
    topLeft.append(this.riderPillEl, this.netBadgeEl, actions);

    // -----------------------------------------------------------------------
    // 2. TOP-CENTER TRANSIENT TOAST
    // -----------------------------------------------------------------------
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'vm-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');

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

      const name = document.createElement('span');
      name.className = 'vm-row-name';

      const dist = document.createElement('span');
      dist.className = 'vm-row-dist';

      const ko = document.createElement('span');
      ko.className = 'vm-row-ko is-hidden';
      ko.innerHTML = ICON_SKULL_SM;
      const koVal = document.createElement('span');
      ko.appendChild(koVal);

      row.append(rank, avatar, name, dist, ko);
      standingsEl.appendChild(row);
      this.standingRows.push({
        root: row,
        rank,
        avatar,
        name,
        dist,
        ko,
        koVal,
        lastKey: '',
        lastAvatarIdx: -1,
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

    const radarTrack = document.createElement('div');
    radarTrack.className = 'vm-radar';

    this.radarLocalEl = document.createElement('span');
    this.radarLocalEl.className = 'vm-radar-local';
    radarTrack.appendChild(this.radarLocalEl);

    for (let i = 0; i < RADAR_POOL; i++) {
      const dot = document.createElement('span');
      dot.className = 'vm-radar-dot is-hidden';
      radarTrack.appendChild(dot);
      this.radarDots.push({
        el: dot,
        visible: false,
        topPx: -1,
        leftPct: -1,
        color: '',
        clamped: false,
      });
    }

    this.radarDeltaEl = document.createElement('span');
    this.radarDeltaEl.className = 'vm-radar-delta is-hidden';

    radarWrap.append(capTop, capBot, this.radarDeltaEl, radarTrack);
    topRight.append(standingsEl, radarWrap);

    // -----------------------------------------------------------------------
    // 4. BOTTOM-RIGHT SPEED & COMBAT CLUSTER
    // -----------------------------------------------------------------------
    const bottomRight = document.createElement('div');
    bottomRight.className = 'vm-bottom-right';

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

    // Weapon selector chips
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

    bottomRight.append(speedHeader, gaugesEl, weaponsEl);

    // -----------------------------------------------------------------------
    // 5. BOTTOM-LEFT KEYCAP HINTS & TOUCH CONTROLS
    // -----------------------------------------------------------------------
    this.keycapsEl = this.buildKeycaps();
    const touchLayer = this.buildTouchControls();

    this.root.append(
      topLeft,
      this.toastEl,
      topRight,
      bottomRight,
      this.keycapsEl,
      touchLayer
    );

    container.textContent = '';
    container.appendChild(this.root);
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

  update(
    local: RiderRenderState,
    allRiders: RiderRenderState[],
    pressedKeys: Set<string>,
    dt: number
  ): void {
    // 1. Keycaps: instant bitmask dirty-check (zero DOM work unless keys change)
    this.updateKeycaps(pressedKeys, local.speed, dt);

    // 2. Throttle heavier HUD updates to ~20Hz
    this.uiAccum += dt;
    if (this.uiAccum < HUD_UPDATE_INTERVAL) return;
    this.uiAccum = 0;

    // Sync local nameplate name/color/avatar if externally updated
    if (!this.editingName && local.name && local.name !== this.currentName) {
      this.currentName = local.name.slice(0, 14);
      this.nameTextEl.textContent = this.currentName;
    }
    if (local.colorIdx !== this.currentColorIdx) {
      this.currentColorIdx = local.colorIdx;
      this.avatarBtnEl.style.borderColor = getRiderColor(local.colorIdx, false);
    }
    const localAvatarIdx = normalizeAvatarIdx(local.avatarIdx);
    if (localAvatarIdx !== this.currentAvatarIdx) {
      this.selectAvatar(localAvatarIdx, false);
    }

    // Check online peer presence from live riders as well
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

    this.updateSpeedAndBars(local);
    this.updateStandings(local, allRiders);
    this.updateRadar(local, allRiders);
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

    // Trigger crisp stepped entrance on next frame
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

  // -------------------------------------------------------------------------
  // PRIVATE BUILDERS & EVENTS
  // -------------------------------------------------------------------------

  private selectAvatar(avatarIdx: number, notify: boolean): void {
    const nextIdx = normalizeAvatarIdx(avatarIdx);
    this.currentAvatarIdx = nextIdx;
    this.avatarImgEl.src = getAvatarDataUrl(nextIdx, 2);

    for (let i = 0; i < this.avatarOptEls.length; i++) {
      const active = i === nextIdx;
      this.avatarOptEls[i].classList.toggle('is-active', active);
      this.avatarOptEls[i].setAttribute('aria-selected', String(active));
    }

    if (notify) {
      this.callbacks.onAvatarChange(nextIdx);
    }
  }

  private setAvatarPopoverOpen(open: boolean): void {
    if (this.avatarPopoverOpen === open) return;
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
    const brkBtn = makePad('BRK', 'brake', 'vm-touch-btn-brk');
    const steerRow = document.createElement('div');
    steerRow.className = 'vm-touch-steer';
    steerRow.append(
      makePad('◄', 'left', 'vm-touch-btn-steer'),
      makePad('►', 'right', 'vm-touch-btn-steer')
    );
    leftZone.append(brkBtn, steerRow);

    const rightZone = document.createElement('div');
    rightZone.className = 'vm-touch-right';
    rightZone.append(
      makePad('◄ ATK', 'attackLeft', 'vm-touch-btn-atk'),
      makePad('ATK ►', 'attackRight', 'vm-touch-btn-atk'),
      makePad('HOP', 'wheelie', 'vm-touch-btn-hop'),
      makePad('N2O', 'nitro', 'vm-touch-btn-nitro')
    );

    layer.append(leftZone, rightZone);
    return layer;
  }

  // -------------------------------------------------------------------------
  // PRIVATE THROTTLED & DIRTY-CHECKED UPDATERS
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

  private updateSpeedAndBars(local: RiderRenderState): void {
    // Speed readout
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

    // Nitro segments
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

    // HP segments
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

    // Active weapon + swing accent
    const swinging = local.attackSide !== 0;
    if (local.weapon !== this.lastWeapon || swinging !== this.lastSwinging) {
      this.applyWeaponHighlight(local.weapon, swinging);
    }

    // KO tally
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

    buf.sort((a, b) => b.s - a.s);

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
        if (ref.lastKey !== 'HIDDEN') {
          ref.lastKey = 'HIDDEN';
          ref.root.classList.add('is-hidden');
        }
        continue;
      }

      // Always keep local player visible in slot 4 if outside top 5
      const riderIdx =
        slot === STANDINGS_SLOTS - 1 && localRankIdx >= STANDINGS_SLOTS ? localRankIdx : slot;
      const rider = buf[riderIdx];
      const rankNum = riderIdx + 1;
      const isLocal = rider.isLocal || rider.id === local.id;
      const distStr = formatDistanceKm(rider.s);
      const color = getRiderColor(rider.colorIdx, rider.isBot);
      const avatarIdx = normalizeAvatarIdx(rider.avatarIdx);
      const kos = Math.max(0, Math.floor(rider.kos));

      const key = `${rankNum}|${rider.name}|${distStr}|${kos}|${color}|${avatarIdx}|${isLocal ? 1 : 0}|${rider.isBot ? 1 : 0}`;
      if (ref.lastKey === key) continue;
      ref.lastKey = key;

      ref.root.classList.remove('is-hidden');
      ref.root.classList.toggle('is-local', isLocal);
      ref.root.classList.toggle('is-bot', rider.isBot && !isLocal);
      ref.root.dataset.rank = String(rankNum);

      ref.rank.textContent = `#${rankNum}`;
      if (ref.lastAvatarIdx !== avatarIdx) {
        ref.lastAvatarIdx = avatarIdx;
        ref.avatar.src = getAvatarDataUrl(avatarIdx, 1);
      }
      ref.avatar.style.borderColor = isLocal ? '#ffd166' : color;
      ref.name.textContent = rider.name;
      ref.dist.textContent = distStr;

      if (kos > 0) {
        ref.ko.classList.remove('is-hidden');
        ref.koVal.textContent = String(kos);
      } else {
        ref.ko.classList.add('is-hidden');
      }
    }
  }

  private updateRadar(local: RiderRenderState, allRiders: RiderRenderState[]): void {
    // Position local rider horizontally within lane bounds (-9..+9m -> 22%..78%)
    const localLeft = Math.round(50 + Math.max(-1, Math.min(1, local.x / 9)) * 28);
    if (localLeft !== this.lastLocalRadarLeft) {
      this.lastLocalRadarLeft = localLeft;
      this.radarLocalEl.style.left = `${localLeft}%`;
    }

    let dotIdx = 0;
    let closestRival: RiderRenderState | null = null;
    let closestAbsDs = Infinity;
    let closestDs = 0;

    for (let i = 0; i < allRiders.length; i++) {
      const r = allRiders[i];
      if (r.isLocal || r.id === local.id) continue;

      const ds = r.s - local.s;
      const absDs = Math.abs(ds);

      if (absDs < closestAbsDs) {
        closestAbsDs = absDs;
        closestRival = r;
        closestDs = ds;
      }

      if (dotIdx >= RADAR_POOL || absDs > 140) continue;

      const clamped = absDs > RADAR_RANGE_M;
      const dsClamped = Math.max(-RADAR_RANGE_M, Math.min(RADAR_RANGE_M, ds));
      // 0m -> 50%, +40m -> 6%, -40m -> 94%
      const topPct = Math.round(50 - (dsClamped / RADAR_RANGE_M) * 44);
      const leftPct = Math.round(50 + Math.max(-1, Math.min(1, r.x / 9)) * 28);
      const color = getRiderColor(r.colorIdx, r.isBot);

      const d = this.radarDots[dotIdx++];
      if (!d.visible) {
        d.visible = true;
        d.el.classList.remove('is-hidden');
      }
      if (d.topPx !== topPct) {
        d.topPx = topPct;
        d.el.style.top = `${topPct}%`;
      }
      if (d.leftPct !== leftPct) {
        d.leftPct = leftPct;
        d.el.style.left = `${leftPct}%`;
      }
      if (d.color !== color) {
        d.color = color;
        d.el.style.backgroundColor = color;
      }
      if (d.clamped !== clamped) {
        d.clamped = clamped;
        d.el.classList.toggle('is-clamped', clamped);
      }
    }

    for (let i = dotIdx; i < RADAR_POOL; i++) {
      const d = this.radarDots[i];
      if (d.visible) {
        d.visible = false;
        d.el.classList.add('is-hidden');
      }
    }

    // Closest rival delta tag
    if (!closestRival) {
      if (this.lastDeltaText !== '') {
        this.lastDeltaText = '';
        this.radarDeltaEl.classList.add('is-hidden');
      }
      return;
    }

    const deltaText = formatDeltaMeters(closestDs);
    const dsClamped = Math.max(-RADAR_RANGE_M, Math.min(RADAR_RANGE_M, closestDs));
    const deltaTop = Math.round(50 - (dsClamped / RADAR_RANGE_M) * 42);
    const rounded = Math.round(closestDs);
    const deltaClass =
      rounded === 0
        ? 'vm-radar-delta is-even'
        : rounded < 0
          ? 'vm-radar-delta is-behind'
          : 'vm-radar-delta';

    if (this.lastDeltaText !== deltaText) {
      this.lastDeltaText = deltaText;
      this.radarDeltaEl.textContent = deltaText;
    }
    if (this.lastDeltaClass !== deltaClass) {
      this.lastDeltaClass = deltaClass;
      this.radarDeltaEl.className = deltaClass;
    }
    if (this.lastDeltaTop !== deltaTop) {
      this.lastDeltaTop = deltaTop;
      this.radarDeltaEl.style.top = `${deltaTop}%`;
    }
  }
}
