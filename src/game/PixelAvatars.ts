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

const baseCanvasCache = new Map<number, HTMLCanvasElement>();
const scaledCanvasCache = new Map<string, HTMLCanvasElement>();
const dataUrlCache = new Map<string, string>();

function normalizeAvatarIdx(avatarIdx: number): number {
  const n = Number.isFinite(avatarIdx) ? Math.floor(avatarIdx) : 0;
  return ((n % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
}

function normalizeScale(scale: number): number {
  return Number.isFinite(scale) ? Math.max(1, Math.round(scale)) : 2;
}

/**
 * Lazily renders and caches the tiny 32x32 (scale=1, ~4 KB RGBA) base canvas
 * for an avatar. Zero canvas work happens at module import time.
 */
function getBaseAvatarCanvas(idx: number): HTMLCanvasElement {
  const cached = baseCanvasCache.get(idx);
  if (cached) return cached;

  const def = AVATAR_SPRITES[idx];
  const canvas = document.createElement('canvas');
  canvas.width = GRID_SIZE;
  canvas.height = GRID_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const bgColor = def.palette['.'] ?? def.meta.bg;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);

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
        ctx.fillRect(x, y, runEnd - x, 1);
      }
      x = runEnd;
    }
  }

  baseCanvasCache.set(idx, canvas);
  return canvas;
}

function blitScaledCanvas(base: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const size = GRID_SIZE * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, size, size);
  return canvas;
}

/**
 * Returns a cached crisp offscreen canvas containing the pixel-art avatar.
 * Default scale = 2 (64x64 crisp nearest-neighbor pixels).
 */
export function getAvatarCanvas(avatarIdx: number, scale = 2): HTMLCanvasElement {
  const idx = normalizeAvatarIdx(avatarIdx);
  const s = normalizeScale(scale);
  if (s === 1) return getBaseAvatarCanvas(idx);

  const cacheKey = `${idx}_${s}`;
  const cached = scaledCanvasCache.get(cacheKey);
  if (cached) return cached;

  const canvas = blitScaledCanvas(getBaseAvatarCanvas(idx), s);
  scaledCanvasCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Returns a cached crisp PNG data URL for use in HTML <img> portraits.
 * Renders lazily on demand without retaining redundant scaled canvas surfaces.
 */
export function getAvatarDataUrl(avatarIdx: number, scale = 2): string {
  const idx = normalizeAvatarIdx(avatarIdx);
  const s = normalizeScale(scale);
  const cacheKey = `${idx}_${s}`;
  const cached = dataUrlCache.get(cacheKey);
  if (cached) return cached;

  const base = getBaseAvatarCanvas(idx);
  let url: string;
  if (s === 1) {
    url = base.toDataURL('image/png');
  } else {
    const existingScaled = scaledCanvasCache.get(cacheKey);
    if (existingScaled) {
      url = existingScaled.toDataURL('image/png');
    } else {
      const tmp = blitScaledCanvas(base, s);
      url = tmp.toDataURL('image/png');
      tmp.width = 0;
      tmp.height = 0;
    }
  }

  dataUrlCache.set(cacheKey, url);
  return url;
}

/**
 * Draws a crisp nearest-neighbor pixel avatar directly into any 2D canvas context
 * using the tiny cached 32x32 base canvas.
 */
export function drawAvatarToContext(
  ctx: CanvasRenderingContext2D,
  avatarIdx: number,
  x: number,
  y: number,
  size: number
): void {
  const src = getBaseAvatarCanvas(normalizeAvatarIdx(avatarIdx));
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, Math.round(x), Math.round(y), Math.round(size), Math.round(size));
  ctx.imageSmoothingEnabled = prevSmoothing;
}

// ---------------------------------------------------------------------------
// Custom Uploaded Avatars (client-side compression -> compact base64 sync)
// ---------------------------------------------------------------------------

export const MAX_CUSTOM_AVATAR_BYTES = 6000;
const TARGET_CUSTOM_AVATAR_BYTES = 3200;
const CUSTOM_AVATAR_DATA_URL_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

export function isValidCustomAvatarDataUrl(url: string): boolean {
  return (
    typeof url === 'string' &&
    url.length <= MAX_CUSTOM_AVATAR_BYTES &&
    CUSTOM_AVATAR_DATA_URL_RE.test(url)
  );
}

interface DecodedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

function decodeFileViaImageElement(file: File): Promise<DecodedImageSource> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read avatar file'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Invalid avatar file data'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        resolve({
          source: img,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          cleanup: () => {
            img.onload = null;
            img.onerror = null;
          },
        });
      };
      img.onerror = () => reject(new Error('Failed to decode avatar image'));
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}

async function decodeAvatarFile(file: File): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => {
          bitmap.close();
        },
      };
    } catch {
      // Fall back to FileReader + Image for formats unsupported by createImageBitmap
    }
  }
  return decodeFileViaImageElement(file);
}

function drawSquareCrop(
  canvas: HTMLCanvasElement,
  src: DecodedImageSource,
  size: number,
  fillBg: string | null
): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  if (fillBg) {
    ctx.fillStyle = fillBg;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }
  const side = Math.min(src.width, src.height);
  const sx = (src.width - side) * 0.5;
  const sy = (src.height - side) * 0.5;
  ctx.drawImage(src.source, sx, sy, side, side, 0, 0, size, size);
}

/**
 * Center-crops and compresses an uploaded image File into a compact base64 data URL
 * (< 3200 bytes) suitable for retained MQTT broadcast.
 */
export async function compressCustomAvatarFile(file: File): Promise<string> {
  const decoded = await decodeAvatarFile(file);
  if (decoded.width <= 0 || decoded.height <= 0) {
    decoded.cleanup();
    throw new Error('Empty avatar image');
  }

  const canvas = document.createElement('canvas');
  try {
    // Pass 1: 40x40 WebP @ 0.62
    drawSquareCrop(canvas, decoded, 40, null);
    let url = canvas.toDataURL('image/webp', 0.62);
    if (url.startsWith('data:image/webp;base64,') && url.length <= TARGET_CUSTOM_AVATAR_BYTES) {
      return url;
    }

    // Pass 2: 40x40 JPEG @ 0.58 (composited over dark neutral bg for transparent PNGs)
    drawSquareCrop(canvas, decoded, 40, '#10141c');
    url = canvas.toDataURL('image/jpeg', 0.58);
    if (url.length <= TARGET_CUSTOM_AVATAR_BYTES && isValidCustomAvatarDataUrl(url)) {
      return url;
    }

    // Pass 3: 32x32 WebP @ 0.52 -> JPEG @ 0.52
    drawSquareCrop(canvas, decoded, GRID_SIZE, null);
    url = canvas.toDataURL('image/webp', 0.52);
    if (url.startsWith('data:image/webp;base64,') && url.length <= TARGET_CUSTOM_AVATAR_BYTES) {
      return url;
    }

    drawSquareCrop(canvas, decoded, GRID_SIZE, '#10141c');
    url = canvas.toDataURL('image/jpeg', 0.52);
    if (url.length <= TARGET_CUSTOM_AVATAR_BYTES && isValidCustomAvatarDataUrl(url)) {
      return url;
    }

    // Final safeguard: 28x28 JPEG @ 0.45 for extremely noisy inputs
    drawSquareCrop(canvas, decoded, 28, '#10141c');
    url = canvas.toDataURL('image/jpeg', 0.45);
    if (isValidCustomAvatarDataUrl(url)) {
      return url;
    }

    throw new Error('Compressed avatar exceeded size limit');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    decoded.cleanup();
  }
}

interface CustomAvatarEntry {
  dataUrl: string;
  canvas: HTMLCanvasElement | null;
  decodeToken: number;
}

const customAvatarMap = new Map<string, CustomAvatarEntry>();
const avatarVersionMap = new Map<string, number>();
let nextDecodeToken = 1;

function bumpAvatarVersion(ownerId: string): number {
  const next = (avatarVersionMap.get(ownerId) ?? 0) + 1;
  avatarVersionMap.set(ownerId, next);
  return next;
}

/**
 * Registers or clears a validated custom base64 avatar for a rider ID.
 * Decodes asynchronously into a tiny 32x32 canvas and bumps version both immediately
 * and once decoded so 3D nameplates & HUD portraits auto-refresh cleanly.
 */
export function setCustomAvatar(ownerId: string, dataUrl: string | null): number {
  if (!ownerId) return 0;

  const existing = customAvatarMap.get(ownerId);
  if (!dataUrl || !isValidCustomAvatarDataUrl(dataUrl)) {
    if (existing) {
      if (existing.canvas) {
        existing.canvas.width = 0;
        existing.canvas.height = 0;
        existing.canvas = null;
      }
      customAvatarMap.delete(ownerId);
      return bumpAvatarVersion(ownerId);
    }
    return avatarVersionMap.get(ownerId) ?? 0;
  }

  if (existing && existing.dataUrl === dataUrl) {
    return avatarVersionMap.get(ownerId) ?? 0;
  }

  if (existing?.canvas) {
    existing.canvas.width = 0;
    existing.canvas.height = 0;
    existing.canvas = null;
  }

  const token = nextDecodeToken++;
  const entry: CustomAvatarEntry = {
    dataUrl,
    canvas: null,
    decodeToken: token,
  };
  customAvatarMap.set(ownerId, entry);
  const immediateVer = bumpAvatarVersion(ownerId);

  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      const current = customAvatarMap.get(ownerId);
      if (!current || current.decodeToken !== token) return;
      const c = document.createElement('canvas');
      c.width = GRID_SIZE;
      c.height = GRID_SIZE;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE);
        current.canvas = c;
        bumpAvatarVersion(ownerId);
      }
    };
    img.onerror = () => {
      const current = customAvatarMap.get(ownerId);
      if (!current || current.decodeToken !== token) return;
      customAvatarMap.delete(ownerId);
      bumpAvatarVersion(ownerId);
    };
    img.src = dataUrl;
  }

  return immediateVer;
}

export function getCustomAvatarDataUrl(ownerId: string): string | null {
  return customAvatarMap.get(ownerId)?.dataUrl ?? null;
}

export function getAvatarVersion(ownerId: string): number {
  return avatarVersionMap.get(ownerId) ?? 0;
}

export function getRiderAvatarDataUrl(ownerId: string, avatarIdx: number, scale = 1): string {
  const custom = customAvatarMap.get(ownerId)?.dataUrl;
  if (custom) return custom;
  return getAvatarDataUrl(avatarIdx, scale);
}

export function drawRiderAvatarToContext(
  ctx: CanvasRenderingContext2D,
  ownerId: string,
  avatarIdx: number,
  x: number,
  y: number,
  size: number
): void {
  const customCanvas = customAvatarMap.get(ownerId)?.canvas;
  if (customCanvas) {
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(customCanvas, Math.round(x), Math.round(y), Math.round(size), Math.round(size));
    ctx.imageSmoothingEnabled = prevSmoothing;
    return;
  }
  drawAvatarToContext(ctx, avatarIdx, x, y, size);
}
