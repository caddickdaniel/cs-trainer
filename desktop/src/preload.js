// Narrow bridge between the CS Trainer page and the main process. The page
// can read and change hotkey bindings, turn the hotkeys on or off, and hear
// which command was pressed. Nothing else from Electron or Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('csTrainerDesktop', {
  platform: process.platform,
  getHotkeys: () => ipcRenderer.invoke('hotkeys:get'),
  setBindings: (bindings) => ipcRenderer.invoke('hotkeys:set-bindings', bindings),
  enable: () => ipcRenderer.invoke('hotkeys:enable'),
  disable: () => ipcRenderer.invoke('hotkeys:disable'),
  onHotkey: listen('hotkeys:action'),
  onStatus: listen('hotkeys:status'),
});
