import { useCallback, useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const show = async () => {
    setNotice(null);
    setOpen(true);
    ref.current?.showModal();
    await load();
    if (unread) {
      try {
        const r = await api.post<{ notifications: AppNotification[]; unread_count: number }>('/notifications/read-all');
        setUnread(r.unread_count);
      } catch { /* ignore */ }
    }
  };
  const close = () => { ref.current?.close(); setOpen(false); };

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
    <>
      <button type="button" className="bell" onClick={show} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="bell" size={20} />
        {unread ? <span className="bell-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      <dialog ref={ref} className="modal notifications-modal" aria-labelledby="notifications-title"
        onClose={() => setOpen(false)} onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className="modal-body">
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
      </dialog>
    </>
  );
}
