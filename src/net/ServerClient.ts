import type { BlockType } from '../game/VoxelWorld';

export const DEFAULT_SERVER_URL = 'https://moto.linkof.link';
const STORAGE_SERVER_URL_KEY = 'vibemoto_server_url';
const STORAGE_AUTH_TOKEN_KEY = 'vibemoto_auth_token';
const STORAGE_AUTH_ACCOUNT_KEY = 'vibemoto_auth_account';

export interface GameAccount {
  id: string;
  username: string;
  displayName: string;
  colorIdx: number;
  avatarIdx: number;
  kos: number;
  blocksPlaced: number;
  blocksBroken: number;
  createdAt: number;
}

export interface ServerHealthInfo {
  ok: boolean;
  latencyMs: number;
  online: number;
  webOnline: number;
  mcOnline: number;
  accounts: number;
  totalBlocks: number;
  mcProtocol: string;
  mcPort: number;
  error?: string;
}

export type ServerConnStatus = 'disconnected' | 'connecting' | 'connected';

export interface ServerVoxelMsg {
  op: 'set' | 'del' | 'clear';
  gx?: number;
  gy?: number;
  gz?: number;
  b?: number;
  from?: string;
}

export interface ServerClientCallbacks {
  onStatusChange?(status: ServerConnStatus, url: string): void;
  onAccountChange?(account: GameAccount | null): void;
  onWorldSnapshot?(room: string, blocks: [number, number, number, number][]): void;
  onVoxelUpdate?(ev: ServerVoxelMsg): void;
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  }
  const isLocalOrIp =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(trimmed);
  return `${isLocalOrIp ? 'http' : 'https'}://${trimmed}`;
}

function toWsUrl(httpUrl: string): string {
  if (/^https:\/\//i.test(httpUrl)) {
    return httpUrl.replace(/^https:\/\//i, 'wss://');
  }
  return httpUrl.replace(/^http:\/\//i, 'ws://');
}

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, val: string): void {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // Ignore storage limits
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

export class ServerClient {
  private serverUrl: string;
  private token: string | null = null;
  private account: GameAccount | null = null;
  private status: ServerConnStatus = 'disconnected';
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private roomSlug = 'global';
  private clientId: string;
  private playerName: string;
  private disposed = false;
  private readonly cb: ServerClientCallbacks;

  constructor(clientId: string, playerName: string, cb: ServerClientCallbacks) {
    this.clientId = clientId;
    this.playerName = playerName;
    this.cb = cb;

    const savedUrl = safeRead(STORAGE_SERVER_URL_KEY);
    this.serverUrl = savedUrl ? normalizeServerUrl(savedUrl) : DEFAULT_SERVER_URL;
    this.token = safeRead(STORAGE_AUTH_TOKEN_KEY);
    const savedAcc = safeRead(STORAGE_AUTH_ACCOUNT_KEY);
    if (savedAcc) {
      try {
        this.account = JSON.parse(savedAcc) as GameAccount;
      } catch {
        this.account = null;
      }
    }
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getAccount(): GameAccount | null {
    return this.account;
  }

  getStatus(): ServerConnStatus {
    return this.status;
  }

  setPlayerName(name: string): void {
    this.playerName = name;
  }

  setServerUrl(rawUrl: string): string {
    const next = normalizeServerUrl(rawUrl);
    if (next !== this.serverUrl) {
      this.serverUrl = next;
      safeWrite(STORAGE_SERVER_URL_KEY, next);
      // Clear cached auth token from previous server unless verified
      this.clearAuth(false);
    }
    this.reconnectNow();
    return this.serverUrl;
  }

  resetDefaultServerUrl(): string {
    safeRemove(STORAGE_SERVER_URL_KEY);
    this.serverUrl = DEFAULT_SERVER_URL;
    this.reconnectNow();
    return this.serverUrl;
  }

  connectRoom(roomSlug: string): void {
    this.roomSlug = roomSlug || 'global';
    this.reconnectNow();
  }

  async pingServer(customUrl?: string): Promise<ServerHealthInfo> {
    const base = customUrl ? normalizeServerUrl(customUrl) : this.serverUrl;
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${base}/api/health`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      window.clearTimeout(timer);
      const latencyMs = Math.max(1, Math.round(performance.now() - t0));
      if (!res.ok) {
        return {
          ok: false,
          latencyMs,
          online: 0,
          webOnline: 0,
          mcOnline: 0,
          accounts: 0,
          totalBlocks: 0,
          mcProtocol: '',
          mcPort: 25565,
          error: `HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as Record<string, unknown>;
      return {
        ok: Boolean(data.ok),
        latencyMs,
        online: Number(data.online) || 0,
        webOnline: Number(data.webOnline) || 0,
        mcOnline: Number(data.mcOnline) || 0,
        accounts: Number(data.accounts) || 0,
        totalBlocks: Number(data.totalBlocks) || 0,
        mcProtocol: String(data.mcProtocol || '1.20.4'),
        mcPort: Number(data.mcPort) || 25565,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        online: 0,
        webOnline: 0,
        mcOnline: 0,
        accounts: 0,
        totalBlocks: 0,
        mcProtocol: '',
        mcPort: 25565,
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  async verifySession(): Promise<GameAccount | null> {
    if (!this.token) return null;
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          this.clearAuth(true);
        }
        return null;
      }
      const data = (await res.json()) as { account?: GameAccount };
      if (data.account) {
        this.saveAuth(this.token, data.account);
        return data.account;
      }
      return null;
    } catch {
      return this.account;
    }
  }

  async register(
    username: string,
    password: string,
    displayName: string,
    colorIdx: number,
    avatarIdx: number
  ): Promise<{ ok: boolean; account?: GameAccount; error?: string }> {
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName, colorIdx, avatarIdx }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        account?: GameAccount;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token || !data.account) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      this.saveAuth(data.token, data.account);
      this.reconnectNow();
      return { ok: true, account: data.account };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '无法连接服务器' };
    }
  }

  async login(
    username: string,
    password: string
  ): Promise<{ ok: boolean; account?: GameAccount; error?: string }> {
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        account?: GameAccount;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token || !data.account) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      this.saveAuth(data.token, data.account);
      this.reconnectNow();
      return { ok: true, account: data.account };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '无法连接服务器' };
    }
  }

  async syncProfile(patch: {
    displayName?: string;
    colorIdx?: number;
    avatarIdx?: number;
  }): Promise<void> {
    if (!this.token || !this.account) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = (await res.json()) as { account?: GameAccount };
        if (data.account) {
          this.saveAuth(this.token, data.account);
        }
      }
    } catch {
      // Ignore offline profile sync error
    }
  }

  logout(): void {
    this.clearAuth(true);
    this.reconnectNow();
  }

  sendVoxel(op: 'set' | 'del' | 'clear', gx = 0, gy = 0, gz = 0, b?: BlockType): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ t: 'vox', op, gx, gy, gz, b }));
    } catch {
      // Ignore send error
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnect();
    this.closeSocket();
  }

  private saveAuth(token: string, account: GameAccount): void {
    this.token = token;
    this.account = account;
    safeWrite(STORAGE_AUTH_TOKEN_KEY, token);
    safeWrite(STORAGE_AUTH_ACCOUNT_KEY, JSON.stringify(account));
    this.cb.onAccountChange?.(account);
  }

  private clearAuth(notify: boolean): void {
    this.token = null;
    this.account = null;
    safeRemove(STORAGE_AUTH_TOKEN_KEY);
    safeRemove(STORAGE_AUTH_ACCOUNT_KEY);
    if (notify) {
      this.cb.onAccountChange?.(null);
    }
  }

  private setStatus(next: ServerConnStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.cb.onStatusChange?.(next, this.serverUrl);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try {
        old.close(1000);
      } catch {
        // Ignore
      }
    }
  }

  private reconnectNow(): void {
    if (this.disposed) return;
    this.clearReconnect();
    this.closeSocket();
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = Math.min(15000, 1200 * Math.pow(1.6, this.reconnectAttempt));
    this.reconnectAttempt = Math.min(8, this.reconnectAttempt + 1);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private openSocket(): void {
    if (this.disposed) return;
    this.setStatus('connecting');

    const params = new URLSearchParams();
    params.set('room', this.roomSlug);
    params.set('cid', this.clientId);
    params.set('name', this.account?.displayName || this.playerName);
    if (this.token) {
      params.set('token', this.token);
    }

    const wsUrl = `${toWsUrl(this.serverUrl)}/ws?${params.toString()}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.setStatus('connected');
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.t === 'world_init' && Array.isArray(msg.blocks)) {
          this.cb.onWorldSnapshot?.(
            String(msg.room || this.roomSlug),
            msg.blocks as [number, number, number, number][]
          );
        } else if (msg.t === 'vox') {
          const op = msg.op;
          if (op === 'set' || op === 'del' || op === 'clear') {
            this.cb.onVoxelUpdate?.({
              op,
              gx: typeof msg.gx === 'number' ? msg.gx : 0,
              gy: typeof msg.gy === 'number' ? msg.gy : 0,
              gz: typeof msg.gz === 'number' ? msg.gz : 0,
              b: typeof msg.b === 'number' ? msg.b : undefined,
              from: typeof msg.from === 'string' ? msg.from : undefined,
            });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      // Handled in onclose
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }
}
