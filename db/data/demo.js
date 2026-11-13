// Deterministic development-only demo data (password for every account:
// SEED_PASSWORD in db/seeds/index.js). Used by the development seed and by
// `npm run db:demo`, which adds or refreshes it in an existing database
// without deleting anything (see db/lib/demo.js and README "Demo data").
//
// Ranks use the current model: one optional rank per platform, stored in
// users.premier_rank / faceit_rank / esea_rank (catalogue ids). `legacy` is
// free text from before rank options existed, kept for review.
// All emails use the reserved .test domain.

// Teamless recruits for Player Search and invites. Covers all three ranks,
// partial ranks, no rank, a legacy-only entry, and varied languages/regions.
exports.teamlessPlayers = [
  { email: 'demo-kestrel@cs-trainer.test', user_name: 'Kestrel', language: 'Polish', region: 'EU East',
    ranks: { premier: 'premier:17500', faceit: 'faceit:9', esea: 'esea:a-' },
    bio: 'Entry fragger, loves Ancient and Inferno. Looking for a team that scrims three nights a week.',
    steam_url: 'https://steamcommunity.com/id/demo-kestrel', faceit_url: 'https://www.faceit.com/en/players/demo-kestrel' },
  { email: 'demo-mateo@cs-trainer.test', user_name: 'Mateo', language: 'Spanish (Spain)', region: 'EU South',
    ranks: { faceit: 'faceit:7', esea: 'esea:b+' }, bio: 'Support. Learns lineups fast.' },
  { email: 'demo-hana@cs-trainer.test', user_name: 'Hana', language: 'Japanese', region: 'Asia East',
    ranks: { premier: 'premier:20000' },
    bio: 'Support player. Utility first, frags second. Happy to IGL if needed.', hltv_url: 'https://www.hltv.org/player/0/demo-hana' },
  { email: 'demo-liam@cs-trainer.test', user_name: 'Liam', language: 'English', region: 'North America East',
    ranks: { premier: 'premier:25000', faceit: 'faceit:10-2501', esea: 'esea:a+' },
    bio: 'AWPer with 4k hours. Ex-ESEA Main.', faceit_url: 'https://www.faceit.com/en/players/demo-liam', esea_url: 'https://play.esea.net/users/demo-liam' },
  { email: 'demo-sofia@cs-trainer.test', user_name: 'Sofia', language: 'Portuguese (Brazil)', region: 'South America',
    ranks: { premier: 'premier:12500', faceit: 'faceit:7' } },
  { email: 'demo-noah@cs-trainer.test', user_name: 'Noah', language: 'German', region: 'EU West',
    ranks: { premier: 'premier:17500' }, bio: 'Lurker. Calm comms, good with late-round info.', steam_url: 'https://steamcommunity.com/id/demo-noah' },
  { email: 'demo-priya@cs-trainer.test', user_name: 'Priya', language: 'Hindi', region: 'Oceania',
    ranks: { faceit: 'faceit:6' }, steam_url: 'https://steamcommunity.com/profiles/76561190000000007' },
  { email: 'demo-yusuf@cs-trainer.test', user_name: 'Yusuf', language: 'Turkish', region: 'Middle East',
    ranks: { faceit: 'faceit:8', esea: 'esea:b' }, bio: 'Rifler, flexible on roles.' },
  { email: 'demo-emma@cs-trainer.test', user_name: 'Emma', language: 'Swedish', region: 'EU North',
    ranks: { premier: 'premier:22500', faceit: 'faceit:10-2001', esea: 'esea:a' },
    bio: 'Anchor on CT side, aggressive on T. Plays in an amateur league on Sundays.',
    steam_url: 'https://steamcommunity.com/id/demo-emma', faceit_url: 'https://www.faceit.com/en/players/demo-emma',
    esea_url: 'https://play.esea.net/users/demo-emma', hltv_url: 'https://www.hltv.org/player/0/demo-emma' },
  // Legacy only: a platform the catalogue doesn't cover.
  { email: 'demo-chen@cs-trainer.test', user_name: 'Chen', language: 'Chinese (Mandarin)', region: 'Asia East',
    ranks: {}, legacy: { platform: 'Perfect World', skill_level: '2,800' } },
  { email: 'demo-amira@cs-trainer.test', user_name: 'Amira', language: 'Arabic', region: 'Middle East',
    ranks: { premier: 'premier:15000', esea: 'esea:c+' }, bio: 'Entry/second entry. Arabic and English comms.' },
  { email: 'demo-oskar@cs-trainer.test', user_name: 'Oskar', language: 'Norwegian', region: 'EU North',
    ranks: { faceit: 'faceit:10-2251' }, bio: 'IGL looking for a structured team.' },
  { email: 'demo-lucia@cs-trainer.test', user_name: 'Lucia', language: 'Italian', region: 'EU South',
    ranks: { premier: 'premier:10000', faceit: 'faceit:5', esea: 'esea:c' } },
  { email: 'demo-dmitri@cs-trainer.test', user_name: 'Dmitri', language: 'Russian', region: 'CIS',
    ranks: { premier: 'premier:27500', faceit: 'faceit:challenger' }, bio: 'AWP. Top 1,000 FACEIT.' },
  { email: 'demo-grace@cs-trainer.test', user_name: 'Grace', language: 'English', region: 'UK & Ireland',
    ranks: { esea: 'esea:b-' }, bio: 'Support who enjoys anchoring B.' },
  // No ranks at all.
  { email: 'demo-tomas@cs-trainer.test', user_name: 'Tomás', language: 'Spanish (Latin America)', region: 'Central America', ranks: {} },
];

// The five-player test roster with sign-in accounts: an owner, an IGL and
// three teammates. `role` is the in-team role.
exports.testRoster = {
  team: {
    team_name: 'Practice Roster', language: 'English', region: 'EU West',
    description: 'Development roster for testing tactics, Game Mode and Demo Review.',
    is_recruiting: true, roles_needed: ['awper'], recruiting_notes: 'Looking for a sixth to rotate in on AWP.',
    rank_requirements: [
      { platform: 'faceit', min: 'faceit:7', max: 'faceit:10-2001' },
      { platform: 'premier', min: 'premier:15000', max: 'premier:22500' },
    ],
    competitions: ['esea-league', 'faceit-mm'],
  },
  players: [
    { email: 'test-owner@cs-trainer.test', user_name: 'Test Owner', owner: true, role: 'rifler', language: 'English', region: 'EU West',
      ranks: { premier: 'premier:20000', faceit: 'faceit:8', esea: 'esea:b+' }, bio: 'Owns Practice Roster. Use this account for the owner view.' },
    { email: 'test-igl@cs-trainer.test', user_name: 'Sable', role: 'igl', language: 'English', region: 'UK & Ireland',
      ranks: { premier: 'premier:17500', faceit: 'faceit:9' }, bio: 'Practice Roster IGL account (controls Game Mode and live reviews).' },
    { email: 'test-blitz@cs-trainer.test', user_name: 'Blitz', role: 'entry', language: 'Dutch', region: 'EU West',
      ranks: { faceit: 'faceit:8' } },
    { email: 'test-wren@cs-trainer.test', user_name: 'Wren', role: 'support', language: 'French', region: 'EU West',
      ranks: { esea: 'esea:b' } },
    { email: 'test-onyx@cs-trainer.test', user_name: 'Onyx', role: 'lurker', language: 'Danish', region: 'EU North',
      ranks: { premier: 'premier:22500', faceit: 'faceit:10-2001', esea: 'esea:a-' }, bio: 'Lurker, backup AWP.' },
  ],
};

// Recruiting teams for the recruiting listing and join requests. Each has an
// owner account and requirements on several platforms.
exports.recruitingTeams = [
  { team_name: 'Northern Lights', language: 'English', region: 'EU North',
    owner: { email: 'demo-owner-lights@cs-trainer.test', user_name: 'Freya', language: 'Swedish', region: 'EU North', ranks: { faceit: 'faceit:9', premier: 'premier:20000' } },
    roles_needed: ['awper', 'support'], recruiting_notes: 'Three scrims a week, 19:00 CET.',
    rank_requirements: [
      { platform: 'faceit', min: 'faceit:8', max: 'faceit:10-2251' },
      { platform: 'premier', min: 'premier:17500', max: 'premier:25000' },
    ],
    competitions: ['esea-league', 'premier'],
    description: 'Nordic team aiming for ESEA Advanced.' },
  { team_name: 'Lion Pride', language: 'English', region: 'UK & Ireland',
    owner: { email: 'demo-owner-pride@cs-trainer.test', user_name: 'Rory', language: 'English', region: 'UK & Ireland', ranks: { esea: 'esea:b+', premier: 'premier:15000' } },
    roles_needed: ['entry'], recruiting_notes: 'Playing UKIC League this season.',
    rank_requirements: [
      { platform: 'esea', min: 'esea:b-', max: 'esea:a' },
      { platform: 'premier', min: 'premier:12500', max: 'premier:12500' },
    ],
    competitions: ['ukic-league', 'esea-mm'],
    description: 'UK amateur team.' },
  { team_name: 'Pampas Five', language: 'Portuguese (Brazil)', region: 'South America',
    owner: { email: 'demo-owner-pampas@cs-trainer.test', user_name: 'Bruno', language: 'Portuguese (Brazil)', region: 'South America', ranks: { faceit: 'faceit:7' } },
    roles_needed: ['igl', 'lurker'], recruiting_notes: 'Portuguese comms only.',
    rank_requirements: [
      { platform: 'faceit', min: 'faceit:5', max: 'faceit:8' },
      { platform: 'premier', min: 'premier:10000', max: 'premier:17500' },
      { platform: 'esea', min: 'esea:c', max: 'esea:b+' },
    ],
    competitions: ['faceit-mm', 'premier'],
    description: 'Casual-competitive team from São Paulo.' },
  { team_name: 'Iron Circuit', language: 'German', region: 'EU West',
    owner: { email: 'demo-owner-circuit@cs-trainer.test', user_name: 'Jonas', language: 'German', region: 'EU West', ranks: { premier: 'premier:22500', faceit: 'faceit:10-2001', esea: 'esea:a' } },
    roles_needed: ['anchor'], recruiting_notes: 'Experienced players only; demo reviews every Sunday.',
    rank_requirements: [
      { platform: 'premier', min: 'premier:20000', max: 'premier:30000' },
      { platform: 'faceit', min: 'faceit:10-2001', max: 'faceit:challenger' },
    ],
    competitions: ['esea-league', 'faceit-mm', 'premier'],
    description: 'German team in ESEA League.' },
];
