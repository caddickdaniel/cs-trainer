import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ECONOMIES, ECONOMY_LABEL, LIMITS, MAPS, MARKER_KINDS, MARKER_LABEL } from '../lib/constants';
import { useDocumentTitle } from '../lib/hooks';
import type { Assignment, Board, Marker, Phase, Point, RosterEntry, RosterResponse, Route, TacticFields } from '../lib/types';
import { Alert, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';
import { MapBoard, newId, playerColor, type Tool } from '../components/MapBoard';
import type { DocumentResponse } from './TacticView';

const emptyBoard = (): Board => ({ markers: [], routes: [] });
const newPhase = (n: number): Phase => ({ name: `Phase ${n}`, notes: '', board: emptyBoard(), assignments: [] });
const DEFAULT_FIELDS: TacticFields = {
  tactic_name: '', map: 'practice_yard', side: 'T', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
};
const UTILITY: [keyof TacticFields, string, number][] = [['smoke', 'Smokes', 5], ['flash', 'Flashes', 10], ['molly', 'Molotovs', 5], ['grenade', 'HE', 5]];

function Inspector({ phase, selectedId, roster, onBoard, onClear }: {
  phase: Phase; selectedId: string | null; roster: RosterEntry[]; onBoard: (b: Board) => void; onClear: () => void;
}) {
  const marker = phase.board.markers.find((m) => m.id === selectedId);
  const route = phase.board.routes.find((r) => r.id === selectedId);
  if (!marker && !route) {
    return <p className="muted small">Select a marker or route to edit it. Arrow keys nudge the selected marker; Delete removes it.</p>;
  }
  const playerSelect = (value: number | null, onChange: (v: number | null) => void) => (
    <label>Player
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Unassigned</option>
        {roster.map((r) => <option key={r.user_id} value={r.user_id}>{r.user_name}</option>)}
      </select>
    </label>
  );
  if (marker) {
    const set = (patch: Partial<Marker>) => onBoard({ ...phase.board, markers: phase.board.markers.map((m) => (m.id === marker.id ? { ...m, ...patch } : m)) });
    const pct = (v: number) => Math.round(v * 1000) / 10;
    const fromPct = (s: string) => Math.min(1, Math.max(0, Number(s) / 100 || 0));
    return (
      <div className="form compact">
        <label>Type
          <select value={marker.kind} onChange={(e) => set({ kind: e.target.value as Marker['kind'] })}>
            {MARKER_KINDS.map((k) => <option key={k} value={k}>{MARKER_LABEL[k]}</option>)}
          </select>
        </label>
        {playerSelect(marker.user_id, (v) => set({ user_id: v }))}
        <label>Label<input maxLength={40} value={marker.label} onChange={(e) => set({ label: e.target.value })} /></label>
        <div className="grid2">
          <label>X (%)<input type="number" min={0} max={100} step={0.5} value={pct(marker.x)} onChange={(e) => set({ x: fromPct(e.target.value) })} /></label>
          <label>Y (%)<input type="number" min={0} max={100} step={0.5} value={pct(marker.y)} onChange={(e) => set({ y: fromPct(e.target.value) })} /></label>
        </div>
        <button type="button" className="btn ghost small danger" onClick={() => { onBoard({ ...phase.board, markers: phase.board.markers.filter((m) => m.id !== marker.id) }); onClear(); }}>
          <Icon name="trash" /> Delete marker
        </button>
      </div>
    );
  }
  const r = route as Route;
  const set = (patch: Partial<Route>) => onBoard({ ...phase.board, routes: phase.board.routes.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) });
  return (
    <div className="form compact">
      <p className="small muted">Route with {r.points.length} points. Drag the handles on the board to reshape it.</p>
      {playerSelect(r.user_id, (v) => set({ user_id: v }))}
      {r.user_id == null ? (
        <label>Colour<input type="color" value={r.color} onChange={(e) => set({ color: e.target.value })} /></label>
      ) : null}
      <div className="row">
        <button type="button" className="btn ghost small" disabled={r.points.length <= 2} onClick={() => set({ points: r.points.slice(0, -1) })}>Remove last point</button>
        <button type="button" className="btn ghost small danger" onClick={() => { onBoard({ ...phase.board, routes: phase.board.routes.filter((x) => x.id !== r.id) }); onClear(); }}>
          <Icon name="trash" /> Delete route
        </button>
      </div>
    </div>
  );
}

function InstructionsForm({ phase, roster, onChange }: { phase: Phase; roster: RosterEntry[]; onChange: (a: Assignment[]) => void }) {
  const players = roster.map((r) => r.user_id);
  const get = (userId: number) => phase.assignments.find((a) => a.user_id === userId);
  const set = (userId: number, patch: Partial<Assignment>) => {
    const existing = get(userId) ?? { user_id: userId, instruction: '', utility: '', reference_url: null };
    const next = { ...existing, ...patch };
    const others = phase.assignments.filter((a) => a.user_id !== userId);
    onChange([...others, next].sort((a, b) => a.user_id - b.user_id));
  };
  const outsiders = phase.assignments.filter((a) => !players.includes(a.user_id));
  return (
    <div className="stack">
      {outsiders.length ? (
        <Alert kind="warn">
          {outsiders.map((a) => a.user_name ?? `Player ${a.user_id}`).join(', ')} {outsiders.length > 1 ? 'are' : 'is'} no longer on the team; their instructions will be removed when you save.
        </Alert>
      ) : null}
      {roster.map((r) => {
        const a = get(r.user_id);
        return (
          <fieldset key={r.user_id} className="player-fieldset">
            <legend><span className="dot" style={{ background: playerColor(r.user_id, players) }} /> {r.user_name}{r.player_role ? <span className="muted"> · {r.player_role}</span> : null}</legend>
            <label>Instruction<textarea rows={2} maxLength={2000} value={a?.instruction ?? ''} onChange={(e) => set(r.user_id, { instruction: e.target.value })}
              placeholder="What this player does in this phase" /></label>
            <div className="grid2">
              <label>Utility<input maxLength={1000} value={a?.utility ?? ''} onChange={(e) => set(r.user_id, { utility: e.target.value })} placeholder="e.g. Smoke CT, flash over" /></label>
              <label>Reference URL<input type="url" maxLength={500} value={a?.reference_url ?? ''} onChange={(e) => set(r.user_id, { reference_url: e.target.value || null })} placeholder="https://…" /></label>
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export function TacticEditorPage() {
  const { tacticId } = useParams();
  const isNew = !tacticId;
  const { active_team: team } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState<TacticFields>(DEFAULT_FIELDS);
  const [phases, setPhases] = useState<Phase[]>([newPhase(1)]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [canEdit, setCanEdit] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePlayer, setActivePlayer] = useState<number | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const skipBlock = useRef(false);
  useDocumentTitle(isNew ? 'New tactic' : `Edit ${fields.tactic_name || 'tactic'}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isNew) {
          if (!team) return;
          const r = await api.get<RosterResponse>(`/teams/${team.team_id}/roster`);
          if (cancelled) return;
          setRoster(r.members.map((m) => ({ user_id: m.user_id, user_name: m.user_name, player_role: m.player_role })));
          setCanEdit(r.viewer.can_lead);
        } else {
          const d = await api.get<DocumentResponse>(`/tactics/${tacticId}/document`);
          if (cancelled) return;
          const t = d.tactic;
          setFields({
            tactic_name: t.tactic_name, map: t.map ?? 'practice_yard', side: t.side ?? 'T',
            economy: (ECONOMIES as readonly string[]).includes(t.economy) ? (t.economy as TacticFields['economy']) : 'Eco',
            grenade: t.grenade, molly: t.molly, flash: t.flash, smoke: t.smoke,
          });
          setPhases(t.phases.length ? t.phases : [newPhase(1)]);
          setRevision(t.revision);
          setRoster(d.roster);
          setCanEdit(d.can_edit);
          if (!t.map || !t.side || !(ECONOMIES as readonly string[]).includes(t.economy)) {
            setNotice('Some details from the original tactic were missing or not recognised (map, side or economy). Check them before saving.');
          }
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isNew, tacticId, team]);

  const blocker = useBlocker(() => dirty && !skipBlock.current);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('You have unsaved changes. Leave without saving?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const phase = phases[Math.min(index, phases.length - 1)];
  const touch = () => setDirty(true);
  const setPhase = useCallback((patch: Partial<Phase>) => {
    setPhases((ps) => ps.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    setDirty(true);
  }, [index]);

  const commitDraft = useCallback(() => {
    if (draft.length >= 2 && phase.board.routes.length < LIMITS.routes) {
      const route: Route = { id: newId('r'), user_id: activePlayer, color: '#ffffff', points: draft };
      setPhase({ board: { ...phase.board, routes: [...phase.board.routes, route] } });
      setSelectedId(route.id);
    }
    setDraft([]);
  }, [draft, phase, activePlayer, setPhase]);

  const chooseTool = (t: Tool) => {
    if (tool === 'route' && t !== 'route') commitDraft();
    setTool(t);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'Enter' && tool === 'route') commitDraft();
      if (e.key === 'Escape') { setDraft([]); setSelectedId(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        setPhase({ board: {
          markers: phase.board.markers.filter((m) => m.id !== selectedId),
          routes: phase.board.routes.filter((r) => r.id !== selectedId),
        } });
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, commitDraft, selectedId, phase, setPhase]);

  const memberIds = useMemo(() => new Set(roster.map((r) => r.user_id)), [roster]);

  const save = async () => {
    // Include a route that is still being drawn.
    let toSave = phases;
    if (draft.length >= 2) {
      const route: Route = { id: newId('r'), user_id: activePlayer, color: '#ffffff', points: draft };
      toSave = phases.map((p, i) => (i === index ? { ...p, board: { ...p.board, routes: [...p.board.routes, route] } } : p));
      setPhases(toSave);
    }
    setDraft([]);
    setSaving(true);
    setError(null);
    const clean = (id: number | null) => (id != null && memberIds.has(id) ? id : null);
    const payload = {
      ...fields,
      phases: toSave.map((p) => ({
        name: p.name.trim() || 'Phase',
        notes: p.notes,
        board: {
          markers: p.board.markers.map((m) => ({ ...m, user_id: clean(m.user_id) })),
          routes: p.board.routes.map((r) => ({ ...r, user_id: clean(r.user_id) })),
        },
        assignments: p.assignments
          .filter((a) => memberIds.has(a.user_id) && (a.instruction.trim() || a.utility.trim() || a.reference_url))
          .map(({ user_id, instruction, utility, reference_url }) => ({ user_id, instruction, utility, reference_url: reference_url || null })),
      })),
    };
    try {
      skipBlock.current = true;
      const res = isNew
        ? await api.post<DocumentResponse>(`/teams/${team!.team_id}/tactics`, payload)
        : await api.put<DocumentResponse>(`/tactics/${tacticId}/document`, { ...payload, revision });
      setDirty(false);
      navigate(`/tactics/${res.tactic.tactic_id}`, { replace: isNew });
    } catch (err) {
      skipBlock.current = false;
      if (err instanceof ApiError && err.code === 'stale_revision') {
        setError('Someone else saved this tactic while you were editing. Copy anything you need, then reload to get the latest version.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const movePhase = (from: number, to: number) => {
    if (to < 0 || to >= phases.length) return;
    const next = [...phases];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    setPhases(next);
    setIndex(to);
    touch();
  };

  if (!team && isNew) return <NeedsTeam what="Tactics" />;
  if (loading) return <Loading />;
  if (loadError) return <Panel title="Tactic"><Alert>{loadError}</Alert><Link className="btn" to="/tactics">Back</Link></Panel>;
  if (!canEdit) return <Panel title="Read only"><p>Only the team owner or an IGL can edit tactics.</p><Link className="btn" to={isNew ? '/tactics' : `/tactics/${tacticId}`}>Back</Link></Panel>;

  const tools: { id: Tool; label: string; icon?: string }[] = [
    { id: 'select', label: 'Select / move', icon: 'select' },
    { id: 'route', label: 'Draw route', icon: 'route' },
    ...MARKER_KINDS.map((k) => ({ id: k as Tool, label: MARKER_LABEL[k] })),
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{isNew ? 'New tactic' : 'Edit tactic'}</h1>
        <div className="row">
          <Link className="btn ghost" to={isNew ? '/tactics' : `/tactics/${tacticId}`}>Cancel</Link>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : dirty || isNew ? 'Save tactic' : 'Saved'}</button>
        </div>
      </div>
      <Alert kind="warn">{notice}</Alert>
      <Alert>{error}</Alert>

      <Panel>
        <div className="meta-grid">
          <label>Name<input required maxLength={60} value={fields.tactic_name} onChange={(e) => { setFields({ ...fields, tactic_name: e.target.value }); touch(); }} /></label>
          <label>Map
            <select value={fields.map} onChange={(e) => { setFields({ ...fields, map: e.target.value }); touch(); }}>
              {MAPS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Side</span>
            <div className="segmented" role="group" aria-label="Side">
              {(['T', 'CT'] as const).map((s) => (
                <button key={s} type="button" className={fields.side === s ? 'on' : ''} aria-pressed={fields.side === s}
                  onClick={() => { setFields({ ...fields, side: s }); touch(); }}>{s}</button>
              ))}
            </div>
          </div>
          <label>Economy
            <select value={fields.economy} onChange={(e) => { setFields({ ...fields, economy: e.target.value as TacticFields['economy'] }); touch(); }}>
              {ECONOMIES.map((x) => <option key={x} value={x}>{ECONOMY_LABEL[x]}</option>)}
            </select>
          </label>
          {UTILITY.map(([key, label, max]) => (
            <label key={key} className="narrow">{label}
              <input type="number" min={0} max={max} value={fields[key] as number}
                onChange={(e) => { setFields({ ...fields, [key]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) }); touch(); }} />
            </label>
          ))}
        </div>
      </Panel>

      <div className="phase-tabs" role="tablist" aria-label="Phases">
        {phases.map((p, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === index} className={i === index ? 'on' : ''}
            onClick={() => { commitDraft(); setIndex(i); setSelectedId(null); }}>{i + 1}. {p.name || 'Untitled'}</button>
        ))}
        {phases.length < LIMITS.phases ? (
          <button type="button" className="add" onClick={() => { setPhases([...phases, newPhase(phases.length + 1)]); setIndex(phases.length); touch(); }}>
            <Icon name="plus" /> Add phase
          </button>
        ) : null}
      </div>

      <div className="board-layout editor">
        <div className="stack">
          <div className="toolbar" role="toolbar" aria-label="Board tools">
            {tools.map((t) => (
              <button key={t.id} type="button" className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} onClick={() => chooseTool(t.id)} title={t.label}>
                {t.icon ? <Icon name={t.icon} /> : null} {t.label}
              </button>
            ))}
            <label className="inline">For
              <select value={activePlayer ?? ''} onChange={(e) => setActivePlayer(e.target.value ? Number(e.target.value) : null)} aria-label="New items belong to">
                <option value="">No player</option>
                {roster.map((r) => <option key={r.user_id} value={r.user_id}>{r.user_name}</option>)}
              </select>
            </label>
          </div>
          {/* The hint row is always present so the board does not jump. */}
          {tool === 'route' ? (
            <div className="row hint">
              <span className="muted small">Click the map to add points ({draft.length}). Enter or Finish to complete, Esc to cancel.</span>
              <button type="button" className="btn small" disabled={draft.length < 2} onClick={commitDraft}>Finish route</button>
              <button type="button" className="btn ghost small" disabled={!draft.length} onClick={() => setDraft([])}>Cancel</button>
            </div>
          ) : <p className="muted small hint">{tool === 'select'
            ? 'Drag markers or route handles to move them.'
            : `Click the map to place a ${MARKER_LABEL[tool].toLowerCase()}.`}</p>}
          <MapBoard board={phase.board} players={roster} onChange={(b) => setPhase({ board: b })} tool={tool}
            selectedId={selectedId} onSelect={setSelectedId} activePlayer={activePlayer} draftRoute={draft} onDraftRoute={setDraft}
            label={`Editable board for ${phase.name}`} />
          <div className="legend">
            {roster.map((r) => <span key={r.user_id}><span className="dot" style={{ background: playerColor(r.user_id) }} /> {r.user_name}</span>)}
          </div>
        </div>
        <div className="stack">
          <Panel title="Phase">
            <div className="form compact">
              <label>Phase name<input maxLength={60} value={phase.name} onChange={(e) => setPhase({ name: e.target.value })} /></label>
              <label>Notes (shown to everyone)<textarea rows={2} maxLength={2000} value={phase.notes} onChange={(e) => setPhase({ notes: e.target.value })} /></label>
              <div className="row">
                <button type="button" className="btn ghost small" disabled={index === 0} onClick={() => movePhase(index, index - 1)}><Icon name="up" /> Earlier</button>
                <button type="button" className="btn ghost small" disabled={index === phases.length - 1} onClick={() => movePhase(index, index + 1)}><Icon name="down" /> Later</button>
                <button type="button" className="btn ghost small danger" disabled={phases.length === 1}
                  onClick={() => { if (window.confirm(`Delete "${phase.name}"?`)) { setPhases(phases.filter((_, i) => i !== index)); setIndex(Math.max(0, index - 1)); touch(); } }}>
                  <Icon name="trash" /> Delete phase
                </button>
              </div>
            </div>
          </Panel>
          <Panel title="Selected item">
            <Inspector phase={phase} selectedId={selectedId} roster={roster} onBoard={(b) => setPhase({ board: b })} onClear={() => setSelectedId(null)} />
          </Panel>
          <Panel title="Player instructions">
            <InstructionsForm phase={phase} roster={roster} onChange={(a) => setPhase({ assignments: a })} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
