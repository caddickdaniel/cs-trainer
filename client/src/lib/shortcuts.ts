import { useEffect, useState } from 'react';
import { api } from './api';
import { DEFAULT_SHORTCUTS, type ShortcutAction } from './constants';

export type Shortcuts = Record<ShortcutAction, string>;

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta'];
const NAMED: Record<string, string> = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape' };

// Turns a key event into a binding such as "N", "Shift+N" or "Ctrl+ArrowRight".
// Returns null for lone modifier presses.
export function bindingFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  let key = NAMED[e.key] ?? e.key;
  if (key.length === 1) {
    key = key.toUpperCase();
    // Shift changes punctuation (e.g. "[" becomes "{"); use the unshifted key.
    if (e.shiftKey && e.code && /^(Bracket|Semicolon|Quote|Comma|Period|Slash|Backquote|Equal|Minus|Backslash)/.test(e.code)) {
      key = { BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Equal: '=', Minus: '-', Backslash: '\\' }[e.code] ?? key;
    }
    if (e.shiftKey && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  }
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, key].join('+');
}

// Readable label, e.g. "ArrowRight" -> "→".
export function formatBinding(binding: string) {
  return binding
    .replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓')
    .split('+').join(' + ');
}

// True while the user is typing, editing a binding, or using a dropdown,
// listbox, menu or modal (shortcuts must be ignored then).
export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (document.querySelector('dialog[open], [aria-modal="true"]')) return true;
  if (!el || !el.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(el.tagName) || el.isContentEditable
    || Boolean(el.closest?.('[data-capturing-shortcut], [role="listbox"], [role="combobox"], [role="menu"], [aria-expanded="true"]'));
}

export function findConflicts(shortcuts: Shortcuts) {
  const seen = new Map<string, ShortcutAction>();
  const conflicts = new Set<ShortcutAction>();
  (Object.entries(shortcuts) as [ShortcutAction, string][]).forEach(([action, key]) => {
    const other = seen.get(key);
    if (other) { conflicts.add(action); conflicts.add(other); }
    seen.set(key, action);
  });
  return conflicts;
}

export function useShortcutSettings() {
  const [shortcuts, setShortcuts] = useState<Shortcuts>(DEFAULT_SHORTCUTS);
  useEffect(() => {
    let cancelled = false;
    api.get<{ shortcuts: Shortcuts }>('/me/settings')
      .then((r) => { if (!cancelled) setShortcuts(r.shortcuts); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return shortcuts;
}
