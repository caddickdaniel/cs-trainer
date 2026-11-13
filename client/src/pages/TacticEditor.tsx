import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, imageUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  DEFAULT_MAP, ECONOMIES, ECONOMY_LABEL, LEVEL_LABEL, LIMITS, LINEUP_KINDS, MAPS, MARKER_KINDS, MARKER_LABEL, NOTE_SIZE, UTILITY_ICON, mapLevels, roleLabel,
  type Level,
} from '../lib/constants';
import { useDocumentTitle } from '../lib/hooks';
import type { Assignment, Board, Hold, LineupImage, Loadout, Marker, Phase, PlayerColor, PlayerColorId, PlayerRef, Point, RosterEntry, RosterResponse, Route, TacticFields } from '../lib/types';
import { BUY_LIMITS, GRENADES, GRENADE_LABEL, MAX_GRENADES, describeCounts, emptyLoadout, grenadeTotal, refKey, utilityPlan, type PlayerPlan } from '../lib/utility';
import { Alert, Loading, NeedsTeam, Panel } from '../components/ui';
import { Icon } from '../components/Icons';
import { KitIcon } from '../components/UtilityCard';
import { MapBoard, boardHolds, newId, ownerKey, sameOwner, type Tool } from '../components/MapBoard';
import { PLAYER_PALETTE, PlayerColorsProvider, assignColor, autoAssign, colorFor, colorKey } from '../lib/playerColors';
import { useEditorSplit } from '../lib/useEditorSplit';
import { draftHasWork, otherDrafts, switchMapDraft, type MapDrafts } from '../lib/mapDrafts';
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

// Player slots still used by items, instructions, buy lists or the bomb that
// no roster player owns yet.
function unmappedSlots(phases: Phase[], extra: (PlayerRef | null | undefined)[] = []) {
  const set = new Set<number>();
  for (const p of phases) {
    [...p.board.markers, ...p.board.routes, ...p.assignments].forEach((i) => { if (i.user_id == null && i.slot) set.add(i.slot); });
  }
  extra.forEach((i) => { if (i && i.user_id == null && i.slot) set.add(i.slot); });
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
  tactic_name: '', map: DEFAULT_MAP, side: 'T', economy: 'Fullbuy', grenade: 0, molly: 0, flash: 0, smoke: 0, loadouts: [], bomb_carrier: null, player_colors: [],
};

// One player's buy list (CS2 carry limits) and, for this phase, what they
// have at the start and what the board plans for them to throw.
function BuyList({ who, side, loadout, plan, phaseIndex, bomb, onChange, onBomb }: {
  who: PlayerRef; side: string; loadout: Loadout | undefined; plan: PlayerPlan | undefined; phaseIndex: number;
  bomb: boolean; onChange: (l: Loadout) => void; onBomb: (carry: boolean) => void;
}) {
  const l = loadout ?? emptyLoadout(who);
  const total = grenadeTotal(l);
  const at = plan?.phases[phaseIndex];
  const over = (plan?.over ?? []).filter((o) => o.phase === phaseIndex);
  return (
    <div className="buy-list">
      <span className="field-label">Buy list (whole round)</span>
      <div className="buy-grid">
        {GRENADES.map((g) => (
          <label key={g} className="buy-item">
            <img src={UTILITY_ICON[g]} alt="" width="18" height="18" />
            <span>{GRENADE_LABEL[g][1]}</span>
            <select aria-label={`${GRENADE_LABEL[g][1]} to buy`} value={l[g]}
              onChange={(e) => onChange({ ...l, [g]: Number(e.target.value) })}>
              {Array.from({ length: BUY_LIMITS[g] + 1 }, (_, n) => (
                <option key={n} value={n} disabled={n > l[g] && total - l[g] + n > MAX_GRENADES}>{n}</option>
              ))}
            </select>
          </label>
        ))}
        {side === 'CT' ? (
          <label className="inline-check buy-item"><input type="checkbox" checked={l.kit} onChange={(e) => onChange({ ...l, kit: e.target.checked })} />
            <KitIcon size={18} /> Defuse kit</label>
        ) : (
          <label className="inline-check buy-item"><input type="checkbox" checked={bomb} onChange={(e) => onBomb(e.target.checked)} />
            <img src="/icons/bomb.png" alt="" width="14" height="18" /> Carries the bomb</label>
        )}
      </div>
      {at ? (
        <p className="muted small">This phase: has {describeCounts(at.start) || 'no utility'}
          {grenadeTotal(at.used) ? <>; throws {describeCounts(at.used)}</> : null}.</p>
      ) : null}
      {over.map((o) => (
        <p key={o.kind} className="error-text small" role="alert">Plans {o.planned} {GRENADE_LABEL[o.kind][o.planned === 1 ? 0 : 1]} but only has {o.available} at the start of this phase.</p>
      ))}
    </div>
  );
}

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
        {(['smoke', 'flash', 'molly', 'he'] as string[]).includes(marker.kind) ? (
          <label className="inline-check small" title="A reference shows where utility lands without counting as one of the player's throws">
            <input type="checkbox" checked={Boolean(marker.reference)} onChange={(e) => set({ reference: e.target.checked || undefined })} />
            Reference only (not a planned throw)
          </label>
        ) : null}
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

// The five in-game colours as a radio group; picking a colour another player
// has swaps it with them, so every colour stays unique.
function ColorPicker({ who, name, colors, onChange }: { who: Who; name: string; colors: PlayerColor[]; onChange: (c: PlayerColor[]) => void }) {
  const mine = colors.find((c) => colorKey(c) === whoValue(who))?.color ?? null;
  const holderName = (id: PlayerColorId) => {
    const h = colors.find((c) => c.color === id && colorKey(c) !== whoValue(who));
    return h ? ` (swap with ${h.user_id != null ? 'another player' : `Player ${h.slot}`})` : '';
  };
  return (
    <div className="color-picker" role="radiogroup" aria-label={`In-game colour for ${name}`}>
      <span className="field-label">In-game colour</span>
      <div className="row tight-row">
        {PLAYER_PALETTE.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={mine === c.id} className={`swatch${mine === c.id ? ' on' : ''}`}
            style={{ background: c.hex }} title={`${c.label}${holderName(c.id)}`} aria-label={`${c.label}${holderName(c.id)}`}
            onClick={() => onChange(assignColor(colors, who, c.id))} />
        ))}
        <button type="button" role="radio" aria-checked={mine == null} className={`swatch none${mine == null ? ' on' : ''}`} title="No colour (automatic)"
          aria-label="No colour (automatic)" onClick={() => onChange(assignColor(colors, who, null))}>×</button>
      </div>
    </div>
  );
}

function InstructionsForm({ phase, phaseIndex, roster, slots, onChange, side, loadouts, bomb, plan, colors, onLoadouts, onBomb, onColors }: {
  phase: Phase; phaseIndex: number; roster: RosterEntry[]; slots: number[]; onChange: (a: Assignment[]) => void;
  side: string; loadouts: Loadout[]; bomb: PlayerRef | null; plan: Map<string, PlayerPlan>; colors: PlayerColor[];
  onLoadouts: (l: Loadout[]) => void; onBomb: (b: PlayerRef | null) => void; onColors: (c: PlayerColor[]) => void;
}) {
  const players = roster.map((r) => r.user_id);
  const keyOf = (a: { user_id: number | null; slot?: number | null }) => whoValue(a);
  const get = (who: Who) => phase.assignments.find((a) => keyOf(a) === whoValue(who));
  // Utility text and reference links are no longer edited here (they live on
  // map markers), but values saved by older versions are kept as they are.
  const set = (who: Who, patch: Partial<Assignment>) => {
    const existing = get(who) ?? { ...who, instruction: '', utility: '', reference_url: null };
    const next = { ...existing, ...patch };
    const others = phase.assignments.filter((a) => keyOf(a) !== whoValue(who));
    onChange([...others, next].sort((a, b) => keyOf(a).localeCompare(keyOf(b))));
  };
  const outsiders = phase.assignments.filter((a) => a.user_id != null && !players.includes(a.user_id));
  const fieldset = (who: Who, title: string, sub?: string) => {
    const a = get(who);
    const legacy = a && (a.utility?.trim() || a.reference_url);
    return (
      <fieldset key={whoValue(who)} className="player-fieldset">
        <legend><span className="dot" style={{ background: colorFor(who, colors) }} /> {title}{sub ? <span className="muted"> · {sub}</span> : null}
          {side === 'T' && refKey(bomb) === whoValue(who) ? <span className="bomb-tag"><img src="/icons/bomb.png" alt="" width="12" height="16" /> Bomb</span> : null}</legend>
        <label>Instruction<textarea rows={3} maxLength={2000} value={a?.instruction ?? ''} onChange={(e) => set(who, { instruction: e.target.value })}
          placeholder="What this player does in this phase" /></label>
        {a && legacy ? (
          <div className="legacy-note small">
            <span className="muted">From an older version of this tactic (kept when you save):</span>
            {a.utility?.trim() ? <span>Utility: {a.utility}</span> : null}
            {a.reference_url ? <span>Reference: <a href={a.reference_url} target="_blank" rel="noreferrer noopener">{a.reference_url}</a></span> : null}
            <button type="button" className="btn ghost small" onClick={() => set(who, { utility: '', reference_url: null })}>Remove old entry</button>
          </div>
        ) : null}
        <ColorPicker who={who} name={title} colors={colors} onChange={onColors} />
        <BuyList who={who} side={side} loadout={loadouts.find((l) => refKey(l) === whoValue(who))} plan={plan.get(whoValue(who))}
          phaseIndex={phaseIndex} bomb={refKey(bomb) === whoValue(who)}
          onChange={(l) => onLoadouts([...loadouts.filter((x) => refKey(x) !== whoValue(who)), l])}
          onBomb={(carry) => onBomb(carry ? who : null)} />
      </fieldset>
    );
  };
  const everyone: Who[] = [...roster.map((r) => ({ user_id: r.user_id, slot: null })), ...slots.map((n) => ({ user_id: null, slot: n }))];
  const missing = everyone.filter((w) => !colors.some((c) => colorKey(c) === whoValue(w)));
  return (
    <div className="stack">
      {outsiders.length ? (
        <Alert kind="warn">
          {outsiders.map((a) => a.user_name ?? `Player ${a.user_id}`).join(', ')} {outsiders.length > 1 ? 'are' : 'is'} no longer on the team; their instructions will be removed when you save.
        </Alert>
      ) : null}
      {missing.length && colors.length < PLAYER_PALETTE.length ? (
        <div className="row wrap">
          <button type="button" className="btn small" onClick={() => onColors(autoAssign(colors, everyone))}>Assign in-game colours</button>
          <span className="muted small">Gives free colours, in order, to players without one.</span>
        </div>
      ) : null}
      {roster.map((r) => fieldset({ user_id: r.user_id, slot: null }, r.user_name, roleLabel(r.player_role) || undefined))}
      {slots.map((n) => fieldset({ user_id: null, slot: n }, `Player ${n}`, 'unmapped slot'))}
    </div>
  );
}

// Maps imported Player 1-5 slots to roster players across every phase.
function SlotMapper({ slots, roster, phases, colors, onApply }: {
  slots: number[]; roster: RosterEntry[]; phases: Phase[]; colors: PlayerColor[]; onApply: (map: Record<number, number>) => void;
}) {
  const [choice, setChoice] = useState<Record<number, number>>({});
  const used = new Set(phases.flatMap((p) => [...p.board.markers, ...p.board.routes, ...p.assignments]
    .filter((i) => i.user_id != null).map((i) => i.user_id as number)));
  const picked = Object.values(choice);
  const dupes = picked.filter((v, i) => picked.indexOf(v) !== i);
  return (
    <div className="stack">
      <p className="small muted">This tactic was imported. Choose who plays each slot; until then the slot stays editable as “Player N”.
        Mapping moves the slot's markers, routes, holds, utility, colour and instructions to that player in every phase.</p>
      {slots.map((n) => (
        <label key={n} className="row">
          <span className="dot" style={{ background: colorFor({ user_id: null, slot: n }, colors) }} /> Player {n}
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

export const mapRef = <T extends { user_id: number | null; slot?: number | null }>(i: T, mapping: Record<number, number>): T => (
  i.user_id == null && i.slot && mapping[i.slot] ? { ...i, user_id: mapping[i.slot], slot: null } : i);

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
  // Create Tactic only: the boards of other maps visited in this flow.
  const [mapDrafts, setMapDrafts] = useState<MapDrafts>({});
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
            loadouts: t.loadouts ?? [], bomb_carrier: t.bomb_carrier ?? null, player_colors: t.player_colors ?? [],
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
  const loadouts = useMemo(() => fields.loadouts ?? [], [fields.loadouts]);
  const bomb = fields.side === 'T' ? fields.bomb_carrier ?? null : null;
  const slots = useMemo(() => unmappedSlots(phases, [...loadouts, bomb]), [phases, loadouts, bomb]);
  const plan = useMemo(() => utilityPlan(loadouts, phases), [loadouts, phases]);
  const colors = useMemo(() => fields.player_colors ?? [], [fields.player_colors]);
  const { setLayout, stacked, style: splitStyle, dividerProps } = useEditorSplit();
  const keptDrafts = isNew ? otherDrafts(mapDrafts, fields.map, draftHasWork) : [];
  const overPlans = [...plan.values()].reduce((n, p) => n + p.over.length, 0);

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
    const keep = (r: PlayerRef | null | undefined) => Boolean(r && (r.user_id != null ? memberIds.has(r.user_id) : r.slot));
    const payload = {
      ...fields,
      // Players who buy nothing are left out; kits are CT only.
      loadouts: loadouts.filter((l) => keep(l) && (grenadeTotal(l) || (fields.side === 'CT' && l.kit)))
        .map((l) => ({ user_id: l.user_id ?? null, slot: l.user_id != null ? null : l.slot ?? null, smoke: l.smoke, flash: l.flash, molly: l.molly, he: l.he, kit: fields.side === 'CT' && l.kit })),
      bomb_carrier: fields.side === 'T' && keep(bomb) ? { user_id: bomb!.user_id ?? null, slot: bomb!.user_id != null ? null : bomb!.slot ?? null } : null,
      player_colors: colors.filter(keep).map((c) => ({ user_id: c.user_id ?? null, slot: c.user_id != null ? null : c.slot ?? null, color: c.color })),
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
      // Only the selected map was saved; the other maps' drafts are dropped.
      setMapDrafts({});
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

  // Create Tactic: each map keeps its own board and phases. The first visit
  // to a map starts clean; returning restores what was drawn there.
  const switchMapDraftTo = (map: string) => {
    let current = phases;
    if (draft.length >= 2 && phase.board.routes.length < LIMITS.routes) {
      const route: Route = { id: newId('r'), level, ...active, color: '#ffffff', points: draft };
      current = phases.map((p, i) => (i === index ? { ...p, board: { ...p.board, routes: [...p.board.routes, route] } } : p));
    }
    setDraft([]);
    const { drafts, next } = switchMapDraft(mapDrafts, fields.map, { phases: current, index, level }, map,
      () => ({ phases: [newPhase(1)], index: 0, level: 'main' }));
    setMapDrafts(drafts);
    setPhases(next.phases);
    setIndex(Math.min(next.index, next.phases.length - 1));
    setLevel(mapLevels(map).includes(next.level) ? next.level : 'main');
    setSelectedId(null);
    setFields({ ...fields, map });
    touch();
  };

  // Editing a saved tactic: the board stays and moves to the new map;
  // switching to a map without a lower level moves lower-level items to main.
  const changeMap = (map: string) => {
    if (isNew) { switchMapDraftTo(map); return; }
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

  // Line icons for tools without a supplied symbol; the grenade tools reuse
  // the supplied utility icons.
  const TOOL_ICON: Record<string, string> = { select: 'select', route: 'route', hold: 'hold', player: 'player', note: 'note' };
  const tools: { id: Tool; label: string }[] = [
    { id: 'select', label: 'Select / move' },
    { id: 'route', label: 'Draw route' },
    { id: 'hold', label: 'Hold' },
    ...MARKER_KINDS.map((k) => ({ id: k as Tool, label: MARKER_LABEL[k] })),
  ];

  return (
    <PlayerColorsProvider colors={colors}>
    <div className="stack editor-page">
      <Alert kind="warn">{notice}</Alert>
      <Alert>{error}</Alert>

      <div className="panel editor-bar">
        <h1 className="sr-only">{isNew ? 'New tactic' : 'Edit tactic'}</h1>
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
        </div>
        <div className="row editor-actions">
          {keptDrafts.length ? (
            <span className="muted small kept-drafts" role="status">
              Drafts kept for {keptDrafts.map((m) => MAPS.find((x) => x.id === m)?.name ?? m).join(', ')}. Save keeps only {MAPS.find((x) => x.id === fields.map)?.name ?? fields.map}.
            </span>
          ) : null}
          <Link className="btn ghost" to={isNew ? '/tactics' : `/tactics/${tacticId}`}>Cancel</Link>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : dirty || isNew ? 'Save tactic' : 'Saved'}</button>
        </div>
      </div>

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

      <div className={`board-layout editor${stacked ? ' stacked' : ''}`} ref={setLayout} style={splitStyle}>
        <div className="tool-rail">
          <div className="toolbar vertical" role="toolbar" aria-label="Board tools" aria-orientation="vertical">
            {tools.map((t) => (
              <button key={t.id} type="button" className={tool === t.id ? 'on' : ''} aria-pressed={tool === t.id} onClick={() => chooseTool(t.id)} title={t.label}>
                <span className="tool-icon" aria-hidden="true">
                  {UTILITY_ICON[t.id] ? <img src={UTILITY_ICON[t.id]} alt="" width="18" height="18" /> : <Icon name={TOOL_ICON[t.id]} />}
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <label>New items for
            <select value={whoValue(active)} onChange={(e) => setActive(parseWho(e.target.value))} aria-label="New items belong to">
              <option value="">No player</option>
              {roster.map((r) => <option key={r.user_id} value={`u${r.user_id}`}>{r.user_name}</option>)}
              {slots.map((n) => <option key={n} value={`s${n}`}>Player {n}</option>)}
            </select>
          </label>
          <LevelSwitch map={fields.map} level={level} board={phase.board} onChange={(l) => { commitDraft(); setLevel(l); setSelectedId(null); }} />
          {tool === 'route' ? (
            <div className="stack tight hint">
              <span className="muted small">Click the map to add points ({draft.length}). Enter or Finish to complete, Esc to cancel.</span>
              <div className="row">
                <button type="button" className="btn small" disabled={draft.length < 2} onClick={commitDraft}>Finish route</button>
                <button type="button" className="btn ghost small" disabled={!draft.length} onClick={() => setDraft([])}>Cancel</button>
              </div>
            </div>
          ) : <p className="muted small hint">{tool === 'select'
            ? 'Drag markers or route handles to move them. Dotted lines join each player to their utility.'
            : tool === 'hold'
              ? 'Press a player marker and drag towards the angle they should hold. Select a cone to adjust or remove it.'
              : `Click the map to place ${tool === 'he' ? 'an' : 'a'} ${MARKER_LABEL[tool]}.`}</p>}
          <div className="legend vertical">
            {roster.map((r) => <span key={r.user_id}><span className="dot" style={{ background: colorFor({ user_id: r.user_id }, colors) }} /> {r.user_name}</span>)}
            {slots.map((n) => <span key={`s${n}`}><span className="dot" style={{ background: colorFor({ user_id: null, slot: n }, colors) }} /> Player {n}</span>)}
          </div>
        </div>
        <div className="board-cell">
          <MapBoard board={phase.board} map={fields.map} level={level} players={roster} onChange={(b) => setPhase({ board: b })} tool={tool}
            selectedId={selectedId} onSelect={setSelectedId} activePlayer={active.user_id} activeSlot={active.slot} draftRoute={draft} onDraftRoute={setDraft}
            label={`Editable board for ${phase.name}`} bomb={bomb} />
        </div>
        {!stacked ? <div className="split-divider" {...dividerProps}><span aria-hidden="true" /></div> : null}
        <div className="stack editor-side">
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
              <SlotMapper slots={slots} roster={roster} phases={phases} colors={colors} onApply={(m) => {
                setPhases(mapSlots(phases, m));
                // A slot's colour moves to its player (replacing any colour that player had).
                const mapped = colors.map((c) => mapRef(c, m));
                const newOwners = new Set(mapped.filter((c, i) => c !== colors[i]).map((c) => colorKey(c)));
                setFields({
                  ...fields, loadouts: loadouts.map((l) => mapRef(l, m)), bomb_carrier: fields.bomb_carrier ? mapRef(fields.bomb_carrier, m) : null,
                  player_colors: mapped.filter((c, i) => c !== colors[i] || !newOwners.has(colorKey(c))),
                });
                touch();
              }} />
            </Panel>
          ) : null}
          <Panel title="Player instructions" className="scroll-panel">
            {overPlans ? <Alert kind="warn">This plan uses more utility than {overPlans === 1 ? 'a player buys' : 'players buy'} ({overPlans} issue{overPlans === 1 ? '' : 's'}). Check the buy lists below.</Alert> : null}
            <InstructionsForm phase={phase} phaseIndex={Math.min(index, phases.length - 1)} roster={roster} slots={slots} onChange={(a) => setPhase({ assignments: a })}
              side={fields.side} loadouts={loadouts} bomb={bomb} plan={plan} colors={colors}
              onColors={(c) => { setFields({ ...fields, player_colors: c }); touch(); }}
              onLoadouts={(l) => { setFields({ ...fields, loadouts: l }); touch(); }}
              onBomb={(b) => { setFields({ ...fields, bomb_carrier: b }); touch(); }} />
          </Panel>
        </div>
      </div>
    </div>
    </PlayerColorsProvider>
  );
}
