import './style.css';
import { RetroAudio } from './audio/RetroAudio';
import { AiRivals } from './game/AiRivals';
import { AnimalCallbacks, AnimalSpecies, AnimalSystem, CrossingAnimal } from './game/AnimalSystem';
import { ItemCallbacks, ItemSystem } from './game/ItemSystem';
import {
  AVATAR_COUNT,
  PIXEL_AVATARS,
  compressCustomAvatarFile,
  isValidCustomAvatarDataUrl,
  setCustomAvatar,
} from './game/PixelAvatars';
import { InputState, ParticleKind, PlayerCallbacks, PlayerPhysics } from './game/PlayerPhysics';
import { getLapNumber, signedTrackDelta } from './game/RoadMath';
import { CarItemEffectKind, TrafficSystem } from './game/TrafficSystem';
import {
  BIKE_PALETTES,
  CombatHitEvent,
  ItemNetEvent,
  ItemType,
  RiderRenderState,
  TrafficCar,
  WeaponType,
} from './game/types';
import { CameraMode, WorldRenderer } from './game/WorldRenderer';
import { WeatherCallbacks, WeatherId, WeatherSystem } from './game/WeatherSystem';
import { t, weatherName } from './i18n';
import { ConnectionStatus, LobbyRoomSummary, MqttSync, PackSpawnTarget, RoomInfoSnapshot } from './net/MqttSync';
import { Hud, TouchInputPatch } from './ui/Hud';
import { ANIMAL_ICON_MAP, WEATHER_ICON_MAP, type PixelIconId } from './ui/PixelIcons';

const STORAGE_NAME_KEY = 'vibemoto_name';
const STORAGE_COLOR_KEY = 'vibemoto_color';
const STORAGE_AVATAR_KEY = 'vibemoto_avatar';
const STORAGE_CUSTOM_AVATAR_KEY = 'vibemoto_custom_avatar';
const HITSTOP_DURATION = 0.042;
const NEARBY_REAL_RANGE_M = 180;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore restricted storage contexts
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore restricted storage contexts
  }
}

function hashIdToColorIdx(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % BIKE_PALETTES.length;
}

function loadOrCreatePlayerName(): string {
  const saved = readStorage(STORAGE_NAME_KEY)?.trim().slice(0, 14);
  if (saved && saved.length > 0) return saved;
  const num = Math.floor(100 + Math.random() * 900);
  const generated = `RIDER_${num}`;
  writeStorage(STORAGE_NAME_KEY, generated);
  return generated;
}

function loadSavedColorIdx(): number | null {
  const raw = readStorage(STORAGE_COLOR_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed % BIKE_PALETTES.length;
}

function loadSavedAvatarIdx(): number | null {
  const raw = readStorage(STORAGE_AVATAR_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed % AVATAR_COUNT;
}

function loadSavedCustomAvatar(): string | null {
  const raw = readStorage(STORAGE_CUSTOM_AVATAR_KEY);
  if (raw && isValidCustomAvatarDataUrl(raw)) {
    return raw;
  }
  return null;
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const hudContainer = document.getElementById('hud') as HTMLElement | null;
if (!canvas || !hudContainer) {
  throw new Error('Missing #game-canvas or #hud root elements');
}

const initialName = loadOrCreatePlayerName();
const savedColor = loadSavedColorIdx();
const savedAvatar = loadSavedAvatarIdx();
const initialCustomAvatar = loadSavedCustomAvatar();

const world = new WorldRenderer(canvas);
const audio = new RetroAudio();
const traffic = new TrafficSystem();
const ai = new AiRivals();
const items = new ItemSystem();
const animals = new AnimalSystem();
const weather = new WeatherSystem('clear');

const GAS_STATION_STOPS = [420, 1620] as const;
let gasRefillCooldown = 0;

const pressedKeys = new Set<string>();
const touchState: {
  left: boolean;
  right: boolean;
  brake: boolean;
  nitro: boolean;
  wheelie: boolean;
  attackLeft: boolean;
  attackRight: boolean;
  attackAuto: boolean;
  analogSteer: number | null;
} = {
  left: false,
  right: false,
  brake: false,
  nitro: false,
  wheelie: false,
  attackLeft: false,
  attackRight: false,
  attackAuto: false,
  analogSteer: null,
};
let touchModeActive =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

const inputState: InputState = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  analogSteer: 0,
  nitro: false,
  wheelie: false,
  attackLeft: false,
  attackRight: false,
  attackAuto: false,
};

let gyroSteer: number | null = null;
let lastLap = 1;

// Reusable frame arrays (zero per-frame allocations)
const combatTargets: RiderRenderState[] = [];
const allRiders: RiderRenderState[] = [];

let hitstopTimer = 0;
let lastOnlineCount = 1;
let lastConnStatus: ConnectionStatus = 'connecting';

// Forward declarations wired cleanly before mqtt.connect()
let player!: PlayerPhysics;
let hud!: Hud;
let itemCallbacks!: ItemCallbacks;

function spawnPackWarpFx(target: PackSpawnTarget): void {
  player.spawnAt(target.s, target.x, target.speed);
  lastLap = getLapNumber(player.state.s);
  audio.playSpawnChime();
  world.spawnParticles(
    target.s,
    target.x,
    0.85,
    24,
    0x00f5d4,
    8.0,
    0.18,
    0.55,
    6,
    target.speed * 0.45
  );
  hud.showToast(t('packSpawn', { name: target.targetName }), 'cyan', 'bolt');
}

const mqtt = new MqttSync(
  initialName,
  savedColor ?? 0,
  savedAvatar ?? 0,
  {
    onStatus(status: ConnectionStatus) {
      lastConnStatus = status;
      lastOnlineCount = mqtt.getOnlineCount();
      hud.setConnectionStatus(status, lastOnlineCount);
    },
    onInitialPackSpawn(target: PackSpawnTarget) {
      spawnPackWarpFx(target);
    },
    onIncomingHit(ev: CombatHitEvent) {
      if (ev.to !== mqtt.clientId) return;
      const causedKo = player.applyExternalHit(ev.dmg, ev.knockX, ev.ko);
      const isKo = causedKo || ev.ko;

      hitstopTimer = Math.max(hitstopTimer, HITSTOP_DURATION);
      audio.playHit(ev.weapon, isKo);
      if (isKo) {
        audio.playCrash();
      }
      world.triggerShake(isKo ? 0.65 : 0.36, isKo ? 0.38 : 0.22);
      world.spawnParticles(
        player.state.s,
        player.state.x,
        0.95,
        isKo ? 20 : 12,
        isKo ? 0xff2a54 : 0xffd166,
        9.0,
        0.18,
        0.48,
        14,
        player.state.speed * 0.35
      );
      world.spawnHitPopup(
        isKo ? 'KO' : ev.weapon === 1 ? 'BONK' : ev.weapon === 2 ? 'SMACK' : 'POW',
        player.state.s,
        player.state.x,
        1.75
      );
      hud.showToast(
        isKo ? t('koBy', { name: ev.fromName }) : t('hitBy', { name: ev.fromName }),
        'red',
        isKo ? 'skull' : 'blast'
      );
    },
    onItemEvent(ev: ItemNetEvent) {
      items.handleNetEvent(ev, player.state, itemCallbacks);
    },
    onRemoteCustomAvatar(peerId: string, dataUrl: string | null) {
      setCustomAvatar(peerId, dataUrl);
    },
    onPeerEvent(msg: string) {
      hud.showToast(msg, 'cyan', 'globe');
    },
    onRoomPasswordRequired(roomSlug: string, reason?: 'password_required' | 'wrong_password') {
      clearHeldInputs();
      hud.setRoomInfo(roomSlug, true);
      hud.openHomeModal(
        roomSlug,
        t(reason === 'wrong_password' ? 'wrongPassword' : 'passwordRequired'),
        true
      );
    },
    onRoomInfoChange(info: RoomInfoSnapshot) {
      hud.setRoomInfo(info.room, info.locked, info.title, info.isHost);
      if (hud.isHomeAuthLocked()) {
        hud.closeHomeModal(true);
      }
    },
    onLobbyRoomsChange(rooms: LobbyRoomSummary[]) {
      hud.setLobbyRooms(rooms);
    },
  },
  initialCustomAvatar
);

const colorIdx = savedColor ?? hashIdToColorIdx(mqtt.clientId);
if (savedColor === null) {
  writeStorage(STORAGE_COLOR_KEY, String(colorIdx));
  mqtt.setColor(colorIdx);
}

const initialAvatar = savedAvatar ?? colorIdx % AVATAR_COUNT;
if (savedAvatar === null) {
  writeStorage(STORAGE_AVATAR_KEY, String(initialAvatar));
  mqtt.setAvatar(initialAvatar);
}

if (initialCustomAvatar) {
  setCustomAvatar(mqtt.clientId, initialCustomAvatar);
}

player = new PlayerPhysics(mqtt.clientId, initialName, colorIdx, initialAvatar);

function isUiBlockingGameplay(): boolean {
  return hud.isEditingName() || hud.isHomeModalOpen();
}

function updateRoomUrlParam(roomSlug: string): void {
  try {
    const url = new URL(window.location.href);
    if (roomSlug === 'global') {
      url.searchParams.delete('room');
    } else {
      url.searchParams.set('room', roomSlug);
    }
    url.searchParams.delete('pwd');
    url.searchParams.delete('password');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Ignore restricted history contexts
  }
}

function copyTextToClipboard(text: string): void {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopyText(text);
    });
    return;
  }
  fallbackCopyText(text);
}

function fallbackCopyText(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    // Ignore restricted clipboard contexts
  }
}

function clearHeldInputs(): void {
  pressedKeys.clear();
  touchState.left = false;
  touchState.right = false;
  touchState.brake = false;
  touchState.nitro = false;
  touchState.wheelie = false;
  touchState.attackLeft = false;
  touchState.attackRight = false;
  touchState.attackAuto = false;
  touchState.analogSteer = null;
  inputState.throttle = false;
  inputState.brake = false;
  inputState.left = false;
  inputState.right = false;
  inputState.analogSteer = 0;
  inputState.nitro = false;
  inputState.wheelie = false;
  inputState.attackLeft = false;
  inputState.attackRight = false;
  inputState.attackAuto = false;
  player.setInput(inputState);
}

function toggleMute(): boolean {
  const nextMuted = !audio.isMuted();
  audio.setMuted(nextMuted);
  hud.setMuted(nextMuted);
  return nextMuted;
}

function togglePixelScale(): number {
  const nextScale = world.pixelScale === 1 ? 2 : 1;
  world.setPixelScale(nextScale);
  hud.setPixelScale(nextScale);
  return nextScale;
}

function cycleCamera(): number {
  world.cameraMode = ((world.cameraMode + 1) % 3) as CameraMode;
  hud.setCameraMode(world.cameraMode);
  return world.cameraMode;
}

function spawnParticlePreset(kind: ParticleKind, s: number, x: number, y: number, vs = 0): void {
  switch (kind) {
    case 'spark':
      world.spawnParticles(s, x, y, 8, 0xffd166, 7.2, 0.14, 0.32, 14, vs);
      break;
    case 'smoke':
      world.spawnParticles(s, x, y, 4, 0xcbd5e1, 2.6, 0.24, 0.45, -2, vs);
      break;
    case 'dust':
      world.spawnParticles(s, x, y, 5, 0xd4a373, 3.6, 0.2, 0.4, 4, vs);
      break;
    case 'nitro':
      world.spawnParticles(s, x, y, 5, 0x38e2d4, 2.2, 0.18, 0.26, 0, vs);
      break;
    case 'water':
      world.spawnParticles(s, x, y, 4, 0xbfe4ff, 4.4, 0.14, 0.28, 12, vs);
      break;
    case 'snow':
      world.spawnParticles(s, x, y, 4, 0xf0f8ff, 3.8, 0.16, 0.34, 8, vs);
      break;
    case 'crash':
      world.spawnParticles(s, x, y, 16, 0xff5d22, 10.0, 0.22, 0.56, 15, vs);
      world.spawnParticles(s, x, y + 0.15, 10, 0xffbe3b, 9.0, 0.16, 0.42, 14, vs);
      break;
  }
}

const weatherCallbacks: WeatherCallbacks = {
  onWeatherChange(next: WeatherId, manual: boolean) {
    hud.setWeather(next);
    const accent = next === 'storm' || next === 'fog' || next === 'snow' ? 'cyan' : 'gold';
    const icon = WEATHER_ICON_MAP[next];
    const label = weatherName(next);
    hud.showToast(label, accent, icon);
    if (!manual) {
      hud.pushBroadcast(label, accent, icon);
    }
  },
  onThunder(intensity: number) {
    audio.playThunder(intensity);
    world.triggerShake(0.14 * intensity, 0.16);
  },
};

hud = new Hud(hudContainer, initialName, colorIdx, initialAvatar, {
  onNameChange(name: string) {
    writeStorage(STORAGE_NAME_KEY, name);
    player.state.name = name;
    mqtt.setName(name);
  },
  onAvatarChange(avatarIdx: number) {
    const safeIdx = ((Math.trunc(avatarIdx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
    writeStorage(STORAGE_AVATAR_KEY, String(safeIdx));
    removeStorage(STORAGE_CUSTOM_AVATAR_KEY);
    setCustomAvatar(mqtt.clientId, null);
    mqtt.setCustomAvatar(null);
    player.state.avatarIdx = safeIdx;
    mqtt.setAvatar(safeIdx);
    hud.refreshLocalAvatar();
    const meta = PIXEL_AVATARS[safeIdx];
    if (meta) {
      hud.showToast(meta.name, 'gold');
    }
  },
  onCustomAvatarUpload(file: File) {
    audio.unlock();
    compressCustomAvatarFile(file)
      .then((dataUrl) => {
        writeStorage(STORAGE_CUSTOM_AVATAR_KEY, dataUrl);
        setCustomAvatar(mqtt.clientId, dataUrl);
        mqtt.setCustomAvatar(dataUrl);
        hud.refreshLocalAvatar();
        hud.showToast(t('avatarSynced'), 'cyan', 'upload');
      })
      .catch(() => {
        hud.showToast(t('avatarFailed'), 'red', 'warning');
      });
  },
  onClearCustomAvatar() {
    removeStorage(STORAGE_CUSTOM_AVATAR_KEY);
    setCustomAvatar(mqtt.clientId, null);
    mqtt.setCustomAvatar(null);
    hud.refreshLocalAvatar();
    hud.showToast(t('avatarReset'), 'gold', 'reset');
  },
  onUseItem(slotIndex = 0) {
    audio.unlock();
    items.useHeldItem(player.state, combatTargets, itemCallbacks, slotIndex);
  },
  onSelectSniperTarget(targetId: string) {
    audio.unlock();
    items.selectSniperTarget(targetId, player.state, combatTargets, itemCallbacks);
  },
  onCancelSniper() {
    items.cancelSniper();
  },
  onEditingName(editing: boolean) {
    if (editing) {
      clearHeldInputs();
    }
  },
  onToggleMute() {
    audio.unlock();
    return toggleMute();
  },
  onTogglePixelScale() {
    return togglePixelScale();
  },
  onCycleCamera() {
    return cycleCamera();
  },
  onCycleWeather() {
    audio.unlock();
    return weather.cycleWeather(weatherCallbacks);
  },
  onSelectWeapon(w: WeaponType) {
    audio.unlock();
    player.cycleWeapon(w);
  },
  onRegroupPack() {
    audio.unlock();
    const target = mqtt.computeSpawnBehindLastPlayer();
    if (target) {
      spawnPackWarpFx(target);
    } else {
      hud.showToast(t('regroupNone'), 'gold', 'regroup');
    }
  },
  onGyroSteer(steer: number | null) {
    gyroSteer = steer;
  },
  onRoomModalToggle(open: boolean) {
    if (open) {
      clearHeldInputs();
    }
    mqtt.setLobbyBrowsing(open);
  },
  onRenameRoom(title: string) {
    if (mqtt.setRoomTitle(title)) {
      hud.showToast(t('roomRenamed', { title: mqtt.roomTitle }), 'gold', 'edit');
    }
  },
  onRefreshLobbyRooms() {
    mqtt.refreshLobbyRooms();
  },
  async onJoinRoom(room: string, password: string) {
    audio.unlock();
    hud.setHomeBusy(true);
    hud.setHomeError(null);
    try {
      const res = await mqtt.joinRoom(room, password);
      hud.setHomeBusy(false);
      if (!res.ok) {
        const errKey =
          res.error === 'password_required'
            ? 'passwordRequired'
            : res.error === 'wrong_password'
              ? 'wrongPassword'
              : 'invalidRoom';
        hud.setHomeError(t(errKey));
        return;
      }
      updateRoomUrlParam(res.room);
      const roomInfo = mqtt.getRoomInfo();
      hud.setRoomInfo(roomInfo.room, roomInfo.locked, roomInfo.title, roomInfo.isHost);
      hud.closeHomeModal(true);
      items.resetActiveEffects();
      player.state.incomingLockName = null;
      animals.reset();
      audio.playSpawnChime();
      const displayLabel = res.room === 'global' ? t('publicHall') : res.room;
      hud.showToast(
        t(res.created ? 'roomCreated' : 'roomJoined', { room: displayLabel }),
        'cyan',
        res.locked ? 'lock' : 'door'
      );
    } catch {
      hud.setHomeBusy(false);
      hud.setHomeError(t('invalidRoom'));
    }
  },
  onCopyRoomLink() {
    const roomSlug = mqtt.displayRoom;
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    let shareUrl = baseUrl;
    if (roomSlug !== 'global') {
      const params = new URLSearchParams();
      params.set('room', roomSlug);
      if (mqtt.isRoomLocked && mqtt.roomPassword) {
        params.set('pwd', mqtt.roomPassword);
      }
      shareUrl = `${baseUrl}?${params.toString()}`;
    }
    copyTextToClipboard(shareUrl);
    hud.showToast(t('linkCopied'), 'gold', 'copy');
  },
  onTouchInput(patch: TouchInputPatch) {
    audio.unlock();
    touchModeActive = true;
    if (patch.left !== undefined) touchState.left = patch.left;
    if (patch.right !== undefined) touchState.right = patch.right;
    if (patch.brake !== undefined) touchState.brake = patch.brake;
    if (patch.nitro !== undefined) touchState.nitro = patch.nitro;
    if (patch.wheelie !== undefined) touchState.wheelie = patch.wheelie;
    if ('analogSteer' in patch) {
      touchState.analogSteer = patch.analogSteer ?? null;
    }
    if (patch.attackLeft !== undefined) {
      if (patch.attackLeft && !touchState.attackLeft && !isUiBlockingGameplay()) {
        player.triggerAttack(1, combatTargets);
        hud.flashTapAttack('left');
      }
      touchState.attackLeft = patch.attackLeft;
    }
    if (patch.attackRight !== undefined) {
      if (patch.attackRight && !touchState.attackRight && !isUiBlockingGameplay()) {
        player.triggerAttack(2, combatTargets);
        hud.flashTapAttack('right');
      }
      touchState.attackRight = patch.attackRight;
    }
    if (patch.attackAuto !== undefined) {
      if (patch.attackAuto && !isUiBlockingGameplay()) {
        player.triggerAttack(0, combatTargets);
        hud.flashTapAttack(player.state.attackSide === 1 ? 'left' : 'right');
      }
      // One-shot center tap strike; reset cleanly so it never repeats unintentionally
      touchState.attackAuto = false;
    }
  },
});

const initialRoomInfo = mqtt.getRoomInfo();
hud.setRoomInfo(
  initialRoomInfo.room,
  initialRoomInfo.locked,
  initialRoomInfo.title,
  initialRoomInfo.isHost
);

itemCallbacks = {
  onBroadcast(text, accent = 'gold', icon?: PixelIconId) {
    hud.pushBroadcast(text, accent, icon);
  },
  onToast(text, accent = 'gold', icon?: PixelIconId) {
    hud.showToast(text, accent, icon);
  },
  onPublishNetEvent(ev) {
    mqtt.publishItemEvent(ev);
  },
  onHitRival(target, _item: ItemType, dmg, knockX, ko, spinOut) {
    hitstopTimer = Math.max(hitstopTimer, HITSTOP_DURATION);
    if (target.isBot) {
      const botKo = spinOut
        ? ai.applySpinOut(target.id, 1.3, dmg)
        : ai.applyHit(target.id, dmg, knockX);
      if (ko || botKo) {
        player.state.kos += 1;
        player.state.nitro = Math.min(100, player.state.nitro + 32);
      }
    } else if (ko) {
      player.state.kos += 1;
      player.state.nitro = Math.min(100, player.state.nitro + 32);
    }
  },
  onPoliceDragRival(target, dt, shoveX) {
    if (target.isBot) {
      ai.applyPoliceDrag(target.id, dt, shoveX);
    }
  },
  onAffectTraffic(car: TrafficCar, kind: CarItemEffectKind, dirX: number) {
    const res = traffic.applyItemEffectToCar(car.id, kind, dirX);
    if (!res.hit) return;
    if (res.isTruck) {
      if (kind === 'banana') {
        audio.playBananaSlip();
      } else if (kind === 'blast' || kind === 'trap' || kind === 'sniper') {
        audio.playTruckCrash();
      }
      world.triggerShake(kind === 'blast' ? 0.45 : 0.25, 0.22);
    }
    if (res.broadcastKey) {
      const accent = kind === 'banana' ? 'gold' : 'red';
      const icon: PixelIconId =
        kind === 'banana'
          ? 'item_banana'
          : kind === 'trap' || kind === 'sniper'
            ? 'item_trap'
            : kind === 'police'
              ? 'item_police'
              : kind === 'magnet'
                ? 'item_magnet'
                : 'blast';
      const msg = t(res.broadcastKey);
      hud.pushBroadcast(msg, accent, icon);
      hud.showToast(msg, accent, icon);
    }
  },
  onLocalDamage(dmg, knockX, ko, sourceLabel, popup, icon?: PixelIconId) {
    const causedKo = player.applyExternalHit(dmg, knockX, ko);
    const isKo = causedKo || (ko && player.state.crashed);
    hitstopTimer = Math.max(hitstopTimer, HITSTOP_DURATION);
    if (isKo) {
      audio.playCrash();
    }
    world.triggerShake(isKo ? 0.68 : 0.36, isKo ? 0.38 : 0.22);
    spawnParticlePreset('crash', player.state.s, player.state.x, 0.9, player.state.speed * 0.35);
    world.spawnHitPopup(popup, player.state.s, player.state.x, 1.75);
    hud.showToast(
      isKo ? t('koBy', { name: sourceLabel }) : t('hitBy', { name: sourceLabel }),
      'red',
      isKo ? 'skull' : (icon ?? 'blast')
    );
  },
  onLocalSpinOut(duration, dmg, sourceLabel) {
    const causedKo = player.applySpinOut(duration, dmg);
    world.triggerShake(0.32, 0.24);
    world.spawnHitPopup(causedKo ? 'KO' : 'SLIP', player.state.s, player.state.x, 1.7);
    hud.showToast(t('hitBy', { name: sourceLabel }), 'gold', 'item_banana');
    if (causedKo) {
      audio.playCrash();
    }
  },
  onLocalPoliceDrag(dt, shoveX) {
    player.applyPoliceDrag(dt, shoveX);
  },
  onLocalActivateTurbo(duration) {
    player.activateTurboShield(duration);
  },
  onLocalActivateMagnet(duration) {
    player.activateMagnet(duration);
  },
  onSfx(kind) {
    switch (kind) {
      case 'pickup':
        audio.playPickup();
        break;
      case 'explosion':
        audio.playExplosion();
        break;
      case 'sniperLock':
        audio.playSniperLock();
        break;
      case 'sniperShot':
        audio.playSniperShot();
        break;
      case 'siren':
        audio.playSiren();
        break;
      case 'bananaSlip':
        audio.playBananaSlip();
        break;
      case 'jet':
        audio.playJetFlyby();
        break;
      case 'boost':
        audio.playBoost();
        break;
    }
  },
  onParticles: spawnParticlePreset,
  onPopup(kind, s, x, y) {
    world.spawnHitPopup(kind, s, x, y);
  },
  onShake(intensity, duration = 0.24) {
    world.triggerShake(intensity, duration);
  },
};

const playerCallbacks: PlayerCallbacks = {
  onAttackSwing(_side: 1 | 2, _weapon: WeaponType) {
    audio.playSwing();
  },
  onHitLanded(
    target: RiderRenderState,
    dmg: number,
    side: 1 | 2,
    weapon: WeaponType,
    knockX: number,
    ko: boolean
  ) {
    hitstopTimer = Math.max(hitstopTimer, HITSTOP_DURATION);

    let confirmedKo = ko;
    if (target.isBot) {
      const botKo = ai.applyHit(target.id, dmg, knockX);
      confirmedKo = ko || botKo;
    } else {
      mqtt.publishHit({
        to: target.id,
        dmg,
        side,
        weapon,
        knockX,
        ko,
        s: target.s,
        x: target.x,
      });
    }

    audio.playHit(weapon, confirmedKo);
    world.triggerShake(confirmedKo ? 0.56 : 0.28, confirmedKo ? 0.32 : 0.18);

    const popupKind = confirmedKo
      ? 'KO'
      : weapon === 1
        ? 'BONK'
        : weapon === 2
          ? 'SMACK'
          : 'POW';
    world.spawnHitPopup(popupKind, target.s, target.x, target.y + 1.65);

    if (confirmedKo) {
      world.spawnParticles(
        target.s,
        target.x,
        0.9,
        20,
        0xff2a54,
        9.5,
        0.2,
        0.55,
        14,
        target.speed * 0.4
      );
      hud.showToast(t('koTarget', { name: target.name }), 'gold', 'skull');
    }
  },
  onWheelieSlam(charge: number, hitsCount: number) {
    audio.playWheelieSlam();
    world.triggerShake(0.28 + charge * 0.32, 0.22);
    if (hitsCount > 0) {
      world.spawnHitPopup('SLAM', player.state.s + 1.0, player.state.x, 1.65);
    }
  },
  onWheelieSlamHit(target: RiderRenderState, dmg: number, knockX: number, ko: boolean) {
    hitstopTimer = Math.max(hitstopTimer, HITSTOP_DURATION);
    let confirmedKo = ko;
    if (target.isBot) {
      const botKo = ai.applyHit(target.id, dmg, knockX);
      confirmedKo = ko || botKo;
    } else {
      mqtt.publishHit({
        to: target.id,
        dmg,
        side: knockX < 0 ? 1 : 2,
        weapon: 1,
        knockX,
        ko,
        s: target.s,
        x: target.x,
      });
    }
    audio.playHit(1, confirmedKo);
    world.spawnHitPopup(confirmedKo ? 'KO' : 'SLAM', target.s, target.x, target.y + 1.75);
    hud.pushBroadcast(
      t('wheelieSlamFeed', { name: player.state.name, target: target.name }),
      confirmedKo ? 'red' : 'gold',
      'bike'
    );
    if (confirmedKo) {
      hud.showToast(t('koTarget', { name: target.name }), 'gold', 'skull');
    }
  },
  onWheelieFlip() {
    world.spawnHitPopup('FLIP', player.state.s, player.state.x, 1.85);
    hud.showToast(t('wipeout'), 'red', 'blast');
    hud.pushBroadcast(t('wheelieFlipFeed', { name: player.state.name }), 'red', 'blast');
  },
  onBoostPad() {
    audio.playBoost();
    world.triggerShake(0.22, 0.22);
    world.spawnHitPopup('BOOST', player.state.s + 1.2, player.state.x, 1.55);
    hud.showToast(t('boostPad'), 'cyan', 'bolt');
  },
  onNearMiss() {
    audio.playHorn();
    world.spawnParticles(
      player.state.s,
      player.state.x,
      0.7,
      8,
      0x00f5d4,
      5.5,
      0.14,
      0.34,
      6,
      player.state.speed * 0.4
    );
    hud.showToast(t('nearMiss'), 'cyan', 'bolt');
  },
  onCrash() {
    audio.playCrash();
    world.triggerShake(0.66, 0.4);
    hud.showToast(t('wipeout'), 'red', 'warning');
  },
  onParticles: spawnParticlePreset,
};

ai.setOnDeliveryEnrage((riderName, role) => {
  audio.playRageRoar();
  world.triggerShake(0.36, 0.26);
  const line =
    role === 'meituan'
      ? t('meituanRageFeed', { name: riderName })
      : t('elemeRageFeed', { name: riderName });
  hud.pushBroadcast(line, 'red', 'flame');
  hud.showToast(t('rageHunt', { name: riderName }), 'red', 'flame');
});

const animalCallbacks: AnimalCallbacks = {
  onWarn(text: string, species: AnimalSpecies) {
    audio.playAnimalSound(species);
    const icon = ANIMAL_ICON_MAP[species];
    hud.pushBroadcast(text, 'gold', icon);
    hud.showToast(text, 'gold', icon);
  },
  onPlayerHit(species: AnimalSpecies, x: number) {
    audio.playAnimalSound(species);
    const knockDir = player.state.x >= x ? 1 : -1;
    const causedKo = player.applyExternalHit(24, knockDir * 11, false);
    if (causedKo) {
      audio.playCrash();
    }
    world.triggerShake(causedKo ? 0.62 : 0.42, 0.28);
    spawnParticlePreset('crash', player.state.s, player.state.x, 0.7, player.state.speed * 0.35);
    world.spawnHitPopup(causedKo ? 'KO' : 'BONK', player.state.s, player.state.x, 1.7);
    hud.showToast(t('animalHit'), 'red', ANIMAL_ICON_MAP[species]);
  },
  onAnimalDodged(species: AnimalSpecies) {
    player.state.nitro = Math.min(100, player.state.nitro + 12);
    audio.playAnimalSound(species);
    hud.showToast(t('animalDodge'), 'cyan', ANIMAL_ICON_MAP[species]);
  },
};

function handleBotHitPlayer(dmg: number, knockX: number, botName: string): void {
  const causedKo = player.applyExternalHit(dmg, knockX, false);
  hitstopTimer = Math.max(hitstopTimer, 0.036);
  audio.playHit(0, causedKo);
  if (causedKo) {
    audio.playCrash();
  }
  world.triggerShake(causedKo ? 0.65 : 0.32, causedKo ? 0.38 : 0.2);
  world.spawnParticles(
    player.state.s,
    player.state.x,
    0.9,
    causedKo ? 18 : 10,
    causedKo ? 0xff2a54 : 0xffd166,
    8.5,
    0.18,
    0.45,
    14,
    player.state.speed * 0.35
  );
  world.spawnHitPopup(causedKo ? 'KO' : 'SMACK', player.state.s, player.state.x, 1.7);
  hud.showToast(
    causedKo ? t('koBy', { name: botName }) : t('hitBy', { name: botName }),
    'red',
    causedKo ? 'skull' : 'warning'
  );
}

// Unlock Web Audio safely on first user gesture
function unlockAudioOnce(): void {
  audio.unlock();
}
window.addEventListener('pointerdown', unlockAudioOnce, { passive: true });
window.addEventListener('keydown', unlockAudioOnce, { passive: true });

// Prevent browser scroll/focus jumps on arcade control keys
const PREVENT_DEFAULT_CODES = new Set([
  'Space',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (isUiBlockingGameplay()) return;

  if (PREVENT_DEFAULT_CODES.has(e.code)) {
    e.preventDefault();
  }

  pressedKeys.add(e.code);
  if (e.repeat) return;

  // Sniper target selection shortcuts (1..5 pick target, Escape cancels)
  if (items.isSniperSelecting()) {
    if (e.code === 'Escape') {
      items.cancelSniper();
      return;
    }
    if (e.code >= 'Digit1' && e.code <= 'Digit5') {
      const idx = Number.parseInt(e.code.slice(5), 10) - 1;
      items.selectSniperTargetByIndex(idx, player.state, combatTargets, itemCallbacks);
      return;
    }
  }

  switch (e.code) {
    case 'KeyR':
    case 'KeyX':
      items.useHeldItem(player.state, combatTargets, itemCallbacks, 0);
      break;
    case 'Digit1':
      player.cycleWeapon(0);
      break;
    case 'Digit2':
      player.cycleWeapon(1);
      break;
    case 'Digit3':
      player.cycleWeapon(2);
      break;
    case 'Tab':
      player.cycleWeapon();
      break;
    case 'KeyC': {
      const mode = cycleCamera();
      const labels = [t('camChase'), t('camLow'), t('camHood')];
      hud.showToast(labels[mode], 'gold');
      break;
    }
    case 'KeyM': {
      const muted = toggleMute();
      hud.showToast(muted ? 'OFF' : 'ON', 'gold', muted ? 'soundOff' : 'soundOn');
      break;
    }
    case 'KeyP': {
      const scale = togglePixelScale();
      hud.showToast(scale === 2 ? t('pixelMode') : t('hdMode'), 'gold');
      break;
    }
    case 'KeyV': {
      audio.unlock();
      weather.cycleWeather(weatherCallbacks);
      break;
    }
  }
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  pressedKeys.delete(e.code);
});

window.addEventListener('blur', () => {
  clearHeldInputs();
});

// Canvas melee combat: desktop mouse (L/R click) + mobile tap-screen-to-attack (42% L / 16% Auto / 42% R)
canvas.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();
});

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.target !== canvas || isUiBlockingGameplay()) return;
  audio.unlock();
  if (e.pointerType === 'touch') {
    touchModeActive = true;
    const fracX = e.clientX / Math.max(1, window.innerWidth);
    if (fracX < 0.42) {
      player.triggerAttack(1, combatTargets);
      hud.flashTapAttack('left');
    } else if (fracX > 0.58) {
      player.triggerAttack(2, combatTargets);
      hud.flashTapAttack('right');
    } else {
      player.triggerAttack(0, combatTargets);
      hud.flashTapAttack(player.state.attackSide === 1 ? 'left' : 'right');
    }
    return;
  }

  if (e.button === 0) {
    player.triggerAttack(1, combatTargets);
    hud.flashTapAttack('left');
  } else if (e.button === 2) {
    player.triggerAttack(2, combatTargets);
    hud.flashTapAttack('right');
  }
});

let orientResizeTimer: number | null = null;
function handleViewportResize(): void {
  world.resize();
  syncPerfViewportMetrics();
}

window.addEventListener('resize', handleViewportResize);
window.visualViewport?.addEventListener('resize', handleViewportResize);
window.addEventListener('orientationchange', () => {
  handleViewportResize();
  if (orientResizeTimer !== null) {
    window.clearTimeout(orientResizeTimer);
  }
  orientResizeTimer = window.setTimeout(() => {
    orientResizeTimer = null;
    handleViewportResize();
  }, 150);
});

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    handleViewportResize();
  });
  ro.observe(canvas);
}

function syncInputState(): void {
  if (isUiBlockingGameplay()) {
    inputState.throttle = false;
    inputState.brake = false;
    inputState.left = false;
    inputState.right = false;
    inputState.analogSteer = 0;
    inputState.nitro = false;
    inputState.wheelie = false;
    inputState.attackLeft = false;
    inputState.attackRight = false;
    inputState.attackAuto = false;
    player.setInput(inputState);
    return;
  }

  const keyBrake = pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown');
  const brake = keyBrake || touchState.brake;
  const keyThrottle = pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp');

  // Auto-throttle on touch devices unless braking
  inputState.throttle = keyThrottle || (touchModeActive && !brake);
  inputState.brake = brake;
  inputState.left = pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft') || touchState.left;
  inputState.right = pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight') || touchState.right;
  inputState.analogSteer = touchState.analogSteer !== null ? touchState.analogSteer : (gyroSteer ?? 0);
  inputState.nitro =
    pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') || touchState.nitro;
  inputState.wheelie = pressedKeys.has('Space') || touchState.wheelie;
  inputState.attackLeft =
    pressedKeys.has('KeyJ') ||
    pressedKeys.has('KeyQ') ||
    pressedKeys.has('KeyZ') ||
    touchState.attackLeft;
  inputState.attackRight =
    pressedKeys.has('KeyK') || pressedKeys.has('KeyE') || touchState.attackRight;
  inputState.attackAuto = pressedKeys.has('KeyL') || pressedKeys.has('KeyF') || touchState.attackAuto;
  if (touchState.attackAuto) {
    touchState.attackAuto = false;
  }

  player.setInput(inputState);
}

// Connect online immediately & boot render loop with zero blocking UI
mqtt.connect();

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  fps: number;
  qualityTier: number;
  effectiveDpr: number;
  cssW: number;
  cssH: number;
  bufW: number;
  bufH: number;
  camAspect: number;
  aspectDiff: number;
}

const perfSnapshot: PerfSnapshot = {
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  fps: 60,
  qualityTier: 2,
  effectiveDpr: 1,
  cssW: 0,
  cssH: 0,
  bufW: 0,
  bufH: 0,
  camAspect: 1,
  aspectDiff: 0,
};
(window as unknown as { __VMOTO_PERF__?: PerfSnapshot }).__VMOTO_PERF__ = perfSnapshot;
(
  window as unknown as {
    __VMOTO_WEATHER__?: {
      get: () => WeatherId;
      set: (w: WeatherId) => void;
      cycle: () => WeatherId;
    };
  }
).__VMOTO_WEATHER__ = {
  get: () => weather.getWeather(),
  set: (w: WeatherId) => weather.setWeather(w, true, weatherCallbacks),
  cycle: () => weather.cycleWeather(weatherCallbacks),
};
(
  window as unknown as {
    __VMOTO_AVATAR__?: {
      get: () => number;
      set: (idx: number) => number;
    };
  }
).__VMOTO_AVATAR__ = {
  get: () => player.state.avatarIdx,
  set: (idx: number) => {
    const safe = ((Math.trunc(idx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
    player.state.avatarIdx = safe;
    setCustomAvatar(mqtt.clientId, null);
    mqtt.setAvatar(safe);
    hud.refreshLocalAvatar();
    return safe;
  },
};

function syncPerfViewportMetrics(): void {
  const m = world.getViewportMetrics();
  const p = world.getPerfState();
  perfSnapshot.qualityTier = p.qualityTier;
  perfSnapshot.effectiveDpr = p.effectiveDpr;
  perfSnapshot.cssW = m.cssW;
  perfSnapshot.cssH = m.cssH;
  perfSnapshot.bufW = m.bufW;
  perfSnapshot.bufH = m.bufH;
  perfSnapshot.camAspect = m.camAspect;
  perfSnapshot.aspectDiff = m.aspectDiff;
}
syncPerfViewportMetrics();

let prevPerfMs = performance.now();
let perfWindowStartMs = prevPerfMs;
let perfFrameCount = 0;
let currentTraffic = traffic.update(player.state.s, Date.now() / 1000, 0);
let currentBots: RiderRenderState[] = [];
let currentAnimals: readonly CrossingAnimal[] = [];
let rafId: number | null = null;
let bgHeartbeatId: number | null = null;
let isPageHidden = document.hidden;

function stopBackgroundHeartbeat(): void {
  if (bgHeartbeatId !== null) {
    window.clearInterval(bgHeartbeatId);
    bgHeartbeatId = null;
  }
}

function startBackgroundHeartbeat(): void {
  if (bgHeartbeatId !== null) return;
  bgHeartbeatId = window.setInterval(() => {
    mqtt.tick(player.state, performance.now(), 0.05);
  }, 1000);
}

function scheduleNextFrame(): void {
  if (!isPageHidden && rafId === null) {
    rafId = window.requestAnimationFrame(frame);
  }
}

document.addEventListener('visibilitychange', () => {
  isPageHidden = document.hidden;
  if (isPageHidden) {
    clearHeldInputs();
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    audio.setBackgroundPaused(true);
    startBackgroundHeartbeat();
  } else {
    stopBackgroundHeartbeat();
    audio.setBackgroundPaused(false);
    prevPerfMs = performance.now();
    perfWindowStartMs = prevPerfMs;
    perfFrameCount = 0;
    scheduleNextFrame();
  }
});

function frame(nowPerfMs: number): void {
  rafId = null;
  if (isPageHidden) return;
  scheduleNextFrame();

  const rawDt = (nowPerfMs - prevPerfMs) / 1000;
  prevPerfMs = nowPerfMs;
  const dt = rawDt > 0.05 ? 0.05 : rawDt < 0.0001 ? 0.0001 : rawDt;
  const timeSec = nowPerfMs / 1000;

  syncInputState();

  // 1. Network sync & remote rider interpolation
  mqtt.tick(player.state, nowPerfMs, dt);
  const remoteRiders = mqtt.getRemoteRiders();

  const onlineCount = mqtt.getOnlineCount();
  const status = mqtt.getStatus();
  if (onlineCount !== lastOnlineCount || status !== lastConnStatus) {
    lastOnlineCount = onlineCount;
    lastConnStatus = status;
    hud.setConnectionStatus(status, onlineCount);
  }

  let nearbyRealCount = 0;
  for (let i = 0; i < remoteRiders.length; i++) {
    if (Math.abs(signedTrackDelta(remoteRiders[i].s, player.state.s)) < NEARBY_REAL_RANGE_M) {
      nearbyRealCount++;
    }
  }

  weather.update(dt, weatherCallbacks);

  // 2. Step gameplay simulation (pauses briefly during 42ms melee hitstop)
  if (hitstopTimer > 0) {
    hitstopTimer = Math.max(0, hitstopTimer - dt);
  } else {
    currentTraffic = traffic.update(player.state.s, Date.now() / 1000, dt);
    currentBots = ai.update(
      dt,
      player.state,
      currentTraffic,
      nearbyRealCount,
      handleBotHitPlayer,
      items.visuals.crates
    );

    combatTargets.length = 0;
    for (let i = 0; i < remoteRiders.length; i++) {
      combatTargets.push(remoteRiders[i]);
    }
    for (let i = 0; i < currentBots.length; i++) {
      combatTargets.push(currentBots[i]);
    }

    player.update(
      dt,
      combatTargets,
      currentTraffic,
      playerCallbacks,
      traffic.getFallenCargo(),
      weather.physics
    );

    // Crossing village animals on the Chinese National Highway
    currentAnimals = animals.update(
      dt,
      player.state.s,
      player.state.x,
      player.state.y,
      player.state.speed,
      player.state.crashed,
      player.state.invulnTimer > 0,
      player.state.turboShieldTimer > 0,
      animalCallbacks
    );

    // Chinese Gas Station ("中国加油") drive-by right-shoulder nitro bonus (+25% N2O, 12s cooldown)
    if (gasRefillCooldown > 0) {
      gasRefillCooldown = Math.max(0, gasRefillCooldown - dt);
    } else if (!player.state.crashed && player.state.x > 5.2) {
      for (let i = 0; i < GAS_STATION_STOPS.length; i++) {
        if (Math.abs(signedTrackDelta(GAS_STATION_STOPS[i], player.state.s)) < 12.0) {
          gasRefillCooldown = 12.0;
          player.state.nitro = Math.min(100, player.state.nitro + 25);
          audio.playFuelChime();
          spawnParticlePreset('nitro', player.state.s, player.state.x, 0.7, player.state.speed * 0.4);
          hud.showToast(t('fuelToast'), 'cyan', 'fuel');
          hud.pushBroadcast(t('fuelFeed', { name: player.state.name }), 'cyan', 'fuel');
          break;
        }
      }
    }

    // Detect lap completion across 2400m cyclic circuit
    const curLap = getLapNumber(player.state.s);
    if (curLap > lastLap) {
      lastLap = curLap;
      audio.playSpawnChime();
      const lapLabel = t('lapToast', { lap: curLap });
      hud.showToast(lapLabel, 'gold', 'flag');
      hud.pushBroadcast(`${player.state.name} ${lapLabel}`, 'gold', 'flag');
    }
  }

  // 3. Assemble render list (local + live remote peers + local bots + delivery riders)
  allRiders.length = 0;
  allRiders.push(player.state);
  for (let i = 0; i < remoteRiders.length; i++) {
    allRiders.push(remoteRiders[i]);
  }
  for (let i = 0; i < currentBots.length; i++) {
    allRiders.push(currentBots[i]);
  }

  // 4. Update 8 powerup items, projectiles, bomber jets, sniper scope, hazards & cargo truck reactions
  if (hitstopTimer <= 0) {
    items.update(dt, player.state, combatTargets, allRiders, itemCallbacks, currentTraffic);
  }

  // 5. Engine + weather audio, 3D HD-pixel frame, weather FX & throttled HUD refresh
  audio.updateEngine(
    player.state.speed,
    player.state.nitroActive || player.state.turboShieldTimer > 0,
    player.state.crashed,
    dt
  );
  audio.updateWeatherAmbience(weather.render.ambienceMode, weather.render.ambienceLevel, dt);
  world.renderFrame(
    player.state,
    allRiders,
    currentTraffic,
    dt,
    timeSec,
    items.visuals,
    traffic.getFallenCargo(),
    currentAnimals,
    weather.render
  );
  hud.setWeather(weather.render.current, weather.render.lightningFlash);
  hud.setEnragedWarning(ai.isAnyDeliveryEnraged());
  hud.setSniperState(items.getSniperHudState(), items.getSniperCandidates());
  hud.update(player.state, allRiders, pressedKeys, dt);

  // 6. Lightweight 1Hz read-only perf snapshot for diagnostics
  perfFrameCount++;
  const perfElapsed = nowPerfMs - perfWindowStartMs;
  if (perfElapsed >= 1000) {
    const info = world.renderer.info;
    perfSnapshot.drawCalls = info.render.calls;
    perfSnapshot.triangles = info.render.triangles;
    perfSnapshot.geometries = info.memory.geometries;
    perfSnapshot.textures = info.memory.textures;
    perfSnapshot.fps = Math.round((perfFrameCount * 1000) / perfElapsed);
    syncPerfViewportMetrics();
    perfFrameCount = 0;
    perfWindowStartMs = nowPerfMs;
  }
}

if (isPageHidden) {
  audio.setBackgroundPaused(true);
  startBackgroundHeartbeat();
} else {
  scheduleNextFrame();
}
