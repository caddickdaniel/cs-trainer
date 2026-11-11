// Keep in sync with domain/constants.js on the server.
export const SIDES = ['T', 'CT'] as const;
export const ECONOMIES = ['Pistol', 'Eco', 'Force', 'Halfbuy', 'Fullbuy'] as const;
export const MAPS = [{ id: 'practice_yard', name: 'Practice Yard (schematic)' }] as const;
export const PLAYER_ROLES = ['entry', 'support', 'lurker', 'awper', 'anchor', 'rifler'] as const;
export const MARKER_KINDS = ['player', 'smoke', 'flash', 'molly', 'he', 'note'] as const;
export const INVITE_TTL_HOURS = [1, 24, 72, 168] as const;
export const LIMITS = { phases: 20, markers: 60, routes: 30, routePoints: 100 };

export const PLAYER_COLORS = ['#f5a524', '#4cc38a', '#5b9cf5', '#e5484d', '#b07cf7', '#3dd6d0', '#f17ac6', '#c9d36a', '#ff8a4c', '#9aa4b2'];

export const ECONOMY_LABEL: Record<string, string> = {
  Pistol: 'Pistol',
  Eco: '$ Eco',
  Force: '$$ Force',
  Halfbuy: '$$ Half buy',
  Fullbuy: '$$$ Full buy',
};

export const MARKER_LABEL: Record<string, string> = {
  player: 'Player',
  smoke: 'Smoke',
  flash: 'Flash',
  molly: 'Molotov',
  he: 'HE grenade',
  note: 'Note',
};

export const mapName = (id: string | null | undefined) =>
  MAPS.find((m) => m.id === id)?.name ?? 'No map set';
