import mqtt, { type IPublishPacket, type MqttClient } from 'mqtt';
import { BIKE_PALETTES, type CombatHitEvent, type RiderRenderState, type WeaponType } from '../game/types';
import { ROAD_HALF_WIDTH, dsForMeters } from '../game/RoadMath';
import { AVATAR_COUNT } from '../game/PixelAvatars';

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
}

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const TOPIC_VERSION = 'vmoto/v2';
const STATE_PACKET_BYTES = 32;

const ACTIVE_PUBLISH_MS = 50; // 20Hz while riding / attacking
const IDLE_PUBLISH_MS = 250; // 4Hz while stationary so newcomers discover parked riders fast
const EDGE_PUBLISH_MIN_MS = 25;
const PROFILE_REFRESH_MS = 10_000;
const PEER_TIMEOUT_MS = 6_500;

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
  seq: number;
  sentTs: number;
  arrivalMs: number;
}

interface RemotePeer {
  id: string;
  hasLiveState: boolean;
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

function decodeUtf8(payload: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(payload);
  }
  let out = '';
  for (let i = 0; i < payload.length; i++) {
    out += String.fromCharCode(payload[i]);
  }
  return out;
}

export class MqttSync {
  readonly clientId: string;
  readonly room: string;

  private readonly callbacks: MqttCallbacks;
  private readonly topicPrefix: string;
  private readonly topicState: string;
  private readonly topicProfile: string;
  private readonly topicEvents: string;
  private readonly topicWildcard: string;
  private readonly statePrefix: string;
  private readonly profilePrefix: string;

  private client: MqttClient | null = null;
  private status: ConnectionStatus = 'offline';
  private disposed = false;
  private didSendBye = false;

  private name: string;
  private colorIdx: number;
  private avatarIdx: number;
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
  private readonly peers = new Map<string, RemotePeer>();
  private readonly remoteList: RiderRenderState[] = [];

  private readonly handleUnload = (): void => {
    this.sendCleanDisconnect();
  };

  constructor(initialName: string, colorIdx: number, initialAvatar: number, callbacks: MqttCallbacks) {
    this.clientId = generateClientId();
    this.room = readRoomFromLocation();
    this.callbacks = callbacks;

    this.name = sanitizeName(initialName, fallbackPeerName(this.clientId));
    this.colorIdx = Math.abs(Math.trunc(colorIdx)) % BIKE_PALETTES.length;
    this.avatarIdx = Number.isFinite(initialAvatar)
      ? normalizeAvatar(initialAvatar)
      : this.colorIdx % AVATAR_COUNT;

    this.topicPrefix = `${TOPIC_VERSION}/${this.room}`;
    this.topicState = `${this.topicPrefix}/s/${this.clientId}`;
    this.topicProfile = `${this.topicPrefix}/p/${this.clientId}`;
    this.topicEvents = `${this.topicPrefix}/e`;
    this.topicWildcard = `${this.topicPrefix}/#`;
    this.statePrefix = `${this.topicPrefix}/s/`;
    this.profilePrefix = `${this.topicPrefix}/p/`;
  }

  connect(): void {
    if (this.disposed || this.client) return;

    this.didSendBye = false;
    this.setStatus('connecting');

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.handleUnload);
      window.addEventListener('beforeunload', this.handleUnload);
    }

    const client = mqtt.connect(BROKER_URL, {
      clientId: this.clientId,
      clean: true,
      keepalive: 20,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
      queueQoSZero: false,
      will: {
        topic: this.topicProfile,
        payload: '' as unknown as Buffer,
        qos: 0,
        retain: true,
      },
    });
    this.client = client;

    client.on('connect', () => {
      if (this.disposed || this.client !== client) return;
      this.didSendBye = false;
      this.setStatus('online');

      client.subscribe(this.topicWildcard, { qos: 0 }, (err) => {
        if (err || this.disposed || this.client !== client) return;
        if (!this.initialSpawnDone && this.subackAtMs === null) {
          this.subackAtMs = monotonicNow();
        }
      });

      this.publishProfile(monotonicNow());
      // Force immediate state broadcast on next tick
      this.lastStatePublishMs = -Infinity;
    });

    client.on('reconnect', () => {
      if (this.disposed || this.client !== client) return;
      this.setStatus('connecting');
    });

    client.on('offline', () => {
      if (this.disposed || this.client !== client) return;
      this.setStatus('offline');
    });

    client.on('close', () => {
      if (this.disposed || this.client !== client) return;
      if (this.status === 'online') {
        this.setStatus('offline');
      }
    });

    client.on('error', () => {
      if (this.disposed || this.client !== client) return;
      // Keep quiet in console; mqtt.js auto-reconnects smoothly.
    });

    client.on('message', (topic: string, payload: Buffer, packet: IPublishPacket) => {
      if (this.disposed || this.client !== client) return;
      this.handleMessage(topic, payload, packet);
    });
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

  tick(local: RiderRenderState, nowMs: number, dt: number): void {
    if (this.disposed) return;

    const clockMs = this.resolveClockMs(nowMs);
    const clampedDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);

    // 1. Check initial pack discovery window (fires at most once)
    this.checkInitialDiscovery(clockMs);

    // 2. Adaptive local state publish & retained profile refresh
    if (this.client?.connected) {
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
        local.crashed;

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

    // 3. Prune stale remote peers & advance smooth dead-reckoning / interpolation
    this.remoteList.length = 0;
    for (const [peerId, peer] of this.peers) {
      if (clockMs - peer.lastStateAt > PEER_TIMEOUT_MS) {
        this.peers.delete(peerId);
        continue;
      }
      this.integrateRemotePeer(peer, clockMs, clampedDt);
      this.remoteList.push(peer.render);
    }
  }

  publishHit(ev: Omit<CombatHitEvent, 't' | 'from' | 'fromName' | 'ts'>): void {
    if (this.disposed || !this.client?.connected) return;
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
    this.client.publish(this.topicEvents, JSON.stringify(packet), { qos: 0, retain: false });
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

    this.sendCleanDisconnect();

    if (this.client) {
      const c = this.client;
      this.client = null;
      try {
        c.end(false);
      } catch {
        // Ignore teardown errors
      }
    }

    this.peers.clear();
    this.profiles.clear();
    this.remoteList.length = 0;
    this.setStatus('offline');
  }

  private resolveClockMs(nowMs: number): number {
    const mono = monotonicNow();
    // Accept caller's rAF/monotonic timestamp when on the same origin; otherwise stay on monotonicNow().
    return Number.isFinite(nowMs) && Math.abs(nowMs - mono) < 5000 ? nowMs : mono;
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.callbacks.onStatus(next);
  }

  private sendCleanDisconnect(): void {
    if (this.didSendBye || !this.client?.connected) return;
    this.didSendBye = true;
    try {
      this.client.publish(
        this.topicEvents,
        JSON.stringify({ t: 'bye', id: this.clientId }),
        { qos: 0, retain: false }
      );
      this.client.publish(this.topicProfile, '', { qos: 0, retain: true });
    } catch {
      // Best-effort during unload
    }
  }

  private publishProfile(clockMs: number): void {
    if (!this.client?.connected) return;
    this.lastProfilePublishMs = clockMs;
    const payload = JSON.stringify({
      n: this.name,
      c: this.colorIdx,
      a: this.avatarIdx,
      ko: this.lastPublishedKos,
      ts: Date.now(),
    });
    this.client.publish(this.topicProfile, payload, { qos: 0, retain: true });
  }

  private publishState(local: RiderRenderState): void {
    if (!this.client?.connected) return;

    // Fresh 32-byte packet per send (20Hz max = 640 B/s) avoids aliasing across corked stream writes.
    const bytes = new Uint8Array(STATE_PACKET_BYTES);
    const view = new DataView(bytes.buffer);

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

    this.client.publish(this.topicState, bytes as unknown as Buffer, { qos: 0, retain: false });
  }

  private handleMessage(topic: string, payload: Uint8Array, packet: IPublishPacket): void {
    const isRetained = Boolean(packet?.retain);

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

    if (topic === this.topicEvents) {
      if (isRetained) return;
      this.handleEventPacket(payload);
    }
  }

  private handleStatePacket(peerId: string, payload: Uint8Array): void {
    if (payload.byteLength < STATE_PACKET_BYTES) return;

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
    const snap: StateSnapshot = {
      s,
      x: clamp(x, -12, 12),
      y: clamp(y, 0, 8),
      speed: clamp(speed, -10, 120),
      vx: clamp(vx, -40, 40),
      lean: clamp(lean, -1.5, 1.5),
      hp,
      weapon,
      attackSide,
      attackPhase,
      nitroActive,
      wheelie,
      crashed,
      braking,
      seq,
      sentTs,
      arrivalMs,
    };

    const existing = this.peers.get(peerId);
    if (existing) {
      // Ignore stale / duplicate out-of-order packets (wrapping 8-bit seq) unless quiet for > 2s
      if (arrivalMs - existing.lastStateAt < 2000) {
        const diff = (seq - existing.lastSeq) & 0xff;
        if (diff === 0 || diff >= 128) return;
      }
      existing.prevSnap = existing.currSnap;
      existing.currSnap = snap;
      existing.lastSeq = seq;
      existing.lastStateAt = arrivalMs;
      return;
    }

    const profile = this.profiles.get(peerId);
    const name = profile ? profile.name : fallbackPeerName(peerId);
    const colorIdx = profile ? profile.colorIdx : hashString(peerId) % BIKE_PALETTES.length;
    const avatarIdx = profile ? profile.avatarIdx : colorIdx % AVATAR_COUNT;
    const kos = profile ? profile.kos : 0;

    const render: RiderRenderState = {
      id: peerId,
      name,
      isLocal: false,
      isBot: false,
      colorIdx,
      avatarIdx,
      s: snap.s,
      x: snap.x,
      y: snap.y,
      speed: snap.speed,
      vx: snap.vx,
      lean: snap.lean,
      hp: snap.hp,
      nitro: snap.nitroActive ? 80 : 50,
      weapon: snap.weapon,
      attackSide: snap.attackSide,
      attackPhase: snap.attackPhase,
      nitroActive: snap.nitroActive,
      wheelie: snap.wheelie ? 1 : 0,
      crashed: snap.crashed,
      crashTimer: 0,
      braking: snap.braking,
      invulnTimer: 0,
      wheelAngle: 0,
      kos,
    };

    const peer: RemotePeer = {
      id: peerId,
      hasLiveState: true,
      prevSnap: snap,
      currSnap: snap,
      lastSeq: seq,
      lastStateAt: arrivalMs,
      render,
    };
    this.peers.set(peerId, peer);

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
      parsed = JSON.parse(decodeUtf8(payload));
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

  private handleEventPacket(payload: Uint8Array): void {
    if (payload.byteLength === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeUtf8(payload));
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
    }
  }

  private removePeer(peerId: string): void {
    const existing = this.peers.get(peerId);
    this.peers.delete(peerId);
    this.profiles.delete(peerId);
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

    const wheelieTarget = snap.wheelie ? 1 : 0;
    r.wheelie += (wheelieTarget - r.wheelie) * Math.min(1, dt * 10);

    // Smooth melee swing progression between 20Hz state snapshots
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
