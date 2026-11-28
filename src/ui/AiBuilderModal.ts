import {
  BLOCK_CATALOG,
  type VoxelBlockId,
  getBlockCatalogEntry,
} from '../net/ServerClient';
import { getLang } from '../i18n';
import { getPixelIconSvg } from './PixelIcons';

const STORAGE_AI_CFG_KEY = 'vibemoto_ai_builder_cfg_v1';
const MAX_DIM = 12;
const MAX_BLOCKS = 240;

export interface AiBuildBlock {
  dx: number;
  dy: number;
  dz: number;
  b: VoxelBlockId;
}

export interface AiBuildPlan {
  name: string;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  blocks: AiBuildBlock[];
}

export interface AiBuilderCallbacks {
  onBuildBlocks(name: string, blocks: AiBuildBlock[]): void;
  onToggle?(open: boolean): void;
  onToast?(msg: string, accent?: 'gold' | 'cyan' | 'red'): void;
}

interface SavedAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function clampBlockId(n: number): VoxelBlockId {
  const v = Math.floor(n);
  if (v >= 1 && v <= 10) return v as VoxelBlockId;
  return 3;
}

function finalizePlan(name: string, rawBlocks: AiBuildBlock[]): AiBuildPlan {
  const dedup = new Map<string, AiBuildBlock>();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;

  for (const blk of rawBlocks) {
    const dx = Math.floor(blk.dx);
    const dy = Math.floor(blk.dy);
    const dz = Math.floor(blk.dz);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) continue;
    if (dx < minX) minX = dx;
    if (dy < minY) minY = dy;
    if (dz < minZ) minZ = dz;
  }

  if (!Number.isFinite(minX)) {
    return { name: name || 'Build', sizeX: 1, sizeY: 1, sizeZ: 1, blocks: [] };
  }

  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;

  for (const blk of rawBlocks) {
    if (dedup.size >= MAX_BLOCKS) break;
    const dx = Math.max(0, Math.min(MAX_DIM - 1, Math.floor(blk.dx) - minX));
    const dy = Math.max(0, Math.min(MAX_DIM - 1, Math.floor(blk.dy) - minY));
    const dz = Math.max(0, Math.min(MAX_DIM - 1, Math.floor(blk.dz) - minZ));
    const key = `${dx},${dy},${dz}`;
    const b = clampBlockId(blk.b);
    dedup.set(key, { dx, dy, dz, b });
    if (dx > maxX) maxX = dx;
    if (dy > maxY) maxY = dy;
    if (dz > maxZ) maxZ = dz;
  }

  const blocks = Array.from(dedup.values()).sort(
    (a, b) => a.dy - b.dy || a.dz - b.dz || a.dx - b.dx
  );

  return {
    name: (name || 'AI 建筑').trim().slice(0, 28),
    sizeX: maxX + 1,
    sizeY: maxY + 1,
    sizeZ: maxZ + 1,
    blocks,
  };
}

/**
 * Built-in local procedural builder so players can immediately generate clean
 * 3D voxel builds from natural-language prompts with zero API key required.
 */
export function generateLocalProceduralBuild(prompt: string): AiBuildPlan {
  const p = prompt.trim();
  const low = p.toLowerCase();
  const blocks: AiBuildBlock[] = [];
  const put = (dx: number, dy: number, dz: number, b: VoxelBlockId): void => {
    blocks.push({ dx, dy, dz, b });
  };

  // Detect optional NxM dimension hint like 5x5, 7x6
  const dimMatch = low.match(/(\d{1,2})\s*[x×*]\s*(\d{1,2})/);
  const hintW = dimMatch ? Math.max(3, Math.min(9, Number(dimMatch[1]))) : 5;
  const hintD = dimMatch ? Math.max(3, Math.min(9, Number(dimMatch[2]))) : 5;

  // Detect material preference override
  const wallMat: VoxelBlockId =
    /砖|brick/.test(low)
      ? 4
      : /石|stone|堡|castle/.test(low)
        ? 2
        : /霓虹|neon|赛博|cyber/.test(low)
          ? 8
          : /赛道|asphalt|桥|bridge/.test(low)
            ? 9
            : 3;

  // 1. Highway Overpass Bridge ("赛道跨线桥" / bridge)
  if (/桥|bridge|跨线|overpass|坡道|ramp/.test(low)) {
    const span = Math.max(7, Math.min(11, hintW + 4));
    const width = 4;
    const deckY = 4;
    // Two stone/road pillars on ends
    for (const px of [0, span - 1]) {
      for (let dz = 0; dz < width; dz++) {
        for (let dy = 0; dy < deckY; dy++) {
          if (dz === 0 || dz === width - 1) {
            put(px, dy, dz, 2);
          }
        }
      }
    }
    // Asphalt bridge deck + neon safety rails
    for (let dx = 0; dx < span; dx++) {
      for (let dz = 0; dz < width; dz++) {
        put(dx, deckY, dz, 9);
      }
      put(dx, deckY + 1, 0, dx % 2 === 0 ? 8 : 7);
      put(dx, deckY + 1, width - 1, dx % 2 === 0 ? 8 : 7);
    }
    // Arch neon sign at center
    const mid = Math.floor(span / 2);
    for (let dy = deckY + 2; dy <= deckY + 4; dy++) {
      put(mid, dy, 0, 2);
      put(mid, dy, width - 1, 2);
    }
    for (let dz = 0; dz < width; dz++) {
      put(mid, deckY + 4, dz, 8);
    }
    return finalizePlan(p || '赛道跨线桥', blocks);
  }

  // 2. Neon Watchtower ("霓虹瞭望塔" / tower)
  if (/塔|tower|瞭望|灯塔|beacon/.test(low)) {
    const h = 9;
    // Base 5x5 stone pad
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        if (dx === 0 || dx === 4 || dz === 0 || dz === 4 || (dx === 2 && dz === 2)) {
          put(dx, 0, dz, 2);
        }
      }
    }
    // 3x3 central shaft
    for (let dy = 1; dy <= h - 3; dy++) {
      for (let dx = 1; dx <= 3; dx++) {
        for (let dz = 1; dz <= 3; dz++) {
          const isCorner = (dx === 1 || dx === 3) && (dz === 1 || dz === 3);
          const isEdge = dx === 1 || dx === 3 || dz === 1 || dz === 3;
          if (isCorner) {
            put(dx, dy, dz, dy % 2 === 0 ? 8 : 2);
          } else if (isEdge && !(dx === 2 && dz === 1 && dy <= 2)) {
            put(dx, dy, dz, dy % 3 === 0 ? 7 : 9);
          }
        }
      }
    }
    // Observation deck 5x5 with glass + neon roof
    const deckY = h - 2;
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        put(dx, deckY, dz, 9);
        const edge = dx === 0 || dx === 4 || dz === 0 || dz === 4;
        if (edge) {
          put(dx, deckY + 1, dz, (dx === 0 || dx === 4) && (dz === 0 || dz === 4) ? 8 : 7);
          put(dx, deckY + 2, dz, 8);
        }
      }
    }
    // Vibe Computer terminal on observation deck
    put(2, deckY + 1, 2, 10);
    return finalizePlan(p || '霓虹瞭望塔', blocks);
  }

  // 3. Cyber Garage ("赛博车库" / garage / workstation)
  if (/车库|garage|机房|基地|studio|工作站|赛博|cyber/.test(low)) {
    const w = 7;
    const d = 6;
    const h = 4;
    // Asphalt floor
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        put(dx, 0, dz, 9);
      }
    }
    // Walls with wide front garage opening (dz === 0, dx 1..5 open)
    for (let dy = 1; dy <= h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const isCorner = (dx === 0 || dx === w - 1) && (dz === 0 || dz === d - 1);
          const isFrontDoor = dz === 0 && dx >= 1 && dx <= w - 2 && dy <= 3;
          const isEdge = dx === 0 || dx === w - 1 || dz === 0 || dz === d - 1;
          if (!isEdge || isFrontDoor) continue;
          if (isCorner) {
            put(dx, dy, dz, dy === h ? 8 : 2);
          } else if (dy === 2 && (dx === 0 || dx === w - 1) && dz >= 2 && dz <= d - 3) {
            put(dx, dy, dz, 7);
          } else if (dz === 0 && dy === h) {
            put(dx, dy, dz, 8);
          } else {
            put(dx, dy, dz, 4);
          }
        }
      }
    }
    // Flat roof with glowing skylight
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const center = dx >= 2 && dx <= w - 3 && dz >= 2 && dz <= d - 3;
        put(dx, h + 1, dz, center ? 7 : 2);
      }
    }
    // Built-in Vibe Computer Terminal inside!
    put(Math.floor(w / 2), 1, d - 2, 10);
    put(1, 1, d - 2, 8);
    put(w - 2, 1, d - 2, 8);
    return finalizePlan(p || '赛博车库', blocks);
  }

  // 4. Default / Cabin ("5x5带窗木屋" / house / cabin)
  const w = Math.max(5, Math.min(8, hintW));
  const d = Math.max(5, Math.min(8, hintD));
  const h = 4;

  // Floor
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      put(dx, 0, dz, 3);
    }
  }
  // Walls with corner logs, glass windows, and front doorway
  const doorX = Math.floor(w / 2);
  for (let dy = 1; dy <= h - 1; dy++) {
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const isEdge = dx === 0 || dx === w - 1 || dz === 0 || dz === d - 1;
        if (!isEdge) continue;
        if (dz === 0 && dx === doorX && dy <= 2) continue; // Doorway
        const isCorner = (dx === 0 || dx === w - 1) && (dz === 0 || dz === d - 1);
        const isWindow =
          dy === 2 &&
          !isCorner &&
          ((dz === 0 && Math.abs(dx - doorX) === 1) ||
            (dz === d - 1 && dx > 0 && dx < w - 1) ||
            ((dx === 0 || dx === w - 1) && dz > 0 && dz < d - 1));
        if (isCorner) {
          put(dx, dy, dz, 5);
        } else if (isWindow) {
          put(dx, dy, dz, 7);
        } else {
          put(dx, dy, dz, wallMat);
        }
      }
    }
  }
  // Stepped roof
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      put(dx, h, dz, 5);
    }
  }
  for (let dx = 1; dx < w - 1; dx++) {
    for (let dz = 1; dz < d - 1; dz++) {
      put(dx, h + 1, dz, wallMat);
    }
  }
  // Interior neon lamp + optional computer if prompt mentions coding/pc
  put(Math.floor(w / 2), h - 1, Math.floor(d / 2), 8);
  if (/电脑|终端|coding|pc|vibe/.test(low)) {
    put(1, 1, d - 2, 10);
  }
  return finalizePlan(p || `${w}x${d}带窗木屋`, blocks);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class AiBuilderModal {
  private readonly cb: AiBuilderCallbacks;
  private readonly overlayEl: HTMLDivElement;
  private readonly baseUrlInputEl: HTMLInputElement;
  private readonly apiKeyInputEl: HTMLInputElement;
  private readonly modelInputEl: HTMLInputElement;
  private readonly saveKeyCheckEl: HTMLInputElement;
  private readonly promptInputEl: HTMLTextAreaElement;
  private readonly aiGenBtnEl: HTMLButtonElement;
  private readonly localGenBtnEl: HTMLButtonElement;
  private readonly errorEl: HTMLDivElement;
  private readonly previewBoxEl: HTMLDivElement;
  private readonly previewTitleEl: HTMLDivElement;
  private readonly costListEl: HTMLDivElement;
  private readonly buildBtnEl: HTMLButtonElement;

  private modalOpen = false;
  private busy = false;
  private inventory: Record<number, number> = {};
  private currentPlan: AiBuildPlan | null = null;

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (!this.modalOpen) return;
    if (e.key === 'Escape' && !this.busy) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(container: HTMLElement, callbacks: AiBuilderCallbacks) {
    this.cb = callbacks;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'vm-home-overlay vm-modal-wide';
    this.overlayEl.setAttribute('role', 'dialog');
    this.overlayEl.setAttribute('aria-modal', 'true');
    this.overlayEl.setAttribute('aria-label', 'AI Natural Language Builder');

    const stopKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !this.busy) {
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
      if (e.target === this.overlayEl && !this.busy) {
        this.close();
      }
    });

    const card = document.createElement('div');
    card.className = 'vm-slab vm-home-card vm-ai-box';
    card.style.width = 'min(640px, calc(100vw - 20px))';
    card.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());

    // Header
    const head = document.createElement('div');
    head.className = 'vm-home-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'vm-home-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'vm-btn-icon';
    titleIcon.innerHTML = getPixelIconSvg('cube');
    const titleText = document.createElement('span');
    titleText.textContent = getLang() === 'zh' ? 'AI 自然语言自动建造' : 'AI AUTO-BUILDER';
    titleWrap.append(titleIcon, titleText);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vm-home-btn vm-home-btn-resume';
    closeBtn.style.height = '28px';
    closeBtn.style.padding = '0 10px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    head.append(titleWrap, closeBtn);

    // OpenAI-compatible settings box
    const apiBox = document.createElement('div');
    apiBox.className = 'vm-home-lobby';

    const apiRow1 = document.createElement('div');
    apiRow1.style.display = 'grid';
    apiRow1.style.gridTemplateColumns = 'minmax(0, 1.5fr) minmax(0, 1fr)';
    apiRow1.style.gap = '6px';

    this.baseUrlInputEl = document.createElement('input');
    this.baseUrlInputEl.type = 'text';
    this.baseUrlInputEl.className = 'vm-home-input';
    this.baseUrlInputEl.value = 'https://api.openai.com/v1';
    this.baseUrlInputEl.placeholder = 'API Base URL (https://api.openai.com/v1)';
    this.baseUrlInputEl.spellcheck = false;

    this.modelInputEl = document.createElement('input');
    this.modelInputEl.type = 'text';
    this.modelInputEl.className = 'vm-home-input';
    this.modelInputEl.value = 'gpt-4o-mini';
    this.modelInputEl.placeholder = 'Model (gpt-4o-mini)';
    this.modelInputEl.spellcheck = false;

    apiRow1.append(this.baseUrlInputEl, this.modelInputEl);

    this.apiKeyInputEl = document.createElement('input');
    this.apiKeyInputEl.type = 'password';
    this.apiKeyInputEl.className = 'vm-home-input';
    this.apiKeyInputEl.placeholder = 'API Key (sk-...，留空可直接用“本地免费生成”)';
    this.apiKeyInputEl.autocomplete = 'off';

    // Explicit opt-in consent row
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

    this.saveKeyCheckEl = document.createElement('input');
    this.saveKeyCheckEl.type = 'checkbox';
    this.saveKeyCheckEl.checked = false;
    this.saveKeyCheckEl.addEventListener('change', () => {
      if (!this.saveKeyCheckEl.checked) {
        this.removeSavedConfig();
      } else {
        this.persistConfigIfOptedIn();
      }
    });

    const checkText = document.createElement('span');
    checkText.textContent = '在浏览器本地保存 API Key (可选，默认仅本次会话)';
    checkLabel.append(this.saveKeyCheckEl, checkText);

    const clearKeyBtn = document.createElement('button');
    clearKeyBtn.type = 'button';
    clearKeyBtn.className = 'vm-home-recent-chip';
    clearKeyBtn.textContent = '清除本地 Key';
    clearKeyBtn.addEventListener('click', () => {
      this.removeSavedConfig();
      this.saveKeyCheckEl.checked = false;
      this.apiKeyInputEl.value = '';
      this.cb.onToast?.('已清除本地 API Key', 'cyan');
    });

    consentRow.append(checkLabel, clearKeyBtn);
    apiBox.append(apiRow1, this.apiKeyInputEl, consentRow);

    // Prompt + Preset Chips
    this.promptInputEl = document.createElement('textarea');
    this.promptInputEl.className = 'vm-home-input';
    this.promptInputEl.rows = 3;
    this.promptInputEl.style.height = '72px';
    this.promptInputEl.style.padding = '8px';
    this.promptInputEl.style.resize = 'vertical';
    this.promptInputEl.placeholder =
      '描述你想建造的方块建筑，例如：5x5带窗木屋、带电脑终端的赛博车库、霓虹瞭望塔...';

    const presetRow = document.createElement('div');
    presetRow.className = 'vm-home-recent-chips';
    const presets = ['5x5带窗木屋', '霓虹瞭望塔', '赛道跨线桥', '赛博车库'];
    for (const preset of presets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'vm-home-recent-chip';
      chip.textContent = preset;
      chip.addEventListener('click', () => {
        this.promptInputEl.value = preset;
        this.runLocalGenerate();
      });
      presetRow.appendChild(chip);
    }

    // Action buttons
    const genActions = document.createElement('div');
    genActions.className = 'vm-home-actions';

    this.localGenBtnEl = document.createElement('button');
    this.localGenBtnEl.type = 'button';
    this.localGenBtnEl.className = 'vm-home-btn vm-home-btn-public';
    this.localGenBtnEl.style.flex = '1 1 auto';
    this.localGenBtnEl.textContent = '本地免费生成';
    this.localGenBtnEl.addEventListener('click', () => this.runLocalGenerate());

    this.aiGenBtnEl = document.createElement('button');
    this.aiGenBtnEl.type = 'button';
    this.aiGenBtnEl.className = 'vm-home-btn vm-home-btn-primary';
    this.aiGenBtnEl.textContent = '调用 AI API 生成';
    this.aiGenBtnEl.addEventListener('click', () => {
      void this.runAiApiGenerate();
    });

    genActions.append(this.localGenBtnEl, this.aiGenBtnEl);

    // Error Banner
    this.errorEl = document.createElement('div');
    this.errorEl.className = 'vm-home-error is-hidden';

    // Plan & Material Cost Preview
    this.previewBoxEl = document.createElement('div');
    this.previewBoxEl.className = 'vm-home-lobby';
    this.previewBoxEl.style.display = 'none';

    this.previewTitleEl = document.createElement('div');
    this.previewTitleEl.style.fontSize = '12px';
    this.previewTitleEl.style.fontWeight = '700';
    this.previewTitleEl.style.color = 'var(--vm-gold)';

    this.costListEl = document.createElement('div');
    this.costListEl.style.display = 'flex';
    this.costListEl.style.flexWrap = 'wrap';
    this.costListEl.style.gap = '6px';

    this.buildBtnEl = document.createElement('button');
    this.buildBtnEl.type = 'button';
    this.buildBtnEl.className = 'vm-home-btn vm-home-btn-primary';
    this.buildBtnEl.textContent = '使用库存材料一键建造';
    this.buildBtnEl.addEventListener('click', () => {
      if (!this.currentPlan || this.currentPlan.blocks.length === 0) return;
      this.cb.onBuildBlocks(this.currentPlan.name, this.currentPlan.blocks);
      this.close();
    });

    this.previewBoxEl.append(this.previewTitleEl, this.costListEl, this.buildBtnEl);

    card.append(
      head,
      apiBox,
      this.promptInputEl,
      presetRow,
      genActions,
      this.errorEl,
      this.previewBoxEl
    );
    this.overlayEl.appendChild(card);
    container.appendChild(this.overlayEl);

    this.loadSavedConfigIfAny();
    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  open(inventory: Record<number, number>): void {
    this.inventory = { ...inventory };
    if (!this.modalOpen) {
      this.modalOpen = true;
      this.overlayEl.classList.add('is-open');
      this.cb.onToggle?.(true);
    }
    this.renderPlanPreview();
    this.promptInputEl.focus();
  }

  updateInventory(inventory: Record<number, number>): void {
    this.inventory = { ...inventory };
    if (this.modalOpen && this.currentPlan) {
      this.renderPlanPreview();
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
    this.overlayEl.remove();
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

  private setBusy(flag: boolean): void {
    this.busy = flag;
    this.aiGenBtnEl.disabled = flag;
    this.localGenBtnEl.disabled = flag;
    this.aiGenBtnEl.textContent = flag ? 'AI 生成中...' : '调用 AI API 生成';
  }

  private runLocalGenerate(): void {
    this.setError(null);
    const prompt = this.promptInputEl.value.trim() || '5x5带窗木屋';
    this.currentPlan = generateLocalProceduralBuild(prompt);
    this.renderPlanPreview();
  }

  private async runAiApiGenerate(): Promise<void> {
    if (this.busy) return;
    const prompt = this.promptInputEl.value.trim();
    if (!prompt) {
      this.setError('请先输入想建造的建筑描述');
      return;
    }

    const baseUrl = this.baseUrlInputEl.value.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    const apiKey = this.apiKeyInputEl.value.trim();
    const model = this.modelInputEl.value.trim() || 'gpt-4o-mini';

    if (!apiKey) {
      this.setError('未填写 API Key，已自动切换为“本地免费生成”');
      this.currentPlan = generateLocalProceduralBuild(prompt);
      this.renderPlanPreview();
      return;
    }

    this.persistConfigIfOptedIn();
    this.setError(null);
    this.setBusy(true);

    const blockGuide = BLOCK_CATALOG.map((b) => `${b.id}=${b.zhName}(${b.enName})`).join(', ');
    const systemPrompt =
      'You are a voxel architect. Reply ONLY with strict JSON matching ' +
      '{"name":"string","blocks":[{"dx":0,"dy":0,"dz":0,"b":3}]}. ' +
      `Rules: integer coordinates within 0..${MAX_DIM - 1} (max ${MAX_DIM}x${MAX_DIM}x${MAX_DIM}), ` +
      `max ${MAX_BLOCKS} blocks, dy=0 is ground floor. ` +
      `Valid block IDs b (1..10): ${blockGuide}. No markdown, no extra text.`;

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${errText.slice(0, 120)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content || '';
      const parsed = extractJsonObject(content);
      if (!parsed || !Array.isArray(parsed.blocks)) {
        throw new Error('AI 返回格式非有效 JSON 建筑蓝图');
      }

      const rawBlocks: AiBuildBlock[] = [];
      for (const item of parsed.blocks) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        rawBlocks.push({
          dx: Number(o.dx) || 0,
          dy: Number(o.dy) || 0,
          dz: Number(o.dz) || 0,
          b: clampBlockId(Number(o.b) || 3),
        });
      }

      if (rawBlocks.length === 0) {
        throw new Error('AI 生成了空蓝图');
      }

      this.currentPlan = finalizePlan(
        typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : prompt,
        rawBlocks
      );
      this.renderPlanPreview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 请求失败';
      this.setError(`AI 调用失败 (${msg})，可改用“本地免费生成”`);
    } finally {
      this.setBusy(false);
    }
  }

  private renderPlanPreview(): void {
    if (!this.currentPlan || this.currentPlan.blocks.length === 0) {
      this.previewBoxEl.style.display = 'none';
      return;
    }

    const plan = this.currentPlan;
    this.previewBoxEl.style.display = '';
    this.previewTitleEl.textContent =
      `蓝图预览：${plan.name} · ${plan.sizeX}×${plan.sizeY}×${plan.sizeZ} · 共 ${plan.blocks.length} 块`;

    // Tally material counts
    const counts = new Map<number, number>();
    for (const blk of plan.blocks) {
      counts.set(blk.b, (counts.get(blk.b) ?? 0) + 1);
    }

    this.costListEl.textContent = '';
    let buildableCount = 0;
    let totalShort = 0;

    for (const [bId, need] of counts.entries()) {
      const spec = getBlockCatalogEntry(bId);
      const have = this.inventory[bId] ?? 0;
      const enough = have >= need;
      buildableCount += Math.min(have, need);
      if (!enough) totalShort += need - have;

      const chip = document.createElement('span');
      chip.style.display = 'inline-flex';
      chip.style.alignItems = 'center';
      chip.style.gap = '5px';
      chip.style.padding = '3px 7px';
      chip.style.fontSize = '11px';
      chip.style.fontWeight = '700';
      chip.style.background = 'var(--vm-bg-deep)';
      chip.style.border = `2px solid ${enough ? 'var(--vm-green)' : 'var(--vm-crimson)'}`;
      chip.style.color = enough ? 'var(--vm-text)' : '#ffd0d8';

      const swatch = document.createElement('span');
      swatch.style.width = '10px';
      swatch.style.height = '10px';
      swatch.style.display = 'inline-block';
      swatch.style.background = spec.colorHex;
      swatch.style.border = '1px solid rgba(255,255,255,0.35)';

      const label = document.createElement('span');
      label.textContent = `${spec.zhName} ${have}/${need}`;

      chip.append(swatch, label);
      this.costListEl.appendChild(chip);
    }

    if (totalShort === 0) {
      this.buildBtnEl.textContent = `材料充足 · 立即建造 (${plan.blocks.length} 块)`;
      this.buildBtnEl.disabled = false;
    } else if (buildableCount > 0) {
      this.buildBtnEl.textContent = `材料不足 (缺 ${totalShort} 块) · 用现有材料建造 ${buildableCount} 块`;
      this.buildBtnEl.disabled = false;
    } else {
      this.buildBtnEl.textContent = '所需材料库存为 0（请先采集或在商店购买）';
      this.buildBtnEl.disabled = true;
    }
  }

  private loadSavedConfigIfAny(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_AI_CFG_KEY);
      if (!raw) {
        this.saveKeyCheckEl.checked = false;
        return;
      }
      const cfg = JSON.parse(raw) as Partial<SavedAiConfig>;
      if (typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim()) {
        this.baseUrlInputEl.value = cfg.baseUrl;
      }
      if (typeof cfg.model === 'string' && cfg.model.trim()) {
        this.modelInputEl.value = cfg.model;
      }
      if (typeof cfg.apiKey === 'string') {
        this.apiKeyInputEl.value = cfg.apiKey;
      }
      this.saveKeyCheckEl.checked = true;
    } catch {
      this.saveKeyCheckEl.checked = false;
    }
  }

  private persistConfigIfOptedIn(): void {
    if (!this.saveKeyCheckEl.checked) return;
    const cfg: SavedAiConfig = {
      baseUrl: this.baseUrlInputEl.value.trim() || 'https://api.openai.com/v1',
      apiKey: this.apiKeyInputEl.value.trim(),
      model: this.modelInputEl.value.trim() || 'gpt-4o-mini',
    };
    try {
      window.localStorage.setItem(STORAGE_AI_CFG_KEY, JSON.stringify(cfg));
    } catch {
      // Ignore
    }
  }

  private removeSavedConfig(): void {
    try {
      window.localStorage.removeItem(STORAGE_AI_CFG_KEY);
    } catch {
      // Ignore
    }
  }
}
