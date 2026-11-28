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
import {
  SavedCustomAvatar,
  renderSkinPortraitDataUrl,
  setPeerCustomSkin,
} from './game/CustomAvatarSystem';
import { InputState, ParticleKind, PlayerCallbacks, PlayerPhysics } from './game/PlayerPhysics';
import { OnFootController, OnFootInput } from './game/OnFootController';
import { BlueprintManager, SavedBlueprint } from './game/BlueprintSystem';
import { ResourceNodeManager } from './game/ResourceNodes';
import { getLapNumber, openWorldGroundY, roadX, signedTrackDelta } from './game/RoadMath';
import { CarItemEffectKind, TrafficSystem } from './game/TrafficSystem';
import { BLOCK_SPEC_BY_ID, BlockType, VoxelWorld } from './game/VoxelWorld';
import {
  BIKE_PALETTES,
  CombatHitEvent,
  IntruderSiteVisual,
  ItemNetEvent,
  ItemType,
  NamedBuildingVisual,
  RiderRenderState,
  TrafficCar,
  VoxelNetEvent,
  WeaponType,
} from './game/types';
import { CameraMode, WorldRenderer } from './game/WorldRenderer';
import { WeatherCallbacks, WeatherId, WeatherSystem } from './game/WeatherSystem';
import { getLang, itemName, t, weatherName } from './i18n';
import { ConnectionStatus, LobbyRoomSummary, MqttSync, PackSpawnTarget, RoomInfoSnapshot } from './net/MqttSync';
import {
  EconomyState,
  GameAccount,
  IntruderRecord,
  MapMarker,
  MapOnlinePlayer,
  NamedBuilding,
  ServerBlueprint,
  ServerClient,
  createDefaultEconomyState,
  getShieldRemainingSeconds,
} from './net/ServerClient';
import { AiBuildBlock, AiBuilderModal } from './ui/AiBuilderModal';
import { AvatarStudioModal } from './ui/AvatarStudioModal';
import { BlueprintSelectionInfo, EconomyModal, EconomyTab } from './ui/EconomyModal';
import { Hud, TouchInputPatch } from './ui/Hud';
import { ANIMAL_ICON_MAP, WEATHER_ICON_MAP, type PixelIconId } from './ui/PixelIcons';
import { WebSshModal } from './ui/WebSshModal';
import {
  WorldMapBuildingCenter,
  WorldMapModal,
  WorldMapRemotePlayer,
  WorldMapSnapshot,
} from './ui/WorldMapModal';

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
const voxels = new VoxelWorld('global');
const onFoot = new OnFootController();
const resourceNodes = new ResourceNodeManager();
const blueprints = new BlueprintManager();

let economyState: EconomyState = createDefaultEconomyState();
let savedBlueprints: ServerBlueprint[] = [];
let mapMarkers: MapMarker[] = [];
let intruderRecords: IntruderRecord[] = [];
let namedBuildings: NamedBuilding[] = [];
let mapOnlinePlayers: MapOnlinePlayer[] = [];
let savedCustomAvatars: SavedCustomAvatar[] = [];
let activeCustomAvatarId = '';
let offTrackElapsedSec = 0;
let trackInfoHidden = false;
let mapUiRefreshAccum = 0;
let mapNetRefreshAccum = 0;
let intruderSitesBuf: IntruderSiteVisual[] = [];
let namedBuildingsBuf: NamedBuildingVisual[] = [];
let shieldHudTickAccum = 0;
let lastBlockSlowToastMs = 0;
let lastInteractKind: 'none' | 'computer' | 'resource' | 'blueprint' = 'none';
let lastInteractNodeId: string | null = null;
const pendingBuildQueue: { gx: number; gy: number; gz: number; b: BlockType }[] = [];
let buildQueueSfxCounter = 0;

const footTouchState = {
  forward: 0,
  strafe: 0,
  jump: false,
  sprint: false,
};
let pendingLookYaw = 0;
let pendingLookPitch = 0;
let dragLookPointerId: number | null = null;
let dragLookLastX = 0;
let dragLookLastY = 0;
let dragLookMoved = 0;
let dragLookDownMs = 0;
let dragLookButton = -1;
const footInputBuf: OnFootInput = {
  forward: 0,
  strafe: 0,
  jump: false,
  sprint: false,
  lookYawDelta: 0,
  lookPitchDelta: 0,
};

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
let serverClient!: ServerClient;
let webSshModal!: WebSshModal;
let aiBuilderModal!: AiBuilderModal;
let economyModal!: EconomyModal;
let worldMapModal!: WorldMapModal;
let avatarStudioModal!: AvatarStudioModal;

function spawnPackWarpFx(target: PackSpawnTarget): void {
  if (onFoot.state.active) {
    exitPointerLockSafe();
    onFoot.mountBike();
  }
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
    onVoxelEvent(ev: VoxelNetEvent) {
      if (ev.op === 'set' && ev.b && ev.b >= 1 && ev.b <= 10) {
        voxels.setBlock(ev.gx, ev.gy, ev.gz, ev.b as BlockType, true, ev.ownerId, ev.ownerName);
      } else if (ev.op === 'del') {
        voxels.removeBlock(ev.gx, ev.gy, ev.gz);
      }
    },
    onRemoteCustomAvatar(peerId: string, dataUrl: string | null) {
      setCustomAvatar(peerId, dataUrl);
    },
    onRemoteCustomSkin(peerId: string, skin) {
      setPeerCustomSkin(peerId, skin);
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
  return (
    hud.isEditingName() ||
    hud.isHomeModalOpen() ||
    hud.isServerModalOpen() ||
    Boolean(webSshModal?.isOpen()) ||
    Boolean(aiBuilderModal?.isOpen()) ||
    Boolean(economyModal?.isOpen()) ||
    Boolean(worldMapModal?.isOpen()) ||
    Boolean(avatarStudioModal?.isOpen())
  );
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
  footTouchState.forward = 0;
  footTouchState.strafe = 0;
  footTouchState.jump = false;
  footTouchState.sprint = false;
  dragLookPointerId = null;
  pendingLookYaw = 0;
  pendingLookPitch = 0;
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
  if (onFoot.state.active) {
    const mode = onFoot.cycleCameraMode();
    hud.setOnFootCameraMode(mode);
    const key = mode === 0 ? 'camFpOnFoot' : mode === 1 ? 'camTpRearOnFoot' : 'camTpFrontOnFoot';
    hud.showToast(t(key), 'cyan', 'camera');
    return mode;
  }
  world.cameraMode = ((world.cameraMode + 1) % 3) as CameraMode;
  hud.setCameraMode(world.cameraMode);
  return world.cameraMode;
}

function exitPointerLockSafe(): void {
  try {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  } catch {
    // Ignore restricted pointer lock contexts
  }
}

function toggleDismount(): void {
  audio.unlock();
  if (isUiBlockingGameplay()) return;
  if (!onFoot.state.active) {
    const bikePose = player.parkForDismount();
    onFoot.dismountFromBike(bikePose.wx, bikePose.wy, bikePose.ws, bikePose.yaw, voxels);
    hud.setOnFootCameraMode(onFoot.state.cameraMode);
    footTouchState.forward = 0;
    footTouchState.strafe = 0;
    footTouchState.jump = false;
    footTouchState.sprint = false;
    audio.playDismount(true);
    hud.showToast(t('dismountToast'), 'cyan', 'cube');
  } else {
    exitPointerLockSafe();
    const far = onFoot.state.distToBike > 6.0;
    const pose = far ? onFoot.summonBikeNearPlayer(voxels) : onFoot.mountBike();
    if (far) {
      onFoot.mountBike();
    }
    player.remountAt(pose.wx, pose.wy, pose.ws, pose.yaw);
    audio.playDismount(false);
    hud.showToast(far ? t('summonBikeToast') : t('mountToast'), 'gold', 'bike');
  }
}

function returnToTrack(): void {
  audio.unlock();
  if (onFoot.state.active) {
    exitPointerLockSafe();
    onFoot.mountBike();
  }
  player.returnToTrack();
  audio.playSpawnChime();
  hud.showToast(t('backToTrackToast'), 'cyan', 'road');
}

function getBlueprintSelectionInfo(): BlueprintSelectionInfo {
  const b = blueprints.getSelectionBounds();
  return {
    pos1: blueprints.getPos1(),
    pos2: blueprints.getPos2(),
    sizeX: b?.sizeX,
    sizeY: b?.sizeY,
    sizeZ: b?.sizeZ,
    blockCount: b ? (voxels.getBlockCount() > 0 ? countSelectedVoxels(b) : 0) : undefined,
  };
}

function countSelectedVoxels(b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): number {
  let c = 0;
  for (let x = b.minX; x <= b.maxX; x++) {
    for (let y = b.minY; y <= b.maxY; y++) {
      for (let z = b.minZ; z <= b.maxZ; z++) {
        if (voxels.hasBlock(x, y, z)) c++;
      }
    }
  }
  return c;
}

function syncEconomyUi(next: EconomyState): void {
  economyState = next;
  const shieldSec = getShieldRemainingSeconds(next.shieldUntil);
  hud.setEconomyHud(next.coins, shieldSec, next.bagCapacity, next.savedItems.length);
  hud.setInventoryCounts(next.inventory);
  aiBuilderModal?.updateInventory(next.inventory);
  if (economyModal?.isOpen()) {
    economyModal.refreshState(next, player.state.heldItems, savedBlueprints, getBlueprintSelectionInfo());
  }
}

function syncIntruderVisuals(): void {
  hud.setIntruderBadge(intruderRecords.length);
  intruderSitesBuf = intruderRecords.slice(0, 16).map((r) => ({
    id: r.id,
    gx: r.gx,
    gy: r.gy,
    gz: r.gz,
    intruderName: r.intruderName,
    buildingName: r.buildingName,
    liveWx: r.liveWx,
    liveWs: r.liveWs,
    online: r.online,
    createdAt: r.createdAt,
  }));
}

function syncNamedBuildingVisuals(): void {
  namedBuildingsBuf = namedBuildings.slice(0, 24).map((b) => ({
    id: b.id,
    name: b.name,
    ownerName: b.ownerName,
    gx: b.gx,
    gy: b.gy,
    gz: b.gz,
  }));
}

function applyActiveCustomAvatar(av: SavedCustomAvatar | null, broadcast = true): void {
  activeCustomAvatarId = av?.id ?? '';
  setPeerCustomSkin(mqtt.clientId, av ? av.skin : null);
  const portrait = av ? av.portraitDataUrl || renderSkinPortraitDataUrl(av.skin) : loadSavedCustomAvatar();
  setCustomAvatar(mqtt.clientId, portrait);
  if (broadcast) {
    mqtt.setCustomSkin(av ? av.skin : null);
    mqtt.setCustomAvatar(portrait);
  }
  hud.refreshLocalAvatar();
}

function computeMyBuildingCenters(): WorldMapBuildingCenter[] {
  const acc = serverClient.getAccount();
  const ownerId = acc?.id;
  const cells = new Map<string, { sumX: number; sumS: number; count: number }>();
  for (const entry of voxels.values()) {
    if (ownerId && entry.ownerId && entry.ownerId !== ownerId) continue;
    if (ownerId && !entry.ownerId) continue;
    const cx = Math.floor(entry.gx / 20);
    const cz = Math.floor(entry.gz / 20);
    const k = `${cx},${cz}`;
    let cell = cells.get(k);
    if (!cell) {
      cell = { sumX: 0, sumS: 0, count: 0 };
      cells.set(k, cell);
    }
    cell.sumX += entry.gx + 0.5;
    cell.sumS += entry.gz + 0.5;
    cell.count += 1;
  }
  const out: WorldMapBuildingCenter[] = [];
  for (const c of cells.values()) {
    const cx = c.sumX / c.count;
    const cs = c.sumS / c.count;
    const matched = namedBuildings.find(
      (b) => Math.hypot(b.gx + 0.5 - cx, signedTrackDelta(b.gz + 0.5, cs)) <= 18
    );
    out.push({
      wx: cx,
      ws: cs,
      count: c.count,
      label: matched?.name,
    });
  }
  return out;
}

function buildWorldMapSnapshot(remoteRiders: readonly RiderRenderState[]): WorldMapSnapshot {
  const pose = onFoot.state.active
    ? { wx: onFoot.state.wx, wy: onFoot.state.wy, ws: onFoot.state.ws, yaw: onFoot.state.yaw }
    : player.getWorldPose();

  const playerMap = new Map<string, WorldMapRemotePlayer>();
  for (let i = 0; i < remoteRiders.length; i++) {
    const r = remoteRiders[i];
    if (r.isBot || r.isLocal) continue;
    const rWs = r.freeRoam && r.worldS !== undefined ? r.worldS : r.s;
    const rWx = r.freeRoam && r.worldX !== undefined ? r.worldX : roadX(rWs) + r.x;
    playerMap.set(r.id, {
      id: r.id,
      name: r.name,
      wx: rWx,
      wy: r.worldY ?? r.y,
      ws: rWs,
      color: BIKE_PALETTES[Math.abs(r.colorIdx) % BIKE_PALETTES.length]?.primary,
    });
  }
  for (let i = 0; i < mapOnlinePlayers.length; i++) {
    const p = mapOnlinePlayers[i];
    if (p.id === mqtt.clientId) continue;
    if (!playerMap.has(p.id)) {
      playerMap.set(p.id, {
        id: p.id,
        accountId: p.accountId,
        name: p.name,
        wx: p.wx,
        wy: p.wy,
        ws: p.ws,
        onFoot: p.onFoot,
      });
    }
  }

  return {
    playerWx: pose.wx,
    playerWy: pose.wy,
    playerWs: pose.ws,
    playerYaw: pose.yaw,
    remotePlayers: Array.from(playerMap.values()),
    markers: mapMarkers,
    intruders: intruderRecords,
    resourceNodes: resourceNodes.getActiveNodes().map((n) => ({
      id: n.id,
      kind: n.kind,
      name: getLang() === 'zh' ? n.zhName : n.enName,
      wx: n.wx,
      ws: n.ws,
      ready: n.cooldown <= 0,
      color: `#${n.colorHex.toString(16).padStart(6, '0')}`,
    })),
    myBuildingCenters: computeMyBuildingCenters(),
    namedBuildings,
    teleportCards: economyState.teleportCards ?? 0,
  };
}

async function refreshMapAndIntruders(): Promise<void> {
  const [markers, intruders, players, blds] = await Promise.all([
    serverClient.getMapMarkers(),
    serverClient.getIntruderRecords(mqtt.displayRoom),
    serverClient.getMapPlayers(mqtt.displayRoom),
    serverClient.getNamedBuildings(mqtt.displayRoom),
  ]);
  mapMarkers = markers;
  intruderRecords = intruders;
  mapOnlinePlayers = players;
  namedBuildings = blds;
  syncIntruderVisuals();
  syncNamedBuildingVisuals();
  if (worldMapModal?.isOpen()) {
    worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
  }
}

async function teleportPlayerTo(
  wx: number,
  ws: number,
  label: string,
  useCard: boolean
): Promise<void> {
  if (useCard) {
    const res = await serverClient.useTeleportCard();
    if (!res.ok) {
      hud.showToast(res.error || t('teleportNoCard'), 'red', 'teleport');
      worldMapModal.close();
      economyModal.open('shop');
      return;
    }
    if (res.state) syncEconomyUi(res.state);
  }
  if (onFoot.state.active) {
    onFoot.teleportTo(wx, ws, voxels);
  } else {
    player.teleportToWorld(wx, ws, voxels);
  }
  worldMapModal.close();
  audio.playTeleport();
  const s = player.state.s;
  const lat = wx - roadX(s);
  world.spawnParticles(s, lat, 1.0, 22, 0x38e2d4, 7.5, 0.18, 0.5, 6, 0);
  hud.showToast(t('teleportSuccess', { label }), 'cyan', 'teleport');
}

async function refreshEconomyAndBlueprints(): Promise<void> {
  const [eco, bpsRes, markers, intruders, avatarRes, blds] = await Promise.all([
    serverClient.getEconomyState(),
    serverClient.getBlueprints(),
    serverClient.getMapMarkers(),
    serverClient.getIntruderRecords(mqtt.displayRoom),
    serverClient.getCustomAvatars(),
    serverClient.getNamedBuildings(mqtt.displayRoom),
  ]);
  savedBlueprints = bpsRes.blueprints;
  mapMarkers = markers;
  intruderRecords = intruders;
  savedCustomAvatars = avatarRes.avatars;
  activeCustomAvatarId = avatarRes.activeId;
  namedBuildings = blds;
  syncEconomyUi(eco);
  syncIntruderVisuals();
  syncNamedBuildingVisuals();

  const activeAv = savedCustomAvatars.find((a) => a.id === activeCustomAvatarId) ?? null;
  if (activeAv) {
    applyActiveCustomAvatar(activeAv, true);
  }
  if (avatarStudioModal?.isOpen()) {
    avatarStudioModal.refreshSaved(savedCustomAvatars, activeCustomAvatarId);
  }
}

function awardRaceCoins(kind: 'lap' | 'ko' | 'nearmiss' | 'race', amount: number): void {
  void serverClient.claimReward(kind, amount).then((res) => {
    if (res.ok && res.state) {
      syncEconomyUi(res.state);
    }
  });
}

function getBuildOriginForPlayer(): { gx: number; gy: number; gz: number } {
  if (onFoot.state.active && onFoot.state.aimHit) {
    return {
      gx: onFoot.state.aimHit.placeX,
      gy: onFoot.state.aimHit.placeY,
      gz: onFoot.state.aimHit.placeZ,
    };
  }
  const pose = onFoot.state.active
    ? { wx: onFoot.state.wx, wy: onFoot.state.wy, ws: onFoot.state.ws, yaw: onFoot.state.yaw }
    : player.getWorldPose();
  const fwdX = -Math.sin(pose.yaw);
  const fwdS = Math.cos(pose.yaw);
  const tx = pose.wx + fwdX * 4.0;
  const ts = pose.ws + fwdS * 4.0;
  const ty = openWorldGroundY(tx, ts);
  return { gx: Math.floor(tx), gy: Math.floor(ty + 0.05), gz: Math.floor(ts) };
}

function enqueueBlockBuildPlan(
  name: string,
  blocks: readonly { dx: number; dy: number; dz: number; b: number }[],
  origin?: { gx: number; gy: number; gz: number }
): void {
  const base = origin ?? getBuildOriginForPlayer();
  const avail: Record<number, number> = { ...economyState.inventory };
  let queued = 0;
  let skipped = 0;

  for (let i = 0; i < blocks.length; i++) {
    const item = blocks[i];
    const bt = Math.min(10, Math.max(1, Math.trunc(item.b))) as BlockType;
    if ((avail[bt] ?? 0) <= 0) {
      skipped++;
      continue;
    }
    avail[bt] = (avail[bt] ?? 0) - 1;
    pendingBuildQueue.push({
      gx: base.gx + Math.trunc(item.dx),
      gy: base.gy + Math.trunc(item.dy),
      gz: base.gz + Math.trunc(item.dz),
      b: bt,
    });
    queued++;
  }

  if (queued === 0) {
    hud.showToast(t('blockNoStock', { name }), 'red', 'warning');
    return;
  }
  const msg =
    skipped > 0
      ? `${name}: 正在建造 ${queued} 块 (缺 ${skipped} 块)`
      : `${name}: 正在自动建造 ${queued} 块!`;
  hud.showToast(msg, 'cyan', 'sparkle');
}

function stepPendingBuildQueue(): void {
  if (pendingBuildQueue.length === 0) return;
  const perFrame = 4;
  const acc = serverClient.getAccount();
  let placedAny = false;

  for (let n = 0; n < perFrame && pendingBuildQueue.length > 0; n++) {
    const item = pendingBuildQueue.shift()!;
    const stock = economyState.inventory[item.b] ?? 0;
    if (stock <= 0) continue;

    const ok = voxels.setBlock(
      item.gx,
      item.gy,
      item.gz,
      item.b,
      true,
      acc?.id,
      acc?.displayName || player.state.name
    );
    if (!ok) continue;

    placedAny = true;
    const nextEco = serverClient.adjustLocalInventory(item.b, -1);
    economyState = nextEco;
    serverClient.sendVoxel('set', item.gx, item.gy, item.gz, item.b);
    mqtt.publishVoxelEvent({
      op: 'set',
      gx: item.gx,
      gy: item.gy,
      gz: item.gz,
      b: item.b,
      ownerId: acc?.id,
      ownerName: acc?.displayName || player.state.name,
    });

    buildQueueSfxCounter++;
    if (buildQueueSfxCounter % 3 === 1) {
      audio.playBlockPlace();
    }
    const spec = BLOCK_SPEC_BY_ID[item.b];
    const blockS = item.gz + 0.5;
    const blockLat = item.gx + 0.5 - roadX(blockS);
    const blockRelY = Math.max(0.2, item.gy + 0.5 - openWorldGroundY(item.gx + 0.5, blockS));
    world.spawnParticles(blockS, blockLat, blockRelY, 3, spec.particleHex, 2.5, 0.11, 0.22, 8, 0);
  }

  if (placedAny) {
    syncEconomyUi(economyState);
  }
}

function stashCurrentHeldItem(): void {
  audio.unlock();
  if (economyState.bagCapacity <= 0) {
    hud.showToast(t('bagFullToast'), 'gold', 'bag');
    economyModal.open('shop');
    return;
  }
  const list = player.state.heldItems;
  if (!list || list.length === 0) {
    hud.showToast(t('bagEmpty'), 'gold', 'bag');
    return;
  }
  const slot = list[0];
  void serverClient.stashBagItem(slot.type).then((res) => {
    if (!res.ok) {
      hud.showToast(res.error || t('bagFullToast'), 'red', 'warning');
      return;
    }
    list.shift();
    player.state.heldItem = list.length > 0 ? list[0].type : null;
    if (res.state) syncEconomyUi(res.state);
    audio.playPickup();
    hud.showToast(t('bagStashedToast', { item: itemName(slot.type) }), 'cyan', 'bag');
  });
}

function fireBagItem(bagIndex: number): void {
  void serverClient.useBagItem(bagIndex).then((res) => {
    if (!res.ok || !res.item) {
      hud.showToast(res.error || '使用失败', 'red', 'warning');
      return;
    }
    if (res.state) syncEconomyUi(res.state);
    economyModal.close();

    // Support using bagged items both on highway AND on foot at resource nodes!
    const shooter: RiderRenderState = onFoot.state.active
      ? {
          ...player.state,
          s: onFoot.state.ws,
          x: onFoot.state.wx - roadX(onFoot.state.ws),
          y: Math.max(0, onFoot.state.wy - openWorldGroundY(onFoot.state.wx, onFoot.state.ws)),
          speed: Math.max(24, onFoot.state.moveSpeed),
          heldItem: res.item,
          heldItems: [{ type: res.item, ttl: 30 }],
        }
      : player.state;

    if (!onFoot.state.active) {
      player.state.heldItems.unshift({ type: res.item, ttl: 30 });
      player.state.heldItem = res.item;
    }
    items.useHeldItem(shooter, combatTargets, itemCallbacks, 0);
  });
}

function handleContextInteract(): boolean {
  audio.unlock();
  // 1. Blueprint stamp if active blueprint preview is armed
  const activeBp = blueprints.getActivePreview();
  if (activeBp) {
    const origin = getBuildOriginForPlayer();
    blueprints.setActivePreview(null);
    enqueueBlockBuildPlan(activeBp.name, activeBp.blocks, origin);
    return true;
  }

  // 2. Open WebSSH Computer Terminal if aiming at a placed Computer Block (type 10)
  if (onFoot.state.active && onFoot.state.aimHit?.hitType === 'block' && onFoot.state.aimHit.blockType === 10) {
    webSshModal.open();
    return true;
  }

  // 3. Harvest nearby natural Resource Node
  const pose = onFoot.state.active
    ? { wx: onFoot.state.wx, ws: onFoot.state.ws }
    : player.getWorldPose();
  const node = resourceNodes.getNearbyNode(pose.wx, pose.ws, 5.2);
  if (node && node.cooldown <= 0) {
    const res = resourceNodes.harvestNode(node.id);
    if (res) {
      audio.playHarvest();
      const s = node.ws;
      const lat = node.wx - roadX(s);
      world.spawnParticles(s, lat, 1.0, 14, node.colorHex, 6.0, 0.16, 0.45, 10, 0);
      const summary = res.blockRewards
        .map((r) => `${BLOCK_SPEC_BY_ID[r.b].zhName}x${r.qty}`)
        .join(' + ');
      const nodeName = getLang() === 'zh' ? node.zhName : node.enName;
      hud.showToast(
        `${t('harvestSuccess', { name: nodeName, coins: res.coinReward })} (${summary})`,
        'cyan',
        'harvest'
      );
      void serverClient
        .claimReward('harvest', res.coinReward, res.blockRewards)
        .then((r) => {
          if (r.ok && r.state) syncEconomyUi(r.state);
        });
      return true;
    }
  }
  return false;
}

function breakAimedBlock(): boolean {
  if (!onFoot.state.active) return false;
  const hit = onFoot.state.aimHit;
  onFoot.triggerSwing();
  if (!hit || hit.hitType !== 'block') return false;
  const removed = voxels.removeBlock(hit.gx, hit.gy, hit.gz);
  if (!removed) return false;

  audio.playBlockBreak();
  const nextEco = serverClient.adjustLocalInventory(removed, 1);
  syncEconomyUi(nextEco);

  const spec = BLOCK_SPEC_BY_ID[removed];
  const blockS = hit.gz + 0.5;
  const blockLat = hit.gx + 0.5 - roadX(blockS);
  const blockRelY = Math.max(0.2, hit.gy + 0.5 - openWorldGroundY(hit.gx + 0.5, blockS));
  world.spawnParticles(blockS, blockLat, blockRelY, 10, spec.particleHex, 5.2, 0.16, 0.38, 16, 0);
  mqtt.publishVoxelEvent({ op: 'del', gx: hit.gx, gy: hit.gy, gz: hit.gz });
  serverClient?.sendVoxel('del', hit.gx, hit.gy, hit.gz);
  return true;
}

function placeAimedBlock(): boolean {
  if (!onFoot.state.active) return false;
  const hit = onFoot.state.aimHit;
  onFoot.triggerSwing();
  if (!hit) return false;
  if (onFoot.wouldIntersectPlayer(hit.placeX, hit.placeY, hit.placeZ)) {
    return false;
  }
  const blockType = onFoot.state.selectedBlock;
  if ((economyState.inventory[blockType] ?? 0) <= 0) {
    const bSpec = BLOCK_SPEC_BY_ID[blockType];
    const bName = getLang() === 'zh' ? bSpec.zhName : bSpec.enName;
    hud.showToast(t('blockNoStock', { name: bName }), 'red', 'shop');
    return false;
  }
  const acc = serverClient.getAccount();
  const ownerId = acc?.id;
  const ownerName = acc?.displayName || player.state.name;
  const ok = voxels.setBlock(hit.placeX, hit.placeY, hit.placeZ, blockType, true, ownerId, ownerName);
  if (!ok) return false;

  const nextEco = serverClient.adjustLocalInventory(blockType, -1);
  syncEconomyUi(nextEco);

  audio.playBlockPlace();
  const spec = BLOCK_SPEC_BY_ID[blockType];
  const blockS = hit.placeZ + 0.5;
  const blockLat = hit.placeX + 0.5 - roadX(blockS);
  const blockRelY = Math.max(0.2, hit.placeY + 0.5 - openWorldGroundY(hit.placeX + 0.5, blockS));
  world.spawnParticles(blockS, blockLat, blockRelY, 5, spec.particleHex, 3.0, 0.12, 0.25, 10, 0);
  mqtt.publishVoxelEvent({
    op: 'set',
    gx: hit.placeX,
    gy: hit.placeY,
    gz: hit.placeZ,
    b: blockType,
    ownerId,
    ownerName,
  });
  serverClient?.sendVoxel('set', hit.placeX, hit.placeY, hit.placeZ, blockType);
  return true;
}

function pickAimedBlock(): boolean {
  if (!onFoot.state.active) return false;
  const hit = onFoot.state.aimHit;
  if (!hit || hit.hitType !== 'block' || !hit.blockType) return false;
  onFoot.selectBlock(hit.blockType);
  audio.playPickup();
  return true;
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
    serverClient?.setPlayerName(name);
    void serverClient?.syncProfile({ displayName: name });
  },
  onAvatarChange(avatarIdx: number) {
    const safeIdx = ((Math.trunc(avatarIdx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
    writeStorage(STORAGE_AVATAR_KEY, String(safeIdx));
    removeStorage(STORAGE_CUSTOM_AVATAR_KEY);
    setCustomAvatar(mqtt.clientId, null);
    mqtt.setCustomAvatar(null);
    player.state.avatarIdx = safeIdx;
    mqtt.setAvatar(safeIdx);
    void serverClient?.syncProfile({ avatarIdx: safeIdx });
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
  async onJoinRoom(room: string, password: string, title = '') {
    audio.unlock();
    hud.setHomeBusy(true);
    hud.setHomeError(null);
    try {
      const res = await mqtt.joinRoom(room, password, title);
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
      voxels.loadRoom(res.room);
      serverClient?.connectRoom(res.room);
      audio.playSpawnChime();
      const displayLabel = res.room === 'global' ? t('publicHall') : roomInfo.title || res.room;
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
  onToggleDismount() {
    toggleDismount();
  },
  onReturnToTrack() {
    returnToTrack();
  },
  onSelectBlock(block: BlockType) {
    audio.unlock();
    onFoot.selectBlock(block);
  },
  onBreakBlock() {
    audio.unlock();
    breakAimedBlock();
  },
  onPlaceBlock() {
    audio.unlock();
    placeAimedBlock();
  },
  onClearBlocks() {
    audio.unlock();
    voxels.clearAll();
    serverClient?.sendVoxel('clear');
    audio.playBlockBreak();
    hud.showToast(t('buildCleared'), 'gold', 'cube');
  },
  onFootTouchInput(patch) {
    audio.unlock();
    touchModeActive = true;
    if (patch.forward !== undefined) footTouchState.forward = patch.forward;
    if (patch.strafe !== undefined) footTouchState.strafe = patch.strafe;
    if (patch.jump !== undefined) footTouchState.jump = patch.jump;
    if (patch.sprint !== undefined) footTouchState.sprint = patch.sprint;
  },
  onServerModalToggle(open: boolean) {
    if (open) {
      exitPointerLockSafe();
      clearHeldInputs();
    }
  },
  async onSaveServerUrl(url: string) {
    const saved = serverClient.setServerUrl(url);
    hud.showToast(t('serverSavedToast', { url: saved }), 'cyan', 'server');
    return serverClient.pingServer(saved);
  },
  async onResetServerUrl() {
    const saved = serverClient.resetDefaultServerUrl();
    hud.showToast(t('serverSavedToast', { url: saved }), 'cyan', 'server');
    return serverClient.pingServer(saved);
  },
  async onPingServer(url?: string) {
    return serverClient.pingServer(url);
  },
  async onAccountLogin(username: string, password: string) {
    const res = await serverClient.login(username, password);
    if (res.ok && res.account) {
      applyLoggedInAccount(res.account);
      hud.showToast(
        t('accountLoggedInToast', { name: res.account.displayName || res.account.username }),
        'cyan',
        'user'
      );
    }
    return { ok: res.ok, error: res.error };
  },
  async onAccountRegister(username: string, password: string, displayName: string) {
    const res = await serverClient.register(
      username,
      password,
      displayName,
      player.state.colorIdx,
      player.state.avatarIdx
    );
    if (res.ok && res.account) {
      applyLoggedInAccount(res.account);
      hud.showToast(
        t('accountCreatedToast', { name: res.account.displayName || res.account.username }),
        'gold',
        'user'
      );
    }
    return { ok: res.ok, error: res.error };
  },
  onAccountLogout() {
    serverClient.logout();
    hud.showToast(t('accountLoggedOutToast'), 'gold', 'user');
    void refreshEconomyAndBlueprints();
  },
  onOpenEconomy(tab?: EconomyTab) {
    audio.unlock();
    audio.playUiClick();
    economyModal.open(tab ?? 'shop');
  },
  onOpenAiBuilder() {
    audio.unlock();
    audio.playUiClick();
    aiBuilderModal.open(economyState.inventory);
  },
  onInteract() {
    handleContextInteract();
  },
  onStashItem() {
    stashCurrentHeldItem();
  },
  onOpenWorldMap() {
    audio.unlock();
    audio.playUiClick();
    worldMapModal.open(intruderRecords.length > 0 ? 'intruders' : 'markers');
    worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
    void refreshMapAndIntruders();
  },
  onOpenAvatarStudio() {
    audio.unlock();
    audio.playUiClick();
    avatarStudioModal.open(savedCustomAvatars, activeCustomAvatarId);
  },
});

function applyLoggedInAccount(acc: GameAccount): void {
  const dn = (acc.displayName || acc.username).slice(0, 14);
  writeStorage(STORAGE_NAME_KEY, dn);
  player.state.name = dn;
  mqtt.setName(dn);
  hud.applyExternalName(dn);
  if (Number.isFinite(acc.avatarIdx)) {
    const safeAv = ((Math.trunc(acc.avatarIdx) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
    player.state.avatarIdx = safeAv;
    mqtt.setAvatar(safeAv);
    writeStorage(STORAGE_AVATAR_KEY, String(safeAv));
    hud.refreshLocalAvatar();
  }
  void refreshEconomyAndBlueprints();
}

const initialRoomInfo = mqtt.getRoomInfo();
voxels.loadRoom(initialRoomInfo.room);

serverClient = new ServerClient(mqtt.clientId, initialName, {
  onStatusChange(status, url) {
    hud.setServerState(status, url);
  },
  onAccountChange(account) {
    hud.setAccountState(account);
  },
  onWorldSnapshot(_room, blocks) {
    voxels.replaceFromServer(blocks);
  },
  onVoxelUpdate(ev) {
    if (ev.op === 'set' && ev.b && ev.b >= 1 && ev.b <= 10) {
      voxels.setBlock(
        ev.gx ?? 0,
        ev.gy ?? 0,
        ev.gz ?? 0,
        ev.b as BlockType,
        true,
        ev.ownerId,
        ev.ownerName
      );
    } else if (ev.op === 'del') {
      voxels.removeBlock(ev.gx ?? 0, ev.gy ?? 0, ev.gz ?? 0);
    } else if (ev.op === 'clear') {
      voxels.clearAll();
    }
  },
  onVoxelRejected(_reason, ownerName, remainingSec) {
    hud.showToast(
      t('shieldBlockedToast', { owner: ownerName || '其他玩家', sec: Math.max(1, remainingSec) }),
      'red',
      'shield'
    );
    // Re-sync world from server so any optimistic local edit reverts cleanly
    serverClient.connectRoom(mqtt.displayRoom);
    void refreshEconomyAndBlueprints();
  },
  onIntruderAlert(record) {
    intruderRecords = [record, ...intruderRecords.filter((r) => r.id !== record.id)].slice(0, 100);
    syncIntruderVisuals();
    audio.playIntruderAlert();
    const msg = t('intruderAlertToast', { name: record.intruderName });
    hud.showToast(msg, 'red', 'intruder');
    hud.pushBroadcast(msg, 'red', 'intruder');
    if (worldMapModal?.isOpen()) {
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
    }
  },
});

worldMapModal = new WorldMapModal(hudContainer, {
  onToggle(open) {
    if (open) {
      exitPointerLockSafe();
      clearHeldInputs();
    }
  },
  onToast(msg, accent) {
    hud.showToast(msg, accent ?? 'cyan', 'map');
  },
  async onTeleportTo(wx, ws, label, useCard) {
    await teleportPlayerTo(wx, ws, label, useCard);
  },
  async onAddMarker(name, wx, wy, ws, color) {
    const res = await serverClient.saveMapMarker({ name, wx, wy, ws, color });
    if (res.ok && res.marker) {
      audio.playUiClick();
      mapMarkers = [res.marker, ...mapMarkers.filter((m) => m.id !== res.marker!.id)];
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
      hud.showToast(`已标记「${res.marker.name}」`, 'gold', 'pin');
    } else {
      hud.showToast(res.error || '标记失败', 'red', 'warning');
    }
  },
  async onDeleteMarker(id) {
    const res = await serverClient.deleteMapMarker(id);
    if (res.ok) {
      mapMarkers = mapMarkers.filter((m) => m.id !== id);
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
    }
  },
  async onNameBuilding(name, gx, gy, gz) {
    const res = await serverClient.saveNamedBuilding(mqtt.displayRoom, name, gx, gy, gz);
    if (res.ok) {
      audio.playUiClick();
      if (res.buildings) {
        namedBuildings = res.buildings;
      } else if (res.building) {
        namedBuildings = [res.building, ...namedBuildings.filter((b) => b.id !== res.building!.id)];
      }
      syncNamedBuildingVisuals();
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
      hud.showToast(`建筑已命名为「${name}」`, 'gold', 'blueprint');
    } else {
      hud.showToast(res.error || '命名失败', 'red', 'warning');
    }
  },
  async onDeleteNamedBuilding(id) {
    const res = await serverClient.deleteNamedBuilding(id, mqtt.displayRoom);
    if (res.ok) {
      namedBuildings = namedBuildings.filter((b) => b.id !== id);
      syncNamedBuildingVisuals();
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
    }
  },
  async onDismissIntruder(id) {
    const res = await serverClient.dismissIntruderRecord(id);
    if (res.ok) {
      intruderRecords = intruderRecords.filter((r) => r.id !== id);
      syncIntruderVisuals();
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
    }
  },
  onOpenShop() {
    worldMapModal.close();
    economyModal.open('shop');
  },
});

avatarStudioModal = new AvatarStudioModal(hudContainer, {
  onToggle(open) {
    if (open) {
      exitPointerLockSafe();
      clearHeldInputs();
    }
  },
  onToast(msg, accent) {
    hud.showToast(msg, accent ?? 'cyan', 'avatarStudio');
  },
  async onSaveAvatar(av) {
    const res = await serverClient.saveCustomAvatar(av);
    if (res.ok) {
      if (res.avatars) {
        savedCustomAvatars = res.avatars;
      } else if (res.avatar) {
        savedCustomAvatars = [res.avatar, ...savedCustomAvatars.filter((a) => a.id !== res.avatar!.id)];
      }
      if (res.avatar) {
        await serverClient.setActiveCustomAvatar(res.avatar.id);
        applyActiveCustomAvatar(res.avatar, true);
      }
      avatarStudioModal.refreshSaved(savedCustomAvatars, activeCustomAvatarId);
      hud.showToast(t('avatarSwitchedToast'), 'cyan', 'avatarStudio');
    } else {
      hud.showToast(res.error || '形象保存失败', 'red', 'warning');
    }
  },
  async onSelectAvatar(av) {
    await serverClient.setActiveCustomAvatar(av?.id ?? '');
    applyActiveCustomAvatar(av, true);
    avatarStudioModal.refreshSaved(savedCustomAvatars, activeCustomAvatarId);
    hud.showToast(av ? t('avatarSwitchedToast') : t('avatarResetToast'), av ? 'cyan' : 'gold', 'avatarStudio');
  },
  async onDeleteAvatar(id) {
    const res = await serverClient.deleteCustomAvatar(id);
    if (res.ok) {
      savedCustomAvatars = res.avatars ?? savedCustomAvatars.filter((a) => a.id !== id);
      if (activeCustomAvatarId === id) {
        applyActiveCustomAvatar(null, true);
      }
      avatarStudioModal.refreshSaved(savedCustomAvatars, activeCustomAvatarId);
    }
  },
});

webSshModal = new WebSshModal(hudContainer, serverClient, {
  onToggle(open) {
    if (open) {
      exitPointerLockSafe();
      clearHeldInputs();
    }
  },
  onToast(msg, accent) {
    hud.showToast(msg, accent ?? 'cyan', 'terminal');
  },
});

aiBuilderModal = new AiBuilderModal(hudContainer, {
  onToggle(open) {
    if (open) {
      exitPointerLockSafe();
      clearHeldInputs();
    }
  },
  onToast(msg, accent) {
    hud.showToast(msg, accent ?? 'cyan', 'sparkle');
  },
  onBuildBlocks(name: string, blocks: AiBuildBlock[]) {
    aiBuilderModal.close();
    enqueueBlockBuildPlan(name, blocks);
  },
});

economyModal = new EconomyModal(hudContainer, serverClient, {
  onToggle(open) {
    if (open) {
      exitPointerLockSafe();
      clearHeldInputs();
      economyModal.refreshState(
        economyState,
        player.state.heldItems,
        savedBlueprints,
        getBlueprintSelectionInfo()
      );
      void refreshEconomyAndBlueprints();
    }
  },
  onToast(msg, accent) {
    hud.showToast(msg, accent ?? 'gold', 'shop');
  },
  onEconomyUpdated(state) {
    syncEconomyUi(state);
  },
  onShopPurchased(kind) {
    if (kind === 'shield') {
      audio.playShieldActivate();
    } else {
      audio.playShopBuy();
    }
  },
  onStashHeldItem(_heldIdx, _item) {
    stashCurrentHeldItem();
  },
  onUseBagItem(bagIndex) {
    fireBagItem(bagIndex);
  },
  onSetBlueprintCornerA() {
    const p = getBuildOriginForPlayer();
    blueprints.setPos1(p.gx, p.gy, p.gz);
    hud.showToast(`蓝图角点 A 已设 (${p.gx}, ${p.gy}, ${p.gz})`, 'gold', 'blueprint');
    economyModal.refreshState(economyState, player.state.heldItems, savedBlueprints, getBlueprintSelectionInfo());
  },
  onSetBlueprintCornerB() {
    const p = getBuildOriginForPlayer();
    blueprints.setPos2(p.gx, p.gy, p.gz);
    hud.showToast(`蓝图角点 B 已设 (${p.gx}, ${p.gy}, ${p.gz})`, 'gold', 'blueprint');
    economyModal.refreshState(economyState, player.state.heldItems, savedBlueprints, getBlueprintSelectionInfo());
  },
  onClearBlueprintSelection() {
    blueprints.clearSelection();
    blueprints.setActivePreview(null);
    economyModal.refreshState(economyState, player.state.heldItems, savedBlueprints, getBlueprintSelectionInfo());
  },
  async onSaveBlueprint(name: string) {
    const cap = blueprints.captureFromWorld(voxels, name);
    if (!cap.ok || !cap.blueprint) {
      hud.showToast(cap.error || '请先在地图中选择建筑角点 A 和 B', 'red', 'warning');
      return;
    }
    const res = await serverClient.saveBlueprint({
      name: cap.blueprint.name,
      sizeX: cap.blueprint.sizeX,
      sizeY: cap.blueprint.sizeY,
      sizeZ: cap.blueprint.sizeZ,
      blocks: cap.blueprint.blocks,
    });
    if (res.ok && res.blueprint) {
      savedBlueprints = [res.blueprint, ...savedBlueprints.filter((b) => b.id !== res.blueprint!.id)];
      blueprints.clearSelection();
      hud.showToast(t('bpSavedToast', { name: cap.blueprint.name }), 'cyan', 'blueprint');
      economyModal.refreshState(economyState, player.state.heldItems, savedBlueprints, getBlueprintSelectionInfo());
    } else {
      hud.showToast(res.error || '蓝图保存失败', 'red', 'warning');
    }
  },
  onPreviewBlueprint(bp) {
    if (!bp) {
      blueprints.setActivePreview(null);
      return;
    }
    const converted: SavedBlueprint = {
      id: bp.id,
      name: bp.name,
      sizeX: bp.sizeX,
      sizeY: bp.sizeY,
      sizeZ: bp.sizeZ,
      blocks: bp.blocks.map((b) => ({ dx: b.dx, dy: b.dy, dz: b.dz, b: Math.min(10, Math.max(1, b.b)) as BlockType })),
      createdAt: bp.createdAt,
    };
    blueprints.setActivePreview(converted);
    economyModal.close();
    hud.showToast(`蓝图预览已开启，走到目标位置按 E 或点重建`, 'cyan', 'blueprint');
  },
  onRebuildBlueprint(bp) {
    economyModal.close();
    blueprints.setActivePreview(null);
    enqueueBlockBuildPlan(bp.name, bp.blocks);
  },
  async onDeleteBlueprint(id: string) {
    const res = await serverClient.deleteBlueprint(id);
    if (res.ok) {
      savedBlueprints = savedBlueprints.filter((b) => b.id !== id);
      economyModal.refreshState(economyState, player.state.heldItems, savedBlueprints, getBlueprintSelectionInfo());
    }
  },
});

hud.setServerState(serverClient.getStatus(), serverClient.getServerUrl());
hud.setAccountState(serverClient.getAccount());
syncEconomyUi(serverClient.getCachedEconomyState());
serverClient.connectRoom(initialRoomInfo.room);
void serverClient.verifySession().then((acc) => {
  if (acc) {
    hud.setAccountState(acc);
  }
  void refreshEconomyAndBlueprints();
});
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
        awardRaceCoins('ko', 60);
      }
    } else if (ko) {
      player.state.kos += 1;
      player.state.nitro = Math.min(100, player.state.nitro + 32);
      awardRaceCoins('ko', 60);
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
      awardRaceCoins('ko', 60);
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
      awardRaceCoins('ko', 60);
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
    awardRaceCoins('race', 10);
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
    awardRaceCoins('nearmiss', 15);
  },
  onCrash() {
    audio.playCrash();
    world.triggerShake(0.66, 0.4);
    hud.showToast(t('wipeout'), 'red', 'warning');
  },
  onLeaveTrack() {
    hud.showToast(t('freeRoamEnter'), 'cyan', 'cube');
  },
  onReturnTrack() {
    hud.showToast(t('backToTrackToast'), 'gold', 'road');
  },
  onBlockEffect(kind, _blockType) {
    const nowMs = performance.now();
    if (kind === 'crash') {
      audio.playCrash();
      world.triggerShake(0.58, 0.34);
      spawnParticlePreset('crash', player.state.s, player.state.x, 0.7, player.state.speed * 0.3);
      world.spawnHitPopup('BONK', player.state.s, player.state.x, 1.7);
      hud.showToast(t('blockEffectCrash'), 'red', 'warning');
      lastBlockSlowToastMs = nowMs;
    } else if (kind === 'block') {
      audio.playHit(0, false);
      world.triggerShake(0.32, 0.2);
      spawnParticlePreset('spark', player.state.s, player.state.x, 0.65, player.state.speed * 0.35);
      if (nowMs - lastBlockSlowToastMs > 1800) {
        hud.showToast(t('blockEffectBlock'), 'gold', 'cube');
        lastBlockSlowToastMs = nowMs;
      }
    } else if (kind === 'slow') {
      if (nowMs - lastBlockSlowToastMs > 2400) {
        spawnParticlePreset('dust', player.state.s, player.state.x, 0.35, player.state.speed * 0.25);
        hud.showToast(t('blockEffectSlow'), 'gold', 'cube');
        lastBlockSlowToastMs = nowMs;
      }
    } else if (kind === 'boost') {
      if (nowMs - lastBlockSlowToastMs > 2400) {
        audio.playBoost();
        spawnParticlePreset('nitro', player.state.s, player.state.x, 0.45, player.state.speed * 0.4);
        hud.showToast(t('blockEffectBoost'), 'cyan', 'bolt');
        lastBlockSlowToastMs = nowMs;
      }
    }
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
    case 'KeyG':
      toggleDismount();
      return;
    case 'KeyH':
      if (player.state.freeRoam || onFoot.state.active) {
        returnToTrack();
      }
      return;
    case 'KeyC': {
      const mode = cycleCamera();
      if (!onFoot.state.active) {
        const labels = [t('camChase'), t('camLow'), t('camHood')];
        hud.showToast(labels[mode], 'gold');
      }
      return;
    }
    case 'KeyM': {
      const muted = toggleMute();
      hud.showToast(muted ? 'OFF' : 'ON', 'gold', muted ? 'soundOff' : 'soundOn');
      return;
    }
    case 'KeyP': {
      const scale = togglePixelScale();
      hud.showToast(scale === 2 ? t('pixelMode') : t('hdMode'), 'gold');
      return;
    }
    case 'KeyV': {
      audio.unlock();
      weather.cycleWeather(weatherCallbacks);
      return;
    }
    case 'KeyB': {
      audio.unlock();
      economyModal.open('shop');
      return;
    }
    case 'KeyN': {
      audio.unlock();
      worldMapModal.open(intruderRecords.length > 0 ? 'intruders' : 'markers');
      worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
      void refreshMapAndIntruders();
      return;
    }
    case 'KeyT': {
      stashCurrentHeldItem();
      return;
    }
  }

  // On-Foot Minecraft building shortcuts (1-9,0 hotbar, J break, K place, E context interact/place, Q eyedropper)
  if (onFoot.state.active) {
    if (e.code >= 'Digit1' && e.code <= 'Digit9') {
      const blockId = Number.parseInt(e.code.slice(5), 10) as BlockType;
      onFoot.selectBlock(blockId);
      return;
    }
    if (e.code === 'Digit0') {
      onFoot.selectBlock(10);
      return;
    }
    if (e.code === 'KeyJ') {
      breakAimedBlock();
      return;
    }
    if (e.code === 'KeyK') {
      placeAimedBlock();
      return;
    }
    if (e.code === 'KeyE') {
      if (!handleContextInteract()) {
        placeAimedBlock();
      }
      return;
    }
    if (e.code === 'KeyQ') {
      pickAimedBlock();
      return;
    }
    return;
  }

  switch (e.code) {
    case 'KeyE':
      handleContextInteract();
      break;
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

  // On-Foot Minecraft-style look + build/break controls
  if (onFoot.state.active) {
    if (e.pointerType === 'touch') {
      touchModeActive = true;
      if (dragLookPointerId === null) {
        dragLookPointerId = e.pointerId;
        dragLookLastX = e.clientX;
        dragLookLastY = e.clientY;
        dragLookMoved = 0;
        dragLookDownMs = performance.now();
        dragLookButton = 0;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic events
        }
      }
      return;
    }

    if (document.pointerLockElement === canvas) {
      if (e.button === 0) {
        breakAimedBlock();
      } else if (e.button === 2) {
        placeAimedBlock();
      } else if (e.button === 1) {
        e.preventDefault();
        pickAimedBlock();
      }
      return;
    }

    // Unlocked desktop: right-click places immediately; middle-click picks; left-click requests Pointer Lock + drag-look fallback
    if (e.button === 2) {
      placeAimedBlock();
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      pickAimedBlock();
      return;
    }
    if (e.button === 0) {
      dragLookPointerId = e.pointerId;
      dragLookLastX = e.clientX;
      dragLookLastY = e.clientY;
      dragLookMoved = 0;
      dragLookDownMs = performance.now();
      dragLookButton = 0;
      try {
        canvas.requestPointerLock?.();
      } catch {
        // Fallback to drag-to-look
      }
    }
    return;
  }

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

window.addEventListener('mousemove', (e: MouseEvent) => {
  if (!onFoot.state.active || isUiBlockingGameplay()) return;
  if (document.pointerLockElement === canvas) {
    pendingLookYaw -= e.movementX * 0.0024;
    pendingLookPitch -= e.movementY * 0.0024;
  }
});

window.addEventListener('pointermove', (e: PointerEvent) => {
  if (!onFoot.state.active || dragLookPointerId === null || e.pointerId !== dragLookPointerId) return;
  if (document.pointerLockElement === canvas) return;
  const dx = e.clientX - dragLookLastX;
  const dy = e.clientY - dragLookLastY;
  dragLookLastX = e.clientX;
  dragLookLastY = e.clientY;
  dragLookMoved += Math.hypot(dx, dy);
  const sens = e.pointerType === 'touch' ? 0.0052 : 0.0036;
  pendingLookYaw -= dx * sens;
  pendingLookPitch -= dy * sens;
});

function endDragLook(e: PointerEvent): void {
  if (dragLookPointerId === null || e.pointerId !== dragLookPointerId) return;
  const wasQuickLeftTap =
    onFoot.state.active &&
    e.pointerType !== 'touch' &&
    dragLookButton === 0 &&
    dragLookMoved < 6 &&
    performance.now() - dragLookDownMs < 240 &&
    document.pointerLockElement !== canvas;
  dragLookPointerId = null;
  dragLookButton = -1;
  if (wasQuickLeftTap) {
    breakAimedBlock();
  }
}

window.addEventListener('pointerup', endDragLook);
window.addEventListener('pointercancel', endDragLook);

window.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    if (!onFoot.state.active || isUiBlockingGameplay()) return;
    if (Math.abs(e.deltaY) < 2) return;
    onFoot.cycleBlock(e.deltaY > 0 ? 1 : -1);
  },
  { passive: true }
);

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
(
  window as unknown as {
    __VMOTO_OPENWORLD__?: {
      dismount: () => void;
      returnToTrack: () => void;
      selectBlock: (b: BlockType) => void;
      placeBlock: () => boolean;
      breakBlock: () => boolean;
      getState: () => {
        freeRoam: boolean;
        onFoot: boolean;
        blockCount: number;
        selectedBlock: BlockType;
        x: number;
        s: number;
      };
      openShop: (tab?: EconomyTab) => void;
      openAi: () => void;
      openSsh: () => void;
      openMap: (tab?: 'markers' | 'buildings' | 'intruders' | 'players') => void;
      openAvatarStudio: () => void;
      cycleOnFootCam: () => number;
      setOffTrackQuiet: (hidden: boolean) => void;
      getEconomy: () => EconomyState;
    };
  }
).__VMOTO_OPENWORLD__ = {
  dismount: () => toggleDismount(),
  returnToTrack: () => returnToTrack(),
  selectBlock: (b: BlockType) => onFoot.selectBlock(b),
  placeBlock: () => placeAimedBlock(),
  breakBlock: () => breakAimedBlock(),
  getState: () => ({
    freeRoam: Boolean(player.state.freeRoam),
    onFoot: onFoot.state.active,
    blockCount: voxels.getBlockCount(),
    selectedBlock: onFoot.state.selectedBlock,
    x: player.state.x,
    s: player.state.s,
  }),
  openShop: (tab?: EconomyTab) => economyModal.open(tab ?? 'shop'),
  openAi: () => aiBuilderModal.open(economyState.inventory),
  openSsh: () => webSshModal.open(),
  openMap: (tab?: 'markers' | 'buildings' | 'intruders' | 'players') => {
    worldMapModal.open(tab ?? 'markers');
    worldMapModal.updateData(buildWorldMapSnapshot(mqtt.getRemoteRiders()));
    void refreshMapAndIntruders();
  },
  openAvatarStudio: () => avatarStudioModal.open(savedCustomAvatars, activeCustomAvatarId),
  cycleOnFootCam: () => cycleCamera(),
  setOffTrackQuiet: (hidden: boolean) => {
    trackInfoHidden = hidden;
    hud.setTrackInfoHidden(hidden);
  },
  getEconomy: () => economyState,
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
      weather.physics,
      voxels
    );

    // Step Minecraft-style On-Foot movement & raycasting when dismounted
    if (onFoot.state.active) {
      const blocked = isUiBlockingGameplay();
      const keyFwd =
        (pressedKeys.has('KeyW') ? 1 : 0) - (pressedKeys.has('KeyS') ? 1 : 0);
      const keyStrafe =
        (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0);
      const keyTurnYaw =
        ((pressedKeys.has('ArrowLeft') ? 1 : 0) - (pressedKeys.has('ArrowRight') ? 1 : 0)) *
        2.15 *
        dt;
      const keyTurnPitch =
        ((pressedKeys.has('ArrowUp') ? 1 : 0) - (pressedKeys.has('ArrowDown') ? 1 : 0)) *
        1.65 *
        dt;

      footInputBuf.forward = blocked
        ? 0
        : keyFwd !== 0
          ? keyFwd
          : footTouchState.forward;
      footInputBuf.strafe = blocked
        ? 0
        : keyStrafe !== 0
          ? keyStrafe
          : footTouchState.strafe;
      footInputBuf.jump = !blocked && (pressedKeys.has('Space') || footTouchState.jump);
      footInputBuf.sprint =
        !blocked &&
        (pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') || footTouchState.sprint);
      footInputBuf.lookYawDelta = blocked ? 0 : pendingLookYaw + keyTurnYaw;
      footInputBuf.lookPitchDelta = blocked ? 0 : pendingLookPitch + keyTurnPitch;
      pendingLookYaw = 0;
      pendingLookPitch = 0;

      onFoot.update(dt, footInputBuf, voxels, () => audio.playFootstep());
    } else {
      pendingLookYaw = 0;
      pendingLookPitch = 0;
    }

    // Crossing village animals on the Chinese National Highway (only hit when riding on road)
    currentAnimals = animals.update(
      dt,
      player.state.s,
      player.state.x,
      player.state.y,
      player.state.speed,
      player.state.crashed || Boolean(player.state.freeRoam) || onFoot.state.active,
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
      hud.showToast(`${lapLabel} +200💰`, 'gold', 'flag');
      hud.pushBroadcast(`${player.state.name} ${lapLabel}`, 'gold', 'flag');
      awardRaceCoins('lap', 200);
    }

    // Step queued AI / blueprint block placement & natural resource nodes
    stepPendingBuildQueue();
    const curPose = onFoot.state.active
      ? { wx: onFoot.state.wx, wy: onFoot.state.wy, ws: onFoot.state.ws }
      : player.getWorldPose();
    resourceNodes.update(dt, curPose.wx, curPose.ws);
    serverClient.sendPlayerPosition(curPose.wx, curPose.wy, curPose.ws, onFoot.state.active);

    // Hide race/track HUD automatically after leaving the highway for 10 continuous seconds
    const isOffTrackNow = Boolean(player.state.freeRoam || onFoot.state.active);
    if (isOffTrackNow) {
      offTrackElapsedSec += dt;
      if (offTrackElapsedSec >= 10.0 && !trackInfoHidden) {
        trackInfoHidden = true;
        hud.setTrackInfoHidden(true);
        hud.showToast(t('offTrackQuietToast'), 'cyan', 'map');
      }
    } else {
      offTrackElapsedSec = 0;
      if (trackInfoHidden) {
        trackInfoHidden = false;
        hud.setTrackInfoHidden(false);
      }
    }

    // Live WorldMapModal refresh while open
    if (worldMapModal.isOpen()) {
      mapUiRefreshAccum += dt;
      if (mapUiRefreshAccum >= 0.16) {
        mapUiRefreshAccum = 0;
        worldMapModal.updateData(buildWorldMapSnapshot(remoteRiders));
      }
      mapNetRefreshAccum += dt;
      if (mapNetRefreshAccum >= 4.0) {
        mapNetRefreshAccum = 0;
        void refreshMapAndIntruders();
      }
    }

    // Update live blueprint hologram origin when previewing
    const activeBp = blueprints.getActivePreview();
    if (activeBp) {
      const bpOrigin = getBuildOriginForPlayer();
      blueprints.setPreviewOrigin(bpOrigin.gx, bpOrigin.gy, bpOrigin.gz);
    }

    // Context interact prompt (blueprint stamp > WebSSH computer terminal > nearby resource node)
    if (activeBp) {
      if (lastInteractKind !== 'blueprint' || lastInteractNodeId !== activeBp.id) {
        lastInteractKind = 'blueprint';
        lastInteractNodeId = activeBp.id;
        hud.setInteractPrompt(
          getLang() === 'zh' ? `重建「${activeBp.name}」 [E]` : `REBUILD "${activeBp.name}" [E]`,
          'blueprint'
        );
      }
    } else if (
      onFoot.state.active &&
      onFoot.state.aimHit?.hitType === 'block' &&
      onFoot.state.aimHit.blockType === 10
    ) {
      if (lastInteractKind !== 'computer') {
        lastInteractKind = 'computer';
        lastInteractNodeId = null;
        hud.setInteractPrompt(t('computerPrompt'), 'terminal');
      }
    } else {
      const nearNode = resourceNodes.getNearbyNode(curPose.wx, curPose.ws, 5.2);
      if (nearNode && nearNode.cooldown <= 0) {
        if (lastInteractKind !== 'resource' || lastInteractNodeId !== nearNode.id) {
          lastInteractKind = 'resource';
          lastInteractNodeId = nearNode.id;
          const nName = getLang() === 'zh' ? nearNode.zhName : nearNode.enName;
          hud.setInteractPrompt(t('harvestPrompt', { name: nName }), 'harvest');
        }
      } else if (lastInteractKind !== 'none') {
        lastInteractKind = 'none';
        lastInteractNodeId = null;
        hud.setInteractPrompt(null);
      }
    }

    // Smoothly tick shield countdown pill in HUD once per second
    shieldHudTickAccum += dt;
    if (shieldHudTickAccum >= 1.0) {
      shieldHudTickAccum = 0;
      const remShield = getShieldRemainingSeconds(economyState.shieldUntil);
      if (remShield > 0) {
        hud.setEconomyHud(
          economyState.coins,
          remShield,
          economyState.bagCapacity,
          economyState.savedItems.length
        );
      }
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
    onFoot.state.active ? 0 : Math.abs(player.state.speed),
    !onFoot.state.active && (player.state.nitroActive || player.state.turboShieldTimer > 0),
    player.state.crashed || onFoot.state.active,
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
    weather.render,
    voxels,
    onFoot.state,
    resourceNodes.getActiveNodes(),
    blueprints,
    intruderSitesBuf,
    namedBuildingsBuf
  );
  hud.setWeather(weather.render.current, weather.render.lightningFlash);
  hud.setEnragedWarning(ai.isAnyDeliveryEnraged());
  hud.setSniperState(items.getSniperHudState(), items.getSniperCandidates());
  hud.setOpenWorldMode(
    Boolean(player.state.freeRoam || onFoot.state.active),
    onFoot.state.active,
    onFoot.state.selectedBlock,
    onFoot.state.distToBike,
    Boolean(onFoot.state.aimHit)
  );
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
