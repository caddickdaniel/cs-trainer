// Global hotkeys for the IGL (Electron main process only).
//
// Kept free of Electron imports so it can be tested with a fake
// `globalShortcut`. The renderer never passes accelerators straight to the OS:
// bindings are validated here against a small grammar, and only the six Game
// Mode commands can be bound.
const ACTIONS = ['phase_prev', 'phase_next', 'tactic_prev', 'tactic_next', 'new_round', 'switch_side'];

// Defaults avoid keys CS2 uses on its own (and lone keys that would break
// typing in game chat). Configurable from the Game Mode screen.
const DEFAULT_BINDINGS = {
  phase_prev: 'Ctrl+Alt+Left',
  phase_next: 'Ctrl+Alt+Right',
  tactic_prev: 'Ctrl+Alt+Up',
  tactic_next: 'Ctrl+Alt+Down',
  new_round: 'Ctrl+Alt+Home',
  switch_side: 'Ctrl+Alt+End',
};

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'];
const NAMED_KEYS = ['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Space', 'Tab', 'Backspace'];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|num[0-9]|numadd|numsub|nummult|numdiv|numdec)$/;

// Returns null when valid, otherwise a message for the IGL.
function validateAccelerator(acc) {
  if (typeof acc !== 'string' || !acc || acc.length > 40) return 'Choose a key combination.';
  const parts = acc.split('+');
  const key = parts.pop();
  if (parts.some((m) => !MODIFIERS.includes(m)) || new Set(parts).size !== parts.length) return `"${acc}" is not a supported combination.`;
  if (!NAMED_KEYS.includes(key) && !KEY.test(key)) return `"${key}" is not a supported key.`;
  // A lone letter, digit or arrow would fire while typing or moving in game;
  // function keys and the number pad are allowed on their own.
  const standalone = /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || /^num/.test(key);
  if (!parts.length && !standalone) return `Add Ctrl, Alt or Shift to "${key}" so it doesn't fire while you play.`;
  return null;
}

function normaliseBindings(input) {
  const out = { ...DEFAULT_BINDINGS };
  if (input && typeof input === 'object') {
    for (const a of ACTIONS) if (typeof input[a] === 'string' && !validateAccelerator(input[a])) out[a] = input[a];
  }
  return out;
}

function createHotkeyManager({ globalShortcut, onAction }) {
  let bindings = { ...DEFAULT_BINDINGS };
  let active = false;
  let registered = new Map(); // accelerator -> action
  let failed = [];

  const unregisterAll = () => {
    for (const acc of registered.keys()) {
      try { globalShortcut.unregister(acc); } catch { /* already gone */ }
    }
    registered = new Map();
  };

  const status = () => ({
    active,
    bindings: { ...bindings },
    registered: [...registered.values()],
    failed: failed.map((f) => ({ ...f })),
  });

  // Registers every binding; a binding the OS (or another app) refuses is
  // reported per action, and the others still work.
  function register() {
    unregisterAll();
    failed = [];
    const seen = new Map();
    for (const action of ACTIONS) {
      const acc = bindings[action];
      const invalid = validateAccelerator(acc);
      if (invalid) { failed.push({ action, accelerator: acc, reason: invalid }); continue; }
      if (seen.has(acc)) { failed.push({ action, accelerator: acc, reason: `Also bound to ${seen.get(acc)}.` }); continue; }
      seen.set(acc, action);
      let ok = false;
      try {
        ok = globalShortcut.register(acc, () => onAction(action));
      } catch {
        ok = false;
      }
      if (ok) registered.set(acc, action);
      else failed.push({ action, accelerator: acc, reason: 'The system refused it; another app (for example an overlay or recorder) may already use this combination.' });
    }
  }

  return {
    ACTIONS,
    status,
    // Invalid combinations are refused with a reason (shown next to the
    // action) and the previous binding is kept.
    setBindings(next) {
      const rejected = [];
      for (const [action, acc] of Object.entries(next || {})) {
        if (!ACTIONS.includes(action)) continue;
        const invalid = validateAccelerator(acc);
        if (invalid) rejected.push({ action, accelerator: String(acc), reason: invalid });
      }
      bindings = normaliseBindings({ ...bindings, ...next });
      if (active) register();
      else failed = [];
      failed = [...failed.filter((f) => !rejected.some((r) => r.action === f.action)), ...rejected];
      return status();
    },
    enable() {
      active = true;
      register();
      return status();
    },
    disable() {
      active = false;
      failed = [];
      unregisterAll();
      return status();
    },
  };
}

module.exports = { ACTIONS, DEFAULT_BINDINGS, validateAccelerator, normaliseBindings, createHotkeyManager };
