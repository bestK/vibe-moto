import { ITEM_BY_ID, type HeldItemSlot, type ItemType } from '../game/types';
import { getLang, itemName } from '../i18n';
import {
  BLOCK_CATALOG,
  createDefaultEconomyState,
  getBlockCatalogEntry,
  getShieldRemainingSeconds,
  type EconomyState,
  type MarketListing,
  type ServerBlueprint,
  type ServerClient,
} from '../net/ServerClient';
import { ITEM_ICON_MAP, getPixelIconSvg } from './PixelIcons';

export type EconomyTab = 'shop' | 'market' | 'bag' | 'blueprints';

export interface BlueprintSelectionInfo {
  pos1: { gx: number; gy: number; gz: number } | null;
  pos2: { gx: number; gy: number; gz: number } | null;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  blockCount?: number;
}

export interface EconomyModalCallbacks {
  onToggle?(open: boolean): void;
  onToast?(msg: string, accent?: 'gold' | 'cyan' | 'red'): void;
  onEconomyUpdated?(state: EconomyState): void;
  onBuyShopItem?(itemId: string, qty: number): Promise<void> | void;
  onStashHeldItem?(heldIndex: number, item: ItemType): Promise<void> | void;
  onUseBagItem?(bagIndex: number, item: ItemType): Promise<void> | void;
  onSetBlueprintCornerA?(): void;
  onSetBlueprintCornerB?(): void;
  onClearBlueprintSelection?(): void;
  onSaveBlueprint?(name: string): Promise<void> | void;
  onRebuildBlueprint?(bp: ServerBlueprint): Promise<void> | void;
  onPreviewBlueprint?(bp: ServerBlueprint | null): void;
  onDeleteBlueprint?(id: string): Promise<void> | void;
}

function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(rem)}` : `${pad(mins)}:${pad(rem)}`;
}

export class EconomyModal {
  private readonly serverClient: ServerClient;
  private readonly cb: EconomyModalCallbacks;

  private readonly overlayEl: HTMLDivElement;
  private readonly coinPillEl: HTMLSpanElement;
  private readonly shieldPillEl: HTMLSpanElement;
  private readonly tabBtns: Record<EconomyTab, HTMLButtonElement>;
  private readonly errorEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;

  private modalOpen = false;
  private activeTab: EconomyTab = 'shop';
  private busy = false;
  private state: EconomyState = createDefaultEconomyState();
  private heldItems: HeldItemSlot[] = [];
  private blueprints: ServerBlueprint[] = [];
  private selInfo: BlueprintSelectionInfo | null = null;
  private marketListings: MarketListing[] = [];
  private marketLoading = false;
  private countdownTimer: number | null = null;

  // Persistent form values across refreshes
  private sellBlockType = 3;
  private sellQty = 10;
  private sellPrice = 40;
  private bpNameDraft = '';

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
    callbacks: EconomyModalCallbacks = {}
  ) {
    this.serverClient = serverClient;
    this.cb = callbacks;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'vm-home-overlay vm-modal-wide';
    this.overlayEl.setAttribute('role', 'dialog');
    this.overlayEl.setAttribute('aria-modal', 'true');
    this.overlayEl.setAttribute('aria-label', 'World Shop, Market, Bag and Blueprints');

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
    card.style.width = 'min(760px, calc(100vw - 20px))';
    card.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());

    // Header
    const head = document.createElement('div');
    head.className = 'vm-home-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'vm-home-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'vm-btn-icon';
    titleIcon.innerHTML = getPixelIconSvg('crate');
    const titleText = document.createElement('span');
    titleText.textContent = getLang() === 'zh' ? '世界经济与建造中心' : 'WORLD ECONOMY & BUILD';
    titleWrap.append(titleIcon, titleText);

    const statusWrap = document.createElement('div');
    statusWrap.className = 'vm-home-status';

    this.coinPillEl = document.createElement('span');
    this.coinPillEl.className = 'vm-coin-pill vm-home-room-pill';
    this.coinPillEl.style.borderColor = 'var(--vm-gold)';
    this.coinPillEl.style.color = 'var(--vm-gold)';

    this.shieldPillEl = document.createElement('span');
    this.shieldPillEl.className = 'vm-shield-pill vm-home-room-pill';
    this.shieldPillEl.style.borderColor = 'var(--vm-cyan)';
    this.shieldPillEl.style.color = 'var(--vm-cyan)';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vm-home-btn vm-home-btn-resume';
    closeBtn.style.height = '28px';
    closeBtn.style.padding = '0 10px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    statusWrap.append(this.coinPillEl, this.shieldPillEl, closeBtn);
    head.append(titleWrap, statusWrap);

    // 4-Tab Bar
    const tabBar = document.createElement('div');
    tabBar.className = 'vm-eco-tabs';
    tabBar.style.display = 'grid';
    tabBar.style.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    tabBar.style.gap = '6px';

    const makeTab = (id: EconomyTab, label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vm-home-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.switchTab(id);
      });
      tabBar.appendChild(btn);
      return btn;
    };

    this.tabBtns = {
      shop: makeTab('shop', '世界商店'),
      market: makeTab('market', '玩家交易行'),
      bag: makeTab('bag', '道具袋'),
      blueprints: makeTab('blueprints', '建筑蓝图'),
    };

    this.errorEl = document.createElement('div');
    this.errorEl.className = 'vm-home-error is-hidden';

    this.bodyEl = document.createElement('div');
    this.bodyEl.style.display = 'flex';
    this.bodyEl.style.flexDirection = 'column';
    this.bodyEl.style.gap = '10px';
    this.bodyEl.style.minHeight = '260px';

    card.append(head, tabBar, this.errorEl, this.bodyEl);
    this.overlayEl.appendChild(card);
    container.appendChild(this.overlayEl);

    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  open(initialTab: EconomyTab = 'shop'): void {
    this.activeTab = initialTab;
    if (!this.modalOpen) {
      this.modalOpen = true;
      this.overlayEl.classList.add('is-open');
      this.cb.onToggle?.(true);
      this.startCountdownTimer();
    }
    this.setError(null);
    this.updateHeaderPills();
    this.updateTabHighlight();
    this.renderActiveTab();

    if (this.activeTab === 'market') {
      void this.loadMarketListings();
    }
  }

  close(): void {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.overlayEl.classList.remove('is-open');
    this.stopCountdownTimer();
    this.cb.onToggle?.(false);
  }

  isOpen(): boolean {
    return this.modalOpen;
  }

  refreshState(
    state: EconomyState,
    heldItems?: HeldItemSlot[],
    blueprints?: ServerBlueprint[],
    selInfo?: BlueprintSelectionInfo | null
  ): void {
    this.state = state;
    if (heldItems !== undefined) this.heldItems = heldItems;
    if (blueprints !== undefined) this.blueprints = blueprints;
    if (selInfo !== undefined) this.selInfo = selInfo;
    this.updateHeaderPills();
    if (this.modalOpen) {
      this.renderActiveTab();
    }
  }

  setMarketListings(listings: MarketListing[]): void {
    this.marketListings = listings;
    if (this.modalOpen && this.activeTab === 'market') {
      this.renderActiveTab();
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onWindowKeyDown, true);
    this.stopCountdownTimer();
    this.overlayEl.remove();
  }

  private switchTab(tab: EconomyTab): void {
    this.activeTab = tab;
    this.setError(null);
    this.updateTabHighlight();
    this.renderActiveTab();
    if (tab === 'market') {
      void this.loadMarketListings();
    }
  }

  private updateTabHighlight(): void {
    const keys: EconomyTab[] = ['shop', 'market', 'bag', 'blueprints'];
    for (const k of keys) {
      const btn = this.tabBtns[k];
      if (k === this.activeTab) {
        btn.classList.add('vm-home-btn-primary');
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('vm-home-btn-primary');
        btn.classList.remove('is-active');
      }
    }
  }

  private startCountdownTimer(): void {
    this.stopCountdownTimer();
    this.countdownTimer = window.setInterval(() => {
      this.updateHeaderPills();
    }, 1000);
  }

  private stopCountdownTimer(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private updateHeaderPills(): void {
    this.coinPillEl.textContent = `🪙 ${this.state.coins}`;
    const shieldRem = getShieldRemainingSeconds(this.state.shieldUntil);
    if (shieldRem > 0) {
      this.shieldPillEl.style.display = 'inline-flex';
      this.shieldPillEl.textContent = `🛡 剩余 ${formatCountdown(shieldRem)}`;
    } else {
      this.shieldPillEl.style.display = 'inline-flex';
      this.shieldPillEl.textContent = '🛡 未防护';
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

  private renderActiveTab(): void {
    this.bodyEl.textContent = '';
    if (this.activeTab === 'shop') {
      this.renderShopTab();
    } else if (this.activeTab === 'market') {
      this.renderMarketTab();
    } else if (this.activeTab === 'bag') {
      this.renderBagTab();
    } else {
      this.renderBlueprintsTab();
    }
  }

  // -------------------------------------------------------------------------
  // TAB 1: WORLD SHOP
  // -------------------------------------------------------------------------
  private renderShopTab(): void {
    const shieldRem = getShieldRemainingSeconds(this.state.shieldUntil);

    // Status summary bar
    const summary = document.createElement('div');
    summary.className = 'vm-home-lobby';
    summary.style.flexDirection = 'row';
    summary.style.justifyContent = 'space-between';
    summary.style.flexWrap = 'wrap';
    summary.style.fontSize = '11px';

    const s1 = document.createElement('span');
    s1.textContent = `金币余额：${this.state.coins} 🪙`;
    s1.style.color = 'var(--vm-gold)';
    s1.style.fontWeight = '700';

    const s2 = document.createElement('span');
    s2.textContent =
      shieldRem > 0
        ? `建筑防护盾激活中 · 剩余 ${formatCountdown(shieldRem)}（购买可叠加）`
        : '建筑防护盾未激活（开启后他人无法破坏你的建筑）';
    s2.style.color = shieldRem > 0 ? 'var(--vm-cyan)' : 'var(--vm-dim)';

    const s3 = document.createElement('span');
    s3.textContent = `道具袋：${this.state.savedItems.length}/${this.state.bagCapacity} 格`;
    s3.style.color = 'var(--vm-green)';

    const s4 = document.createElement('span');
    s4.textContent = `传送卡：${this.state.teleportCards ?? 0} 张`;
    s4.style.color = 'var(--vm-sky)';
    s4.style.fontWeight = '700';

    summary.append(s1, s2, s3, s4);
    this.bodyEl.appendChild(summary);

    // Gear items (bag + shields + teleport cards)
    const gearItems = this.state.shop.filter(
      (i) => i.kind === 'bag' || i.kind === 'shield' || i.kind === 'teleport'
    );
    if (gearItems.length > 0) {
      const secTitle = document.createElement('div');
      secTitle.style.fontSize = '11px';
      secTitle.style.fontWeight = '700';
      secTitle.style.color = 'var(--vm-cyan)';
      secTitle.textContent = `功能装备 · 道具袋 / 传送卡 (当前: ${this.state.teleportCards ?? 0}) / 建筑防护盾`;
      this.bodyEl.appendChild(secTitle);

      const gearGrid = document.createElement('div');
      gearGrid.className = 'vm-eco-grid';
      gearGrid.style.display = 'grid';
      gearGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(210px, 1fr))';
      gearGrid.style.gap = '8px';

      for (const item of gearItems) {
        const card = document.createElement('div');
        card.className = 'vm-eco-card vm-home-lobby';

        const nameEl = document.createElement('div');
        nameEl.style.fontSize = '12px';
        nameEl.style.fontWeight = '700';
        nameEl.style.color =
          item.kind === 'shield'
            ? 'var(--vm-cyan)'
            : item.kind === 'teleport'
              ? 'var(--vm-sky)'
              : 'var(--vm-gold)';
        nameEl.textContent = item.zhName;

        const descEl = document.createElement('div');
        descEl.style.fontSize = '10px';
        descEl.style.color = 'var(--vm-dim)';
        if (item.kind === 'bag') {
          descEl.textContent = `当前 ${this.state.bagCapacity}/12 格 · 永久保存赛道道具，开放世界也能用`;
        } else if (item.kind === 'teleport') {
          descEl.textContent = `当前拥有 ${this.state.teleportCards ?? 0}/50 张 · 世界地图可消耗传送卡追击传送至入侵者实时位置`;
        } else {
          const mins = Math.round((item.durationSec ?? 600) / 60);
          descEl.textContent = `+${mins} 分钟建筑保护（多次购买自动叠加时长）`;
        }

        const buyBtn = document.createElement('button');
        buyBtn.type = 'button';
        buyBtn.className = 'vm-home-btn vm-home-btn-primary';
        const bagMaxed = item.kind === 'bag' && this.state.bagCapacity >= 12;
        const tpMaxed = item.kind === 'teleport' && (this.state.teleportCards ?? 0) >= 50;
        const cantAfford = this.state.coins < item.price;
        buyBtn.disabled = this.busy || bagMaxed || tpMaxed || cantAfford;
        buyBtn.textContent = bagMaxed
          ? '已满级 (12格)'
          : tpMaxed
            ? '已达上限 (50张)'
            : `购买 · ${item.price} 🪙`;
        buyBtn.addEventListener('click', () => {
          void this.handleBuyShop(item.id, 1);
        });

        card.append(nameEl, descEl, buyBtn);
        gearGrid.appendChild(card);
      }
      this.bodyEl.appendChild(gearGrid);
    }

    // Block items (1..10)
    const matTitle = document.createElement('div');
    matTitle.style.fontSize = '11px';
    matTitle.style.fontWeight = '700';
    matTitle.style.color = 'var(--vm-gold)';
    matTitle.textContent = '建筑材料商店（支持 #1..#10 含 Vibe 电脑终端）';
    this.bodyEl.appendChild(matTitle);

    const blockGrid = document.createElement('div');
    blockGrid.className = 'vm-eco-grid';
    blockGrid.style.display = 'grid';
    blockGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(168px, 1fr))';
    blockGrid.style.gap = '8px';

    const blockShop = this.state.shop.filter((i) => i.kind === 'block');
    for (const item of blockShop) {
      const bId = item.blockType ?? 1;
      const catalog = getBlockCatalogEntry(bId);
      const cur = this.state.inventory[bId] ?? 0;
      const cap = this.state.caps[bId] ?? 99;
      const full = cur >= cap;

      const card = document.createElement('div');
      card.className = 'vm-eco-card vm-home-lobby';

      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.justifyContent = 'space-between';
      topRow.style.gap = '6px';

      const leftInfo = document.createElement('div');
      leftInfo.style.display = 'flex';
      leftInfo.style.alignItems = 'center';
      leftInfo.style.gap = '6px';

      const swatch = document.createElement('span');
      swatch.style.width = '14px';
      swatch.style.height = '14px';
      swatch.style.display = 'inline-block';
      swatch.style.flexShrink = '0';
      swatch.style.background = catalog.colorHex;
      swatch.style.border = '2px solid rgba(255,255,255,0.45)';

      const title = document.createElement('span');
      title.style.fontSize = '11px';
      title.style.fontWeight = '700';
      title.textContent = `#${bId} ${catalog.zhName}`;

      leftInfo.append(swatch, title);

      const stockEl = document.createElement('span');
      stockEl.style.fontSize = '10px';
      stockEl.style.fontWeight = '700';
      stockEl.style.color = full ? 'var(--vm-gold)' : 'var(--vm-cyan)';
      stockEl.textContent = `${cur}/${cap}`;

      topRow.append(leftInfo, stockEl);

      const buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'vm-home-btn vm-home-btn-public';
      buyBtn.style.height = '28px';
      buyBtn.disabled = this.busy || full || this.state.coins < item.price;
      buyBtn.textContent = full
        ? '库存已满'
        : `+${item.qty ?? 1} · ${item.price} 🪙`;
      buyBtn.addEventListener('click', () => {
        void this.handleBuyShop(item.id, 1);
      });

      card.append(topRow, buyBtn);
      blockGrid.appendChild(card);
    }

    this.bodyEl.appendChild(blockGrid);
  }

  // -------------------------------------------------------------------------
  // TAB 2: PLAYER MARKETPLACE
  // -------------------------------------------------------------------------
  private renderMarketTab(): void {
    const authed = this.serverClient.isAuthenticated();
    const myAccountId = this.serverClient.getAccount()?.id ?? '';

    // Sell form
    const sellBox = document.createElement('div');
    sellBox.className = 'vm-home-lobby';

    const sellHead = document.createElement('div');
    sellHead.className = 'vm-home-lobby-head';
    const sellTitle = document.createElement('span');
    sellTitle.style.fontSize = '12px';
    sellTitle.style.fontWeight = '700';
    sellTitle.style.color = 'var(--vm-gold)';
    sellTitle.textContent = '挂售我的材料';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'vm-home-recent-chip';
    refreshBtn.textContent = this.marketLoading ? '刷新中...' : '刷新挂单';
    refreshBtn.disabled = this.marketLoading;
    refreshBtn.addEventListener('click', () => {
      void this.loadMarketListings();
    });
    sellHead.append(sellTitle, refreshBtn);

    const formRow = document.createElement('div');
    formRow.style.display = 'grid';
    formRow.style.gridTemplateColumns = 'minmax(0, 1.5fr) 82px 92px auto';
    formRow.style.gap = '6px';

    const matSelect = document.createElement('select');
    matSelect.className = 'vm-home-input';
    for (const blk of BLOCK_CATALOG) {
      const opt = document.createElement('option');
      opt.value = String(blk.id);
      const stock = this.state.inventory[blk.id] ?? 0;
      opt.textContent = `#${blk.id} ${blk.zhName} (库存 ${stock})`;
      if (blk.id === this.sellBlockType) opt.selected = true;
      matSelect.appendChild(opt);
    }
    matSelect.addEventListener('change', () => {
      this.sellBlockType = Number(matSelect.value) || 1;
    });

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'vm-home-input';
    qtyInput.min = '1';
    qtyInput.max = '99';
    qtyInput.value = String(this.sellQty);
    qtyInput.placeholder = '数量';
    qtyInput.addEventListener('input', () => {
      this.sellQty = Math.max(1, Math.floor(Number(qtyInput.value) || 1));
    });

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.className = 'vm-home-input';
    priceInput.min = '1';
    priceInput.max = '99999';
    priceInput.value = String(this.sellPrice);
    priceInput.placeholder = '总价🪙';
    priceInput.addEventListener('input', () => {
      this.sellPrice = Math.max(1, Math.floor(Number(priceInput.value) || 1));
    });

    const listBtn = document.createElement('button');
    listBtn.type = 'button';
    listBtn.className = 'vm-home-btn vm-home-btn-primary';
    listBtn.textContent = '上架挂售';
    listBtn.disabled = this.busy || !authed;
    listBtn.addEventListener('click', () => {
      void this.handleCreateListing(this.sellBlockType, this.sellQty, this.sellPrice);
    });

    formRow.append(matSelect, qtyInput, priceInput, listBtn);
    sellBox.append(sellHead, formRow);

    if (!authed) {
      const hint = document.createElement('div');
      hint.style.fontSize = '10px';
      hint.style.color = 'var(--vm-dim)';
      hint.textContent = '提示：游客可浏览交易行；登录游戏账号后即可上架挂售或购买其他玩家的材料。';
      sellBox.appendChild(hint);
    }
    this.bodyEl.appendChild(sellBox);

    // Listings list
    const listWrap = document.createElement('div');
    listWrap.style.display = 'flex';
    listWrap.style.flexDirection = 'column';
    listWrap.style.gap = '6px';

    if (this.marketListings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = this.marketLoading
        ? '正在加载玩家交易行...'
        : '当前暂无玩家挂单，快成为第一个卖家吧！';
      listWrap.appendChild(empty);
    } else {
      for (const item of this.marketListings) {
        const blk = getBlockCatalogEntry(item.blockType);
        const isMine = Boolean(myAccountId && item.sellerId === myAccountId);

        const row = document.createElement('div');
        row.className = 'vm-eco-card vm-home-lobby';
        row.style.flexDirection = 'row';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '8px';

        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '8px';

        const swatch = document.createElement('span');
        swatch.style.width = '16px';
        swatch.style.height = '16px';
        swatch.style.display = 'inline-block';
        swatch.style.background = blk.colorHex;
        swatch.style.border = '2px solid rgba(255,255,255,0.4)';

        const info = document.createElement('div');
        const mainLine = document.createElement('div');
        mainLine.style.fontSize = '12px';
        mainLine.style.fontWeight = '700';
        mainLine.textContent = `${blk.zhName} × ${item.qty}`;

        const subLine = document.createElement('div');
        subLine.style.fontSize = '10px';
        subLine.style.color = 'var(--vm-dim)';
        subLine.textContent = `卖家：${item.sellerName}${isMine ? ' (我的挂单)' : ''}`;

        info.append(mainLine, subLine);
        left.append(swatch, info);

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        right.style.gap = '8px';

        const priceTag = document.createElement('span');
        priceTag.style.fontSize = '12px';
        priceTag.style.fontWeight = '700';
        priceTag.style.color = 'var(--vm-gold)';
        priceTag.textContent = `${item.priceCoins} 🪙`;

        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = isMine
          ? 'vm-home-btn vm-home-btn-resume'
          : 'vm-home-btn vm-home-btn-public';
        actionBtn.style.height = '28px';
        actionBtn.disabled = this.busy || !authed || (!isMine && this.state.coins < item.priceCoins);
        actionBtn.textContent = isMine ? '取消下架' : '购买';
        actionBtn.addEventListener('click', () => {
          if (isMine) {
            void this.handleCancelListing(item.id);
          } else {
            void this.handleBuyListing(item.id);
          }
        });

        right.append(priceTag, actionBtn);
        row.append(left, right);
        listWrap.appendChild(row);
      }
    }

    this.bodyEl.appendChild(listWrap);
  }

  // -------------------------------------------------------------------------
  // TAB 3: PERMANENT ITEM ROAD BAG
  // -------------------------------------------------------------------------
  private renderBagTab(): void {
    const cap = this.state.bagCapacity;
    const used = this.state.savedItems.length;

    const headBox = document.createElement('div');
    headBox.className = 'vm-home-lobby';
    headBox.style.flexDirection = 'row';
    headBox.style.justifyContent = 'space-between';
    headBox.style.alignItems = 'center';
    headBox.style.flexWrap = 'wrap';

    const capText = document.createElement('div');
    capText.style.fontSize = '12px';
    capText.style.fontWeight = '700';
    capText.style.color = 'var(--vm-cyan)';
    capText.textContent = `道具袋容量：${used} / ${cap} 格（永久保存 · 赛道 & 开放世界 PvP 通用）`;

    const upgradeBtn = document.createElement('button');
    upgradeBtn.type = 'button';
    upgradeBtn.className = 'vm-home-btn vm-home-btn-primary';
    upgradeBtn.style.height = '28px';
    upgradeBtn.textContent = cap >= 12 ? '已满级' : '去商店扩容 (+3格)';
    upgradeBtn.disabled = cap >= 12;
    upgradeBtn.addEventListener('click', () => this.switchTab('shop'));

    headBox.append(capText, upgradeBtn);
    this.bodyEl.appendChild(headBox);

    // Currently held highway items -> Stash into permanent bag
    const heldBox = document.createElement('div');
    heldBox.className = 'vm-home-lobby';

    const heldTitle = document.createElement('div');
    heldTitle.style.fontSize = '11px';
    heldTitle.style.fontWeight = '700';
    heldTitle.style.color = 'var(--vm-gold)';
    heldTitle.textContent = '当前手持赛道道具（可存入道具袋永久保留）';
    heldBox.appendChild(heldTitle);

    if (this.heldItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = '当前未持有赛道道具（在公路拾取道具箱后可按 T 或在此存入）';
      heldBox.appendChild(empty);
    } else {
      const rowWrap = document.createElement('div');
      rowWrap.style.display = 'flex';
      rowWrap.style.flexWrap = 'wrap';
      rowWrap.style.gap = '6px';

      this.heldItems.forEach((slot, idx) => {
        const spec = ITEM_BY_ID[slot.type];
        const card = document.createElement('div');
        card.className = 'vm-eco-card';
        card.style.display = 'inline-flex';
        card.style.alignItems = 'center';
        card.style.gap = '8px';
        card.style.padding = '6px 8px';
        card.style.background = 'var(--vm-bg-deep)';
        card.style.border = `2px solid ${spec.color}`;

        const iconEl = document.createElement('span');
        iconEl.className = 'vm-btn-icon';
        iconEl.innerHTML = getPixelIconSvg(ITEM_ICON_MAP[slot.type]);

        const label = document.createElement('span');
        label.style.fontSize = '11px';
        label.style.fontWeight = '700';
        label.textContent = itemName(slot.type);

        const stashBtn = document.createElement('button');
        stashBtn.type = 'button';
        stashBtn.className = 'vm-home-btn vm-home-btn-public';
        stashBtn.style.height = '24px';
        stashBtn.style.padding = '0 8px';
        stashBtn.disabled = this.busy || cap <= 0 || used >= cap;
        stashBtn.textContent = cap <= 0 ? '需先买袋' : used >= cap ? '已满' : '存入袋中';
        stashBtn.addEventListener('click', () => {
          void this.handleStashHeldItem(idx, slot.type);
        });

        card.append(iconEl, label, stashBtn);
        rowWrap.appendChild(card);
      });
      heldBox.appendChild(rowWrap);
    }
    this.bodyEl.appendChild(heldBox);

    // Permanently saved items in bag
    const savedTitle = document.createElement('div');
    savedTitle.style.fontSize = '11px';
    savedTitle.style.fontWeight = '700';
    savedTitle.style.color = 'var(--vm-green)';
    savedTitle.textContent = '已永久保存的道具（点击立即释放）';
    this.bodyEl.appendChild(savedTitle);

    if (this.state.savedItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent =
        cap <= 0
          ? '你还未解锁道具袋，前往「世界商店」购买即可永久存储赛道道具！'
          : '道具袋为空，快去赛道拾取火箭筒/空袭/狙击枪存进来吧！';
      this.bodyEl.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'vm-eco-grid';
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(175px, 1fr))';
      grid.style.gap = '8px';

      this.state.savedItems.forEach((itemType, idx) => {
        const spec = ITEM_BY_ID[itemType];
        const card = document.createElement('div');
        card.className = 'vm-eco-card vm-home-lobby';
        card.style.borderColor = spec.color;

        const top = document.createElement('div');
        top.style.display = 'flex';
        top.style.alignItems = 'center';
        top.style.gap = '6px';

        const iconEl = document.createElement('span');
        iconEl.className = 'vm-btn-icon';
        iconEl.innerHTML = getPixelIconSvg(ITEM_ICON_MAP[itemType]);

        const nameEl = document.createElement('span');
        nameEl.style.fontSize = '12px';
        nameEl.style.fontWeight = '700';
        nameEl.textContent = itemName(itemType);

        top.append(iconEl, nameEl);

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'vm-home-btn vm-home-btn-primary';
        useBtn.style.height = '28px';
        useBtn.disabled = this.busy;
        useBtn.textContent = '立即使用';
        useBtn.addEventListener('click', () => {
          void this.handleUseBagItem(idx, itemType);
        });

        card.append(top, useBtn);
        grid.appendChild(card);
      });
      this.bodyEl.appendChild(grid);
    }
  }

  // -------------------------------------------------------------------------
  // TAB 4: BUILDING BLUEPRINTS
  // -------------------------------------------------------------------------
  private renderBlueprintsTab(): void {
    // Selection box & save form
    const selBox = document.createElement('div');
    selBox.className = 'vm-home-lobby';

    const btnRow = document.createElement('div');
    btnRow.className = 'vm-home-actions';

    const btnA = document.createElement('button');
    btnA.type = 'button';
    btnA.className = 'vm-home-btn vm-home-btn-public';
    btnA.textContent = '设角点 A';
    btnA.addEventListener('click', () => {
      this.cb.onSetBlueprintCornerA?.();
    });

    const btnB = document.createElement('button');
    btnB.type = 'button';
    btnB.className = 'vm-home-btn vm-home-btn-public';
    btnB.textContent = '设角点 B';
    btnB.addEventListener('click', () => {
      this.cb.onSetBlueprintCornerB?.();
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'vm-home-btn vm-home-btn-resume';
    clearBtn.textContent = '清除选区';
    clearBtn.addEventListener('click', () => {
      this.cb.onClearBlueprintSelection?.();
    });

    btnRow.append(btnA, btnB, clearBtn);

    const selStatus = document.createElement('div');
    selStatus.style.fontSize = '11px';
    selStatus.style.color = 'var(--vm-dim)';
    const p1 = this.selInfo?.pos1;
    const p2 = this.selInfo?.pos2;
    const fmtPos = (p: { gx: number; gy: number; gz: number } | null | undefined): string =>
      p ? `(${p.gx}, ${p.gy}, ${p.gz})` : '未设置';
    let dimStr = '';
    if (p1 && p2) {
      const sx = this.selInfo?.sizeX ?? Math.abs(p2.gx - p1.gx) + 1;
      const sy = this.selInfo?.sizeY ?? Math.abs(p2.gy - p1.gy) + 1;
      const sz = this.selInfo?.sizeZ ?? Math.abs(p2.gz - p1.gz) + 1;
      const cnt = this.selInfo?.blockCount !== undefined ? ` · ${this.selInfo.blockCount} 块` : '';
      dimStr = ` · 尺寸 ${sx}×${sy}×${sz}${cnt}`;
    }
    selStatus.textContent = `角点 A: ${fmtPos(p1)}  |  角点 B: ${fmtPos(p2)}${dimStr}`;

    const saveRow = document.createElement('div');
    saveRow.style.display = 'flex';
    saveRow.style.gap = '6px';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'vm-home-input';
    nameInput.maxLength = 28;
    nameInput.placeholder = '输入蓝图名称（如：海景车库）';
    nameInput.value = this.bpNameDraft;
    nameInput.addEventListener('input', () => {
      this.bpNameDraft = nameInput.value;
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'vm-home-btn vm-home-btn-primary';
    saveBtn.style.flex = '0 0 auto';
    saveBtn.disabled = this.busy || !p1 || !p2;
    saveBtn.textContent = '保存设计图';
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || '我的设计图';
      this.bpNameDraft = '';
      void this.handleSaveBlueprint(name);
    });

    saveRow.append(nameInput, saveBtn);
    selBox.append(btnRow, selStatus, saveRow);
    this.bodyEl.appendChild(selBox);

    // Saved Blueprints List
    const listTitle = document.createElement('div');
    listTitle.style.fontSize = '11px';
    listTitle.style.fontWeight = '700';
    listTitle.style.color = 'var(--vm-gold)';
    listTitle.textContent = `已保存的建筑蓝图 (${this.blueprints.length})`;
    this.bodyEl.appendChild(listTitle);

    if (this.blueprints.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vm-home-lobby-empty';
      empty.textContent = '暂无设计图：先用“设角点 A / B”框选你的建筑，即可保存为蓝图随时重建！';
      this.bodyEl.appendChild(empty);
      return;
    }

    const bpList = document.createElement('div');
    bpList.style.display = 'flex';
    bpList.style.flexDirection = 'column';
    bpList.style.gap = '8px';

    for (const bp of this.blueprints) {
      const card = document.createElement('div');
      card.className = 'vm-bp-card vm-home-lobby';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.justifyContent = 'space-between';
      top.style.gap = '8px';
      top.style.flexWrap = 'wrap';

      const title = document.createElement('div');
      title.style.fontSize = '12px';
      title.style.fontWeight = '700';
      title.style.color = 'var(--vm-text)';
      title.textContent = `${bp.name} (${bp.sizeX}×${bp.sizeY}×${bp.sizeZ} · ${bp.blocks.length} 块)`;

      const btns = document.createElement('div');
      btns.style.display = 'flex';
      btns.style.gap = '6px';

      if (this.cb.onPreviewBlueprint) {
        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'vm-home-btn';
        previewBtn.style.height = '26px';
        previewBtn.style.padding = '0 8px';
        previewBtn.textContent = '预览';
        previewBtn.addEventListener('click', () => {
          this.cb.onPreviewBlueprint?.(bp);
          this.close();
        });
        btns.appendChild(previewBtn);
      }

      const rebuildBtn = document.createElement('button');
      rebuildBtn.type = 'button';
      rebuildBtn.className = 'vm-home-btn vm-home-btn-primary';
      rebuildBtn.style.height = '26px';
      rebuildBtn.style.padding = '0 10px';
      rebuildBtn.disabled = this.busy;
      rebuildBtn.textContent = '重建';
      rebuildBtn.addEventListener('click', () => {
        void this.handleRebuildBlueprint(bp);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'vm-home-btn vm-home-btn-resume';
      delBtn.style.height = '26px';
      delBtn.style.padding = '0 8px';
      delBtn.disabled = this.busy;
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        void this.handleDeleteBlueprint(bp.id);
      });

      btns.append(rebuildBtn, delBtn);
      top.append(title, btns);

      // Material cost chips
      const costRow = document.createElement('div');
      costRow.style.display = 'flex';
      costRow.style.flexWrap = 'wrap';
      costRow.style.gap = '5px';

      const counts = new Map<number, number>();
      for (const blk of bp.blocks) {
        counts.set(blk.b, (counts.get(blk.b) ?? 0) + 1);
      }
      for (const [bId, need] of counts.entries()) {
        const spec = getBlockCatalogEntry(bId);
        const have = this.state.inventory[bId] ?? 0;
        const ok = have >= need;
        const tag = document.createElement('span');
        tag.style.fontSize = '10px';
        tag.style.padding = '2px 5px';
        tag.style.background = 'var(--vm-bg-deep)';
        tag.style.border = `1px solid ${ok ? 'var(--vm-green)' : 'var(--vm-crimson)'}`;
        tag.style.color = ok ? 'var(--vm-text)' : '#ffd0d8';
        tag.textContent = `${spec.zhName} ${have}/${need}`;
        costRow.appendChild(tag);
      }

      card.append(top, costRow);
      bpList.appendChild(card);
    }

    this.bodyEl.appendChild(bpList);
  }

  // -------------------------------------------------------------------------
  // ASYNC ACTION HANDLERS
  // -------------------------------------------------------------------------

  private async handleBuyShop(itemId: string, qty: number): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      if (this.cb.onBuyShopItem) {
        await this.cb.onBuyShopItem(itemId, qty);
      } else {
        const res = await this.serverClient.buyShopItem(itemId, qty);
        if (!res.ok) {
          this.setError(res.error || '购买失败');
        } else {
          this.state = res.state;
          this.cb.onEconomyUpdated?.(res.state);
          this.cb.onToast?.('购买成功！', 'gold');
        }
      }
    } finally {
      this.busy = false;
      this.updateHeaderPills();
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async loadMarketListings(): Promise<void> {
    this.marketLoading = true;
    if (this.modalOpen && this.activeTab === 'market') this.renderActiveTab();
    const res = await this.serverClient.getMarketListings();
    this.marketLoading = false;
    if (res.ok) {
      this.marketListings = res.listings;
    } else if (res.error) {
      this.setError(res.error);
    }
    if (this.modalOpen && this.activeTab === 'market') this.renderActiveTab();
  }

  private async handleCreateListing(blockType: number, qty: number, priceCoins: number): Promise<void> {
    if (this.busy) return;
    const stock = this.state.inventory[blockType] ?? 0;
    if (qty <= 0 || qty > stock) {
      this.setError(`材料库存不足（当前仅剩 ${stock}）`);
      return;
    }
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      const res = await this.serverClient.createMarketListing(blockType, qty, priceCoins);
      if (!res.ok) {
        this.setError(res.error || '上架失败');
      } else {
        if (res.state) {
          this.state = res.state;
          this.cb.onEconomyUpdated?.(res.state);
        } else {
          const fresh = await this.serverClient.getEconomyState();
          this.state = fresh;
          this.cb.onEconomyUpdated?.(fresh);
        }
        this.cb.onToast?.('材料已上架至玩家交易行！', 'cyan');
        await this.loadMarketListings();
      }
    } finally {
      this.busy = false;
      this.updateHeaderPills();
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async handleBuyListing(listingId: string): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      const res = await this.serverClient.buyMarketListing(listingId);
      if (!res.ok) {
        this.setError(res.error || '购买挂单失败');
      } else {
        const fresh = res.state ?? (await this.serverClient.getEconomyState());
        this.state = fresh;
        this.cb.onEconomyUpdated?.(fresh);
        this.cb.onToast?.('交易行购买成功！', 'gold');
        await this.loadMarketListings();
      }
    } finally {
      this.busy = false;
      this.updateHeaderPills();
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async handleCancelListing(listingId: string): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      const res = await this.serverClient.cancelMarketListing(listingId);
      if (!res.ok) {
        this.setError(res.error || '取消挂单失败');
      } else {
        const fresh = res.state ?? (await this.serverClient.getEconomyState());
        this.state = fresh;
        this.cb.onEconomyUpdated?.(fresh);
        this.cb.onToast?.('已撤回挂单并退还材料', 'cyan');
        await this.loadMarketListings();
      }
    } finally {
      this.busy = false;
      this.updateHeaderPills();
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async handleStashHeldItem(heldIndex: number, item: ItemType): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      if (this.cb.onStashHeldItem) {
        await this.cb.onStashHeldItem(heldIndex, item);
      } else {
        const res = await this.serverClient.stashBagItem(item);
        if (!res.ok) {
          this.setError(res.error || '存入道具袋失败');
        } else {
          this.state = res.state;
          this.cb.onEconomyUpdated?.(res.state);
          this.cb.onToast?.(`已将 ${itemName(item)} 存入道具袋`, 'cyan');
        }
      }
    } finally {
      this.busy = false;
      this.updateHeaderPills();
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async handleUseBagItem(bagIndex: number, item: ItemType): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    try {
      if (this.cb.onUseBagItem) {
        await this.cb.onUseBagItem(bagIndex, item);
        this.close();
      } else {
        const res = await this.serverClient.useBagItem(bagIndex);
        if (!res.ok) {
          this.setError(res.error || '使用道具失败');
        } else {
          this.state = res.state;
          this.cb.onEconomyUpdated?.(res.state);
          this.close();
        }
      }
    } finally {
      this.busy = false;
      this.updateHeaderPills();
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async handleSaveBlueprint(name: string): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      await this.cb.onSaveBlueprint?.(name);
    } finally {
      this.busy = false;
      if (this.modalOpen) this.renderActiveTab();
    }
  }

  private async handleRebuildBlueprint(bp: ServerBlueprint): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    try {
      await this.cb.onRebuildBlueprint?.(bp);
      this.close();
    } finally {
      this.busy = false;
    }
  }

  private async handleDeleteBlueprint(id: string): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    this.renderActiveTab();
    try {
      if (this.cb.onDeleteBlueprint) {
        await this.cb.onDeleteBlueprint(id);
      } else {
        const res = await this.serverClient.deleteBlueprint(id);
        if (!res.ok) {
          this.setError(res.error || '删除蓝图失败');
        } else {
          this.blueprints = this.blueprints.filter((b) => b.id !== id);
        }
      }
    } finally {
      this.busy = false;
      if (this.modalOpen) this.renderActiveTab();
    }
  }
}
