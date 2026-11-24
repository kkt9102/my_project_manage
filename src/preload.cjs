const { contextBridge, ipcRenderer } = require('electron');
const actions = [
  'snapshot', 'settings', 'setUpdateOnStart', 'checkUpdate', 'downloadUpdate', 'openUpdate', 'exportCsv',
  'choose', 'register', 'refresh', 'remove', 'open', 'openRepo', 'connect', 'startDevice', 'openDevice', 'pollDevice', 'cancelDevice', 'sync', 'disconnect',
];
contextBridge.exposeInMainWorld('projects', Object.fromEntries(actions.map(name => [name, (...args) => ipcRenderer.invoke('projects:' + name, ...args)])));
