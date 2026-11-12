// The one catalogue of profile options: languages, regions, platforms and
// self-reported recruitment ranks. Used by validation, player search, the
// legacy-value migration and (via GET /api/catalogue) the client's dropdowns,
// filters and rank badges.
//
// Rank bands are inclusive on both ends; every value maps to exactly one band.

const LANGUAGES = [
  'Arabic', 'Bengali', 'Bulgarian', 'Chinese (Mandarin)', 'Chinese (Cantonese)', 'Croatian', 'Czech', 'Danish', 'Dutch',
  'English', 'Estonian', 'Finnish', 'French', 'German', 'Greek', 'Hebrew', 'Hindi', 'Hungarian', 'Indonesian', 'Italian',
  'Japanese', 'Kazakh', 'Korean', 'Latvian', 'Lithuanian', 'Malay', 'Mongolian', 'Norwegian', 'Polish',
  'Portuguese (Brazil)', 'Portuguese (Portugal)', 'Romanian', 'Russian', 'Serbian', 'Slovak', 'Slovenian',
  'Spanish (Latin America)', 'Spanish (Spain)', 'Swedish', 'Thai', 'Turkish', 'Ukrainian', 'Vietnamese',
];

const REGIONS = [
  'EU West', 'EU North', 'EU East', 'EU South', 'UK & Ireland', 'CIS', 'Middle East', 'Africa',
  'North America East', 'North America Central', 'North America West', 'South America', 'Central America',
  'Asia East', 'Asia Southeast', 'Asia South', 'Oceania',
];

const PLATFORMS = [
  { id: 'premier', label: 'Premier' },
  { id: 'faceit', label: 'FACEIT' },
  { id: 'esea', label: 'ESEA' },
];

// Badge colours (original badges; not official artwork).
const COLOR = {
  green: '#3fb950', amber: '#e3a325', silver: '#b8c1cc', gold: '#f2c94c', red: '#e5484d', blue: '#5b9cf5',
  grey: '#a3abb7', lightblue: '#8ecbff', deepblue: '#4f7cff', purple: '#a66cff', pink: '#f472d0', premierRed: '#ff4d5e', premierGold: '#ffc83d',
};

const band = (platform, key, label, min, max, color, extra = {}) => ({
  id: `${platform}:${key}`, platform, label, min, max, color, ...extra,
});

// ESEA legacy letter ranks (self-reported).
const ESEA = [
  ['d-', 'D−', 0, 499, COLOR.green], ['d', 'D', 500, 999, COLOR.green], ['d+', 'D+', 1000, 1499, COLOR.green],
  ['c-', 'C−', 1500, 1999, COLOR.amber], ['c', 'C', 2000, 2499, COLOR.amber], ['c+', 'C+', 2500, 2999, COLOR.amber],
  ['b-', 'B−', 3000, 3499, COLOR.silver], ['b', 'B', 3500, 3999, COLOR.silver], ['b+', 'B+', 4000, 4499, COLOR.silver],
  ['a-', 'A−', 4500, 4999, COLOR.gold], ['a', 'A', 5000, 5499, COLOR.gold], ['a+', 'A+', 5500, 6249, COLOR.gold],
  ['g', 'G', 6250, 7499, COLOR.red], ['s', 'S', 7500, null, COLOR.blue],
].map(([k, label, min, max, color]) => band('esea', k, label, min, max, color, { short: label, unit: 'rating' }));

// FACEIT levels by Elo. Level 10 is split into Elo bands; exactly 3,000 is in
// 2,751–3,000. Challenger is a leaderboard distinction (top 1,000), never
// derived from Elo.
const FACEIT_LEVEL_COLOR = ['#eeeeee', '#1ce400', '#1ce400', '#ffc800', '#ffc800', '#ffc800', '#ffc800', '#ff6309', '#ff6309', '#fe1f00'];
const FACEIT = [
  [1, 100, 500], [2, 501, 750], [3, 751, 900], [4, 901, 1050], [5, 1051, 1200],
  [6, 1201, 1350], [7, 1351, 1530], [8, 1531, 1750], [9, 1751, 2000],
].map(([level, min, max]) => band('faceit', String(level), `Level ${level}`, min, max, FACEIT_LEVEL_COLOR[level - 1], { short: String(level), level, unit: 'Elo' }))
  .concat([[2001, 2250], [2251, 2500], [2501, 2750], [2751, 3000], [3001, null]].map(([min, max]) => band(
    'faceit', `10-${min}`, `Level 10 (${min.toLocaleString('en-GB')}${max ? `–${max.toLocaleString('en-GB')}` : '+'} Elo)`,
    min, max, FACEIT_LEVEL_COLOR[9], { short: '10', level: 10, unit: 'Elo' },
  )))
  .concat([band('faceit', 'challenger', 'Challenger (top 1,000)', null, null, '#ff8a00', { short: 'C', leaderboard: true, unit: 'Elo' })]);

// Premier CS Rating in 2,500-point bands; 30,000+ is gold.
const PREMIER_COLORS = [COLOR.grey, COLOR.grey, COLOR.lightblue, COLOR.lightblue, COLOR.deepblue, COLOR.deepblue,
  COLOR.purple, COLOR.purple, COLOR.pink, COLOR.pink, COLOR.premierRed, COLOR.premierRed];
const PREMIER_COLOR_NAMES = ['Grey', 'Grey', 'Light blue', 'Light blue', 'Blue', 'Blue', 'Purple', 'Purple', 'Pink', 'Pink', 'Red', 'Red'];
const fmt = (n) => n.toLocaleString('en-GB');
const PREMIER = PREMIER_COLORS.map((color, i) => band('premier', String(i * 2500), `${fmt(i * 2500)}–${fmt(i * 2500 + 2499)}`,
  i * 2500, i * 2500 + 2499, color, { short: `${Math.floor(i * 2.5)}K`, colorName: PREMIER_COLOR_NAMES[i], unit: 'CS Rating' }))
  .concat([band('premier', '30000', '30,000+', 30000, null, COLOR.premierGold, { short: '30K', colorName: 'Gold', unit: 'CS Rating' })]);

const RANKS = [...PREMIER, ...FACEIT, ...ESEA];
const RANK_BY_ID = new Map(RANKS.map((r) => [r.id, r]));

const ranksFor = (platform) => RANKS.filter((r) => r.platform === platform);
const findRank = (id) => RANK_BY_ID.get(id) || null;
const isValidRank = (platform, rankId) => {
  const r = findRank(rankId);
  return Boolean(r && r.platform === platform);
};

// The single band containing a numeric value (Elo, rating or CS Rating).
// Never returns leaderboard distinctions such as FACEIT Challenger.
function rankForValue(platform, value) {
  if (!Number.isFinite(value) || value < 0) return null;
  const n = Math.floor(value);
  return ranksFor(platform).find((r) => !r.leaderboard && r.min != null && n >= r.min && (r.max == null || n <= r.max)) || null;
}

const norm = (s) => String(s || '').trim().toLowerCase();
const matchOption = (list, value) => list.find((o) => norm(o) === norm(value)) || null;

// Maps a legacy free-text platform + skill pair to the catalogue when that can
// be done confidently; otherwise returns null and the text is kept as legacy.
function mapLegacyRank(platformText, skillText) {
  const p = norm(platformText);
  const s = norm(skillText).replace(/[,\s]/g, '');
  const platform = /premier|valve|matchmaking|^mm$/.test(p) ? 'premier' : /faceit/.test(p) ? 'faceit' : /esea/.test(p) ? 'esea' : null;
  if (!platform || !s) return platform ? { platform, rank: null } : null;
  if (platform === 'faceit') {
    const lvl = s.match(/^(?:level|lvl|lv)?(\d{1,2})$/);
    if (lvl && Number(lvl[1]) >= 1 && Number(lvl[1]) <= 9) return { platform, rank: `faceit:${lvl[1]}` };
    if (/^\d{3,4}(elo)?$/.test(s)) {
      const r = rankForValue('faceit', Number(s.replace('elo', '')));
      return r ? { platform, rank: r.id } : { platform, rank: null };
    }
    return { platform, rank: null };
  }
  if (platform === 'premier') {
    const k = s.match(/^(\d{1,2}(?:\.\d)?)k$/);
    const num = k ? Number(k[1]) * 1000 : /^\d{1,5}$/.test(s) ? Number(s) : NaN;
    const r = rankForValue('premier', num);
    return { platform, rank: r ? r.id : null };
  }
  const letter = s.replace('−', '-').match(/^([a-dgs])([+-]?)$/);
  if (letter) {
    const id = `esea:${letter[1]}${letter[2]}`;
    return { platform, rank: findRank(id) ? id : null };
  }
  if (/^\d{1,5}$/.test(s)) {
    const r = rankForValue('esea', Number(s));
    return { platform, rank: r ? r.id : null };
  }
  return { platform, rank: null };
}

const catalogue = () => ({ languages: LANGUAGES, regions: REGIONS, platforms: PLATFORMS, ranks: RANKS });

module.exports = {
  LANGUAGES, REGIONS, PLATFORMS, RANKS, PLATFORM_IDS: PLATFORMS.map((p) => p.id),
  ranksFor, findRank, isValidRank, rankForValue, mapLegacyRank, matchOption, catalogue,
};
