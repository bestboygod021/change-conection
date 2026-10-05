'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const { createStore } = require('./lib/store');

const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const configDir = isPortable
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'NetSplit-Data')
  : path.join(app.getPath('appData'), 'NetSplit');

let store = null;
let win = null;

function send(event, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 880,
    height: 680,
    minWidth: 700,
    minHeight: 520,
    title: 'نت‌اسپلیت — تفکیک اتصال',
    backgroundColor: '#0f1420',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.removeMenu();
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  await store.refreshProxy();
  send('state', await store.getState());
}

function registerIpc() {
  ipcMain.handle('state:get', () => store.getState());

  ipcMain.handle('proxy:refresh', async () => {
    await store.refreshProxy();
    return store.getState();
  });

  ipcMain.handle('account:set-mode', (_e, id, mode) => store.setMode(id, mode));
  ipcMain.handle('account:rename', (_e, id, name) => store.rename(id, name));
  ipcMain.handle('account:add', (_e, name, mode) => store.add(name, mode));
  ipcMain.handle('account:remove', (_e, id) => store.remove(id));
  ipcMain.handle('settings:update', (_e, patch) => store.updateSettings(patch));

  ipcMain.handle('account:launch', async (_e, id, opts) => {
    const result = await store.launch(id, opts || {});
    send('state', await store.getState());
    return result;
  });

  ipcMain.handle('account:close', async (_e, id) => {
    const result = await store.close(id);
    send('state', await store.getState());
    return result;
  });

  ipcMain.handle('accounts:close-all', async () => {
    const result = await store.closeAll();
    send('state', await store.getState());
    return result;
  });

  ipcMain.handle('account:clear-data', async (_e, id) => store.clearData(id));

  ipcMain.handle('settings:set-autolaunch', (_e, on) => store.setAutoLaunch(!!on));
  ipcMain.handle('settings:get-autolaunch', () => store.getAutoLaunch());

  ipcMain.handle('dialog:choose-browser', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'انتخاب فایل اجرایی مرورگر',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }],
    });
    if (result.canceled || !result.filePaths.length) return store.getState();
    return store.updateSettings({ chromePath: result.filePaths[0] });
  });

  ipcMain.handle('shell:open-profiles', async () => {
    await shell.openPath(store.profilesRoot);
    return true;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.bestboygod021.netsplit');
    store = createStore({ configDir });
    registerIpc();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
