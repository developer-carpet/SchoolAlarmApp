const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timerAPI', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setClickThrough: (enabled) => ipcRenderer.invoke('window:setClickThrough', enabled),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:setAlwaysOnTop', enabled),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  flash: () => ipcRenderer.invoke('window:flash'),
  grow: () => ipcRenderer.invoke('window:grow'),
  restoreSize: () => ipcRenderer.invoke('window:restore'),
  synthesizeEdge: (text, voice) => ipcRenderer.invoke('tts:synthesizeEdge', { text, voice }),
  setMousePassthrough: (ignore) => ipcRenderer.invoke('window:setMousePassthrough', ignore),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  setMaximized: (enabled) => ipcRenderer.invoke('window:setMaximized', enabled),
  setAlarmFullscreen: (enabled) => ipcRenderer.invoke('window:setAlarmFullscreen', enabled),
  onMaximizedChanged: (callback) => ipcRenderer.on('window:maximizedChanged', (_event, value) => callback(value)),
  startAltDrag: (screenX, screenY) => ipcRenderer.send('window:altDragStart', screenX, screenY),
  updateAltDrag: (screenX, screenY) => ipcRenderer.send('window:altDragMove', screenX, screenY),
  endAltDrag: () => ipcRenderer.send('window:altDragEnd'),
  getLoginItemSettings: () => ipcRenderer.invoke('app:getLoginItemSettings'),
  setLoginItemSettings: (enabled) => ipcRenderer.invoke('app:setLoginItemSettings', enabled),
  openSettingsWindow: (tab) => ipcRenderer.invoke('settingsWindow:open', tab),
  closeSettingsWindow: () => ipcRenderer.invoke('settingsWindow:close'),
  onSettingsChanged: (callback) => ipcRenderer.on('settings:changed', (_event, partial) => callback(partial)),
  onShowTab: (callback) => ipcRenderer.on('settingsWindow:showTab', (_event, tab) => callback(tab))
});
