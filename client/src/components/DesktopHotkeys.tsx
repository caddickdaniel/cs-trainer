import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { acceleratorFromEvent, desktopBridge, formatAccelerator, HOTKEY_ACTIONS, type HotkeyAction, type HotkeyStatus } from '../lib/desktop';

export const HOTKEY_LABEL: Record<HotkeyAction, string> = {
  phase_prev: 'Previous phase', phase_next: 'Next phase', tactic_prev: 'Previous tactic', tactic_next: 'Next tactic',
  new_round: 'Start new round', switch_side: 'Switch T/CT',
};

// Global (OS-wide) hotkeys from the desktop app. They are registered only
// while this IGL has Game Mode open with control and has turned them on, and
// are removed when control is lost or the screen is left (the main process
// also removes them on reload, crash and exit).
export function useDesktopHotkeys(control: boolean, onAction: (a: HotkeyAction) => void) {
  const bridge = desktopBridge();
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef(onAction);
  const controlRef = useRef(control);
  useLayoutEffect(() => { actionRef.current = onAction; controlRef.current = control; });

  useEffect(() => {
    if (!bridge) return undefined;
    bridge.getHotkeys().then(setStatus).catch(() => {});
    const offStatus = bridge.onStatus(setStatus);
    const offAction = bridge.onHotkey((a) => { if (controlRef.current) actionRef.current(a); });
    return () => { offStatus(); offAction(); };
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return undefined;
    if (!control) bridge.disable().then(setStatus).catch(() => {});
    return () => { bridge.disable().catch(() => {}); };
  }, [bridge, control]);

  const globalKeys = useMemo(() => new Set(status?.active
    ? HOTKEY_ACTIONS.filter((a) => status.registered.includes(a)).map((a) => status.bindings[a]) : []), [status]);

  const call = useCallback(async (fn: () => Promise<HotkeyStatus>) => {
    setError(null);
    try { setStatus(await fn()); } catch { setError('The desktop app did not respond. Restart it if this keeps happening.'); }
  }, []);

  return {
    available: Boolean(bridge),
    status,
    error,
    enable: () => bridge && call(() => bridge.enable()),
    disable: () => bridge && call(() => bridge.disable()),
    rebind: (action: HotkeyAction, accelerator: string) => bridge && call(() => bridge.setBindings({ [action]: accelerator })),
    // Accelerators currently held by the OS; the page ignores these keys so a
    // press in the focused window is not handled twice.
    globalKeys,
  };
}

export type DesktopHotkeysState = ReturnType<typeof useDesktopHotkeys>;

export function DesktopHotkeysPanel({ hk }: { hk: DesktopHotkeysState }) {
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  if (!hk.available) {
    return <p className="muted small">Control Game Mode with CS2 in the foreground from the CS Trainer desktop app (Windows). See the README.</p>;
  }
  const s = hk.status;
  const active = Boolean(s?.active);
  return (
    <section className="desktop-hotkeys" aria-label="Desktop hotkeys">
      <div className="row space">
        <span className="control-label">Desktop hotkeys</span>
        <span className={`hotkey-state ${active ? 'on' : ''}`} role="status">{active ? 'Active' : 'Off'}</span>
      </div>
      {active
        ? <button type="button" className="btn small danger" onClick={() => hk.disable()}>Turn off hotkeys</button>
        : <button type="button" className="btn small primary" onClick={() => hk.enable()}>Turn on hotkeys</button>}
      <p className="muted small">{active ? 'Work while CS2 has focus. They stop when you leave Game Mode or lose IGL control.' : 'Turn on to control Game Mode while CS2 has focus.'}</p>
      <ul className="hotkey-list">
        {HOTKEY_ACTIONS.map((a) => {
          const failed = s?.failed.find((f) => f.action === a);
          return (
            <li key={a} className={failed ? 'failed' : ''}>
              <span>{HOTKEY_LABEL[a]}</span>
              {capturing === a ? (
                <button type="button" className="btn small capture" data-capturing-shortcut="" autoFocus
                  onBlur={() => setCapturing(null)}
                  onKeyDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape') { setCapturing(null); return; }
                    const acc = acceleratorFromEvent(e.nativeEvent);
                    if (!acc) { if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) setHint('That key cannot be used as a hotkey.'); return; }
                    setHint(null);
                    setCapturing(null);
                    hk.rebind(a, acc);
                  }}>Press keys…</button>
              ) : (
                <button type="button" className="btn small ghost" title="Change" onClick={() => { setHint(null); setCapturing(a); }}>
                  <kbd className="key-hint">{s ? formatAccelerator(s.bindings[a]) : '…'}</kbd>
                </button>
              )}
              {failed ? <span className="error-text small" role="alert">Not registered: {failed.reason} Choose another combination.</span> : null}
            </li>
          );
        })}
      </ul>
      {hint ? <p className="error-text small">{hint}</p> : null}
      {hk.error ? <p className="error-text small" role="alert">{hk.error}</p> : null}
    </section>
  );
}
