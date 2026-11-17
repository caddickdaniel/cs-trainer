import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, useLoad } from '../lib/hooks';
import type { FaceitStatus, Identities } from '../lib/types';
import { Alert, Badge, Panel } from '../components/ui';
import { STEAM_ERRORS, SteamButton } from './Steam';

// Sign-in methods: Steam (verified SteamID64) and email/password.
function SignInMethods({ ids, reload }: { ids: Identities; reload: () => void }) {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pw, setPw] = useState({ email: '', password: '' });
  const code = params.get('steam_error');
  const just = params.get('steam');

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    setMessage(null);
    try { await fn(); setMessage(done); reload(); } catch (err) { setError(errorMessage(err)); }
  };
  const addPassword = (e: FormEvent) => {
    e.preventDefault();
    run(() => api.post('/me/password', pw), 'Email and password added. You can now sign in either way.');
  };

  return (
    <Panel title={<span id="steam">Sign-in methods</span>}>
      {code ? <Alert>{STEAM_ERRORS[code] ?? 'Steam linking did not complete.'}</Alert> : null}
      {just === 'linked' ? <Alert kind="success">Steam is now linked to your account.</Alert> : null}
      {just === 'created' ? <Alert kind="success">Your account was created with Steam.</Alert> : null}
      <div className="method-row">
        <div>
          <strong>Steam</strong>{' '}
          {ids.steam ? <Badge tone="green">Linked</Badge> : <Badge>Not linked</Badge>}
          {ids.steam ? <div className="muted small">Steam ID {ids.steam.steamid64} · verified {formatDateTime(ids.steam.linked_at)}. Used to sign in and to match your stats.</div>
            : <div className="muted small">Sign in with Steam and match your demo and FACEIT stats to your verified Steam ID.</div>}
        </div>
        {ids.steam ? (
          <div className="row wrap">
            <button type="button" className="btn small" onClick={() => run(() => api.post('/me/steam/prefill', { profile_url: true, avatar: true }), 'Filled in any empty Steam profile link and picture from Steam.')}>
              Fill empty profile fields from Steam
            </button>
            <button type="button" className="btn ghost small danger" disabled={!ids.has_password}
              title={ids.has_password ? undefined : 'Add an email and password first'}
              onClick={() => { if (window.confirm('Unlink Steam? You will sign in with your email and password.')) run(() => api.delete('/me/identities/steam'), 'Steam unlinked.'); }}>
              Unlink
            </button>
          </div>
        ) : <SteamButton intent="link">Link Steam</SteamButton>}
      </div>
      {ids.steam && !ids.steam_web_api ? <p className="muted small">Name and avatar can't be fetched from Steam on this server; only your profile link can be filled in.</p> : null}
      <div className="method-row">
        <div>
          <strong>Email and password</strong>{' '}
          {ids.has_password ? <Badge tone="green">Set</Badge> : <Badge>Not set</Badge>}
          {ids.has_password ? <div className="muted small">{ids.email}</div> : <div className="muted small">Steam is your only sign-in method, so it can't be unlinked until you add one.</div>}
        </div>
      </div>
      {!ids.has_password ? (
        <form className="form compact" onSubmit={addPassword}>
          <div className="grid2">
            <label>Email<input type="email" required value={pw.email} onChange={(e) => setPw({ ...pw, email: e.target.value })} /></label>
            <label>Password<input type="password" required minLength={10} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
          </div>
          <div><button className="btn small">Add email and password</button></div>
        </form>
      ) : null}
      <Alert>{error}</Alert>
      {message ? <Alert kind="success">{message}</Alert> : null}
    </Panel>
  );
}

function StatsSettings({ ids }: { ids: Identities }) {
  const settings = useLoad(() => api.get<{ track: boolean; visibility: 'private' | 'profile' }>('/me/stats/settings'), []);
  const faceit = useLoad(() => api.get<FaceitStatus>('/me/faceit'), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try { settings.setData(await api.patch('/me/stats/settings', patch)); } catch (err) { setError(errorMessage(err)); }
  };
  const faceitAction = async (fn: () => Promise<FaceitStatus>) => {
    setBusy(true);
    setError(null);
    try { faceit.setData(await fn()); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const s = settings.data;
  const f = faceit.data;
  return (
    <Panel title={<span id="stats">Player Stats</span>}>
      {!ids.steam ? <Alert kind="info">Link Steam above first. Stats are only ever matched to your verified Steam ID.</Alert> : null}
      {s ? (
        <div className="stack tight">
          <label className="check"><input type="checkbox" disabled={!ids.steam} checked={s.track} onChange={(e) => save({ track: e.target.checked })} />
            Track my matches (from team demos that include me, and FACEIT if connected)</label>
          <label className="check"><input type="checkbox" disabled={!s.track} checked={s.visibility === 'profile'}
            onChange={(e) => save({ visibility: e.target.checked ? 'profile' : 'private' })} />
            Show my aggregate stats on my profile (never demos, replays or review notes)</label>
        </div>
      ) : null}

      <h3 id="faceit">FACEIT</h3>
      {f && !f.configured ? <p className="muted">FACEIT isn't available on this server yet (no FACEIT API key is configured).</p> : null}
      {f && f.configured ? (
        f.connection ? (
          <div className="stack tight">
            <p>Connected as <strong>{f.connection.nickname ?? 'FACEIT player'}</strong>
              {f.connection.rating != null ? ` · ${f.connection.rating} Elo, Level ${f.connection.level ?? '?'}` : ''}</p>
            <p className="muted small">{f.connection.last_synced_at ? `Last synced ${formatDateTime(f.connection.last_synced_at)}.` : 'Not synced yet.'}
              {f.connection.status !== 'ok' && f.connection.error ? ` ${f.connection.error}` : ''}</p>
            <div className="row">
              <button type="button" className="btn small" disabled={busy} onClick={() => faceitAction(() => api.post('/me/faceit/sync'))}>Sync now</button>
              <button type="button" className="btn ghost small danger" disabled={busy}
                onClick={() => { if (window.confirm('Disconnect FACEIT and remove its imported matches?')) faceitAction(() => api.delete('/me/faceit')); }}>Disconnect</button>
            </div>
          </div>
        ) : (
          <div className="row wrap">
            <button type="button" className="btn small" disabled={!ids.steam || busy} onClick={() => faceitAction(() => api.post('/me/faceit'))}>Connect FACEIT</button>
            <span className="muted small">Finds the FACEIT CS2 account linked to your verified Steam ID.</span>
          </div>
        )
      ) : null}

      <h3>Valve matchmaking (automatic)</h3>
      <p className="muted small">Not automatic yet. You can paste a match share code in Demo Review: it's checked here, and the replay is
        fetched through a replay provider (a Steam game-client bridge) when the server has one configured. Otherwise upload the .dem file.</p>
      <Alert>{error}</Alert>
    </Panel>
  );
}

export function AccountSettings() {
  const ids = useLoad(() => api.get<Identities>('/me/identities'), []);
  if (!ids.data) return ids.error ? <Alert>{ids.error}</Alert> : null;
  return (
    <>
      <SignInMethods ids={ids.data} reload={ids.reload} />
      <StatsSettings ids={ids.data} />
    </>
  );
}
