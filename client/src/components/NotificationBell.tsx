import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { AppNotification } from '../lib/types';
import { Icon } from './Icons';

const POLL_MS = 30000;

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function NotificationBell() {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [place, setPlace] = useState<{ panel: CSSProperties; caret: CSSProperties }>({ panel: {}, caret: {} });

  // Anchors the panel directly below the bell, kept inside the viewport
  // (the top bar wraps on narrow screens, so the bell can be anywhere).
  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 12;
      const width = Math.min(420, window.innerWidth - margin * 2);
      const left = Math.min(Math.max(margin, r.right - width), window.innerWidth - width - margin);
      const top = r.bottom + 10;
      setPlace({
        panel: { top, left, width, maxHeight: Math.max(160, window.innerHeight - top - margin) },
        caret: { top: top - 6, left: Math.round(r.left + r.width / 2 - 6) },
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ notifications: AppNotification[]; unread_count: number }>('/notifications');
      setItems(r.notifications);
      setUnread(r.unread_count);
    } catch {
      /* the bell retries on the next poll */
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [load]);

  // Closes on outside click and Escape (focus returns to the bell).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const show = async () => {
    if (open) { setOpen(false); return; }
    setNotice(null);
    setOpen(true);
    await load();
    if (unread) {
      try {
        const r = await api.post<{ notifications: AppNotification[]; unread_count: number }>('/notifications/read-all');
        setUnread(r.unread_count);
      } catch { /* ignore */ }
    }
  };
  const close = () => setOpen(false);

  const follow = async (n: AppNotification) => {
    try {
      const r = await api.post<{ href: string; message?: string }>(`/notifications/${n.notification_id}/open`);
      if (r.message) {
        setNotice(r.message);
        return;
      }
      close();
      navigate(r.href);
    } catch (err) {
      setNotice(errorMessage(err));
    }
  };

  const dismiss = async (n: AppNotification) => {
    setItems((list) => list.filter((x) => x.notification_id !== n.notification_id));
    try { await api.post(`/notifications/${n.notification_id}/dismiss`); } catch { load(); }
  };

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button ref={buttonRef} type="button" className="bell" onClick={show} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="true" aria-expanded={open} aria-controls="notifications-panel">
        <Icon name="bell" size={20} />
        {unread ? <span className="bell-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? <span className="notifications-caret" aria-hidden="true" style={place.caret} /> : null}
      {open ? (
        // Anchored under the bell; on narrow screens it spans the viewport width.
        <div id="notifications-panel" className="notifications-panel" role="region" aria-labelledby="notifications-title" style={place.panel}>
          <div className="row space">
            <h2 id="notifications-title">Notifications</h2>
            <button type="button" className="btn ghost small" onClick={close}>Close</button>
          </div>
          {notice ? <div className="alert info" role="status">{notice}</div> : null}
          {items.length ? (
            <ul className="notification-list">
              {items.map((n) => (
                <li key={n.notification_id} className={n.read ? '' : 'unread'}>
                  <button type="button" className="notification-main" onClick={() => follow(n)}>
                    <span>{n.message}</span>
                    <time dateTime={n.created_at} className="muted small">{timeAgo(n.created_at)}</time>
                  </button>
                  <button type="button" className="notification-dismiss" aria-label={`Dismiss: ${n.message}`} onClick={() => dismiss(n)}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">You're all caught up.</p>}
        </div>
      ) : null}
    </div>
  );
}
