'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createStore } = require('../src/lib/store');

/** فایل مرورگر روی دیسک هست، ولی lockfile ای وجود ندارد (کرومی باز نیست) */
const existsWithoutLocks = (p) => !/(lockfile|SingletonLock)$/.test(String(p));

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-store-'));
  const calls = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.pid = 900 + calls.length;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    calls.push({ cmd, args });
    return child;
  };
  const store = createStore({
    configDir: dir,
    profilesRoot: path.join(dir, 'profiles'),
    platform: 'win32',
    env: { APPDATA: dir },
    spawn,
    exists: existsWithoutLocks,
    detectProxy: () => Promise.resolve({ source: 'scan', host: '127.0.0.1', port: 10808, scheme: 'http', address: '127.0.0.1:10808' }),
  });
  // مرورگر فرضی: مسیری که واقعاً وجود دارد
  const fakeBrowser = path.join(dir, 'chrome.exe');
  fs.writeFileSync(fakeBrowser, 'x');
  store.updateSettings({ chromePath: fakeBrowser });
  return { dir, calls, store };
}

test('اکانت «با فیلترشکن» واقعاً با پروکسی اجرا می‌شود', async () => {
  const { calls, store } = env();
  await store.refreshProxy();
  const vpnAccount = store.config.accounts.find((a) => a.mode === 'vpn');

  const result = await store.launch(vpnAccount.id);
  assert.strictEqual(result.ok, true);
  assert.ok(calls[0].args.includes('--proxy-server=http://127.0.0.1:10808'));
  assert.ok(calls[0].args.some((a) => a.startsWith('--user-data-dir=')));
});

test('اکانت «بدون فیلترشکن» حتی با فیلترشکنِ روشن، مستقیم اجرا می‌شود', async () => {
  const { calls, store } = env();
  await store.refreshProxy();
  const directAccount = store.config.accounts.find((a) => a.mode === 'direct');

  const result = await store.launch(directAccount.id);
  assert.strictEqual(result.ok, true);
  assert.ok(calls[0].args.includes('--proxy-server=direct://'));
});

test('دو اکانت هم‌زمان دو اتصال مختلف و دو پروفایل مختلف می‌گیرند', async () => {
  const { calls, store } = env();
  await store.refreshProxy();
  await store.launch(store.config.accounts[0].id);
  await store.launch(store.config.accounts[1].id);

  const proxies = calls.map((c) => c.args.find((a) => a.startsWith('--proxy-server=')));
  const dirs = calls.map((c) => c.args.find((a) => a.startsWith('--user-data-dir=')));
  assert.deepStrictEqual(proxies, ['--proxy-server=http://127.0.0.1:10808', '--proxy-server=direct://']);
  assert.notStrictEqual(dirs[0], dirs[1]);
});

test('تغییر حالت با یک کلیک، هم اعمال و هم ذخیره می‌شود', async () => {
  const { dir, store } = env();
  const id = store.config.accounts[0].id;
  const state = await store.setMode(id, 'direct');
  assert.strictEqual(state.config.accounts[0].mode, 'direct');

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.strictEqual(onDisk.accounts[0].mode, 'direct');
});

test('فیلترشکن بدون پروکسی (TUN): حالت vpn بدون فلگ پروکسی اجرا می‌شود + هشدار', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-noproxy-'));
  const calls = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.pid = 700 + calls.length;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    calls.push({ cmd, args });
    return child;
  };
  const store = createStore({
    configDir: dir,
    platform: 'win32',
    env: { APPDATA: dir },
    spawn,
    exists: existsWithoutLocks,
    detectProxy: () => Promise.resolve({ source: 'none', host: null, port: null, address: '' }),
  });
  const fakeBrowser = path.join(dir, 'chrome.exe');
  fs.writeFileSync(fakeBrowser, 'x');
  store.updateSettings({ chromePath: fakeBrowser });
  await store.refreshProxy();

  const vpnAccount = store.config.accounts.find((a) => a.mode === 'vpn');
  const result = await store.launch(vpnAccount.id);

  // به‌جای خطا، باز می‌شود و از اتصال فعال سیستم پیروی می‌کند
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.warning, 'no-proxy-follow-system');
  // و هیچ فلگ پروکسی‌ای ندارد تا TUN/پروکسی سیستم اعمال شود
  assert.ok(!calls[0].args.some((a) => a.startsWith('--proxy-server')));
});

test('اگر مرورگر پیدا نشود، پیام مشخص برمی‌گردد', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-nobrowser-'));
  const store = createStore({
    configDir: dir,
    platform: 'win32',
    env: { ProgramFiles: dir, 'ProgramFiles(x86)': dir, LocalAppData: dir },
    exists: () => false,
    detectProxy: () => Promise.resolve({ source: 'none', host: null, port: null, address: '' }),
  });
  const result = await store.launch(store.config.accounts[0].id);
  assert.strictEqual(result.error, 'browser-not-found');
});

test('getState تصویر کامل وضعیت را برای رابط کاربری می‌دهد', async () => {
  const { store } = env();
  await store.refreshProxy();
  const state = await store.getState();
  assert.strictEqual(state.config.accounts.length, 2);
  assert.ok(state.browser && state.browser.path);
  assert.strictEqual(state.proxy.address, '127.0.0.1:10808');
  assert.strictEqual(Object.keys(state.running).length, 2);
  assert.ok(state.profilesRoot.length > 0);
});

test('افزودن، تغییر نام و حذف اکانت از طریق store کار می‌کند', async () => {
  const { store } = env();
  const added = await store.add('اکانت سوم', 'system');
  assert.strictEqual(added.config.accounts.length, 3);

  const id = added.config.accounts[2].id;
  const renamed = await store.rename(id, 'اکانت کاری');
  assert.strictEqual(renamed.config.accounts[2].name, 'اکانت کاری');

  const removed = await store.remove(id);
  assert.strictEqual(removed.config.accounts.length, 2);
});

test('پوشه‌ی پروفایل‌ها هنگام اجرا ساخته می‌شود', async () => {
  const { store } = env();
  await store.refreshProxy();
  await store.launch(store.config.accounts[0].id);
  assert.ok(fs.existsSync(store.profilesRoot));
});

test('پورت‌های اضافیِ ذخیره‌شده به لایه‌ی تشخیص پروکسی پاس داده می‌شوند', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-extraports-'));
  let captured = null;
  const store = createStore({
    configDir: dir,
    platform: 'win32',
    env: { APPDATA: dir },
    spawn: () => new EventEmitter(),
    exists: existsWithoutLocks,
    detectProxy: (opts) => {
      captured = opts;
      return Promise.resolve({ source: 'none', host: null, port: null, address: '' });
    },
  });
  store.updateSettings({ proxyPorts: [12345, 7890] });
  await store.refreshProxy();
  assert.deepStrictEqual(captured.extraPorts, [12345, 7890]);
});

test('پورت نامعتبر در proxyPorts حذف می‌شود', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-badports-'));
  const store = createStore({
    configDir: dir,
    platform: 'win32',
    env: { APPDATA: dir },
    spawn: () => new EventEmitter(),
    exists: existsWithoutLocks,
    detectProxy: () => Promise.resolve({ source: 'none', host: null, port: null, address: '' }),
  });
  store.updateSettings({ proxyPorts: [80, 'x', 99999, 80, 443] });
  assert.deepStrictEqual(store.config.proxyPorts, [80, 443]);
});

function tunEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-tun-'));
  const calls = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.pid = 500 + calls.length;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    calls.push({ cmd, args });
    return child;
  };
  const store = createStore({
    configDir: dir,
    platform: 'win32',
    env: { APPDATA: dir },
    spawn,
    exists: existsWithoutLocks,
    detectProxy: () => Promise.resolve({ source: 'tun', adapter: 'WireGuard Tunnel', host: null, port: null, address: 'WireGuard Tunnel' }),
  });
  const fakeBrowser = path.join(dir, 'chrome.exe');
  fs.writeFileSync(fakeBrowser, 'x');
  store.updateSettings({ chromePath: fakeBrowser });
  return { calls, store };
}

test('حالت «با فیلترشکن» زیر TUN: بدون فلگ پروکسی + هشدار follow-tun', async () => {
  const { calls, store } = tunEnv();
  await store.refreshProxy();
  const vpn = store.config.accounts.find((a) => a.mode === 'vpn');
  const result = await store.launch(vpn.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.warning, 'follow-tun');
  assert.ok(!calls[0].args.some((a) => a.startsWith('--proxy-server') || a.startsWith('--proxy-pac-url')));
});

test('حالت «مستقیم» زیر TUN: هشدار tun-direct-not-bypassed (ولی باز هم direct://)', async () => {
  const { calls, store } = tunEnv();
  await store.refreshProxy();
  const direct = store.config.accounts.find((a) => a.mode === 'direct');
  const result = await store.launch(direct.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.warning, 'tun-direct-not-bypassed');
  assert.ok(calls[0].args.includes('--proxy-server=direct://'));
});

test('getState زیر TUN نوع اتصال را برای رابط کاربری لو می‌دهد', async () => {
  const { store } = tunEnv();
  await store.refreshProxy();
  const state = await store.getState();
  assert.strictEqual(state.proxy.source, 'tun');
  assert.strictEqual(state.proxy.adapter, 'WireGuard Tunnel');
});
