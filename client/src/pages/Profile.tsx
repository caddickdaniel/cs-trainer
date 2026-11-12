import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LIMITS, PROFILE_LINKS } from '../lib/constants';
import { useDocumentTitle } from '../lib/hooks';
import type { Profile } from '../lib/types';
import { Alert, Loading, Panel } from '../components/ui';
import { Avatar } from '../components/People';
import { Combobox } from '../components/Combobox';
import { RankBadge } from '../components/RankBadge';
import { useCatalogue } from '../lib/catalogue';

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function ProfilePage() {
  useDocumentTitle('Edit profile');
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const cat = useCatalogue();
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (p: Profile) => {
    setProfile(p);
    setForm(Object.fromEntries(['language', 'region', 'rank_platform', 'rank_id', 'bio', ...PROFILE_LINKS.map((l) => l.key)]
      .map((k) => [k, (p as unknown as Record<string, string | null>)[k] ?? ''])));
  };

  useEffect(() => {
    api.get<{ profile: Profile }>('/me/profile').then((r) => apply(r.profile)).catch((err) => setError(errorMessage(err)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, string | null> = { ...form };
      // Only send a rank choice when one was made (keeps legacy text otherwise).
      if (!form.rank_platform) { delete body.rank_platform; delete body.rank_id; } else body.rank_id = form.rank_id || null;
      apply((await api.patch<{ profile: Profile }>('/me/profile', body)).profile);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!PICTURE_TYPES.includes(file.type)) { setError('Pictures must be PNG, JPEG or WebP.'); return; }
    if (file.size > LIMITS.pictureBytes) { setError('Pictures must be 2 MB or smaller.'); return; }
    try {
      apply((await api.uploadPicture<{ profile: Profile }>('/me/avatar', file)).profile);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePicture = async () => {
    try {
      apply((await api.delete<{ profile: Profile }>('/me/avatar')).profile);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!profile) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <div className="stack narrow-page">
      <div className="page-head">
        <h1>Edit profile</h1>
        <Link className="btn ghost" to={`/players/${profile.user_id}`}>View public profile</Link>
      </div>
      <Panel title="Profile picture">
        <div className="row wrap">
          <Avatar name={profile.user_name} url={profile.avatar_url} size={72} />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{profile.avatar_url ? 'Replace picture' : 'Upload picture'}</button>
          {profile.avatar_url ? <button type="button" className="btn ghost danger" onClick={removePicture}>Remove picture</button> : null}
          <span className="muted small">PNG, JPEG or WebP, up to 2 MB.</span>
        </div>
      </Panel>
      <Panel title={profile.user_name}>
        <form className="form" onSubmit={submit}>
          <div className="grid2">
            <Combobox label="Language" options={cat?.languages ?? []} value={form.language ?? ''} emptyLabel="Not set"
              onChange={(v) => setForm({ ...form, language: v })} />
            <Combobox label="Region" options={cat?.regions ?? []} value={form.region ?? ''} emptyLabel="Not set"
              onChange={(v) => setForm({ ...form, region: v })} />
            <label>Platform
              <select value={form.rank_platform ?? ''} onChange={(e) => {
                const platform = e.target.value;
                // A rank from another platform no longer applies.
                const keep = cat?.ranks.find((r) => r.id === form.rank_id)?.platform === platform;
                setForm({ ...form, rank_platform: platform, rank_id: keep ? form.rank_id : '' });
              }}>
                <option value="">Not set</option>
                {(cat?.platforms ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label>Skill
              <select value={form.rank_id ?? ''} disabled={!form.rank_platform} onChange={(e) => setForm({ ...form, rank_id: e.target.value })}>
                <option value="">{form.rank_platform ? 'Choose a rank' : 'Choose a platform first'}</option>
                {(cat?.ranks ?? []).filter((r) => r.platform === form.rank_platform).map((r) => (
                  <option key={r.id} value={r.id}>{r.label}{r.colorName ? ` (${r.colorName})` : ''}</option>
                ))}
              </select>
            </label>
          </div>
          {profile.legacy_platform || profile.legacy_skill_level ? (
            <p className="muted small">You previously entered “{[profile.legacy_platform, profile.legacy_skill_level].filter(Boolean).join(' · ')}”.
              It's kept until you choose a platform and rank above.</p>
          ) : null}
          {form.rank_id ? <p className="row small">Shown as <RankBadge cat={cat} rankId={form.rank_id} /> <span className="muted">(self-reported)</span></p> : null}
          <label>Bio<textarea rows={4} maxLength={1000} value={form.bio ?? ''} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
          <h3>Profile links (optional)</h3>
          <div className="grid2">
            {PROFILE_LINKS.map((l) => (
              <label key={l.key}>{l.label}
                <input type="url" maxLength={300} placeholder={`https://${l.host}/…`} value={form[l.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [l.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <Alert>{error}</Alert>
          {saved ? <Alert kind="success">Profile saved.</Alert> : null}
          <div><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
        </form>
      </Panel>
    </div>
  );
}
