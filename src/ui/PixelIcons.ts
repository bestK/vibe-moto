import type { AnimalSpecies } from '../game/AnimalSystem';
import type { ItemType, WeaponType } from '../game/types';
import type { WeatherId } from '../game/WeatherSystem';

export type PixelIconId =
  | 'edit'
  | 'soundOn'
  | 'soundOff'
  | 'gyro'
  | 'regroup'
  | 'upload'
  | 'reset'
  | 'skull'
  | 'flame'
  | 'bolt'
  | 'wheelie'
  | 'brake'
  | 'arrowLeft'
  | 'arrowRight'
  | 'flag'
  | 'crate'
  | 'fuel'
  | 'warning'
  | 'truck'
  | 'bike'
  | 'blast'
  | 'globe'
  | 'home'
  | 'lock'
  | 'unlock'
  | 'copy'
  | 'dice'
  | 'door'
  | 'weather_clear'
  | 'weather_sunset'
  | 'weather_storm'
  | 'weather_fog'
  | 'weather_snow'
  | 'item_rpg'
  | 'item_airstrike'
  | 'item_sniper'
  | 'item_police'
  | 'item_turbo'
  | 'item_trap'
  | 'item_magnet'
  | 'item_banana'
  | 'animal_cow'
  | 'animal_sheep'
  | 'animal_dog'
  | 'animal_boar'
  | 'animal_goose'
  | 'weapon_fist'
  | 'weapon_bat'
  | 'weapon_chain'
  | 'walk'
  | 'cube'
  | 'pickaxe'
  | 'road'
  | 'server'
  | 'user'
  | 'coin'
  | 'shop'
  | 'shield'
  | 'terminal'
  | 'sparkle'
  | 'blueprint'
  | 'bag'
  | 'harvest'
  | 'map'
  | 'pin'
  | 'teleport'
  | 'intruder'
  | 'avatarStudio'
  | 'camera';

/**
 * Handcrafted 16x16 pixel-art SVG primitives (`shape-rendering="crispEdges"`).
 * Utility/HUD icons inherit `currentColor`; arcade items, animals & alerts use
 * high-contrast retro pixel palettes so they read crisply on dark HUD surfaces.
 */
const ICON_BODIES: Readonly<Record<PixelIconId, string>> = {
  // --- Utility & HUD icons (currentColor) ---
  edit:
    '<g fill="currentColor">' +
    '<rect x="11" y="1" width="3" height="2"/><rect x="12" y="2" width="3" height="3"/>' +
    '<rect x="9" y="3" width="3" height="3"/><rect x="7" y="5" width="3" height="3"/>' +
    '<rect x="5" y="7" width="3" height="3"/><rect x="3" y="9" width="3" height="3"/>' +
    '<rect x="2" y="11" width="3" height="3"/><rect x="1" y="13" width="2" height="2"/>' +
    '</g>',

  soundOn:
    '<g fill="currentColor">' +
    '<rect x="1" y="6" width="3" height="4"/><rect x="4" y="4" width="2" height="8"/>' +
    '<rect x="6" y="2" width="2" height="12"/><rect x="10" y="5" width="1" height="6"/>' +
    '<rect x="12" y="3" width="1" height="10"/><rect x="14" y="5" width="1" height="6"/>' +
    '</g>',

  soundOff:
    '<g fill="currentColor">' +
    '<rect x="1" y="6" width="3" height="4"/><rect x="4" y="4" width="2" height="8"/>' +
    '<rect x="6" y="2" width="2" height="12"/>' +
    '<rect x="10" y="4" width="2" height="2"/><rect x="14" y="4" width="2" height="2"/>' +
    '<rect x="11" y="6" width="4" height="4"/>' +
    '<rect x="10" y="10" width="2" height="2"/><rect x="14" y="10" width="2" height="2"/>' +
    '</g>',

  gyro:
    '<g fill="currentColor">' +
    '<rect x="5" y="1" width="6" height="2"/><rect x="5" y="13" width="6" height="2"/>' +
    '<rect x="1" y="5" width="2" height="6"/><rect x="13" y="5" width="2" height="6"/>' +
    '<rect x="3" y="3" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/>' +
    '<rect x="3" y="11" width="2" height="2"/><rect x="11" y="11" width="2" height="2"/>' +
    '<rect x="9" y="5" width="2" height="2"/><rect x="7" y="7" width="2" height="2"/>' +
    '<rect x="5" y="9" width="2" height="2"/>' +
    '</g>',

  regroup:
    '<g fill="currentColor">' +
    '<rect x="7" y="0" width="2" height="4"/><rect x="7" y="12" width="2" height="4"/>' +
    '<rect x="0" y="7" width="4" height="2"/><rect x="12" y="7" width="4" height="2"/>' +
    '<rect x="4" y="3" width="8" height="2"/><rect x="4" y="11" width="8" height="2"/>' +
    '<rect x="3" y="4" width="2" height="8"/><rect x="11" y="4" width="2" height="8"/>' +
    '<rect x="7" y="7" width="2" height="2"/>' +
    '</g>',

  upload:
    '<g fill="currentColor">' +
    '<rect x="7" y="2" width="2" height="8"/><rect x="5" y="4" width="6" height="2"/>' +
    '<rect x="4" y="5" width="2" height="2"/><rect x="10" y="5" width="2" height="2"/>' +
    '<rect x="2" y="10" width="2" height="4"/><rect x="12" y="10" width="2" height="4"/>' +
    '<rect x="2" y="12" width="12" height="2"/>' +
    '</g>',

  reset:
    '<g fill="currentColor">' +
    '<rect x="5" y="2" width="6" height="2"/><rect x="11" y="4" width="2" height="3"/>' +
    '<rect x="3" y="4" width="2" height="4"/><rect x="1" y="5" width="6" height="2"/>' +
    '<rect x="2" y="4" width="2" height="4"/><rect x="11" y="9" width="2" height="3"/>' +
    '<rect x="5" y="12" width="6" height="2"/><rect x="3" y="10" width="2" height="2"/>' +
    '</g>',

  skull:
    '<rect x="4" y="1" width="8" height="2" fill="currentColor"/>' +
    '<rect x="2" y="3" width="12" height="7" fill="currentColor"/>' +
    '<rect x="4" y="10" width="8" height="4" fill="currentColor"/>' +
    '<rect x="4" y="5" width="3" height="3" fill="#10121a"/>' +
    '<rect x="9" y="5" width="3" height="3" fill="#10121a"/>' +
    '<rect x="7" y="8" width="2" height="2" fill="#10121a"/>' +
    '<rect x="5" y="12" width="1" height="2" fill="#10121a"/>' +
    '<rect x="8" y="12" width="1" height="2" fill="#10121a"/>' +
    '<rect x="10" y="12" width="1" height="2" fill="#10121a"/>',

  wheelie:
    '<g fill="currentColor">' +
    '<rect x="7" y="1" width="2" height="2"/><rect x="5" y="3" width="6" height="2"/>' +
    '<rect x="3" y="5" width="3" height="2"/><rect x="10" y="5" width="3" height="2"/>' +
    '<rect x="7" y="7" width="2" height="2"/><rect x="5" y="9" width="6" height="2"/>' +
    '<rect x="3" y="11" width="3" height="2"/><rect x="10" y="11" width="3" height="2"/>' +
    '<rect x="7" y="11" width="2" height="4"/>' +
    '</g>',

  brake:
    '<g fill="currentColor">' +
    '<rect x="7" y="1" width="2" height="6"/><rect x="3" y="5" width="3" height="2"/>' +
    '<rect x="10" y="5" width="3" height="2"/><rect x="5" y="7" width="6" height="2"/>' +
    '<rect x="7" y="9" width="2" height="2"/><rect x="2" y="13" width="12" height="2"/>' +
    '</g>',

  arrowLeft:
    '<g fill="currentColor">' +
    '<rect x="2" y="7" width="2" height="2"/><rect x="4" y="5" width="2" height="6"/>' +
    '<rect x="6" y="3" width="2" height="10"/><rect x="8" y="6" width="6" height="4"/>' +
    '</g>',

  arrowRight:
    '<g fill="currentColor">' +
    '<rect x="12" y="7" width="2" height="2"/><rect x="10" y="5" width="2" height="6"/>' +
    '<rect x="8" y="3" width="2" height="10"/><rect x="2" y="6" width="6" height="4"/>' +
    '</g>',

  globe:
    '<g fill="currentColor">' +
    '<rect x="5" y="1" width="6" height="2"/><rect x="5" y="13" width="6" height="2"/>' +
    '<rect x="1" y="5" width="2" height="6"/><rect x="13" y="5" width="2" height="6"/>' +
    '<rect x="3" y="3" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/>' +
    '<rect x="3" y="11" width="2" height="2"/><rect x="11" y="11" width="2" height="2"/>' +
    '<rect x="3" y="7" width="10" height="2"/><rect x="7" y="3" width="2" height="10"/>' +
    '</g>',

  home:
    '<g fill="currentColor">' +
    '<rect x="7" y="1" width="2" height="2"/><rect x="5" y="3" width="6" height="2"/>' +
    '<rect x="3" y="5" width="10" height="2"/><rect x="1" y="7" width="14" height="2"/>' +
    '<rect x="3" y="9" width="3" height="6"/><rect x="10" y="9" width="3" height="6"/>' +
    '<rect x="6" y="9" width="4" height="2"/>' +
    '</g>',

  lock:
    '<g fill="currentColor">' +
    '<rect x="5" y="1" width="6" height="2"/><rect x="4" y="3" width="2" height="4"/>' +
    '<rect x="10" y="3" width="2" height="4"/><rect x="2" y="7" width="12" height="8"/>' +
    '</g>' +
    '<rect x="7" y="9" width="2" height="2" fill="#10121a"/>' +
    '<rect x="7" y="11" width="2" height="2" fill="#10121a"/>',

  unlock:
    '<g fill="currentColor">' +
    '<rect x="5" y="1" width="6" height="2"/><rect x="4" y="3" width="2" height="4"/>' +
    '<rect x="10" y="3" width="2" height="2"/><rect x="2" y="7" width="12" height="8"/>' +
    '</g>' +
    '<rect x="7" y="9" width="2" height="2" fill="#10121a"/>' +
    '<rect x="7" y="11" width="2" height="2" fill="#10121a"/>',

  copy:
    '<g fill="currentColor">' +
    '<rect x="2" y="2" width="8" height="2"/><rect x="2" y="4" width="2" height="8"/>' +
    '<rect x="2" y="10" width="3" height="2"/><rect x="8" y="4" width="2" height="2"/>' +
    '<rect x="6" y="5" width="8" height="2"/><rect x="6" y="7" width="2" height="8"/>' +
    '<rect x="12" y="7" width="2" height="8"/><rect x="6" y="13" width="8" height="2"/>' +
    '</g>',

  dice:
    '<g fill="currentColor">' +
    '<rect x="2" y="2" width="12" height="12"/>' +
    '</g>' +
    '<rect x="4" y="4" width="2" height="2" fill="#10121a"/>' +
    '<rect x="10" y="4" width="2" height="2" fill="#10121a"/>' +
    '<rect x="7" y="7" width="2" height="2" fill="#10121a"/>' +
    '<rect x="4" y="10" width="2" height="2" fill="#10121a"/>' +
    '<rect x="10" y="10" width="2" height="2" fill="#10121a"/>',

  door:
    '<g fill="currentColor">' +
    '<rect x="7" y="1" width="7" height="2"/><rect x="12" y="3" width="2" height="12"/>' +
    '<rect x="7" y="13" width="7" height="2"/><rect x="7" y="3" width="2" height="3"/>' +
    '<rect x="7" y="10" width="2" height="3"/><rect x="1" y="7" width="8" height="2"/>' +
    '<rect x="6" y="5" width="2" height="2"/><rect x="6" y="9" width="2" height="2"/>' +
    '<rect x="8" y="6" width="2" height="4"/>' +
    '</g>',

  // --- Color-accented arcade HUD & feed icons ---
  flame:
    '<rect x="7" y="1" width="2" height="2" fill="#ff2a54"/>' +
    '<rect x="6" y="3" width="4" height="2" fill="#ff4d00"/>' +
    '<rect x="4" y="5" width="8" height="3" fill="#ff4d00"/>' +
    '<rect x="3" y="8" width="10" height="4" fill="#ff2a54"/>' +
    '<rect x="4" y="12" width="8" height="2" fill="#d90429"/>' +
    '<rect x="5" y="14" width="6" height="1" fill="#9b0d1f"/>' +
    '<rect x="6" y="6" width="4" height="5" fill="#ff9f1c"/>' +
    '<rect x="6" y="9" width="4" height="4" fill="#ffe600"/>' +
    '<rect x="7" y="10" width="2" height="2" fill="#ffffff"/>',

  bolt:
    '<rect x="8" y="1" width="4" height="2" fill="#ffd166"/>' +
    '<rect x="6" y="3" width="4" height="2" fill="#ffd166"/>' +
    '<rect x="4" y="5" width="4" height="2" fill="#ffe66d"/>' +
    '<rect x="3" y="7" width="10" height="2" fill="#ffd166"/>' +
    '<rect x="8" y="9" width="4" height="2" fill="#ff9f1c"/>' +
    '<rect x="6" y="11" width="4" height="2" fill="#ff9f1c"/>' +
    '<rect x="4" y="13" width="4" height="2" fill="#ff7b00"/>' +
    '<rect x="6" y="7" width="4" height="1" fill="#ffffff"/>',

  flag:
    '<rect x="2" y="1" width="2" height="14" fill="#cbd5e1"/>' +
    '<rect x="4" y="2" width="10" height="8" fill="#11131a"/>' +
    '<rect x="4" y="2" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="8" y="2" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="12" y="2" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="6" y="4" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="10" y="4" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="4" y="6" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="8" y="6" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="12" y="6" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="6" y="8" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="10" y="8" width="2" height="2" fill="#ffffff"/>',

  crate:
    '<rect x="1" y="1" width="14" height="14" fill="#7c3a00"/>' +
    '<rect x="2" y="2" width="12" height="12" fill="#ffb703"/>' +
    '<rect x="3" y="3" width="10" height="10" fill="#fb8500"/>' +
    '<rect x="2" y="2" width="2" height="2" fill="#ffe66d"/>' +
    '<rect x="12" y="2" width="2" height="2" fill="#ffe66d"/>' +
    '<rect x="2" y="12" width="2" height="2" fill="#ffe66d"/>' +
    '<rect x="12" y="12" width="2" height="2" fill="#ffe66d"/>' +
    '<rect x="6" y="4" width="4" height="2" fill="#ffffff"/>' +
    '<rect x="9" y="6" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="7" y="8" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="7" y="11" width="2" height="2" fill="#ffffff"/>',

  fuel:
    '<rect x="2" y="2" width="9" height="12" fill="#d62828"/>' +
    '<rect x="1" y="13" width="11" height="2" fill="#991b1b"/>' +
    '<rect x="4" y="4" width="5" height="4" fill="#caf0f8"/>' +
    '<rect x="4" y="9" width="5" height="2" fill="#ffd166"/>' +
    '<rect x="11" y="4" width="2" height="2" fill="#cbd5e1"/>' +
    '<rect x="13" y="5" width="2" height="6" fill="#ffd166"/>' +
    '<rect x="11" y="10" width="3" height="2" fill="#cbd5e1"/>',

  warning:
    '<rect x="7" y="1" width="2" height="2" fill="#ffd166"/>' +
    '<rect x="6" y="3" width="4" height="2" fill="#ffd166"/>' +
    '<rect x="5" y="5" width="6" height="2" fill="#ffd166"/>' +
    '<rect x="4" y="7" width="8" height="2" fill="#ffb703"/>' +
    '<rect x="3" y="9" width="10" height="2" fill="#ffb703"/>' +
    '<rect x="2" y="11" width="12" height="2" fill="#fb8500"/>' +
    '<rect x="1" y="13" width="14" height="2" fill="#e85d04"/>' +
    '<rect x="7" y="5" width="2" height="5" fill="#11131a"/>' +
    '<rect x="7" y="11" width="2" height="2" fill="#11131a"/>',

  truck:
    '<rect x="1" y="3" width="9" height="8" fill="#1b6b7a"/>' +
    '<rect x="1" y="5" width="9" height="1" fill="#e2eef4"/>' +
    '<rect x="1" y="6" width="9" height="1" fill="#d62828"/>' +
    '<rect x="4" y="3" width="1" height="8" fill="#d4a373"/>' +
    '<rect x="7" y="3" width="1" height="8" fill="#d4a373"/>' +
    '<rect x="10" y="5" width="5" height="6" fill="#2563eb"/>' +
    '<rect x="12" y="6" width="3" height="3" fill="#90e0ef"/>' +
    '<rect x="1" y="11" width="14" height="2" fill="#334155"/>' +
    '<rect x="2" y="12" width="3" height="3" fill="#0f172a"/>' +
    '<rect x="11" y="12" width="3" height="3" fill="#0f172a"/>' +
    '<rect x="3" y="13" width="1" height="1" fill="#cbd5e1"/>' +
    '<rect x="12" y="13" width="1" height="1" fill="#cbd5e1"/>',

  bike:
    '<rect x="2" y="10" width="4" height="4" fill="#11131a"/>' +
    '<rect x="10" y="10" width="4" height="4" fill="#11131a"/>' +
    '<rect x="3" y="11" width="2" height="2" fill="#cbd5e1"/>' +
    '<rect x="11" y="11" width="2" height="2" fill="#cbd5e1"/>' +
    '<rect x="4" y="7" width="7" height="3" fill="#e63946"/>' +
    '<rect x="9" y="5" width="4" height="3" fill="#e63946"/>' +
    '<rect x="11" y="4" width="2" height="2" fill="#00f5d4"/>' +
    '<rect x="2" y="6" width="3" height="2" fill="#ffd166"/>',

  blast:
    '<rect x="7" y="1" width="2" height="3" fill="#ff2a54"/>' +
    '<rect x="7" y="12" width="2" height="3" fill="#ff2a54"/>' +
    '<rect x="1" y="7" width="3" height="2" fill="#ff2a54"/>' +
    '<rect x="12" y="7" width="3" height="2" fill="#ff2a54"/>' +
    '<rect x="3" y="3" width="2" height="2" fill="#ff4d00"/>' +
    '<rect x="11" y="3" width="2" height="2" fill="#ff4d00"/>' +
    '<rect x="3" y="11" width="2" height="2" fill="#ff4d00"/>' +
    '<rect x="11" y="11" width="2" height="2" fill="#ff4d00"/>' +
    '<rect x="4" y="4" width="8" height="8" fill="#ff7b00"/>' +
    '<rect x="5" y="5" width="6" height="6" fill="#ffe600"/>' +
    '<rect x="7" y="7" width="2" height="2" fill="#ffffff"/>',

  // --- 5 Weather Icons ---
  weather_clear:
    '<rect x="7" y="1" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="7" y="13" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="1" y="7" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="13" y="7" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="3" y="3" width="2" height="2" fill="#ff962e"/>' +
    '<rect x="11" y="3" width="2" height="2" fill="#ff962e"/>' +
    '<rect x="3" y="11" width="2" height="2" fill="#ff962e"/>' +
    '<rect x="11" y="11" width="2" height="2" fill="#ff962e"/>' +
    '<rect x="5" y="4" width="6" height="8" fill="#ffbe3b"/>' +
    '<rect x="4" y="5" width="8" height="6" fill="#ffbe3b"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="#fff5cc"/>',

  weather_sunset:
    '<rect x="5" y="3" width="6" height="2" fill="#ffe173"/>' +
    '<rect x="3" y="5" width="10" height="3" fill="#ffbe3b"/>' +
    '<rect x="4" y="8" width="8" height="2" fill="#ff7a45"/>' +
    '<rect x="1" y="10" width="14" height="2" fill="#ff3b5c"/>' +
    '<rect x="3" y="13" width="10" height="2" fill="#7c4dff"/>',

  weather_storm:
    '<rect x="4" y="2" width="6" height="2" fill="#94a3b8"/>' +
    '<rect x="2" y="4" width="11" height="4" fill="#cbd5e1"/>' +
    '<rect x="3" y="6" width="11" height="3" fill="#64748b"/>' +
    '<rect x="7" y="9" width="3" height="2" fill="#ffbe3b"/>' +
    '<rect x="6" y="11" width="3" height="2" fill="#ffe173"/>' +
    '<rect x="7" y="13" width="2" height="2" fill="#ff962e"/>' +
    '<rect x="3" y="10" width="1" height="3" fill="#60b4ff"/>' +
    '<rect x="11" y="10" width="1" height="3" fill="#60b4ff"/>' +
    '<rect x="13" y="11" width="1" height="3" fill="#60b4ff"/>',

  weather_fog:
    '<rect x="2" y="3" width="9" height="2" fill="#dbe6f0"/>' +
    '<rect x="5" y="6" width="9" height="2" fill="#b4c8d9"/>' +
    '<rect x="1" y="9" width="11" height="2" fill="#dbe6f0"/>' +
    '<rect x="4" y="12" width="10" height="2" fill="#8fa8bd"/>',

  weather_snow:
    '<rect x="7" y="1" width="2" height="14" fill="#e6f4ff"/>' +
    '<rect x="1" y="7" width="14" height="2" fill="#e6f4ff"/>' +
    '<rect x="3" y="3" width="2" height="2" fill="#9bd1ff"/>' +
    '<rect x="11" y="3" width="2" height="2" fill="#9bd1ff"/>' +
    '<rect x="3" y="11" width="2" height="2" fill="#9bd1ff"/>' +
    '<rect x="11" y="11" width="2" height="2" fill="#9bd1ff"/>' +
    '<rect x="5" y="5" width="6" height="6" fill="#9bd1ff"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="#ffffff"/>',

  // --- 8 Powerup Item Icons ---
  item_rpg:
    '<rect x="10" y="2" width="4" height="4" fill="#ff4d00"/>' +
    '<rect x="12" y="1" width="3" height="3" fill="#ffe600"/>' +
    '<rect x="8" y="4" width="4" height="4" fill="#556b2f"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="#6b8e23"/>' +
    '<rect x="4" y="8" width="4" height="4" fill="#556b2f"/>' +
    '<rect x="2" y="10" width="4" height="4" fill="#3a4a1f"/>' +
    '<rect x="1" y="12" width="3" height="3" fill="#ff9f1c"/>' +
    '<rect x="6" y="10" width="2" height="3" fill="#334155"/>',

  item_airstrike:
    '<rect x="7" y="1" width="2" height="10" fill="#e2e8f0"/>' +
    '<rect x="6" y="3" width="4" height="6" fill="#cbd5e1"/>' +
    '<rect x="2" y="6" width="12" height="2" fill="#94a3b8"/>' +
    '<rect x="4" y="5" width="8" height="2" fill="#e2e8f0"/>' +
    '<rect x="5" y="10" width="6" height="2" fill="#ff0054"/>' +
    '<rect x="7" y="3" width="2" height="2" fill="#38bdf8"/>' +
    '<rect x="7" y="12" width="2" height="3" fill="#ff4d00"/>' +
    '<rect x="6" y="13" width="4" height="1" fill="#ffd166"/>',

  item_sniper:
    '<rect x="7" y="0" width="2" height="4" fill="#00f5d4"/>' +
    '<rect x="7" y="12" width="2" height="4" fill="#00f5d4"/>' +
    '<rect x="0" y="7" width="4" height="2" fill="#00f5d4"/>' +
    '<rect x="12" y="7" width="4" height="2" fill="#00f5d4"/>' +
    '<rect x="4" y="2" width="8" height="2" fill="#00f5d4"/>' +
    '<rect x="4" y="12" width="8" height="2" fill="#00f5d4"/>' +
    '<rect x="2" y="4" width="2" height="8" fill="#00f5d4"/>' +
    '<rect x="12" y="4" width="2" height="8" fill="#00f5d4"/>' +
    '<rect x="7" y="7" width="2" height="2" fill="#ff2a54"/>',

  item_police:
    '<rect x="5" y="2" width="3" height="2" fill="#ef233c"/>' +
    '<rect x="8" y="2" width="3" height="2" fill="#3a86ff"/>' +
    '<rect x="3" y="4" width="10" height="4" fill="#f8fafc"/>' +
    '<rect x="4" y="5" width="8" height="2" fill="#1e293b"/>' +
    '<rect x="1" y="8" width="14" height="5" fill="#1d3557"/>' +
    '<rect x="4" y="9" width="8" height="2" fill="#f8fafc"/>' +
    '<rect x="2" y="9" width="2" height="2" fill="#ffd166"/>' +
    '<rect x="12" y="9" width="2" height="2" fill="#ffd166"/>' +
    '<rect x="2" y="13" width="3" height="2" fill="#0b0d14"/>' +
    '<rect x="11" y="13" width="3" height="2" fill="#0b0d14"/>',

  item_turbo:
    '<rect x="9" y="1" width="4" height="2" fill="#00f5d4"/>' +
    '<rect x="7" y="3" width="4" height="2" fill="#00f5d4"/>' +
    '<rect x="4" y="5" width="9" height="2" fill="#ffd166"/>' +
    '<rect x="2" y="7" width="11" height="2" fill="#ffe66d"/>' +
    '<rect x="7" y="9" width="5" height="2" fill="#ffd166"/>' +
    '<rect x="5" y="11" width="4" height="2" fill="#ff9f1c"/>' +
    '<rect x="3" y="13" width="4" height="2" fill="#ff4d00"/>' +
    '<rect x="6" y="7" width="4" height="1" fill="#ffffff"/>',

  item_trap:
    '<rect x="3" y="3" width="2" height="2" fill="#ef233c"/>' +
    '<rect x="7" y="2" width="2" height="3" fill="#ef233c"/>' +
    '<rect x="11" y="3" width="2" height="2" fill="#ef233c"/>' +
    '<rect x="3" y="5" width="2" height="5" fill="#cbd5e1"/>' +
    '<rect x="7" y="5" width="2" height="5" fill="#e2e8f0"/>' +
    '<rect x="11" y="5" width="2" height="5" fill="#cbd5e1"/>' +
    '<rect x="1" y="10" width="14" height="3" fill="#475569"/>' +
    '<rect x="2" y="11" width="12" height="1" fill="#94a3b8"/>' +
    '<rect x="2" y="13" width="12" height="1" fill="#1e293b"/>',

  item_magnet:
    '<rect x="2" y="2" width="4" height="3" fill="#e2e8f0"/>' +
    '<rect x="10" y="2" width="4" height="3" fill="#e2e8f0"/>' +
    '<rect x="2" y="5" width="4" height="6" fill="#e63946"/>' +
    '<rect x="10" y="5" width="4" height="6" fill="#9b5de5"/>' +
    '<rect x="3" y="11" width="10" height="3" fill="#c1121f"/>' +
    '<rect x="8" y="11" width="5" height="3" fill="#7209b7"/>' +
    '<rect x="6" y="1" width="1" height="2" fill="#00f5d4"/>' +
    '<rect x="9" y="1" width="1" height="2" fill="#00f5d4"/>',

  item_banana:
    '<rect x="9" y="1" width="2" height="3" fill="#78350f"/>' +
    '<rect x="7" y="4" width="4" height="3" fill="#ffe600"/>' +
    '<rect x="5" y="7" width="7" height="3" fill="#ffe600"/>' +
    '<rect x="3" y="10" width="5" height="3" fill="#ffd166"/>' +
    '<rect x="9" y="10" width="5" height="3" fill="#ffd166"/>' +
    '<rect x="1" y="12" width="4" height="2" fill="#f59e0b"/>' +
    '<rect x="11" y="12" width="4" height="2" fill="#f59e0b"/>' +
    '<rect x="6" y="6" width="2" height="2" fill="#ffffff"/>',

  // --- 5 Crossing Animal Icons ---
  animal_cow:
    '<rect x="2" y="2" width="2" height="3" fill="#e2e8f0"/>' +
    '<rect x="12" y="2" width="2" height="3" fill="#e2e8f0"/>' +
    '<rect x="3" y="4" width="10" height="6" fill="#ffffff"/>' +
    '<rect x="3" y="4" width="4" height="4" fill="#1e293b"/>' +
    '<rect x="10" y="5" width="3" height="3" fill="#1e293b"/>' +
    '<rect x="5" y="6" width="1" height="2" fill="#0b0d14"/>' +
    '<rect x="10" y="6" width="1" height="2" fill="#0b0d14"/>' +
    '<rect x="4" y="10" width="8" height="4" fill="#ffadad"/>' +
    '<rect x="5" y="11" width="2" height="1" fill="#7f1d1d"/>' +
    '<rect x="9" y="11" width="2" height="1" fill="#7f1d1d"/>',

  animal_sheep:
    '<rect x="4" y="2" width="8" height="3" fill="#f8fafc"/>' +
    '<rect x="2" y="4" width="12" height="7" fill="#ffffff"/>' +
    '<rect x="4" y="11" width="8" height="3" fill="#e2e8f0"/>' +
    '<rect x="2" y="6" width="2" height="3" fill="#334155"/>' +
    '<rect x="12" y="6" width="2" height="3" fill="#334155"/>' +
    '<rect x="5" y="6" width="6" height="6" fill="#334155"/>' +
    '<rect x="6" y="7" width="1" height="2" fill="#ffffff"/>' +
    '<rect x="9" y="7" width="1" height="2" fill="#ffffff"/>' +
    '<rect x="7" y="10" width="2" height="1" fill="#94a3b8"/>',

  animal_dog:
    '<rect x="2" y="2" width="3" height="4" fill="#b45309"/>' +
    '<rect x="11" y="2" width="3" height="4" fill="#b45309"/>' +
    '<rect x="3" y="4" width="10" height="8" fill="#f59e0b"/>' +
    '<rect x="5" y="9" width="6" height="4" fill="#fde68a"/>' +
    '<rect x="5" y="6" width="2" height="2" fill="#11131a"/>' +
    '<rect x="9" y="6" width="2" height="2" fill="#11131a"/>' +
    '<rect x="7" y="9" width="2" height="2" fill="#11131a"/>' +
    '<rect x="7" y="12" width="2" height="2" fill="#ef4444"/>',

  animal_boar:
    '<rect x="3" y="3" width="10" height="2" fill="#3b2216"/>' +
    '<rect x="2" y="5" width="12" height="7" fill="#5c3a28"/>' +
    '<rect x="5" y="7" width="2" height="2" fill="#ff2a54"/>' +
    '<rect x="9" y="7" width="2" height="2" fill="#ff2a54"/>' +
    '<rect x="5" y="10" width="6" height="3" fill="#8c5a44"/>' +
    '<rect x="2" y="8" width="2" height="4" fill="#ffffff"/>' +
    '<rect x="12" y="8" width="2" height="4" fill="#ffffff"/>' +
    '<rect x="6" y="11" width="1" height="1" fill="#1e100a"/>' +
    '<rect x="9" y="11" width="1" height="1" fill="#1e100a"/>',

  animal_goose:
    '<rect x="6" y="2" width="5" height="5" fill="#ffffff"/>' +
    '<rect x="10" y="1" width="2" height="2" fill="#fb8500"/>' +
    '<rect x="11" y="4" width="4" height="2" fill="#ff9f1c"/>' +
    '<rect x="8" y="3" width="1" height="1" fill="#11131a"/>' +
    '<rect x="6" y="7" width="3" height="3" fill="#ffffff"/>' +
    '<rect x="2" y="9" width="9" height="4" fill="#f8fafc"/>' +
    '<rect x="4" y="10" width="5" height="2" fill="#cbd5e1"/>' +
    '<rect x="5" y="13" width="2" height="2" fill="#ff9f1c"/>' +
    '<rect x="8" y="13" width="2" height="2" fill="#ff9f1c"/>',

  // --- 3 Melee Weapon Icons ---
  weapon_fist:
    '<rect x="3" y="3" width="10" height="7" fill="#ffbe8c"/>' +
    '<rect x="3" y="3" width="2" height="3" fill="#f29b68"/>' +
    '<rect x="6" y="3" width="1" height="3" fill="#b45309"/>' +
    '<rect x="9" y="3" width="1" height="3" fill="#b45309"/>' +
    '<rect x="11" y="3" width="1" height="3" fill="#b45309"/>' +
    '<rect x="2" y="6" width="3" height="4" fill="#f29b68"/>' +
    '<rect x="4" y="10" width="8" height="4" fill="#e63946"/>' +
    '<rect x="4" y="10" width="8" height="1" fill="#ffd166"/>',

  weapon_bat:
    '<rect x="10" y="2" width="4" height="4" fill="#d97706"/>' +
    '<rect x="8" y="4" width="4" height="4" fill="#f59e0b"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="#d97706"/>' +
    '<rect x="4" y="9" width="3" height="3" fill="#92400e"/>' +
    '<rect x="2" y="11" width="3" height="3" fill="#451a03"/>' +
    '<rect x="9" y="1" width="2" height="2" fill="#e2e8f0"/>' +
    '<rect x="13" y="4" width="2" height="2" fill="#e2e8f0"/>' +
    '<rect x="7" y="3" width="2" height="2" fill="#e2e8f0"/>' +
    '<rect x="11" y="6" width="2" height="2" fill="#e2e8f0"/>',

  weapon_chain:
    '<rect x="9" y="2" width="5" height="5" fill="#94a3b8"/>' +
    '<rect x="10" y="3" width="3" height="3" fill="#10141f"/>' +
    '<rect x="6" y="5" width="5" height="5" fill="#e2e8f0"/>' +
    '<rect x="7" y="6" width="3" height="3" fill="#10141f"/>' +
    '<rect x="3" y="8" width="5" height="5" fill="#94a3b8"/>' +
    '<rect x="4" y="9" width="3" height="3" fill="#10141f"/>' +
    '<rect x="1" y="11" width="4" height="4" fill="#cbd5e1"/>' +
    '<rect x="2" y="12" width="2" height="2" fill="#10141f"/>',

  walk:
    '<g fill="currentColor">' +
    '<rect x="6" y="1" width="4" height="3"/>' +
    '<rect x="5" y="5" width="6" height="4"/>' +
    '<rect x="3" y="6" width="2" height="3"/><rect x="11" y="6" width="2" height="3"/>' +
    '<rect x="5" y="9" width="2" height="4"/><rect x="9" y="9" width="2" height="4"/>' +
    '<rect x="4" y="13" width="2" height="2"/><rect x="10" y="13" width="2" height="2"/>' +
    '</g>',

  cube:
    '<rect x="4" y="1" width="8" height="2" fill="#72d160"/>' +
    '<rect x="2" y="3" width="12" height="3" fill="#52b046"/>' +
    '<rect x="2" y="6" width="6" height="7" fill="#c59052"/>' +
    '<rect x="8" y="6" width="6" height="7" fill="#8b6240"/>' +
    '<rect x="4" y="13" width="8" height="2" fill="#69462b"/>',

  pickaxe:
    '<rect x="4" y="1" width="8" height="2" fill="#38e2d4"/>' +
    '<rect x="2" y="3" width="4" height="2" fill="#38e2d4"/>' +
    '<rect x="10" y="3" width="4" height="2" fill="#38e2d4"/>' +
    '<rect x="7" y="3" width="2" height="3" fill="#c59052"/>' +
    '<rect x="6" y="6" width="2" height="3" fill="#9c6e3d"/>' +
    '<rect x="5" y="9" width="2" height="3" fill="#c59052"/>' +
    '<rect x="4" y="12" width="2" height="3" fill="#69462b"/>',

  road:
    '<g fill="currentColor">' +
    '<rect x="4" y="1" width="2" height="14"/><rect x="10" y="1" width="2" height="14"/>' +
    '<rect x="7" y="2" width="2" height="3"/><rect x="7" y="7" width="2" height="3"/>' +
    '<rect x="7" y="12" width="2" height="3"/>' +
    '</g>',

  server:
    '<g fill="currentColor">' +
    '<rect x="2" y="2" width="12" height="4"/>' +
    '<rect x="2" y="7" width="12" height="4"/>' +
    '<rect x="4" y="12" width="8" height="2"/>' +
    '<rect x="10" y="3" width="2" height="2" fill="#10141f"/>' +
    '<rect x="10" y="8" width="2" height="2" fill="#10141f"/>' +
    '</g>',

  user:
    '<g fill="currentColor">' +
    '<rect x="5" y="2" width="6" height="5"/>' +
    '<rect x="3" y="8" width="10" height="6"/>' +
    '</g>',

  coin:
    '<rect x="5" y="1" width="6" height="2" fill="#ffbe3b"/>' +
    '<rect x="3" y="3" width="10" height="10" fill="#ffbe3b"/>' +
    '<rect x="2" y="5" width="12" height="6" fill="#ffbe3b"/>' +
    '<rect x="5" y="13" width="6" height="2" fill="#d97706"/>' +
    '<rect x="4" y="3" width="8" height="2" fill="#ffe66d"/>' +
    '<rect x="4" y="5" width="2" height="6" fill="#fff5cc"/>' +
    '<rect x="7" y="4" width="2" height="8" fill="#b45309"/>' +
    '<rect x="8" y="4" width="1" height="8" fill="#ffe66d"/>' +
    '<rect x="11" y="5" width="2" height="6" fill="#d97706"/>',

  shop:
    '<rect x="1" y="2" width="14" height="3" fill="#ff3b5c"/>' +
    '<rect x="3" y="2" width="2" height="4" fill="#f8fafc"/>' +
    '<rect x="7" y="2" width="2" height="4" fill="#f8fafc"/>' +
    '<rect x="11" y="2" width="2" height="4" fill="#f8fafc"/>' +
    '<rect x="1" y="5" width="14" height="2" fill="#d62828"/>' +
    '<rect x="2" y="7" width="12" height="7" fill="#33415e"/>' +
    '<rect x="4" y="8" width="4" height="4" fill="#38e2d4"/>' +
    '<rect x="9" y="8" width="3" height="6" fill="#ffbe3b"/>' +
    '<rect x="1" y="14" width="14" height="1" fill="#1e293b"/>',

  shield:
    '<rect x="3" y="1" width="10" height="2" fill="#38e2d4"/>' +
    '<rect x="2" y="3" width="12" height="6" fill="#38e2d4"/>' +
    '<rect x="3" y="9" width="10" height="2" fill="#1ca8aa"/>' +
    '<rect x="4" y="11" width="8" height="2" fill="#1ca8aa"/>' +
    '<rect x="6" y="13" width="4" height="2" fill="#0e7490"/>' +
    '<rect x="4" y="3" width="8" height="6" fill="#0f172a"/>' +
    '<rect x="7" y="4" width="2" height="5" fill="#ffbe3b"/>' +
    '<rect x="5" y="6" width="6" height="2" fill="#ffbe3b"/>',

  terminal:
    '<rect x="1" y="2" width="14" height="10" fill="#475569"/>' +
    '<rect x="2" y="3" width="12" height="8" fill="#090c14"/>' +
    '<rect x="3" y="4" width="2" height="2" fill="#46d97c"/>' +
    '<rect x="5" y="6" width="2" height="2" fill="#46d97c"/>' +
    '<rect x="3" y="8" width="2" height="2" fill="#46d97c"/>' +
    '<rect x="8" y="8" width="4" height="2" fill="#38e2d4"/>' +
    '<rect x="6" y="12" width="4" height="2" fill="#33415e"/>' +
    '<rect x="4" y="14" width="8" height="1" fill="#64748b"/>',

  sparkle:
    '<rect x="7" y="1" width="2" height="4" fill="#ffbe3b"/>' +
    '<rect x="7" y="11" width="2" height="4" fill="#ffbe3b"/>' +
    '<rect x="1" y="7" width="4" height="2" fill="#ffbe3b"/>' +
    '<rect x="11" y="7" width="4" height="2" fill="#ffbe3b"/>' +
    '<rect x="5" y="5" width="6" height="6" fill="#ffe66d"/>' +
    '<rect x="7" y="7" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="2" y="2" width="2" height="2" fill="#38e2d4"/>' +
    '<rect x="12" y="12" width="2" height="2" fill="#38e2d4"/>',

  blueprint:
    '<rect x="2" y="1" width="12" height="14" fill="#1d4ed8"/>' +
    '<rect x="3" y="2" width="10" height="12" fill="#2563eb"/>' +
    '<rect x="4" y="4" width="8" height="1" fill="#e0f2fe"/>' +
    '<rect x="4" y="11" width="8" height="1" fill="#e0f2fe"/>' +
    '<rect x="4" y="4" width="1" height="8" fill="#e0f2fe"/>' +
    '<rect x="11" y="4" width="1" height="8" fill="#e0f2fe"/>' +
    '<rect x="6" y="6" width="4" height="1" fill="#38e2d4"/>' +
    '<rect x="6" y="8" width="2" height="3" fill="#ffbe3b"/>' +
    '<rect x="9" y="8" width="1" height="2" fill="#38e2d4"/>',

  bag:
    '<rect x="5" y="1" width="6" height="2" fill="#c89252"/>' +
    '<rect x="6" y="3" width="4" height="2" fill="#ffbe3b"/>' +
    '<rect x="3" y="5" width="10" height="2" fill="#a46c36"/>' +
    '<rect x="2" y="7" width="12" height="7" fill="#c89252"/>' +
    '<rect x="3" y="14" width="10" height="1" fill="#6f4b2d"/>' +
    '<rect x="6" y="7" width="4" height="3" fill="#ffbe3b"/>' +
    '<rect x="7" y="8" width="2" height="1" fill="#10131c"/>' +
    '<rect x="3" y="8" width="2" height="4" fill="#e0a967"/>',

  harvest:
    '<rect x="7" y="1" width="2" height="3" fill="#38e2d4"/>' +
    '<rect x="5" y="4" width="6" height="5" fill="#38e2d4"/>' +
    '<rect x="6" y="4" width="2" height="4" fill="#e0fffc"/>' +
    '<rect x="2" y="6" width="3" height="5" fill="#60b4ff"/>' +
    '<rect x="11" y="7" width="3" height="4" fill="#60b4ff"/>' +
    '<rect x="3" y="11" width="10" height="3" fill="#475569"/>' +
    '<rect x="4" y="14" width="8" height="1" fill="#1e293b"/>' +
    '<rect x="11" y="2" width="2" height="2" fill="#ffbe3b"/>',

  map:
    '<rect x="1" y="3" width="4" height="11" fill="#33415e"/>' +
    '<rect x="5" y="2" width="6" height="11" fill="#1e293b"/>' +
    '<rect x="11" y="3" width="4" height="11" fill="#33415e"/>' +
    '<rect x="2" y="4" width="3" height="9" fill="#46d97c"/>' +
    '<rect x="5" y="3" width="6" height="9" fill="#38a169"/>' +
    '<rect x="11" y="4" width="3" height="9" fill="#46d97c"/>' +
    '<rect x="2" y="8" width="3" height="3" fill="#38bdf8"/>' +
    '<rect x="5" y="9" width="4" height="2" fill="#38bdf8"/>' +
    '<rect x="6" y="3" width="2" height="9" fill="#ffbe3b"/>' +
    '<rect x="11" y="5" width="2" height="2" fill="#ff3b5c"/>' +
    '<rect x="12" y="5" width="1" height="1" fill="#ffffff"/>',

  pin:
    '<rect x="5" y="1" width="6" height="2" fill="#ff3b5c"/>' +
    '<rect x="3" y="3" width="10" height="5" fill="#ff3b5c"/>' +
    '<rect x="4" y="8" width="8" height="2" fill="#d62828"/>' +
    '<rect x="5" y="10" width="6" height="2" fill="#b91c1c"/>' +
    '<rect x="6" y="12" width="4" height="2" fill="#991b1b"/>' +
    '<rect x="7" y="14" width="2" height="1" fill="#7f1d1d"/>' +
    '<rect x="6" y="4" width="4" height="3" fill="#ffffff"/>' +
    '<rect x="7" y="5" width="2" height="1" fill="#ffd166"/>',

  teleport:
    '<rect x="5" y="1" width="6" height="2" fill="#38e2d4"/>' +
    '<rect x="3" y="3" width="10" height="10" fill="#7c3aed"/>' +
    '<rect x="2" y="5" width="12" height="6" fill="#8b5cf6"/>' +
    '<rect x="5" y="13" width="6" height="2" fill="#38e2d4"/>' +
    '<rect x="4" y="4" width="8" height="8" fill="#1e1b4b"/>' +
    '<rect x="5" y="5" width="6" height="6" fill="#38e2d4"/>' +
    '<rect x="6" y="6" width="4" height="4" fill="#c4b5fd"/>' +
    '<rect x="7" y="7" width="2" height="2" fill="#ffffff"/>' +
    '<rect x="1" y="2" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="13" y="12" width="2" height="2" fill="#ffbe3b"/>',

  intruder:
    '<rect x="4" y="1" width="8" height="2" fill="#ff3b5c"/>' +
    '<rect x="2" y="3" width="12" height="9" fill="#ff3b5c"/>' +
    '<rect x="3" y="4" width="10" height="7" fill="#1e1b2e"/>' +
    '<rect x="4" y="6" width="3" height="2" fill="#ffbe3b"/>' +
    '<rect x="9" y="6" width="3" height="2" fill="#ffbe3b"/>' +
    '<rect x="5" y="6" width="1" height="1" fill="#ffffff"/>' +
    '<rect x="10" y="6" width="1" height="1" fill="#ffffff"/>' +
    '<rect x="5" y="9" width="6" height="1" fill="#ff3b5c"/>' +
    '<rect x="3" y="12" width="10" height="2" fill="#b91c1c"/>' +
    '<rect x="7" y="13" width="2" height="2" fill="#ffbe3b"/>',

  avatarStudio:
    '<rect x="5" y="1" width="6" height="2" fill="#f472b6"/>' +
    '<rect x="4" y="3" width="8" height="5" fill="#fde68a"/>' +
    '<rect x="5" y="5" width="2" height="2" fill="#11131a"/>' +
    '<rect x="9" y="5" width="2" height="2" fill="#11131a"/>' +
    '<rect x="3" y="8" width="10" height="5" fill="#38e2d4"/>' +
    '<rect x="5" y="9" width="6" height="4" fill="#7c3aed"/>' +
    '<rect x="4" y="13" width="3" height="2" fill="#33415e"/>' +
    '<rect x="9" y="13" width="3" height="2" fill="#33415e"/>' +
    '<rect x="12" y="1" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="13" y="3" width="2" height="1" fill="#ffe66d"/>',

  camera:
    '<rect x="5" y="2" width="6" height="2" fill="#cbd5e1"/>' +
    '<rect x="1" y="4" width="14" height="10" fill="#cbd5e1"/>' +
    '<rect x="2" y="5" width="12" height="8" fill="#1e293b"/>' +
    '<rect x="11" y="5" width="2" height="2" fill="#ffbe3b"/>' +
    '<rect x="5" y="6" width="6" height="6" fill="#38e2d4"/>' +
    '<rect x="6" y="7" width="4" height="4" fill="#0f172a"/>' +
    '<rect x="6" y="7" width="2" height="2" fill="#e0fffc"/>' +
    '<rect x="3" y="6" width="1" height="2" fill="#ff3b5c"/>',
};

export const ITEM_ICON_MAP: Readonly<Record<ItemType, PixelIconId>> = {
  rpg: 'item_rpg',
  airstrike: 'item_airstrike',
  sniper: 'item_sniper',
  police: 'item_police',
  turbo: 'item_turbo',
  trap: 'item_trap',
  magnet: 'item_magnet',
  banana: 'item_banana',
};

export const ANIMAL_ICON_MAP: Readonly<Record<AnimalSpecies, PixelIconId>> = {
  cow: 'animal_cow',
  sheep: 'animal_sheep',
  dog: 'animal_dog',
  boar: 'animal_boar',
  goose: 'animal_goose',
};

export const WEAPON_ICON_MAP: Readonly<Record<WeaponType, PixelIconId>> = {
  0: 'weapon_fist',
  1: 'weapon_bat',
  2: 'weapon_chain',
};

export const WEATHER_ICON_MAP: Readonly<Record<WeatherId, PixelIconId>> = {
  clear: 'weather_clear',
  sunset: 'weather_sunset',
  storm: 'weather_storm',
  fog: 'weather_fog',
  snow: 'weather_snow',
};

const svgCache = new Map<string, string>();

/**
 * Returns a crisp 16x16 inline pixel-art SVG icon string (cached per id+className).
 */
export function getPixelIconSvg(id: PixelIconId, className?: string): string {
  const extra = className ? ` ${className.trim()}` : '';
  const key = extra ? `${id}|${extra}` : id;
  const cached = svgCache.get(key);
  if (cached) return cached;

  const body = ICON_BODIES[id] ?? '';
  const svg =
    `<svg class="vm-px-icon${extra}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">` +
    body +
    '</svg>';
  svgCache.set(key, svg);
  return svg;
}
