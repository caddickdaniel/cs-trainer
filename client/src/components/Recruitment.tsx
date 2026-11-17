import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Catalogue, PlatformId } from '../lib/catalogue';
import { competitionLabel, findRank, platformLabel, ranksOf } from '../lib/catalogue';
import type { PlayerRanks, RankRequirement } from '../lib/types';
import { RankBadge, RankShape } from './RankBadge';
import { formatRequirement } from '../lib/rankRange';

// One platform's rank options (shared by profiles, player search and team
// requirements so the choices are identical everywhere).
export function RankSelect({ cat, platform, value, onChange, label, emptyLabel = 'Not set', disabled = false }: {
  cat: Catalogue | null; platform: string; value: string; onChange: (v: string) => void; label: string; emptyLabel?: string; disabled?: boolean;
}) {
  return (
    <label>{label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {ranksOf(cat, platform).map((r) => (
          <option key={r.id} value={r.id}>{r.label}{r.colorName ? ` (${r.colorName})` : ''}</option>
        ))}
      </select>
    </label>
  );
}

// A player's ranks, one badge per platform they entered.
export function PlayerRankList({ cat, ranks, legacyPlatform, legacySkill }: {
  cat: Catalogue | null; ranks: PlayerRanks | undefined; legacyPlatform?: string | null; legacySkill?: string | null;
}) {
  const set = (cat?.platforms ?? []).filter((p) => ranks?.[p.id]);
  if (!set.length && !legacyPlatform && !legacySkill) return <span className="muted">—</span>;
  return (
    <span className="row wrap tight-row">
      {set.map((p) => <RankBadge key={p.id} cat={cat} rankId={ranks![p.id]} />)}
      {legacyPlatform || legacySkill ? <RankBadge cat={cat} legacyPlatform={legacyPlatform} legacySkill={legacySkill} /> : null}
    </span>
  );
}

// One requirement as a single span: "[10] FACEIT (2,001–2,500)". The badge
// is drawn once when both ends share it; the stored bands are unchanged.
export function RequirementBadge({ cat, req }: { cat: Catalogue | null; req: RankRequirement }) {
  const d = cat ? formatRequirement(cat.ranks, platformLabel(cat, req.platform), req) : null;
  if (!d) return null;
  return (
    <span className={`requirement rank-badge rank-${req.platform}`} style={{ ['--rank' as string]: d.badges[0].color }}
      role="img" aria-label={d.label} title={`${d.label} (self-reported ranks)`}>
      <span className="requirement-badges" aria-hidden="true">
        {d.badges.map((r, i) => <span key={r.id} className="requirement-badge">{i ? <span className="muted">–</span> : null}<RankShape rank={r} /></span>)}
      </span>
      <span aria-hidden="true">{d.text}</span>
    </span>
  );
}

export function RequirementList({ cat, list, legacy }: { cat: Catalogue | null; list: RankRequirement[]; legacy?: string | null }) {
  if (!list.length && !legacy) return <span className="muted">Any rank</span>;
  return (
    <span className="requirement-list">
      {list.map((r) => <RequirementBadge key={r.platform} cat={cat} req={r} />)}
      {legacy ? <span className="rank-badge rank-legacy" title="Entered before rank options existed">{legacy}</span> : null}
    </span>
  );
}

// Requirement editor: at most one row per platform, each an exact band or a range.
export function RequirementsEditor({ cat, value, onChange }: { cat: Catalogue | null; value: RankRequirement[]; onChange: (v: RankRequirement[]) => void }) {
  const unused = (cat?.platforms ?? []).filter((p) => !value.some((r) => r.platform === p.id));
  const set = (i: number, patch: Partial<RankRequirement>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const index = (id: string) => (cat ? ranksOf(cat, findRank(cat, id)?.platform ?? '').findIndex((r) => r.id === id) : -1);
  return (
    <fieldset className="requirements-editor">
      <legend>Rank requirements</legend>
      {value.length ? null : <p className="muted small">No requirements: any rank can apply.</p>}
      {value.map((r, i) => {
        const range = r.min !== r.max;
        const options = ranksOf(cat, r.platform);
        return (
          <div key={r.platform} className="requirement-row">
            <strong>{platformLabel(cat, r.platform)}</strong>
            <label className="inline-check small"><input type="checkbox" checked={range}
              onChange={(e) => set(i, { max: e.target.checked ? (options[Math.min(options.length - 1, index(r.min) + 1)]?.id ?? r.min) : r.min })} /> Range</label>
            <label>{range ? 'From' : 'Rank'}
              <select value={r.min} onChange={(e) => {
                const min = e.target.value;
                // A range stays a range: its end moves up to the next band when needed.
                const next = options[Math.min(options.length - 1, index(min) + 1)]?.id ?? min;
                set(i, { min, max: !range ? min : index(r.max) <= index(min) ? next : r.max });
              }}>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {range ? (
              <label>To
                <select value={r.max} onChange={(e) => set(i, { max: e.target.value })}>
                  {options.filter((o) => index(o.id) >= index(r.min)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
            ) : null}
            <button type="button" className="btn ghost small danger" aria-label={`Remove ${platformLabel(cat, r.platform)} requirement`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
            <span className="requirement-summary small"><span className="muted">Shown to players as</span> <RequirementBadge cat={cat} req={r} /></span>
          </div>
        );
      })}
      {unused.length ? (
        <div className="row wrap">
          {unused.map((p) => (
            <button key={p.id} type="button" className="btn ghost small" onClick={() => {
              const first = ranksOf(cat, p.id)[0];
              if (first) onChange([...value, { platform: p.id as PlatformId, min: first.id, max: first.id }]);
            }}>+ {p.label} requirement</button>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

// Grouped, searchable multi-select of leagues and matchmaking.
export function CompetitionPicker({ cat, value, onChange, legacy }: { cat: Catalogue | null; value: string[]; onChange: (v: string[]) => void; legacy?: string | null }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (cat?.competitions ?? []).filter((c) => !q || c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [cat, query]);
  const groups = [...new Set(items.map((c) => c.group))];
  const toggle = (cid: string) => onChange(value.includes(cid) ? value.filter((x) => x !== cid) : [...value, cid]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (items[active]) toggle(items[active].id); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    else if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="combobox competition-picker">
      <label htmlFor={`${id}-input`}>Leagues and matchmaking</label>
      <div className="chip-field" onClick={() => document.getElementById(`${id}-input`)?.focus()}>
        {value.map((cid) => (
          <span key={cid} className="chip">{competitionLabel(cat, cid)}
            <button type="button" aria-label={`Remove ${competitionLabel(cat, cid)}`} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(cid)}>×</button>
          </span>
        ))}
        <input id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} autoComplete="off"
          aria-activedescendant={open && items[active] ? `${id}-opt-${items[active].id}` : undefined}
          placeholder={value.length ? '' : 'Type to search…'} value={query}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 120)}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }} onKeyDown={onKey} />
      </div>
      {legacy && !value.length ? <span className="muted small">Previously entered: “{legacy}”. It's kept until you choose from the list.</span> : null}
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-multiselectable="true" className="combobox-list" aria-label="Leagues and matchmaking">
          {groups.map((g) => (
            <li key={g} role="presentation" className="combobox-group">
              <span className="muted small">{g}</span>
              <ul role="group" aria-label={g}>
                {items.filter((c) => c.group === g).map((c) => {
                  const i = items.indexOf(c);
                  return (
                    <li key={c.id} id={`${id}-opt-${c.id}`} role="option" aria-selected={value.includes(c.id)} className={i === active ? 'active' : ''}
                      onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); toggle(c.id); }}>
                      <span className="check" aria-hidden="true">{value.includes(c.id) ? '✓' : ''}</span>{c.label}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!items.length ? <li className="muted" aria-disabled="true">No matches</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function CompetitionList({ cat, ids, legacy }: { cat: Catalogue | null; ids: string[]; legacy?: string | null }) {
  if (!ids.length) return legacy ? <span>{legacy}</span> : <span className="muted">—</span>;
  return <span className="row wrap tight-row">{ids.map((c) => <span key={c} className="chip static">{competitionLabel(cat, c)}</span>)}</span>;
}
