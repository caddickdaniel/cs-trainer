import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title || actions ? (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success' | 'warn'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted" role="status">{label}</p>;
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'gold' | 'green' | 'blue' | 'red' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function SideBadge({ side }: { side: string | null }) {
  if (!side) return <Badge>Side?</Badge>;
  return <Badge tone={side === 'T' ? 'gold' : 'blue'}>{side}</Badge>;
}

export function NeedsTeam({ what }: { what: string }) {
  return (
    <Panel title="Join a team first">
      <p>{what} belong to a team. Create a team or join one with an invite link.</p>
      <Link className="btn primary" to="/team">Go to Team</Link>
    </Panel>
  );
}
