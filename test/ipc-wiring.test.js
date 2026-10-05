'use strict';

/**
 * این تست لایه‌ی چسب Electron را بررسی می‌کند:
 * ۱) هر کانالی که preload صدا می‌زند، در main ثبت شده باشد (و برعکس)
 * ۲) هندلرهای main واقعاً store را صدا بزنند و وضعیت را به صفحه بفرستند
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ELECTRON_PATH = require.resolve('electron');

function primeElectron(fake) {
  const mod = new Module(ELECTRON_PATH, null);
  mod.filename = ELECTRON_PATH;
  mod.loaded = true;
  mod.exports = fake;
  require.cache[ELECTRON_PATH] = mod;
}

function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function preloadChannels() {
  const invoked = [];
  const listeners = [];
  let exposed = null;
  primeElectron({
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        exposed = api;
      },
    },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        invoked.push(channel);
        return Promise.resolve({ channel, args });
      },
      on: (channel, listener) => listeners.push({ channel, listener }),
      removeListener: () => {},
    },
  });
  freshRequire('../src/preload.js');

  // همه‌ی متدهای api را صدا می‌زنیم تا کانال‌های واقعی‌شان ثبت شود
  Object.entries(exposed).forEach(([key, fn]) => {
    if (typeof fn === 'function') fn('id', 'extra');
  });
  return { invoked, listeners, exposed };
}

function loadMain() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-main-'));
  const handlers = new Map();
  const sent = [];
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.loaded = null;
      this.webContents = {
        send: (channel, payload) => sent.push({ channel, payload }),
      };
    }

    removeMenu() {
      this.menuRemoved = true;
    }

    async loadFile(file) {
      this.loaded = file;
    }

    isDestroyed() {
      return false;
    }

    isMinimized() {
      return false;
    }

    restore() {}

    focus() {}
  }

  const windows = [];
  primeElectron({
    app: {
      getPath: () => tmp,
      requestSingleInstanceLock: () => true,
      on: () => {},
      setAppUserModelId: () => {},
      whenReady: () => ready,
      quit: () => {},
    },
    BrowserWindow: class extends FakeWindow {
      constructor(options) {
        super(options);
        windows.push(this);
      }
    },
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openPath: async () => '',
    },
  });

  freshRequire('../src/main.js');
  return { tmp, handlers, sent, windows, resolveReady };
}

test('preload و main دقیقاً روی یک کانال‌ها توافق دارند', async () => {
  const { invoked } = preloadChannels();
  const { handlers, resolveReady } = loadMain();
  resolveReady();
  await tick();

  const fromPreload = new Set(invoked);
  const fromMain = new Set(handlers.keys());

  const missingInMain = [...fromPreload].filter((c) => !fromMain.has(c));
  const missingInPreload = [...fromMain].filter((c) => !fromPreload.has(c));

  assert.deepStrictEqual(missingInMain, [], 'کانال‌هایی که preload صدا می‌زند ولی main ثبت نکرده');
  assert.deepStrictEqual(missingInPreload, [], 'کانال‌هایی که main ثبت کرده ولی preload استفاده نمی‌کند');
  assert.ok(fromMain.has('account:launch'));
  assert.ok(fromMain.has('account:set-mode'));
});

test('پنجره‌ی برنامه با preload و صفحه‌ی راست‌به‌چپ ساخته می‌شود', async () => {
  const { windows, resolveReady } = loadMain();
  resolveReady();
  await tick();

  assert.strictEqual(windows.length, 1);
  const win = windows[0];
  assert.ok(win.loaded.endsWith(path.join('renderer', 'index.html')));
  assert.ok(fs.existsSync(win.loaded));
  assert.strictEqual(win.options.webPreferences.contextIsolation, true);
  assert.strictEqual(win.options.webPreferences.nodeIntegration, false);
  assert.ok(win.options.webPreferences.preload.endsWith('preload.js'));
  assert.ok(win.loaded.includes('renderer'));
});

test('هندلر اجرا، اکانت را با کروم باز می‌کند و وضعیت را به صفحه می‌فرستد', async () => {
  const { handlers, sent, tmp, resolveReady } = loadMain();
  resolveReady();
  await tick();

  // یک مرورگر جعلی در مسیر تنظیمات
  const fakeBrowser = path.join(tmp, 'chrome.exe');
  fs.writeFileSync(fakeBrowser, 'x');
  await handlers.get('settings:update')({}, { chromePath: fakeBrowser, proxy: '127.0.0.1:10808' });

  const state = await handlers.get('state:get')({});
  const vpnAccount = state.config.accounts.find((a) => a.mode === 'vpn');

  const result = await handlers.get('account:launch')({}, vpnAccount.id, {});
  // در لینوکسِ بدون نمایشگر، کرومِ جعلی اجرا نمی‌شود؛ مهم این است که
  // هندلر مسیر درست را طی کند و وضعیت تازه را برای صفحه بفرستد
  assert.ok(result && typeof result.ok === 'boolean');
  assert.ok(sent.some((m) => m.channel === 'state'));
  const lastState = sent[sent.length - 1].payload;
  assert.strictEqual(lastState.config.accounts.length, 2);
  assert.ok(lastState.profilesRoot.length > 0);
});

test('تغییر حالت از طریق IPC ذخیره می‌شود', async () => {
  const { handlers, tmp, resolveReady } = loadMain();
  resolveReady();
  await tick();

  const state = await handlers.get('state:get')({});
  const id = state.config.accounts[0].id;
  const next = await handlers.get('account:set-mode')({}, id, 'direct');
  assert.strictEqual(next.config.accounts[0].mode, 'direct');

  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'NetSplit', 'config.json'), 'utf8'));
  assert.strictEqual(onDisk.accounts[0].mode, 'direct');
});

test('اکانت جدید از طریق IPC اضافه و حذف می‌شود', async () => {
  const { handlers, resolveReady } = loadMain();
  resolveReady();
  await tick();

  const added = await handlers.get('account:add')({}, 'اکانت تست', 'system');
  assert.strictEqual(added.config.accounts.length, 3);
  const id = added.config.accounts[2].id;

  const removed = await handlers.get('account:remove')({}, id);
  assert.strictEqual(removed.config.accounts.length, 2);
});

test('تشخیص دوباره‌ی فیلترشکن از IPC در دسترس است', async () => {
  const { handlers, resolveReady } = loadMain();
  resolveReady();
  await tick();
  const state = await handlers.get('proxy:refresh')({});
  assert.ok(state.proxy);
  assert.ok(['none', 'scan', 'registry'].includes(state.proxy.source));
});
