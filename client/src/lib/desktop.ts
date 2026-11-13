// Bridge to the Windows desktop app (desktop/src/preload.js). In a normal
// browser `desktopBridge()` is null and none of this is used.
export type HotkeyAction = 'phase_prev' | 'phase_next' | 'tactic_prev' | 'tactic_next' | 'new_round' | 'switch_side';
export const HOTKEY_ACTIONS: HotkeyAction[] = ['phase_prev', 'phase_next', 'tactic_prev', 'tactic_next', 'new_round', 'switch_side'];
export type HotkeyBindings = Record<HotkeyAction, string>;
export interface HotkeyStatus {
  active: boolean;
  bindings: HotkeyBindings;
  registered: HotkeyAction[];
  failed: { action: HotkeyAction; accelerator: string; reason: string }[];
}
export interface DesktopBridge {
  platform: string;
  getHotkeys(): Promise<HotkeyStatus>;
  setBindings(b: Partial<HotkeyBindings>): Promise<HotkeyStatus>;
  enable(): Promise<HotkeyStatus>;
  disable(): Promise<HotkeyStatus>;
  onHotkey(cb: (action: HotkeyAction) => void): () => void;
  onStatus(cb: (s: HotkeyStatus) => void): () => void;
}

declare global {
  interface Window { csTrainerDesktop?: DesktopBridge }
}

export const desktopBridge = (): DesktopBridge | null => (typeof window !== 'undefined' && window.csTrainerDesktop) || null;

const NAMED: Record<string, string> = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Tab: 'Tab', Backspace: 'Backspace',
};
const NUMPAD: Record<string, string> = { NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec' };

// Electron accelerator for a key press, e.g. "Ctrl+Alt+Right" or "num6".
// Null for lone modifiers or keys the desktop app does not support.
export function acceleratorFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  let key: string | null = null;
  if (/^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
  else if (NUMPAD[e.code]) key = NUMPAD[e.code];
  else if (NAMED[e.key]) key = NAMED[e.key];
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
}

export const formatAccelerator = (acc: string) => acc
  .replace(/\bLeft\b/, '←').replace(/\bRight\b/, '→').replace(/\bUp\b/, '↑').replace(/\bDown\b/, '↓')
  .replace(/^num(\d)$/, 'Num $1').replace(/\+num(\d)$/, '+Num $1')
  .split('+').join(' + ');
