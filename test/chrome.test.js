'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chrome = require('../src/lib/chrome');

function makeFakeChromeOnWindows() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-chrome-'));
  const appDir = path.join(root, 'Google', 'Chrome', 'Application');
  fs.mkdirSync(appDir, { recursive: true });
  const exe = path.join(appDir, 'chrome.exe');
  fs.writeFileSync(exe, 'fake');
  return { root, exe };
}

test('کروم از مسیر استاندارد ویندوز پیدا می‌شود', () => {
  const { root, exe } = makeFakeChromeOnWindows();
  const found = chrome.findBrowser('', {
    platform: 'win32',
    env: { ProgramFiles: root, 'ProgramFiles(x86)': path.join(root, 'x86'), LocalAppData: root },
  });
  assert.ok(found);
  assert.strictEqual(found.path, exe);
  assert.strictEqual(found.name, 'Google Chrome');
});

test('مسیر دستیِ معتبر بر جست‌وجوی خودکار اولویت دارد', () => {
  const { exe } = makeFakeChromeOnWindows();
  const found = chrome.findBrowser(exe, { platform: 'win32', env: {} });
  assert.strictEqual(found.path, exe);
  assert.strictEqual(found.custom, true);
});

test('اگر هیچ مرورگری نباشد null برمی‌گردد', () => {
  const found = chrome.findBrowser('', {
    platform: 'win32',
    env: { ProgramFiles: '/nope', 'ProgramFiles(x86)': '/nope', LocalAppData: '/nope' },
    exists: () => false,
  });
  assert.strictEqual(found, null);
});

test('حالت مستقیم = پروکسی خاموش، حتی وقتی فیلترشکن روشن است', () => {
  assert.strictEqual(chrome.resolveProxyServer('direct', '127.0.0.1:10808', null), 'direct://');
});

test('حالت پیش‌فرض ویندوز = بدون فلگ پروکسی', () => {
  assert.strictEqual(chrome.resolveProxyServer('system', '127.0.0.1:10808', null), null);
});

test('آدرس پروکسی دستی با http تکمیل می‌شود ولی socks5 دست‌نخورده می‌ماند', () => {
  assert.strictEqual(chrome.resolveProxyServer('vpn', '127.0.0.1:10808'), 'http://127.0.0.1:10808');
  assert.strictEqual(chrome.resolveProxyServer('vpn', 'socks5://127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
});

test('حالت auto از پروکسی تشخیص‌داده‌شده استفاده می‌کند و بدون آن null می‌دهد', () => {
  const detected = { host: '127.0.0.1', port: 7890, scheme: 'http' };
  assert.strictEqual(chrome.resolveProxyServer('vpn', 'auto', detected), 'http://127.0.0.1:7890');
  assert.strictEqual(chrome.resolveProxyServer('vpn', 'auto', null), null);
  assert.strictEqual(chrome.resolveProxyServer('vpn', 'auto', { host: null, port: null }), null);
});

test('آرگومان‌های اجرا: پوشه‌ی پروفایل جدا + پروکسی مناسب هر حالت', () => {
  const account = { id: 'x', name: 'اکانت', folder: 'اکانت-کاری', mode: 'vpn' };
  const args = chrome.buildLaunchArgs(account, {
    profilesRoot: 'C:\\Users\\me\\AppData\\Roaming\\NetSplit\\ChromeProfiles',
    proxy: '127.0.0.1:10808',
  });

  const root = path.join('C:\\Users\\me\\AppData\\Roaming\\NetSplit\\ChromeProfiles');
  assert.ok(args.includes(`--user-data-dir=${path.join(root, 'اکانت-کاری')}`));
  assert.ok(args.includes('--profile-directory=Default'));
  assert.ok(args.includes('--no-first-run'));
  assert.ok(args.includes('--proxy-server=http://127.0.0.1:10808'));

  const directArgs = chrome.buildLaunchArgs({ ...account, mode: 'direct' }, {
    profilesRoot: '/tmp/p',
    proxy: 'auto',
  });
  assert.ok(directArgs.includes('--proxy-server=direct://'));
  assert.ok(directArgs.some((a) => a.startsWith('--user-data-dir=/tmp/p/')));

  const systemArgs = chrome.buildLaunchArgs({ ...account, mode: 'system' }, { profilesRoot: '/tmp/p' });
  assert.ok(!systemArgs.some((a) => a.startsWith('--proxy-server')));
});

test('دو اکانت مختلف پوشه‌ی کاربری جدا می‌گیرند (پیش‌نیاز تفکیک اتصال)', () => {
  const a = chrome.buildLaunchArgs({ id: '1', folder: 'one', mode: 'vpn' }, { profilesRoot: '/p', proxy: '127.0.0.1:1080' });
  const b = chrome.buildLaunchArgs({ id: '2', folder: 'two', mode: 'direct' }, { profilesRoot: '/p' });
  const dirOf = (args) => args.find((x) => x.startsWith('--user-data-dir='));
  assert.notStrictEqual(dirOf(a), dirOf(b));
});

test('بدون پوشه‌ی پروفایل یا اکانت، خطای واضح می‌دهد', () => {
  assert.throws(() => chrome.buildLaunchArgs({ folder: 'a' }, {}), /profiles-root-required/);
  assert.throws(() => chrome.buildLaunchArgs({}, { profilesRoot: '/p' }), /account-folder-required/);
});

/* --- سازگاری با PAC و TUN در ساخت آرگومان --- */

test('حالت «با فیلترشکن» با اتصال PAC، فلگ --proxy-pac-url می‌گیرد', () => {
  const flags = chrome.proxyFlagsFor('vpn', 'auto', { source: 'pac', pacUrl: 'http://127.0.0.1:7890/pac.js' });
  assert.deepStrictEqual(flags, ['--proxy-pac-url=http://127.0.0.1:7890/pac.js']);

  const args = chrome.buildLaunchArgs({ id: 'x', folder: 'f', mode: 'vpn' }, {
    profilesRoot: '/p',
    detected: { source: 'pac', pacUrl: 'http://127.0.0.1:7890/pac.js' },
  });
  assert.ok(args.includes('--proxy-pac-url=http://127.0.0.1:7890/pac.js'));
  assert.ok(!args.some((a) => a.startsWith('--proxy-server')));
});

test('پروکسی دستی بر PAC تشخیص‌داده‌شده اولویت دارد', () => {
  const flags = chrome.proxyFlagsFor('vpn', '127.0.0.1:10808', { source: 'pac', pacUrl: 'http://x/pac.js' });
  assert.deepStrictEqual(flags, ['--proxy-server=http://127.0.0.1:10808']);
});

test('حالت «مستقیم» حتی زیر TUN همچنان direct:// است', () => {
  const args = chrome.buildLaunchArgs({ id: '1', folder: 'a', mode: 'direct' }, {
    profilesRoot: '/p',
    detected: { source: 'tun', adapter: 'WireGuard Tunnel' },
  });
  assert.ok(args.includes('--proxy-server=direct://'));
});

test('حالت «با فیلترشکن» زیر TUN بدون فلگ پروکسی است (پیروی از تونل)', () => {
  const flags = chrome.proxyFlagsFor('vpn', 'auto', { source: 'tun', adapter: 'Warp' });
  assert.deepStrictEqual(flags, []);
});
