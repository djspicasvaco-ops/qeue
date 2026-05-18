const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qeue', {
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  isServerReady: () => ipcRenderer.invoke('is-server-ready'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onServerReady: (cb) => ipcRenderer.on('server-ready', cb),
});
