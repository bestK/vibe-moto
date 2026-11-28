import { TRACK_LENGTH, roadX, wrapTrackS } from '../game/RoadMath';
import { getLang } from '../i18n';
import {
  getBlockCatalogEntry,
  type IntruderRecord,
  type MapMarker,
  type NamedBuilding,
} from '../net/ServerClient';
import { getPixelIconSvg } from './PixelIcons';

export type WorldMapTab = 'markers' | 'buildings' | 'intruders' | 'players';

export interface WorldMapRemotePlayer {
  id: string;
  accountId?: string;
  name: string;
  wx: number;
  wy?: number;
  ws: number;
  onFoot?: boolean;
  color?: string;
}

export interface WorldMapResourceNode {
  id?: string;
  kind?: string;
  name?: string;
  wx: number;
  ws: number;
  ready?: boolean;
  color?: string;
}

export interface WorldMapBuildingCenter {
  wx: number;
  ws: number;
  count?: number;
  label?: string;
}

export interface WorldMapSnapshot {
  playerWx: number;
  playerWy?: number;
  playerWs: number;
  playerYaw: number;
  remotePlayers: readonly WorldMapRemotePlayer[];
  markers: readonly MapMarker[];
  intruders: readonly IntruderRecord[];
  resourceNodes: readonly WorldMapResourceNode[];
  myBuildingCenters: readonly WorldMapBuildingCenter[];
  namedBuildings?: readonly NamedBuilding[];
  teleportCards: number;
}

export interface WorldMapModalCallbacks {
  onToggle?(open: boolean): void;
  onToast?(msg: string, accent?: 'gold' | 'cyan' | 'red'): void;
  onTeleportTo(
    wx: number,
    ws: number,
    label: string,
    useCard: boolean,
    intruderId?: string
  ): void | Promise<void>;
  onAddMarker(
    name: string,
    wx: number,
    wy: number,
    ws: number,
    color: string
  ): void | Promise<void>;
  onDeleteMarker(id: string): void | Promise<void>;
  onNameBuilding?(name: string, gx: number, gy: number, gz: number): void | Promise<void>;
  onDeleteNamedBuilding?(id: string): void | Promise<void>;
  onDismissIntruder(id: string): void | Promise<void>;
  onOpenShop?(): void;
}

const MARKER_PRESET_COLORS = [
  '#ffbe3b',
  '#38e2d4',
  '#46d97c',
  '#ff3b5c',
  '#60b4ff',
  '#c084fc',
] as const;

const BIOME_LABELS = [
  { s: 300, zh: '海岸日落', en: 'COAST', bg: 'rgba(255, 140, 43, 0.06)' },
  { s: 900, zh: '松林高地', en: 'PINES', bg: 'rgba(70, 217, 124, 0.06)' },
  { s: 1500, zh: '红岩峡谷', en: 'CANYON', bg: 'rgba(255, 59, 92, 0.06)' },
  { s: 2100, zh: '霓虹夜色', en: 'NEON', bg: 'rgba(96, 180, 255, 0.07)' },
] as const;

const MIN_METERS_PER_PX = 0.55;
const MAX_METERS_PER_PX = 8.5;
const DEFAULT_METERS_PER_PX = 2.2;

function formatTimeAgo(unixSec: number): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSec - Math.floor(unixSec));
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

function defaultSnapshot(): WorldMapSnapshot {
  return {
    playerWx: 0,
    playerWy: 0,
    playerWs: 0,
    playerYaw: 0,
    remotePlayers: [],
    markers: [],
    intruders: [],
    resourceNodes: [],
    myBuildingCenters: [],
    teleportCards: 1,
  };
}

export class WorldMapModal {
  private readonly cb: WorldMapModalCallbacks;
  private readonly overlayEl: HTMLDivElement;
  private readonly tpPillEl: HTMLSpanElement;
  private readonly coordBadgeEl: HTMLSpanElement;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tabBtns: Record<WorldMapTab, HTMLButtonElement>;
  private readonly panelBodyEl: HTMLDivElement;
  private readonly quickSelMarkBtn: HTMLButtonElement;
  private readonly quickSelTpBtn: HTMLButtonElement;

  private modalOpen = false;
  private activeTab: WorldMapTab = 'markers';
  private snapshot: WorldMapSnapshot = defaultSnapshot();
  private rafId: number | null = null;
  private panelSig = '';

  // Map camera state
  private viewCenterWx = 0;
  private viewCenterWs = 0;
  private metersPerPx = DEFAULT_METERS_PER_PX;
  private selectedWx: number | null = null;
  private selectedWs: number | null = null;

  // Pointer pan/click tracking
  private dragging = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOriginWx = 0;
  private dragOriginWs = 0;

  // Marker form draft
  private markerNameDraft = '';
  private markerColorDraft: string = MARKER_PRESET_COLORS[0];

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (!this.modalOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(container: HTMLElement, callbacks: WorldMapModalCallbacks) {
    this.cb = callbacks;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'vm-home-overlay vm-modal-wide';
    this.overlayEl.setAttribute('role', 'dialog');
    this.overlayEl.setAttribute('aria-modal', 'true');
    this.overlayEl.setAttribute('aria-label', 'World Map');

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
      if (e.target === this.overlayEl) this.close();
    });

    const card = document.createElement('div');
    card.className = 'vm-slab vm-home-card';
    card.style.width = 'min(880px, calc(100vw - 18px))';
    card.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());

    // Header
    const head = document.createElement('div');
    head.className = 'vm-home-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'vm-home-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'vm-btn-icon';
    titleIcon.innerHTML = getPixelIconSvg('map');
    const titleText = document.createElement('span');
    titleText.textContent = getLang() === 'zh' ? '世界地图' : 'WORLD MAP';
    titleWrap.append(titleIcon, titleText);

    const statusWrap = document.createElement('div');
    statusWrap.className = 'vm-home-status';

    this.tpPillEl = document.createElement('span');
    this.tpPillEl.className = 'vm-home-room-pill';
    this.tpPillEl.style.borderColor = 'var(--vm-sky)';
    this.tpPillEl.style.color = 'var(--vm-sky)';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vm-home-btn vm-home-btn-resume';
    closeBtn.style.height = '28px';
    closeBtn.style.padding = '0 10px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    statusWrap.append(this.tpPillEl, closeBtn);
    head.append(titleWrap, statusWrap);

    // Main split layout: Canvas left + Tabbed panel right (responsive CSS in style.css)
    const layout = document.createElement('div');
    layout.className = 'vm-map-layout';

    // Left: Canvas + Controls
    const mapCol = document.createElement('div');
    mapCol.className = 'vm-map-canvas-wrap';

    const canvasWrap = document.createElement('div');
    canvasWrap.style.position = 'relative';

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'vm-map-canvas';
    this.canvasEl.width = 400;
    this.canvasEl.height = 400;
    this.ctx = this.canvasEl.getContext('2d')!;

    this.bindCanvasEvents();

    // Zoom toolbar floating top-right inside canvas wrap
    const zoomBar = document.createElement('div');
    zoomBar.style.position = 'absolute';
    zoomBar.style.top = '6px';
    zoomBar.style.right = '6px';
    zoomBar.style.display = 'flex';
    zoomBar.style.gap = '4px';

    const makeZoomBtn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vm-home-recent-chip';
      b.style.minWidth = '26px';
      b.style.height = '24px';
      b.style.padding = '0 6px';
      b.style.background = 'rgba(9, 12, 20, 0.9)';
      b.textContent = label;
      b.title = title;
      b.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());
      b.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    zoomBar.append(
      makeZoomBtn('+', '放大', () => this.adjustZoom(0.72)),
      makeZoomBtn('-', '缩小', () => this.adjustZoom(1.38)),
      makeZoomBtn('定位', '回到我的位置', () => this.centerOnPlayer()),
      makeZoomBtn('重置', '重置视野', () => {
        this.metersPerPx = DEFAULT_METERS_PER_PX;
        this.centerOnPlayer();
      })
    );

    // Coord badge bottom-left inside canvas wrap
    this.coordBadgeEl = document.createElement('span');
    this.coordBadgeEl.style.position = 'absolute';
    this.coordBadgeEl.style.left = '6px';
    this.coordBadgeEl.style.bottom = '6px';
    this.coordBadgeEl.style.padding = '2px 6px';
    this.coordBadgeEl.style.fontSize = '10px';
    this.coordBadgeEl.style.fontWeight = '700';
    this.coordBadgeEl.style.background = 'rgba(9, 12, 20, 0.88)';
    this.coordBadgeEl.style.border = '1px solid var(--vm-steel)';
    this.coordBadgeEl.style.color = 'var(--vm-cyan)';
    this.coordBadgeEl.style.pointerEvents = 'none';
    this.coordBadgeEl.textContent = '点击地图选点 · 拖动平移';

    canvasWrap.append(this.canvasEl, zoomBar, this.coordBadgeEl);

    // Quick buttons under map
    const quickBar = document.createElement('div');
    quickBar.style.display = 'grid';
    quickBar.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    quickBar.style.gap = '6px';

    this.quickSelMarkBtn = document.createElement('button');
    this.quickSelMarkBtn.type = 'button';
    this.quickSelMarkBtn.className = 'vm-home-btn vm-home-btn-public';
    this.quickSelMarkBtn.style.height = '30px';
    this.quickSelMarkBtn.style.fontSize = '11px';
    this.quickSelMarkBtn.textContent = '标记此处';
    this.quickSelMarkBtn.addEventListener('click', () => {
      const wx = this.selectedWx ?? this.snapshot.playerWx;
      const ws = this.selectedWs ?? wrapTrackS(this.snapshot.playerWs);
      const wy = this.snapshot.playerWy ?? 0;
      const name = this.markerNameDraft.trim() || `点位 (${Math.round(wx)}, ${Math.round(ws)})`;
      this.markerNameDraft = '';
      void this.cb.onAddMarker(name, wx, wy, ws, this.markerColorDraft);
    });

    const quickHereBtn = document.createElement('button');
    quickHereBtn.type = 'button';
    quickHereBtn.className = 'vm-home-btn';
    quickHereBtn.style.height = '30px';
    quickHereBtn.style.fontSize = '11px';
    quickHereBtn.textContent = '标记当前位置';
    quickHereBtn.addEventListener('click', () => {
      const wx = this.snapshot.playerWx;
      const wy = this.snapshot.playerWy ?? 0;
      const ws = wrapTrackS(this.snapshot.playerWs);
      const name = this.markerNameDraft.trim() || `我的位置 (${Math.round(wx)}, ${Math.round(ws)})`;
      this.markerNameDraft = '';
      void this.cb.onAddMarker(name, wx, wy, ws, this.markerColorDraft);
    });

    this.quickSelTpBtn = document.createElement('button');
    this.quickSelTpBtn.type = 'button';
    this.quickSelTpBtn.className = 'vm-home-btn vm-home-btn-primary';
    this.quickSelTpBtn.style.height = '30px';
    this.quickSelTpBtn.style.fontSize = '11px';
    this.quickSelTpBtn.textContent = '传送到选中点';
    this.quickSelTpBtn.addEventListener('click', () => {
      if (this.selectedWx === null || this.selectedWs === null) {
        this.cb.onToast?.('请先点击地图选择一个坐标点', 'gold');
        return;
      }
      const label = `(${Math.round(this.selectedWx)}, ${Math.round(this.selectedWs)})`;
      void this.cb.onTeleportTo(this.selectedWx, this.selectedWs, label, false);
      this.close();
    });

    quickBar.append(this.quickSelMarkBtn, quickHereBtn, this.quickSelTpBtn);

    // Legend strip
    const legend = document.createElement('div');
    legend.style.display = 'flex';
    legend.style.flexWrap = 'wrap';
    legend.style.gap = '8px';
    legend.style.fontSize = '10px';
    legend.style.color = 'var(--vm-dim)';
    legend.innerHTML =
      '<span style="color:#ffbe3b">▲ 我</span>' +
      '<span style="color:#38e2d4">● 玩家</span>' +
      '<span style="color:#46d97c">◆ 资源点</span>' +
      '<span style="color:#60b4ff">■ 建筑</span>' +
      '<span style="color:#ff3b5c">⚠ 入侵追踪</span>';

    mapCol.append(canvasWrap, quickBar, legend);

    // Right: Tabs + List panel (styled by .vm-map-panel & .vm-map-list in style.css)
    const panel = document.createElement('div');
    panel.className = 'vm-map-panel';

    const tabBar = document.createElement('div');
    tabBar.className = 'vm-eco-tabs';
    tabBar.style.display = 'grid';
    tabBar.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    tabBar.style.gap = '4px';

    const makeTab = (id: WorldMapTab, label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vm-home-btn';
      btn.style.fontSize = '10px';
      btn.style.padding = '0 3px';
      btn.textContent = label;
      btn.addEventListener('click', () => this.switchTab(id));
      tabBar.appendChild(btn);
      return btn;
    };

    this.tabBtns = {
      markers: makeTab('markers', '标记'),
      buildings: makeTab('buildings', '建筑'),
      intruders: makeTab('intruders', '入侵'),
      players: makeTab('players', '玩家'),
    };

    this.panelBodyEl = document.createElement('div');
    this.panelBodyEl.className = 'vm-map-list';

    panel.append(tabBar, this.panelBodyEl);
    layout.append(mapCol, panel);

    card.append(head, layout);
    this.overlayEl.appendChild(card);
    container.appendChild(this.overlayEl);

    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  open(initialTab?: WorldMapTab): void {
    if (initialTab) {
      this.activeTab = initialTab;
    } else if (!this.modalOpen && this.snapshot.intruders.length > 0) {
      this.activeTab = 'intruders';
    }
    if (!this.modalOpen) {
      this.modalOpen = true;
      this.overlayEl.classList.add('is-open');
      this.centerOnPlayer();
      this.cb.onToggle?.(true);
      this.startLoop();
    }
    this.updatePillsAndTabs();
    this.renderPanel(true);
    this.drawMap(performance.now());
  }

  close(): void {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.overlayEl.classList.remove('is-open');
    this.stopLoop();
    this.cb.onToggle?.(false);
  }

  isOpen(): boolean {
    return this.modalOpen;
  }

  updateData(data: WorldMapSnapshot): void {
    this.snapshot = data;
    if (!this.modalOpen) return;
    this.updatePillsAndTabs();
    this.renderPanel(false);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    this.stopLoop();
    this.overlayEl.remove();
  }

  private switchTab(tab: WorldMapTab): void {
    this.activeTab = tab;
    this.updatePillsAndTabs();
    this.renderPanel(true);
  }

  private centerOnPlayer(): void {
    this.viewCenterWx = this.snapshot.playerWx;
    this.viewCenterWs = wrapTrackS(this.snapshot.playerWs);
  }

  private focusPoint(wx: number, ws: number, select = true): void {
    this.viewCenterWx = wx;
    this.viewCenterWs = wrapTrackS(ws);
    if (select) {
      this.selectedWx = wx;
      this.selectedWs = wrapTrackS(ws);
      this.updateCoordBadge();
    }
  }

  private adjustZoom(factor: number): void {
    this.metersPerPx = Math.max(
      MIN_METERS_PER_PX,
      Math.min(MAX_METERS_PER_PX, this.metersPerPx * factor)
    );
  }

  private updatePillsAndTabs(): void {
    const tp = Math.max(0, Math.floor(this.snapshot.teleportCards ?? 0));
    this.tpPillEl.textContent = `🎫 传送卡: ${tp}`;
    const intruderCount = this.snapshot.intruders.length;
    const playerCount = this.snapshot.remotePlayers.length + 1;
    const bldCount = (this.snapshot.namedBuildings?.length ?? 0) || this.snapshot.myBuildingCenters.length;

    this.tabBtns.markers.textContent = `标记 (${this.snapshot.markers.length})`;
    this.tabBtns.buildings.textContent = bldCount > 0 ? `建筑 (${bldCount})` : '建筑';
    this.tabBtns.intruders.textContent = intruderCount > 0 ? `入侵 (${intruderCount})` : '入侵';
    this.tabBtns.players.textContent = `玩家 (${playerCount})`;

    const keys: WorldMapTab[] = ['markers', 'buildings', 'intruders', 'players'];
    for (const k of keys) {
      const btn = this.tabBtns[k];
      if (k === this.activeTab) {
        btn.classList.add('vm-home-btn-primary', 'is-active');
      } else {
        btn.classList.remove('vm-home-btn-primary', 'is-active');
      }
    }
    this.updateCoordBadge();
  }

  private updateCoordBadge(): void {
    if (this.selectedWx !== null && this.selectedWs !== null) {
      this.coordBadgeEl.textContent = `选中 X:${Math.round(this.selectedWx)} Z:${Math.round(this.selectedWs)}`;
      this.quickSelTpBtn.disabled = false;
    } else {
      this.coordBadgeEl.textContent = `当前 X:${Math.round(this.snapshot.playerWx)} Z:${Math.round(wrapTrackS(this.snapshot.playerWs))} · 点击选点`;
      this.quickSelTpBtn.disabled = true;
    }
  }

  private bindCanvasEvents(): void {
    const toCanvasPx = (e: PointerEvent): { cx: number; cy: number } => {
      const rect = this.canvasEl.getBoundingClientRect();
      const scaleX = rect.width > 0 ? this.canvasEl.width / rect.width : 1;
      const scaleY = rect.height > 0 ? this.canvasEl.height / rect.height : 1;
      return {
        cx: (e.clientX - rect.left) * scaleX,
        cy: (e.clientY - rect.top) * scaleY,
      };
    };

    this.canvasEl.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      const { cx, cy } = toCanvasPx(e);
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartX = cx;
      this.dragStartY = cy;
      this.dragOriginWx = this.viewCenterWx;
      this.dragOriginWs = this.viewCenterWs;
      try {
        this.canvasEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    });

    this.canvasEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragging) return;
      const { cx, cy } = toCanvasPx(e);
      const dx = cx - this.dragStartX;
      const dy = cy - this.dragStartY;
      if (Math.hypot(dx, dy) > 5) {
        this.dragMoved = true;
      }
      if (this.dragMoved) {
        this.viewCenterWx = this.dragOriginWx - dx * this.metersPerPx;
        this.viewCenterWs = wrapTrackS(this.dragOriginWs + dy * this.metersPerPx);
      }
    });

    const endDrag = (e: PointerEvent): void => {
      if (!this.dragging) return;
      const { cx, cy } = toCanvasPx(e);
      this.dragging = false;
      try {
        this.canvasEl.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      if (!this.dragMoved) {
        const { wx, ws } = this.screenToWorld(cx, cy);
        this.selectedWx = wx;
        this.selectedWs = wrapTrackS(ws);
        this.updateCoordBadge();
      }
    };

    this.canvasEl.addEventListener('pointerup', endDrag);
    this.canvasEl.addEventListener('pointercancel', endDrag);

    this.canvasEl.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.adjustZoom(e.deltaY > 0 ? 1.18 : 0.84);
      },
      { passive: false }
    );
  }

  private worldToScreen(wx: number, ws: number): { sx: number; sy: number } {
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    let ds = (wrapTrackS(ws) - wrapTrackS(this.viewCenterWs)) % TRACK_LENGTH;
    if (ds >= TRACK_LENGTH * 0.5) ds -= TRACK_LENGTH;
    else if (ds < -TRACK_LENGTH * 0.5) ds += TRACK_LENGTH;

    const sx = w * 0.5 + (wx - this.viewCenterWx) / this.metersPerPx;
    const sy = h * 0.5 - ds / this.metersPerPx;
    return { sx, sy };
  }

  private screenToWorld(sx: number, sy: number): { wx: number; ws: number } {
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    const wx = this.viewCenterWx + (sx - w * 0.5) * this.metersPerPx;
    const ws = wrapTrackS(this.viewCenterWs - (sy - h * 0.5) * this.metersPerPx);
    return { wx, ws };
  }

  private startLoop(): void {
    this.stopLoop();
    const tick = (nowMs: number): void => {
      if (!this.modalOpen) return;
      this.drawMap(nowMs);
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private drawMap(nowMs: number): void {
    const ctx = this.ctx;
    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    const halfH = h * 0.5;
    const mpp = this.metersPerPx;

    // 1. Dark retro map backdrop
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, w, h);

    // 2. Biome vertical bands along cyclic S
    const sSpan = halfH * mpp;
    const centerS = wrapTrackS(this.viewCenterWs);
    for (const b of BIOME_LABELS) {
      const pTop = this.worldToScreen(this.viewCenterWx, b.s + 300);
      const pBot = this.worldToScreen(this.viewCenterWx, b.s - 300);
      const yMin = Math.min(pTop.sy, pBot.sy);
      const bandH = Math.abs(pBot.sy - pTop.sy);
      if (bandH < h * 1.8 && yMin + bandH > -20 && yMin < h + 20) {
        ctx.fillStyle = b.bg;
        ctx.fillRect(0, yMin, w, bandH);
      }
    }

    // 3. Coordinate grid lines
    const gridStep = mpp > 3.5 ? 200 : mpp > 1.4 ? 100 : 50;
    ctx.strokeStyle = 'rgba(51, 65, 94, 0.34)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    const minWx = this.viewCenterWx - (w * 0.5) * mpp;
    const maxWx = this.viewCenterWx + (w * 0.5) * mpp;
    const startGx = Math.floor(minWx / gridStep) * gridStep;
    for (let gx = startGx; gx <= maxWx; gx += gridStep) {
      const x = Math.round(w * 0.5 + (gx - this.viewCenterWx) / mpp) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }

    const startDs = Math.floor(-sSpan / gridStep) * gridStep;
    for (let ds = startDs; ds <= sSpan + gridStep; ds += gridStep) {
      const sVal = Math.floor((centerS + ds) / gridStep) * gridStep;
      const p = this.worldToScreen(this.viewCenterWx, sVal);
      const y = Math.round(p.sy) + 0.5;
      if (y >= 0 && y <= h) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
    }
    ctx.stroke();

    // 4. Cyclic Highway Curve (`roadX(s)`)
    const sampleStep = Math.max(8, Math.min(20, mpp * 6));
    const roadPts: Array<{ x: number; y: number }> = [];
    for (let ds = -sSpan - 40; ds <= sSpan + 40; ds += sampleStep) {
      const s = centerS + ds;
      const rx = roadX(s);
      const sx = w * 0.5 + (rx - this.viewCenterWx) / mpp;
      const sy = h * 0.5 - ds / mpp;
      roadPts.push({ x: sx, y: sy });
    }

    if (roadPts.length > 1) {
      // Flat buildable meadow shoulder tint
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(56, 226, 212, 0.08)';
      ctx.lineWidth = Math.max(12, 84 / mpp);
      ctx.beginPath();
      roadPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      // Asphalt ribbon
      ctx.strokeStyle = '#33415e';
      ctx.lineWidth = Math.max(5, 16 / mpp);
      ctx.beginPath();
      roadPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      // Yellow dashed center divider
      ctx.strokeStyle = 'rgba(255, 190, 59, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      roadPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    }

    // Biome labels along road
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = 'rgba(147, 163, 196, 0.55)';
    for (const b of BIOME_LABELS) {
      const p = this.worldToScreen(roadX(b.s) + 28, b.s);
      if (p.sx > -40 && p.sx < w + 40 && p.sy > 10 && p.sy < h - 10) {
        ctx.fillText(getLang() === 'zh' ? b.zh : b.en, p.sx, p.sy);
      }
    }

    // 5. Resource nodes
    for (const node of this.snapshot.resourceNodes) {
      const p = this.worldToScreen(node.wx, node.ws);
      if (p.sx < -12 || p.sx > w + 12 || p.sy < -12 || p.sy > h + 12) continue;
      const color = node.color || (node.ready === false ? '#52607a' : '#46d97c');
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = color;
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.strokeStyle = '#05070d';
      ctx.lineWidth = 1;
      ctx.strokeRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    }

    // 6. Player's Building Centers & Named Buildings
    for (const b of this.snapshot.myBuildingCenters) {
      const p = this.worldToScreen(b.wx, b.ws);
      if (p.sx < -16 || p.sx > w + 16 || p.sy < -16 || p.sy > h + 16) continue;
      ctx.fillStyle = b.label ? '#ffbe3b' : '#60b4ff';
      ctx.fillRect(p.sx - 5, p.sy - 5, 10, 10);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.sx - 5, p.sy - 5, 10, 10);
      if (b.label || b.count) {
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = b.label ? '#ffe699' : '#bfe2ff';
        ctx.fillText(b.label || `建筑(${b.count})`, p.sx + 7, p.sy + 3);
      }
    }
    if (this.snapshot.namedBuildings) {
      for (const nb of this.snapshot.namedBuildings) {
        const p = this.worldToScreen(nb.gx + 0.5, wrapTrackS(nb.gz + 0.5));
        if (p.sx < -24 || p.sx > w + 24 || p.sy < -24 || p.sy > h + 24) continue;
        ctx.fillStyle = '#ffbe3b';
        ctx.fillRect(p.sx - 5, p.sy - 5, 10, 10);
        ctx.strokeStyle = '#05070d';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.sx - 5, p.sy - 5, 10, 10);
        ctx.font = 'bold 10px "Microsoft YaHei", monospace';
        ctx.fillStyle = '#fff0b3';
        ctx.fillText(`🏠 ${nb.name}`, p.sx + 8, p.sy + 3);
      }
    }

    // 7. Custom Map Markers
    for (const mk of this.snapshot.markers) {
      const p = this.worldToScreen(mk.wx, mk.ws);
      if (p.sx < -20 || p.sx > w + 20 || p.sy < -20 || p.sy > h + 20) continue;
      ctx.fillStyle = mk.color || '#ffbe3b';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.sx - 3.5, p.sy - 1);
      ctx.lineTo(p.sx + 3.5, p.sy - 1);
      ctx.lineTo(p.sx, p.sy + 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#05070d';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#f4f7fc';
      ctx.fillText(mk.name, p.sx + 7, p.sy - 1);
    }

    // 8. Remote Players
    for (const rp of this.snapshot.remotePlayers) {
      const p = this.worldToScreen(rp.wx, rp.ws);
      if (p.sx < -16 || p.sx > w + 16 || p.sy < -16 || p.sy > h + 16) continue;
      ctx.fillStyle = rp.color || '#38e2d4';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#05070d';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#9ffaf2';
      ctx.fillText(rp.name, p.sx + 7, p.sy + 3);
    }

    // 9. Intruders: Flashing red site icon + animated dashed vector to live position
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.009);
    const dashOff = -((nowMs * 0.04) % 16);
    for (const rec of this.snapshot.intruders) {
      const siteWx = rec.gx + 0.5;
      const siteWs = wrapTrackS(rec.gz + 0.5);
      const sp = this.worldToScreen(siteWx, siteWs);

      const hasLive =
        typeof rec.liveWx === 'number' &&
        Number.isFinite(rec.liveWx) &&
        typeof rec.liveWs === 'number' &&
        Number.isFinite(rec.liveWs);
      const lp = hasLive ? this.worldToScreen(rec.liveWx!, rec.liveWs!) : null;

      // Dashed red tracking vector
      if (lp) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 59, 92, ${0.55 + pulse * 0.45})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = dashOff;
        ctx.beginPath();
        ctx.moveTo(sp.sx, sp.sy);
        ctx.lineTo(lp.sx, lp.sy);
        ctx.stroke();
        ctx.restore();
      }

      // Destroyed site flashing triangle
      if (sp.sx > -20 && sp.sx < w + 20 && sp.sy > -20 && sp.sy < h + 20) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 59, 92, ${0.55 + pulse * 0.45})`;
        ctx.beginPath();
        ctx.moveTo(sp.sx, sp.sy - 8);
        ctx.lineTo(sp.sx + 7, sp.sy + 5);
        ctx.lineTo(sp.sx - 7, sp.sy + 5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = '#05070d';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('!', sp.sx - 2.5, sp.sy + 3);
        ctx.restore();
      }

      // Live intruder position pulsing crosshair
      if (lp && lp.sx > -24 && lp.sx < w + 24 && lp.sy > -24 && lp.sy < h + 24) {
        ctx.save();
        const r = 7 + pulse * 4;
        ctx.strokeStyle = rec.online ? '#ff3b5c' : '#ff8c2b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = rec.online ? '#ff3b5c' : '#ff8c2b';
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = '#ff9bb0';
        ctx.fillText(
          `⚠ ${rec.intruderName}${rec.online ? '' : '(离线)'}`,
          lp.sx + 9,
          lp.sy - 4
        );
        ctx.restore();
      }
    }

    // 10. Selected Target Crosshair
    if (this.selectedWx !== null && this.selectedWs !== null) {
      const sel = this.worldToScreen(this.selectedWx, this.selectedWs);
      ctx.save();
      ctx.strokeStyle = '#ffbe3b';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sel.sx, sel.sy, 8, 0, Math.PI * 2);
      ctx.moveTo(sel.sx - 12, sel.sy);
      ctx.lineTo(sel.sx + 12, sel.sy);
      ctx.moveTo(sel.sx, sel.sy - 12);
      ctx.lineTo(sel.sx, sel.sy + 12);
      ctx.stroke();
      ctx.restore();
    }

    // 11. Local Player Heading Arrow
    const me = this.worldToScreen(this.snapshot.playerWx, this.snapshot.playerWs);
    ctx.save();
    ctx.translate(me.sx, me.sy);
    // In world space, yaw=0 faces -Z (+ws = UP on map), positive yaw turns left (CCW)
    ctx.rotate(-this.snapshot.playerYaw);
    ctx.fillStyle = '#ffbe3b';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  private buildingNameDraft = '';

  private computePanelSignature(): string {
    if (this.activeTab === 'markers') {
      return (
        'm|' +
        this.snapshot.markers.map((m) => `${m.id}:${m.name}:${Math.round(m.wx)},${Math.round(m.ws)}`).join(';')
      );
    }
    if (this.activeTab === 'buildings') {
      const nbSig = (this.snapshot.namedBuildings ?? [])
        .map((b) => `${b.id}:${b.name}:${b.gx},${b.gz}`)
        .join(';');
      const cSig = this.snapshot.myBuildingCenters
        .map((c) => `${Math.round(c.wx)},${Math.round(c.ws)}:${c.count ?? 0}:${c.label ?? ''}`)
        .join(';');
      return `b|${nbSig}||${cSig}`;
    }
    if (this.activeTab === 'intruders') {
      return (
        `i|${this.snapshot.teleportCards}|` +
        this.snapshot.intruders
          .map(
            (r) =>
              `${r.id}:${r.buildingName ?? ''}:${r.online ? 1 : 0}:${Math.round(r.liveWx ?? 0)},${Math.round(r.liveWs ?? 0)}`
          )
          .join(';')
      );
    }
    return (
      'p|' +
      this.snapshot.remotePlayers
        .map((p) => `${p.id}:${p.name}:${Math.round(p.wx)},${Math.round(p.ws)}:${p.onFoot ? 1 : 0}`)
        .join(';')
    );
  }

  private renderPanel(force: boolean): void {
    const sig = this.computePanelSignature();
    if (!force && sig === this.panelSig) return;
    this.panelSig = sig;
    this.panelBodyEl.textContent = '';

    if (this.activeTab === 'markers') {
      this.renderMarkersTab();
    } else if (this.activeTab === 'buildings') {
      this.renderBuildingsTab();
    } else if (this.activeTab === 'intruders') {
      this.renderIntrudersTab();
    } else {
      this.renderPlayersTab();
    }
  }

  private renderBuildingsTab(): void {
    const form = document.createElement('div');
    form.className = 'vm-home-lobby';
    form.style.gap = '6px';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'vm-home-input';
    nameInput.maxLength = 20;
    nameInput.placeholder = '输入建筑名称（如：海景车库）';
    nameInput.value = this.buildingNameDraft;
    nameInput.addEventListener('input', () => {
      this.buildingNameDraft = nameInput.value;
    });

    const btnRow = document.createElement('div');
    btnRow.style.display = 'grid';
    btnRow.style.gridTemplateColumns = '1fr 1fr';
    btnRow.style.gap = '5px';

    const nameHereBtn = document.createElement('button');
    nameHereBtn.type = 'button';
    nameHereBtn.className = 'vm-home-btn vm-home-btn-primary';
    nameHereBtn.style.height = '26px';
    nameHereBtn.style.fontSize = '10px';
    nameHereBtn.textContent = '命名当前建筑';
    nameHereBtn.addEventListener('click', () => {
      const clean = this.buildingNameDraft.trim();
      if (!clean) {
        this.cb.onToast?.('请先输入建筑名称', 'gold');
        nameInput.focus();
        return;
      }
      this.buildingNameDraft = '';
      void this.cb.onNameBuilding?.(
        clean,
        Math.floor(this.snapshot.playerWx),
        Math.floor(this.snapshot.playerWy ?? 0),
        Math.floor(wrapTrackS(this.snapshot.playerWs))
      );
    });

    const nameSelBtn = document.createElement('button');
    nameSelBtn.type = 'button';
    nameSelBtn.className = 'vm-home-btn vm-home-btn-public';
    nameSelBtn.style.height = '26px';
    nameSelBtn.style.fontSize = '10px';
    nameSelBtn.textContent = '命名地图选点';
    nameSelBtn.addEventListener('click', () => {
      const clean = this.buildingNameDraft.trim();
      if (!clean) {
        this.cb.onToast?.('请先输入建筑名称', 'gold');
        nameInput.focus();
        return;
      }
      const wx = this.selectedWx ?? this.snapshot.playerWx;
      const ws = this.selectedWs ?? wrapTrackS(this.snapshot.playerWs);
      this.buildingNameDraft = '';
      void this.cb.onNameBuilding?.(
        clean,
        Math.floor(wx),
        Math.floor(this.snapshot.playerWy ?? 0),
        Math.floor(wrapTrackS(ws))
      );
    });

    btnRow.append(nameHereBtn, nameSelBtn);
    form.append(nameInput, btnRow);
    this.panelBodyEl.appendChild(form);

    const named = this.snapshot.namedBuildings ?? [];
    for (const nb of named) {
      const card = document.createElement('div');
      card.className = 'vm-eco-card vm-home-lobby';
      card.style.gap = '5px';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'space-between';
      top.style.gap = '6px';

      const title = document.createElement('span');
      title.style.fontSize = '11px';
      title.style.fontWeight = '700';
      title.style.color = 'var(--vm-gold)';
      title.textContent = `🏠 ${nb.name}`;

      const coord = document.createElement('span');
      coord.style.fontSize = '10px';
      coord.style.color = 'var(--vm-dim)';
      coord.textContent = `(${nb.gx}, ${nb.gz})`;

      top.append(title, coord);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '5px';

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'vm-home-recent-chip';
      focusBtn.textContent = '定位';
      focusBtn.addEventListener('click', () => this.focusPoint(nb.gx + 0.5, nb.gz + 0.5, true));

      const tpBtn = document.createElement('button');
      tpBtn.type = 'button';
      tpBtn.className = 'vm-home-btn vm-home-btn-primary';
      tpBtn.style.height = '24px';
      tpBtn.style.fontSize = '10px';
      tpBtn.style.flex = '1';
      tpBtn.textContent = '传送';
      tpBtn.addEventListener('click', () => {
        void this.cb.onTeleportTo(nb.gx + 0.5, wrapTrackS(nb.gz + 0.5), nb.name, false);
        this.close();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'vm-home-btn vm-home-btn-resume';
      delBtn.style.height = '24px';
      delBtn.style.fontSize = '10px';
      delBtn.style.padding = '0 8px';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        void this.cb.onDeleteNamedBuilding?.(nb.id);
      });

      actions.append(focusBtn, tpBtn, delBtn);
      card.append(top, actions);
      this.panelBodyEl.appendChild(card);
    }

    // Unnamed detected building clusters for 1-click naming
    const unnamedClusters = this.snapshot.myBuildingCenters.filter((c) => !c.label);
    for (const c of unnamedClusters) {
      const card = document.createElement('div');
      card.className = 'vm-eco-card vm-home-lobby';
      card.style.gap = '5px';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.justifyContent = 'space-between';
      top.style.fontSize = '10px';
      top.innerHTML = `<span style="color:#bfe2ff;font-weight:700">未命名建筑 (${c.count ?? 1}块)</span><span style="color:var(--vm-dim)">(${Math.round(c.wx)}, ${Math.round(c.ws)})</span>`;

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '5px';

      const quickInput = document.createElement('input');
      quickInput.type = 'text';
      quickInput.className = 'vm-home-input';
      quickInput.style.height = '24px';
      quickInput.style.fontSize = '10px';
      quickInput.maxLength = 20;
      quickInput.placeholder = '输入名称...';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'vm-home-btn vm-home-btn-public';
      saveBtn.style.height = '24px';
      saveBtn.style.fontSize = '10px';
      saveBtn.style.padding = '0 8px';
      saveBtn.textContent = '命名';
      saveBtn.addEventListener('click', () => {
        const nm = quickInput.value.trim();
        if (!nm) {
          quickInput.focus();
          return;
        }
        void this.cb.onNameBuilding?.(
          nm,
          Math.floor(c.wx),
          Math.floor(this.snapshot.playerWy ?? 0),
          Math.floor(wrapTrackS(c.ws))
        );
      });

      row.append(quickInput, saveBtn);
      card.append(top, row);
      this.panelBodyEl.appendChild(card);
    }

    if (named.length === 0 && unnamedClusters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = '暂无建筑，建造后即可在这里命名并在世界3D挂牌显示';
      this.panelBodyEl.appendChild(empty);
    }
  }

  private renderMarkersTab(): void {
    // Add marker form
    const form = document.createElement('div');
    form.className = 'vm-home-lobby';
    form.style.gap = '6px';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'vm-home-input';
    nameInput.maxLength = 24;
    nameInput.placeholder = '标记名称（如：海边车库、秘密基地）';
    nameInput.value = this.markerNameDraft;
    nameInput.addEventListener('input', () => {
      this.markerNameDraft = nameInput.value;
    });

    const colorRow = document.createElement('div');
    colorRow.style.display = 'flex';
    colorRow.style.alignItems = 'center';
    colorRow.style.gap = '5px';
    colorRow.style.flexWrap = 'wrap';

    for (const hex of MARKER_PRESET_COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.style.width = '20px';
      sw.style.height = '20px';
      sw.style.padding = '0';
      sw.style.cursor = 'pointer';
      sw.style.background = hex;
      sw.style.border =
        this.markerColorDraft === hex ? '2px solid #ffffff' : '2px solid var(--vm-steel)';
      sw.addEventListener('click', () => {
        this.markerColorDraft = hex;
        this.renderPanel(true);
      });
      colorRow.appendChild(sw);
    }

    const customPicker = document.createElement('input');
    customPicker.type = 'color';
    customPicker.value = this.markerColorDraft;
    customPicker.style.width = '24px';
    customPicker.style.height = '20px';
    customPicker.style.padding = '0';
    customPicker.style.border = '1px solid var(--vm-steel)';
    customPicker.style.background = 'transparent';
    customPicker.addEventListener('input', () => {
      this.markerColorDraft = customPicker.value;
    });
    colorRow.appendChild(customPicker);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'grid';
    btnRow.style.gridTemplateColumns = '1fr 1fr';
    btnRow.style.gap = '5px';

    const addCurBtn = document.createElement('button');
    addCurBtn.type = 'button';
    addCurBtn.className = 'vm-home-btn vm-home-btn-primary';
    addCurBtn.style.height = '26px';
    addCurBtn.style.fontSize = '10px';
    addCurBtn.textContent = '标记当前位置';
    addCurBtn.addEventListener('click', () => {
      const wx = this.snapshot.playerWx;
      const wy = this.snapshot.playerWy ?? 0;
      const ws = wrapTrackS(this.snapshot.playerWs);
      const name = this.markerNameDraft.trim() || `据点 (${Math.round(wx)}, ${Math.round(ws)})`;
      this.markerNameDraft = '';
      void this.cb.onAddMarker(name, wx, wy, ws, this.markerColorDraft);
    });

    const addSelBtn = document.createElement('button');
    addSelBtn.type = 'button';
    addSelBtn.className = 'vm-home-btn vm-home-btn-public';
    addSelBtn.style.height = '26px';
    addSelBtn.style.fontSize = '10px';
    addSelBtn.textContent = '标记地图选点';
    addSelBtn.addEventListener('click', () => {
      const wx = this.selectedWx ?? this.snapshot.playerWx;
      const wy = this.snapshot.playerWy ?? 0;
      const ws = this.selectedWs ?? wrapTrackS(this.snapshot.playerWs);
      const name = this.markerNameDraft.trim() || `点位 (${Math.round(wx)}, ${Math.round(ws)})`;
      this.markerNameDraft = '';
      void this.cb.onAddMarker(name, wx, wy, ws, this.markerColorDraft);
    });

    btnRow.append(addCurBtn, addSelBtn);
    form.append(nameInput, colorRow, btnRow);
    this.panelBodyEl.appendChild(form);

    // Saved markers list
    if (this.snapshot.markers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = '暂无地图标记，点击地图或“标记当前位置”即可快速收藏坐标！';
      this.panelBodyEl.appendChild(empty);
      return;
    }

    for (const mk of this.snapshot.markers) {
      const card = document.createElement('div');
      card.className = 'vm-eco-card vm-home-lobby';
      card.style.gap = '5px';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'space-between';
      top.style.gap = '6px';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '6px';
      left.style.minWidth = '0';

      const dot = document.createElement('span');
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.flexShrink = '0';
      dot.style.background = mk.color || '#ffbe3b';
      dot.style.border = '1px solid #fff';

      const title = document.createElement('span');
      title.style.fontSize = '11px';
      title.style.fontWeight = '700';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.style.whiteSpace = 'nowrap';
      title.textContent = mk.name;

      left.append(dot, title);

      const coord = document.createElement('span');
      coord.style.fontSize = '10px';
      coord.style.color = 'var(--vm-dim)';
      coord.style.flexShrink = '0';
      coord.textContent = `(${Math.round(mk.wx)}, ${Math.round(wrapTrackS(mk.ws))})`;

      top.append(left, coord);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '5px';

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'vm-home-recent-chip';
      focusBtn.textContent = '定位';
      focusBtn.addEventListener('click', () => this.focusPoint(mk.wx, mk.ws, true));

      const tpBtn = document.createElement('button');
      tpBtn.type = 'button';
      tpBtn.className = 'vm-home-btn vm-home-btn-primary';
      tpBtn.style.height = '24px';
      tpBtn.style.fontSize = '10px';
      tpBtn.style.flex = '1';
      tpBtn.textContent = '传送';
      tpBtn.addEventListener('click', () => {
        void this.cb.onTeleportTo(mk.wx, wrapTrackS(mk.ws), mk.name, false);
        this.close();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'vm-home-btn vm-home-btn-resume';
      delBtn.style.height = '24px';
      delBtn.style.fontSize = '10px';
      delBtn.style.padding = '0 8px';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        void this.cb.onDeleteMarker(mk.id);
      });

      actions.append(focusBtn, tpBtn, delBtn);
      card.append(top, actions);
      this.panelBodyEl.appendChild(card);
    }
  }

  private renderIntrudersTab(): void {
    const cards = Math.max(0, Math.floor(this.snapshot.teleportCards ?? 0));

    // Teleport Card status header
    const bar = document.createElement('div');
    bar.className = 'vm-home-lobby';
    bar.style.flexDirection = 'row';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'space-between';
    bar.style.gap = '6px';

    const countEl = document.createElement('span');
    countEl.style.fontSize = '11px';
    countEl.style.fontWeight = '700';
    countEl.style.color = cards > 0 ? 'var(--vm-sky)' : 'var(--vm-crimson)';
    countEl.textContent = `🎫 传送卡: ${cards} 张`;

    bar.appendChild(countEl);

    if (this.cb.onOpenShop) {
      const shopBtn = document.createElement('button');
      shopBtn.type = 'button';
      shopBtn.className = cards === 0 ? 'vm-home-btn vm-home-btn-primary' : 'vm-home-recent-chip';
      shopBtn.style.height = '24px';
      shopBtn.style.fontSize = '10px';
      shopBtn.textContent = cards === 0 ? '去商店购买传送卡' : '商店补充';
      shopBtn.addEventListener('click', () => {
        this.close();
        this.cb.onOpenShop?.();
      });
      bar.appendChild(shopBtn);
    }
    this.panelBodyEl.appendChild(bar);

    if (this.snapshot.intruders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = '你的建筑目前很安全，暂无入侵破坏记录！';
      this.panelBodyEl.appendChild(empty);
      return;
    }

    for (const rec of this.snapshot.intruders) {
      const card = document.createElement('div');
      card.className = 'vm-intruder-card vm-eco-card vm-home-lobby';
      card.style.borderColor = 'var(--vm-crimson)';
      card.style.gap = '5px';

      const blk = getBlockCatalogEntry(rec.blockType);
      const siteWx = rec.gx + 0.5;
      const siteWs = wrapTrackS(rec.gz + 0.5);
      const hasLive =
        typeof rec.liveWx === 'number' &&
        Number.isFinite(rec.liveWx) &&
        typeof rec.liveWs === 'number' &&
        Number.isFinite(rec.liveWs);
      const targetWx = hasLive ? rec.liveWx! : siteWx;
      const targetWs = hasLive ? wrapTrackS(rec.liveWs!) : siteWs;

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'space-between';
      top.style.gap = '6px';

      const nameEl = document.createElement('span');
      nameEl.style.fontSize = '12px';
      nameEl.style.fontWeight = '700';
      nameEl.style.color = '#ff7b93';
      nameEl.textContent = `⚠ ${rec.intruderName}`;

      const statusTag = document.createElement('span');
      statusTag.style.fontSize = '9px';
      statusTag.style.fontWeight = '700';
      statusTag.style.padding = '1px 5px';
      statusTag.style.background = rec.online ? 'rgba(255, 59, 92, 0.22)' : 'rgba(147, 163, 196, 0.16)';
      statusTag.style.border = `1px solid ${rec.online ? 'var(--vm-crimson)' : 'var(--vm-steel)'}`;
      statusTag.style.color = rec.online ? '#ff9bb0' : 'var(--vm-dim)';
      statusTag.textContent = rec.online ? '在线追踪中' : '离线';

      top.append(nameEl, statusTag);

      const detail1 = document.createElement('div');
      detail1.style.fontSize = '10px';
      detail1.style.color = 'var(--vm-text)';
      const actionLabel = rec.action === 'overwrite' ? '覆盖了' : '破坏了';
      const bldPrefix = rec.buildingName ? `「${rec.buildingName}」` : '';
      detail1.textContent = `${bldPrefix}${actionLabel} ${blk.zhName} · (${rec.gx}, ${rec.gy}, ${rec.gz}) · ${formatTimeAgo(rec.createdAt)}`;

      const detail2 = document.createElement('div');
      detail2.style.fontSize = '10px';
      detail2.style.color = hasLive ? 'var(--vm-cyan)' : 'var(--vm-dim)';
      detail2.textContent = hasLive
        ? `当前实时位置：X ${Math.round(targetWx)}, Z ${Math.round(targetWs)}`
        : `最后记录位置：建筑现场 (${Math.round(siteWx)}, ${Math.round(siteWs)})`;

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '5px';

      const chaseBtn = document.createElement('button');
      chaseBtn.type = 'button';
      chaseBtn.className = 'vm-home-btn vm-home-btn-primary';
      chaseBtn.style.height = '26px';
      chaseBtn.style.fontSize = '10px';
      chaseBtn.style.flex = '1';
      chaseBtn.style.borderColor = 'var(--vm-crimson)';
      chaseBtn.textContent = cards > 0 ? '用传送卡追击传送 (-1卡)' : '传送卡不足';
      chaseBtn.disabled = cards <= 0;
      chaseBtn.addEventListener('click', () => {
        if (cards <= 0) {
          this.cb.onToast?.('传送卡不足，请先在世界商店购买！', 'red');
          return;
        }
        void this.cb.onTeleportTo(
          targetWx,
          targetWs,
          `追击 ${rec.intruderName}`,
          true,
          rec.id
        );
        this.close();
      });

      const locBtn = document.createElement('button');
      locBtn.type = 'button';
      locBtn.className = 'vm-home-recent-chip';
      locBtn.textContent = '定位';
      locBtn.addEventListener('click', () => this.focusPoint(targetWx, targetWs, true));

      const dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.className = 'vm-home-btn vm-home-btn-resume';
      dismissBtn.style.height = '26px';
      dismissBtn.style.fontSize = '10px';
      dismissBtn.style.padding = '0 7px';
      dismissBtn.textContent = '清除';
      dismissBtn.addEventListener('click', () => {
        void this.cb.onDismissIntruder(rec.id);
      });

      actions.append(chaseBtn, locBtn, dismissBtn);
      card.append(top, detail1, detail2, actions);
      this.panelBodyEl.appendChild(card);
    }
  }

  private renderPlayersTab(): void {
    // Local player row
    const meCard = document.createElement('div');
    meCard.className = 'vm-eco-card vm-home-lobby';
    meCard.style.borderColor = 'var(--vm-gold)';
    meCard.style.flexDirection = 'row';
    meCard.style.alignItems = 'center';
    meCard.style.justifyContent = 'space-between';

    const meInfo = document.createElement('div');
    const meTitle = document.createElement('div');
    meTitle.style.fontSize = '11px';
    meTitle.style.fontWeight = '700';
    meTitle.style.color = 'var(--vm-gold)';
    meTitle.textContent = '★ 我 (当前位置)';
    const meCoord = document.createElement('div');
    meCoord.style.fontSize = '10px';
    meCoord.style.color = 'var(--vm-dim)';
    meCoord.textContent = `X: ${Math.round(this.snapshot.playerWx)}  Z: ${Math.round(wrapTrackS(this.snapshot.playerWs))}`;
    meInfo.append(meTitle, meCoord);

    const meBtn = document.createElement('button');
    meBtn.type = 'button';
    meBtn.className = 'vm-home-recent-chip';
    meBtn.textContent = '居中';
    meBtn.addEventListener('click', () => this.centerOnPlayer());

    meCard.append(meInfo, meBtn);
    this.panelBodyEl.appendChild(meCard);

    if (this.snapshot.remotePlayers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = '当前房间暂无其他在线玩家';
      this.panelBodyEl.appendChild(empty);
      return;
    }

    for (const p of this.snapshot.remotePlayers) {
      const card = document.createElement('div');
      card.className = 'vm-eco-card vm-home-lobby';
      card.style.flexDirection = 'row';
      card.style.alignItems = 'center';
      card.style.justifyContent = 'space-between';
      card.style.gap = '6px';

      const info = document.createElement('div');
      info.style.minWidth = '0';

      const nameEl = document.createElement('div');
      nameEl.style.fontSize = '11px';
      nameEl.style.fontWeight = '700';
      nameEl.style.color = 'var(--vm-cyan)';
      nameEl.textContent = `${p.name}${p.onFoot ? ' [步行]' : ' [骑行]'}`;

      const coord = document.createElement('div');
      coord.style.fontSize = '10px';
      coord.style.color = 'var(--vm-dim)';
      coord.textContent = `X: ${Math.round(p.wx)}  Z: ${Math.round(wrapTrackS(p.ws))}`;

      info.append(nameEl, coord);

      const btns = document.createElement('div');
      btns.style.display = 'flex';
      btns.style.gap = '4px';
      btns.style.flexShrink = '0';

      const locBtn = document.createElement('button');
      locBtn.type = 'button';
      locBtn.className = 'vm-home-recent-chip';
      locBtn.textContent = '定位';
      locBtn.addEventListener('click', () => this.focusPoint(p.wx, p.ws, true));

      btns.appendChild(locBtn);
      card.append(info, btns);
      this.panelBodyEl.appendChild(card);
    }
  }
}
