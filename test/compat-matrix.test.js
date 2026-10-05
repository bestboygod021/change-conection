'use strict';

/**
 * ماتریس سازگاری: برای هر «رده» از نرم‌افزارهای فیلترشکن/تغییر آی‌پی،
 * ردپای آن نرم‌افزار روی سیستم را شبیه‌سازی می‌کنیم و بررسی می‌کنیم که
 * هر دو اکانت دقیقاً با اتصال درست باز می‌شوند.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { createStore } = require('../src/lib/store');

const existsWithoutLocks = (p) => !/(lockfile|SingletonLock)$/.test(String(p));

function scenario(detected) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-matrix-'));
  const calls = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.pid = 300 + calls.length;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    calls.push(args);
    return child;
  };
  const store = createStore({
    configDir: dir,
    platform: 'win32',
    env: { APPDATA: dir },
    spawn,
    exists: existsWithoutLocks,
    detectProxy: () => Promise.resolve(detected),
  });
  const fakeBrowser = path.join(dir, 'chrome.exe');
  fs.writeFileSync(fakeBrowser, 'x');
  store.updateSettings({ chromePath: fakeBrowser });
  return { calls, store };
}

function flagOf(args, prefix) {
  return args.find((a) => a.startsWith(prefix)) || null;
}

const SCENARIOS = [
  {
    name: 'v2rayN / Clash / Psiphon (پروکسی سیستم)',
    detected: { source: 'registry', host: '127.0.0.1', port: 10808, scheme: 'http', address: '127.0.0.1:10808' },
    vpnFlag: '--proxy-server=http://127.0.0.1:10808',
  },
  {
    name: 'Clash پورت 7890',
    detected: { source: 'registry', host: '127.0.0.1', port: 7890, scheme: 'http', address: '127.0.0.1:7890' },
    vpnFlag: '--proxy-server=http://127.0.0.1:7890',
  },
  {
    name: 'Shadowsocks / ابزار تغییر آی‌پی (حالت PAC)',
    detected: { source: 'pac', pacUrl: 'http://127.0.0.1:1080/pac.js', address: 'http://127.0.0.1:1080/pac.js' },
    vpnFlag: '--proxy-pac-url=http://127.0.0.1:1080/pac.js',
  },
  {
    name: 'V2Box / Nekoray / Sing-box (SOCKS5 لوکال بدون پروکسی سیستم)',
    detected: { source: 'scan', host: '127.0.0.1', port: 10808, scheme: 'socks5', address: '127.0.0.1:10808' },
    vpnFlag: '--proxy-server=socks5://127.0.0.1:10808',
  },
  {
    name: 'HTTP-only لوکال (Privoxy / برخی تغییر آی‌پی)',
    detected: { source: 'scan', host: '127.0.0.1', port: 8118, scheme: 'http', address: '127.0.0.1:8118' },
    vpnFlag: '--proxy-server=http://127.0.0.1:8118',
  },
  {
    name: 'Warp / WireGuard / OpenVPN (آداپتور TUN)',
    detected: { source: 'tun', adapter: 'WireGuard Tunnel', host: null, port: null, address: 'WireGuard Tunnel' },
    vpnFlag: null,
  },
  {
    name: 'هیچ فیلترشکنی روشن نیست',
    detected: { source: 'none', host: null, port: null, address: '' },
    vpnFlag: null,
  },
];

for (const s of SCENARIOS) {
  test(`سازگاری: ${s.name}`, async () => {
    const { calls, store } = scenario(s.detected);
    await store.refreshProxy();
    const vpn = store.config.accounts.find((a) => a.mode === 'vpn');
    const direct = store.config.accounts.find((a) => a.mode === 'direct');

    await store.launch(vpn.id);
    await store.launch(direct.id);
    assert.strictEqual(calls.length, 2);

    const [vpnArgs, directArgs] = calls;

    if (s.vpnFlag) {
      assert.strictEqual(flagOf(vpnArgs, '--proxy-server=') === s.vpnFlag || flagOf(vpnArgs, '--proxy-pac-url=') === s.vpnFlag, true, `فلگ vpn اشتباه: ${flagOf(vpnArgs, '--proxy-')}`);
    } else {
      assert.ok(!vpnArgs.some((a) => a.startsWith('--proxy-server=') || a.startsWith('--proxy-pac-url=')), 'باید بدون فلگ پروکسی باشد');
    }

    // اکانت مستقیم همیشه direct:// است تا پروکسی سیستم/PAC را دور بزند
    assert.strictEqual(flagOf(directArgs, '--proxy-server='), '--proxy-server=direct://');

    // دو اکانت پروفایل جدا دارند
    assert.notStrictEqual(flagOf(vpnArgs, '--user-data-dir='), flagOf(directArgs, '--user-data-dir='));
  });
}
