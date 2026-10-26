const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('conteng', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  newRoom: () => ipcRenderer.invoke('room:new'),
  setRoom: (room, name, keepOpen) => ipcRenderer.invoke('room:set', room, name, keepOpen),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  openSetup: () => ipcRenderer.send('setup:open'),
  onRoomChanged: (fn) => ipcRenderer.on('room:changed', () => fn()),
  boardPos: () => ipcRenderer.invoke('board:pos'),
  moveBoard: (x, y) => ipcRenderer.send('board:move', x, y),
  resizeBoard: (size) => ipcRenderer.send('board:resize', size),
  boardMoved: () => ipcRenderer.send('board:moved'),
  platform: process.platform,
});
