'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshProxy: () => ipcRenderer.invoke('proxy:refresh'),
  setMode: (id, mode) => ipcRenderer.invoke('account:set-mode', id, mode),
  rename: (id, name) => ipcRenderer.invoke('account:rename', id, name),
  addAccount: (name, mode) => ipcRenderer.invoke('account:add', name, mode),
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  launch: (id, opts) => ipcRenderer.invoke('account:launch', id, opts),
  close: (id) => ipcRenderer.invoke('account:close', id),
  chooseBrowser: () => ipcRenderer.invoke('dialog:choose-browser'),
  openProfilesFolder: () => ipcRenderer.invoke('shell:open-profiles'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
});
