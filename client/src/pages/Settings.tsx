import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_LABEL, type ShortcutAction } from '../lib/constants';
import { useDocumentTitle } from '../lib/hooks';
import { bindingFromEvent, findConflicts, formatBinding, type Shortcuts } from '../lib/shortcuts';
import { Alert, Loading, Panel } from '../components/ui';
import { AccountSettings } from './AccountSettings';

export function SettingsPage() {
  useDocumentTitle('Settings');
  const [saved, setSaved] = useState<Shortcuts | null>(null);
  const [draft, setDraft] = useState<Shortcuts | null>(null);
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ shortcuts: Shortcuts }>('/me/settings')
      .then((r) => { setSaved(r.shortcuts); setDraft(r.shortcuts); })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!draft || !saved) return error ? <Alert>{error}</Alert> : <Loading />;
  const conflicts = findConflicts(draft);
  const dirty = SHORTCUT_ACTIONS.some((a) => draft[a] !== saved[a]);

  const capture = (action: ShortcutAction) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { setCapturing(null); return; }
    const binding = bindingFromEvent(e);
    if (!binding) return;
    setDraft({ ...draft, [action]: binding });
    setCapturing(null);
    setMessage(null);
  };

  const save = async (next: Shortcuts | null) => {
    setError(null);
    try {
      const r = await api.put<{ shortcuts: Shortcuts }>('/me/settings', { shortcuts: next });
      setSaved(r.shortcuts);
      setDraft(r.shortcuts);
      setMessage(next ? 'Shortcuts saved.' : 'Shortcuts reset to the defaults.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="stack narrow-page">
      <h1>Settings</h1>
      <AccountSettings />
      <Panel title="Game Mode keyboard shortcuts">
        <Alert kind="info">
          Shortcuts only work while the Game Mode page is open and focused in your browser (click it on your second monitor first).
          They do not work inside CS2, and they are ignored while you are typing in a field. Only the IGL's shortcuts change the live round.
        </Alert>
        <table className="table">
          <thead><tr><th>Action</th><th>Shortcut</th><th /></tr></thead>
          <tbody>
            {SHORTCUT_ACTIONS.map((action) => (
              <tr key={action}>
                <td>{SHORTCUT_LABEL[action]}</td>
                <td>
                  {capturing === action ? (
                    <button type="button" className="key-capture on" data-capturing-shortcut autoFocus onKeyDown={capture(action)} onBlur={() => setCapturing(null)}>
                      Press a key… (Esc to cancel)
                    </button>
                  ) : (
                    <button type="button" className={`key-capture${conflicts.has(action) ? ' conflict' : ''}`} onClick={() => setCapturing(action)}
                      aria-label={`${SHORTCUT_LABEL[action]}: ${draft[action]}. Click to change`}>
                      <kbd>{formatBinding(draft[action])}</kbd>
                    </button>
                  )}
                  {conflicts.has(action) ? <div className="error-text">Used by another action</div> : null}
                </td>
                <td className="right">
                  {draft[action] !== DEFAULT_SHORTCUTS[action] ? (
                    <button type="button" className="btn ghost small" onClick={() => setDraft({ ...draft, [action]: DEFAULT_SHORTCUTS[action] })}>
                      Default ({formatBinding(DEFAULT_SHORTCUTS[action])})
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Alert>{error}</Alert>
        {message ? <Alert kind="success">{message}</Alert> : null}
        <div className="row">
          <button type="button" className="btn primary" disabled={!dirty || conflicts.size > 0} onClick={() => save(draft)}>Save shortcuts</button>
          <button type="button" className="btn ghost" onClick={() => save(null)}>Reset all to defaults</button>
        </div>
      </Panel>
    </div>
  );
}
