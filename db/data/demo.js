// Deterministic development-only demo accounts (password: SEED_PASSWORD in
// db/seeds/index.js). Used by the development seed and by
// `npm run db:demo`, which adds them to an existing database without a reset.

// Ten players with no team, for the recruitment screens. Some optional
// fields are deliberately missing.
exports.teamlessPlayers = [
  { email: 'demo-kestrel@cs-trainer.test', user_name: 'Kestrel', language: 'Polish', region: 'EU West', platform: 'FACEIT', skill_level: '9',
    bio: 'Entry fragger, loves Ancient and Inferno. Looking for a team that scrims three nights a week.',
    steam_url: 'https://steamcommunity.com/id/demo-kestrel', faceit_url: 'https://www.faceit.com/en/players/demo-kestrel' },
  { email: 'demo-mateo@cs-trainer.test', user_name: 'Mateo', language: 'Spanish (Spain)', region: 'EU West', platform: 'ESEA', skill_level: 'B+' },
  { email: 'demo-hana@cs-trainer.test', user_name: 'Hana', language: 'Japanese', region: 'Asia East', platform: 'Premier', skill_level: '21,400',
    bio: 'Support player. Utility first, frags second. Happy to IGL if needed.',
    hltv_url: 'https://www.hltv.org/player/0/demo-hana' },
  { email: 'demo-liam@cs-trainer.test', user_name: 'Liam', language: 'English', region: 'North America East', platform: 'FACEIT', skill_level: '10',
    bio: 'AWPer with 4k hours. Ex-ESEA Main.', faceit_url: 'https://www.faceit.com/en/players/demo-liam',
    esea_url: 'https://play.esea.net/users/demo-liam' },
  { email: 'demo-sofia@cs-trainer.test', user_name: 'Sofia', language: 'Portuguese (Brazil)', region: 'South America', platform: 'FACEIT', skill_level: '7' },
  { email: 'demo-noah@cs-trainer.test', user_name: 'Noah', language: 'German', region: 'EU West', platform: 'Premier', skill_level: '18,250',
    bio: 'Lurker. Calm comms, good with late-round info.', steam_url: 'https://steamcommunity.com/id/demo-noah' },
  { email: 'demo-priya@cs-trainer.test', user_name: 'Priya', language: 'English', region: 'Oceania', platform: 'FACEIT', skill_level: '6',
    steam_url: 'https://steamcommunity.com/profiles/76561190000000007' },
  { email: 'demo-yusuf@cs-trainer.test', user_name: 'Yusuf', language: 'Turkish', platform: 'FACEIT', skill_level: '8',
    bio: 'Rifler, flexible on roles.' },
  { email: 'demo-emma@cs-trainer.test', user_name: 'Emma', language: 'Swedish', region: 'EU West', platform: 'ESEA', skill_level: 'A',
    bio: 'Anchor on CT side, aggressive on T. Plays in an amateur league on Sundays.',
    steam_url: 'https://steamcommunity.com/id/demo-emma', faceit_url: 'https://www.faceit.com/en/players/demo-emma',
    esea_url: 'https://play.esea.net/users/demo-emma', hltv_url: 'https://www.hltv.org/player/0/demo-emma' },
  { email: 'demo-chen@cs-trainer.test', user_name: 'Chen', language: 'Chinese (Mandarin)', region: 'Asia East', platform: 'Perfect World', skill_level: '2,800' },
];

// The owner of the seeded "Test Team 1" (development seed only).
exports.testTeamOwner = {
  email: 'test-owner@cs-trainer.test', user_name: 'Test Owner', language: 'English', region: 'EU West', platform: 'FACEIT', skill_level: '8',
  bio: 'Owns Test Team 1. Use this account for the owner view.',
};

// Four teammates for Test Team 1. The first becomes IGL when the team has none.
exports.testTeammates = [
  { email: 'test-juno@cs-trainer.test', user_name: 'Juno', role: 'igl', fallbackRole: 'rifler', language: 'English', region: 'EU West', platform: 'FACEIT', skill_level: '9',
    bio: 'Test Team 1 IGL account.' },
  { email: 'test-vex@cs-trainer.test', user_name: 'Vex', role: 'entry', language: 'English', region: 'EU West', platform: 'FACEIT', skill_level: '8' },
  { email: 'test-morrow@cs-trainer.test', user_name: 'Morrow', role: 'support', language: 'French', region: 'EU West', platform: 'ESEA', skill_level: 'B' },
  { email: 'test-talon@cs-trainer.test', user_name: 'Talon', role: 'awper', language: 'Danish', region: 'EU West', platform: 'FACEIT', skill_level: '10',
    bio: 'Primary AWP.' },
];
