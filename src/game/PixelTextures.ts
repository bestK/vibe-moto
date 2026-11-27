import * as THREE from 'three';
import { drawRiderAvatarToContext } from './PixelAvatars';

function makePixelCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function toCrispTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  srgb = true
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = repeatX > 1 || repeatX === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeatY > 1 || repeatY === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  if (repeatX > 0 && repeatY > 0) {
    tex.repeat.set(repeatX, repeatY);
  }
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export interface PixelTextureAtlas {
  road: THREE.CanvasTexture;
  curb: THREE.CanvasTexture;
  terrain: THREE.CanvasTexture;
  sky: THREE.CanvasTexture;
  wheel: THREE.CanvasTexture;
  boostPad: THREE.CanvasTexture;
  billboards: THREE.CanvasTexture[];
  bark: THREE.CanvasTexture;
  foliagePine: THREE.CanvasTexture;
  foliagePalm: THREE.CanvasTexture;
  canyonRock: THREE.CanvasTexture;
  carWindows: THREE.CanvasTexture;
  crate: THREE.CanvasTexture;
  lapArch: THREE.CanvasTexture;
  hitWords: Record<string, THREE.CanvasTexture>;
}

let _cachedAtlas: PixelTextureAtlas | null = null;

export function getPixelAtlas(): PixelTextureAtlas {
  if (_cachedAtlas) return _cachedAtlas;
  _cachedAtlas = {
    road: createRoadTexture(),
    curb: createCurbTexture(),
    terrain: createTerrainTexture(),
    sky: createSkyTexture(),
    wheel: createWheelTexture(),
    boostPad: createBoostPadTexture(),
    billboards: [
      createBillboardTexture('VIBE 66', '#ff4d6d', '#1b1d2e', '#ffd166'),
      createBillboardTexture('NITRO X', '#00f5d4', '#101828', '#ff9f1c'),
      createBillboardTexture('RASH!!', '#ffbe0b', '#22181c', '#fb5607'),
      createBillboardTexture('EMQX', '#38b000', '#0d1b2a', '#ccff33'),
    ],
    bark: createBarkTexture(),
    foliagePine: createFoliageTexture('#1b4332', '#2d6a4f', '#40916c'),
    foliagePalm: createFoliageTexture('#2a7221', '#4ea832', '#70c143'),
    canyonRock: createRockTexture(),
    carWindows: createCarWindowTexture(),
    crate: createMysteryCrateTexture(),
    lapArch: createLapArchTexture(),
    hitWords: {
      POW: createComicBurstTexture('POW!', '#ffe600', '#ff2a54'),
      SMACK: createComicBurstTexture('SMACK!', '#00f5d4', '#ff595e'),
      BONK: createComicBurstTexture('BONK!', '#ffbe0b', '#8338ec'),
      KO: createComicBurstTexture('K.O.!', '#ff0054', '#ffe600'),
      BOOST: createComicBurstTexture('NITRO!', '#00e5ff', '#2b7fff'),
      SLAM: createComicBurstTexture('SLAM!', '#ffd166', '#ff4d00'),
      FLIP: createComicBurstTexture('FLIPPED!', '#ff2a54', '#11121a'),
      BOOM: createComicBurstTexture('BOOM!', '#ff4d00', '#ffe600'),
      SLIP: createComicBurstTexture('SLIP!', '#ffe600', '#3a86ff'),
      SNIPED: createComicBurstTexture('SNIPED!', '#00f5d4', '#ff0054'),
      DODGED: createComicBurstTexture('DODGED!', '#52e065', '#00f5d4'),
    },
  };
  return _cachedAtlas;
}

/**
 * Crisp HD-pixel 4-lane asphalt with subtle dithering, tire wear strips,
 * yellow double centerline, dashed white lane dividers, and edge lines.
 */
function createRoadTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(128, 128);
  ctx.fillStyle = '#2d303e';
  ctx.fillRect(0, 0, 128, 128);

  // Subtle asphalt pixel grain & tire tracks
  for (let y = 0; y < 128; y += 2) {
    for (let x = 0; x < 128; x += 2) {
      const h = ((x * 73 + y * 151 + x * y * 7) >>> 0) % 19;
      if (h === 0) {
        ctx.fillStyle = '#383c4d';
        ctx.fillRect(x, y, 2, 2);
      } else if (h === 1) {
        ctx.fillStyle = '#242733';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // Subtle worn wheel ruts in each of 4 lanes
  const rutCenters = [16, 48, 80, 112];
  ctx.fillStyle = 'rgba(18, 20, 28, 0.34)';
  for (const rc of rutCenters) {
    ctx.fillRect(rc - 6, 0, 4, 128);
    ctx.fillRect(rc + 2, 0, 4, 128);
  }

  // Crisp outer white shoulder lines
  ctx.fillStyle = '#e8ecf2';
  ctx.fillRect(3, 0, 3, 128);
  ctx.fillRect(122, 0, 3, 128);

  // Double amber-yellow centerline
  ctx.fillStyle = '#f8c630';
  ctx.fillRect(61, 0, 2, 128);
  ctx.fillRect(65, 0, 2, 128);

  // White dashed lane dividers (at 1/4 and 3/4)
  ctx.fillStyle = '#edf2f4';
  for (let y = 8; y < 128; y += 32) {
    ctx.fillRect(32, y, 2, 16);
    ctx.fillRect(94, y, 2, 16);
  }

  const tex = toCrispTexture(c, 1, 1);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Red & cream arcade pixel rumble strip curb.
 */
function createCurbTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 32);
  ctx.fillStyle = '#e63946';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#b91c2b';
  ctx.fillRect(0, 14, 16, 2);
  ctx.fillRect(0, 0, 2, 16);

  ctx.fillStyle = '#f4f1de';
  ctx.fillRect(0, 16, 16, 16);
  ctx.fillStyle = '#d8d2b8';
  ctx.fillRect(0, 30, 16, 2);
  ctx.fillRect(0, 16, 2, 16);

  const tex = toCrispTexture(c, 1, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Pixelated warm coastal/prairie shoulder ground with checker dithering.
 */
function createTerrainTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(64, 64);
  ctx.fillStyle = '#5a7d43';
  ctx.fillRect(0, 0, 64, 64);

  for (let y = 0; y < 64; y += 4) {
    for (let x = 0; x < 64; x += 4) {
      const h = ((x * 37 + y * 97) >>> 0) % 11;
      if (h < 3) {
        ctx.fillStyle = '#4c6d37';
        ctx.fillRect(x, y, 4, 4);
      } else if (h === 4) {
        ctx.fillStyle = '#6f9653';
        ctx.fillRect(x, y, 4, 4);
      } else if (h === 5) {
        ctx.fillStyle = '#8b7355';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  const tex = toCrispTexture(c, 1, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Stepped pixel-art sunset sky dome texture (banded zenith-to-horizon sunset + pixel sun + stars).
 */
function createSkyTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(256, 128);

  const bands: Array<[number, string]> = [
    [0, '#121836'],
    [14, '#1b264f'],
    [28, '#2b3467'],
    [40, '#4f3b78'],
    [50, '#8f3f65'],
    [58, '#d6495c'],
    [65, '#f26a4b'],
    [71, '#ff9843'],
    [77, '#ffd166'],
    [83, '#fff0b3'],
    [88, '#3b526b'],
    [128, '#1e2c3d'],
  ];

  for (let i = 0; i < bands.length - 1; i++) {
    const [y0, col] = bands[i];
    const [y1] = bands[i + 1];
    ctx.fillStyle = col;
    ctx.fillRect(0, y0, 256, y1 - y0);
    // Ordered Bayer-style pixel dither seam between bands
    if (i < bands.length - 2 && y1 < 86) {
      ctx.fillStyle = bands[i + 1][1];
      for (let x = 0; x < 256; x += 2) {
        ctx.fillRect(x, y1 - 1, 1, 1);
        if (x % 4 === 0) ctx.fillRect(x + 1, y1 - 2, 1, 1);
      }
    }
  }

  // Pixel stars in upper sky
  ctx.fillStyle = '#fff9db';
  for (let i = 0; i < 42; i++) {
    const sx = (i * 53 + 17) % 256;
    const sy = 4 + ((i * 29) % 34);
    ctx.fillRect(sx, sy, 1, 1);
  }

  // Retro arcade striped pixel sun near forward horizon (-Z maps to u = 0.75 or 0.5)
  const sunX = 128;
  const sunY = 66;
  const r = 13;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) {
        // Horizontal synthwave cutouts near bottom of sun
        if (dy > 3 && dy % 3 === 0) continue;
        ctx.fillStyle = dy < -2 ? '#fff7c2' : dy < 4 ? '#ffd166' : '#ff7b54';
        ctx.fillRect(sunX + dx, sunY + dy, 1, 1);
      }
    }
  }

  // Crisp blocky pixel clouds
  const clouds = [
    [28, 46, 28, 6],
    [74, 52, 22, 5],
    [164, 48, 30, 6],
    [216, 42, 24, 5],
  ];
  for (const [cx, cy, cw, ch] of clouds) {
    ctx.fillStyle = '#ffe5b4';
    ctx.fillRect(cx + 4, cy - 2, cw - 8, 3);
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = '#f28482';
    ctx.fillRect(cx + 2, cy + ch - 2, cw - 4, 2);
  }

  const tex = toCrispTexture(c, 1, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Crisp pixel tire sidewall & alloy rim spokes.
 */
function createWheelTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 32);
  ctx.fillStyle = '#181920';
  ctx.fillRect(0, 0, 32, 32);

  // Tire tread blocks & rim
  const cx = 16;
  const cy = 16;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 11 && d <= 15.5) {
        ctx.fillStyle = ((x + y) & 2) ? '#22242e' : '#16171f';
        ctx.fillRect(x, y, 1, 1);
      } else if (d > 8.5 && d <= 11) {
        ctx.fillStyle = '#d9e0e8';
        ctx.fillRect(x, y, 1, 1);
      } else if (d <= 8.5) {
        ctx.fillStyle = '#2d3240';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Spokes
  ctx.fillStyle = '#9aa5b8';
  ctx.fillRect(15, 6, 2, 20);
  ctx.fillRect(6, 15, 20, 2);
  ctx.fillStyle = '#ffb703';
  ctx.fillRect(14, 14, 4, 4);

  return toCrispTexture(c, 1, 1);
}

/**
 * Neon cyan/yellow chevron speed boost pad.
 */
function createBoostPadTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 64);
  ctx.fillStyle = '#10192b';
  ctx.fillRect(0, 0, 32, 64);
  ctx.fillStyle = '#00f5d4';
  ctx.fillRect(0, 0, 3, 64);
  ctx.fillRect(29, 0, 3, 64);

  // Pixel chevrons pointing forward (-Z => top of texture)
  for (let rep = 0; rep < 3; rep++) {
    const baseY = 10 + rep * 20;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = rep === 0 ? '#ffe600' : '#00f5d4';
      ctx.fillRect(15 - i, baseY + i, 2, 4);
      ctx.fillRect(15 + i, baseY + i, 2, 4);
    }
  }
  return toCrispTexture(c, 1, 1);
}

function createBillboardTexture(text: string, fg: string, bg: string, border: string): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(96, 48);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 96, 48);
  ctx.strokeStyle = border;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 92, 44);

  // Subtle scanlines
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let y = 6; y < 42; y += 4) ctx.fillRect(6, y, 84, 2);

  ctx.fillStyle = fg;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 48, 25);
  return toCrispTexture(c, 1, 1);
}

function createBarkTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#472d20';
  for (let x = 0; x < 16; x += 4) {
    ctx.fillRect(x, 0, 2, 16);
  }
  ctx.fillStyle = '#73503c';
  ctx.fillRect(2, 2, 2, 6);
  ctx.fillRect(10, 8, 2, 6);
  return toCrispTexture(c, 1, 1);
}

function createFoliageTexture(dark: string, mid: string, light: string): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  ctx.fillStyle = mid;
  ctx.fillRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y += 2) {
    for (let x = 0; x < 16; x += 2) {
      const h = (x * 13 + y * 29) % 7;
      if (h < 2) {
        ctx.fillStyle = dark;
        ctx.fillRect(x, y, 2, 2);
      } else if (h === 3) {
        ctx.fillStyle = light;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  return toCrispTexture(c, 1, 1);
}

function createRockTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  ctx.fillStyle = '#b5563c';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#99432d';
  ctx.fillRect(0, 4, 16, 3);
  ctx.fillRect(0, 11, 16, 3);
  ctx.fillStyle = '#d47451';
  ctx.fillRect(2, 1, 10, 2);
  ctx.fillRect(4, 8, 9, 2);
  return toCrispTexture(c, 1, 1);
}

function createCarWindowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);
  ctx.fillStyle = '#1c2838';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#4cc9f0';
  ctx.fillRect(2, 2, 10, 3);
  ctx.fillStyle = '#90e0ef';
  ctx.fillRect(3, 2, 5, 2);
  return toCrispTexture(c, 1, 1);
}

function createComicBurstTexture(label: string, fill: string, stroke: string): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(128, 64);
  ctx.clearRect(0, 0, 128, 64);

  // Pixel starburst polygon
  ctx.beginPath();
  const cx = 64;
  const cy = 32;
  const spikes = 10;
  for (let i = 0; i < spikes * 2; i++) {
    const rX = i % 2 === 0 ? 58 : 38;
    const rY = i % 2 === 0 ? 28 : 18;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const px = Math.round(cx + Math.cos(a) * rX);
    const py = Math.round(cy + Math.sin(a) * rY);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = stroke;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const rX = i % 2 === 0 ? 51 : 32;
    const rY = i % 2 === 0 ? 23 : 14;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const px = Math.round(cx + Math.cos(a) * rX);
    const py = Math.round(cy + Math.sin(a) * rY);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#11121a';
  ctx.fillText(label, cx + 2, cy + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cy);

  return toCrispTexture(c, 1, 1);
}

function createLapArchTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(192, 32);
  ctx.fillStyle = '#0d101d';
  ctx.fillRect(0, 0, 192, 32);

  // Crisp checkered racing strips along top & bottom edges
  for (let x = 0; x < 192; x += 8) {
    const even = ((x >> 3) & 1) === 0;
    ctx.fillStyle = even ? '#f8f9fa' : '#11131f';
    ctx.fillRect(x, 0, 8, 6);
    ctx.fillStyle = even ? '#11131f' : '#f8f9fa';
    ctx.fillRect(x, 26, 8, 6);
  }

  // Crimson & gold accent trim lines
  ctx.fillStyle = '#ff2a54';
  ctx.fillRect(0, 6, 192, 2);
  ctx.fillRect(0, 24, 192, 2);

  // Bold pixel arcade banner label
  ctx.font = 'bold 14px "Press Start 2P", "Silkscreen", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.fillText('START ★ LAP', 98, 18);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('START ★ LAP', 96, 16);

  return toCrispTexture(c, 1, 1);
}

function createMysteryCrateTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 32);
  ctx.fillStyle = '#18142b';
  ctx.fillRect(0, 0, 32, 32);
  // Crisp neon gold & cyan double border
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(0, 0, 32, 3);
  ctx.fillRect(0, 29, 32, 3);
  ctx.fillRect(0, 0, 3, 32);
  ctx.fillRect(29, 0, 3, 32);
  ctx.fillStyle = '#00f5d4';
  ctx.fillRect(4, 4, 24, 2);
  ctx.fillRect(4, 26, 24, 2);
  ctx.fillRect(4, 4, 2, 24);
  ctx.fillRect(26, 4, 2, 24);
  // Corner rivets
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(2, 2, 3, 3);
  ctx.fillRect(27, 2, 3, 3);
  ctx.fillRect(2, 27, 3, 3);
  ctx.fillRect(27, 27, 3, 3);
  // Bold pixel '?'
  ctx.fillStyle = '#0d0f1a';
  ctx.fillRect(11, 8, 10, 3);
  ctx.fillRect(18, 11, 4, 5);
  ctx.fillRect(14, 15, 6, 3);
  ctx.fillRect(14, 18, 4, 3);
  ctx.fillRect(14, 23, 4, 3);
  ctx.fillStyle = '#fff59d';
  ctx.fillRect(10, 7, 10, 3);
  ctx.fillRect(17, 10, 4, 5);
  ctx.fillRect(13, 14, 6, 3);
  ctx.fillRect(13, 17, 4, 3);
  ctx.fillRect(13, 22, 4, 3);
  return toCrispTexture(c, 1, 1);
}

/**
 * Generates or updates a crisp pixel floating nameplate + pixel avatar + mini HP strip texture for a rider.
 * Optimized for 192x48 canvas (~44% less VRAM & upload bandwidth than 256x64).
 */
export function drawNameplateCanvas(
  canvas: HTMLCanvasElement,
  name: string,
  hp: number,
  accentHex: string,
  isBot: boolean,
  avatarIdx = 0,
  ownerId = ''
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const label = name.slice(0, 14);
  ctx.font = 'bold 14px "Silkscreen", "Press Start 2P", monospace';
  const avatarSize = 24;
  const avatarBox = avatarSize + 4; // 2px pixel border on all sides -> 28px
  const gap = 3;
  const maxNameBoxW = w - avatarBox - gap - 6;
  const nameBoxW = Math.min(maxNameBoxW, Math.max(58, Math.ceil(ctx.measureText(label).width) + 14));
  const totalW = avatarBox + gap + nameBoxW;
  const startX = Math.floor((w - totalW) / 2);
  const boxY = 4;
  const boxH = avatarBox; // 28px
  const borderCol = isBot ? '#6c757d' : accentHex;

  // Avatar frame on left (crisp 2px pixel border)
  ctx.fillStyle = '#090b12';
  ctx.fillRect(startX - 1, boxY - 1, avatarBox + 2, boxH + 2);
  ctx.fillStyle = borderCol;
  ctx.fillRect(startX, boxY, avatarBox, boxH);
  drawRiderAvatarToContext(ctx, ownerId, avatarIdx, startX + 2, boxY + 2, avatarSize);

  // Name box on right
  const nameX = startX + avatarBox + gap;
  ctx.fillStyle = 'rgba(12, 14, 24, 0.88)';
  ctx.fillRect(nameX, boxY, nameBoxW, boxH);
  ctx.fillStyle = borderCol;
  ctx.fillRect(nameX, boxY, nameBoxW, 2);
  ctx.fillRect(nameX, boxY + boxH - 2, nameBoxW, 2);
  ctx.fillRect(nameX, boxY, 2, boxH);
  ctx.fillRect(nameX + nameBoxW - 2, boxY, 2, boxH);

  // Name text
  const textCenterX = nameX + nameBoxW / 2;
  const textCenterY = boxY + boxH / 2 + 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#090b12';
  ctx.fillText(label, textCenterX + 1, textCenterY + 1, nameBoxW - 10);
  ctx.fillStyle = isBot ? '#ced4da' : '#ffffff';
  ctx.fillText(label, textCenterX, textCenterY, nameBoxW - 10);

  // Mini pixel HP strip underneath
  const barW = Math.min(totalW - 4, 118);
  const barX = Math.floor((w - barW) / 2);
  const barY = boxY + boxH + 4;
  const barH = 6;
  ctx.fillStyle = '#0d0f17';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  const pct = Math.max(0, Math.min(1, hp / 100));
  ctx.fillStyle = pct > 0.55 ? '#52e065' : pct > 0.25 ? '#ffb703' : '#ff2a54';
  ctx.fillRect(barX, barY, Math.round(barW * pct), barH);
}
