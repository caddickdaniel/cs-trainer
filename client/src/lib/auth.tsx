import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthenticated, setCsrfToken } from './api';
import type { MeResponse } from './types';

interface AuthState extends Omit<MeResponse, 'csrf_token'> {
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, user_name: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const EMPTY: Omit<MeResponse, 'csrf_token'> = { user: null, teams: [], active_team: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((data: MeResponse) => {
    setCsrfToken(data.csrf_token);
    setMe({ user: data.user, teams: data.teams, active_team: data.active_team });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<MeResponse>('/auth/me'));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    refresh().catch(() => setMe(EMPTY));
    return onUnauthenticated(() => setMe(EMPTY));
  }, [refresh]);

  const value = useMemo<AuthState>(() => ({
    ...me,
    loading,
    refresh,
    signIn: async (email, password) => apply(await api.post<MeResponse>('/auth/signin', { email, password })),
    signUp: async (email, user_name, password) =>
      apply(await api.post<MeResponse>('/auth/signup', { email, user_name, password })),
    signOut: async () => {
      await api.post('/auth/signout');
      setCsrfToken(null);
      setMe(EMPTY);
    },
  }), [me, loading, refresh, apply]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
