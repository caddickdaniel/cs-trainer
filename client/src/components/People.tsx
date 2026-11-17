import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_COLOR, roleLabel } from '../lib/constants';
import { Icon } from './Icons';

// Profile picture or a fallback with the player's initials.
export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return url ? (
    <img className="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span className="avatar fallback" aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 35% 32%)` }}>{initials}</span>
  );
}

// Role with a labelled icon (e.g. a crosshair for AWPer).
export function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return <span className="muted">—</span>;
  return (
    <span className={`role-badge role-${role}`} title={roleLabel(role)}
      style={ROLE_COLOR[role] ? { ['--role' as string]: ROLE_COLOR[role] } : undefined}>
      <Icon name={`role_${role}`} size={15} /> {roleLabel(role)}
    </span>
  );
}

export function PlayerLink({ id, name }: { id: number; name: string }) {
  return <Link to={`/players/${id}`}>{name}</Link>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <dl className="facts">
      {shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
