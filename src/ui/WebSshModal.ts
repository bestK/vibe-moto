import type { ServerClient } from '../net/ServerClient';
import { getLang } from '../i18n';
import { getPixelIconSvg } from './PixelIcons';

const STORAGE_SSH_CFG_KEY = 'vibemoto_webssh_saved_cfg_v1';
const MAX_TERMINAL_CHARS = 48000;

interface SavedSshConfig {
  host: string;
  port: number;
  username: string;
  authMode: 'password' | 'key';
  password: string;
  privateKey: string;
}

export interface WebSshModalCallbacks {
  onToggle?(open: boolean): void;
  onToast?(msg: string, accent?: 'gold' | 'cyan' | 'red'): void;
}

/**
 * Cleanly strips ANSI/VT100 escape sequences (CSI, OSC, DCS, 2-byte ESC) and
 * control characters so raw SSH PTY streams render safely via textContent.
 */
export function stripAnsi(raw: string): string {
  return raw
    // OSC sequences: ESC ] ... (BEL or ST)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    // DCS / SOS / PM / APC sequences
    .replace(/\u001b[PX^_][^\u001b]*\u001b\\/g, '')
    // CSI sequences: ESC [ ... final byte
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    // Character set & 2-byte ESC sequences
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\u001b[()][0-9A-Za-z]/g, '')
    // Normalize CRLF -> LF, strip lone CR and NUL/BEL
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[\u0000\u0007]/g, '');
}

export class WebSshModal {
  private readonly serverClient: ServerClient;
  private readonly cb: WebSshModalCallbacks;

  private readonly overlayEl: HTMLDivElement;
  private readonly statusPillEl: HTMLSpanElement;
  private readonly hostInputEl: HTMLInputElement;
  private readonly portInputEl: HTMLInputElement;
  private readonly userInputEl: HTMLInputElement;
  private readonly authModeBtnEl: HTMLButtonElement;
  private readonly passInputEl: HTMLInputElement;
  private readonly keyInputEl: HTMLTextAreaElement;
  private readonly saveLocalCheckEl: HTMLInputElement;
  private readonly clearLocalBtnEl: HTMLButtonElement;
  private readonly connectBtnEl: HTMLButtonElement;
  private readonly errorEl: HTMLDivElement;
  private readonly termOutEl: HTMLPreElement;
  private readonly cmdInputEl: HTMLInputElement;
  private readonly sendBtnEl: HTMLButtonElement;

  private authMode: 'password' | 'key' = 'password';
  private modalOpen = false;
  private ws: WebSocket | null = null;
  private connected = false;
  private termBuffer = '';
  private cmdHistory: string[] = [];
  private historyIdx = -1;

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (!this.modalOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(
    container: HTMLElement,
    serverClient: ServerClient,
    callbacks: WebSshModalCallbacks = {}
  ) {
    this.serverClient = serverClient;
    this.cb = callbacks;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'vm-home-overlay vm-modal-wide';
    this.overlayEl.setAttribute('role', 'dialog');
    this.overlayEl.setAttribute('aria-modal', 'true');
    this.overlayEl.setAttribute('aria-label', 'WebSSH Computer Terminal');

    // Swallow all keyboard events bubbling inside the modal so gameplay hotkeys never trigger
    const stopKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      e.stopPropagation();
    };
    this.overlayEl.addEventListener('keydown', stopKey);
    this.overlayEl.addEventListener('keyup', (e: KeyboardEvent) => e.stopPropagation());
    this.overlayEl.addEventListener('keypress', (e: KeyboardEvent) => e.stopPropagation());
    this.overlayEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    const card = document.createElement('div');
    card.className = 'vm-slab vm-home-card';
    card.style.width = 'min(760px, calc(100vw - 20px))';
    card.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());

    // Header
    const head = document.createElement('div');
    head.className = 'vm-home-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'vm-home-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'vm-btn-icon';
    titleIcon.innerHTML = getPixelIconSvg('server');
    const titleText = document.createElement('span');
    titleText.textContent =
      getLang() === 'zh' ? 'VIBE 电脑终端 · WEBSSH' : 'VIBE COMPUTER · WEBSSH';
    titleWrap.append(titleIcon, titleText);

    const headRight = document.createElement('div');
    headRight.className = 'vm-home-status';

    this.statusPillEl = document.createElement('span');
    this.statusPillEl.className = 'vm-home-room-pill';
    this.statusPillEl.textContent = 'OFFLINE';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vm-home-btn vm-home-btn-resume';
    closeBtn.style.height = '28px';
    closeBtn.style.padding = '0 10px';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close (ESC)';
    closeBtn.addEventListener('click', () => this.close());

    headRight.append(this.statusPillEl, closeBtn);
    head.append(titleWrap, headRight);

    // Connection Bar
    const connBar = document.createElement('div');
    connBar.className = 'vm-ssh-bar';
    connBar.style.display = 'flex';
    connBar.style.flexDirection = 'column';
    connBar.style.gap = '6px';

    const connRow1 = document.createElement('div');
    connRow1.style.display = 'grid';
    connRow1.style.gridTemplateColumns = 'minmax(0, 2fr) 74px minmax(0, 1.2fr) auto';
    connRow1.style.gap = '6px';

    this.hostInputEl = document.createElement('input');
    this.hostInputEl.type = 'text';
    this.hostInputEl.className = 'vm-home-input';
    this.hostInputEl.placeholder = 'Host (e.g. 127.0.0.1)';
    this.hostInputEl.autocomplete = 'off';
    this.hostInputEl.spellcheck = false;

    this.portInputEl = document.createElement('input');
    this.portInputEl.type = 'number';
    this.portInputEl.className = 'vm-home-input';
    this.portInputEl.value = '22';
    this.portInputEl.min = '1';
    this.portInputEl.max = '65535';
    this.portInputEl.placeholder = '22';

    this.userInputEl = document.createElement('input');
    this.userInputEl.type = 'text';
    this.userInputEl.className = 'vm-home-input';
    this.userInputEl.placeholder = 'Username (e.g. root)';
    this.userInputEl.autocomplete = 'off';
    this.userInputEl.spellcheck = false;

    this.authModeBtnEl = document.createElement('button');
    this.authModeBtnEl.type = 'button';
    this.authModeBtnEl.className = 'vm-home-btn';
    this.authModeBtnEl.textContent = '密码认证';
    this.authModeBtnEl.addEventListener('click', () => {
      this.setAuthMode(this.authMode === 'password' ? 'key' : 'password');
    });

    connRow1.append(this.hostInputEl, this.portInputEl, this.userInputEl, this.authModeBtnEl);

    const connRow2 = document.createElement('div');
    connRow2.style.display = 'flex';
    connRow2.style.gap = '6px';
    connRow2.style.alignItems = 'stretch';

    this.passInputEl = document.createElement('input');
    this.passInputEl.type = 'password';
    this.passInputEl.className = 'vm-home-input';
    this.passInputEl.placeholder = 'SSH 密码 / Password';
    this.passInputEl.autocomplete = 'off';
    this.passInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.connect();
      }
    });

    this.keyInputEl = document.createElement('textarea');
    this.keyInputEl.className = 'vm-home-input';
    this.keyInputEl.rows = 3;
    this.keyInputEl.style.height = '64px';
    this.keyInputEl.style.padding = '6px 8px';
    this.keyInputEl.style.resize = 'vertical';
    this.keyInputEl.style.display = 'none';
    this.keyInputEl.placeholder = '-----BEGIN OPENSSH PRIVATE KEY-----';
    this.keyInputEl.spellcheck = false;

    this.connectBtnEl = document.createElement('button');
    this.connectBtnEl.type = 'button';
    this.connectBtnEl.className = 'vm-home-btn vm-home-btn-primary';
    this.connectBtnEl.style.flex = '0 0 auto';
    this.connectBtnEl.textContent = '连接 SSH';
    this.connectBtnEl.addEventListener('click', () => {
      if (this.ws) {
        this.disconnect();
      } else {
        this.connect();
      }
    });

    connRow2.append(this.passInputEl, this.keyInputEl, this.connectBtnEl);

    // Explicit opt-in local storage consent row (UNCHECKED by default)
    const consentRow = document.createElement('div');
    consentRow.className = 'vm-consent-row';
    consentRow.style.display = 'flex';
    consentRow.style.alignItems = 'center';
    consentRow.style.justifyContent = 'space-between';
    consentRow.style.flexWrap = 'wrap';
    consentRow.style.gap = '6px';
    consentRow.style.fontSize = '11px';
    consentRow.style.color = 'var(--vm-dim)';

    const checkLabel = document.createElement('label');
    checkLabel.style.display = 'inline-flex';
    checkLabel.style.alignItems = 'center';
    checkLabel.style.gap = '6px';
    checkLabel.style.cursor = 'pointer';

    this.saveLocalCheckEl = document.createElement('input');
    this.saveLocalCheckEl.type = 'checkbox';
    this.saveLocalCheckEl.checked = false;
    this.saveLocalCheckEl.addEventListener('change', () => {
      if (!this.saveLocalCheckEl.checked) {
        this.removeSavedConfig();
      } else {
        this.persistCurrentConfigIfOptedIn();
      }
    });

    const checkText = document.createElement('span');
    checkText.textContent = '在浏览器本地保存敏感配置 (可选，默认仅本次会话)';
    checkLabel.append(this.saveLocalCheckEl, checkText);

    this.clearLocalBtnEl = document.createElement('button');
    this.clearLocalBtnEl.type = 'button';
    this.clearLocalBtnEl.className = 'vm-home-recent-chip';
    this.clearLocalBtnEl.textContent = '清除本地配置';
    this.clearLocalBtnEl.addEventListener('click', () => {
      this.removeSavedConfig();
      this.saveLocalCheckEl.checked = false;
      this.passInputEl.value = '';
      this.keyInputEl.value = '';
      this.cb.onToast?.('已清除本地 SSH 敏感配置', 'cyan');
      this.appendTerm('\n[local] 已清除浏览器本地保存的 SSH 配置。\n');
    });

    consentRow.append(checkLabel, this.clearLocalBtnEl);
    connBar.append(connRow1, connRow2, consentRow);

    // Error Banner
    this.errorEl = document.createElement('div');
    this.errorEl.className = 'vm-home-error is-hidden';

    // Retro CRT Terminal Output
    const termBox = document.createElement('div');
    termBox.className = 'vm-ssh-term';
    termBox.style.display = 'flex';
    termBox.style.flexDirection = 'column';
    termBox.style.gap = '6px';

    this.termOutEl = document.createElement('pre');
    this.termOutEl.className = 'vm-ssh-out';
    this.termOutEl.style.margin = '0';
    this.termOutEl.style.minHeight = '190px';
    this.termOutEl.style.maxHeight = '38vh';
    this.termOutEl.style.overflowY = 'auto';
    this.termOutEl.style.padding = '10px';
    this.termOutEl.style.background = '#050b0a';
    this.termOutEl.style.border = '2px solid var(--vm-cyan)';
    this.termOutEl.style.color = '#6cf7c8';
    this.termOutEl.style.fontFamily = "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace";
    this.termOutEl.style.fontSize = '12px';
    this.termOutEl.style.lineHeight = '1.42';
    this.termOutEl.style.whiteSpace = 'pre-wrap';
    this.termOutEl.style.wordBreak = 'break-word';
    this.termOutEl.style.userSelect = 'text';

    // Quick Vibe Coding Chips
    const chipsRow = document.createElement('div');
    chipsRow.className = 'vm-home-recent-chips';
    const quickChips: readonly { label: string; action: () => void }[] = [
      { label: 'Ctrl+C', action: () => this.sendRawInput('\x03') },
      { label: 'ls -la', action: () => this.sendCommand('ls -la') },
      { label: 'git status', action: () => this.sendCommand('git status') },
      { label: 'claude', action: () => this.sendCommand('claude') },
      { label: 'codex', action: () => this.sendCommand('codex') },
      { label: 'Clear', action: () => this.clearOutput() },
      { label: '断开', action: () => this.disconnect() },
    ];
    for (const chip of quickChips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vm-home-recent-chip';
      btn.textContent = chip.label;
      btn.addEventListener('click', () => {
        chip.action();
        this.cmdInputEl.focus();
      });
      chipsRow.appendChild(btn);
    }

    // Command Input Bar
    const cmdRow = document.createElement('div');
    cmdRow.style.display = 'flex';
    cmdRow.style.gap = '6px';

    this.cmdInputEl = document.createElement('input');
    this.cmdInputEl.type = 'text';
    this.cmdInputEl.className = 'vm-home-input';
    this.cmdInputEl.placeholder = '$ 输入命令并回车 (支持 ↑/↓ 历史记录)...';
    this.cmdInputEl.autocomplete = 'off';
    this.cmdInputEl.spellcheck = false;
    this.cmdInputEl.style.fontFamily = "'JetBrains Mono', Menlo, Consolas, monospace";
    this.cmdInputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = this.cmdInputEl.value;
        this.cmdInputEl.value = '';
        this.sendCommand(cmd);
      } else if (e.key === 'ArrowUp') {
        if (this.cmdHistory.length > 0) {
          e.preventDefault();
          this.historyIdx = Math.min(this.cmdHistory.length - 1, this.historyIdx + 1);
          this.cmdInputEl.value = this.cmdHistory[this.cmdHistory.length - 1 - this.historyIdx] ?? '';
        }
      } else if (e.key === 'ArrowDown') {
        if (this.historyIdx >= 0) {
          e.preventDefault();
          this.historyIdx--;
          this.cmdInputEl.value =
            this.historyIdx < 0
              ? ''
              : (this.cmdHistory[this.cmdHistory.length - 1 - this.historyIdx] ?? '');
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && this.connected) {
        e.preventDefault();
        this.sendRawInput('\x03');
      }
    });

    this.sendBtnEl = document.createElement('button');
    this.sendBtnEl.type = 'button';
    this.sendBtnEl.className = 'vm-home-btn vm-home-btn-public';
    this.sendBtnEl.textContent = '发送 ↵';
    this.sendBtnEl.addEventListener('click', () => {
      const cmd = this.cmdInputEl.value;
      this.cmdInputEl.value = '';
      this.sendCommand(cmd);
      this.cmdInputEl.focus();
    });

    cmdRow.append(this.cmdInputEl, this.sendBtnEl);
    termBox.append(this.termOutEl, chipsRow, cmdRow);

    card.append(head, connBar, this.errorEl, termBox);
    this.overlayEl.appendChild(card);
    container.appendChild(this.overlayEl);

    this.loadSavedConfigIfAny();
    this.appendTerm(
      '=== VIBE MOTO // RETRO WEBSSH TERMINAL ===\n' +
        '输入服务器 Host / 端口 / 用户名与密码或私钥即可连接进行 Vibe Coding。\n' +
        '凭据默认仅保留于本次内存会话，服务端绝不持久化 SSH 密码或私钥。\n'
    );

    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  open(): void {
    if (this.modalOpen) return;
    this.modalOpen = true;
    this.overlayEl.classList.add('is-open');
    this.cb.onToggle?.(true);
    if (this.connected) {
      this.cmdInputEl.focus();
    } else if (!this.hostInputEl.value.trim()) {
      this.hostInputEl.focus();
    } else {
      this.cmdInputEl.focus();
    }
  }

  close(): void {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.overlayEl.classList.remove('is-open');
    this.cb.onToggle?.(false);
  }

  isOpen(): boolean {
    return this.modalOpen;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    this.disconnect();
    this.overlayEl.remove();
  }

  private setAuthMode(mode: 'password' | 'key'): void {
    this.authMode = mode;
    if (mode === 'password') {
      this.authModeBtnEl.textContent = '密码认证';
      this.passInputEl.style.display = '';
      this.keyInputEl.style.display = 'none';
    } else {
      this.authModeBtnEl.textContent = '私钥认证';
      this.passInputEl.style.display = 'none';
      this.keyInputEl.style.display = '';
    }
  }

  private setError(msg: string | null): void {
    if (!msg) {
      this.errorEl.textContent = '';
      this.errorEl.classList.add('is-hidden');
      return;
    }
    this.errorEl.textContent = msg;
    this.errorEl.classList.remove('is-hidden');
  }

  private setConnUi(state: 'offline' | 'connecting' | 'connected'): void {
    this.connected = state === 'connected';
    if (state === 'connected') {
      this.statusPillEl.textContent = 'SSH ONLINE';
      this.statusPillEl.style.borderColor = 'var(--vm-green)';
      this.statusPillEl.style.color = 'var(--vm-green)';
      this.connectBtnEl.textContent = '断开连接';
    } else if (state === 'connecting') {
      this.statusPillEl.textContent = 'CONNECTING...';
      this.statusPillEl.style.borderColor = 'var(--vm-gold)';
      this.statusPillEl.style.color = 'var(--vm-gold)';
      this.connectBtnEl.textContent = '取消';
    } else {
      this.statusPillEl.textContent = 'OFFLINE';
      this.statusPillEl.style.borderColor = 'var(--vm-steel-hi)';
      this.statusPillEl.style.color = 'var(--vm-dim)';
      this.connectBtnEl.textContent = '连接 SSH';
    }
  }

  private appendTerm(text: string): void {
    if (!text) return;
    this.termBuffer += text;
    if (this.termBuffer.length > MAX_TERMINAL_CHARS) {
      this.termBuffer = this.termBuffer.slice(this.termBuffer.length - MAX_TERMINAL_CHARS);
    }
    this.termOutEl.textContent = this.termBuffer;
    this.termOutEl.scrollTop = this.termOutEl.scrollHeight;
  }

  private clearOutput(): void {
    this.termBuffer = '';
    this.termOutEl.textContent = '';
  }

  private connect(): void {
    const host = this.hostInputEl.value.trim();
    const port = Math.max(1, Math.min(65535, Math.floor(Number(this.portInputEl.value) || 22)));
    const username = this.userInputEl.value.trim();
    const password = this.authMode === 'password' ? this.passInputEl.value : '';
    const privateKey = this.authMode === 'key' ? this.keyInputEl.value.trim() : '';

    if (!host || !username) {
      this.setError('请填写 Host 和 Username');
      return;
    }

    this.setError(null);
    this.persistCurrentConfigIfOptedIn();
    this.disconnect();

    const wsUrl = this.serverClient.getSshWsUrl();
    this.setConnUi('connecting');
    this.appendTerm(`\n[ssh] Connecting to ${username}@${host}:${port} via ${wsUrl} ...\n`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      this.setConnUi('offline');
      const msg = err instanceof Error ? err.message : 'WebSocket 初始化失败';
      this.setError(msg);
      this.appendTerm(`[error] ${msg}\n`);
      return;
    }

    this.ws = ws;
    const cols = Math.max(40, Math.min(140, Math.floor((this.termOutEl.clientWidth || 640) / 8)));
    const rows = 24;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      try {
        ws.send(
          JSON.stringify({
            type: 'connect',
            host,
            port,
            username,
            password,
            privateKey,
            cols,
            rows,
          })
        );
      } catch {
        this.setError('发送 SSH 握手失败');
        this.disconnect();
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.type === 'connected') {
          this.setConnUi('connected');
          this.setError(null);
          this.appendTerm('[ssh] Connected! Ready for Vibe Coding.\n');
          this.cmdInputEl.focus();
        } else if (msg.type === 'data' && typeof msg.data === 'string') {
          this.appendTerm(stripAnsi(msg.data));
        } else if (msg.type === 'error') {
          const errText = String(msg.message || msg.error || 'SSH Error');
          this.setError(errText);
          this.appendTerm(`\n[ssh error] ${errText}\n`);
          this.setConnUi('offline');
        } else if (msg.type === 'closed') {
          this.appendTerm('\n[ssh] Session closed.\n');
          this.setConnUi('offline');
        }
      } catch {
        // Fallback plain text rendered safely via textContent
        this.appendTerm(stripAnsi(ev.data));
      }
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.setError('WebSSH 代理连接失败，请检查服务器地址是否支持 /ws/ssh');
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.connected) {
        this.appendTerm('\n[ssh] Disconnected.\n');
      }
      this.setConnUi('offline');
    };
  }

  private disconnect(): void {
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
      this.appendTerm('\n[ssh] Connection closed.\n');
    }
    this.setConnUi('offline');
  }

  private sendRawInput(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.setError('尚未连接 SSH 会话');
      return;
    }
    try {
      this.ws.send(JSON.stringify({ type: 'input', data }));
    } catch {
      this.setError('发送输入失败');
    }
  }

  private sendCommand(cmd: string): void {
    const trimmed = cmd.trim();
    if (trimmed) {
      if (this.cmdHistory[this.cmdHistory.length - 1] !== trimmed) {
        this.cmdHistory.push(trimmed);
        if (this.cmdHistory.length > 50) this.cmdHistory.shift();
      }
      this.historyIdx = -1;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.setError('请先点击“连接 SSH”');
      return;
    }
    this.sendRawInput(`${cmd}\n`);
  }

  private loadSavedConfigIfAny(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_SSH_CFG_KEY);
      if (!raw) {
        this.saveLocalCheckEl.checked = false;
        return;
      }
      const cfg = JSON.parse(raw) as Partial<SavedSshConfig>;
      if (typeof cfg.host === 'string') this.hostInputEl.value = cfg.host;
      if (typeof cfg.port === 'number' && Number.isFinite(cfg.port)) {
        this.portInputEl.value = String(cfg.port);
      }
      if (typeof cfg.username === 'string') this.userInputEl.value = cfg.username;
      if (cfg.authMode === 'key' || cfg.authMode === 'password') {
        this.setAuthMode(cfg.authMode);
      }
      if (typeof cfg.password === 'string') this.passInputEl.value = cfg.password;
      if (typeof cfg.privateKey === 'string') this.keyInputEl.value = cfg.privateKey;
      this.saveLocalCheckEl.checked = true;
    } catch {
      this.saveLocalCheckEl.checked = false;
    }
  }

  private persistCurrentConfigIfOptedIn(): void {
    if (!this.saveLocalCheckEl.checked) return;
    const cfg: SavedSshConfig = {
      host: this.hostInputEl.value.trim(),
      port: Math.max(1, Math.min(65535, Math.floor(Number(this.portInputEl.value) || 22))),
      username: this.userInputEl.value.trim(),
      authMode: this.authMode,
      password: this.passInputEl.value,
      privateKey: this.keyInputEl.value,
    };
    try {
      window.localStorage.setItem(STORAGE_SSH_CFG_KEY, JSON.stringify(cfg));
    } catch {
      // Ignore storage quota errors
    }
  }

  private removeSavedConfig(): void {
    try {
      window.localStorage.removeItem(STORAGE_SSH_CFG_KEY);
    } catch {
      // Ignore
    }
  }
}
