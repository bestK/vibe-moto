import {
  BIKE_PALETTES,
  ITEMS,
  ITEM_BY_ID,
  type CombatHitEvent,
  type ItemNetEvent,
  type ItemType,
  type RiderRenderState,
  type WeaponType,
} from '../game/types';
import { ROAD_HALF_WIDTH, dsForMeters } from '../game/RoadMath';
import { AVATAR_COUNT, isValidCustomAvatarDataUrl } from '../game/PixelAvatars';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface PackSpawnTarget {
  targetId: string;
  targetName: string;
  s: number;
  x: number;
  speed: number;
}

export interface MqttCallbacks {
  onStatus(status: ConnectionStatus): void;
  onInitialPackSpawn(target: PackSpawnTarget): void;
  onIncomingHit(ev: CombatHitEvent): void;
  onPeerEvent?(msg: string): void;
  onItemEvent?(ev: ItemNetEvent): void;
  onRemoteCustomAvatar?(peerId: string, dataUrl: string | null): void;
}

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const TOPIC_VERSION = 'vmoto/v2';
const STATE_PACKET_MIN_BYTES = 32;
const STATE_PACKET_BYTES = 34;

const ACTIVE_PUBLISH_MS = 66; // 15Hz while riding / attacking / wheelieing
const IDLE_PUBLISH_MS = 400; // 2.5Hz while stationary so newcomers discover parked riders quickly
const EDGE_PUBLISH_MIN_MS = 28;
const PROFILE_REFRESH_MS = 10_000;
const PEER_TIMEOUT_MS = 6_500;

const KEEPALIVE_SEC = 25;
const PING_INTERVAL_MS = 20_000;
const PING_TIMEOUT_MS = 9_000;
const CONNECT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
const MAX_WS_BUFFERED_BYTES = 65_536;
const MAX_INCOMING_PACKET_BYTES = 32_768; // Supports up to 16KB+ custom base64 avatar frames safely
const MAX_CACHED_CUSTOM_AVATARS = 64;

const DISCOVERY_MAX_MS = 850;
const DISCOVERY_AFTER_FIRST_PEER_MS = 380;

const MAX_LEAD_S_SEC = 0.16;
const MAX_LEAD_X_SEC = 0.12;
const TELEPORT_SNAP_S = 28.0;
const SPAWN_BEHIND_METERS = 5.0;
const SPAWN_LATERAL_SHIFT = 2.3;
const SPAWN_X_LIMIT = ROAD_HALF_WIDTH - 1.4;
const SPAWN_MIN_SPEED = 14.0;
const WHEEL_RADIUS = 0.35;

// MQTT 3.1.1 fixed control packets
const PKT_PINGREQ = new Uint8Array([0xc0, 0x00]);
const PKT_DISCONNECT = new Uint8Array([0xe0, 0x00]);
const EMPTY_BYTES = new Uint8Array(0);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface PeerProfile {
  name: string;
  colorIdx: number;
  avatarIdx: number;
  kos: number;
  updatedAt: number;
}

interface StateSnapshot {
  s: number;
  x: number;
  y: number;
  speed: number;
  vx: number;
  lean: number;
  hp: number;
  weapon: WeaponType;
  attackSide: 0 | 1 | 2;
  attackPhase: number;
  nitroActive: boolean;
  wheelie: boolean;
  crashed: boolean;
  braking: boolean;
  wheelieCharge: number;
  heldItem: ItemType | null;
  magnetActive: boolean;
  turboShield: boolean;
  spinOut: boolean;
  seq: number;
  sentTs: number;
  arrivalMs: number;
}

interface RemotePeer {
  id: string;
  hasLiveState: boolean;
  customAvatar: string | null;
  prevSnap: StateSnapshot;
  currSnap: StateSnapshot;
  lastSeq: number;
  lastStateAt: number;
  render: RiderRenderState;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalizeAvatar(idx: number): number {
  const n = Math.trunc(idx);
  return ((n % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
}

function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function varIntSize(len: number): number {
  if (len < 128) return 1;
  if (len < 16_384) return 2;
  if (len < 2_097_152) return 3;
  return 4;
}

function writeVarInt(buf: Uint8Array, offset: number, len: number): number {
  let x = len;
  do {
    let b = x & 0x7f;
    x >>>= 7;
    if (x > 0) b |= 0x80;
    buf[offset++] = b;
  } while (x > 0);
  return offset;
}

function writeMqttString(buf: Uint8Array, offset: number, bytes: Uint8Array): number {
  const len = bytes.byteLength;
  buf[offset++] = (len >>> 8) & 0xff;
  buf[offset++] = len & 0xff;
  buf.set(bytes, offset);
  return offset + len;
}

function buildConnectPacket(clientId: string, willTopic: string): Uint8Array {
  const cidBytes = textEncoder.encode(clientId);
  const willTopicBytes = textEncoder.encode(willTopic);
  // Variable header (10B) + ClientId (2+N) + WillTopic (2+M) + empty WillPayload (2B)
  const remaining = 10 + 2 + cidBytes.byteLength + 2 + willTopicBytes.byteLength + 2;
  const pkt = new Uint8Array(1 + varIntSize(remaining) + remaining);
  let o = 0;
  pkt[o++] = 0x10; // CONNECT
  o = writeVarInt(pkt, o, remaining);
  // Protocol Name "MQTT" + Protocol Level 4 (MQTT 3.1.1)
  pkt[o++] = 0x00;
  pkt[o++] = 0x04;
  pkt[o++] = 0x4d; // 'M'
  pkt[o++] = 0x51; // 'Q'
  pkt[o++] = 0x54; // 'T'
  pkt[o++] = 0x54; // 'T'
  pkt[o++] = 0x04; // Level 4 (3.1.1)
  // Connect Flags: CleanSession (0x02) | WillFlag (0x04) | WillQoS 0 | WillRetain (0x20)
  pkt[o++] = 0x26;
  // KeepAlive (25s)
  pkt[o++] = (KEEPALIVE_SEC >>> 8) & 0xff;
  pkt[o++] = KEEPALIVE_SEC & 0xff;
  // Payload: ClientId, Will Topic, Empty Will Payload
  o = writeMqttString(pkt, o, cidBytes);
  o = writeMqttString(pkt, o, willTopicBytes);
  pkt[o++] = 0x00;
  pkt[o++] = 0x00;
  return pkt;
}

function buildSubscribePacket(packetId: number, topicFilter: string): Uint8Array {
  const topicBytes = textEncoder.encode(topicFilter);
  const remaining = 2 + 2 + topicBytes.byteLength + 1;
  const pkt = new Uint8Array(1 + varIntSize(remaining) + remaining);
  let o = 0;
  pkt[o++] = 0x82; // SUBSCRIBE (reserved flags MUST be 0x02 in MQTT 3.1.1)
  o = writeVarInt(pkt, o, remaining);
  pkt[o++] = (packetId >>> 8) & 0xff;
  pkt[o++] = packetId & 0xff;
  o = writeMqttString(pkt, o, topicBytes);
  pkt[o++] = 0x00; // Requested QoS 0
  return pkt;
}

function buildPublishPacket(topicBytes: Uint8Array, payloadBytes: Uint8Array, retain: boolean): Uint8Array {
  const remaining = 2 + topicBytes.byteLength + payloadBytes.byteLength;
  const pkt = new Uint8Array(1 + varIntSize(remaining) + remaining);
  let o = 0;
  pkt[o++] = retain ? 0x31 : 0x30; // PUBLISH QoS 0, DUP 0, RETAIN bit 0
  o = writeVarInt(pkt, o, remaining);
  o = writeMqttString(pkt, o, topicBytes);
  if (payloadBytes.byteLength > 0) {
    pkt.set(payloadBytes, o);
  }
  return pkt;
}

function copySnapshot(dst: StateSnapshot, src: StateSnapshot): void {
  dst.s = src.s;
  dst.x = src.x;
  dst.y = src.y;
  dst.speed = src.speed;
  dst.vx = src.vx;
  dst.lean = src.lean;
  dst.hp = src.hp;
  dst.weapon = src.weapon;
  dst.attackSide = src.attackSide;
  dst.attackPhase = src.attackPhase;
  dst.nitroActive = src.nitroActive;
  dst.wheelie = src.wheelie;
  dst.crashed = src.crashed;
  dst.braking = src.braking;
  dst.wheelieCharge = src.wheelieCharge;
  dst.heldItem = src.heldItem;
  dst.magnetActive = src.magnetActive;
  dst.turboShield = src.turboShield;
  dst.spinOut = src.spinOut;
  dst.seq = src.seq;
  dst.sentTs = src.sentTs;
  dst.arrivalMs = src.arrivalMs;
}

function createEmptySnapshot(): StateSnapshot {
  return {
    s: 0,
    x: 0,
    y: 0,
    speed: 0,
    vx: 0,
    lean: 0,
    hp: 100,
    weapon: 0,
    attackSide: 0,
    attackPhase: 0,
    nitroActive: false,
    wheelie: false,
    crashed: false,
    braking: false,
    wheelieCharge: 0,
    heldItem: null,
    magnetActive: false,
    turboShield: false,
    spinOut: false,
    seq: 0,
    sentTs: 0,
    arrivalMs: 0,
  };
}

function sanitizeRoom(raw: string | null): string {
  if (!raw) return 'global';
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'global';
}

function readRoomFromLocation(): string {
  if (typeof window === 'undefined' || !window.location?.search) return 'global';
  try {
    const params = new URLSearchParams(window.location.search);
    return sanitizeRoom(params.get('room'));
  } catch {
    return 'global';
  }
}

function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 14);
  return cleaned.length > 0 ? cleaned : fallback;
}

function generateClientId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let suffix = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      suffix += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 10; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return `vm_${suffix}`;
}

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function fallbackPeerName(peerId: string): string {
  const tail = peerId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0000';
  return `RIDER_${tail}`;
}

function isValidItemType(val: unknown): val is ItemType {
  return typeof val === 'string' && Object.prototype.hasOwnProperty.call(ITEM_BY_ID, val);
}

export class MqttSync {
  readonly clientId: string;
  readonly room: string;

  private readonly callbacks: MqttCallbacks;
  private readonly topicPrefix: string;
  private readonly topicState: string;
  private readonly topicProfile: string;
  private readonly topicAvatar: string;
  private readonly topicEvents: string;
  private readonly topicWildcard: string;
  private readonly statePrefix: string;
  private readonly profilePrefix: string;
  private readonly avatarPrefix: string;

  // Pre-encoded topic byte slices & zero-GC reusable binary state PUBLISH packet
  private readonly topicProfileBytes: Uint8Array;
  private readonly topicAvatarBytes: Uint8Array;
  private readonly topicEventsBytes: Uint8Array;
  private readonly clearAvatarPacket: Uint8Array;
  private readonly unloadCoalescedPacket: Uint8Array;
  private readonly disposeCoalescedPacket: Uint8Array;
  private readonly statePacketBuf: Uint8Array;
  private readonly statePayloadView: DataView;
  private readonly pubackBuf = new Uint8Array([0x40, 0x02, 0x00, 0x00]);

  private ws: WebSocket | null = null;
  private mqttConnected = false;
  private status: ConnectionStatus = 'offline';
  private disposed = false;
  private didSendBye = false;
  private connectStarted = false;

  private packetId = 1;
  private reconnectAttempt = 0;
  private awaitingPingResp = false;
  private rxRemainder: Uint8Array | null = null;

  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private name: string;
  private colorIdx: number;
  private avatarIdx: number;
  private customAvatar: string | null;
  private lastPublishedKos = 0;

  private seq = 0;
  private lastStatePublishMs = -Infinity;
  private lastProfilePublishMs = -Infinity;
  private prevLocalAttackSide: 0 | 1 | 2 = 0;
  private prevLocalCrashed = false;

  // Initial pack discovery window state (runs ONCE per session)
  private initialSpawnDone = false;
  private subackAtMs: number | null = null;
  private firstLivePeerAtMs: number | null = null;

  private readonly profiles = new Map<string, PeerProfile>();
  private readonly customAvatars = new Map<string, string>();
  private readonly peers = new Map<string, RemotePeer>();
  private readonly remoteList: RiderRenderState[] = [];

  private readonly handleUnload = (): void => {
    this.sendCleanDisconnect(false);
  };

  constructor(
    initialName: string,
    colorIdx: number,
    initialAvatar: number,
    callbacks: MqttCallbacks,
    initialCustomAvatar: string | null = null
  ) {
    this.clientId = generateClientId();
    this.room = readRoomFromLocation();
    this.callbacks = callbacks;

    this.name = sanitizeName(initialName, fallbackPeerName(this.clientId));
    this.colorIdx = Math.abs(Math.trunc(colorIdx)) % BIKE_PALETTES.length;
    this.avatarIdx = Number.isFinite(initialAvatar)
      ? normalizeAvatar(initialAvatar)
      : this.colorIdx % AVATAR_COUNT;
    this.customAvatar =
      initialCustomAvatar && isValidCustomAvatarDataUrl(initialCustomAvatar)
        ? initialCustomAvatar
        : null;

    this.topicPrefix = `${TOPIC_VERSION}/${this.room}`;
    this.topicState = `${this.topicPrefix}/s/${this.clientId}`;
    this.topicProfile = `${this.topicPrefix}/p/${this.clientId}`;
    this.topicAvatar = `${this.topicPrefix}/a/${this.clientId}`;
    this.topicEvents = `${this.topicPrefix}/e`;
    this.topicWildcard = `${this.topicPrefix}/#`;
    this.statePrefix = `${this.topicPrefix}/s/`;
    this.profilePrefix = `${this.topicPrefix}/p/`;
    this.avatarPrefix = `${this.topicPrefix}/a/`;

    this.topicProfileBytes = textEncoder.encode(this.topicProfile);
    this.topicAvatarBytes = textEncoder.encode(this.topicAvatar);
    this.topicEventsBytes = textEncoder.encode(this.topicEvents);
    const clearProfilePacket = buildPublishPacket(this.topicProfileBytes, EMPTY_BYTES, true);
    this.clearAvatarPacket = buildPublishPacket(this.topicAvatarBytes, EMPTY_BYTES, true);
    const byeEventPacket = buildPublishPacket(
      this.topicEventsBytes,
      textEncoder.encode(JSON.stringify({ t: 'bye', id: this.clientId })),
      false
    );

    // Coalesce unload cleanup into a single atomic WS frame WITHOUT DISCONNECT so EMQX LWT always backs up tab close
    const unloadLen = byeEventPacket.byteLength + clearProfilePacket.byteLength + this.clearAvatarPacket.byteLength;
    this.unloadCoalescedPacket = new Uint8Array(unloadLen);
    this.unloadCoalescedPacket.set(byeEventPacket, 0);
    this.unloadCoalescedPacket.set(clearProfilePacket, byeEventPacket.byteLength);
    this.unloadCoalescedPacket.set(this.clearAvatarPacket, byeEventPacket.byteLength + clearProfilePacket.byteLength);

    // Coalesce programmatic dispose cleanup WITH MQTT DISCONNECT
    this.disposeCoalescedPacket = new Uint8Array(unloadLen + PKT_DISCONNECT.byteLength);
    this.disposeCoalescedPacket.set(this.unloadCoalescedPacket, 0);
    this.disposeCoalescedPacket.set(PKT_DISCONNECT, unloadLen);

    // Pre-allocate fixed PUBLISH frame for 34-byte binary state (0 bytes allocated per tick!)
    const topicStateBytes = textEncoder.encode(this.topicState);
    const stateRemaining = 2 + topicStateBytes.byteLength + STATE_PACKET_BYTES;
    const headerLen = 1 + varIntSize(stateRemaining);
    this.statePacketBuf = new Uint8Array(headerLen + stateRemaining);
    let o = 0;
    this.statePacketBuf[o++] = 0x30; // PUBLISH QoS 0, retain=false
    o = writeVarInt(this.statePacketBuf, o, stateRemaining);
    o = writeMqttString(this.statePacketBuf, o, topicStateBytes);
    this.statePayloadView = new DataView(this.statePacketBuf.buffer, o, STATE_PACKET_BYTES);
  }

  connect(): void {
    if (this.disposed || this.connectStarted) return;
    this.connectStarted = true;
    this.didSendBye = false;

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handleUnload);
      window.addEventListener('beforeunload', this.handleUnload);
    }

    this.openSocket();
  }

  setName(name: string): void {
    const cleaned = sanitizeName(name, this.name);
    if (cleaned === this.name) return;
    this.name = cleaned;
    this.publishProfile(monotonicNow());
  }

  setColor(colorIdx: number): void {
    const normalized = Math.abs(Math.trunc(colorIdx)) % BIKE_PALETTES.length;
    if (normalized === this.colorIdx) return;
    this.colorIdx = normalized;
    this.publishProfile(monotonicNow());
  }

  setAvatar(avatarIdx: number): void {
    if (!Number.isFinite(avatarIdx)) return;
    const normalized = normalizeAvatar(avatarIdx);
    if (normalized === this.avatarIdx) return;
    this.avatarIdx = normalized;
    this.publishProfile(monotonicNow());
  }

  setCustomAvatar(dataUrl: string | null): void {
    const next = dataUrl && isValidCustomAvatarDataUrl(dataUrl) ? dataUrl : null;
    if (next === this.customAvatar) return;
    this.customAvatar = next;
    this.publishCustomAvatar();
  }

  tick(local: RiderRenderState, nowMs: number, dt: number): void {
    if (this.disposed) return;

    const clockMs = this.resolveClockMs(nowMs);
    const clampedDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);

    // 1. Check initial pack discovery window (fires at most once)
    this.checkInitialDiscovery(clockMs);

    // 2. Adaptive local state publish (15Hz active / 2.5Hz idle) & retained profile refresh
    if (this.isConnected()) {
      const kos = Math.max(0, Math.trunc(local.kos));
      if (kos !== this.lastPublishedKos || clockMs - this.lastProfilePublishMs >= PROFILE_REFRESH_MS) {
        this.lastPublishedKos = kos;
        this.publishProfile(clockMs);
      }

      const isActive =
        Math.abs(local.speed) > 0.6 ||
        Math.abs(local.vx) > 0.15 ||
        local.attackSide !== 0 ||
        local.y > 0.05 ||
        local.nitroActive ||
        local.crashed ||
        local.wheelieCharge > 0.05 ||
        local.spinOutTimer > 0 ||
        local.turboShieldTimer > 0 ||
        local.magnetTimer > 0;

      const edgeTriggered =
        (local.attackSide !== 0 && local.attackSide !== this.prevLocalAttackSide) ||
        local.crashed !== this.prevLocalCrashed;

      const minInterval = edgeTriggered ? EDGE_PUBLISH_MIN_MS : isActive ? ACTIVE_PUBLISH_MS : IDLE_PUBLISH_MS;
      if (clockMs - this.lastStatePublishMs >= minInterval) {
        this.publishState(local);
        this.lastStatePublishMs = clockMs;
        this.prevLocalAttackSide = local.attackSide;
        this.prevLocalCrashed = local.crashed;
      }
    }

    // 3. Prune stale remote peers & advance smooth dead-reckoning / interpolation (zero array alloc)
    this.remoteList.length = 0;
    for (const [peerId, peer] of this.peers) {
      if (clockMs - peer.lastStateAt > PEER_TIMEOUT_MS) {
        this.peers.delete(peerId);
        if (this.customAvatars.delete(peerId)) {
          this.callbacks.onRemoteCustomAvatar?.(peerId, null);
        }
        continue;
      }
      this.integrateRemotePeer(peer, clockMs, clampedDt);
      this.remoteList.push(peer.render);
    }
  }

  publishHit(ev: Omit<CombatHitEvent, 't' | 'from' | 'fromName' | 'ts'>): void {
    if (this.disposed || !this.isConnected()) return;
    const packet: CombatHitEvent = {
      t: 'hit',
      from: this.clientId,
      fromName: this.name,
      to: ev.to,
      dmg: ev.dmg,
      side: ev.side,
      weapon: ev.weapon,
      knockX: ev.knockX,
      ko: ev.ko,
      s: ev.s,
      x: ev.x,
      ts: Date.now(),
    };
    const payload = textEncoder.encode(JSON.stringify(packet));
    this.sendRaw(buildPublishPacket(this.topicEventsBytes, payload, false));
  }

  publishItemEvent(ev: Omit<ItemNetEvent, 'from' | 'fromName' | 'ts'>): void {
    if (this.disposed || !this.isConnected()) return;
    const packet: ItemNetEvent = {
      ...ev,
      from: this.clientId,
      fromName: this.name,
      ts: Date.now(),
    };
    const payload = textEncoder.encode(JSON.stringify(packet));
    this.sendRaw(buildPublishPacket(this.topicEventsBytes, payload, false));
  }

  getRemoteRiders(): RiderRenderState[] {
    return this.remoteList;
  }

  getOnlineCount(): number {
    return 1 + this.peers.size;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  computeSpawnBehindLastPlayer(): PackSpawnTarget | null {
    const clockMs = monotonicNow();
    let lastPeer: RemotePeer | null = null;
    let minS = Infinity;
    let lastPeerAgeSec = 0;

    for (const peer of this.peers.values()) {
      if (!peer.hasLiveState) continue;
      const ageMs = clockMs - peer.lastStateAt;
      if (ageMs > PEER_TIMEOUT_MS) continue;

      const ageSec = Math.max(0, (clockMs - peer.currSnap.arrivalMs) / 1000);
      const leadSec = Math.min(ageSec, MAX_LEAD_S_SEC);
      const liveS = peer.currSnap.s + peer.currSnap.speed * leadSec;

      if (liveS < minS) {
        minS = liveS;
        lastPeer = peer;
        lastPeerAgeSec = ageSec;
      }
    }

    if (!lastPeer || !Number.isFinite(minS)) return null;

    const spawnS = Math.max(0, minS - dsForMeters(minS, SPAWN_BEHIND_METERS));
    const peerLiveX = lastPeer.currSnap.x + lastPeer.currSnap.vx * Math.min(lastPeerAgeSec, MAX_LEAD_X_SEC);
    const shiftedX = peerLiveX >= 0 ? peerLiveX - SPAWN_LATERAL_SHIFT : peerLiveX + SPAWN_LATERAL_SHIFT;
    const spawnX = clamp(shiftedX, -SPAWN_X_LIMIT, SPAWN_X_LIMIT);
    const spawnSpeed = Math.max(SPAWN_MIN_SPEED, lastPeer.currSnap.speed * 0.96);

    return {
      targetId: lastPeer.id,
      targetName: lastPeer.render.name,
      s: spawnS,
      x: spawnX,
      speed: spawnSpeed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.handleUnload);
      window.removeEventListener('beforeunload', this.handleUnload);
    }

    this.sendCleanDisconnect(true);
    this.clearTimers();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      this.mqttConnected = false;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close(1000);
      } catch {
        // Ignore teardown errors
      }
    }

    this.rxRemainder = null;
    this.peers.clear();
    this.profiles.clear();
    this.customAvatars.clear();
    this.remoteList.length = 0;
    this.setStatus('offline');
  }

  // ---- Native MQTT 3.1.1 WebSocket Transport ----

  private isConnected(): boolean {
    return this.mqttConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private nextPacketId(): number {
    const id = this.packetId;
    this.packetId = id >= 0xffff ? 1 : id + 1;
    return id;
  }

  private openSocket(): void {
    if (this.disposed) return;

    this.clearTimers();
    this.mqttConnected = false;
    this.awaitingPingResp = false;
    this.rxRemainder = null;
    this.setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(BROKER_URL, 'mqtt');
    } catch {
      this.setStatus('offline');
      this.scheduleReconnect();
      return;
    }

    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || this.mqttConnected) return;
      try {
        ws.close();
      } catch {
        // Ignore
      }
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.disposed || this.ws !== ws) return;
      this.sendRaw(buildConnectPacket(this.clientId, this.topicProfile));
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.disposed || this.ws !== ws) return;
      if (ev.data instanceof ArrayBuffer) {
        this.processIncomingBytes(new Uint8Array(ev.data));
      } else if (ev.data instanceof Blob) {
        void ev.data.arrayBuffer().then((ab) => {
          if (!this.disposed && this.ws === ws) {
            this.processIncomingBytes(new Uint8Array(ab));
          }
        });
      }
    };

    ws.onerror = () => {
      // Quietly handled; onclose drives clean exponential backoff reconnect.
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.mqttConnected = false;
      this.rxRemainder = null;
      this.clearTimers();
      if (!this.disposed) {
        this.setStatus('offline');
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (1 << Math.min(this.reconnectAttempt, 4)));
    const jitter = base * (0.85 + Math.random() * 0.3);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) {
        this.openSocket();
      }
    }, Math.round(jitter));
  }

  private startKeepalive(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.awaitingPingResp = false;
    this.pingTimer = setInterval(() => {
      if (this.disposed || !this.isConnected()) return;
      this.awaitingPingResp = true;
      this.sendRaw(PKT_PINGREQ);
      if (this.pingTimeoutTimer !== null) clearTimeout(this.pingTimeoutTimer);
      this.pingTimeoutTimer = setTimeout(() => {
        if (!this.disposed && this.awaitingPingResp && this.ws) {
          try {
            this.ws.close();
          } catch {
            // Trigger clean reconnect
          }
        }
      }, PING_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pingTimeoutTimer !== null) {
      clearTimeout(this.pingTimeoutTimer);
      this.pingTimeoutTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendRaw(buf: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(buf);
    } catch {
      // Socket closing; onclose will recover
    }
  }

  private processIncomingBytes(chunk: Uint8Array): void {
    let buf: Uint8Array;
    if (this.rxRemainder !== null) {
      const merged = new Uint8Array(this.rxRemainder.byteLength + chunk.byteLength);
      merged.set(this.rxRemainder, 0);
      merged.set(chunk, this.rxRemainder.byteLength);
      this.rxRemainder = null;
      buf = merged;
    } else {
      buf = chunk;
    }

    let offset = 0;
    const total = buf.byteLength;

    while (offset < total) {
      const header = buf[offset];
      let multiplier = 1;
      let remaining = 0;
      let pos = offset + 1;
      let varintDone = false;

      while (pos < total) {
        const encoded = buf[pos++];
        remaining += (encoded & 0x7f) * multiplier;
        if ((encoded & 0x80) === 0) {
          varintDone = true;
          break;
        }
        multiplier *= 128;
        if (multiplier > 2_097_152) {
          // Malformed MQTT remaining length -> reset connection
          this.ws?.close();
          return;
        }
      }

      if (!varintDone) {
        this.rxRemainder = buf.slice(offset);
        return;
      }

      if (remaining > MAX_INCOMING_PACKET_BYTES) {
        // Protect memory against oversized frames on public broker
        this.ws?.close();
        return;
      }

      const packetEnd = pos + remaining;
      if (packetEnd > total) {
        this.rxRemainder = buf.slice(offset);
        return;
      }

      this.dispatchControlPacket(header, buf, pos, packetEnd);
      offset = packetEnd;
    }
  }

  private dispatchControlPacket(header: number, buf: Uint8Array, bodyStart: number, bodyEnd: number): void {
    const type = header >>> 4;

    switch (type) {
      case 2: {
        // CONNACK
        if (bodyEnd - bodyStart < 2) return;
        const returnCode = buf[bodyStart + 1];
        if (this.connectTimer !== null) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        if (returnCode !== 0) {
          this.ws?.close();
          return;
        }
        this.mqttConnected = true;
        this.reconnectAttempt = 0;
        this.didSendBye = false;
        this.setStatus('online');
        this.startKeepalive();

        // Subscribe to room wildcard (QoS 0)
        this.sendRaw(buildSubscribePacket(this.nextPacketId(), this.topicWildcard));
        this.publishProfile(monotonicNow());
        if (this.customAvatar !== null) {
          this.publishCustomAvatar();
        }
        this.lastStatePublishMs = -Infinity;
        return;
      }

      case 9: {
        // SUBACK
        if (bodyEnd - bodyStart < 3) return;
        const granted = buf[bodyStart + 2];
        if (granted !== 0x80 && !this.initialSpawnDone && this.subackAtMs === null) {
          this.subackAtMs = monotonicNow();
        }
        return;
      }

      case 3: {
        // PUBLISH
        if (bodyEnd - bodyStart < 2) return;
        const qos = (header >>> 1) & 0x03;
        const isRetained = (header & 0x01) !== 0;
        const topicLen = (buf[bodyStart] << 8) | buf[bodyStart + 1];
        const topicStart = bodyStart + 2;
        let payloadStart = topicStart + topicLen;
        if (payloadStart > bodyEnd) return;

        const topic = textDecoder.decode(buf.subarray(topicStart, payloadStart));

        if (qos > 0) {
          if (payloadStart + 2 > bodyEnd) return;
          if (qos === 1) {
            this.pubackBuf[2] = buf[payloadStart];
            this.pubackBuf[3] = buf[payloadStart + 1];
            this.sendRaw(this.pubackBuf);
          }
          payloadStart += 2;
        }

        const payload = buf.subarray(payloadStart, bodyEnd);
        this.handleMessage(topic, payload, isRetained);
        return;
      }

      case 13: {
        // PINGRESP
        this.awaitingPingResp = false;
        if (this.pingTimeoutTimer !== null) {
          clearTimeout(this.pingTimeoutTimer);
          this.pingTimeoutTimer = null;
        }
        return;
      }

      default:
        return;
    }
  }

  // ---- Application Sync Protocol ----

  private resolveClockMs(nowMs: number): number {
    const mono = monotonicNow();
    return Number.isFinite(nowMs) && Math.abs(nowMs - mono) < 5000 ? nowMs : mono;
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.callbacks.onStatus(next);
  }

  private sendCleanDisconnect(includeMqttDisconnect: boolean): void {
    if (this.didSendBye || !this.isConnected()) return;
    this.didSendBye = true;
    this.sendRaw(includeMqttDisconnect ? this.disposeCoalescedPacket : this.unloadCoalescedPacket);
  }

  private publishProfile(clockMs: number): void {
    if (!this.isConnected()) return;
    this.lastProfilePublishMs = clockMs;
    const payload = textEncoder.encode(
      JSON.stringify({
        n: this.name,
        c: this.colorIdx,
        a: this.avatarIdx,
        ko: this.lastPublishedKos,
        ts: Date.now(),
      })
    );
    this.sendRaw(buildPublishPacket(this.topicProfileBytes, payload, true));
  }

  private publishCustomAvatar(): void {
    if (!this.isConnected()) return;
    if (this.customAvatar === null) {
      this.sendRaw(this.clearAvatarPacket);
      return;
    }
    const payload = textEncoder.encode(this.customAvatar);
    this.sendRaw(buildPublishPacket(this.topicAvatarBytes, payload, true));
  }

  private publishState(local: RiderRenderState): void {
    const ws = this.ws;
    if (!this.mqttConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) return;

    const view = this.statePayloadView;
    const vxScaled = clamp(Math.round(local.vx * 100), -32768, 32767);
    const leanScaled = clamp(Math.round(local.lean * 1000), -32768, 32767);
    const hpByte = clamp(Math.round(local.hp), 0, 100);

    let flags = 0;
    flags |= local.weapon & 0x03;
    flags |= (local.attackSide & 0x03) << 2;
    if (local.nitroActive) flags |= 1 << 4;
    if (local.wheelie > 0.15) flags |= 1 << 5;
    if (local.crashed) flags |= 1 << 6;
    if (local.braking) flags |= 1 << 7;

    const attackPhaseByte = clamp(Math.round(local.attackPhase * 255), 0, 255);
    const seqByte = this.seq & 0xff;
    this.seq = (this.seq + 1) & 0xff;

    const wheelieChargeByte = clamp(Math.round(local.wheelieCharge * 255), 0, 255);
    let itemBits = 0;
    if (local.heldItem && isValidItemType(local.heldItem)) {
      itemBits |= (ITEM_BY_ID[local.heldItem].idx + 1) & 0x0f;
    }
    if (local.magnetTimer > 0) itemBits |= 1 << 4;
    if (local.turboShieldTimer > 0) itemBits |= 1 << 5;
    if (local.spinOutTimer > 0) itemBits |= 1 << 6;

    view.setFloat64(0, local.s, true);
    view.setFloat32(8, local.x, true);
    view.setFloat32(12, local.y, true);
    view.setFloat32(16, local.speed, true);
    view.setInt16(20, vxScaled, true);
    view.setInt16(22, leanScaled, true);
    view.setUint8(24, hpByte);
    view.setUint8(25, flags);
    view.setUint8(26, attackPhaseByte);
    view.setUint8(27, seqByte);
    view.setUint32(28, Date.now() >>> 0, true);
    view.setUint8(32, wheelieChargeByte);
    view.setUint8(33, itemBits);

    try {
      ws.send(this.statePacketBuf);
    } catch {
      // Socket closing; onclose will recover
    }
  }

  private handleMessage(topic: string, payload: Uint8Array, isRetained: boolean): void {
    if (topic.startsWith(this.statePrefix)) {
      if (isRetained) return; // Never accept retained state ghosts as live riders
      const peerId = topic.slice(this.statePrefix.length);
      if (!peerId || peerId === this.clientId) return;
      this.handleStatePacket(peerId, payload);
      return;
    }

    if (topic.startsWith(this.profilePrefix)) {
      const peerId = topic.slice(this.profilePrefix.length);
      if (!peerId || peerId === this.clientId) return;
      this.handleProfilePacket(peerId, payload);
      return;
    }

    if (topic.startsWith(this.avatarPrefix)) {
      const peerId = topic.slice(this.avatarPrefix.length);
      if (!peerId || peerId === this.clientId) return;
      this.handleCustomAvatarPacket(peerId, payload);
      return;
    }

    if (topic === this.topicEvents) {
      if (isRetained) return;
      this.handleEventPacket(payload);
    }
  }

  private handleStatePacket(peerId: string, payload: Uint8Array): void {
    if (payload.byteLength < STATE_PACKET_MIN_BYTES) return;

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const s = view.getFloat64(0, true);
    const x = view.getFloat32(8, true);
    const y = view.getFloat32(12, true);
    const speed = view.getFloat32(16, true);
    if (!Number.isFinite(s) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(speed)) {
      return;
    }

    const vx = view.getInt16(20, true) / 100;
    const lean = view.getInt16(22, true) / 1000;
    const hp = clamp(view.getUint8(24), 0, 100);
    const flags = view.getUint8(25);
    const weaponRaw = flags & 0x03;
    const weapon: WeaponType = weaponRaw === 1 || weaponRaw === 2 ? weaponRaw : 0;
    const attackSideRaw = (flags >> 2) & 0x03;
    const attackSide: 0 | 1 | 2 = attackSideRaw === 1 || attackSideRaw === 2 ? attackSideRaw : 0;
    const nitroActive = (flags & (1 << 4)) !== 0;
    const wheelie = (flags & (1 << 5)) !== 0;
    const crashed = (flags & (1 << 6)) !== 0;
    const braking = (flags & (1 << 7)) !== 0;
    const attackPhase = view.getUint8(26) / 255;
    const seq = view.getUint8(27);
    const sentTs = view.getUint32(28, true);
    const arrivalMs = monotonicNow();

    // Extended 34-byte fields (gracefully falls back for legacy 32-byte packets)
    let wheelieCharge = wheelie ? 0.65 : 0;
    let heldItem: ItemType | null = null;
    let magnetActive = false;
    let turboShield = false;
    let spinOut = false;
    if (payload.byteLength >= STATE_PACKET_BYTES) {
      wheelieCharge = view.getUint8(32) / 255;
      const itemBits = view.getUint8(33);
      const heldCode = itemBits & 0x0f;
      if (heldCode >= 1 && heldCode <= ITEMS.length) {
        heldItem = ITEMS[heldCode - 1].id;
      }
      magnetActive = (itemBits & (1 << 4)) !== 0;
      turboShield = (itemBits & (1 << 5)) !== 0;
      spinOut = (itemBits & (1 << 6)) !== 0;
    }

    const cx = clamp(x, -12, 12);
    const cy = clamp(y, 0, 8);
    const cspeed = clamp(speed, -10, 120);
    const cvx = clamp(vx, -40, 40);
    const clean = clamp(lean, -1.5, 1.5);

    const existing = this.peers.get(peerId);
    if (existing) {
      // Ignore stale / duplicate out-of-order packets (wrapping 8-bit seq) unless quiet for > 2s
      if (arrivalMs - existing.lastStateAt < 2000) {
        const diff = (seq - existing.lastSeq) & 0xff;
        if (diff === 0 || diff >= 128) return;
      }
      // Zero-GC in-place snapshot update
      copySnapshot(existing.prevSnap, existing.currSnap);
      const dst = existing.currSnap;
      dst.s = s;
      dst.x = cx;
      dst.y = cy;
      dst.speed = cspeed;
      dst.vx = cvx;
      dst.lean = clean;
      dst.hp = hp;
      dst.weapon = weapon;
      dst.attackSide = attackSide;
      dst.attackPhase = attackPhase;
      dst.nitroActive = nitroActive;
      dst.wheelie = wheelie;
      dst.crashed = crashed;
      dst.braking = braking;
      dst.wheelieCharge = wheelieCharge;
      dst.heldItem = heldItem;
      dst.magnetActive = magnetActive;
      dst.turboShield = turboShield;
      dst.spinOut = spinOut;
      dst.seq = seq;
      dst.sentTs = sentTs;
      dst.arrivalMs = arrivalMs;
      existing.lastSeq = seq;
      existing.lastStateAt = arrivalMs;
      return;
    }

    const currSnap = createEmptySnapshot();
    currSnap.s = s;
    currSnap.x = cx;
    currSnap.y = cy;
    currSnap.speed = cspeed;
    currSnap.vx = cvx;
    currSnap.lean = clean;
    currSnap.hp = hp;
    currSnap.weapon = weapon;
    currSnap.attackSide = attackSide;
    currSnap.attackPhase = attackPhase;
    currSnap.nitroActive = nitroActive;
    currSnap.wheelie = wheelie;
    currSnap.crashed = crashed;
    currSnap.braking = braking;
    currSnap.wheelieCharge = wheelieCharge;
    currSnap.heldItem = heldItem;
    currSnap.magnetActive = magnetActive;
    currSnap.turboShield = turboShield;
    currSnap.spinOut = spinOut;
    currSnap.seq = seq;
    currSnap.sentTs = sentTs;
    currSnap.arrivalMs = arrivalMs;

    const prevSnap = createEmptySnapshot();
    copySnapshot(prevSnap, currSnap);

    const profile = this.profiles.get(peerId);
    const name = profile ? profile.name : fallbackPeerName(peerId);
    const colorIdx = profile ? profile.colorIdx : hashString(peerId) % BIKE_PALETTES.length;
    const avatarIdx = profile ? profile.avatarIdx : colorIdx % AVATAR_COUNT;
    const kos = profile ? profile.kos : 0;
    const pendingCustomAvatar = this.customAvatars.get(peerId) ?? null;

    const render: RiderRenderState = {
      id: peerId,
      name,
      isLocal: false,
      isBot: false,
      colorIdx,
      avatarIdx,
      s,
      x: cx,
      y: cy,
      speed: cspeed,
      vx: cvx,
      lean: clean,
      hp,
      nitro: nitroActive ? 80 : 50,
      weapon,
      attackSide,
      attackPhase,
      nitroActive,
      wheelie: wheelieCharge > 0.02 ? wheelieCharge : wheelie ? 1 : 0,
      crashed,
      crashTimer: 0,
      braking,
      invulnTimer: 0,
      wheelAngle: 0,
      kos,
      heldItem,
      wheelieCharge,
      magnetTimer: magnetActive ? 1 : 0,
      turboShieldTimer: turboShield ? 1 : 0,
      spinOutTimer: spinOut ? 1.3 : 0,
      incomingLockName: null,
    };

    const peer: RemotePeer = {
      id: peerId,
      hasLiveState: true,
      customAvatar: pendingCustomAvatar,
      prevSnap,
      currSnap,
      lastSeq: seq,
      lastStateAt: arrivalMs,
      render,
    };
    this.peers.set(peerId, peer);

    if (pendingCustomAvatar !== null) {
      this.callbacks.onRemoteCustomAvatar?.(peerId, pendingCustomAvatar);
    }

    if (!this.initialSpawnDone) {
      if (this.firstLivePeerAtMs === null) {
        this.firstLivePeerAtMs = arrivalMs;
      }
      if (this.subackAtMs === null) {
        this.subackAtMs = arrivalMs;
      }
    } else {
      this.callbacks.onPeerEvent?.(`${name} JOINED`);
    }
  }

  private handleProfilePacket(peerId: string, payload: Uint8Array): void {
    if (payload.byteLength === 0) {
      this.removePeer(peerId);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(payload));
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as Record<string, unknown>;
    const rawName = typeof obj.n === 'string' ? obj.n : '';
    const name = sanitizeName(rawName, fallbackPeerName(peerId));
    const colorIdx =
      typeof obj.c === 'number' && Number.isFinite(obj.c)
        ? Math.abs(Math.trunc(obj.c)) % BIKE_PALETTES.length
        : hashString(peerId) % BIKE_PALETTES.length;
    const avatarIdx =
      typeof obj.a === 'number' && Number.isFinite(obj.a)
        ? normalizeAvatar(obj.a)
        : colorIdx % AVATAR_COUNT;
    const kos =
      typeof obj.ko === 'number' && Number.isFinite(obj.ko) && obj.ko >= 0
        ? Math.trunc(obj.ko)
        : 0;

    this.profiles.set(peerId, {
      name,
      colorIdx,
      avatarIdx,
      kos,
      updatedAt: monotonicNow(),
    });

    const peer = this.peers.get(peerId);
    if (peer) {
      peer.render.name = name;
      peer.render.colorIdx = colorIdx;
      peer.render.avatarIdx = avatarIdx;
      peer.render.kos = kos;
    }
  }

  private handleCustomAvatarPacket(peerId: string, payload: Uint8Array): void {
    if (payload.byteLength === 0) {
      this.customAvatars.delete(peerId);
      const peer = this.peers.get(peerId);
      if (peer) peer.customAvatar = null;
      this.callbacks.onRemoteCustomAvatar?.(peerId, null);
      return;
    }

    const raw = textDecoder.decode(payload);
    const valid = isValidCustomAvatarDataUrl(raw) ? raw : null;
    if (valid !== null) {
      if (!this.customAvatars.has(peerId) && this.customAvatars.size >= MAX_CACHED_CUSTOM_AVATARS) {
        const oldestKey = this.customAvatars.keys().next().value;
        if (oldestKey !== undefined) {
          this.customAvatars.delete(oldestKey);
        }
      }
      this.customAvatars.set(peerId, valid);
    } else {
      this.customAvatars.delete(peerId);
    }

    const peer = this.peers.get(peerId);
    if (peer) {
      peer.customAvatar = valid;
    }
    this.callbacks.onRemoteCustomAvatar?.(peerId, valid);
  }

  private handleEventPacket(payload: Uint8Array): void {
    if (payload.byteLength === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(payload));
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as Record<string, unknown>;

    if (obj.t === 'bye') {
      if (typeof obj.id === 'string' && obj.id !== this.clientId) {
        this.removePeer(obj.id);
      }
      return;
    }

    if (obj.t === 'hit') {
      if (typeof obj.from !== 'string' || obj.from === this.clientId) return;
      if (obj.to !== this.clientId) return;

      const dmg = typeof obj.dmg === 'number' && Number.isFinite(obj.dmg) ? clamp(obj.dmg, 0, 200) : 0;
      const knockX = typeof obj.knockX === 'number' && Number.isFinite(obj.knockX) ? clamp(obj.knockX, -30, 30) : 0;
      const side: 1 | 2 = obj.side === 1 ? 1 : 2;
      const weapon: WeaponType = obj.weapon === 1 || obj.weapon === 2 ? obj.weapon : 0;
      const s = typeof obj.s === 'number' && Number.isFinite(obj.s) ? obj.s : 0;
      const x = typeof obj.x === 'number' && Number.isFinite(obj.x) ? obj.x : 0;
      const fromName =
        typeof obj.fromName === 'string' && obj.fromName.trim().length > 0
          ? sanitizeName(obj.fromName, fallbackPeerName(obj.from))
          : this.profiles.get(obj.from)?.name ?? fallbackPeerName(obj.from);
      const ts = typeof obj.ts === 'number' && Number.isFinite(obj.ts) ? obj.ts : Date.now();

      this.callbacks.onIncomingHit({
        t: 'hit',
        from: obj.from,
        fromName,
        to: this.clientId,
        dmg,
        side,
        weapon,
        knockX,
        ko: Boolean(obj.ko),
        s,
        x,
        ts,
      });
      return;
    }

    if (obj.t === 'item_pick' || obj.t === 'item_use' || obj.t === 'item_hit' || obj.t === 'item_miss') {
      if (typeof obj.from !== 'string' || obj.from === this.clientId) return;
      if (!isValidItemType(obj.item)) return;

      const fromName =
        typeof obj.fromName === 'string' && obj.fromName.trim().length > 0
          ? sanitizeName(obj.fromName, fallbackPeerName(obj.from))
          : this.profiles.get(obj.from)?.name ?? fallbackPeerName(obj.from);
      const s = typeof obj.s === 'number' && Number.isFinite(obj.s) ? obj.s : 0;
      const x = typeof obj.x === 'number' && Number.isFinite(obj.x) ? clamp(obj.x, -12, 12) : 0;
      const ts = typeof obj.ts === 'number' && Number.isFinite(obj.ts) ? obj.ts : Date.now();

      const ev: ItemNetEvent = {
        t: obj.t,
        from: obj.from,
        fromName,
        item: obj.item,
        s,
        x,
        ts,
      };
      if (typeof obj.to === 'string' && obj.to.length > 0) ev.to = obj.to;
      if (typeof obj.toName === 'string' && obj.toName.trim().length > 0) {
        ev.toName = sanitizeName(obj.toName, '');
      }
      if (typeof obj.dmg === 'number' && Number.isFinite(obj.dmg)) {
        ev.dmg = clamp(obj.dmg, 0, 200);
      }
      if (typeof obj.knockX === 'number' && Number.isFinite(obj.knockX)) {
        ev.knockX = clamp(obj.knockX, -40, 40);
      }
      if (typeof obj.ko === 'boolean') ev.ko = obj.ko;
      if (typeof obj.seed === 'number' && Number.isFinite(obj.seed)) ev.seed = obj.seed;

      this.callbacks.onItemEvent?.(ev);
    }
  }

  private removePeer(peerId: string): void {
    const existing = this.peers.get(peerId);
    this.peers.delete(peerId);
    this.profiles.delete(peerId);
    if (this.customAvatars.delete(peerId)) {
      this.callbacks.onRemoteCustomAvatar?.(peerId, null);
    }
    if (existing && this.initialSpawnDone) {
      this.callbacks.onPeerEvent?.(`${existing.render.name} LEFT`);
    }
  }

  private checkInitialDiscovery(clockMs: number): void {
    if (this.initialSpawnDone || this.subackAtMs === null) return;

    const sinceSuback = clockMs - this.subackAtMs;
    const sinceFirstLive = this.firstLivePeerAtMs !== null ? clockMs - this.firstLivePeerAtMs : -1;

    if (sinceSuback >= DISCOVERY_MAX_MS || (this.firstLivePeerAtMs !== null && sinceFirstLive >= DISCOVERY_AFTER_FIRST_PEER_MS)) {
      this.initialSpawnDone = true;
      const target = this.computeSpawnBehindLastPlayer();
      if (target) {
        this.callbacks.onInitialPackSpawn(target);
      }
    }
  }

  private integrateRemotePeer(peer: RemotePeer, clockMs: number, dt: number): void {
    const snap = peer.currSnap;
    const r = peer.render;

    const ageSec = Math.max(0, (clockMs - snap.arrivalMs) / 1000);
    const leadS = Math.min(ageSec, MAX_LEAD_S_SEC);
    const leadX = Math.min(ageSec, MAX_LEAD_X_SEC);

    const targetS = snap.s + snap.speed * leadS;
    const targetX = clamp(snap.x + snap.vx * leadX, -11.2, 11.2);
    const targetY = snap.y;

    const errS = targetS - r.s;
    if (Math.abs(errS) > TELEPORT_SNAP_S) {
      // Peer regrouped or teleported; snap cleanly without streaking across highway
      r.s = targetS;
      r.x = targetX;
      r.y = targetY;
      r.speed = snap.speed;
      r.vx = snap.vx;
      r.lean = snap.lean;
    } else {
      // Smooth velocity dead-reckoning + exponential spring pull (zero rubberbanding)
      const extrapWeightS = ageSec <= MAX_LEAD_S_SEC ? 1 : Math.max(0, 1 - (ageSec - MAX_LEAD_S_SEC) / 0.35);
      r.s += r.speed * dt * extrapWeightS;
      r.s += (targetS - r.s) * Math.min(1, dt * 10);

      if (ageSec <= MAX_LEAD_X_SEC) {
        r.x += r.vx * dt;
      }
      r.x += (targetX - r.x) * Math.min(1, dt * 14);
      r.y += (targetY - r.y) * Math.min(1, dt * 18);
      if (r.y < 0.01 && targetY <= 0.01) r.y = 0;

      r.speed += (snap.speed - r.speed) * Math.min(1, dt * 12);
      r.vx += (snap.vx - r.vx) * Math.min(1, dt * 14);
      r.lean += (snap.lean - r.lean) * Math.min(1, dt * 14);
    }

    r.wheelAngle += (Math.max(0, r.speed) / WHEEL_RADIUS) * dt;
    r.hp = snap.hp;
    r.weapon = snap.weapon;
    r.nitroActive = snap.nitroActive;
    r.nitro = snap.nitroActive ? 80 : 50;
    r.braking = snap.braking;

    r.wheelieCharge += (snap.wheelieCharge - r.wheelieCharge) * Math.min(1, dt * 14);
    const wheelieTarget = snap.wheelieCharge > 0.02 ? snap.wheelieCharge : snap.wheelie ? 1 : 0;
    r.wheelie += (wheelieTarget - r.wheelie) * Math.min(1, dt * 12);

    r.heldItem = snap.heldItem;
    r.magnetTimer = snap.magnetActive ? 1 : 0;
    r.turboShieldTimer = snap.turboShield ? 1 : 0;
    if (snap.spinOut) {
      r.spinOutTimer = r.spinOutTimer > 0 ? Math.max(0.05, r.spinOutTimer - dt) : 1.3;
    } else {
      r.spinOutTimer = 0;
    }
    r.incomingLockName = null;

    // Smooth melee swing progression between state snapshots
    if (snap.attackSide !== 0) {
      if (r.attackSide !== snap.attackSide) {
        r.attackSide = snap.attackSide;
        r.attackPhase = snap.attackPhase;
      } else {
        const predictedPhase = Math.min(1, r.attackPhase + dt * 3.4);
        const snapAdvance = Math.min(1, snap.attackPhase + Math.min(ageSec, 0.12) * 3.4);
        r.attackPhase = predictedPhase + (snapAdvance - predictedPhase) * Math.min(1, dt * 18);
      }
    } else {
      r.attackSide = 0;
      r.attackPhase = 0;
    }

    // Track wipeout tumble animation & post-recovery blink locally
    if (snap.crashed) {
      if (!r.crashed) {
        r.crashed = true;
        r.crashTimer = 0;
      } else {
        r.crashTimer += dt;
      }
      r.invulnTimer = 0;
    } else {
      if (r.crashed) {
        r.crashed = false;
        r.crashTimer = 0;
        r.invulnTimer = 1.6;
      } else if (r.invulnTimer > 0) {
        r.invulnTimer = Math.max(0, r.invulnTimer - dt);
      }
    }
  }
}
