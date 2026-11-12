import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { safeNext, useDocumentTitle } from '../lib/hooks';
import { Alert, Panel } from '../components/ui';
import { STEAM_ERRORS, SteamButton } from './Steam';

function SteamError() {
  const [params] = useSearchParams();
  const code = params.get('steam_error');
  return code ? <Alert>{STEAM_ERRORS[code] ?? 'Steam sign-in did not complete. Please try again.'}</Alert> : null;
}

function useNext() {
  const [params] = useSearchParams();
  return safeNext(params.get('next'));
}

export function SignInPage() {
  useDocumentTitle('Sign in');
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <Panel title="Sign in">
        <SteamError />
        <SteamButton next={next} />
        <p className="or-divider"><span>or with email</span></p>
        <form onSubmit={submit} className="form">
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <Alert>{error}</Alert>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="muted">New here? <Link to={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link></p>
      </Panel>
    </div>
  );
}

export function SignUpPage() {
  useDocumentTitle('Create account');
  const { user, signUp } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [form, setForm] = useState({ email: '', user_name: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp(form.email, form.user_name, form.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="auth-wrap">
      <Panel title="Create your account">
        <SteamButton next={next}>Sign up with Steam</SteamButton>
        <p className="or-divider"><span>or with email</span></p>
        <form onSubmit={submit} className="form">
          <label>Email<input type="email" autoComplete="email" required {...field('email')} /></label>
          <label>Username<input autoComplete="nickname" required minLength={2} maxLength={32} {...field('user_name')} /></label>
          <label>Password<input type="password" autoComplete="new-password" required minLength={10} {...field('password')} />
            <small className="muted">At least 10 characters.</small>
          </label>
          <Alert>{error}</Alert>
          <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="muted">Already have an account? <Link to={`/signin${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link></p>
      </Panel>
    </div>
  );
}
