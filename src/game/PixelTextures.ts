import * as THREE from 'three';
import { t } from '../i18n';
import { drawRiderAvatarToContext } from './PixelAvatars';
import type { WeatherId } from './WeatherSystem';

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
  getSky(weather: WeatherId): THREE.CanvasTexture;
  headlightBeam: THREE.CanvasTexture;
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
const _lazySkies: Partial<Record<WeatherId, THREE.CanvasTexture>> = {};

function getOrCreateSky(weather: WeatherId): THREE.CanvasTexture {
  const existing = _lazySkies[weather];
  if (existing) return existing;
  const tex = createSkyTexture(weather);
  _lazySkies[weather] = tex;
  return tex;
}

export function getPixelAtlas(): PixelTextureAtlas {
  if (_cachedAtlas) return _cachedAtlas;
  const clearSky = getOrCreateSky('clear');
  _cachedAtlas = {
    road: createRoadTexture(),
    curb: createCurbTexture(),
    terrain: createTerrainTexture(),
    sky: clearSky,
    getSky: getOrCreateSky,
    headlightBeam: createHeadlightBeamTexture(),
    wheel: createWheelTexture(),
    boostPad: createBoostPadTexture(),
    billboards: [
      createBillboardTexture('VIBE 66', '#ff526d', '#141926', '#ffbe3b'),
      createBillboardTexture('NITRO X', '#38e2d4', '#101824', '#ff962e'),
      createBillboardTexture('RASH!!', '#ffbe3b', '#1e1721', '#ff5d22'),
      createBillboardTexture('EMQX', '#46d97c', '#0f1b24', '#c7f95a'),
    ],
    bark: createBarkTexture(),
    foliagePine: createFoliageTexture('#205948', '#317a61', '#4ca182'),
    foliagePalm: createFoliageTexture('#2e8549', '#49b560', '#79de7d'),
    canyonRock: createRockTexture(),
    carWindows: createCarWindowTexture(),
    crate: createMysteryCrateTexture(),
    lapArch: createLapArchTexture(),
    hitWords: {
      POW: createComicBurstTexture('POW!', '#ffe14d', '#ff3b5c'),
      SMACK: createComicBurstTexture('SMACK!', '#38e2d4', '#ff5266'),
      BONK: createComicBurstTexture('BONK!', '#ffbe3b', '#8e5ce6'),
      KO: createComicBurstTexture('K.O.!', '#ff2e55', '#ffe14d'),
      BOOST: createComicBurstTexture('NITRO!', '#38e2d4', '#3b8cff'),
      SLAM: createComicBurstTexture('SLAM!', '#ffbe3b', '#ff5d22'),
      FLIP: createComicBurstTexture('FLIPPED!', '#ff3b5c', '#10131c'),
      BOOM: createComicBurstTexture('BOOM!', '#ff5d22', '#ffe14d'),
      SLIP: createComicBurstTexture('SLIP!', '#ffe14d', '#3b8cff'),
      SNIPED: createComicBurstTexture('SNIPED!', '#38e2d4', '#ff3b5c'),
      DODGED: createComicBurstTexture('DODGED!', '#46d97c', '#38e2d4'),
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
  ctx.fillStyle = '#2d3446';
  ctx.fillRect(0, 0, 128, 128);

  // Subtle cool slate asphalt grain
  for (let y = 0; y < 128; y += 2) {
    for (let x = 0; x < 128; x += 2) {
      const h = ((x * 73 + y * 151 + x * y * 7) >>> 0) % 19;
      if (h === 0) {
        ctx.fillStyle = '#3b4359';
        ctx.fillRect(x, y, 2, 2);
      } else if (h === 1) {
        ctx.fillStyle = '#242a38';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // Subtle worn wheel ruts in each of 4 lanes
  const rutCenters = [16, 48, 80, 112];
  ctx.fillStyle = 'rgba(18, 22, 33, 0.30)';
  for (const rc of rutCenters) {
    ctx.fillRect(rc - 6, 0, 4, 128);
    ctx.fillRect(rc + 2, 0, 4, 128);
  }

  // Crisp outer white shoulder lines
  ctx.fillStyle = '#eef2f7';
  ctx.fillRect(3, 0, 3, 128);
  ctx.fillRect(122, 0, 3, 128);

  // Warm golden-amber double centerline
  ctx.fillStyle = '#ffbe3b';
  ctx.fillRect(61, 0, 2, 128);
  ctx.fillRect(65, 0, 2, 128);

  // White dashed lane dividers (at 1/4 and 3/4)
  ctx.fillStyle = '#edf2f7';
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
 * Red & warm ivory arcade pixel rumble strip curb.
 */
function createCurbTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 32);
  ctx.fillStyle = '#e8414f';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#bd2636';
  ctx.fillRect(0, 14, 16, 2);
  ctx.fillRect(0, 0, 2, 16);

  ctx.fillStyle = '#f5f1e1';
  ctx.fillRect(0, 16, 16, 16);
  ctx.fillStyle = '#dcd5bc';
  ctx.fillRect(0, 30, 16, 2);
  ctx.fillRect(0, 16, 2, 16);

  const tex = toCrispTexture(c, 1, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * High-luminance neutral pixel grass/earth texture so biome & weather material tints
 * stay vivid and clean instead of double-darkening into mud.
 */
function createTerrainTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(64, 64);
  ctx.fillStyle = '#d4dccb';
  ctx.fillRect(0, 0, 64, 64);

  for (let y = 0; y < 64; y += 4) {
    for (let x = 0; x < 64; x += 4) {
      const h = ((x * 37 + y * 97) >>> 0) % 11;
      if (h < 3) {
        ctx.fillStyle = '#bcc7b2';
        ctx.fillRect(x, y, 4, 4);
      } else if (h === 4 || h === 7) {
        ctx.fillStyle = '#e6ede0';
        ctx.fillRect(x, y, 4, 4);
      } else if (h === 5) {
        ctx.fillStyle = '#c8c0ad';
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
 * Compact 256x128 HD-pixel weather sky dome generator (75% less VRAM than 512x256,
 * lazily instantiated per weather with smooth 2px stepped atmospheric bands).
 */
function createSkyTexture(weather: WeatherId): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const [c, ctx] = makePixelCanvas(W, H);

  const stopsByWeather: Record<WeatherId, Array<[number, string]>> = {
    clear: [
      [0, '#165296'],
      [17, '#216eb8'],
      [35, '#368fd4'],
      [52, '#5fb2e6'],
      [67, '#92d1f2'],
      [78, '#c8e9f8'],
      [85, '#fff3d6'],
      [89, '#638ca3'],
      [128, '#273f52'],
    ],
    sunset: [
      [0, '#141938'],
      [16, '#242554'],
      [33, '#432e69'],
      [48, '#7a396d'],
      [61, '#be4b60'],
      [71, '#ea7149'],
      [79, '#ffa44f'],
      [85, '#ffe399'],
      [89, '#464d6b'],
      [128, '#1c2438'],
    ],
    storm: [
      [0, '#0c111b'],
      [19, '#131c2b'],
      [39, '#1c293d'],
      [58, '#27374f'],
      [74, '#344761'],
      [85, '#465c78'],
      [89, '#28364a'],
      [128, '#111824'],
    ],
    fog: [
      [0, '#607384'],
      [22, '#738899'],
      [44, '#8ba0b0'],
      [63, '#a5b8c7'],
      [77, '#c1d1de'],
      [86, '#d8e4ed'],
      [89, '#95aab8'],
      [128, '#5c6e7c'],
    ],
    snow: [
      [0, '#1f3759'],
      [20, '#31527c'],
      [41, '#4d74a1'],
      [59, '#779ec4'],
      [74, '#adcbe3'],
      [84, '#d9e9f5'],
      [87, '#eaf4fc'],
      [89, '#8ea7bf'],
      [128, '#445a70'],
    ],
  };

  const stops = stopsByWeather[weather];
  const parseHex = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];

  const bandStep = 2;
  for (let y = 0; y < H; y += bandStep) {
    let seg = 0;
    while (seg < stops.length - 2 && y >= stops[seg + 1][0]) seg++;
    const [y0, c0Hex] = stops[seg];
    const [y1, c1Hex] = stops[seg + 1];
    const t = y1 > y0 ? Math.max(0, Math.min(1, (y - y0) / (y1 - y0))) : 0;
    const [r0, g0, b0] = parseHex(c0Hex);
    const [r1, g1, b1] = parseHex(c1Hex);
    const r = Math.round(r0 + (r1 - r0) * t);
    const g = Math.round(g0 + (g1 - g0) * t);
    const b = Math.round(b0 + (b1 - b0) * t);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, W, bandStep);
  }

  if (weather === 'sunset') {
    ctx.fillStyle = 'rgba(255, 248, 220, 0.85)';
    for (let i = 0; i < 48; i++) {
      const sx = (i * 53 + 13) % W;
      const sy = 3 + ((i * 23) % 31);
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  const sunX = 128;
  if (weather === 'clear') {
    const sunY = 58;
    const drawDisc = (rad: number, color: string) => {
      ctx.fillStyle = color;
      for (let dy = -rad; dy <= rad; dy++) {
        const halfW = Math.floor(Math.sqrt(Math.max(0, rad * rad - dy * dy)));
        if (halfW > 0) ctx.fillRect(sunX - halfW, sunY + dy, halfW * 2, 1);
      }
    };
    drawDisc(15, 'rgba(255, 248, 214, 0.16)');
    drawDisc(11, 'rgba(255, 246, 204, 0.34)');
    drawDisc(8, '#fff6cc');
    drawDisc(6, '#fffdf2');
  } else if (weather === 'sunset') {
    const sunY = 67;
    const r = 12;
    ctx.fillStyle = 'rgba(255, 190, 108, 0.22)';
    for (let dy = -16; dy <= 16; dy++) {
      const hw = Math.floor(Math.sqrt(Math.max(0, 16 * 16 - dy * dy)));
      if (hw > 0) ctx.fillRect(sunX - hw, sunY + dy, hw * 2, 1);
    }
    for (let dy = -r; dy <= r; dy++) {
      if (dy > 3 && dy % 3 === 0) continue;
      const hw = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
      if (hw <= 0) continue;
      ctx.fillStyle = dy < -2 ? '#fff8cc' : dy < 4 ? '#ffd06b' : '#ff7b4a';
      ctx.fillRect(sunX - hw, sunY + dy, hw * 2, 1);
    }
  } else if (weather === 'fog' || weather === 'snow') {
    const sunY = 60;
    const rOuter = 12;
    const rInner = 7;
    ctx.fillStyle = weather === 'fog' ? 'rgba(236, 244, 250, 0.22)' : 'rgba(238, 248, 255, 0.28)';
    for (let dy = -rOuter; dy <= rOuter; dy++) {
      const hw = Math.floor(Math.sqrt(Math.max(0, rOuter * rOuter - dy * dy)));
      if (hw > 0) ctx.fillRect(sunX - hw, sunY + dy, hw * 2, 1);
    }
    ctx.fillStyle = weather === 'fog' ? 'rgba(244, 249, 255, 0.45)' : 'rgba(246, 251, 255, 0.62)';
    for (let dy = -rInner; dy <= rInner; dy++) {
      const hw = Math.floor(Math.sqrt(Math.max(0, rInner * rInner - dy * dy)));
      if (hw > 0) ctx.fillRect(sunX - hw, sunY + dy, hw * 2, 1);
    }
  }

  const cloudSets: Record<
    WeatherId,
    { hi: string; mid: string; lo: string; rects: Array<[number, number, number, number]> }
  > = {
    clear: {
      hi: '#ffffff',
      mid: '#eef7fc',
      lo: '#badcf2',
      rects: [
        [17, 44, 29, 5],
        [65, 50, 24, 4],
        [163, 46, 32, 5],
        [213, 40, 26, 4],
      ],
    },
    sunset: {
      hi: '#ffebc4',
      mid: '#f7b288',
      lo: '#c76472',
      rects: [
        [23, 46, 30, 5],
        [73, 52, 23, 4],
        [166, 47, 31, 5],
        [216, 42, 26, 4],
      ],
    },
    storm: {
      hi: '#4f6480',
      mid: '#2c3d54',
      lo: '#172233',
      rects: [
        [4, 33, 51, 10],
        [57, 39, 57, 11],
        [116, 33, 60, 11],
        [178, 38, 55, 10],
        [230, 35, 26, 9],
      ],
    },
    fog: {
      hi: '#d7e4ed',
      mid: '#bdcedb',
      lo: '#9eb4c4',
      rects: [
        [10, 48, 55, 6],
        [90, 54, 62, 6],
        [173, 49, 60, 6],
      ],
    },
    snow: {
      hi: '#eef6fc',
      mid: '#c8dceb',
      lo: '#92b0ca',
      rects: [
        [14, 40, 39, 7],
        [70, 45, 43, 6],
        [149, 42, 45, 7],
        [206, 38, 37, 6],
      ],
    },
  };

  const cs = cloudSets[weather];
  for (const [cx, cy, cw, ch] of cs.rects) {
    ctx.fillStyle = cs.hi;
    ctx.fillRect(cx + 4, cy - 2, cw - 8, 2);
    ctx.fillStyle = cs.mid;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = cs.lo;
    ctx.fillRect(cx + 2, cy + ch - 2, cw - 4, 2);
  }

  const tex = toCrispTexture(c, 1, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Soft conical pixel-arcade headlight ground glow texture (narrow at bike nose,
 * fanning forward and fading cleanly to zero at edges — never a harsh rectangle).
 */
function createHeadlightBeamTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 128;
  const [c, ctx] = makePixelCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  for (let y = 0; y < H; y += 2) {
    // y = H-1 is near the bike nose (bottom of texture -> +Z), y = 0 is far ahead (-Z)
    const distNorm = 1 - y / (H - 1); // 0 at bike nose -> 1 at far tip
    const halfWidth = 4 + distNorm * 27;
    const longitudinalFade =
      distNorm < 0.08
        ? distNorm / 0.08
        : Math.pow(Math.max(0, 1 - (distNorm - 0.08) / 0.92), 1.65);

    for (let x = 0; x < W; x += 2) {
      const dx = Math.abs(x + 1 - W * 0.5);
      if (dx >= halfWidth) continue;
      const radialFade = Math.pow(1 - dx / halfWidth, 1.8);
      const alpha = longitudinalFade * radialFade;
      if (alpha <= 0.015) continue;
      // Quantize alpha subtly for clean arcade feel without hard seams
      const q = Math.min(1, Math.round(alpha * 16) / 16);
      ctx.fillStyle = `rgba(255, 245, 204, ${(q * 0.9).toFixed(3)})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
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
  ctx.fillStyle = '#c96c4a';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#a85134';
  ctx.fillRect(0, 4, 16, 3);
  ctx.fillRect(0, 11, 16, 3);
  ctx.fillStyle = '#e68e62';
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

  // Bold pixel arcade banner label + procedural pixel star (zero emoji/symbol chars)
  ctx.font = 'bold 14px "Press Start 2P", "Silkscreen", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.fillText('START', 48, 18);
  ctx.fillText('LAP', 148, 18);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('START', 46, 16);
  ctx.fillText('LAP', 146, 16);

  // Crisp procedural 10x10 pixel star emblem at center (x=96, y=16)
  const sx = 96;
  const sy = 16;
  ctx.fillStyle = '#000000';
  ctx.fillRect(sx - 1 + 1, sy - 5 + 1, 2, 10);
  ctx.fillRect(sx - 5 + 1, sy - 1 + 1, 10, 2);
  ctx.fillRect(sx - 3 + 1, sy - 3 + 1, 6, 6);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(sx - 1, sy - 5, 2, 10);
  ctx.fillRect(sx - 5, sy - 1, 10, 2);
  ctx.fillRect(sx - 3, sy - 3, 6, 6);
  ctx.fillStyle = '#fff9db';
  ctx.fillRect(sx - 1, sy - 1, 2, 2);

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
 * Draws a crisp procedural 10x12 pixel-art flame emblem directly onto a 2D canvas (zero emoji).
 */
function drawPixelFlameEmblem(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Outer crimson/red flame silhouette
  ctx.fillStyle = '#ff2a54';
  ctx.fillRect(x + 4, y + 0, 2, 2);
  ctx.fillRect(x + 3, y + 2, 4, 2);
  ctx.fillRect(x + 1, y + 4, 8, 3);
  ctx.fillRect(x + 0, y + 7, 10, 3);
  ctx.fillRect(x + 2, y + 10, 6, 2);

  // Mid orange glow
  ctx.fillStyle = '#ff7b00';
  ctx.fillRect(x + 4, y + 2, 2, 2);
  ctx.fillRect(x + 2, y + 4, 6, 5);
  ctx.fillRect(x + 3, y + 9, 4, 2);

  // Bright yellow-white core
  ctx.fillStyle = '#ffe600';
  ctx.fillRect(x + 3, y + 6, 4, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 4, y + 8, 2, 2);
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
  ownerId = '',
  enraged = false
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const label = enraged ? `${name.slice(0, 8)} ${t('rageTag')}` : name.slice(0, 14);
  ctx.font = 'bold 14px "Silkscreen", "Press Start 2P", monospace';
  const avatarSize = 24;
  const avatarBox = avatarSize + 4; // 2px pixel border on all sides -> 28px
  const gap = 3;
  const flamePad = enraged ? 14 : 0;
  const maxNameBoxW = w - avatarBox - gap - 6;
  const nameBoxW = Math.min(
    maxNameBoxW,
    Math.max(58, Math.ceil(ctx.measureText(label).width) + 14 + flamePad)
  );
  const totalW = avatarBox + gap + nameBoxW;
  const startX = Math.floor((w - totalW) / 2);
  const boxY = 4;
  const boxH = avatarBox; // 28px
  const borderCol = enraged ? '#ff2a54' : isBot && accentHex === '#8d99ae' ? '#6c757d' : accentHex;

  // Avatar frame on left (crisp 2px pixel border)
  ctx.fillStyle = '#090b12';
  ctx.fillRect(startX - 1, boxY - 1, avatarBox + 2, boxH + 2);
  ctx.fillStyle = borderCol;
  ctx.fillRect(startX, boxY, avatarBox, boxH);
  drawRiderAvatarToContext(ctx, ownerId, avatarIdx, startX + 2, boxY + 2, avatarSize);

  // Name box on right
  const nameX = startX + avatarBox + gap;
  ctx.fillStyle = enraged ? 'rgba(64, 8, 18, 0.94)' : 'rgba(12, 14, 24, 0.88)';
  ctx.fillRect(nameX, boxY, nameBoxW, boxH);
  ctx.fillStyle = borderCol;
  ctx.fillRect(nameX, boxY, nameBoxW, 2);
  ctx.fillRect(nameX, boxY + boxH - 2, nameBoxW, 2);
  ctx.fillRect(nameX, boxY, 2, boxH);
  ctx.fillRect(nameX + nameBoxW - 2, boxY, 2, boxH);

  // Procedural pixel flame emblem on left inside enraged nameplate
  if (enraged) {
    drawPixelFlameEmblem(ctx, nameX + 5, boxY + 8);
  }

  // Name text
  const textLeft = nameX + flamePad;
  const textAreaW = nameBoxW - flamePad;
  const textCenterX = textLeft + textAreaW / 2;
  const textCenterY = boxY + boxH / 2 + 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#090b12';
  ctx.fillText(label, textCenterX + 1, textCenterY + 1, textAreaW - 8);
  ctx.fillStyle = enraged ? '#ffd166' : isBot && accentHex === '#8d99ae' ? '#ced4da' : '#ffffff';
  ctx.fillText(label, textCenterX, textCenterY, textAreaW - 8);

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
