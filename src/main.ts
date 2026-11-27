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
import { ConnectionStatus, MqttSync, PackSpawnTarget } from './net/MqttSync';
import { Hud, TouchInputPatch } from './ui/Hud';

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

const GAS_STATION_STOPS = [420, 1620] as const;
let gasRefillCooldown = 0;

const pressedKeys = new Set<string>();
const touchState = {
  left: false,
  right: false,
  brake: false,
  nitro: false,
  wheelie: false,
  attackLeft: false,
  attackRight: false,
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

let gyroSteer = 0;
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
  hud.showToast(`⚡ 5M → ${target.targetName}`, 'cyan');
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
      hud.showToast(isKo ? `K.O. BY ${ev.fromName}!` : `${ev.fromName} HIT!`, 'red');
    },
    onItemEvent(ev: ItemNetEvent) {
      items.handleNetEvent(ev, player.state, itemCallbacks);
    },
    onRemoteCustomAvatar(peerId: string, dataUrl: string | null) {
      setCustomAvatar(peerId, dataUrl);
    },
    onPeerEvent(msg: string) {
      hud.showToast(msg, 'cyan');
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

function clearHeldInputs(): void {
  pressedKeys.clear();
  touchState.left = false;
  touchState.right = false;
  touchState.brake = false;
  touchState.nitro = false;
  touchState.wheelie = false;
  touchState.attackLeft = false;
  touchState.attackRight = false;
  inputState.throttle = false;
  inputState.brake = false;
  inputState.left = false;
  inputState.right = false;
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
      world.spawnParticles(s, x, y, 5, 0x00f5d4, 2.2, 0.18, 0.26, 0, vs);
      break;
    case 'crash':
      world.spawnParticles(s, x, y, 16, 0xff4d00, 10.0, 0.22, 0.56, 15, vs);
      world.spawnParticles(s, x, y + 0.15, 10, 0xffd166, 9.0, 0.16, 0.42, 14, vs);
      break;
  }
}

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
        hud.showToast('📷 自定义头像已同步', 'cyan');
      })
      .catch(() => {
        hud.showToast('头像上传失败', 'red');
      });
  },
  onClearCustomAvatar() {
    removeStorage(STORAGE_CUSTOM_AVATAR_KEY);
    setCustomAvatar(mqtt.clientId, null);
    mqtt.setCustomAvatar(null);
    hud.refreshLocalAvatar();
    hud.showToast('已恢复像素头像', 'gold');
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
  onSelectWeapon(w: WeaponType) {
    audio.unlock();
    player.cycleWeapon(w);
  },
  onRegroupPack() {
    audio.unlock();
    const target = mqtt.computeSpawnBehindLastPlayer();
    if (target) {
      spawnPackWarpFx(target);
    }
  },
  onGyroSteer(steer: number | null) {
    gyroSteer = steer === null ? 0 : steer;
  },
  onTouchInput(patch: TouchInputPatch) {
    audio.unlock();
    touchModeActive = true;
    if (patch.left !== undefined) touchState.left = patch.left;
    if (patch.right !== undefined) touchState.right = patch.right;
    if (patch.brake !== undefined) touchState.brake = patch.brake;
    if (patch.nitro !== undefined) touchState.nitro = patch.nitro;
    if (patch.wheelie !== undefined) touchState.wheelie = patch.wheelie;
    if (patch.attackLeft !== undefined) touchState.attackLeft = patch.attackLeft;
    if (patch.attackRight !== undefined) touchState.attackRight = patch.attackRight;
  },
});

itemCallbacks = {
  onBroadcast(text, accent = 'gold') {
    hud.pushBroadcast(text, accent);
  },
  onToast(text, accent = 'gold') {
    hud.showToast(text, accent);
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
    if (res.broadcastText) {
      const accent = kind === 'banana' ? 'gold' : 'red';
      hud.pushBroadcast(res.broadcastText, accent);
      hud.showToast(res.broadcastText, accent);
    }
  },
  onLocalDamage(dmg, knockX, ko, sourceLabel, popup) {
    const causedKo = player.applyExternalHit(dmg, knockX, ko);
    const isKo = causedKo || (ko && player.state.crashed);
    hitstopTimer = Math.max(hitstopTimer, HITSTOP_DURATION);
    if (isKo) {
      audio.playCrash();
    }
    world.triggerShake(isKo ? 0.68 : 0.36, isKo ? 0.38 : 0.22);
    spawnParticlePreset('crash', player.state.s, player.state.x, 0.9, player.state.speed * 0.35);
    world.spawnHitPopup(popup, player.state.s, player.state.x, 1.75);
    hud.showToast(isKo ? `K.O.! ${sourceLabel}` : `${sourceLabel} 命中!`, 'red');
  },
  onLocalSpinOut(duration, dmg, sourceLabel) {
    const causedKo = player.applySpinOut(duration, dmg);
    world.triggerShake(0.32, 0.24);
    world.spawnHitPopup(causedKo ? 'KO' : 'SLIP', player.state.s, player.state.x, 1.7);
    hud.showToast(`🍌 ${sourceLabel} 打滑!`, 'gold');
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
      hud.showToast(`K.O.! ${target.name}`, 'gold');
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
      `🏍️ ${player.state.name} 翘头猛压击飞了 ${target.name}!`,
      confirmedKo ? 'red' : 'gold'
    );
    if (confirmedKo) {
      hud.showToast(`SLAM K.O.! ${target.name}`, 'gold');
    }
  },
  onWheelieFlip() {
    world.spawnHitPopup('FLIP', player.state.s, player.state.x, 1.85);
    hud.showToast('FLIPPED! 翘头翻车!', 'red');
    hud.pushBroadcast(`💥 ${player.state.name} 翘头过度翻车了!`, 'red');
  },
  onBoostPad() {
    audio.playBoost();
    world.triggerShake(0.22, 0.22);
    world.spawnHitPopup('BOOST', player.state.s + 1.2, player.state.x, 1.55);
    hud.showToast('⚡ BOOST!', 'cyan');
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
    hud.showToast('NEAR MISS +N2O', 'cyan');
  },
  onCrash() {
    audio.playCrash();
    world.triggerShake(0.66, 0.4);
    hud.showToast('WIPEOUT!', 'red');
  },
  onParticles: spawnParticlePreset,
};

ai.setOnDeliveryEnrage((riderName, role) => {
  audio.playRageRoar();
  world.triggerShake(0.36, 0.26);
  const line =
    role === 'meituan'
      ? `💢 ${riderName} 狂暴了！「影响送餐超时扣钱！别想跑！」`
      : `💢 ${riderName} 狂暴了！「外卖洒汤了！给我站住！」`;
  hud.pushBroadcast(line, 'red');
  hud.showToast(`💢 ${riderName} 狂暴追杀!`, 'red');
});

const animalCallbacks: AnimalCallbacks = {
  onWarn(text: string, species: AnimalSpecies) {
    audio.playAnimalSound(species);
    hud.pushBroadcast(text, 'gold');
    hud.showToast(text, 'gold');
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
    hud.showToast(causedKo ? '撞飞翻车!' : '撞到过路动物!', 'red');
  },
  onAnimalDodged(species: AnimalSpecies) {
    player.state.nitro = Math.min(100, player.state.nitro + 12);
    audio.playAnimalSound(species);
    hud.showToast('跃过动物 +12 N2O!', 'cyan');
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
  hud.showToast(causedKo ? `K.O. BY ${botName}!` : `HIT BY ${botName}`, 'red');
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
  if (hud.isEditingName()) return;

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
      const labels = ['CAM: CHASE', 'CAM: LOW', 'CAM: HOOD'];
      hud.showToast(labels[mode], 'gold');
      break;
    }
    case 'KeyM': {
      const muted = toggleMute();
      hud.showToast(muted ? 'AUDIO OFF' : 'AUDIO ON', 'gold');
      break;
    }
    case 'KeyP': {
      const scale = togglePixelScale();
      hud.showToast(scale === 2 ? 'PIXEL MODE' : 'HD MODE', 'gold');
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
  if (hud.isEditingName()) return;
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
  if (hud.isEditingName()) {
    inputState.throttle = false;
    inputState.brake = false;
    inputState.left = false;
    inputState.right = false;
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
  inputState.analogSteer = gyroSteer;
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
  inputState.attackAuto = pressedKeys.has('KeyL') || pressedKeys.has('KeyF');

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
  cssW: 0,
  cssH: 0,
  bufW: 0,
  bufH: 0,
  camAspect: 1,
  aspectDiff: 0,
};
(window as unknown as { __VMOTO_PERF__?: PerfSnapshot }).__VMOTO_PERF__ = perfSnapshot;

function syncPerfViewportMetrics(): void {
  const m = world.getViewportMetrics();
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
      traffic.getFallenCargo()
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
          hud.showToast('⛽ 中国加油 +25% N2O', 'cyan');
          hud.pushBroadcast(`⛽ ${player.state.name} 路过中国加油站，氮气 +25%!`, 'cyan');
          break;
        }
      }
    }

    // Detect lap completion across 2400m cyclic circuit
    const curLap = getLapNumber(player.state.s);
    if (curLap > lastLap) {
      lastLap = curLap;
      audio.playSpawnChime();
      hud.showToast(`🏁 LAP ${curLap}!`, 'gold');
      hud.pushBroadcast(`🏁 ${player.state.name} 进入第 ${curLap} 圈!`, 'gold');
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

  // 5. Engine audio, 3D HD-pixel frame, enraged delivery hunter & sniper HUD, and throttled HUD refresh
  audio.updateEngine(
    player.state.speed,
    player.state.nitroActive || player.state.turboShieldTimer > 0,
    player.state.crashed,
    dt
  );
  world.renderFrame(
    player.state,
    allRiders,
    currentTraffic,
    dt,
    timeSec,
    items.visuals,
    traffic.getFallenCargo(),
    currentAnimals
  );
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
