import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { LIMITS, PLAYER_COLORS } from '../lib/constants';
import type { Board, Marker, MarkerKind, Point, Route } from '../lib/types';
import { PracticeYardMap } from './PracticeYardMap';

export type Tool = 'select' | 'route' | MarkerKind;

const SIZE = 1000;
const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
let idCounter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// Colour is derived from the user id so a player has the same colour in the
// editor, the viewer and every Game Mode screen.
export function playerColor(userId: number | null, _players?: number[]) {
  if (userId == null) return '#d7dde4';
  return PLAYER_COLORS[userId % PLAYER_COLORS.length];
}

interface Props {
  board: Board;
  players: { user_id: number; user_name: string }[];
  // Editing is enabled when onChange is provided.
  onChange?: (board: Board) => void;
  tool?: Tool;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  // New items are attributed to this player.
  activePlayer?: number | null;
  highlightUserId?: number | null;
  draftRoute?: Point[];
  onDraftRoute?: (points: Point[]) => void;
  label?: string;
}

type Drag = { kind: 'marker'; id: string } | { kind: 'point'; id: string; index: number };

export function MapBoard({
  board, players, onChange, tool = 'select', selectedId = null, onSelect, activePlayer = null,
  highlightUserId = null, draftRoute = [], onDraftRoute, label = 'Tactics board',
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const editable = Boolean(onChange);
  const playerIds = players.map((p) => p.user_id);
  const initials = (userId: number | null) => {
    const p = players.find((x) => x.user_id === userId);
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

  const update = (next: Partial<Board>) => onChange?.({ ...board, ...next });

  const handleBackgroundDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable || e.button !== 0) return;
    const p = toPoint(e);
    if (!p) return;
    if (tool === 'select') {
      onSelect?.(null);
    } else if (tool === 'route') {
      if (draftRoute.length < LIMITS.routePoints) onDraftRoute?.([...draftRoute, p]);
    } else if (board.markers.length < LIMITS.markers) {
      const marker: Marker = { id: newId('m'), kind: tool, x: p.x, y: p.y, user_id: activePlayer, label: '' };
      update({ markers: [...board.markers, marker] });
      onSelect?.(marker.id);
    }
  };

  const startDrag = (e: PointerEvent, next: Drag, selectId: string) => {
    if (!editable || tool !== 'select') return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect?.(selectId);
    setDrag(next);
  };

  const handleMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toPoint(e);
    if (!p) return;
    if (drag.kind === 'marker') {
      update({ markers: board.markers.map((m) => (m.id === drag.id ? { ...m, x: p.x, y: p.y } : m)) });
    } else {
      update({
        routes: board.routes.map((r) => (r.id === drag.id
          ? { ...r, points: r.points.map((pt, i) => (i === drag.index ? p : pt)) }
          : r)),
      });
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

  const dim = (userId: number | null) => highlightUserId != null && userId !== highlightUserId;

  const renderRoute = (route: Route, draft = false) => {
    const color = route.user_id != null ? playerColor(route.user_id, playerIds) : route.color;
    const pts = route.points.map((p) => `${p.x * SIZE},${p.y * SIZE}`).join(' ');
    const selected = route.id === selectedId;
    const last = route.points[route.points.length - 1];
    const prev = route.points[route.points.length - 2];
    const angle = last && prev ? (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI : 0;
    return (
      <g key={route.id} opacity={dim(route.user_id) ? 0.3 : 1} data-route-id={route.id}>
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
              onPointerDown={(e) => !draft && startDrag(e, { kind: 'point', id: route.id, index: i }, route.id)} />
          ))
          : null}
      </g>
    );
  };

  const renderMarker = (m: Marker) => {
    const color = playerColor(m.user_id, playerIds);
    const selected = m.id === selectedId;
    const cx = m.x * SIZE;
    const cy = m.y * SIZE;
    let shape;
    switch (m.kind) {
      case 'smoke':
        shape = <><circle r="44" fill="#c9d0d8" opacity="0.45" /><circle r="44" fill="none" stroke={color} strokeWidth="3" /></>;
        break;
      case 'flash':
        shape = <><polygon points="0,-26 7,-7 26,0 7,7 0,26 -7,7 -26,0 -7,-7" fill="#fff6c2" stroke={color} strokeWidth="3" /></>;
        break;
      case 'molly':
        shape = <><circle r="34" fill="#e8833a" opacity="0.5" /><path d="M0,-22 C12,-6 16,4 0,20 C-16,4 -12,-6 0,-22z" fill="#ff6a2b" stroke={color} strokeWidth="3" /></>;
        break;
      case 'he':
        shape = <><circle r="18" fill="#2f3a2f" stroke={color} strokeWidth="4" /><circle r="30" fill="none" stroke="#9be08f" strokeDasharray="5 6" strokeWidth="2" /></>;
        break;
      case 'note':
        shape = <><rect x="-16" y="-16" width="32" height="32" rx="5" fill="#2b2f36" stroke={color} strokeWidth="3" /><text y="7" textAnchor="middle" fontSize="20" fill="#fff">i</text></>;
        break;
      default:
        shape = <><circle r="22" fill={color} stroke="#111" strokeWidth="3" /><text y="7" textAnchor="middle" fontSize="18" fontWeight="700" fill="#111">{initials(m.user_id)}</text></>;
    }
    return (
      <g key={m.id} transform={`translate(${cx},${cy})`} opacity={dim(m.user_id) ? 0.3 : 1}
        style={{ cursor: editable && tool === 'select' ? 'grab' : undefined }} data-marker-id={m.id}
        onPointerDown={(e) => startDrag(e, { kind: 'marker', id: m.id }, m.id)}>
        {selected ? <circle r="50" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray="8 6" /> : null}
        {shape}
        {m.label ? (
          <text y={m.kind === 'smoke' ? 66 : 46} textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff"
            stroke="#000" strokeWidth="4" paintOrder="stroke">{m.label}</text>
        ) : null}
      </g>
    );
  };

  return (
    <div className="board-frame">
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={label} tabIndex={editable ? 0 : undefined} className={`board${editable ? ' editable' : ''} tool-${tool}`}
        onPointerDown={handleBackgroundDown} onPointerMove={handleMove} onKeyDown={handleKey}
        fontFamily="system-ui, sans-serif">
        <PracticeYardMap />
        {board.routes.map((r) => renderRoute(r))}
        {draftRoute.length ? renderRoute({ id: 'draft', user_id: activePlayer, color: '#ffffff', points: draftRoute }, true) : null}
        {board.markers.filter((m) => m.kind === 'smoke' || m.kind === 'molly').map(renderMarker)}
        {board.markers.filter((m) => m.kind !== 'smoke' && m.kind !== 'molly').map(renderMarker)}
      </svg>
    </div>
  );
}
