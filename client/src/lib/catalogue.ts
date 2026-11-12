// Profile options and the rank catalogue, served by GET /api/catalogue from
// domain/catalogue.js (the single source used by validation, search and badges).
import { useEffect, useState } from 'react';
import { api } from './api';

export type PlatformId = 'premier' | 'faceit' | 'esea';
export interface Rank {
  id: string;
  platform: PlatformId;
  label: string;
  short: string;
  min: number | null;
  max: number | null;
  color: string;
  colorName?: string;
  level?: number;
  leaderboard?: boolean;
  unit: string;
}
export interface Catalogue {
  languages: string[];
  regions: string[];
  platforms: { id: PlatformId; label: string }[];
  ranks: Rank[];
}

let cached: Catalogue | null = null;
let pending: Promise<Catalogue> | null = null;

export function loadCatalogue() {
  if (cached) return Promise.resolve(cached);
  pending ??= api.get<Catalogue>('/catalogue').then((c) => { cached = c; return c; });
  return pending;
}

export function useCatalogue() {
  const [cat, setCat] = useState<Catalogue | null>(cached);
  useEffect(() => {
    if (cat) return undefined;
    let live = true;
    loadCatalogue().then((c) => { if (live) setCat(c); }).catch(() => { pending = null; });
    return () => { live = false; };
  }, [cat]);
  return cat;
}

export const findRank = (cat: Catalogue | null, id: string | null | undefined) => (cat && id ? cat.ranks.find((r) => r.id === id) ?? null : null);
export const platformLabel = (cat: Catalogue | null, id: string | null | undefined) => (cat && id ? cat.platforms.find((p) => p.id === id)?.label ?? id : '');
