import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { PLAYER_COLORS, SLOT_COLORS } from './constants';
import type { PlayerColor, PlayerColorId } from './types';

// CS2 in-game teammate colours (mirrors PLAYER_PALETTE in domain/constants.js).
export const PLAYER_PALETTE: { id: PlayerColorId; label: string; hex: string }[] = [
  { id: 'orange', label: 'Orange', hex: '#eda338' },
  { id: 'green', label: 'Green', hex: '#109856' },
  { id: 'blue', label: 'Blue', hex: '#68a3e5' },
  { id: 'yellow', label: 'Yellow', hex: '#e6f13d' },
  { id: 'purple', label: 'Purple', hex: '#803ca1' },
];
export const paletteHex = (id: PlayerColorId) => PLAYER_PALETTE.find((c) => c.id === id)?.hex ?? '#d7dde4';

type Owned = { user_id: number | null; slot?: number | null };
export const colorKey = (item: Owned | null | undefined) =>
  (!item ? null : item.user_id != null ? `u${item.user_id}` : item.slot ? `s${item.slot}` : null);

// Fallback when a tactic has no colour for this player (tactics made before
// colours existed): derived from the user id or slot, so it is stable.
export function fallbackColor(item: Owned) {
  if (item.user_id != null) return PLAYER_COLORS[item.user_id % PLAYER_COLORS.length];
  if (item.slot) return SLOT_COLORS[(item.slot - 1) % SLOT_COLORS.length];
  return '#d7dde4';
}

export function colorFor(item: Owned, colors: PlayerColor[] | null | undefined) {
  const key = colorKey(item);
  const set = key ? (colors ?? []).find((c) => colorKey(c) === key) : undefined;
  return set ? paletteHex(set.color) : fallbackColor(item);
}

// The tactic's colours, provided once per page so the board, instructions,
// legends and buy lists all agree.
const Ctx = createContext<PlayerColor[]>([]);
export function PlayerColorsProvider({ colors, children }: { colors: PlayerColor[] | null | undefined; children: ReactNode }) {
  return <Ctx.Provider value={colors ?? []}>{children}</Ctx.Provider>;
}
export function usePlayerColors() {
  const colors = useContext(Ctx);
  return useCallback((item: Owned) => colorFor(item, colors), [colors]);
}

// Gives `color` to `who`; if another player had it, they get `who`'s old colour
// (or none), so each colour stays unique like in game.
export function assignColor(list: PlayerColor[], who: Owned, color: PlayerColorId | null): PlayerColor[] {
  const key = colorKey(who);
  if (!key) return list;
  const mine = list.find((c) => colorKey(c) === key);
  const holder = color ? list.find((c) => c.color === color && colorKey(c) !== key) : undefined;
  let next = list.filter((c) => colorKey(c) !== key && c !== holder);
  if (holder && mine) next = [...next, { ...holder, color: mine.color }];
  if (color) next = [...next, { user_id: who.user_id ?? null, slot: who.user_id != null ? null : who.slot ?? null, color }];
  return next;
}

// Gives the first free colours, in palette order, to players without one.
export function autoAssign(list: PlayerColor[], players: Owned[]): PlayerColor[] {
  let next = [...list];
  for (const p of players) {
    if (next.some((c) => colorKey(c) === colorKey(p))) continue;
    const free = PLAYER_PALETTE.find((c) => !next.some((x) => x.color === c.id));
    if (!free) break;
    next = assignColor(next, p, free.id);
  }
  return next;
}

// Readable text colour on a player colour (purple and green need white).
export function textOn(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? '#111' : '#fff';
}
