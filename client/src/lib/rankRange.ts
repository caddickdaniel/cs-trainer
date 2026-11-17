// Display formatting for a team's rank requirement (one platform, an exact
// band or a range of bands). The stored requirement keeps its original band
// ids for editing and filtering; this only decides how it reads.
//
// A range is shown as one span from the minimum of its first band to the
// maximum of its last band, e.g. FACEIT Level 10 (2,001–2,250) to Level 10
// (2,251–2,500) reads "[10] FACEIT (2,001–2,500)". Bounds come only from the
// catalogue: open-ended bands read "3,001+" and leaderboard-only ranks
// (FACEIT Challenger) are named, never given numbers.
//
// Self-contained (type imports only) so the server tests can load it.
import type { Rank } from './catalogue';

export interface RequirementDisplay {
  /** Badges to draw: one when both ends share a badge, otherwise first and last. */
  badges: Rank[];
  platform: string;
  /** The bracketed range, without the platform name. */
  range: string;
  /** Platform plus range, e.g. "FACEIT (2,001–2,500)" or "FACEIT Challenger (top 1,000)". */
  text: string;
  /** Full wording for screen readers and tooltips. */
  label: string;
}

const fmt = (n: number) => n.toLocaleString('en-GB');
const sameBadge = (a: Rank, b: Rank) => a.short === b.short && a.color === b.color;

function rangeOf(lo: Rank, hi: Rank): { range: string; spoken: string } {
  const unit = lo.unit ? ` ${lo.unit}` : '';
  if (lo.leaderboard) return { range: hi.label, spoken: hi.label };
  if (lo.min == null) return { range: lo.id === hi.id ? lo.label : `${lo.label}–${hi.label}`, spoken: lo.id === hi.id ? lo.label : `${lo.label} to ${hi.label}` };
  if (hi.leaderboard) {
    // A numeric band up to a leaderboard rank: no invented upper number.
    return { range: `${fmt(lo.min)}+ to ${hi.label.replace(/\s*\(.*\)$/, '')}`, spoken: `${fmt(lo.min)}${unit} or more` };
  }
  if (hi.max == null) return { range: `${fmt(lo.min)}+`, spoken: `${fmt(lo.min)}${unit} or more` };
  return { range: `${fmt(lo.min)}–${fmt(hi.max)}`, spoken: `${fmt(lo.min)} to ${fmt(hi.max)}${unit}` };
}

export function formatRequirement(
  ranks: Rank[], platformName: string, req: { min: string; max: string },
): RequirementDisplay | null {
  const lo = ranks.find((r) => r.id === req.min);
  const hi = ranks.find((r) => r.id === req.max);
  if (!lo || !hi) return null;
  const { range, spoken } = rangeOf(lo, hi);
  const badges = sameBadge(lo, hi) ? [lo] : [lo, hi];
  const nameOf = (r: Rank) => (r.platform === 'premier' ? '' : r.leaderboard ? r.label : r.label.replace(/\s*\(.*\)$/, ''));
  const names = [...new Set([nameOf(lo), nameOf(hi)])].filter(Boolean).join(' to ');
  const numeric = !lo.leaderboard && lo.min != null;
  const label = `${platformName}${names ? ` ${names}` : ''}${numeric ? `, ${spoken}` : ''}`;
  return { badges, platform: platformName, range, text: numeric ? `${platformName} (${range})` : `${platformName} ${range}`, label };
}
