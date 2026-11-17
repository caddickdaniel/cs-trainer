// CS Trainer desktop (Windows-first) for the IGL's second monitor.
//
// Loads the normal CS Trainer web app (same sign-in, API and Game Mode screen)
// in one window and adds OS-wide hotkeys so the IGL can drive Game Mode with
// CS2 still in the foreground. Hotkeys are handled here, in the main process,
// and forwarded to the page, which sends the same commands as its buttons.
// The window is never focused or raised by a hotkey and nothing is sent to
// other processes (CS2 included).
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, globalShortcut, ipcMain, session, shell } = require('electron');
const { createHotkeyManager, normaliseBindings } = require('./hotkeys');
const { navigationTarget } = require('./navigation');

// The installed app pairs with the production server (`npm run serve`, :9090);
// `npm start` here pairs with the Vite dev server. CS_TRAINER_URL overrides both.
const DEFAULT_URL = app.isPackaged ? 'http://localhost:9090' : 'http://localhost:5173';
const APP_URL = new URL(process.env.CS_TRAINER_URL || DEFAULT_URL);
const configFile = () => path.join(app.getPath('userData'), 'hotkeys.json');

let win = null;
const hotkeys = createHotkeyManager({
  globalShortcut,
  onAction: (action) => {
    // Delivered to the page without focusing or showing the window.
    if (win && !win.isDestroyed()) win.webContents.send('hotkeys:action', action);
  },
});

function loadBindings() {
  try {
    return normaliseBindings(JSON.parse(fs.readFileSync(configFile(), 'utf8')));
  } catch {
    return normaliseBindings(null);
  }
}
function saveBindings(bindings) {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(bindings, null, 2));
  } catch {
    // Not fatal: the bindings still apply until the app closes.
  }
}

const pushStatus = () => { if (win && !win.isDestroyed()) win.webContents.send('hotkeys:status', hotkeys.status()); };
const stopHotkeys = () => { if (hotkeys.status().active) { hotkeys.disable(); pushStatus(); } };

// Only the CS Trainer page loaded from APP_URL may use the bridge.
const fromApp = (event) => {
  try {
    return new URL(event.senderFrame.url).origin === APP_URL.origin;
  } catch {
    return false;
  }
};
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Not allowed');
    return fn(...args);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    backgroundColor: '#1b1b1b',
    title: 'CS Trainer',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep polling and rendering while CS2 has focus.
      backgroundThrottling: false,
    },
  });
  // Stay on CS Trainer (and Steam's sign-in pages, so the sign-in returns
  // here); other links open in the normal browser. Server redirects are checked
  // too: sign-in starts as a same-origin link that the server redirects to Steam.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const keepInWindow = (event, url) => {
    if (navigationTarget(url, APP_URL.origin) !== 'external') return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', keepInWindow);
  win.webContents.on('will-redirect', keepInWindow);
  // A full reload or crash leaves Game Mode, so the hotkeys stop with it.
  win.webContents.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) stopHotkeys(); });
  win.webContents.on('render-process-gone', stopHotkeys);
  win.on('closed', () => { stopHotkeys(); win = null; });
  win.loadURL(APP_URL.toString());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  hotkeys.setBindings(loadBindings());
  handle('hotkeys:get', () => hotkeys.status());
  handle('hotkeys:set-bindings', (bindings) => {
    const status = hotkeys.setBindings(bindings);
    saveBindings(status.bindings);
    return status;
  });
  handle('hotkeys:enable', () => hotkeys.enable());
  handle('hotkeys:disable', () => hotkeys.disable());
  createWindow();
});

app.on('will-quit', () => { hotkeys.disable(); globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => app.quit());
