import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { BOUNCE_POINTS, findMap, LIMITS, NOTE_SIZE, radarUrl, type Level } from '../lib/constants';
import { isTyping } from '../lib/shortcuts';
import { useUtilityGlyph } from './UtilityIcon';
import { fallbackColor, textOn, usePlayerColors } from '../lib/playerColors';
import type { Board, Hold, Marker, MarkerKind, Point, Route } from '../lib/types';
import { PracticeYardMap } from './PracticeYardMap';
import { landmarksFor } from '../lib/landmarks';

export type Tool = 'select' | 'route' | 'hold' | 'drop' | 'lineup' | MarkerKind;

const SIZE = 1000;
const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
let idCounter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// Fallback colour (no in-game colour set on the tactic), derived from the user
// id. Pages showing a tactic use usePlayerColors() for the tactic's colours.
export function playerColor(userId: number | null) {
  return fallbackColor({ user_id: userId });
}

// Board items belong to a roster player (user_id) or, in shared and imported
// tactics, to a player slot (Player 1-5) that is not mapped yet.
type Owned = { user_id: number | null; slot?: number | null };
export const ownerKey = (item: Owned) => (item.user_id != null ? `u${item.user_id}` : item.slot ? `s${item.slot}` : null);
export const ownerColor = (item: Owned) => fallbackColor(item);
export const sameOwner = (a: Owned, b: Owned) => ownerKey(a) != null && ownerKey(a) === ownerKey(b);

const levelOf = (item: { level?: Level }) => item.level ?? 'main';
const UTILITY_KINDS = ['smoke', 'flash', 'molly', 'he'];
export const noteSize = (m: Marker) => m.size ?? NOTE_SIZE.default;
export const boardHolds = (b: Board): Hold[] => b.holds ?? [];

// Where a player's utility is thrown from: the end of their last route in the
// phase if they have one, otherwise their player marker.
export function throwOrigin(board: Board, owner: Owned): { x: number; y: number; level: Level } | null {
  const routes = board.routes.filter((r) => sameOwner(r, owner) && r.points.length);
  const route = routes[routes.length - 1];
  if (route) {
    const p = route.points[route.points.length - 1];
    return { x: p.x, y: p.y, level: levelOf(route) };
  }
  const marker = board.markers.find((m) => m.kind === 'player' && sameOwner(m, owner));
  return marker ? { x: marker.x, y: marker.y, level: levelOf(marker) } : null;
}

// Keeps a square board within the window height on desktop, so the map and
// the controls above it fit on one screen without scrolling. Narrow screens
// stack and scroll instead.
export function useFitToViewport<T extends HTMLElement>(reserve = 16) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => {
      if (window.innerWidth < 900) { el.style.maxWidth = ''; return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.maxWidth = `${Math.max(360, Math.floor(window.innerHeight - top - reserve))}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (el.parentElement) ro?.observe(el.parentElement);
    return () => { window.removeEventListener('resize', apply); ro?.disconnect(); };
  }, [reserve]);
  return ref;
}

// Spawn and bombsite landmarks: a fixed background layer drawn with the radar,
// never interactive, so clicks fall through to the board below.
export function MapLandmarks({ map, level }: { map: string; level: Level }) {
  const points = landmarksFor(map, level);
  if (!points.length) return null;
  return (
    <g className="landmarks" pointerEvents="none" aria-hidden="true" data-landmarks={map}>
      {points.map((p) => {
        const cx = p.x * SIZE;
        const cy = p.y * SIZE;
        if (p.kind === 'ct' || p.kind === 't') {
          const r = 26;
          return (
            <g key={p.kind} transform={`translate(${cx},${cy})`} data-landmark={p.kind} opacity="0.92">
              <circle r={r + 3} fill="#000" opacity="0.45" />
              <image href={`/icons/spawn-${p.kind}.png`} x={-r} y={-r} width={r * 2} height={r * 2} />
            </g>
          );
        }
        const letter = p.kind.toUpperCase();
        return (
          <g key={p.kind} transform={`translate(${cx},${cy})`} data-landmark={p.kind} opacity="0.9">
            <circle r="25" fill="#111" fillOpacity="0.7" stroke="#e5484d" strokeWidth="4" />
            <text y="12" textAnchor="middle" fontSize="34" fontWeight="800" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">{letter}</text>
          </g>
        );
      })}
    </g>
  );
}

// Radar image (or the original schematic) for one map level, in the board's
// 1000x1000 space, with the map's landmarks. All levels of a map share the
// same coordinate frame.
export function MapBackground({ map, level, landmarks = true }: { map: string; level: Level; landmarks?: boolean }) {
  const def = findMap(map);
  if (!def || !def.radar) return <PracticeYardMap />;
  return (
    <g aria-hidden="true">
      <rect width={SIZE} height={SIZE} fill="#000" />
      <image href={radarUrl(def.id, level)} x="0" y="0" width={SIZE} height={SIZE} preserveAspectRatio="none" />
      {landmarks ? <MapLandmarks map={def.id} level={level} /> : null}
    </g>
  );
}

// The bomb carrier's badge: half the old size, immediately right of the
// player marker (radius 22) with a slight overlap. It is drawn inside the
// marker's group, so it moves, changes floor and scales with the marker.
export const BOMB_BADGE = { x: 27, y: 0, w: 14, h: 16 };
function BombBadge() {
  const { x, y, w, h } = BOMB_BADGE;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none" data-bomb-badge="">
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="3" fill="#111" stroke="#e5484d" strokeWidth="1.5" />
      <image href="/icons/bomb.png" x={-5} y={-6.5} width={10} height={13} />
    </g>
  );
}

// Cone path for a hold anchored at (cx, cy) in board units.
export function conePath(cx: number, cy: number, hold: Pick<Hold, 'angle' | 'spread' | 'length'>) {
  const r = hold.length * SIZE;
  const a0 = ((hold.angle - hold.spread / 2) * Math.PI) / 180;
  const a1 = ((hold.angle + hold.spread / 2) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = hold.spread > 180 ? 1 : 0;
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
}

// Utility icon on a disc with a ring in the player's colour, so it stays
// legible over light and dark parts of the radar: the CS2 icon (white) on a
// dark disc, or the app's own (black) icon on a light one. `side` picks
// molotov (T) or incendiary (CT) for fire; `variant` overrides it.
export function UtilityGlyph({ kind, color, r = 20, side, variant }: { kind: string; color: string; r?: number; side?: string | null; variant?: string | null }) {
  const { href, dark, onError } = useUtilityGlyph(kind, side, variant);
  return (
    <g data-utility-icon={dark ? 'cs2' : 'legacy'}>
      <circle r={r + 3} fill="#000" opacity="0.35" />
      <circle r={r} fill={dark ? '#1a1d22' : '#f4f6f8'} stroke={color} strokeWidth="4" />
      {href ? <image href={href} x={-r * 0.7} y={-r * 0.7} width={r * 1.4} height={r * 1.4} preserveAspectRatio="xMidYMid meet" onError={onError} /> : null}
    </g>
  );
}

// Multi-line note text with a dark outline for contrast.
function NoteText({ text, size, placeholder }: { text: string; size: number; placeholder?: boolean }) {
  const lines = (text || (placeholder ? 'Note' : '')).split('\n');
  const startY = -((lines.length - 1) * size * 1.2) / 2 + size * 0.35;
  return (
    <text textAnchor="middle" fontSize={size} fontWeight="700" fill={placeholder && !text ? '#ffffff88' : '#fff'}
      stroke="#000" strokeWidth={Math.max(3, size / 5)} paintOrder="stroke" strokeLinejoin="round">
      {lines.map((line, i) => <tspan key={i} x="0" y={startY + i * size * 1.2}>{line || ' '}</tspan>)}
    </text>
  );
}
export function noteBox(m: Marker) {
  const size = noteSize(m);
  const lines = (m.label || 'Note').split('\n');
  const w = Math.max(...lines.map((l) => l.length), 2) * size * 0.6 + 16;
  const h = lines.length * size * 1.2 + 10;
  return { w, h };
}

interface Props {
  board: Board;
  map: string;
  level?: Level;
  // View mode: called when a marker with lineup screenshots is activated.
  onMarkerActivate?: (marker: Marker) => void;
  players: { user_id: number; user_name: string }[];
  // Editing is enabled when onChange is provided.
  onChange?: (board: Board) => void;
  tool?: Tool;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  // New items are attributed to this player (user id) or slot.
  activePlayer?: number | null;
  activeSlot?: number | null;
  highlightUserId?: number | null;
  draftRoute?: Point[];
  onDraftRoute?: (points: Point[]) => void;
  label?: string;
  // Extra SVG drawn above the board (e.g. demo annotations).
  overlay?: ReactNode;
  // T tactics: the player carrying the bomb (shown as a badge on their marker).
  bomb?: Owned | null;
  // Space to keep free under the board when fitting it to the window.
  fitReserve?: number;
  // The tactic's side: fire markers show a molotov (T) or an incendiary (CT).
  side?: string | null;
  // Items lying on the map: dropped in earlier phases and not picked up, or
  // (during Play Phase) dropped so far in this one.
  ground?: { id: string; kind: string; x: number; y: number; level: string }[];
  // While set, a click on the board places something (e.g. a drop) here
  // instead of using the current tool.
  onPlace?: (p: Point) => void;
  // Play Phase is running: hold cones pulse.
  playing?: boolean;
}

type Drag =
  | { kind: 'marker'; id: string }
  | { kind: 'point'; id: string; index: number }
  | { kind: 'hold-tip'; id: string }
  | { kind: 'hold-edge'; id: string }
  | { kind: 'bounce'; id: string; index: number }
  | { kind: 'action'; id: string };

// The points a utility throw is drawn through: the thrower (route end or
// player marker, when on this floor), each bounce point, then the marker.
export function throwPath(board: Board, m: Marker, level: Level) {
  const from = throwOrigin(board, m);
  const pts = [...(from && from.level === level ? [{ x: from.x, y: from.y }] : []), ...(m.path ?? []), { x: m.x, y: m.y }];
  return { points: pts, hasOrigin: Boolean(from && from.level === level) };
}

export function MapBoard({
  board, map, level = 'main', onMarkerActivate, players, onChange, tool = 'select', selectedId = null, onSelect,
  activePlayer = null, activeSlot = null, highlightUserId = null, draftRoute = [], onDraftRoute, label = 'Tactics board', overlay, bomb = null, fitReserve = 16, side = null,
  ground = [], onPlace, playing = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useFitToViewport<HTMLDivElement>(fitReserve);
  const [drag, setDrag] = useState<Drag | null>(null);
  const editable = Boolean(onChange);
  // A utility throw being placed: each click adds a point; Enter makes the last
  // point the landing spot (the others are bounces); Backspace removes the
  // latest point; Escape cancels. Kept per tool, so switching tools drops it.
  const [throwDraft, setThrowDraft] = useState<{ kind: MarkerKind; level: Level; points: Point[] } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const activeThrow = throwDraft && throwDraft.kind === tool && throwDraft.level === level && editable ? throwDraft : null;
  const isUtilityTool = UTILITY_KINDS.includes(tool);
  const colorOf = usePlayerColors();
  const holds = boardHolds(board);
  const initials = (item: Owned) => {
    if (item.user_id == null) return item.slot ? `P${item.slot}` : '';
    const p = players.find((x) => x.user_id === item.user_id);
    return p ? p.user_name.slice(0, 2).toUpperCase() : '';
  };

  // Converts a pointer position to normalised map coordinates. Works at any
  // rendered size because it uses the SVG's own transform.
  const toPoint = useCallback((e: { clientX: number; clientY: number }): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: round(pt.x / SIZE), y: round(pt.y / SIZE) };
  }, []);

  const update = (next: Partial<Board>) => onChange?.({ ...board, holds, ...next });

  const handleBackgroundDown = (e: PointerEvent<SVGSVGElement>) => {
    if (onPlace && e.button === 0) {
      const at = toPoint(e);
      if (at) onPlace(at);
      return;
    }
    if (!editable || e.button !== 0) return;
    const p = toPoint(e);
    if (!p) return;
    if (tool === 'select' || tool === 'hold') {
      onSelect?.(null);
    } else if (tool === 'route') {
      if (draftRoute.length < LIMITS.routePoints) onDraftRoute?.([...draftRoute, p]);
    } else if (isUtilityTool) {
      if (board.markers.length >= LIMITS.markers) return;
      const points = activeThrow ? activeThrow.points : [];
      if (points.length > BOUNCE_POINTS) return;
      setThrowDraft({ kind: tool as MarkerKind, level, points: [...points, p] });
      setCursor(p);
      svgRef.current?.focus({ preventScroll: true });
    } else if (tool !== 'drop' && tool !== 'lineup' && board.markers.length < LIMITS.markers) {
      const marker: Marker = {
        id: newId('m'), kind: tool as MarkerKind, x: p.x, y: p.y, level, user_id: activePlayer, slot: activePlayer == null ? activeSlot : null,
        label: '', images: [], ...(tool === 'note' ? { size: NOTE_SIZE.default } : {}),
      };
      update({ markers: [...board.markers, marker] });
      onSelect?.(marker.id);
    }
  };

  const startDrag = (e: PointerEvent, next: Drag, selectId: string) => {
    if (!editable) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect?.(selectId);
    setDrag(next);
  };

  // Places the utility: the last point is where it lands, the rest are bounces.
  const finishThrow = useCallback(() => {
    if (!activeThrow || !activeThrow.points.length || !onChange) return;
    const pts = activeThrow.points;
    const end = pts[pts.length - 1];
    const marker: Marker = {
      id: newId('m'), kind: activeThrow.kind, x: end.x, y: end.y, level, user_id: activePlayer, slot: activePlayer == null ? activeSlot : null,
      label: '', images: [], ...(pts.length > 1 ? { path: pts.slice(0, -1) } : {}),
    };
    onChange({ ...board, holds: boardHolds(board), markers: [...board.markers, marker] });
    onSelect?.(marker.id);
    setThrowDraft(null);
  }, [activeThrow, onChange, board, level, activePlayer, activeSlot, onSelect]);

  // Throw keys while placing (not while typing in a field): Enter finishes,
  // Backspace removes the latest point, Escape cancels. Other keys untouched.
  useEffect(() => {
    if (!activeThrow) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finishThrow(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setThrowDraft(null); }
      else if (e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        setThrowDraft((d) => (d && d.points.length > 1 ? { ...d, points: d.points.slice(0, -1) } : null));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeThrow, finishThrow]);

  const handleMove = (e: PointerEvent<SVGSVGElement>) => {
    if (activeThrow) {
      const c = toPoint(e);
      if (c) setCursor(c);
    }
    if (!drag) return;
    const p = toPoint(e);
    if (!p) return;
    if (drag.kind === 'bounce') {
      update({ markers: board.markers.map((m) => (m.id === drag.id && m.path ? { ...m, path: m.path.map((pt, i) => (i === drag.index ? p : pt)) } : m)) });
      return;
    }
    if (drag.kind === 'action') {
      update({ actions: (board.actions ?? []).map((a) => (a.id === drag.id ? { ...a, x: p.x, y: p.y } : a)) });
      return;
    }
    if (drag.kind === 'marker') {
      update({ markers: board.markers.map((m) => (m.id === drag.id ? { ...m, x: p.x, y: p.y } : m)) });
    } else if (drag.kind === 'point') {
      update({
        routes: board.routes.map((r) => (r.id === drag.id
          ? { ...r, points: r.points.map((pt, i) => (i === drag.index ? p : pt)) }
          : r)),
      });
    } else {
      const hold = holds.find((h) => h.id === drag.id);
      const anchor = hold && board.markers.find((m) => m.id === hold.marker_id);
      if (!hold || !anchor) return;
      const dx = p.x - anchor.x;
      const dy = p.y - anchor.y;
      const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      const next = drag.kind === 'hold-tip'
        ? { angle, length: Math.round(Math.min(0.6, Math.max(0.02, Math.hypot(dx, dy))) * 1000) / 1000 }
        : { spread: Math.round(Math.min(180, Math.max(5, 2 * Math.abs((((angle - hold.angle) % 360) + 540) % 360 - 180)))) };
      update({ holds: holds.map((h) => (h.id === hold.id ? { ...h, ...next } : h)) });
    }
  };

  useEffect(() => {
    if (!drag) return undefined;
    const end = () => setDrag(null);
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [drag]);

  // Arrow keys nudge the selected marker (keyboard alternative to dragging).
  const handleKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!editable || !selectedId) return;
    const marker = board.markers.find((m) => m.id === selectedId);
    const step = e.shiftKey ? 0.05 : 0.01;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (marker && delta[e.key]) {
      e.preventDefault();
      const [dx, dy] = delta[e.key];
      update({ markers: board.markers.map((m) => (m.id === marker.id ? { ...m, x: round(m.x + dx), y: round(m.y + dy) } : m)) });
    }
  };

  // Only items on the level being shown are drawn.
  const markers = board.markers.filter((m) => levelOf(m) === level);
  const routes = board.routes.filter((r) => levelOf(r) === level);

  const dim = (item: Owned) => highlightUserId != null && item.user_id !== highlightUserId;

  const renderRoute = (route: Route, draft = false) => {
    const color = ownerKey(route) ? colorOf(route) : route.color;
    const pts = route.points.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ');
    const selected = route.id === selectedId;
    const last = route.points[route.points.length - 1];
    const prev = route.points[route.points.length - 2];
    const angle = last && prev ? (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI : 0;
    return (
      <g key={route.id} opacity={dim(route) ? 0.3 : 1} data-route-id={route.id}>
        <polyline points={pts} fill="none" stroke="transparent" strokeWidth="24"
          style={{ cursor: editable && tool === 'select' ? 'pointer' : undefined }}
          onPointerDown={(e) => { if (editable && tool === 'select') { e.stopPropagation(); onSelect?.(route.id); } }} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={selected ? 7 : 5}
          strokeDasharray={draft ? '12 8' : undefined} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        {last && prev ? (
          <polygon points="0,-11 20,0 0,11" fill={color} pointerEvents="none"
            transform={`translate(${last.x * SIZE},${last.y * SIZE}) rotate(${angle})`} />
        ) : null}
        {(selected || draft) && editable
          ? route.points.map((p, i) => (
            <circle key={i} cx={p.x * SIZE} cy={p.y * SIZE} r={11} fill="#111" stroke={color} strokeWidth="3"
              style={{ cursor: 'grab' }} data-point-index={i}
              onPointerDown={(e) => !draft && tool === 'select' && startDrag(e, { kind: 'point', id: route.id, index: i }, route.id)} />
          ))
          : null}
      </g>
    );
  };

  // Dotted throw line from where a player throws (route end or marker),
  // through any bounce points, to each utility marker. Bounce points get a
  // small ring; when the marker is selected they can be dragged.
  const connectors = board.markers.filter((m) => UTILITY_KINDS.includes(m.kind) && levelOf(m) === level && !m.reference && (ownerKey(m) || m.path?.length))
    .map((m) => {
      const { points } = throwPath(board, m, level);
      if (points.length < 2) return null;
      const pts = points.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ');
      const color = colorOf(m);
      const selected = m.id === selectedId;
      const bounces = m.path ?? [];
      return (
        <g key={`c-${m.id}`} opacity={dim(m) ? 0.25 : 1} data-connector-for={m.id} data-bounces={bounces.length}>
          {/* Round dots (zero-length dashes) with a dark outline: visible on any
              part of the radar and unlike the solid, arrowed movement routes. */}
          <polyline points={pts} fill="none" stroke="#000" strokeOpacity="0.7" strokeWidth="9" strokeDasharray="0 14" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          <polyline points={pts} fill="none" stroke={color} strokeWidth="6" strokeDasharray="0 14" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
          {bounces.map((b, i) => (
            <g key={i} transform={`translate(${b.x * SIZE},${b.y * SIZE})`} data-bounce-index={i}
              style={{ cursor: editable && selected && tool === 'select' ? 'grab' : undefined }}
              pointerEvents={editable && selected && tool === 'select' ? 'all' : 'none'}
              onPointerDown={(e) => { if (editable && selected && tool === 'select') startDrag(e, { kind: 'bounce', id: m.id, index: i }, m.id); }}>
              {editable && selected ? <circle r="20" fill="transparent" /> : null}
              <circle r={selected && editable ? 9 : 6} fill="#111" stroke={color} strokeWidth={selected && editable ? 4 : 3} />
            </g>
          ))}
        </g>
      );
    });

  // The throw being placed: points so far, a dashed preview to the cursor and
  // the utility where it would land if Enter were pressed now.
  const throwPreview = activeThrow ? (() => {
    const from = throwOrigin(board, { user_id: activePlayer, slot: activePlayer == null ? activeSlot : null });
    const start = from && from.level === level ? [{ x: from.x, y: from.y }] : [];
    const fixed = [...start, ...activeThrow.points];
    const last = fixed[fixed.length - 1];
    const color = activePlayer != null || activeSlot ? colorOf({ user_id: activePlayer, slot: activePlayer == null ? activeSlot : null }) : '#ffffff';
    return (
      <g pointerEvents="none" data-throw-draft={activeThrow.points.length}>
        {fixed.length > 1 ? <polyline points={fixed.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ')} fill="none" stroke={color} strokeWidth="5" strokeDasharray="2 10" strokeLinecap="round" /> : null}
        {cursor && last ? <line x1={last.x * SIZE} y1={last.y * SIZE} x2={cursor.x * SIZE} y2={cursor.y * SIZE} stroke="#fff" strokeWidth="3" strokeDasharray="8 8" opacity="0.8" /> : null}
        {activeThrow.points.slice(0, -1).map((p, i) => <circle key={i} cx={p.x * SIZE} cy={p.y * SIZE} r="8" fill="#111" stroke={color} strokeWidth="3" />)}
        <g transform={`translate(${last.x * SIZE},${last.y * SIZE})`} opacity="0.85"><UtilityGlyph kind={activeThrow.kind} color={color} side={side} /></g>
      </g>
    );
  })() : null;

  const renderHold = (h: Hold) => {
    const anchor = board.markers.find((m) => m.id === h.marker_id);
    if (!anchor || levelOf(anchor) !== level) return null;
    const color = colorOf(anchor);
    const cx = anchor.x * SIZE;
    const cy = anchor.y * SIZE;
    const selected = h.id === selectedId;
    const r = h.length * SIZE;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const tip = { x: cx + r * Math.cos(rad(h.angle)), y: cy + r * Math.sin(rad(h.angle)) };
    const edge = { x: cx + r * Math.cos(rad(h.angle + h.spread / 2)), y: cy + r * Math.sin(rad(h.angle + h.spread / 2)) };
    return (
      <g key={h.id} opacity={dim(anchor) ? 0.3 : 1} data-hold-id={h.id}>
        <path d={conePath(cx, cy, h)} className={playing ? 'hold-cone pulsing' : 'hold-cone'} fill={color} fillOpacity={selected ? 0.38 : 0.26} stroke={color} strokeWidth={selected ? 4 : 2.5}
          strokeDasharray="10 5" style={{ cursor: editable && (tool === 'select' || tool === 'hold') ? 'pointer' : undefined }}
          onPointerDown={(e) => { if (editable && (tool === 'select' || tool === 'hold')) { e.stopPropagation(); onSelect?.(h.id); } }} />
        {selected && editable ? (
          <>
            {/* Visible handles with larger invisible hit areas for mouse and touch. */}
            <g style={{ cursor: 'grab' }} aria-label="Hold direction and reach" onPointerDown={(e) => startDrag(e, { kind: 'hold-tip', id: h.id }, h.id)}>
              <circle cx={tip.x} cy={tip.y} r={30} fill="transparent" />
              <circle cx={tip.x} cy={tip.y} r={16} fill="#111" stroke="#fff" strokeWidth="4" />
            </g>
            <g style={{ cursor: 'grab' }} aria-label="Hold width" onPointerDown={(e) => startDrag(e, { kind: 'hold-edge', id: h.id }, h.id)}>
              <circle cx={edge.x} cy={edge.y} r={28} fill="transparent" />
              <circle cx={edge.x} cy={edge.y} r={14} fill={color} stroke="#111" strokeWidth="4" />
            </g>
          </>
        ) : null}
      </g>
    );
  };

  const renderMarker = (m: Marker) => {
    const color = colorOf(m);
    const selected = m.id === selectedId;
    const hasImages = Boolean(m.images?.length);
    const activatable = !editable && hasImages && Boolean(onMarkerActivate);
    const cx = m.x * SIZE;
    const cy = m.y * SIZE;
    let shape;
    let ring = 50;
    switch (m.kind) {
      case 'smoke':
        shape = <><circle r="44" fill="#c9d0d8" opacity="0.4" /><circle r="44" fill="none" stroke={color} strokeWidth="3" /><UtilityGlyph kind="smoke" color={color} side={side} /></>;
        break;
      case 'molly':
        shape = <><circle r="34" fill="#e8833a" opacity="0.4" /><UtilityGlyph kind="molly" color={color} side={side} /></>;
        break;
      case 'flash':
      case 'he':
        shape = <UtilityGlyph kind={m.kind} color={color} side={side} />;
        ring = 32;
        break;
      case 'note': {
        const { w, h } = noteBox(m);
        shape = (
          <>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="6" fill={editable ? '#00000055' : 'transparent'}
              stroke={editable ? color : 'none'} strokeWidth="2" strokeDasharray="4 4" />
            <NoteText text={m.label} size={noteSize(m)} placeholder={editable} />
          </>
        );
        ring = Math.max(w, h) / 2 + 10;
        break;
      }
      default:
        shape = <><circle r="22" fill={color} stroke="#111" strokeWidth="3" /><text y="7" textAnchor="middle" fontSize="18" fontWeight="700" fill={textOn(color)}>{initials(m)}</text></>;
        ring = 32;
    }
    const holdTarget = editable && tool === 'hold' && m.kind === 'player';
    return (
      <g key={m.id} transform={`translate(${cx},${cy})`} opacity={dim(m) ? 0.3 : m.reference ? 0.6 : 1}
        style={{ cursor: editable && tool === 'select' ? 'grab' : holdTarget ? 'crosshair' : activatable ? 'pointer' : undefined }} data-marker-id={m.id}
        role={activatable ? 'button' : undefined} tabIndex={activatable ? 0 : undefined}
        aria-label={activatable ? `Show lineup for ${m.label || m.kind}` : undefined}
        onKeyDown={(e) => { if (activatable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onMarkerActivate?.(m); } }}
        onPointerDown={(e) => {
          if (activatable) { e.stopPropagation(); onMarkerActivate?.(m); return; }
          if (holdTarget) {
            // Hold tool: press a player and drag towards the angle to cover.
            if (holds.length >= LIMITS.holds) return;
            const hold: Hold = { id: newId('h'), marker_id: m.id, angle: 0, spread: 50, length: 0.1 };
            update({ holds: [...holds, hold] });
            startDrag(e, { kind: 'hold-tip', id: hold.id }, hold.id);
            return;
          }
          if (tool === 'select') startDrag(e, { kind: 'marker', id: m.id }, m.id);
        }}>
        {selected && m.kind === 'note' ? (() => {
          const { w, h } = noteBox(m);
          return <rect x={-w / 2 - 8} y={-h / 2 - 8} width={w + 16} height={h + 16} rx="8" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="8 6" />;
        })() : null}
        {selected && m.kind !== 'note' ? <circle r={ring} fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="8 6" /> : null}
        {shape}
        {m.kind === 'player' && bomb && sameOwner(m, bomb) ? <BombBadge /> : null}
        {m.reference ? <text y={m.kind === 'smoke' ? -50 : -30} textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">ref</text> : null}
        {hasImages ? (
          <g transform="translate(24,-30)" pointerEvents="none">
            <rect x="-13" y="-10" width="26" height="20" rx="4" fill="#111" stroke="#fff" strokeWidth="2" />
            <circle r="5" fill="none" stroke="#fff" strokeWidth="2" />
          </g>
        ) : null}
        {m.label && m.kind !== 'note' ? (
          <text y={m.kind === 'smoke' ? 66 : 46} textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff"
            stroke="#000" strokeWidth="4" paintOrder="stroke">{m.label}</text>
        ) : null}
      </g>
    );
  };

  const areaKinds = ['smoke', 'molly'];
  return (
    <div className={`board-frame${activeThrow ? ' placing-throw' : ''}`} ref={frameRef}>
      {activeThrow ? (
        <div className="throw-hint" role="status">
          <span>Click to add bounce points • Enter to finish • Backspace to undo point • Esc to cancel</span>
          <span className="row tight">
            <button type="button" className="btn primary small" onClick={finishThrow}>Finish ({activeThrow.points.length - 1} bounce{activeThrow.points.length === 2 ? '' : 's'})</button>
            <button type="button" className="btn ghost small" onClick={() => setThrowDraft(null)}>Cancel</button>
          </span>
        </div>
      ) : null}
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={label} tabIndex={editable ? 0 : undefined} className={`board${editable ? ' editable' : ''}${playing ? ' playing' : ''} tool-${tool}`}
        onPointerDown={handleBackgroundDown} onPointerMove={handleMove} onKeyDown={handleKey}
        fontFamily="system-ui, sans-serif">
        <MapBackground map={map} level={level} />
        {holds.map(renderHold)}
        {routes.map((r) => renderRoute(r))}
        {draftRoute.length ? renderRoute({ id: 'draft', user_id: activePlayer, slot: activeSlot, color: '#ffffff', points: draftRoute }, true) : null}
        {connectors}
        {throwPreview}
        {markers.filter((m) => areaKinds.includes(m.kind)).map(renderMarker)}
        {markers.filter((m) => !areaKinds.includes(m.kind) && m.kind !== 'player').map(renderMarker)}
        {markers.filter((m) => m.kind === 'player').map(renderMarker)}
        {/* Items on the ground (earlier drops, or this phase's during Play Phase) and this phase's drops. */}
        <g data-layer="utility-actions">
          {ground.filter((g) => (g.level ?? 'main') === level).map((g) => (
            <g key={`ground-${g.id}`} transform={`translate(${g.x * SIZE},${g.y * SIZE})`} opacity="0.75" data-ground-item={g.id} pointerEvents="none">
              <rect x="-17" y="-17" width="34" height="34" rx="5" fill="none" stroke="#bbb" strokeWidth="2" strokeDasharray="4 3" />
              <UtilityGlyph kind={g.kind} color="#bbb" r={12} side={side} />
              <text y="31" textAnchor="middle" fontSize="13" fill="#ddd" stroke="#000" strokeWidth="3" paintOrder="stroke">on ground</text>
            </g>
          ))}
          {(board.actions ?? []).filter((a) => a.type === 'drop' && (a.level ?? 'main') === level).map((a) => {
            const color = colorOf(a);
            const selected = a.id === selectedId;
            const grab = editable && tool === 'select';
            return (
              <g key={a.id} transform={`translate(${a.x * SIZE},${a.y * SIZE})`} data-action="drop" data-action-id={a.id}
                style={{ cursor: grab ? 'grab' : undefined }} pointerEvents={grab ? 'all' : 'none'}
                onPointerDown={(e) => { if (grab) startDrag(e, { kind: 'action', id: a.id }, a.id); }}>
                <rect x="-17" y="-17" width="34" height="34" rx="5" fill={selected ? '#ffffff22' : 'none'} stroke={color} strokeWidth={selected ? 4 : 3} strokeDasharray="5 3" />
                {a.kind ? <UtilityGlyph kind={a.kind} color={color} r={12} side={side} /> : null}
                <text y="32" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="3" paintOrder="stroke">{initials(a)} drop</text>
              </g>
            );
          })}
        </g>
        {overlay}
      </svg>
    </div>
  );
}
