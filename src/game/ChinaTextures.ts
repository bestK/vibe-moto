import * as THREE from 'three';

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
  repeat = false
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const CJK_FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "SimHei", sans-serif';

function drawCrispText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  shadow?: string,
  align: CanvasTextAlign = 'center'
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(text, x + 1, y + 1);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export interface ChinaTextureAtlas {
  gasSign: THREE.CanvasTexture;
  gasStore: THREE.CanvasTexture;
  dinerSign: THREE.CanvasTexture;
  dinerFacade: THREE.CanvasTexture;
  meituanBox: THREE.CanvasTexture;
  elemeBox: THREE.CanvasTexture;
  truckTarp: THREE.CanvasTexture;
  truckRear: THREE.CanvasTexture;
  lantern: THREE.CanvasTexture;
}

let _cachedChinaAtlas: ChinaTextureAtlas | null = null;

/**
 * Lazy singleton factory for procedural HD-pixel Chinese National Highway textures.
 * Zero canvas allocations occur at module import time.
 */
export function getChinaAtlas(): ChinaTextureAtlas {
  if (_cachedChinaAtlas) return _cachedChinaAtlas;
  _cachedChinaAtlas = {
    gasSign: createGasSignTexture(),
    gasStore: createGasStoreTexture(),
    dinerSign: createDinerSignTexture(),
    dinerFacade: createDinerFacadeTexture(),
    meituanBox: createMeituanBoxTexture(),
    elemeBox: createElemeBoxTexture(),
    truckTarp: createTruckTarpTexture(),
    truckRear: createTruckRearTexture(),
    lantern: createLanternTexture(),
  };
  return _cachedChinaAtlas;
}

/**
 * 128x48 red-and-white Sinopec/PetroChina-inspired fascia (`中国加油  92# 95#`).
 */
function createGasSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(128, 48);

  // Iconic bold crimson fascia
  ctx.fillStyle = '#d62828';
  ctx.fillRect(0, 0, 128, 48);

  // Subtle top highlight & bottom dark bezel
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(0, 0, 128, 3);
  ctx.fillStyle = '#991b1b';
  ctx.fillRect(0, 45, 128, 3);

  // Crisp horizontal white corporate stripe across lower band
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 34, 128, 7);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(0, 32, 128, 2);

  // Left circular pixel emblem (classic red/yellow energy emblem)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(5, 6, 18, 20);
  ctx.fillStyle = '#d62828';
  ctx.fillRect(7, 8, 14, 16);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(10, 10, 8, 12);
  ctx.fillStyle = '#d62828';
  ctx.fillRect(12, 13, 4, 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(13, 9, 2, 4);

  // Bold white/yellow pixel lettering: 中国加油
  drawCrispText(
    ctx,
    '中国加油',
    56,
    18,
    `bold 15px ${CJK_FONT_STACK}`,
    '#ffffff',
    '#660708'
  );

  // Fuel grade badges on the right (`92# 95#`)
  ctx.fillStyle = '#1b1d2b';
  ctx.fillRect(88, 6, 35, 22);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(88, 6, 35, 2);
  ctx.fillRect(88, 26, 35, 2);
  drawCrispText(ctx, '92#', 105, 13, 'bold 9px monospace', '#52e065');
  drawCrispText(ctx, '95#', 105, 22, 'bold 9px monospace', '#ffd166');

  // Subtle blue accent strip inside white stripe
  ctx.fillStyle = '#0077b6';
  ctx.fillRect(6, 36, 22, 3);
  ctx.fillStyle = '#d62828';
  ctx.fillRect(32, 36, 90, 3);

  return toCrispTexture(c);
}

/**
 * 96x48 24H convenience store facade (`24H 便利店`).
 */
function createGasStoreTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(96, 48);

  // Clean light-gray concrete wall base
  ctx.fillStyle = '#dde5ee';
  ctx.fillRect(0, 0, 96, 48);

  // Top cyan-blue fascia signboard
  ctx.fillStyle = '#0077b6';
  ctx.fillRect(0, 0, 96, 15);
  ctx.fillStyle = '#00b4d8';
  ctx.fillRect(0, 13, 96, 2);
  ctx.fillStyle = '#ef233c';
  ctx.fillRect(0, 15, 96, 2);

  // `24H 便利店` signage
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(4, 3, 24, 9);
  drawCrispText(ctx, '24H', 16, 8, 'bold 8px monospace', '#111827');
  drawCrispText(
    ctx,
    '便利店',
    60,
    8,
    `bold 10px ${CJK_FONT_STACK}`,
    '#ffffff',
    '#023e8a'
  );

  // Wide bright glowing storefront glass window (left)
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(5, 20, 52, 23);
  ctx.fillStyle = '#caf0f8';
  ctx.fillRect(7, 22, 48, 19);

  // Glowing interior snack/drink shelves visible inside window
  ctx.fillStyle = '#90e0ef';
  ctx.fillRect(7, 22, 48, 5);
  ctx.fillStyle = '#475569';
  ctx.fillRect(7, 29, 48, 2);
  ctx.fillRect(7, 36, 48, 2);
  const shelfColors = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899'];
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = shelfColors[i % shelfColors.length];
    ctx.fillRect(9 + i * 4, 25, 3, 4);
    ctx.fillStyle = shelfColors[(i + 2) % shelfColors.length];
    ctx.fillRect(9 + i * 4, 32, 3, 4);
  }
  // Crisp white glass reflection diagonal
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(10, 23, 6, 2);
  ctx.fillRect(12, 25, 4, 2);

  // Glass sliding door (right)
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(63, 20, 27, 28);
  ctx.fillStyle = '#ade8f4';
  ctx.fillRect(65, 22, 11, 24);
  ctx.fillRect(77, 22, 11, 24);
  ctx.fillStyle = '#ef233c';
  ctx.fillRect(65, 33, 23, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(74, 30, 1, 8);
  ctx.fillRect(78, 30, 1, 8);

  // Bottom concrete plinth
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 44, 63, 4);
  ctx.fillRect(90, 44, 6, 4);

  return toCrispTexture(c);
}

/**
 * 128x48 vibrant Chinese national highway restaurant signboard (`国道饭店 · 司机之家`).
 */
function createDinerSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(128, 48);

  // Rich crimson signboard base
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(0, 0, 128, 48);

  // Subtle horizontal wood/metal panel lines
  ctx.fillStyle = '#a4101b';
  for (let y = 8; y < 44; y += 8) {
    ctx.fillRect(4, y, 120, 1);
  }

  // Ornate gold double pixel border + corner knots
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(1, 1, 126, 2);
  ctx.fillRect(1, 45, 126, 2);
  ctx.fillRect(1, 1, 2, 46);
  ctx.fillRect(125, 1, 2, 46);

  ctx.fillStyle = '#f4a261';
  ctx.fillRect(4, 4, 120, 1);
  ctx.fillRect(4, 43, 120, 1);
  ctx.fillRect(4, 4, 1, 40);
  ctx.fillRect(123, 4, 1, 40);

  // Corner gold square motifs
  const corners = [
    [4, 4],
    [119, 4],
    [4, 39],
    [119, 39],
  ];
  ctx.fillStyle = '#ffe66d';
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx, cy, 5, 5);
    ctx.fillStyle = '#780000';
    ctx.fillRect(cx + 1, cy + 1, 3, 3);
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(cx + 2, cy + 2, 1, 1);
  }

  // Main headline: 国道饭店
  drawCrispText(
    ctx,
    '国道饭店',
    64,
    18,
    `bold 17px ${CJK_FONT_STACK}`,
    '#ffe66d',
    '#4a0404'
  );

  // Sub-banner: · 司机之家 ·
  ctx.fillStyle = '#780000';
  ctx.fillRect(22, 30, 84, 11);
  drawCrispText(
    ctx,
    '· 司机之家 ·',
    64,
    36,
    `bold 9px ${CJK_FONT_STACK}`,
    '#ffffff',
    '#3b0202'
  );

  return toCrispTexture(c);
}

/**
 * 64x64 classic roadside restaurant white ceramic tiles with warm glowing windows & red door frame.
 */
function createDinerFacadeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(64, 64);

  // White/cream exterior ceramic tiles
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 64, 64);

  // Classic square ceramic tile grid grout
  ctx.fillStyle = '#cbd5e1';
  for (let y = 0; y < 64; y += 8) {
    ctx.fillRect(0, y, 64, 1);
  }
  for (let x = 0; x < 64; x += 8) {
    ctx.fillRect(x, 0, 1, 64);
  }
  // Subtle tile shading variation
  for (let ty = 0; ty < 8; ty++) {
    for (let tx = 0; tx < 8; tx++) {
      if ((tx * 7 + ty * 13) % 5 === 0) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(tx * 8 + 1, ty * 8 + 1, 7, 7);
      }
    }
  }

  // Lower dark green/gray splash wainscoting
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 52, 64, 12);
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(0, 50, 64, 2);

  // Left & Right warm glowing pixel windows
  const winXs = [5, 42];
  for (const wx of winXs) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(wx, 14, 17, 20);
    ctx.fillStyle = '#ffbe0b';
    ctx.fillRect(wx + 2, 16, 13, 16);
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(wx + 3, 17, 11, 8);
    // Window muntin crossbars
    ctx.fillStyle = '#78350f';
    ctx.fillRect(wx + 8, 16, 1, 16);
    ctx.fillRect(wx + 2, 24, 13, 1);
    // Warm windowsill
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(wx - 1, 34, 19, 2);
  }

  // Center red-framed restaurant doorway with warm interior glow
  ctx.fillStyle = '#c1121f';
  ctx.fillRect(25, 22, 14, 42);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(26, 23, 12, 2);
  ctx.fillStyle = '#ff9f1c';
  ctx.fillRect(27, 27, 10, 18);
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(28, 28, 8, 10);
  // Lower door panel
  ctx.fillStyle = '#9b111e';
  ctx.fillRect(27, 46, 10, 16);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(35, 44, 2, 3);

  return toCrispTexture(c, true);
}

/**
 * 32x32 bright Meituan yellow (#ffc300) delivery box with black border + kangaroo emblem & `美团`.
 */
function createMeituanBoxTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 32);

  // Vivid Meituan yellow shell
  ctx.fillStyle = '#ffc300';
  ctx.fillRect(0, 0, 32, 32);

  // Subtle insulated lid shading & highlight
  ctx.fillStyle = '#ffe047';
  ctx.fillRect(2, 2, 28, 4);
  ctx.fillStyle = '#e5a700';
  ctx.fillRect(2, 27, 28, 3);

  // Crisp black outer frame & lid seam
  ctx.fillStyle = '#11131a';
  ctx.fillRect(0, 0, 32, 2);
  ctx.fillRect(0, 30, 32, 2);
  ctx.fillRect(0, 0, 2, 32);
  ctx.fillRect(30, 0, 2, 32);
  ctx.fillRect(2, 7, 28, 1);

  // Iconic pixel kangaroo ears silhouette at top center
  ctx.fillStyle = '#11131a';
  // Left ear
  ctx.fillRect(10, 9, 2, 4);
  ctx.fillRect(11, 8, 2, 2);
  // Right ear
  ctx.fillRect(20, 9, 2, 4);
  ctx.fillRect(19, 8, 2, 2);
  // Cute pixel head arc
  ctx.fillRect(12, 11, 8, 4);
  ctx.fillStyle = '#ffc300';
  ctx.fillRect(13, 12, 2, 2);
  ctx.fillRect(17, 12, 2, 2);

  // Crisp black pixel `美团` text
  drawCrispText(
    ctx,
    '美团',
    16,
    22,
    `bold 11px ${CJK_FONT_STACK}`,
    '#11131a'
  );

  // Corner reflective tape ticks
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(3, 27, 4, 2);
  ctx.fillRect(25, 27, 4, 2);

  return toCrispTexture(c);
}

/**
 * 32x32 bright Ele.me blue (#0091ff) delivery box with white border + `e` emblem & `饿了么`.
 */
function createElemeBoxTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(32, 32);

  // Vivid Ele.me blue shell
  ctx.fillStyle = '#0091ff';
  ctx.fillRect(0, 0, 32, 32);

  // Glossy highlight & lower bevel
  ctx.fillStyle = '#48b5ff';
  ctx.fillRect(2, 2, 28, 4);
  ctx.fillStyle = '#006fd6';
  ctx.fillRect(2, 27, 28, 3);

  // Crisp white outer border & lid seam
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 32, 2);
  ctx.fillRect(0, 30, 32, 2);
  ctx.fillRect(0, 0, 2, 32);
  ctx.fillRect(30, 0, 2, 32);
  ctx.fillStyle = '#bae6fd';
  ctx.fillRect(2, 7, 28, 1);

  // Iconic pixel rounded white `e` emblem (center-upper)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(12, 9, 8, 2);  // top arc
  ctx.fillRect(10, 11, 2, 5); // left curve
  ctx.fillRect(20, 11, 2, 3); // upper right curve
  ctx.fillRect(12, 13, 9, 2); // crossbar
  ctx.fillRect(12, 16, 8, 2); // bottom smile arc

  // Crisp white `饿了么` text underneath
  drawCrispText(
    ctx,
    '饿了么',
    16,
    24,
    `bold 8px ${CJK_FONT_STACK}`,
    '#ffffff',
    '#004ea8'
  );

  return toCrispTexture(c);
}

/**
 * 64x64 classic Chinese freight truck woven blue-green striped tarpaulin tied with rope bands.
 */
function createTruckTarpTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(64, 64);

  // Classic Chinese woven freight tarp base (deep teal-blue)
  ctx.fillStyle = '#1b6b7a';
  ctx.fillRect(0, 0, 64, 64);

  // Iconic vertical/horizontal woven tarpaulin color stripes (blue / white / red-orange accents)
  for (let x = 0; x < 64; x += 8) {
    ctx.fillStyle = x % 16 === 0 ? '#238294' : '#165a68';
    ctx.fillRect(x, 0, 4, 64);
  }
  // Signature highway tarp stripe bands
  ctx.fillStyle = '#e2eef4';
  ctx.fillRect(0, 10, 64, 3);
  ctx.fillRect(0, 50, 64, 3);
  ctx.fillStyle = '#d62828';
  ctx.fillRect(0, 13, 64, 2);
  ctx.fillRect(0, 48, 64, 2);

  // Subtle woven pixel fabric dither & creases
  for (let y = 0; y < 64; y += 2) {
    for (let x = 0; x < 64; x += 2) {
      const h = ((x * 31 + y * 57) >>> 0) % 13;
      if (h === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y, 2, 1);
      } else if (h === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // Tightly tied hemp rope bands (vertical + diagonal cross lashing)
  ctx.fillStyle = '#c89f5c';
  for (const rx of [14, 32, 50]) {
    ctx.fillRect(rx, 0, 2, 64);
    ctx.fillStyle = '#7f5539';
    ctx.fillRect(rx + 2, 0, 1, 64);
    ctx.fillStyle = '#c89f5c';
  }
  // Horizontal lashing rope + metal grommets along lower hem
  ctx.fillStyle = '#d4a373';
  ctx.fillRect(0, 31, 64, 2);
  ctx.fillStyle = '#6c4327';
  ctx.fillRect(0, 33, 64, 1);

  for (let gx = 6; gx < 64; gx += 12) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(gx, 58, 3, 3);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(gx + 1, 59, 1, 1);
  }

  return toCrispTexture(c, true);
}

/**
 * 64x32 yellow-black diagonal hazard bumper stripes + red `保持车距` rear placard.
 */
function createTruckRearTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(64, 32);

  // Metal tailgate top half
  ctx.fillStyle = '#2b3240';
  ctx.fillRect(0, 0, 64, 20);

  // Red-white reflective highway border strip
  for (let x = 0; x < 64; x += 8) {
    ctx.fillStyle = (x / 8) % 2 === 0 ? '#ef233c' : '#ffffff';
    ctx.fillRect(x, 0, 8, 2);
  }

  // Bold crimson `保持车距` safety placard
  ctx.fillStyle = '#d62828';
  ctx.fillRect(4, 4, 56, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(4, 4, 56, 1);
  ctx.fillRect(4, 17, 56, 1);
  ctx.fillRect(4, 4, 1, 14);
  ctx.fillRect(59, 4, 1, 14);

  drawCrispText(
    ctx,
    '保持车距',
    32,
    11,
    `bold 10px ${CJK_FONT_STACK}`,
    '#ffffff',
    '#660708'
  );

  // Lower yellow-black diagonal hazard bumper stripes (y = 20..32)
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(0, 20, 64, 12);
  ctx.fillStyle = '#11131a';
  for (let y = 20; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      if ((((x + (y - 20)) >> 2) & 1) === 0) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Bumper separator shadow
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 19, 64, 1);

  return toCrispTexture(c);
}

/**
 * 16x16 glowing traditional red/gold Chinese pixel lantern texture.
 */
function createLanternTexture(): THREE.CanvasTexture {
  const [c, ctx] = makePixelCanvas(16, 16);

  // Deep red glowing body
  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(0, 0, 16, 16);

  // Bright warm glowing inner lantern core
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(1, 3, 14, 10);
  ctx.fillStyle = '#ff6b35';
  ctx.fillRect(3, 4, 10, 8);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(5, 5, 6, 6);
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(7, 6, 2, 4);

  // Traditional curved vertical ribs
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(4, 3, 1, 10);
  ctx.fillRect(11, 3, 1, 10);

  // Gold top & bottom caps + bottom tassel accent
  ctx.fillStyle = '#ffb703';
  ctx.fillRect(2, 0, 12, 3);
  ctx.fillRect(2, 13, 12, 3);
  ctx.fillStyle = '#78350f';
  ctx.fillRect(2, 2, 12, 1);
  ctx.fillRect(2, 13, 12, 1);

  return toCrispTexture(c);
}
