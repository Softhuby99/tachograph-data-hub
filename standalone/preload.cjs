const { contextBridge, ipcRenderer } = require('electron');

// Offline app bridge: the renderer has no network privileges (it runs from a
// local file), so all outbound HTTP goes through the main process.
contextBridge.exposeInMainWorld('tacho', {
  isDesktop: true,
  fetchText: (url) => ipcRenderer.invoke('tacho:fetch', url),
});
