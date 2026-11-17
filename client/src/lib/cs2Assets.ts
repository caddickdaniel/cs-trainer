// Authentic CS2 icons, extracted from the local game install by
// `npm run cs2:assets` into /assets/cs2 (gitignored: Valve artwork is not
// redistributed). Everything here degrades gracefully when the set is absent:
// callers get null and fall back to text or the app's own icons.
//
// The kill feed and the inventory use the same icons/equipment/<weapon> files
// in CS2, so one id maps to both. Self-contained (no runtime imports) so the
// server tests can load it.

export const CS2_ASSET_ROOT = '/assets/cs2';

const GROUP: Record<string, string> = {};
const groups: Record<string, string[]> = {
  pistols: ['glock', 'usp_silencer', 'hkp2000', 'p250', 'fiveseven', 'tec9', 'cz75a', 'deagle', 'revolver', 'elite'],
  smgs: ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'],
  rifles: ['ak47', 'm4a1', 'm4a1_silencer', 'famas', 'galilar', 'aug', 'sg556'],
  snipers: ['awp', 'ssg08', 'scar20', 'g3sg1'],
  heavy: ['nova', 'xm1014', 'mag7', 'sawedoff', 'm249', 'negev'],
  knives: ['knife', 'knife_t', 'bayonet', 'knife_bowie', 'knife_butterfly', 'knife_canis', 'knife_cord', 'knife_css', 'knife_falchion', 'knife_flip',
    'knife_gut', 'knife_gypsy_jackknife', 'knife_karambit', 'knife_kukri', 'knife_m9_bayonet', 'knife_outdoor', 'knife_push', 'knife_skeleton',
    'knife_stiletto', 'knife_survival_bowie', 'knife_tactical', 'knife_twinblade', 'knife_ursus', 'knife_widowmaker'],
};
for (const [g, ids] of Object.entries(groups)) for (const id of ids) GROUP[id] = g;
const UTILITY = new Set(['smokegrenade', 'flashbang', 'hegrenade', 'molotov', 'incgrenade', 'decoy', 'inferno', 'firebomb']);
const EQUIPMENT_KILL = new Set(['taser', 'c4', 'planted_c4']);
const SPECIAL = new Set(['prop_exploding_barrel', 'stomp_damage', 'melee']);
// Deaths CS2 shows without a weapon icon (blank in the game files).
const NO_ICON = new Set(['world', 'worldent', 'trigger_hurt']);

// Inventory / display names (demoparser2's inventory and active weapon) -> ids.
export const WEAPON_ID_BY_NAME: Record<string, string> = {
  'Glock-18': 'glock', 'USP-S': 'usp_silencer', P2000: 'hkp2000', P250: 'p250', 'Five-SeveN': 'fiveseven', 'Tec-9': 'tec9', 'CZ75-Auto': 'cz75a',
  'Desert Eagle': 'deagle', 'R8 Revolver': 'revolver', 'Dual Berettas': 'elite', 'MAC-10': 'mac10', MP9: 'mp9', MP7: 'mp7', 'MP5-SD': 'mp5sd',
  'UMP-45': 'ump45', P90: 'p90', 'PP-Bizon': 'bizon', 'AK-47': 'ak47', M4A4: 'm4a1', 'M4A1-S': 'm4a1_silencer', FAMAS: 'famas', 'Galil AR': 'galilar',
  AUG: 'aug', 'SG 553': 'sg556', AWP: 'awp', 'SSG 08': 'ssg08', 'SCAR-20': 'scar20', G3SG1: 'g3sg1', Nova: 'nova', XM1014: 'xm1014', 'MAG-7': 'mag7',
  'Sawed-Off': 'sawedoff', M249: 'm249', Negev: 'negev', 'Zeus x27': 'taser', 'C4 Explosive': 'c4', 'Smoke Grenade': 'smokegrenade', Flashbang: 'flashbang',
  'High Explosive Grenade': 'hegrenade', Molotov: 'molotov', 'Incendiary Grenade': 'incgrenade', 'Decoy Grenade': 'decoy',
};
const DISPLAY: Record<string, string> = Object.fromEntries(Object.entries(WEAPON_ID_BY_NAME).map(([n, id]) => [id, n]));
Object.assign(DISPLAY, { inferno: 'Fire', planted_c4: 'C4', knife: 'Knife', knife_t: 'Knife', world: 'World', trigger_hurt: 'Fall / world', prop_exploding_barrel: 'Barrel' });

// Normalises a weapon id from a kill event ("weapon_ak47", "ak47", "knife_karambit", "m4a1_silencer_off", ...).
export function weaponId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let id = raw.toLowerCase().replace(/^weapon_/, '');
  if (id === 'm4a1_silencer_off') id = 'm4a1_silencer';
  if (id === 'usp_silencer_off') id = 'usp_silencer';
  if (id === 'p2000') id = 'hkp2000';
  if (id === 'knifegg') id = 'knife';
  return id;
}
export const weaponIdFromName = (name: string | null | undefined) => (name ? WEAPON_ID_BY_NAME[name] ?? (/knife|karambit|bayonet|daggers/i.test(name) ? 'knife' : null) : null);

export function weaponLabel(raw: string | null | undefined) {
  const id = weaponId(raw);
  if (!id) return 'Unknown';
  return DISPLAY[id] ?? (GROUP[id] === 'knives' ? 'Knife' : id.replace(/_/g, ' '));
}

// Kill feed weapon icon path for an id; null for deaths CS2 shows without one
// (world, fall damage) and for unknown ids (shown as text instead).
export function killfeedIcon(raw: string | null | undefined): string | null {
  const id = weaponId(raw);
  if (!id || NO_ICON.has(id)) return null;
  if (GROUP[id] || UTILITY.has(id) || EQUIPMENT_KILL.has(id)) return `${CS2_ASSET_ROOT}/killfeed/weapons/${id}.svg`;
  if (SPECIAL.has(id)) return `${CS2_ASSET_ROOT}/killfeed/special/${id}.svg`;
  if (id.startsWith('knife') || id === 'bayonet') return `${CS2_ASSET_ROOT}/killfeed/weapons/knife.svg`;
  return null;
}
export function inventoryIcon(raw: string | null | undefined): string | null {
  const id = weaponId(raw);
  if (!id) return null;
  if (GROUP[id]) return `${CS2_ASSET_ROOT}/weapons/${GROUP[id]}/${id}.svg`;
  if (UTILITY.has(id)) return `${CS2_ASSET_ROOT}/utility/${id}.svg`;
  if (EQUIPMENT_KILL.has(id)) return `${CS2_ASSET_ROOT}/equipment/${id}.svg`;
  return null;
}
// Carried grenades (replay utility codes) -> CS2 icon ids.
export const UTILITY_ASSET: Record<string, string> = { he: 'hegrenade', flash: 'flashbang', smoke: 'smokegrenade', molly: 'molotov', inc: 'incgrenade', decoy: 'decoy' };

export const cs2 = (path: string) => `${CS2_ASSET_ROOT}/${path}`;
export const KILLFEED_INDICATOR = {
  headshot: cs2('killfeed/indicators/headshot.svg'), penetrate: cs2('killfeed/indicators/penetrate.svg'), noscope: cs2('killfeed/indicators/noscope.svg'),
  smoke: cs2('killfeed/indicators/smoke_kill.svg'), blind: cs2('killfeed/indicators/blind_kill.svg'), suicide: cs2('killfeed/indicators/suicide.svg'),
  inair: cs2('killfeed/indicators/inairkill.svg'), flashAssist: cs2('killfeed/indicators/flashbang_assist.svg'),
};

// ---- Shared utility / equipment icons (Phase 10) --------------------------------
// One mapping for every utility identifier used in the app (tactic markers
// 'smoke' | 'flash' | 'he' | 'molly', replay events 'fire' with a variant,
// carried-grenade codes 'inc' | 'decoy', game ids 'smokegrenade' …), so the
// same utility shows the same CS2 icon in Demo Review, Game Mode and Tactics.
// `molly` follows the side: T throw molotovs, CT throw incendiaries.
export type UtilityId = 'smokegrenade' | 'flashbang' | 'hegrenade' | 'molotov' | 'incgrenade' | 'decoy' | 'c4' | 'defuser' | 'kevlar' | 'helmet' | 'assaultsuit';
const UTILITY_ALIAS: Record<string, UtilityId> = {
  smoke: 'smokegrenade', smokegrenade: 'smokegrenade', flash: 'flashbang', flashbang: 'flashbang', he: 'hegrenade', hegrenade: 'hegrenade', grenade: 'hegrenade',
  molotov: 'molotov', inc: 'incgrenade', incgrenade: 'incgrenade', incendiary: 'incgrenade', decoy: 'decoy',
  c4: 'c4', bomb: 'c4', kit: 'defuser', defuser: 'defuser', armor: 'kevlar', kevlar: 'kevlar', helmet: 'helmet', armor_helmet: 'assaultsuit', assaultsuit: 'assaultsuit',
};
export function utilityId(kind: string | null | undefined, opts: { side?: string | null; variant?: string | null } = {}): UtilityId | null {
  if (!kind) return null;
  const k = kind.toLowerCase().replace(/^weapon_/, '');
  if (k === 'molly' || k === 'fire' || k === 'inferno') {
    if (opts.variant) return opts.variant === 'incendiary' ? 'incgrenade' : 'molotov';
    return opts.side === 'CT' ? 'incgrenade' : 'molotov';
  }
  return UTILITY_ALIAS[k] ?? null;
}
const UTILITY_FOLDER: Record<UtilityId, string> = {
  smokegrenade: 'utility', flashbang: 'utility', hegrenade: 'utility', molotov: 'utility', incgrenade: 'utility', decoy: 'utility',
  c4: 'equipment', defuser: 'equipment', kevlar: 'equipment', helmet: 'equipment', assaultsuit: 'equipment',
};
export const UTILITY_NAME: Record<UtilityId, string> = {
  smokegrenade: 'Smoke grenade', flashbang: 'Flashbang', hegrenade: 'HE grenade', molotov: 'Molotov', incgrenade: 'Incendiary grenade', decoy: 'Decoy grenade',
  c4: 'C4', defuser: 'Defuse kit', kevlar: 'Kevlar', helmet: 'Helmet', assaultsuit: 'Kevlar and helmet',
};
// The extracted CS2 icon (white, transparent); null if unmapped.
export const utilityIconSrc = (id: UtilityId | null) => (id ? `${CS2_ASSET_ROOT}/${UTILITY_FOLDER[id]}/${id}.svg` : null);
// The app's own (black) icons, used when the CS2 set isn't built.
const LEGACY: Partial<Record<UtilityId, string>> = {
  smokegrenade: '/icons/utility/smoke.png', flashbang: '/icons/utility/flash.png', hegrenade: '/icons/utility/he.png',
  molotov: '/icons/utility/molly.png', incgrenade: '/icons/utility/molly.png', c4: '/icons/bomb.png', defuser: '/icons/defuse-kit.png',
};
export const utilityLegacySrc = (id: UtilityId | null) => (id ? LEGACY[id] ?? null : null);
