import type { Catalogue, Rank } from '../lib/catalogue';
import { findRank, platformLabel } from '../lib/catalogue';

// Original rank badges (not official artwork) in each platform's colours,
// always with a readable text label.
export function RankShape({ rank }: { rank: Rank }) {
  const c = rank.color;
  if (rank.platform === 'faceit') {
    // Circular level gauge.
    const level = rank.leaderboard ? 10 : rank.level ?? 1;
    const frac = level / 10;
    const r = 10;
    const len = 2 * Math.PI * r * 0.75;
    return (
      <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true">
        <circle cx="14" cy="14" r={r} fill="none" stroke="#333" strokeWidth="4" strokeDasharray={`${len} 100`} transform="rotate(135 14 14)" strokeLinecap="round" />
        <circle cx="14" cy="14" r={r} fill="none" stroke={c} strokeWidth="4" strokeDasharray={`${len * frac} 100`} transform="rotate(135 14 14)" strokeLinecap="round" />
        <text x="14" y="18" textAnchor="middle" fontSize={rank.short.length > 1 ? 9 : 11} fontWeight="800" fill={c}>{rank.short}</text>
      </svg>
    );
  }
  if (rank.platform === 'premier') {
    // Slanted rating plate.
    return (
      <svg viewBox="0 0 34 20" width="30" height="18" aria-hidden="true">
        <path d="M5 1 H33 L29 19 H1 Z" fill={c} opacity="0.25" stroke={c} strokeWidth="1.5" />
        <path d="M7 4 H11 L9 16 H5 Z" fill={c} />
        <text x="21" y="14" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">{rank.short}</text>
      </svg>
    );
  }
  // ESEA: shield with the letter.
  return (
    <svg viewBox="0 0 24 26" width="20" height="22" aria-hidden="true">
      <path d="M12 1 L22 5 V13 C22 19 17 23 12 25 C7 23 2 19 2 13 V5 Z" fill={c} opacity="0.25" stroke={c} strokeWidth="1.8" />
      <text x="12" y="17" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{rank.short.replace('−', '-')}</text>
    </svg>
  );
}

// `compact` (Invite Players): Premier shows the rating band without the
// platform name, FACEIT and ESEA show only the platform name next to the
// level/letter badge. The full rank is always in the accessible label.
export function RankBadge({ cat, platform, rankId, legacyPlatform, legacySkill, verified = false, compact = false }: {
  cat: Catalogue | null; platform?: string | null; rankId?: string | null; legacyPlatform?: string | null; legacySkill?: string | null; verified?: boolean; compact?: boolean;
}) {
  const rank = findRank(cat, rankId);
  if (rank) {
    const title = `${platformLabel(cat, rank.platform)} ${rank.label}${rank.unit && rank.min != null ? ` ${rank.unit}` : ''} (${verified ? 'verified' : 'self-reported'})`;
    if (compact) {
      const full = `${platformLabel(cat, rank.platform)} ${rank.label}`;
      return (
        <span className={`rank-badge compact rank-${rank.platform}`} style={{ ['--rank' as string]: rank.color }} title={title} role="img" aria-label={full}>
          <RankShape rank={rank} />
          <span aria-hidden="true">{rank.platform === 'premier' ? rank.label : platformLabel(cat, rank.platform)}</span>
        </span>
      );
    }
    return (
      <span className={`rank-badge rank-${rank.platform}`} style={{ ['--rank' as string]: rank.color }} title={title}>
        <RankShape rank={rank} />
        <span>{platformLabel(cat, rank.platform)} {rank.label}</span>
      </span>
    );
  }
  if (platform) return <span className="rank-badge rank-none" title="Self-reported">{platformLabel(cat, platform)}{legacySkill ? ` · ${legacySkill}` : ''}</span>;
  if (legacyPlatform || legacySkill) {
    return <span className="rank-badge rank-legacy" title="Entered before rank options existed">{[legacyPlatform, legacySkill].filter(Boolean).join(' · ')}</span>;
  }
  return <span className="muted">—</span>;
}
