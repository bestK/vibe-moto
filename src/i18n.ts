import type { ItemType, WeaponType } from './game/types';
import type { WeatherId } from './game/WeatherSystem';

export type Lang = 'zh' | 'en';

const STORAGE_LANG_KEY = 'vibemoto_lang';

const ZH_DICT = {
  langBtn: '中',
  uploadAvatar: '上传头像',
  customAvatarBtn: '上传头像',
  clearAvatarTitle: '还原默认头像',
  gyroOn: '陀螺仪已开',
  gyroOff: '陀螺仪已关',
  noGyro: '无陀螺仪传感器',
  pixelMode: '像素模式',
  hdMode: '高清模式',
  camChase: '追尾视角',
  camLow: '低位视角',
  camHood: '车头视角',
  wheelie: '翘头',
  slam: '猛压',
  flip: '要翻车!',
  koLabel: '击倒',
  sniperDodge: '{name} 瞄准中! SPACE躲避',
  rageHunt: '{name} 狂暴追杀中!',
  rageTag: '[狂暴]',
  escCancel: '取消',
  sniperHit: '命中!',
  sniperDodged: '已躲避!',
  sniperMiss: '未命中',
  hitBy: '遭 {name} 攻击',
  koBy: '被 {name} 击倒!',
  koTarget: '击倒 {name}!',
  wipeout: '翻车!',
  nearMiss: '极速擦车 +N2O',
  boostPad: '加速带!',
  lapToast: '第 {lap} 圈!',
  packSpawn: '5M -> {name}',
  leftRoom: '{name} 离开了',
  joinedRoom: '{name} 加入了',
  avatarSynced: '自定义头像已同步',
  avatarReset: '已还原内置头像',
  avatarFailed: '头像处理失败',
  fuelToast: '中国加油 +25% N2O',
  fuelFeed: '{name} 路过中国加油站，氮气 +25%',
  wheelieFlipFeed: '{name} 翘头过度翻车了',
  wheelieSlamFeed: '{name} 翘头猛压击飞了 {target}',
  itemPickFeed: '{from} 拾取了 {item}',
  itemUseTargetFeed: '{from} 对 {to} 使用了 {item}',
  itemUseDropFeed: '{from} 扔出了 {item}',
  itemUseDeployFeed: '{from} 部署了 {item}',
  itemUseCallFeed: '{from} 呼叫了 {item}',
  itemUseSelfFeed: '{from} 激活了 {item}',
  itemUseFireFeed: '{from} 发射了 {item}',
  sniperKoFeed: '{from} 用狙击枪击倒了 {to}',
  sniperDodgeFeed: '{to} 极限躲开了 {from} 的狙击',
  itemHitFeed: '{from} 的 {item} 击中了 {to}',
  meituanRageFeed: '{name} 狂暴了! 影响送餐超时扣钱!',
  elemeRageFeed: '{name} 狂暴了! 外卖洒汤了别跑!',
  truckBlast: '轰中满载大货车! 货物散落一地!',
  truckBanana: '满载大货车踩香蕉皮打滑甩尾!',
  truckTrap: '满载大货车爆胎减速!',
  truckPolice: '警车逼停了满载大货车!',
  truckMagnet: '磁铁拽偏了满载大货车!',
  cargoHit: '撞上散落货物!',
  animalWarn_cow: '前方牛群横穿马路!',
  animalWarn_sheep: '注意羊群横穿马路!',
  animalWarn_dog: '大黄狗冲上马路!',
  animalWarn_boar: '野猪横穿国道!',
  animalWarn_goose: '大白鹅霸占车道!',
  animalHit: '撞到横穿动物翻车!',
  animalDodge: '腾空越过动物 +N2O',
  itemExpired: '{item} 已过期',
  noTarget: '附近无目标',
  regroupNone: '暂无其他在线玩家',
  homeTitle: '房间大厅',
  publicHall: '公共大厅',
  currentRoom: '当前房间',
  roomCodePlaceholder: '输入或创建房间号',
  roomNameOptionalPlaceholder: '房间名（建房可选）',
  roomPassPlaceholder: '房间密码（留空公开）',
  createOrJoin: '创建 / 进入房间',
  enterPublic: '进入公共大厅',
  resumeRide: '继续比赛',
  copyLink: '复制邀请链接',
  linkCopied: '邀请链接已复制',
  passwordRequired: '该房间已加密，请输入密码',
  wrongPassword: '房间密码错误',
  invalidRoom: '请输入有效房间号',
  checkingRoom: '正在验证房间...',
  roomJoined: '已进入房间 {room}',
  roomCreated: '已创建房间 {room}',
  lockedRoom: '加密',
  openRoom: '公开',
  recentRooms: '最近',
  onlineRooms: '在线房间',
  noOtherRooms: '暂无其他在线房间',
  refreshRooms: '刷新房间列表',
  playersCount: '{count}人',
  hostBadge: '房主',
  currentBadge: '当前',
  renameRoom: '修改房间名',
  roomTitlePlaceholder: '输入新房间名',
  save: '保存',
  cancel: '取消',
  roomRenamed: '房间名已改为「{title}」',
  enterPassForRoom: '房间「{room}」已加密，请输入密码',
  dismountBtn: '下车建造',
  mountBtn: '上车',
  summonBikeBtn: '召唤摩托',
  backToTrackBtn: '回赛道',
  freeRoamEnter: '离开赛道 · 开放世界! 按 G 下车建造',
  backToTrackToast: '已回到赛道!',
  dismountToast: '已下车 · 左键破坏 / 右键放置 · G上车',
  mountToast: '已上车!',
  summonBikeToast: '已召唤摩托并上车!',
  fpCamToast: '第一人称建造视角',
  tpCamToast: '第三人称步行视角',
  buildHint: 'WASD移动 · 空格跳 · 左键拆/右键放 · 1-9/0选方块 · E互动 · B商店 · C视角 · G上车',
  breakBtn: '破坏',
  placeBtn: '放置',
  jumpBtn: '跳',
  clearBuildTitle: '再点一次清空所有自建方块',
  clearBuildBtn: '清空',
  buildCleared: '已清空所有自建方块',
  serverAccountBtn: '服务器 / 账号',
  serverModalTitle: '服务器与游戏账号',
  serverUrlLabel: '服务器地址 (Go 服务端 / MC 协议)',
  serverUrlPlaceholder: '例如 https://moto.linkof.link',
  serverSaveConnect: '保存并连接',
  serverResetDefault: '恢复默认',
  serverChecking: '正在检测服务器...',
  serverOnlineMeta: '在线 {ms}ms · {online}人 · {blocks}方块 · MC:{port}',
  serverOfflineMeta: '服务器暂不可达（本地离线模式仍可玩）',
  serverSavedToast: '服务器已切换为 {url}',
  accountSectionTitle: '游戏账号',
  accountTabLogin: '登录账号',
  accountTabRegister: '创建账号',
  accountUserPlaceholder: '游戏账号（2-20位）',
  accountPassPlaceholder: '密码（至少4位）',
  accountNickPlaceholder: '游戏昵称（可选）',
  accountLoginBtn: '登录游戏账号',
  accountRegisterBtn: '创建游戏账号',
  accountLogoutBtn: '退出登录',
  accountLoggedInToast: '欢迎回来，{name}!',
  accountCreatedToast: '账号创建成功，欢迎 {name}!',
  accountLoggedOutToast: '已退出游戏账号',
  accountStatsText: '已放置 {placed} 块 · 已破坏 {broken} 块',
  coinsLabel: '金币',
  shopBtn: '商店',
  shopBtnTitle: '世界商店 / 交易行 / 道具袋 / 蓝图 (B)',
  aiBuildBtn: 'AI建造',
  aiBuildBtnTitle: 'AI 自然语言自动建造',
  stashItemBtn: '存袋',
  stashItemTitle: '将当前道具存入道具道路袋 (T)',
  interactBtn: '互动',
  shieldActiveLabel: '护盾 {time}',
  shieldTitle: '建筑保护盾剩余时间',
  shieldBlockedToast: '已被 {name} 的保护盾保护（剩余 {sec}s）',
  ecoModalTitle: '世界商店与背包',
  ecoTabShop: '世界商店',
  ecoTabMarket: '玩家交易行',
  ecoTabBag: '道具道路袋',
  ecoTabBlueprints: '建筑蓝图',
  ecoBuyBtn: '购买',
  ecoBuySuccess: '购买成功: {item}',
  ecoNotEnoughCoins: '金币不足',
  ecoCapReached: '该材料已达存储上限',
  ecoItemBagName: '道具道路袋 (+3格)',
  ecoShield10m: '建筑保护盾 +10分钟',
  ecoShield30m: '建筑保护盾 +30分钟',
  marketListBtn: '上架出售',
  marketCancelBtn: '下架',
  marketEmpty: '交易行暂无挂单',
  marketSoldToast: '交易成功!',
  bagCapacityLabel: '容量 {used}/{cap}',
  bagUseNow: '立即使用',
  bagEmpty: '道具道路袋暂无道具',
  bagStashedToast: '已存入道具袋: {item}',
  bagFullToast: '道具袋已满，请在商店扩充容量',
  bpSetPos1: '设角点 A',
  bpSetPos2: '设角点 B',
  bpSaveBtn: '保存设计图',
  bpRebuildBtn: '重建',
  bpDeleteBtn: '删除',
  bpSavedToast: '设计图已保存: {name}',
  bpEmpty: '暂无保存的建筑蓝图',
  harvestPrompt: '按 E 采集 {name}',
  harvestSuccess: '采集 {name} +{coins} 金币',
  harvestCooldown: '{name} 再生中 ({sec}s)',
  nodeWoodGrove: '林木采集点',
  nodeStoneQuarry: '采石矿场',
  nodeNeonCrystal: '霓虹水晶簇',
  nodeSupplyDrop: '公路补给箱',
  computerPrompt: '按 E 打开 Vibe 电脑终端',
  sshModalTitle: 'Vibe Coding WebSSH 终端',
  sshConnectBtn: '连接 SSH',
  sshDisconnectBtn: '断开',
  sshSaveConsent: '在浏览器本地保存敏感配置 (可选，默认仅本次会话)',
  sshClearLocal: '清除本地配置',
  sshConnectedToast: 'WebSSH 终端已连接',
  sshDisconnectedToast: 'WebSSH 连接已断开',
  aiModalTitle: 'AI 自然语言建造师',
  aiGenerateBtn: 'AI 生成',
  aiLocalGenBtn: '本地免费生成',
  aiBuildNowBtn: '消耗材料建造',
  aiSaveKeyConsent: '在浏览器本地保存 API Key (可选，默认仅本次会话)',
  aiClearKey: '清除本地 Key',
  aiPromptPlaceholder: '描述你想建造的建筑，如：5x5带窗霓虹木屋...',
  aiBuiltToast: 'AI 建筑已生成: {name} ({count}块)',
  blockEffectSlow: '驶入草丛/树叶减速!',
  blockEffectBlock: '撞上路障方块减速!',
  blockEffectCrash: '高速撞毁路障翻车!',
  blockEffectBoost: '自建赛道抓地加速 +12%!',
  blockNoStock: '{name} 库存不足，去采集或商店购买',
} as const;

export type I18nKey = keyof typeof ZH_DICT;

const EN_DICT: Record<I18nKey, string> = {
  langBtn: 'EN',
  uploadAvatar: 'UPLOAD',
  customAvatarBtn: 'UPLOAD',
  clearAvatarTitle: 'Reset avatar',
  gyroOn: 'GYRO ON',
  gyroOff: 'GYRO OFF',
  noGyro: 'NO GYRO',
  pixelMode: 'PIXEL MODE',
  hdMode: 'HD MODE',
  camChase: 'CAM: CHASE',
  camLow: 'CAM: LOW',
  camHood: 'CAM: HOOD',
  wheelie: 'WHEELIE',
  slam: 'SLAM',
  flip: '! FLIP',
  koLabel: 'KO',
  sniperDodge: '{name} LOCKED! SPACE DODGE',
  rageHunt: '{name} ENRAGED CHASE!',
  rageTag: '[RAGE]',
  escCancel: 'ESC',
  sniperHit: 'HIT!',
  sniperDodged: 'DODGED!',
  sniperMiss: 'MISS',
  hitBy: 'HIT BY {name}',
  koBy: 'K.O. BY {name}!',
  koTarget: 'K.O.! {name}',
  wipeout: 'WIPEOUT!',
  nearMiss: 'NEAR MISS +N2O',
  boostPad: 'BOOST!',
  lapToast: 'LAP {lap}!',
  packSpawn: '5M -> {name}',
  leftRoom: '{name} LEFT',
  joinedRoom: '{name} JOINED',
  avatarSynced: 'AVATAR SYNCED',
  avatarReset: 'AVATAR RESET',
  avatarFailed: 'AVATAR FAILED',
  fuelToast: 'FUEL +25% N2O',
  fuelFeed: '{name} refueled +25% N2O',
  wheelieFlipFeed: '{name} looped out on a wheelie',
  wheelieSlamFeed: '{name} wheelie-slammed {target}',
  itemPickFeed: '{from} picked up {item}',
  itemUseTargetFeed: '{from} used {item} on {to}',
  itemUseDropFeed: '{from} dropped {item}',
  itemUseDeployFeed: '{from} deployed {item}',
  itemUseCallFeed: '{from} called {item}',
  itemUseSelfFeed: '{from} activated {item}',
  itemUseFireFeed: '{from} fired {item}',
  sniperKoFeed: '{from} sniped {to}',
  sniperDodgeFeed: "{to} dodged {from}'s snipe",
  itemHitFeed: "{from}'s {item} hit {to}",
  meituanRageFeed: '{name} ENRAGED! Late delivery penalty!',
  elemeRageFeed: '{name} ENRAGED! Spilled the soup!',
  truckBlast: 'CARGO TRUCK BLASTED! CRATES SCATTERED!',
  truckBanana: 'CARGO TRUCK SLIPPED ON BANANA!',
  truckTrap: 'CARGO TRUCK TIRE BLOWN!',
  truckPolice: 'POLICE PULLED OVER CARGO TRUCK!',
  truckMagnet: 'MAGNET PULLED CARGO TRUCK!',
  cargoHit: 'HIT FALLEN CARGO!',
  animalWarn_cow: 'COW HERD CROSSING AHEAD!',
  animalWarn_sheep: 'SHEEP FLOCK CROSSING AHEAD!',
  animalWarn_dog: 'VILLAGE DOG CROSSING!',
  animalWarn_boar: 'WILD BOAR CROSSING!',
  animalWarn_goose: 'GOOSE BLOCKING THE LANE!',
  animalHit: 'ANIMAL COLLISION WIPEOUT!',
  animalDodge: 'ANIMAL HOP DODGE +N2O',
  itemExpired: '{item} expired',
  noTarget: 'NO TARGET',
  regroupNone: 'NO ONLINE RIDERS',
  homeTitle: 'ROOM LOBBY',
  publicHall: 'PUBLIC HALL',
  currentRoom: 'CURRENT',
  roomCodePlaceholder: 'Room name or code',
  roomNameOptionalPlaceholder: 'Room title (optional)',
  roomPassPlaceholder: 'Password (optional)',
  createOrJoin: 'CREATE / JOIN',
  enterPublic: 'PUBLIC HALL',
  resumeRide: 'RESUME',
  copyLink: 'COPY LINK',
  linkCopied: 'INVITE LINK COPIED',
  passwordRequired: 'PASSWORD REQUIRED',
  wrongPassword: 'WRONG PASSWORD',
  invalidRoom: 'INVALID ROOM CODE',
  checkingRoom: 'CHECKING ROOM...',
  roomJoined: 'JOINED ROOM {room}',
  roomCreated: 'CREATED ROOM {room}',
  lockedRoom: 'LOCKED',
  openRoom: 'OPEN',
  recentRooms: 'RECENT',
  onlineRooms: 'LIVE ROOMS',
  noOtherRooms: 'No other live rooms',
  refreshRooms: 'Refresh room list',
  playersCount: '{count}',
  hostBadge: 'HOST',
  currentBadge: 'HERE',
  renameRoom: 'Rename room',
  roomTitlePlaceholder: 'New room name',
  save: 'SAVE',
  cancel: 'CANCEL',
  roomRenamed: 'ROOM RENAMED: {title}',
  enterPassForRoom: 'Room "{room}" is locked, enter password',
  dismountBtn: 'BUILD',
  mountBtn: 'MOUNT',
  summonBikeBtn: 'SUMMON',
  backToTrackBtn: 'TRACK',
  freeRoamEnter: 'OPEN WORLD! PRESS G TO DISMOUNT & BUILD',
  backToTrackToast: 'BACK ON TRACK!',
  dismountToast: 'ON FOOT · L-BREAK / R-BUILD · G MOUNT',
  mountToast: 'MOUNTED!',
  summonBikeToast: 'BIKE SUMMONED!',
  fpCamToast: '1ST PERSON BUILD',
  tpCamToast: '3RD PERSON WALK',
  buildHint: 'WASD Move · Space Jump · L-Mine / R-Place · 1-9/0 Blocks · E Use · B Shop · C View · G Mount',
  breakBtn: 'MINE',
  placeBtn: 'BUILD',
  jumpBtn: 'JUMP',
  clearBuildTitle: 'Click again to clear all blocks',
  clearBuildBtn: 'CLR',
  buildCleared: 'CLEARED ALL BLOCKS',
  serverAccountBtn: 'SERVER / ID',
  serverModalTitle: 'SERVER & ACCOUNT',
  serverUrlLabel: 'Server Address (Go + MC Protocol)',
  serverUrlPlaceholder: 'e.g. https://moto.linkof.link',
  serverSaveConnect: 'CONNECT',
  serverResetDefault: 'DEFAULT',
  serverChecking: 'Checking server...',
  serverOnlineMeta: 'ONLINE {ms}ms · {online}P · {blocks} BLKS · MC:{port}',
  serverOfflineMeta: 'Server unreachable (offline sandbox works)',
  serverSavedToast: 'SERVER: {url}',
  accountSectionTitle: 'GAME ACCOUNT',
  accountTabLogin: 'LOGIN',
  accountTabRegister: 'REGISTER',
  accountUserPlaceholder: 'Username (2-20 chars)',
  accountPassPlaceholder: 'Password (4+ chars)',
  accountNickPlaceholder: 'Display name (optional)',
  accountLoginBtn: 'LOGIN',
  accountRegisterBtn: 'CREATE ACCOUNT',
  accountLogoutBtn: 'LOGOUT',
  accountLoggedInToast: 'WELCOME BACK, {name}!',
  accountCreatedToast: 'ACCOUNT CREATED: {name}!',
  accountLoggedOutToast: 'LOGGED OUT',
  accountStatsText: 'Placed {placed} · Broken {broken}',
  coinsLabel: 'COINS',
  shopBtn: 'SHOP',
  shopBtnTitle: 'World Shop / Market / Bag / Blueprints (B)',
  aiBuildBtn: 'AI BUILD',
  aiBuildBtnTitle: 'AI Natural-Language Auto-Builder',
  stashItemBtn: 'STASH',
  stashItemTitle: 'Stash current item into Item Bag (T)',
  interactBtn: 'USE',
  shieldActiveLabel: 'SHIELD {time}',
  shieldTitle: 'Build protection shield remaining',
  shieldBlockedToast: 'Protected by {name}\'s shield ({sec}s left)',
  ecoModalTitle: 'WORLD SHOP & BAG',
  ecoTabShop: 'SHOP',
  ecoTabMarket: 'MARKET',
  ecoTabBag: 'ITEM BAG',
  ecoTabBlueprints: 'BLUEPRINTS',
  ecoBuyBtn: 'BUY',
  ecoBuySuccess: 'Purchased: {item}',
  ecoNotEnoughCoins: 'Not enough coins',
  ecoCapReached: 'Material cap reached',
  ecoItemBagName: 'Item Bag (+3 slots)',
  ecoShield10m: 'Build Shield +10m',
  ecoShield30m: 'Build Shield +30m',
  marketListBtn: 'LIST ITEM',
  marketCancelBtn: 'CANCEL',
  marketEmpty: 'No market listings yet',
  marketSoldToast: 'Trade complete!',
  bagCapacityLabel: 'SLOTS {used}/{cap}',
  bagUseNow: 'USE NOW',
  bagEmpty: 'Item bag is empty',
  bagStashedToast: 'Stashed in bag: {item}',
  bagFullToast: 'Item bag full — expand in Shop',
  bpSetPos1: 'SET POS A',
  bpSetPos2: 'SET POS B',
  bpSaveBtn: 'SAVE BLUEPRINT',
  bpRebuildBtn: 'REBUILD',
  bpDeleteBtn: 'DELETE',
  bpSavedToast: 'Blueprint saved: {name}',
  bpEmpty: 'No saved blueprints',
  harvestPrompt: 'Press E to harvest {name}',
  harvestSuccess: 'Harvested {name} +{coins} coins',
  harvestCooldown: '{name} regenerating ({sec}s)',
  nodeWoodGrove: 'TIMBER GROVE',
  nodeStoneQuarry: 'STONE QUARRY',
  nodeNeonCrystal: 'NEON CRYSTAL',
  nodeSupplyDrop: 'SUPPLY DROP',
  computerPrompt: 'Press E to open Vibe Terminal',
  sshModalTitle: 'VIBE CODING WEBSSH',
  sshConnectBtn: 'CONNECT',
  sshDisconnectBtn: 'DISCONNECT',
  sshSaveConsent: 'Save credentials locally in browser (optional, session-only by default)',
  sshClearLocal: 'Clear Local',
  sshConnectedToast: 'WebSSH terminal connected',
  sshDisconnectedToast: 'WebSSH disconnected',
  aiModalTitle: 'AI AUTO-BUILDER',
  aiGenerateBtn: 'AI GENERATE',
  aiLocalGenBtn: 'LOCAL FREE GEN',
  aiBuildNowBtn: 'BUILD WITH STOCK',
  aiSaveKeyConsent: 'Save API Key locally (optional, session-only by default)',
  aiClearKey: 'Clear Key',
  aiPromptPlaceholder: 'Describe a build, e.g. 5x5 wood cabin with neon windows...',
  aiBuiltToast: 'AI build complete: {name} ({count} blocks)',
  blockEffectSlow: 'GRASS/LEAVES DRAG!',
  blockEffectBlock: 'BLOCKED BY OBSTACLE!',
  blockEffectCrash: 'HIGH-SPEED BARRICADE CRASH!',
  blockEffectBoost: 'CUSTOM ASPHALT GRIP +12%!',
  blockNoStock: 'Out of {name} — harvest or buy in Shop',
};

const ITEM_NAMES: Readonly<Record<Lang, Readonly<Record<ItemType, string>>>> = {
  zh: {
    rpg: 'RPG 火箭筒',
    airstrike: '空中支援',
    sniper: '狙击枪',
    police: '警车拦截',
    turbo: '超级加速',
    trap: '路钉陷阱',
    magnet: '磁铁',
    banana: '香蕉皮',
  },
  en: {
    rpg: 'RPG',
    airstrike: 'AIRSTRIKE',
    sniper: 'SNIPER',
    police: 'POLICE',
    turbo: 'TURBO',
    trap: 'SPIKE TRAP',
    magnet: 'MAGNET',
    banana: 'BANANA',
  },
};

const WEAPON_NAMES: Readonly<Record<Lang, Readonly<Record<WeaponType, string>>>> = {
  zh: {
    0: '拳脚',
    1: '球棒',
    2: '铁链',
  },
  en: {
    0: 'FIST',
    1: 'BAT',
    2: 'CHAIN',
  },
};

const DELIVERY_NAMES: Readonly<Record<Lang, Readonly<Record<'meituan' | 'eleme', string>>>> = {
  zh: {
    meituan: '美团·小哥',
    eleme: '饿了么·骑士',
  },
  en: {
    meituan: 'MEITUAN',
    eleme: 'ELE.ME',
  },
};

const WEATHER_NAMES: Readonly<Record<Lang, Readonly<Record<WeatherId, string>>>> = {
  zh: {
    clear: '晴朗',
    sunset: '黄昏',
    storm: '暴雨',
    fog: '浓雾',
    snow: '暴雪',
  },
  en: {
    clear: 'CLEAR',
    sunset: 'SUNSET',
    storm: 'STORM',
    fog: 'FOG',
    snow: 'SNOW',
  },
};

function detectInitialLang(): Lang {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_LANG_KEY) : null;
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Ignore restricted storage contexts
  }
  return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en';
}

let currentLang: Lang = detectInitialLang();
const listeners = new Set<(lang: Lang) => void>();

function syncDocumentLang(lang: Lang): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }
}

syncDocumentLang(currentLang);

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  const next: Lang = lang === 'zh' ? 'zh' : 'en';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_LANG_KEY, next);
    }
  } catch {
    // Ignore restricted storage contexts
  }
  syncDocumentLang(next);
  if (next === currentLang) return;
  currentLang = next;
  for (const fn of listeners) {
    fn(next);
  }
}

export function toggleLang(): Lang {
  const next: Lang = currentLang === 'zh' ? 'en' : 'zh';
  setLang(next);
  return next;
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function itemName(id: ItemType): string {
  return ITEM_NAMES[currentLang][id];
}

export function weaponName(w: WeaponType): string {
  return WEAPON_NAMES[currentLang][w];
}

export function deliveryName(role: 'meituan' | 'eleme'): string {
  return DELIVERY_NAMES[currentLang][role];
}

export function weatherName(id: WeatherId): string {
  return WEATHER_NAMES[currentLang][id];
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  const raw = currentLang === 'zh' ? ZH_DICT[key] : EN_DICT[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const val = vars[name];
    return val === undefined ? match : String(val);
  });
}
