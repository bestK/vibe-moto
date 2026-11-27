/**
 * Pure procedural pixel-art avatars (32x32 pixel matrices rendered to crisp
 * nearest-neighbor offscreen HTMLCanvasElements — zero external assets).
 */

export const AVATAR_COUNT = 9;
const GRID_SIZE = 32;

export interface PixelAvatarMeta {
  id: number;
  key: string;
  name: string;
  bg: string;
  accent: string;
}

interface PixelSpriteDef {
  meta: PixelAvatarMeta;
  palette: Readonly<Record<string, string>>;
  rows: readonly string[];
}

const AVATAR_SPRITES: readonly PixelSpriteDef[] = [
  {
    meta: { id: 0, key: 'penguin', name: 'PENGUIN', bg: '#00a8ff', accent: '#e31b3a' },
    palette: { '.': '#00a8ff', 'a': '#ffffff', 'b': '#0b0d12', 'c': '#f68908', 'd': '#04a8eb', 'e': '#808d91', 'f': '#a30d20', 'g': '#0c5c82', 'h': '#adccd7', 'i': '#3e5339', 'j': '#a58042', 'k': '#218cb1', 'l': '#600410', 'm': '#012c5d', 'n': '#8b411a', 'o': '#53616b' },
    rows: [
      'bddd.ddd.dd...ddddddd.....dddddd',
      'id........d.dkgggggkd.d........d',
      'bd.......dkbbbbbbbbbbbd........d',
      'bd.......kbbbbbbbbbbbbbdd......d',
      'bd.....dbbbbbbbbbbbbbbbbg......d',
      'b......dbbhaaaebbbbbbbbbbd...d.d',
      'id....dbbaaaaaaabbbbbaabbbd..d.d',
      'bd....kbaaaaaaaaaaaaaaaahbk..d.d',
      'bd...dbbhhhhhhhaaahhhhhhbbbd.d.d',
      'b....dbbbbbbbbbbbbbbbbbbbbbd...d',
      'b...dbbbbbbbbbbehbbebbbbbbbm...d',
      'bd..dbbbbbbbbbbhahbbbbbbbbbbd..d',
      'bd..dbbaabbbbbbbjbbbbbbbahbbd..d',
      'i..dkbhaaabbboejcjhobbbaaahbk..d',
      'id..kbaaaaaahbncccbbaaaaaaabk..d',
      'bd..bbabnjccjcccccccjcccjbabk..d',
      'bd..kbaabbbbbbbcccbbbbbnbaabd..d',
      'bd.dbbaaaabbbnnnbbnnbbbbaaabkd.d',
      'bdddbbaaaaahhbbnnnbbheaaaaabbddd',
      'bd.kbbhaaaaaahhbbbhhaaaaaahbbddd',
      'bd.dbbbaaaaaaaahhhhaaaaaaabbbd.d',
      'bddkbbbaaaaaaaaaaaaaaaaaaabbbd.d',
      'bddbbbbbaaaaaaaaaaaaaaaaaebbbbdd',
      'bddbbbhbeaaabaaaaaaaabaahbibbbdd',
      'bdbbbbbahoabfbbaaaablfbebaobbbbd',
      'bkbbbbbaaabbfflbbbbfffbaaabbbbbk',
      'bbbbbbbbaaabfflbffblffbaabbbbbbb',
      'bbbbbbbbaaabfflbllbfffbaabbbbbbb',
      'bbbbbbbbbaablbehbbhbbbhabbbbbbbb',
      'bbbbbbbbbaaahhhaahaahhaebbbbbbbb',
      'bbbbbbbbbbaaaaaaahaaaaabbbbbbbbb',
      'bbbbbbbbbbbaaaaaahaaaabbbbbbbbbb',
    ],
  },
  {
    meta: { id: 1, key: 'laugh', name: 'LAUGH', bg: '#ffe014', accent: '#ff9f1c' },
    palette: { '.': '#ffe014', 'a': '#0b0d12', 'b': '#ffffff', 'c': '#fcd000', 'd': '#8a7560', 'e': '#ecc177', 'f': '#5d4213', 'g': '#aa970f', 'h': '#e2a139', 'i': '#f8e8a8', 'j': '#5b574d', 'k': '#f3da45', 'l': '#ae9d59', 'm': '#7e6a20', 'n': '#be7b33', 'o': '#d1c6a0' },
    rows: [
      'cccccc.kaaaaakkc.ccccccccccccc..',
      'ccccc.mkiikkkeak..ccccccccccccc.',
      'cccckakiiikkkkkig.c.ccccccccccc.',
      'ccccakkkkkkkkkkkkakc.ccc...cccc.',
      'cccchkkkkkkaakkkkkkaa...........',
      '.ccakkkkkkakkkkkkkkkklg..cccccc.',
      '.ccaaakkkkkkkahkkkkkiiia..c.ccc.',
      'ccc.akkkkkkaaahkkkkkkkiia..ccc..',
      'ccccchkaaabaaahkkkkkkkkiil..cc..',
      '.cc..amaaaaaaakkkkkkkkkkiia.c...',
      'cc...amdaaaaaakhkkkkkkkkkiemc.c.',
      '.c..cakfaaaaakhnkkkkkkkkkkiac...',
      '.cc.akkkflhhkfnkkkkkkkkkkkkka...',
      '.cccekkkkmaaannkkkkkkkkkkkkkkk..',
      '.ccakkhhkkkhhhkkkkkkkkkkkkkkka..',
      'cc.akkkakkkkkkkkkkkkkakkkkkkkek.',
      'c.akkkhakeiiiiiiiekkkahkkkkkkkac',
      '.cakhaaaiiiiiiiiiiikknaalkkkkkaa',
      '..akkeaaiiiiiiiiiiiieaeekkkkkkka',
      '.cakkkkjiiiiiiiiiiiiakikkkknkkka',
      '.ccakikhoiiiiiiiiiiaiikkkkhakkka',
      'cc.khkkhaiiiiiaaiiakkkkkhnakkkka',
      'cc..ghkkmjaaiiaadkkkkkknmakkkkka',
      '.c.cchlnddjaoaaddlkkhnaalkkkkkha',
      '.ccccckadddjaaadddlnaaleekkkkkhk',
      '.cccccckajaaajaadaalleeekkkkkklk',
      '.cccc...maaaaaaaaleeeeeekhkkkna.',
      'ccccc....anneeeeeeeeeeehhkkkka..',
      '.cccc..ccahnneeeeeeeehhnkkkkhac.',
      '.cccc..cahknnalhhhhhhnnhkkkkaccc',
      '.cccccc.akckhnnaaaaaaanhkkkka...',
      '..ccccc.akcchnnnma...kankkkhk...',
    ],
  },
  {
    meta: { id: 2, key: 'shock_cat', name: 'SHOCK CAT', bg: '#1a439c', accent: '#ff881a' },
    palette: { '.': '#1a439c', 'a': '#ffffff', 'b': '#0b0d12', 'c': '#f29405', 'd': '#7f9a8b', 'e': '#8a3b1a', 'f': '#fad580', 'g': '#a5ddd4', 'h': '#546056', 'i': '#a5883d', 'j': '#f39a51', 'k': '#d25417', 'l': '#4c1c10', 'm': '#1d3459', 'n': '#8ab2be' },
    rows: [
      '...............................m',
      '..bbbb....................mbbb.m',
      '..bkccb..................bckjb..',
      '..bjjkce................bckjjb.m',
      '..mijjkkem..bbbbbbbbm..bckjjjb..',
      '...bjjjjkibbkkkkkkkkebbkkjjjim..',
      '...bjjjkkccckckckckckcckkjjjkm..',
      '...bjjkcccckkckckckckkccckjjim..',
      '...bjkcccjjccccccckcccjjcckjb...',
      '...bkccjiiiifccccccccjiiijjkb...',
      '...bccfbdggbbfcccccjfbgggbijb...',
      '..bkccbgbbaggifccccfbgbbabgjim..',
      '..ecccbgbbbbabfccccfbabbbbgbcl.m',
      '.bkckcbgbbbbabfccccjbabbbbgbkl..',
      '.bkkccjbgbbnhfccjffjbgbbbgbfclm.',
      'mekccccjbbbbjjjlkkkeffbbbjjcccbm',
      'bkcckkccjjjjfffflkelfffjjjckccbm',
      'bkcffjccccjjfffffbhfffjfjcccffam',
      'bijkkccccjffffffibeffffffcccckbm',
      'bekccccfjccfffjbbbbbjfffccffccbm',
      'mbkjffcccjfjjibbbbbbbijcfccccjhm',
      '.djkkkccfckjjbbbbbbbbbjccjcccemm',
      '..bkkccjckcjebbbbbbbbbkcckkfkb.m',
      '..bkckkkkkkjebbbbbbbbbkcckkkfb.m',
      '..mbjjkkkkkjebbbbbbbbbkckkkkbh.m',
      '...bbkkkkkkjkbbbbbbbbbkckkkbb...',
      '..meelekkkkcjblkkkkbbbcckkbeb..m',
      '..bkckelekkkcjleeeeeickkebeckb.m',
      '.mbkccckebeeejjjjjjjckbbeccccbmm',
      '.bkkkcccckeebeccekkcklekcccckemm',
      'mbkkkkkccccckebbbbbblkcccckkkkbm',
      'meccckkkcccccceeeeeekcccckkcccbm',
    ],
  },
  {
    meta: { id: 3, key: 'noodle', name: 'NOODLE', bg: '#0f4d2e', accent: '#f7c931' },
    palette: { '.': '#0f4d2e', 'a': '#ffffff', 'b': '#0b0d12', 'c': '#e4773a', 'd': '#99b1b1', 'e': '#812e1c', 'f': '#2f625d', 'g': '#fcdf95', 'h': '#917652', 'i': '#d0a17e', 'j': '#70967f', 'k': '#bfd6d1', 'l': '#b55629', 'm': '#420500', 'n': '#fabfc3' },
    rows: [
      '...........bbbbbbbbbbb..........',
      '..........bbbbbbbbbbbbbb........',
      '.........bbbbbbbbbbbbbbbb.......',
      '........bbbbbbbbbbbbbbbbbb......',
      '........bbbciibbeiiiilbbbb......',
      '........bbciiiiiiiiiiilbbbb.....',
      '........bliiiiiiiiiiiiibbbb.....',
      '........bilbbiiiiibbeiibbbb.....',
      '........blbbbbiiicbbbeibbbb.....',
      '.......bbiiiiiiiiciiiiiibbb.....',
      '......bibibbiiciiibbbiiibbib....',
      '......bciiiiicciiiciiciieclb....',
      '.......bgggiicggiciigggicclb....',
      '......bciiiicliicciiiiiiccbb....',
      '......bciiiciccciiiciiiiccb.j...',
      '......bciicllleelllmciiiccbd....',
      'bbb...bciiiilaaaaahiiiigccb.j...',
      'bbhb..bbiiiiieeeeeiiiigicb...a..',
      'bbbebb.bciiiiciiiiiiiigilbbaa...',
      'bebbihhbbciiiiccciiiiiiibbabb...',
      '.bbcileebbccliiiiilciccd..b..b..',
      '.bciciihbbblceiiillcllbf.fffffbb',
      'bbiiccemblbbbbbbbebbbbbbbabfffff',
      'bciiiiilbbibeeeebbaaaaaaaadbbfff',
      'bciiieeebbbeeb.biihccccccehkjbff',
      'icciiiihb..bb.bnbbillliclibbbb.f',
      'iiciicbb.......endjbbbbbbbjabbbb',
      'iiclbbb..fffff.haieeeeeeelhbibii',
      'iiiccbb.fffffff.kaaaaaabnakbgbii',
      'iicccb.fffffffffbdajjjbibbbbieii',
      'icccbbfffffffffffbbibilecgiclbii',
      'ccccb.fffffffffffbhbhccblccclbci',
    ],
  },
  {
    meta: { id: 4, key: 'log', name: 'LOG', bg: '#0f4d2e', accent: '#d4843e' },
    palette: { '.': '#0f4d2e', 'a': '#ffffff', 'b': '#0b0d12', 'c': '#eb9f14', 'd': '#598bb0', 'e': '#893d0d', 'f': '#a9ccd6', 'g': '#e7ad6f', 'h': '#595c61', 'i': '#ab6f44', 'j': '#4b1908', 'k': '#eada33', 'l': '#cb5817', 'm': '#5a4531', 'n': '#df8c44' },
    rows: [
      '............bllbileb.bb.........',
      '............blljileb.bebb.......',
      '.........bibbblellebbeebib......',
      '.........blebblelllbbieemb......',
      '.........blleelelllljneemb......',
      '.........beleelelllleieeeb......',
      '.........belielelllleieemb...bbb',
      '..........bllellelllenemb..bbiii',
      '.........bbiiiilelliileeb.beinll',
      '.........bbibbbiellbbbbmbbinnlle',
      '..........bdaaahelbbllbbbinleele',
      '..........bfafafbibckklbbnlleiee',
      '..........bfbbafbibkbkcbblleeemb',
      '..........bdddadbibccknbblleebb.',
      '..........bbdfhbelejeejmbeemb...',
      '..........bebjjelllebbeebjbb....',
      '..........bellllllllneiebb......',
      '..........bellllllllibbeb.......',
      '..........beibeieijibbbeb.......',
      '.........bbeibbmbbbbbbeeb.......',
      '.......bbnbelebbbbbbbjeeb.......',
      '....b..mnnbelebbebibbieeb.......',
      '..bbebbniebeleieiblelleeb.......',
      '.bmibbbeebbelelllllelleeb.......',
      'bieebiibb.beleielllelleeb.......',
      'bbiebbmb..belelelllelieemb......',
      'mgbmbmbb..bjlelelllelleeeb......',
      'iibbmmb..beelelllllellejeib.....',
      'ebbbeb...beblelllllellejbeib....',
      'bb.beib.biebeelllleelleebbib....',
      '...beibbbebbeelleleelleebbeib...',
      '...bbebbijbbeellelleiieebbmib...',
    ],
  },
  {
    meta: { id: 5, key: 'confused', name: 'WHAT?', bg: '#242022', accent: '#ffffff' },
    palette: { '.': '#e3d7e0', 'a': '#c4bcbe', 'b': '#e1a895', 'c': '#a59aa2', 'd': '#c28b6a', 'e': '#887d83', 'f': '#987766', 'g': '#9d6849', 'h': '#706761', 'i': '#7c492d', 'j': '#524948', 'k': '#503426', 'l': '#691e0e', 'm': '#2d2325', 'n': '#3d1200', 'o': '#ffffff' },
    rows: [
      '.....ckmmmmmmmmmmmmmmmmmmkhmmjaa',
      '....emmmmmmmmmmmmmmmmmmmmmjmmjaa',
      '...emmmmkkkkkkkkkkkmmmmmmmmmmjaa',
      '..emmmmmkkkjkkkkkkkkkkmmmmmmmjaa',
      '..mmmmmkkjjjjjjjjjjjkkkmmmmmmjaa',
      '.emmmmkkjjjhhhhhhiiijjkkmmmmmkaa',
      'ammmmkkjjhgfddffffgghijkkmmnnkaa',
      'cmmmkkjjigfdddddoogggiikkmnnnkcf',
      'hmmmkjjiigfddddoddoggiikkmmnnnkk',
      'mmmmkkjiiggfddddfobggiiikkmnnnkk',
      'mmmmkkjiiggfddddoffggiiikkmnnnkk',
      'mmmkkkiiiggfddddfffgggiikknnnnkl',
      'mmmkkjiiigggddddofddfgiikknnnnll',
      'mmmkjiiiiiiigggffdddfgikklnnnnnl',
      'mmkkiiiiiiiiiigfddddgikkkknnnnnl',
      'mmkjiggggggggggffffggiiiikkknnnl',
      'mmkjigggggggigggfggiiiiiikkknnnl',
      'knmkigfggilnkggffggiilnlkkkknnnl',
      'fkkkifddddgkgddbbdgggkniiiiknnnl',
      'ijkkgfddddddddbbbdffddffggiknnnl',
      'kkkkigfddddddbbdddffddddggiknnnl',
      'ghkkigfdddbbbbddddggddddgiknnnll',
      'fdgkkigfddddddfifgkiddddgiknnnll',
      'hfgkkiggfdddddgiikligddfgiknnnll',
      'khhkkiigfdddddgffggggddgiilnnnll',
      'mjjkkiiggfdddfgggggiigggiklnnlll',
      'nnnmkjiigffdfggiiiiiiiiiilnnnnll',
      'nnnnmjiigggfggigggiiiiiiknnnnnnl',
      'acnnmjjjigggggiiiklkkkkklnnnnnnn',
      'aamnnkkkiiiiiiikikkkkklnnnnnnnnn',
      'cacmnmmkkkkkkkigfgiikknnnnnnnnnn',
      'ccacnnmmmkkkkkiiiiikknnnnnnnnnnn',
    ],
  },
  {
    meta: { id: 6, key: 'phone', name: 'PHONE', bg: '#eef0f2', accent: '#b185ff' },
    palette: { '.': '#dcdbdc', 'a': '#ffffff', 'b': '#e4e9b6', 'c': '#b9b8b6', 'd': '#d4cb89', 'e': '#f8ed77', 'f': '#a58cd0', 'g': '#b19c85', 'h': '#d0bc46', 'i': '#f9de31', 'j': '#826aa7', 'k': '#a07c5a', 'l': '#dea115', 'm': '#6e4d2e', 'n': '#563216', 'o': '#0b0d12' },
    rows: [
      '.............................kkk',
      '...............ooo...........mkk',
      '.............obbbeeo.........mkk',
      '............oeeeeeeeo.......gnkk',
      '............ooeeeboio.......kmkk',
      '............ooieibobo.......kkkk',
      '............hhiiihdli.......kkkk',
      '............hlooohlli.......nkkk',
      '............illlllllio......mkkk',
      '............illlllllio......nkkk',
      '............illlllliio.....kkkkk',
      '....aaa.....iilllliiii.....kkkkk',
      '...........oeioooooiieo....kkkkk',
      '..........eeeooofffieeb....kkkkk',
      '.........oeeeojofffeebbo...nkkkk',
      '........oeeeeofffffeebbb...mkkkk',
      '.......oeeebbofffffeebbbo.knkkkk',
      '.......ooebbbooooffeiebbbokkkkkk',
      '......oiobbbbojoeooohiebbokkkkkk',
      '......elbbbbboojohoohiebbbokkkkk',
      '.....oiobbbbboieooiiooebbbokkkkk',
      '.cc..oeobbbbboeooiilioiebbekkkkk',
      'cccccoebbbbbbbohiilllieebbeokkkk',
      'ccccceobbbbbbbbollllllieeeiokkkk',
      'cc.cceoebbbbbbbeollllllliiiokkkk',
      'cc.ccioebbbbbbbeeeollllllllokkkk',
      'cc.cchoeebbbbbeeeeellllllllkkkkk',
      'ccccchoieeeeeeeeeeillollllokkkkk',
      'cccccooleeeeeeeeeillllloomkkkkkk',
      'cccccoohleeeeeeelllllllokmkkkkkk',
      'ccccccoolllllllllilllllomkkkkkkk',
      'cccccccolllllllllllllllcmkkkkkkk',
    ],
  },
  {
    meta: { id: 7, key: 'alien_cat', name: 'ALIEN CAT', bg: '#b6bec8', accent: '#ffea00' },
    palette: { '.': '#b6bec8', 'a': '#0b0d12', 'b': '#fefb87', 'c': '#af7a08', 'd': '#9ca8b4', 'e': '#fceb00', 'f': '#eb9d5a', 'g': '#e5a803', 'h': '#f2e247', 'i': '#8b5509', 'j': '#c58334', 'k': '#e5cd20', 'l': '#fdc769', 'm': '#eda532', 'n': '#a86f29', 'o': '#fbf265' },
    rows: [
      'dddddddddddddddddddddddddddddddd',
      'dddddddddddaadddddddaadddddddddd',
      'dddddddddddhoadddddahodddddddddd',
      'dddddddddddkeadddddaekdddddddddd',
      'dddddddddddakdddddddkadddddddddd',
      'ddddddddddddaadddddaadddaddddddd',
      'dddddddaaaddahdddddaadakkadddddd',
      'dddddddkmeadaedddddeaaeffadddddd',
      'dddddddkmmeadeaaaaaeaemffadddddd',
      'dddddddkflmeaeekkkaekmfffadddddd',
      'dddddddkfflgeeeeekeeegffkddddddd',
      'dddddddaffkeeeeeeeekeeemaddddddd',
      'dddddddaekeeeeeeeeeeeeekaddddddd',
      'dddddddakeeeeeekeeeeeeeeaddddddd',
      'dddddddaeeeehaaheeeehaheeadddddd',
      'dddddddaeeeeaaaaeeehaaaheadddddd',
      'dddddddkeeeeaaaaeeehaamheadddddd',
      'dddddddkekeeoaaaeeeeaaaeeadddddd',
      'dddddddkkeeeeheeehoheeeeeadddddd',
      'dddddddkkekhoohbbjfjbhoheadddddd',
      'dddddddkkkkoobbbbbnbbbbbeadddddd',
      'dddddddakhkeehhbboihbooehadddddd',
      'dddddddageehhkhegckggeehkddddddd',
      'ddddddddagkkeheeehhheeekaddddddd',
      'dddddddagggeeeeeekkeeegkkddddddd',
      'dddddddaggkgggggeeeeggkeeadddddd',
      'dddddddagkkkkgggggggkkeeeadddddd',
      'ddddddaggeekkkkkkkkkkeeeeadddddd',
      'ddddddagggeekkkkkkeeeeeekkdddddd',
      'ddddddagkggkkkkkeeeeeeekeedddddd',
      'ddddddagekggkkkeeeeeeeeeeeaddddd',
      'ddddddgkkekkkkkeeeeeeeeeeeaddddd',
    ],
  },
  {
    meta: { id: 8, key: 'cowboy_cat', name: 'COWBOY', bg: '#ebebeb', accent: '#9e5a2b' },
    palette: { '.': '#ebebeb', 'a': '#0b0d12', 'b': '#ffffff', 'c': '#a27f79', 'd': '#74411f', 'e': '#c4c4c3', 'f': '#bd6b2f', 'g': '#442310', 'h': '#a4a3a6', 'i': '#c68e88', 'j': '#995b2e', 'k': '#909090', 'l': '#5c301b', 'm': '#b4b4b4', 'n': '#9b6b42' },
    rows: [
      '................................',
      '................................',
      '...........aaaaa................',
      '..........addfffaa..............',
      '......a...ddddffffa.............',
      '......ka.addddfffffa.....ahk....',
      '......cmadddddffffffa...aiic....',
      '......ccadddddfffffffaamiiic....',
      '......aaaaaaaaaaaaaffahciiia....',
      '...aaajjlllllllldjfaaakiiica....',
      '..ajlllllllllllllllllnaaiia.....',
      '.jlllllllaaaaaaaalllllljnaa.....',
      'adllllaakhheeeeehhaalllddja.....',
      'allggahaaakebbbeeaakaallddda....',
      'algggaaaaaa.bbbbaaaaakalldddn...',
      '.dgggmeaaaabbbbbaaaaaekallldda..',
      '.algaebbbb.bbbbbbaaabbekallldda.',
      '..alaebbbbbbbbbbbbbbbb.ekalllda.',
      '...aaebbbbbeeebbbbbbbbeeealllla.',
      '....aee.bb.aiaebbbbb.eeeeeallla.',
      '....ae..bbbeaabbbbb.eeeeeeaalla.',
      '....aeee.beeaeebb.eeeeeeeea.aaa.',
      '....ae.eeeeaaaeeeeeeeeeeeea.....',
      '.....eeeemaamhaaheeeeeeeb.a.....',
      '.....aeeeeeeeeeeeeeeeebbbba.....',
      '.....aeeekkkeeehkhe.bbbbbbba....',
      '.....aeeeeeekkkke.bbbbbbbbba....',
      '.....eeeeeeeeee.bbbbbbbbbbbba...',
      '....aeee..eeeebbbbbbbbbbbbbba...',
      '....aeebbbb.ebbbbbbbbbbbbbbbb...',
      '....eebbbbbbbbbbbbbbbbbbbbbbba..',
      '...aebbbbbbbbbbbbbbbbbbbbbbbba..',
    ],
  },
];

export const PIXEL_AVATARS: readonly PixelAvatarMeta[] = AVATAR_SPRITES.map((s) => s.meta);

const canvasCache = new Map<string, HTMLCanvasElement>();
const dataUrlCache = new Map<string, string>();

function normalizeAvatarIdx(avatarIdx: number): number {
  const n = Number.isFinite(avatarIdx) ? Math.floor(avatarIdx) : 0;
  return ((n % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
}

function normalizeScale(scale: number): number {
  return Number.isFinite(scale) ? Math.max(1, Math.round(scale)) : 2;
}

/**
 * Returns a cached crisp offscreen canvas containing the pixel-art avatar.
 * Default scale = 2 (64x64 crisp nearest-neighbor pixels).
 */
export function getAvatarCanvas(avatarIdx: number, scale = 2): HTMLCanvasElement {
  const idx = normalizeAvatarIdx(avatarIdx);
  const s = normalizeScale(scale);
  const cacheKey = `${idx}_${s}`;
  const cached = canvasCache.get(cacheKey);
  if (cached) return cached;

  const def = AVATAR_SPRITES[idx];
  const size = GRID_SIZE * s;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const bgColor = def.palette['.'] ?? def.meta.bg;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < GRID_SIZE; y++) {
    const row = def.rows[y];
    let x = 0;
    while (x < GRID_SIZE) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      let runEnd = x + 1;
      while (runEnd < GRID_SIZE && row[runEnd] === ch) runEnd++;
      const color = def.palette[ch];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * s, y * s, (runEnd - x) * s, s);
      }
      x = runEnd;
    }
  }

  canvasCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Returns a cached crisp PNG data URL for use in HTML <img> portraits.
 */
export function getAvatarDataUrl(avatarIdx: number, scale = 2): string {
  const idx = normalizeAvatarIdx(avatarIdx);
  const s = normalizeScale(scale);
  const cacheKey = `${idx}_${s}`;
  const cached = dataUrlCache.get(cacheKey);
  if (cached) return cached;

  const url = getAvatarCanvas(idx, s).toDataURL('image/png');
  dataUrlCache.set(cacheKey, url);
  return url;
}

/**
 * Draws a crisp nearest-neighbor pixel avatar directly into any 2D canvas context.
 */
export function drawAvatarToContext(
  ctx: CanvasRenderingContext2D,
  avatarIdx: number,
  x: number,
  y: number,
  size: number
): void {
  const src = getAvatarCanvas(avatarIdx, 1);
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, Math.round(x), Math.round(y), Math.round(size), Math.round(size));
  ctx.imageSmoothingEnabled = prevSmoothing;
}
