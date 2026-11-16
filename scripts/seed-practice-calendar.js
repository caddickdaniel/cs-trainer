// Fills the existing "Practice Roster" team's calendar with sample events and
// player availability, to show the Phase 10 calendar (`npm run db:sample-calendar`).
//
// - Only that team is touched; nothing existing is changed or removed.
// - Uses its current members (by name); no accounts are created.
// - Idempotent: availability carries a sample_key; events are matched by
//   title and start time, so running it again adds nothing.
// - Entries are marked as samples ("(sample)" in event titles, "Sample entry"
//   in availability notes) and are inserted directly, so no notifications are sent.
// - Dates are relative to the week of the first run (Monday-based), London time.
const db = require('../db/connection');

const TEAM_NAME = 'Practice Roster';
const TZ = 'Europe/London';

// Local London time -> instant (handles GMT/BST via Intl).
function londonInstant(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const offset = (() => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - guess;
  })();
  return new Date(guess - offset);
}
const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

async function main() {
  const team = await db('teams').where('team_name', TEAM_NAME).first('team_id');
  if (!team) throw new Error(`No team called "${TEAM_NAME}"`);
  const members = await db('team_memberships as m').join('users as u', 'u.user_id', 'm.user_id').where('m.team_id', team.team_id)
    .select('u.user_id', 'u.user_name', 'm.player_role');
  const byName = Object.fromEntries(members.map((m) => [m.user_name, m]));
  const lead = members.find((m) => m.player_role === 'igl') || members[0];
  // Monday of this week, fixed on first run (stored in the first sample key).
  const existing = await db('team_availability').where({ team_id: team.team_id }).whereNotNull('sample_key').first('sample_key');
  const today = new Date();
  const monday = existing ? existing.sample_key.split(':')[1] : addDays(today.toISOString().slice(0, 10), -((today.getUTCDay() + 6) % 7));
  const D = (n) => addDays(monday, n); // 0 = Monday this week

  // [day offset, player, status, from, until (null = all day), note]
  const availability = [
    [1, 'Sable', 'available', '18:00', '23:00', 'Free after work'],
    [1, 'Blitz', 'unavailable', '19:00', '21:00', 'Gym class'],
    [1, 'Wren', 'available', null, null, 'Day off'],
    [1, 'Onyx', 'available', '17:00', '22:00', ''],
    [2, 'Test Owner', 'available', null, null, ''],
    [2, 'Onyx', 'unavailable', null, null, 'Travelling'],
    [2, 'Blitz', 'available', '19:30', '23:30', ''],
    [3, 'Blitz', 'available', '17:00', '22:00', ''],
    [3, 'Sable', 'available', '18:00', '23:00', ''],
    [3, 'Wren', 'unavailable', '18:00', '20:00', 'Family dinner'],
    [3, 'Test Owner', 'available', '19:00', '23:00', ''],
    [4, 'Onyx', 'available', '20:00', '23:30', ''],
    [4, 'Test Owner', 'unavailable', null, null, 'Away for the weekend'],
    [4, 'Wren', 'available', '18:00', '22:00', ''],
    [5, 'Sable', 'available', null, null, ''],
    [5, 'Blitz', 'available', '14:00', '20:00', ''],
    [5, 'Wren', 'available', '15:00', '23:00', ''],
    [5, 'Test Owner', 'unavailable', null, null, 'Away for the weekend'],
    [6, 'Wren', 'unavailable', null, null, ''],
    [6, 'Blitz', 'available', '12:00', '16:00', ''],
    [6, 'Sable', 'available', '12:00', '18:00', ''],
    [7, 'Sable', 'unavailable', '19:00', '22:00', 'Late shift'],
    [7, 'Onyx', 'available', '18:00', '23:00', ''],
    [8, 'Test Owner', 'available', '18:00', '22:00', ''],
    [8, 'Onyx', 'available', '18:00', '22:00', ''],
    [8, 'Blitz', 'available', null, null, ''],
    [8, 'Wren', 'available', '19:00', '23:00', ''],
    [8, 'Sable', 'available', null, null, ''],
    [10, 'Blitz', 'unavailable', '18:00', '23:00', 'Exam revision'],
    [10, 'Wren', 'available', '17:00', '21:00', ''],
  ];
  // [day offset, kind, title, from, until, opponent, notes]
  const events = [
    [1, 'training', 'Aim and utility practice (sample)', '19:00', '21:00', null, 'Retake utility on A and B.'],
    [1, 'demo_review', 'Review last scrim (sample)', '21:30', '22:30', null, 'Mid control rounds.'],
    [2, 'game', 'League match (sample)', '20:00', '22:00', 'Northside Five', 'Best of one, Ancient.'],
    [3, 'training', 'Executes: Mirage A (sample)', '19:00', '21:00', null, 'Walk through the A execute, then live reps.'],
    [4, 'demo_review', 'Opponent review (sample)', '20:30', '21:30', null, 'Their T-side defaults.'],
    [5, 'training', 'Saturday practice (sample)', '15:00', '17:00', null, ''],
    [5, 'game', 'Cup qualifier (sample)', '18:00', '20:00', 'Red Kite', ''],
    [7, 'training', 'Anti-eco and force buys (sample)', '19:30', '21:30', null, ''],
    [8, 'training', 'Full scrim (sample)', '19:00', '21:00', null, ''],
    [8, 'demo_review', 'Scrim review (sample)', '21:15', '22:15', null, ''],
    [8, 'game', 'Late league match (sample)', '22:30', '23:59', 'Gale', ''],
  ];

  let added = 0;
  for (const [n, name, status, from, until, note] of availability) {
    const who = byName[name];
    if (!who) continue;
    const day = D(n);
    const key = `sample:${monday}:${n}:${name}:${status}:${from ?? 'all'}`;
    const allDay = from == null;
    const starts = allDay ? londonInstant(day, '00:00') : londonInstant(day, from);
    const ends = allDay ? londonInstant(addDays(day, 1), '00:00') : londonInstant(day, until);
    const res = await db('team_availability').insert({
      team_id: team.team_id, user_id: who.user_id, status, all_day: allDay, day, starts_at: starts, ends_at: ends, time_zone: TZ,
      note: note ? `${note} · Sample entry` : 'Sample entry', sample_key: key,
    }).onConflict(['team_id', 'sample_key']).ignore().returning('availability_id');
    added += res.length;
  }
  let addedEvents = 0;
  for (const [n, kind, title, from, until, opponent, notes] of events) {
    const day = D(n);
    const starts = londonInstant(day, from);
    const already = await db('team_events').where({ team_id: team.team_id, title }).where('starts_at', starts).first('event_id');
    if (already) continue;
    await db('team_events').insert({
      team_id: team.team_id, kind, title, starts_at: starts, ends_at: londonInstant(day, until), time_zone: TZ, opponent, notes,
      created_by: lead.user_id, updated_by: lead.user_id,
    });
    addedEvents += 1;
  }
  console.log(`${TEAM_NAME}: added ${added} availability entries and ${addedEvents} events (week of ${monday}).`);
}

main().then(() => process.exit(0), (err) => { console.error(err.message); process.exit(1); });
