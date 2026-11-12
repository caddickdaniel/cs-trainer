import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, imageUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  DEFAULT_MAP, ECONOMIES, ECONOMY_LABEL, LEVEL_LABEL, LIMITS, LINEUP_KINDS, MAPS, MARKER_KINDS, MARKER_LABEL, NOTE_SIZE, mapLevels, roleLabel,
  type Level,
} from '../lib/constants';
import { useDocumentTitle } from '../lib/hooks';
import type { Assignment, Board, Hold, LineupImage, Marker, Phase, Point, RosterEntry, RosterResponse, Route, TacticFields } from '../lib/types';
import { Alert, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';
import { MapBoard, boardHolds, newId, ownerColor, ownerKey, playerColor, sameOwner, type Tool } from '../components/MapBoard';
import { LevelSwitch } from '../components/Lineups';
import type { DocumentResponse } from './TacticView';

const emptyBoard = (): Board => ({ markers: [], routes: [], holds: [] });
const newPhase = (n: number): Phase => ({ name: `Phase ${n}`, notes: '', board: emptyBoard(), assignments: [] });

// A phase created after another starts with that phase's players where they
// ended up: the end of their last route if they had one (on that route's
// floor), otherwise where their marker was. Routes, utility, notes and holds
// start fresh. The copies are independent, so editing either phase later
// never changes the other.
export function carryForward(prev: Phase, name: string): Phase {
  const markers = prev.board.markers.filter((m) => m.kind === 'player').map((m) => {
    const routes = ownerKey(m) ? prev.board.routes.filter((r) => sameOwner(r, m) && r.points.length) : [];
    const route = routes[routes.length - 1];
    const end = route ? route.points[route.points.length - 1] : null;
    return {
      ...m,
      id: newId('m'),
      x: end ? end.x : m.x,
      y: end ? end.y : m.y,
      level: route ? route.level ?? 'main' : m.level ?? 'main',
      images: [],
    };
  });
  return { name, notes: '', board: { markers, routes: [], holds: [] }, assignments: [] };
}

// "u12" (roster player) or "s3" (Player 3 slot) for the player pickers.
type Who = { user_id: number | null; slot: number | null };
const whoValue = (w: { user_id: number | null; slot?: number | null }) => (w.user_id != null ? `u${w.user_id}` : w.slot ? `s${w.slot}` : '');
const parseWho = (v: string): Who => (v.startsWith('u') ? { user_id: Number(v.slice(1)), slot: null }
  : v.startsWith('s') ? { user_id: null, slot: Number(v.slice(1)) } : { user_id: null, slot: null });

// Player slots still used by items or instructions that no roster player owns yet.
function unmappedSlots(phases: Phase[]) {
  const set = new Set<number>();
  for (const p of phases) {
    [...p.board.markers, ...p.board.routes, ...p.assignments].forEach((i) => { if (i.user_id == null && i.slot) set.add(i.slot); });
  }
  return [...set].sort((a, b) => a - b);
}

function PlayerPicker({ label = 'Player', value, roster, slots, onChange }: {
  label?: string; value: { user_id: number | null; slot?: number | null }; roster: RosterEntry[]; slots: number[]; onChange: (w: Who) => void;
}) {
  return (
    <label>{label}
      <select value={whoValue(value)} onChange={(e) => onChange(parseWho(e.target.value))}>
        <option value="">Unassigned</option>
        {roster.map((r) => <option key={r.user_id} value={`u${r.user_id}`}>{r.user_name}</option>)}
        {slots.length ? (
          <optgroup label="Unmapped player slots">
            {slots.map((s) => <option key={s} value={`s${s}`}>Player {s}</option>)}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
const DEFAULT_FIELDS: TacticFields = {
  tactic_name: '', map: DEFAULT_MAP, side: 'T', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0,
};
const UTILITY: [keyof TacticFields, string, number][] = [['smoke', 'Smokes', 5], ['flash', 'Flashes', 10], ['molly', 'Molotovs', 5], ['grenade', 'HE', 5]];

// Upload, paste, caption and remove lineup screenshots for one marker.
function LineupEditor({ teamId, images, onChange }: { teamId: number; images: LineupImage[]; onChange: (images: LineupImage[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const full = images.length >= LIMITS.imagesPerMarker;

  const add = async (files: File[]) => {
    setError(null);
    const pngs = files.filter((f) => f.type === 'image/png');
    if (files.length && !pngs.length) { setError('Lineup screenshots must be PNG files.'); return; }
    const room = LIMITS.imagesPerMarker - images.length;
    const tooBig = pngs.find((f) => f.size > LIMITS.imageBytes);
    if (tooBig) { setError(`${tooBig.name || 'That image'} is larger than 8 MB.`); return; }
    setBusy(true);
    try {
      const added: LineupImage[] = [];
      for (const file of pngs.slice(0, room)) {
        const res = await api.uploadPng<{ image: { image_id: string } }>(`/teams/${teamId}/lineup-images`, file);
        added.push({ image_id: res.image.image_id, caption: '' });
      }
      onChange([...images, ...added]);
      if (pngs.length > room) setError(`Only ${LIMITS.imagesPerMarker} screenshots per marker; extra files were skipped.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="lineup-editor" onPaste={(e) => {
      const files = [...e.clipboardData.files];
      if (files.length) { e.preventDefault(); add(files); }
    }}>
      <span className="field-label">Lineup screenshots</span>
      {images.map((img, i) => (
        <div key={img.image_id} className="lineup-edit-row">
          <a href={imageUrl(img.image_id)} target="_blank" rel="noreferrer"><img src={imageUrl(img.image_id)} alt={`Lineup ${i + 1}`} /></a>
          <div className="stack tight">
            <input aria-label={`Caption for screenshot ${i + 1}`} maxLength={120} placeholder="Caption, e.g. stand in the corner"
              value={img.caption} onChange={(e) => onChange(images.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
            <div className="row">
              <button type="button" className="btn ghost small" disabled={i === 0}
                onClick={() => { const n = [...images]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>Move up</button>
              <button type="button" className="btn ghost small danger" onClick={() => onChange(images.filter((_, j) => j !== i))}>Remove</button>
            </div>
          </div>
        </div>
      ))}
      {!full ? (
        <div className="row wrap">
          <input ref={inputRef} type="file" accept="image/png" multiple hidden onChange={(e) => add([...(e.target.files ?? [])])} />
          <button type="button" className="btn small" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Icon name="plus" /> {busy ? 'Uploading…' : 'Add PNG'}
          </button>
          <span className="muted small">or paste a screenshot here (Ctrl+V). PNG, up to 8 MB.</span>
        </div>
      ) : <p className="muted small">Maximum of {LIMITS.imagesPerMarker} screenshots.</p>}
      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}

function NoteControls({ marker, set }: { marker: Marker; set: (patch: Partial<Marker>) => void }) {
  const size = marker.size ?? NOTE_SIZE.default;
  const change = (n: number) => set({ size: Math.min(NOTE_SIZE.max, Math.max(NOTE_SIZE.min, n)) });
  return (
    <>
      <label>Note text
        <textarea rows={3} maxLength={LIMITS.noteChars} value={marker.label} autoFocus={!marker.label}
          placeholder="Type the note shown on the map" onChange={(e) => set({ label: e.target.value })} />
      </label>
      <div className="field">
        <span>Text size</span>
        <div className="row tight">
          <button type="button" className="btn small" aria-label="Smaller text" disabled={size <= NOTE_SIZE.min}
            onClick={() => change(size - NOTE_SIZE.step)}><Icon name="down" /></button>
          <input type="number" className="narrow-input" aria-label="Note text size" min={NOTE_SIZE.min} max={NOTE_SIZE.max} step={NOTE_SIZE.step}
            value={size} onChange={(e) => change(Number(e.target.value) || NOTE_SIZE.default)} />
          <button type="button" className="btn small" aria-label="Larger text" disabled={size >= NOTE_SIZE.max}
            onClick={() => change(size + NOTE_SIZE.step)}><Icon name="up" /></button>
          <span className="muted small">Up/down arrow keys in the box also change it.</span>
        </div>
      </div>
    </>
  );
}

function HoldControls({ hold, anchorName, set, onDelete }: {
  hold: Hold; anchorName: string; set: (patch: Partial<Hold>) => void; onDelete: () => void;
}) {
  const norm = (a: number) => Math.round(((a % 360) + 360) % 360);
  return (
    <div className="form compact">
      <p className="small muted">Hold for <strong>{anchorName}</strong>. Drag the white handle to aim it and set its reach, and the coloured handle to widen or narrow it.</p>
      <label>Direction ({norm(hold.angle)}°)
        <input type="range" min={0} max={359} value={norm(hold.angle)} onChange={(e) => set({ angle: Number(e.target.value) })} />
      </label>
      <label>Coverage ({Math.round(hold.spread)}°)
        <input type="range" min={5} max={180} value={hold.spread} onChange={(e) => set({ spread: Number(e.target.value) })} />
      </label>
      <label>Reach
        <input type="range" min={2} max={60} value={Math.round(hold.length * 100)} onChange={(e) => set({ length: Number(e.target.value) / 100 })} />
      </label>
      <button type="button" className="btn ghost small danger" onClick={onDelete}><Icon name="trash" /> Remove hold</button>
    </div>
  );
}

function Inspector({ phase, selectedId, roster, slots, onBoard, onClear, teamId, map }: {
  phase: Phase; selectedId: string | null; roster: RosterEntry[]; slots: number[]; onBoard: (b: Board) => void; onClear: () => void;
  teamId: number; map: string;
}) {
  const holds = boardHolds(phase.board);
  const levels = mapLevels(map);
  const levelSelect = (value: Level | undefined, onChange: (l: Level) => void) => (levels.length > 1 ? (
    <label>Level
      <select value={value ?? 'main'} onChange={(e) => onChange(e.target.value as Level)}>
        {levels.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
      </select>
    </label>
  ) : null);
  const marker = phase.board.markers.find((m) => m.id === selectedId);
  const route = phase.board.routes.find((r) => r.id === selectedId);
  const hold = holds.find((h) => h.id === selectedId);
  if (hold) {
    const anchor = phase.board.markers.find((m) => m.id === hold.marker_id);
    const name = anchor?.user_id != null ? roster.find((r) => r.user_id === anchor.user_id)?.user_name ?? 'player'
      : anchor?.slot ? `Player ${anchor.slot}` : 'this player';
    return (
      <HoldControls hold={hold} anchorName={name}
        set={(patch) => onBoard({ ...phase.board, holds: holds.map((h) => (h.id === hold.id ? { ...h, ...patch } : h)) })}
        onDelete={() => { onBoard({ ...phase.board, holds: holds.filter((h) => h.id !== hold.id) }); onClear(); }} />
    );
  }
  if (!marker && !route) {
    return <p className="muted small">Select a marker, route or hold to edit it. Arrow keys nudge the selected marker; Delete removes it.</p>;
  }
  const playerSelect = (value: { user_id: number | null; slot?: number | null }, onChange: (v: Who) => void) => (
    <PlayerPicker value={value} roster={roster} slots={slots} onChange={onChange} />
  );
  if (marker) {
    const set = (patch: Partial<Marker>) => onBoard({ ...phase.board, markers: phase.board.markers.map((m) => (m.id === marker.id ? { ...m, ...patch } : m)) });
    const pct = (v: number) => Math.round(v * 1000) / 10;
    const fromPct = (s: string) => Math.min(1, Math.max(0, Number(s) / 100 || 0));
    return (
      <div className="form compact">
        <label>Type
          <select value={marker.kind} onChange={(e) => {
            const kind = e.target.value as Marker['kind'];
            const keep = (LINEUP_KINDS as readonly string[]).includes(kind);
            if (!keep && marker.images?.length && !window.confirm('Player markers cannot have lineup screenshots. Remove them?')) return;
            const patch: Partial<Marker> = { kind, images: keep ? marker.images ?? [] : [] };
            if (kind === 'note' && marker.size == null) patch.size = NOTE_SIZE.default;
            if (marker.kind === 'note' && kind !== 'note') patch.label = marker.label.slice(0, 40);
            // Holds belong to player markers only.
            if (marker.kind === 'player' && kind !== 'player') {
              onBoard({
                ...phase.board,
                markers: phase.board.markers.map((m) => (m.id === marker.id ? { ...m, ...patch } : m)),
                holds: holds.filter((h) => h.marker_id !== marker.id),
              });
              return;
            }
            set(patch);
          }}>
            {MARKER_KINDS.map((k) => <option key={k} value={k}>{MARKER_LABEL[k]}</option>)}
          </select>
        </label>
        {playerSelect(marker, (v) => set(v))}
        {marker.kind === 'note'
          ? <NoteControls marker={marker} set={set} />
          : <label>Label<input maxLength={40} value={marker.label} onChange={(e) => set({ label: e.target.value })} /></label>}
        {levelSelect(marker.level, (l) => set({ level: l }))}
        <div className="grid2">
          <label>X (%)<input type="number" min={0} max={100} step={0.5} value={pct(marker.x)} onChange={(e) => set({ x: fromPct(e.target.value) })} /></label>
          <label>Y (%)<input type="number" min={0} max={100} step={0.5} value={pct(marker.y)} onChange={(e) => set({ y: fromPct(e.target.value) })} /></label>
        </div>
        {(LINEUP_KINDS as readonly string[]).includes(marker.kind)
          ? <LineupEditor teamId={teamId} images={marker.images ?? []} onChange={(images) => set({ images })} />
          : <p className="muted small">Change the type to a grenade or note to attach lineup screenshots.</p>}
        <button type="button" className="btn ghost small danger" onClick={() => {
          onBoard({ ...phase.board, markers: phase.board.markers.filter((m) => m.id !== marker.id), holds: holds.filter((h) => h.marker_id !== marker.id) });
          onClear();
        }}>
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
      {playerSelect(r, (v) => set(v))}
      {levelSelect(r.level, (l) => set({ level: l }))}
      {ownerKey(r) == null ? (
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

function InstructionsForm({ phase, roster, slots, onChange }: {
  phase: Phase; roster: RosterEntry[]; slots: number[]; onChange: (a: Assignment[]) => void;
}) {
  const players = roster.map((r) => r.user_id);
  const keyOf = (a: { user_id: number | null; slot?: number | null }) => whoValue(a);
  const get = (who: Who) => phase.assignments.find((a) => keyOf(a) === whoValue(who));
  const set = (who: Who, patch: Partial<Assignment>) => {
    const existing = get(who) ?? { ...who, instruction: '', utility: '', reference_url: null };
    const next = { ...existing, ...patch };
    const others = phase.assignments.filter((a) => keyOf(a) !== whoValue(who));
    onChange([...others, next].sort((a, b) => keyOf(a).localeCompare(keyOf(b))));
  };
  const outsiders = phase.assignments.filter((a) => a.user_id != null && !players.includes(a.user_id));
  const fieldset = (who: Who, title: React.ReactNode, color: string, sub?: string) => {
    const a = get(who);
    return (
      <fieldset key={whoValue(who)} className="player-fieldset">
        <legend><span className="dot" style={{ background: color }} /> {title}{sub ? <span className="muted"> · {sub}</span> : null}</legend>
        <label>Instruction<textarea rows={2} maxLength={2000} value={a?.instruction ?? ''} onChange={(e) => set(who, { instruction: e.target.value })}
          placeholder="What this player does in this phase" /></label>
        <div className="grid2">
          <label>Utility<input maxLength={1000} value={a?.utility ?? ''} onChange={(e) => set(who, { utility: e.target.value })} placeholder="e.g. Smoke CT, flash over" /></label>
          <label>Reference URL<input type="url" maxLength={500} value={a?.reference_url ?? ''} onChange={(e) => set(who, { reference_url: e.target.value || null })} placeholder="https://…" /></label>
        </div>
      </fieldset>
    );
  };
  return (
    <div className="stack">
      {outsiders.length ? (
        <Alert kind="warn">
          {outsiders.map((a) => a.user_name ?? `Player ${a.user_id}`).join(', ')} {outsiders.length > 1 ? 'are' : 'is'} no longer on the team; their instructions will be removed when you save.
        </Alert>
      ) : null}
      {roster.map((r) => fieldset({ user_id: r.user_id, slot: null }, r.user_name, playerColor(r.user_id, players), roleLabel(r.player_role) || undefined))}
      {slots.map((n) => fieldset({ user_id: null, slot: n }, `Player ${n}`, ownerColor({ user_id: null, slot: n }), 'unmapped slot'))}
    </div>
  );
}

// Maps imported Player 1-5 slots to roster players across every phase.
function SlotMapper({ slots, roster, phases, onApply }: {
  slots: number[]; roster: RosterEntry[]; phases: Phase[]; onApply: (map: Record<number, number>) => void;
}) {
  const [choice, setChoice] = useState<Record<number, number>>({});
  const used = new Set(phases.flatMap((p) => [...p.board.markers, ...p.board.routes, ...p.assignments]
    .filter((i) => i.user_id != null).map((i) => i.user_id as number)));
  const picked = Object.values(choice);
  const dupes = picked.filter((v, i) => picked.indexOf(v) !== i);
  return (
    <div className="stack">
      <p className="small muted">This tactic was imported. Choose who plays each slot; until then the slot stays editable as “Player N”.
        Mapping moves the slot's markers, routes, holds, utility and instructions to that player in every phase.</p>
      {slots.map((n) => (
        <label key={n} className="row">
          <span className="dot" style={{ background: ownerColor({ user_id: null, slot: n }) }} /> Player {n}
          <select value={choice[n] ?? ''} onChange={(e) => setChoice({ ...choice, [n]: Number(e.target.value) || 0 })}>
            <option value="">Not mapped yet</option>
            {roster.map((r) => <option key={r.user_id} value={r.user_id}>{r.user_name}{used.has(r.user_id) ? ' (already used)' : ''}</option>)}
          </select>
        </label>
      ))}
      {dupes.length ? <div className="error-text">Each roster player can take only one slot.</div> : null}
      <button type="button" className="btn small" disabled={!picked.some(Boolean) || dupes.length > 0}
        onClick={() => { onApply(Object.fromEntries(Object.entries(choice).filter(([, v]) => v)) as Record<number, number>); setChoice({}); }}>
        Apply mapping
      </button>
    </div>
  );
}

// Applies a slot -> user mapping to every item and instruction.
export function mapSlots(phases: Phase[], mapping: Record<number, number>): Phase[] {
  const fix = <T extends { user_id: number | null; slot?: number | null }>(i: T): T => (
    i.user_id == null && i.slot && mapping[i.slot] ? { ...i, user_id: mapping[i.slot] } : i);
  return phases.map((p) => {
    const assignments: Assignment[] = [];
    for (const a of p.assignments.map(fix)) {
      const same = assignments.find((x) => x.user_id != null && x.user_id === a.user_id);
      if (same) {
        // Merge with an instruction the player already had in this phase.
        same.instruction = [same.instruction, a.instruction].filter(Boolean).join('\n');
        same.utility = [same.utility, a.utility].filter(Boolean).join(', ');
      } else assignments.push({ ...a });
    }
    return { ...p, board: { ...p.board, markers: p.board.markers.map(fix), routes: p.board.routes.map(fix) }, assignments };
  });
}

export function TacticEditorPage() {
  const { tacticId } = useParams();
  const isNew = !tacticId;
  const { active_team: team } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState<TacticFields>(DEFAULT_FIELDS);
  const [phases, setPhases] = useState<Phase[]>([newPhase(1)]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [level, setLevel] = useState<Level>('main');
  const [revision, setRevision] = useState(0);
  const [canEdit, setCanEdit] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<Who>({ user_id: null, slot: null });
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
          setTeamId(team.team_id);
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
          setTeamId(t.team_id);
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
      const route: Route = { id: newId('r'), level, ...active, color: '#ffffff', points: draft };
      setPhase({ board: { ...phase.board, routes: [...phase.board.routes, route] } });
      setSelectedId(route.id);
    }
    setDraft([]);
  }, [draft, phase, active, setPhase, level]);

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
          holds: boardHolds(phase.board).filter((h) => h.id !== selectedId && h.marker_id !== selectedId),
        } });
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, commitDraft, selectedId, phase, setPhase]);

  const memberIds = useMemo(() => new Set(roster.map((r) => r.user_id)), [roster]);
  const slots = useMemo(() => unmappedSlots(phases), [phases]);

  const save = async () => {
    // Include a route that is still being drawn.
    let toSave = phases;
    if (draft.length >= 2) {
      const route: Route = { id: newId('r'), level, ...active, color: '#ffffff', points: draft };
      toSave = phases.map((p, i) => (i === index ? { ...p, board: { ...p.board, routes: [...p.board.routes, route] } } : p));
      setPhases(toSave);
    }
    setDraft([]);
    setSaving(true);
    setError(null);
    const clean = (id: number | null) => (id != null && memberIds.has(id) ? id : null);
    const slotOf = (i: { slot?: number | null }) => i.slot ?? null;
    const payload = {
      ...fields,
      phases: toSave.map((p) => ({
        name: p.name.trim() || 'Phase',
        notes: p.notes,
        board: {
          markers: p.board.markers.map((m) => ({
            ...m, level: m.level ?? 'main', images: (m.images ?? []).map(({ image_id, caption }) => ({ image_id, caption })),
            user_id: clean(m.user_id), slot: slotOf(m),
          })),
          routes: p.board.routes.map((r) => ({ ...r, level: r.level ?? 'main', user_id: clean(r.user_id), slot: slotOf(r) })),
          holds: boardHolds(p.board).filter((h) => p.board.markers.some((m) => m.id === h.marker_id && m.kind === 'player')),
        },
        assignments: p.assignments
          .filter((a) => (a.user_id != null ? memberIds.has(a.user_id) : Boolean(a.slot))
            && (a.instruction.trim() || a.utility.trim() || a.reference_url))
          .map(({ user_id, slot, instruction, utility, reference_url }) => ({
            user_id: user_id ?? null, slot: slot ?? null, instruction, utility, reference_url: reference_url || null,
          })),
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

  // Switching to a map without a lower level moves lower-level items to main.
  const changeMap = (map: string) => {
    const hasLower = mapLevels(map).includes('lower');
    const lowerItems = phases.some((p) => [...p.board.markers, ...p.board.routes].some((i) => i.level === 'lower'));
    if (!hasLower && lowerItems
      && !window.confirm('This map has no lower level. Items on the lower level will be moved to the main level. Continue?')) return;
    if (!hasLower) {
      setPhases((ps) => ps.map((p) => ({
        ...p,
        board: {
          ...p.board,
          markers: p.board.markers.map((m) => ({ ...m, level: 'main' as Level })),
          routes: p.board.routes.map((r) => ({ ...r, level: 'main' as Level })),
        },
      })));
      setLevel('main');
    }
    setFields({ ...fields, map });
    touch();
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
    { id: 'hold', label: 'Hold', icon: 'hold' },
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
            <select value={fields.map} onChange={(e) => changeMap(e.target.value)}>
              {(['Active Duty', 'Reserve', 'Other'] as const).map((pool) => (
                <optgroup key={pool} label={pool}>
                  {MAPS.filter((m) => m.pool === pool).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}{m.levels.length > 1 ? ' (upper + lower)' : ''}</option>
                  ))}
                </optgroup>
              ))}
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
          <button type="button" className="add" title="Adds a phase after the current one, starting from where its players end up"
            onClick={() => {
              commitDraft();
              const at = Math.min(index, phases.length - 1);
              const next = [...phases];
              next.splice(at + 1, 0, carryForward(phases[at], `Phase ${phases.length + 1}`));
              setPhases(next);
              setIndex(at + 1);
              setSelectedId(null);
              touch();
            }}>
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
              <select value={whoValue(active)} onChange={(e) => setActive(parseWho(e.target.value))} aria-label="New items belong to">
                <option value="">No player</option>
                {roster.map((r) => <option key={r.user_id} value={`u${r.user_id}`}>{r.user_name}</option>)}
                {slots.map((n) => <option key={n} value={`s${n}`}>Player {n}</option>)}
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
            ? 'Drag markers or route handles to move them. Dotted lines join each player to their utility.'
            : tool === 'hold'
              ? 'Press a player marker and drag towards the angle they should hold. Select a cone to adjust or remove it.'
              : `Click the map to place a ${MARKER_LABEL[tool].toLowerCase()}.`}</p>}
          <LevelSwitch map={fields.map} level={level} board={phase.board} onChange={(l) => { commitDraft(); setLevel(l); setSelectedId(null); }} />
          <MapBoard board={phase.board} map={fields.map} level={level} players={roster} onChange={(b) => setPhase({ board: b })} tool={tool}
            selectedId={selectedId} onSelect={setSelectedId} activePlayer={active.user_id} activeSlot={active.slot} draftRoute={draft} onDraftRoute={setDraft}
            label={`Editable board for ${phase.name}`} />
          <div className="legend">
            {roster.map((r) => <span key={r.user_id}><span className="dot" style={{ background: playerColor(r.user_id) }} /> {r.user_name}</span>)}
            {slots.map((n) => <span key={`s${n}`}><span className="dot" style={{ background: ownerColor({ user_id: null, slot: n }) }} /> Player {n}</span>)}
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
            <Inspector phase={phase} selectedId={selectedId} roster={roster} slots={slots} onBoard={(b) => setPhase({ board: b })}
              onClear={() => setSelectedId(null)} teamId={teamId ?? 0} map={fields.map} />
          </Panel>
          {slots.length ? (
            <Panel title="Map player slots">
              <SlotMapper slots={slots} roster={roster} phases={phases} onApply={(m) => { setPhases(mapSlots(phases, m)); touch(); }} />
            </Panel>
          ) : null}
          <Panel title="Player instructions">
            <InstructionsForm phase={phase} roster={roster} slots={slots} onChange={(a) => setPhase({ assignments: a })} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
