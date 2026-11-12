import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, errorMessage, setCsrfToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDocumentTitle } from '../lib/hooks';
import { Alert, Loading, Panel } from '../components/ui';

// Messages for ?steam_error=<code> after the Steam redirect.
export const STEAM_ERRORS: Record<string, string> = {
  cancelled: 'Steam sign-in was cancelled.',
  state_mismatch: 'That Steam sign-in expired or was started elsewhere. Please try again.',
  invalid_response: 'Steam returned a response we could not accept. Please try again.',
  expired: 'The Steam response was too old. Please try again.',
  replayed: 'That Steam response was already used. Please try again.',
  not_verified: 'Steam did not confirm the sign-in. Please try again.',
  steam_unavailable: 'Steam could not be reached to verify your sign-in. Please try again later.',
  steam_taken: 'That Steam account is already linked to another CS-Trainer account. Sign out and use Continue with Steam to open that account, or unlink Steam there first.',
  steam_already_linked: 'Your account is already linked to a different Steam account. Unlink it first.',
  app_origin_missing: 'Steam sign-in is not configured on this server.',
};

// A plain link: the server redirects to Steam (a full-page navigation).
export function SteamButton({ intent = 'signin', next, children }: { intent?: 'signin' | 'link'; next?: string; children?: string }) {
  const q = new URLSearchParams({ intent, ...(next && next !== '/' ? { next } : {}) });
  return (
    <a className="btn steam-btn" href={`/api/auth/steam/start?${q}`}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="15" cy="9" r="3" fill="currentColor" /><circle cx="8.5" cy="15.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M10.5 14.2l2.6-3.2" stroke="currentColor" strokeWidth="2" /></svg>
      {children ?? 'Continue with Steam'}
    </a>
  );
}

interface Pending {
  steamid64: string;
  suggestions: { user_name: string | null; avatar_url: string | null; profile_url: string };
  signed_in_as: { user_id: number; user_name: string } | null;
}

// After a verified Steam identity that isn't linked to any account yet:
// create a Steam account, or sign in to an existing account and link it.
export function SteamFinishPage() {
  useDocumentTitle('Continue with Steam');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [useAvatar, setUseAvatar] = useState(true);
  const [useProfile, setUseProfile] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Pending>('/auth/steam/pending')
      .then((p) => { setPending(p); setName(p.suggestions.user_name ?? ''); })
      .catch((err) => { if (err instanceof ApiError && err.status === 404) setMissing(true); else setError(errorMessage(err)); });
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<{ csrf_token: string }>('/auth/steam/complete', { user_name: name, use_avatar: useAvatar, use_profile_url: useProfile });
      setCsrfToken(me.csrf_token);
      await refresh();
      navigate('/settings?steam=created#stats', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/steam/link-pending');
      navigate('/settings?steam=linked#stats', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    await api.delete('/auth/steam/pending').catch(() => {});
    navigate(pending?.signed_in_as ? '/settings' : '/signin', { replace: true });
  };

  if (missing) {
    return <div className="auth-wrap"><Panel title="Continue with Steam"><p>No verified Steam sign-in is waiting. Start again.</p><SteamButton /></Panel></div>;
  }
  if (!pending) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="auth-wrap">
      <Panel title="Steam account verified">
        <p className="muted small">Steam ID {pending.steamid64}. It isn't linked to a CS-Trainer account yet.</p>
        {pending.signed_in_as ? (
          <>
            <p>Link this Steam account to <strong>{pending.signed_in_as.user_name}</strong>? You'll be able to sign in with either Steam or your password.</p>
            <div className="row">
              <button type="button" className="btn primary" disabled={busy} onClick={link}>Link Steam to {pending.signed_in_as.user_name}</button>
              <button type="button" className="btn ghost" onClick={cancel}>Don't link</button>
            </div>
          </>
        ) : (
          <>
            <h3>Create a new account with Steam</h3>
            <form className="form" onSubmit={create}>
              <label>Username<input required minLength={2} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="check"><input type="checkbox" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} /> Add my Steam profile link to my profile</label>
              {pending.suggestions.avatar_url ? (
                <label className="check"><input type="checkbox" checked={useAvatar} onChange={(e) => setUseAvatar(e.target.checked)} />
                  Use my Steam avatar <img src={pending.suggestions.avatar_url} alt="" width={28} height={28} className="avatar" /></label>
              ) : null}
              <button className="btn primary" disabled={busy}>Create account</button>
            </form>
            <h3>Already have an account?</h3>
            <p className="muted">Sign in with your email and password, then confirm linking. Accounts are never merged automatically.</p>
            <div className="row">
              <Link className="btn" to="/signin?next=/steam/finish">Sign in to link</Link>
              <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>
            </div>
          </>
        )}
        <Alert>{error}</Alert>
      </Panel>
    </div>
  );
}
