// CS2 capture sessions in Demo Review: the confirmation shown before anything
// launches CS2, and the overlay that follows a running session. The overlay
// is tied to the job (GET /capture-sessions/current), so it comes back after
// a page refresh and goes when the job finishes, showing what succeeded and
// what can be retried.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../lib/api';

export interface CaptureEstimates {
  measured: boolean; cold_start?: number; demo_load?: number; per_kill?: number; per_utility?: number; close?: number;
  typical_kills?: number; typical_utility?: number; measured_on?: string; options?: { all: number; kill: number; utility: number };
}
export interface CaptureSessionInfo {
  session_id: number; demo_id: number; mode: 'batch' | 'single' | 'watch'; selection: string | null; round_number: number | null;
  status: 'preparing' | 'queued' | 'running' | 'done' | 'failed'; stage: string | null; total: number; completed: number; failed: number;
  error: string | null; error_code: string | null; started_at: string | null; finished_at: string | null; finished_ago?: number | null;
  player_index?: number | null; player_name?: string | null;
}
export interface CaptureItem { capture_id: number; round_number: number; event_index: number; kind: 'kill' | 'utility'; status: string; error: string | null }
interface Current { session: CaptureSessionInfo | null; items: CaptureItem[]; capture: { enabled: boolean; available: boolean; reason: string; estimates: CaptureEstimates } }

export const minutes = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

// Modal confirmation; Escape or "Go back" cancels.
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, busy }: {
  title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button.primary')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);
  return (
    <div className="capture-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div ref={ref} className="capture-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-confirm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="capture-confirm-title">{title}</h2>
        <div className="stack tight">{children}</div>
        <div className="row tight capture-dialog__actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Go back</button>
          <button type="button" className="btn primary" disabled={busy} onClick={onConfirm}>{busy ? 'Starting…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// The standard explanation for anything that takes control of CS2.
export function CaptureWarning({ extra }: { extra?: ReactNode }) {
  return (
    <>
      <p>This launches <strong>CS2 on this PC</strong> (or uses the one already open) and takes control of its window.</p>
      <p><strong>Leave the PC alone until it finishes.</strong> Typing or clicking while it runs can interrupt the capture.</p>
      {extra}
    </>
  );
}

const DISMISS_KEY = 'cs-trainer.capture-dismissed';
const dismissed = (): number[] => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; } };
const dismiss = (id: number) => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed(), id].slice(-50))); } catch { /* private mode */ } };

const label = (s: CaptureSessionInfo) => (s.mode === 'watch' ? `Opening round ${s.round_number} in CS2`
  : s.mode === 'single' ? 'Capturing from CS2'
    : `Capturing ${s.selection === 'kill' ? 'kills' : s.selection === 'utility' ? 'utility' : 'kills and utility'}${s.round_number ? ` in round ${s.round_number}` : ''}${s.player_name ? ` for ${s.player_name}` : ''} from CS2`);

// Follows the signed-in user's latest session. `onChange` fires when its
// status or counts change (pages refresh their capture lists).
export function useCaptureSession(onChange?: (s: CaptureSessionInfo | null) => void) {
  const [cur, setCur] = useState<Current | null>(null);
  const [tick, setTick] = useState(0);
  const last = useRef('');
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]);
  useEffect(() => {
    let cancelled = false;
    api.get<Current>('/capture-sessions/current').then((c) => {
      if (cancelled) return;
      setCur(c);
      const sig = c.session ? `${c.session.session_id}:${c.session.status}:${c.session.completed}:${c.session.failed}` : '';
      if (sig !== last.current) { last.current = sig; changed.current?.(c.session); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tick]);
  const active = cur?.session && ['preparing', 'queued', 'running'].includes(cur.session.status);
  useEffect(() => {
    const t = window.setTimeout(() => setTick((n) => n + 1), active ? 1500 : 10000);
    return () => window.clearTimeout(t);
  }, [active, cur]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { current: cur, refresh };
}

export function CaptureOverlay({ current, refresh, demoId }: { current: Current | null; refresh: () => void; demoId?: number }) {
  const [closed, setClosed] = useState<number[]>(dismissed);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = current?.session;
  if (!s || closed.includes(s.session_id)) return null;
  // On a demo page only that demo's session; the library shows any.
  if (demoId != null && s.demo_id !== demoId) return null;
  const running = ['preparing', 'queued', 'running'].includes(s.status);
  // Results older than six hours aren't brought back.
  const finishedLongAgo = !running && (s.finished_ago ?? 0) > 6 * 3600;
  if (finishedLongAgo) return null;
  const est = current?.capture.estimates;
  const perItem = est?.measured ? (s.selection === 'utility' ? est.per_utility! : s.selection === 'kill' ? est.per_kill! : (est.per_kill! + est.per_utility!) / 2) : null;
  const left = s.total - s.completed - s.failed;
  const failedItems = current?.items.filter((i) => i.status === 'failed') ?? [];
  const close = () => { dismiss(s.session_id); setClosed(dismissed()); };
  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await api.post(`/demos/${s.demo_id}/captures/retry`, { session_id: s.session_id });
      close();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  };
  if (running) {
    return (
      <div className="capture-overlay" role="alertdialog" aria-modal="true" aria-live="polite" aria-label="CS2 capture in progress">
        <div className="capture-overlay__card">
          <span className="capture-overlay__spinner" aria-hidden="true" />
          <h2>{label(s)}</h2>
          <p className="capture-overlay__stage">{s.status === 'running' ? s.stage ?? 'Starting…' : 'Waiting to start…'}</p>
          {s.mode !== 'watch' && s.total > 1 ? (
            <>
              <progress max={s.total} value={s.completed + s.failed} aria-label="Events done" />
              <p className="small">{s.completed} of {s.total} captured{s.failed ? `, ${s.failed} failed` : ''}
                {perItem && left > 0 ? ` · about ${minutes(left * perItem)} left` : ''}</p>
            </>
          ) : null}
          <p className="muted small">CS2 is being controlled on this PC. Please don't use the keyboard or mouse until this finishes. This page updates by itself and survives a refresh.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="capture-result" role="status">
      <div>
        <strong>{s.mode === 'watch' ? (s.status === 'done' ? `Round ${s.round_number} is open in CS2` : 'Could not open the round in CS2') : s.status === 'done' && !s.failed ? 'Capture finished' : 'Capture finished with problems'}</strong>
        <div className="small">
          {s.mode === 'watch' ? (s.status === 'done' ? 'It is paused at the round start; CS2 stays open for you.' : s.error)
            : <>{s.completed} captured{s.failed ? `, ${s.failed} failed` : ''}{s.error ? ` · ${s.error}` : ''}</>}
        </div>
        {failedItems.length ? (
          <details className="small">
            <summary>Failed events ({failedItems.length})</summary>
            <ul>{failedItems.slice(0, 30).map((i) => <li key={i.capture_id}>Round {i.round_number} {i.kind}: {i.error}</li>)}</ul>
          </details>
        ) : null}
        {error ? <p className="error-text small">{error}</p> : null}
      </div>
      <div className="row tight">
        {failedItems.length && s.mode !== 'watch' ? <button type="button" className="btn small" disabled={retrying} onClick={retry}>{retrying ? 'Queuing…' : `Retry ${failedItems.length} failed`}</button> : null}
        <button type="button" className="btn ghost small" onClick={close} aria-label="Dismiss">Close</button>
      </div>
    </div>
  );
}
