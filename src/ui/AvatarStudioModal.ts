import {
  generateLocalCustomSkin,
  renderSkinPortraitDataUrl,
  sanitizeCustomSkin,
  type CustomAccessory,
  type CustomAvatarSkin,
  type SavedCustomAvatar,
} from '../game/CustomAvatarSystem';
import { getLang } from '../i18n';
import { getPixelIconSvg } from './PixelIcons';

// Share AI API config keys with AiBuilderModal.ts (opt-in checkbox unchecked by default!)
const STORAGE_AI_CFG_KEY = 'vibemoto_ai_cfg_v1';
const STORAGE_AI_BUILDER_CFG_KEY = 'vibemoto_ai_builder_cfg_v1';

interface SavedAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AvatarStudioModalCallbacks {
  onToggle?(open: boolean): void;
  onToast?(msg: string, accent?: 'gold' | 'cyan' | 'red'): void;
  onSaveAvatar(av: Omit<SavedCustomAvatar, 'id' | 'createdAt'>): void | Promise<void>;
  onSelectAvatar(av: SavedCustomAvatar | null): void | Promise<void>;
  onDeleteAvatar(id: string): void | Promise<void>;
}

const ACCESSORY_OPTIONS: readonly { id: CustomAccessory; label: string }[] = [
  { id: 'none', label: '无' },
  { id: 'halo', label: '光环' },
  { id: 'horns', label: '恶魔角' },
  { id: 'crown', label: '皇冠' },
  { id: 'wings', label: '机翼' },
  { id: 'cape', label: '披风' },
  { id: 'antenna', label: '天线' },
] as const;

type ColorSlotKey = Exclude<keyof CustomAvatarSkin, 'accessory'>;

const COLOR_SLOTS: readonly { key: ColorSlotKey; label: string }[] = [
  { key: 'head', label: '头盔' },
  { key: 'face', label: '肤色' },
  { key: 'hair', label: '发型' },
  { key: 'visor', label: '护目镜' },
  { key: 'jacket', label: '外套' },
  { key: 'stripe', label: '条纹' },
  { key: 'pants', label: '裤装' },
  { key: 'boots', label: '战靴' },
  { key: 'bikePrimary', label: '车体主色' },
  { key: 'bikeAccent', label: '车体点缀' },
] as const;

const PROMPT_PRESETS = [
  '红黑赛博忍者，金色光环，蓝色护目镜',
  '白金机甲骑士，发光机翼，青色面罩',
  '紫黑暗影恶魔，恶魔角，霓虹紫摩托',
  '皇家黄金车手，王冠，赤红披风',
] as const;

const DEFAULT_DRAFT_SKIN: CustomAvatarSkin = {
  head: '#1c2233',
  face: '#f2c19c',
  hair: '#141926',
  jacket: '#e63946',
  stripe: '#ffd166',
  pants: '#1b263b',
  boots: '#0f172a',
  bikePrimary: '#e63946',
  bikeAccent: '#38e2d4',
  visor: '#38e2d4',
  accessory: 'halo',
};

function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${clampByte(r)}${clampByte(g)}${clampByte(b)}`;
}

function extractDominantHexes(canvas: HTMLCanvasElement, maxColors = 5): string[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return [];
  const data = ctx.getImageData(0, 0, w, h).data;
  const buckets = new Map<string, { r: number; g: number; b: number; weight: number }>();

  const stride = Math.max(1, Math.floor((w * h) / 1400));
  for (let i = 0; i < w * h; i += stride) {
    const off = i * 4;
    const a = data[off + 3];
    if (a < 140) continue;
    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];
    // Quantize to 24-step buckets
    const qr = Math.round(r / 24) * 24;
    const qg = Math.round(g / 24) * 24;
    const qb = Math.round(b / 24) * 24;
    const key = `${qr},${qg},${qb}`;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const satBoost = 1 + ((maxC - minC) / 255) * 1.4;
    const entry = buckets.get(key);
    if (entry) {
      entry.r += r * satBoost;
      entry.g += g * satBoost;
      entry.b += b * satBoost;
      entry.weight += satBoost;
    } else {
      buckets.set(key, { r: r * satBoost, g: g * satBoost, b: b * satBoost, weight: satBoost });
    }
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => b.weight - a.weight);
  const picked: Array<{ r: number; g: number; b: number }> = [];
  for (const item of sorted) {
    const r = item.r / item.weight;
    const g = item.g / item.weight;
    const b = item.b / item.weight;
    const tooClose = picked.some(
      (p) => Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b) < 72
    );
    if (tooClose) continue;
    picked.push({ r, g, b });
    if (picked.length >= maxColors) break;
  }

  return picked.map((p) => rgbToHex(p.r, p.g, p.b));
}

function compressReferenceImage(
  file: File
): Promise<{ dataUrl: string; dominantHexes: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片文件'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解码失败'));
      img.onload = () => {
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const tw = Math.max(16, Math.round(img.width * scale));
        const th = Math.max(16, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建画布'));
          return;
        }
        ctx.drawImage(img, 0, 0, tw, th);
        const dominantHexes = extractDominantHexes(canvas, 5);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        resolve({ dataUrl, dominantHexes });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
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

export class AvatarStudioModal {
  private readonly cb: AvatarStudioModalCallbacks;
  private readonly overlayEl: HTMLDivElement;
  private readonly baseUrlInputEl: HTMLInputElement;
  private readonly modelInputEl: HTMLInputElement;
  private readonly apiKeyInputEl: HTMLInputElement;
  private readonly saveKeyCheckEl: HTMLInputElement;
  private readonly nameInputEl: HTMLInputElement;
  private readonly promptInputEl: HTMLTextAreaElement;
  private readonly fileInputEl: HTMLInputElement;
  private readonly refPreviewRowEl: HTMLDivElement;
  private readonly aiGenBtnEl: HTMLButtonElement;
  private readonly localGenBtnEl: HTMLButtonElement;
  private readonly saveBtnEl: HTMLButtonElement;
  private readonly errorEl: HTMLDivElement;
  private readonly portraitImgEl: HTMLImageElement;
  private readonly previewMetaEl: HTMLDivElement;
  private readonly colorInputs = new Map<ColorSlotKey, HTMLInputElement>();
  private readonly accessoryBtns = new Map<CustomAccessory, HTMLButtonElement>();
  private readonly savedGridEl: HTMLDivElement;

  private modalOpen = false;
  private busy = false;
  private savedAvatars: SavedCustomAvatar[] = [];
  private activeId = '';

  private draftSkin: CustomAvatarSkin = { ...DEFAULT_DRAFT_SKIN };
  private refImageDataUrl: string | null = null;
  private refDominantHexes: string[] = [];

  private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
    if (!this.modalOpen) return;
    if (e.key === 'Escape' && !this.busy) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  constructor(container: HTMLElement, callbacks: AvatarStudioModalCallbacks) {
    this.cb = callbacks;

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'vm-home-overlay vm-modal-wide';
    this.overlayEl.setAttribute('role', 'dialog');
    this.overlayEl.setAttribute('aria-modal', 'true');
    this.overlayEl.setAttribute('aria-label', 'AI Custom Avatar Studio');

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
    card.className = 'vm-slab vm-home-card';
    card.style.width = 'min(820px, calc(100vw - 18px))';
    card.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());

    // Header
    const head = document.createElement('div');
    head.className = 'vm-home-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'vm-home-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'vm-btn-icon';
    titleIcon.innerHTML = getPixelIconSvg('avatarStudio');
    const titleText = document.createElement('span');
    titleText.textContent = getLang() === 'zh' ? 'AI 自定义 3D 形象工坊' : 'AI 3D AVATAR STUDIO';
    titleWrap.append(titleIcon, titleText);

    const headRight = document.createElement('div');
    headRight.className = 'vm-home-status';

    const resetBuiltinBtn = document.createElement('button');
    resetBuiltinBtn.type = 'button';
    resetBuiltinBtn.className = 'vm-home-recent-chip';
    resetBuiltinBtn.textContent = '恢复默认形象';
    resetBuiltinBtn.addEventListener('click', () => {
      void this.handleSelectAvatar(null);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'vm-home-btn vm-home-btn-resume';
    closeBtn.style.height = '28px';
    closeBtn.style.padding = '0 10px';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    headRight.append(resetBuiltinBtn, closeBtn);
    head.append(titleWrap, headRight);

    // Collapsible AI API Config Block (shares localStorage with AiBuilderModal!)
    const apiDetails = document.createElement('details');
    apiDetails.className = 'vm-home-lobby';

    const apiSummary = document.createElement('summary');
    apiSummary.style.cursor = 'pointer';
    apiSummary.style.fontSize = '11px';
    apiSummary.style.fontWeight = '700';
    apiSummary.style.color = 'var(--vm-cyan)';
    apiSummary.textContent = '⚙ AI API 设置（支持 OpenAI 兼容多模态视觉接口 · 与 AI 建造共享配置）';
    apiDetails.appendChild(apiSummary);

    const apiInner = document.createElement('div');
    apiInner.style.display = 'flex';
    apiInner.style.flexDirection = 'column';
    apiInner.style.gap = '6px';
    apiInner.style.marginTop = '8px';

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
    this.apiKeyInputEl.placeholder = 'API Key (sk-...，留空可直接用“AI 免费本地生成”)';
    this.apiKeyInputEl.autocomplete = 'off';

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
    apiInner.append(apiRow1, this.apiKeyInputEl, consentRow);
    apiDetails.appendChild(apiInner);

    // Main Studio Grid: Left (Live Preview Box) | Right (Prompt + Upload + Swatches + Accessories)
    // Uses responsive CSS classes from style.css (.vm-avatar-studio-grid, .vm-avatar-preview-box, .vm-color-grid)
    const studioGrid = document.createElement('div');
    studioGrid.className = 'vm-avatar-studio-grid';

    // Left column: Live Pixel Preview Box + Save action
    const previewBox = document.createElement('div');
    previewBox.className = 'vm-avatar-preview-box';

    this.portraitImgEl = document.createElement('img');
    this.portraitImgEl.alt = 'Avatar Preview';
    this.portraitImgEl.style.width = '112px';
    this.portraitImgEl.style.height = '112px';
    this.portraitImgEl.style.border = '3px solid var(--vm-gold)';
    this.portraitImgEl.style.background = '#090c14';

    this.previewMetaEl = document.createElement('div');
    this.previewMetaEl.style.fontSize = '10px';
    this.previewMetaEl.style.color = 'var(--vm-dim)';

    this.saveBtnEl = document.createElement('button');
    this.saveBtnEl.type = 'button';
    this.saveBtnEl.className = 'vm-home-btn vm-home-btn-primary';
    this.saveBtnEl.style.width = '100%';
    this.saveBtnEl.textContent = '保存为新形象';
    this.saveBtnEl.addEventListener('click', () => {
      void this.handleSaveNewAvatar();
    });

    previewBox.append(this.portraitImgEl, this.previewMetaEl, this.saveBtnEl);

    // Right column: Prompt + Reference Upload + Color Swatches + Accessory Selector
    const rightCol = document.createElement('div');
    rightCol.style.display = 'flex';
    rightCol.style.flexDirection = 'column';
    rightCol.style.gap = '8px';
    rightCol.style.minWidth = '0';

    const promptBox = document.createElement('div');
    promptBox.className = 'vm-home-lobby';
    promptBox.style.gap = '6px';

    this.nameInputEl = document.createElement('input');
    this.nameInputEl.type = 'text';
    this.nameInputEl.className = 'vm-home-input';
    this.nameInputEl.maxLength = 24;
    this.nameInputEl.value = '赛博忍者';
    this.nameInputEl.placeholder = '自定义形象名称（如：赤红赛博忍者）';

    this.promptInputEl = document.createElement('textarea');
    this.promptInputEl.className = 'vm-home-input';
    this.promptInputEl.rows = 2;
    this.promptInputEl.style.height = '56px';
    this.promptInputEl.style.padding = '7px';
    this.promptInputEl.style.resize = 'vertical';
    this.promptInputEl.placeholder =
      '输入形象描述，如：红黑赛博忍者，带金色光环和蓝色护目镜...（也可上传参考图片）';

    const presetRow = document.createElement('div');
    presetRow.className = 'vm-home-recent-chips';
    for (const preset of PROMPT_PRESETS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'vm-home-recent-chip';
      chip.textContent = preset.slice(0, 8);
      chip.title = preset;
      chip.addEventListener('click', () => {
        this.promptInputEl.value = preset;
        this.runLocalGenerate();
      });
      presetRow.appendChild(chip);
    }

    // Reference image upload row
    const uploadRow = document.createElement('div');
    uploadRow.style.display = 'flex';
    uploadRow.style.alignItems = 'center';
    uploadRow.style.gap = '6px';
    uploadRow.style.flexWrap = 'wrap';

    this.fileInputEl = document.createElement('input');
    this.fileInputEl.type = 'file';
    this.fileInputEl.accept = 'image/*';
    this.fileInputEl.style.display = 'none';
    this.fileInputEl.addEventListener('change', () => {
      const file = this.fileInputEl.files?.[0];
      if (!file) return;
      void this.handleReferenceUpload(file);
    });

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'vm-home-recent-chip';
    uploadBtn.style.height = '26px';
    uploadBtn.style.padding = '0 8px';
    uploadBtn.textContent = '📷 上传参考图 (提取配色 / Vision)';
    uploadBtn.addEventListener('click', () => {
      this.fileInputEl.value = '';
      this.fileInputEl.click();
    });

    this.refPreviewRowEl = document.createElement('div');
    this.refPreviewRowEl.style.display = 'none';
    this.refPreviewRowEl.style.alignItems = 'center';
    this.refPreviewRowEl.style.gap = '6px';
    this.refPreviewRowEl.style.flexWrap = 'wrap';

    uploadRow.append(this.fileInputEl, uploadBtn, this.refPreviewRowEl);

    // Generate buttons
    const genRow = document.createElement('div');
    genRow.className = 'vm-home-actions';

    this.localGenBtnEl = document.createElement('button');
    this.localGenBtnEl.type = 'button';
    this.localGenBtnEl.className = 'vm-home-btn vm-home-btn-public';
    this.localGenBtnEl.style.flex = '1';
    this.localGenBtnEl.textContent = 'AI 免费本地生成';
    this.localGenBtnEl.addEventListener('click', () => this.runLocalGenerate());

    this.aiGenBtnEl = document.createElement('button');
    this.aiGenBtnEl.type = 'button';
    this.aiGenBtnEl.className = 'vm-home-btn vm-home-btn-primary';
    this.aiGenBtnEl.style.flex = '1';
    this.aiGenBtnEl.textContent = '调用 AI API 生成';
    this.aiGenBtnEl.addEventListener('click', () => {
      void this.runAiApiGenerate();
    });

    genRow.append(this.localGenBtnEl, this.aiGenBtnEl);
    promptBox.append(this.nameInputEl, this.promptInputEl, presetRow, uploadRow, genRow);

    // Interactive Color Swatches + Accessory Selector
    const editorBox = document.createElement('div');
    editorBox.className = 'vm-home-lobby';
    editorBox.style.gap = '7px';

    const colorTitle = document.createElement('div');
    colorTitle.style.fontSize = '11px';
    colorTitle.style.fontWeight = '700';
    colorTitle.style.color = 'var(--vm-gold)';
    colorTitle.textContent = '3D 像素形象调色板（实时预览）';

    const colorGrid = document.createElement('div');
    colorGrid.className = 'vm-color-grid';

    for (const slot of COLOR_SLOTS) {
      const row = document.createElement('label');

      const lbl = document.createElement('span');
      lbl.textContent = slot.label;

      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = this.draftSkin[slot.key];
      inp.addEventListener('input', () => {
        this.draftSkin[slot.key] = inp.value;
        this.refreshPreview();
      });

      this.colorInputs.set(slot.key, inp);
      row.append(lbl, inp);
      colorGrid.appendChild(row);
    }

    const accTitle = document.createElement('div');
    accTitle.style.fontSize = '11px';
    accTitle.style.fontWeight = '700';
    accTitle.style.color = 'var(--vm-cyan)';
    accTitle.textContent = '3D 专属配饰';

    const accRow = document.createElement('div');
    accRow.style.display = 'flex';
    accRow.style.flexWrap = 'wrap';
    accRow.style.gap = '5px';

    for (const opt of ACCESSORY_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vm-home-recent-chip';
      btn.style.height = '26px';
      btn.style.padding = '0 8px';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        this.draftSkin.accessory = opt.id;
        this.syncEditorFromDraft();
      });
      this.accessoryBtns.set(opt.id, btn);
      accRow.appendChild(btn);
    }

    editorBox.append(colorTitle, colorGrid, accTitle, accRow);
    rightCol.append(promptBox, editorBox);
    studioGrid.append(previewBox, rightCol);

    // Error Banner
    this.errorEl = document.createElement('div');
    this.errorEl.className = 'vm-home-error is-hidden';

    // Saved Avatars Section
    const savedHead = document.createElement('div');
    savedHead.style.fontSize = '11px';
    savedHead.style.fontWeight = '700';
    savedHead.style.color = 'var(--vm-gold)';
    savedHead.textContent = '已保存形象列表（点击立即切换并同步全服）';

    this.savedGridEl = document.createElement('div');
    this.savedGridEl.className = 'vm-saved-avatars-grid';

    card.append(
      head,
      apiDetails,
      studioGrid,
      this.errorEl,
      savedHead,
      this.savedGridEl
    );
    this.overlayEl.appendChild(card);
    container.appendChild(this.overlayEl);

    this.loadSavedConfigIfAny();
    this.syncEditorFromDraft();
    window.addEventListener('keydown', this.onWindowKeyDown, true);
  }

  open(saved: SavedCustomAvatar[], activeId: string): void {
    this.savedAvatars = [...saved];
    this.activeId = activeId;
    if (!this.modalOpen) {
      this.modalOpen = true;
      this.overlayEl.classList.add('is-open');
      this.cb.onToggle?.(true);
    }
    this.setError(null);
    this.loadSavedConfigIfAny();
    const active = this.savedAvatars.find((a) => a.id === activeId);
    if (active) {
      this.draftSkin = { ...active.skin };
      this.nameInputEl.value = active.name;
      if (active.prompt) this.promptInputEl.value = active.prompt;
    }
    this.syncEditorFromDraft();
    this.renderSavedList();
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

  refreshSaved(saved: SavedCustomAvatar[], activeId: string): void {
    this.savedAvatars = [...saved];
    this.activeId = activeId;
    if (this.modalOpen) {
      this.renderSavedList();
    }
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
    this.saveBtnEl.disabled = flag;
    this.aiGenBtnEl.textContent = flag ? 'AI 生成中...' : '调用 AI API 生成';
  }

  private syncEditorFromDraft(): void {
    for (const slot of COLOR_SLOTS) {
      const inp = this.colorInputs.get(slot.key);
      if (inp) inp.value = this.draftSkin[slot.key];
    }
    for (const opt of ACCESSORY_OPTIONS) {
      const btn = this.accessoryBtns.get(opt.id);
      if (!btn) continue;
      if (this.draftSkin.accessory === opt.id) {
        btn.style.borderColor = 'var(--vm-gold)';
        btn.style.color = 'var(--vm-gold)';
        btn.style.background = 'rgba(255, 190, 59, 0.16)';
      } else {
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.style.background = '';
      }
    }
    this.refreshPreview();
  }

  private refreshPreview(): void {
    const portrait = renderSkinPortraitDataUrl(
      this.draftSkin,
      this.refImageDataUrl ?? undefined
    );
    this.portraitImgEl.src = portrait;
    const accLabel =
      ACCESSORY_OPTIONS.find((a) => a.id === this.draftSkin.accessory)?.label ?? '无';
    this.previewMetaEl.textContent = `实时预览 · 配饰：${accLabel}`;
  }

  private async handleReferenceUpload(file: File): Promise<void> {
    this.setError(null);
    try {
      const { dataUrl, dominantHexes } = await compressReferenceImage(file);
      this.refImageDataUrl = dataUrl;
      this.refDominantHexes = dominantHexes;
      this.renderRefPreview();
      // Immediately apply extracted palette if prompt is empty or user uploaded a fresh ref
      const local = generateLocalCustomSkin(
        this.promptInputEl.value.trim() || file.name.replace(/\.[^.]+$/, ''),
        dominantHexes
      );
      this.draftSkin = { ...local.skin };
      if (!this.nameInputEl.value.trim()) {
        this.nameInputEl.value = local.name;
      }
      this.syncEditorFromDraft();
      this.cb.onToast?.('已提取参考图主色调并生成预览，可微调或调用 AI Vision', 'cyan');
    } catch (err) {
      this.setError(err instanceof Error ? err.message : '参考图处理失败');
    }
  }

  private renderRefPreview(): void {
    this.refPreviewRowEl.textContent = '';
    if (!this.refImageDataUrl) {
      this.refPreviewRowEl.style.display = 'none';
      return;
    }
    this.refPreviewRowEl.style.display = 'inline-flex';

    const thumb = document.createElement('img');
    thumb.src = this.refImageDataUrl;
    thumb.alt = 'Reference';
    thumb.style.width = '28px';
    thumb.style.height = '28px';
    thumb.style.objectFit = 'cover';
    thumb.style.border = '2px solid var(--vm-cyan)';

    this.refPreviewRowEl.appendChild(thumb);

    for (const hex of this.refDominantHexes) {
      const dot = document.createElement('span');
      dot.style.width = '12px';
      dot.style.height = '12px';
      dot.style.display = 'inline-block';
      dot.style.background = hex;
      dot.style.border = '1px solid rgba(255,255,255,0.45)';
      dot.title = hex;
      this.refPreviewRowEl.appendChild(dot);
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'vm-home-recent-chip';
    clearBtn.textContent = '移除参考图';
    clearBtn.addEventListener('click', () => {
      this.refImageDataUrl = null;
      this.refDominantHexes = [];
      this.renderRefPreview();
      this.refreshPreview();
    });
    this.refPreviewRowEl.appendChild(clearBtn);
  }

  private runLocalGenerate(): void {
    this.setError(null);
    const prompt = this.promptInputEl.value.trim() || '赛博霓虹骑士';
    const generated = generateLocalCustomSkin(
      prompt,
      this.refDominantHexes.length > 0 ? this.refDominantHexes : undefined
    );
    this.draftSkin = { ...generated.skin };
    this.nameInputEl.value = generated.name;
    this.syncEditorFromDraft();
  }

  private async runAiApiGenerate(): Promise<void> {
    if (this.busy) return;
    const prompt = this.promptInputEl.value.trim();
    if (!prompt && !this.refImageDataUrl) {
      this.setError('请先输入形象描述，或上传一张参考图片');
      return;
    }

    const baseUrl =
      this.baseUrlInputEl.value.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1';
    const apiKey = this.apiKeyInputEl.value.trim();
    const model = this.modelInputEl.value.trim() || 'gpt-4o-mini';

    if (!apiKey) {
      this.setError('未填写 API Key，已自动使用“AI 免费本地生成”');
      this.runLocalGenerate();
      return;
    }

    this.persistConfigIfOptedIn();
    this.setError(null);
    this.setBusy(true);

    const systemPrompt =
      'You are a 3D voxel character skin designer for an arcade motorcycle open-world game. ' +
      'Reply ONLY with strict JSON matching: ' +
      '{"name":"short name","skin":{"head":"#rrggbb","face":"#rrggbb","hair":"#rrggbb","jacket":"#rrggbb","stripe":"#rrggbb","pants":"#rrggbb","boots":"#rrggbb","bikePrimary":"#rrggbb","bikeAccent":"#rrggbb","visor":"#rrggbb","accessory":"none|halo|horns|crown|wings|cape|antenna"}}. ' +
      'All colors must be 6-digit hex codes (#rrggbb). Pick vibrant harmonious colors matching the user text and/or reference image. No markdown, no extra commentary.';

    const userText =
      prompt || 'Design a stylish 3D voxel biker avatar matching this reference image.';
    const userContent: unknown = this.refImageDataUrl
      ? [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: this.refImageDataUrl } },
        ]
      : userText;

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.6,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
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
      if (!parsed) {
        throw new Error('AI 未返回有效 JSON 形象数据');
      }

      const skin = sanitizeCustomSkin(parsed.skin ?? parsed);
      if (!skin) {
        throw new Error('AI 返回的皮肤配色字段不完整');
      }

      this.draftSkin = { ...skin };
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        this.nameInputEl.value = parsed.name.trim().slice(0, 24);
      }
      this.syncEditorFromDraft();
      this.cb.onToast?.('AI 形象生成完成！点击“保存为新形象”即可穿戴', 'gold');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 请求失败';
      this.setError(`AI 调用失败 (${msg})，可改用“AI 免费本地生成”`);
    } finally {
      this.setBusy(false);
    }
  }

  private async handleSaveNewAvatar(): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    const name = this.nameInputEl.value.trim().slice(0, 24) || '自定义形象';
    const prompt = this.promptInputEl.value.trim().slice(0, 200) || undefined;
    const skin: CustomAvatarSkin = { ...this.draftSkin };
    const portraitDataUrl = renderSkinPortraitDataUrl(
      skin,
      this.refImageDataUrl ?? undefined
    );

    this.busy = true;
    this.saveBtnEl.disabled = true;
    try {
      await this.cb.onSaveAvatar({
        name,
        prompt,
        portraitDataUrl,
        skin,
      });
    } finally {
      this.busy = false;
      this.saveBtnEl.disabled = false;
    }
  }

  private async handleSelectAvatar(av: SavedCustomAvatar | null): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    try {
      await this.cb.onSelectAvatar(av);
    } finally {
      this.busy = false;
    }
  }

  private async handleDeleteAvatar(id: string): Promise<void> {
    if (this.busy) return;
    this.setError(null);
    this.busy = true;
    try {
      await this.cb.onDeleteAvatar(id);
    } finally {
      this.busy = false;
    }
  }

  private renderSavedList(): void {
    this.savedGridEl.textContent = '';

    // Built-in default card
    const defaultCard = document.createElement('div');
    defaultCard.className = 'vm-saved-avatar-card vm-eco-card vm-home-lobby';
    const isDefaultActive = !this.activeId;
    defaultCard.style.borderColor = isDefaultActive ? 'var(--vm-gold)' : 'var(--vm-steel)';
    defaultCard.style.gap = '6px';

    const defTop = document.createElement('div');
    defTop.style.display = 'flex';
    defTop.style.alignItems = 'center';
    defTop.style.gap = '8px';

    const defIcon = document.createElement('span');
    defIcon.className = 'vm-btn-icon';
    defIcon.style.width = '36px';
    defIcon.style.height = '36px';
    defIcon.style.background = 'var(--vm-bg-deep)';
    defIcon.style.border = '2px solid var(--vm-steel)';
    defIcon.innerHTML = getPixelIconSvg('user');

    const defMeta = document.createElement('div');
    defMeta.style.minWidth = '0';
    const defName = document.createElement('div');
    defName.style.fontSize = '11px';
    defName.style.fontWeight = '700';
    defName.textContent = '默认内置形象';
    const defTag = document.createElement('div');
    defTag.style.fontSize = '9px';
    defTag.style.color = isDefaultActive ? 'var(--vm-gold)' : 'var(--vm-dim)';
    defTag.textContent = isDefaultActive ? '● 当前使用中' : '经典内置角色';
    defMeta.append(defName, defTag);
    defTop.append(defIcon, defMeta);

    const defBtn = document.createElement('button');
    defBtn.type = 'button';
    defBtn.className = isDefaultActive ? 'vm-home-btn' : 'vm-home-btn vm-home-btn-public';
    defBtn.style.height = '24px';
    defBtn.style.fontSize = '10px';
    defBtn.disabled = isDefaultActive || this.busy;
    defBtn.textContent = isDefaultActive ? '使用中' : '切换为默认';
    defBtn.addEventListener('click', () => {
      void this.handleSelectAvatar(null);
    });

    defaultCard.append(defTop, defBtn);
    this.savedGridEl.appendChild(defaultCard);

    for (const av of this.savedAvatars) {
      const active = av.id === this.activeId;
      const card = document.createElement('div');
      card.className = 'vm-saved-avatar-card vm-eco-card vm-home-lobby';
      if (active) card.classList.add('is-active');
      card.style.borderColor = active ? 'var(--vm-gold)' : 'var(--vm-steel)';
      card.style.gap = '6px';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.gap = '8px';

      const img = document.createElement('img');
      img.src = av.portraitDataUrl || renderSkinPortraitDataUrl(av.skin);
      img.alt = av.name;
      img.style.width = '36px';
      img.style.height = '36px';
      img.style.imageRendering = 'pixelated';
      img.style.border = `2px solid ${active ? 'var(--vm-gold)' : 'var(--vm-steel)'}`;
      img.style.background = '#090c14';
      img.style.flexShrink = '0';

      const meta = document.createElement('div');
      meta.style.minWidth = '0';
      const nameEl = document.createElement('div');
      nameEl.style.fontSize = '11px';
      nameEl.style.fontWeight = '700';
      nameEl.style.overflow = 'hidden';
      nameEl.style.textOverflow = 'ellipsis';
      nameEl.style.whiteSpace = 'nowrap';
      nameEl.textContent = av.name;

      const subEl = document.createElement('div');
      subEl.style.fontSize = '9px';
      subEl.style.color = active ? 'var(--vm-gold)' : 'var(--vm-dim)';
      const acc = ACCESSORY_OPTIONS.find((a) => a.id === av.skin.accessory)?.label ?? '无';
      subEl.textContent = active ? '● 使用中 (全服同步)' : `配饰: ${acc}`;

      meta.append(nameEl, subEl);
      top.append(img, meta);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = active ? 'vm-home-btn' : 'vm-home-btn vm-home-btn-primary';
      useBtn.style.height = '24px';
      useBtn.style.fontSize = '10px';
      useBtn.style.flex = '1';
      useBtn.disabled = active || this.busy;
      useBtn.textContent = active ? '使用中' : '穿戴';
      useBtn.addEventListener('click', () => {
        void this.handleSelectAvatar(av);
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'vm-home-recent-chip';
      editBtn.textContent = '载入';
      editBtn.title = '载入到编辑器微调';
      editBtn.addEventListener('click', () => {
        this.draftSkin = { ...av.skin };
        this.nameInputEl.value = av.name;
        if (av.prompt) this.promptInputEl.value = av.prompt;
        this.syncEditorFromDraft();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'vm-home-btn vm-home-btn-resume';
      delBtn.style.height = '24px';
      delBtn.style.fontSize = '10px';
      delBtn.style.padding = '0 6px';
      delBtn.disabled = this.busy;
      delBtn.textContent = '删';
      delBtn.addEventListener('click', () => {
        void this.handleDeleteAvatar(av.id);
      });

      actions.append(useBtn, editBtn, delBtn);
      card.append(top, actions);
      this.savedGridEl.appendChild(card);
    }
  }

  private loadSavedConfigIfAny(): void {
    try {
      const raw =
        window.localStorage.getItem(STORAGE_AI_CFG_KEY) ||
        window.localStorage.getItem(STORAGE_AI_BUILDER_CFG_KEY);
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
    const serialized = JSON.stringify(cfg);
    try {
      window.localStorage.setItem(STORAGE_AI_CFG_KEY, serialized);
      window.localStorage.setItem(STORAGE_AI_BUILDER_CFG_KEY, serialized);
    } catch {
      // Ignore
    }
  }

  private removeSavedConfig(): void {
    try {
      window.localStorage.removeItem(STORAGE_AI_CFG_KEY);
      window.localStorage.removeItem(STORAGE_AI_BUILDER_CFG_KEY);
    } catch {
      // Ignore
    }
  }
}
