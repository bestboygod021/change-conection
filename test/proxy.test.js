'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');

const proxy = require('../src/lib/proxy');

test('مقدار ساده‌ی ProxyServer رجیستری تجزیه می‌شود', () => {
  assert.deepStrictEqual(proxy.parseProxyServer('127.0.0.1:10808'), {
    host: '127.0.0.1',
    port: 10808,
    scheme: 'http',
  });
});

test('مقدار چندپروتکلی: اول https بعد http بعد socks', () => {
  const multi = 'http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891';
  assert.strictEqual(proxy.parseProxyServer(multi).port, 7890);
  const socksOnly = proxy.parseProxyServer('socks=127.0.0.1:1080');
  assert.strictEqual(socksOnly.port, 1080);
  assert.strictEqual(socksOnly.scheme, 'socks5');
});

test('مقادیر نامعتبر null می‌دهند', () => {
  [null, undefined, '', '   ', 'بدون‌پورت', '127.0.0.1', '127.0.0.1:99999', 'http=;https='].forEach((value) => {
    assert.strictEqual(proxy.parseProxyServer(value), null, `باید null باشد: ${value}`);
  });
});

const REG_OUTPUT = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    AutoConfigURL    REG_SZ    C:\\proxy.pac
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:10808
`;

test('خروجی reg query خوانده می‌شود', () => {
  const info = proxy.parseRegInternetSettings(REG_OUTPUT);
  assert.strictEqual(info.enabled, true);
  assert.strictEqual(info.host, '127.0.0.1');
  assert.strictEqual(info.port, 10808);
});

test('پروکسی غیرفعال در رجیستری پذیرفته نمی‌شود', () => {
  const info = proxy.parseRegInternetSettings(REG_OUTPUT.replace('0x1', '0x0'));
  assert.strictEqual(info.enabled, false);
});

test('پورت در حال گوش‌دادن روی سیستم واقعی پیدا می‌شود', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.strictEqual(await proxy.probePort('127.0.0.1', port, 500), true);
    const found = await proxy.scanLocalProxies({ ports: [1, port], timeout: 500 });
    assert.strictEqual(found.port, port);
  } finally {
    server.close();
  }
});

test('پورت بسته پیدا نمی‌شود', async () => {
  assert.strictEqual(await proxy.probePort('127.0.0.1', 1, 400), false);
  assert.strictEqual(await proxy.scanLocalProxies({ ports: [1], timeout: 400 }), null);
});

test('در ویندوز اول رجیستری خوانده می‌شود و پروکسی فعال گزارش می‌شود', async () => {
  const runner = (cmd, args, cb) => cb(null, REG_OUTPUT);
  const result = await proxy.detectProxy({ platform: 'win32', runner, probe: () => Promise.resolve(true) });
  assert.deepStrictEqual(result, {
    source: 'registry',
    host: '127.0.0.1',
    port: 10808,
    scheme: 'http',
    address: '127.0.0.1:10808',
  });
});

test('اگر پروکسی رجیستری خاموش باشد، به گشتن پورت‌ها می‌افتد', async () => {
  const runner = (cmd, args, cb) => cb(null, REG_OUTPUT);
  const result = await proxy.detectProxy({
    platform: 'win32',
    runner,
    ports: [7890],
    probe: (host, port) => Promise.resolve(port === 7890),
    connect: (host, port) => Promise.resolve(port === 7890 ? { open: true, scheme: 'http' } : { open: false, scheme: 'http' }),
  });
  assert.strictEqual(result.source, 'scan');
  assert.strictEqual(result.port, 7890);
});

test('بدون هیچ پروکسی، source برابر none است', async () => {
  const result = await proxy.detectProxy({
    platform: 'win32',
    runner: (cmd, args, cb) => cb(new Error('no reg')),
    ports: [10808],
    probe: () => Promise.resolve(false),
  });
  assert.strictEqual(result.source, 'none');
  assert.strictEqual(result.address, '');
});

test('خطای reg query برنامه را نمی‌خواباند', async () => {
  const result = await proxy.detectProxy({
    platform: 'win32',
    runner: () => {
      throw new Error('boom');
    },
    ports: [],
    probe: () => Promise.resolve(false),
  });
  assert.strictEqual(result.source, 'none');
});

/* --- تشخیص نوع پروکسی با دست‌دادن SOCKS5 (سازگار با انواع نرم‌افزارها) --- */

function socks5Server() {
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write(Buffer.from([0x05, 0x00]));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function silentServer() {
  const server = net.createServer(() => {
    /* باز است ولی پروکسی نیست */
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('دست‌دادن SOCKS5 با یک پروکسی SOCKS5 واقعی موفق است', async () => {
  const server = await socks5Server();
  const port = server.address().port;
  try {
    assert.strictEqual(await proxy.socks5Handshake('127.0.0.1', port, 700), true);
    const identified = await proxy.connectIdentify('127.0.0.1', port, 700);
    assert.deepStrictEqual(identified, { open: true, scheme: 'socks5' });
  } finally {
    server.close();
  }
});

test('پورت بازِ غیرپروکسی، SOCKS5 نیست ولی باز گزارش می‌شود', async () => {
  const server = await silentServer();
  const port = server.address().port;
  try {
    assert.strictEqual(await proxy.socks5Handshake('127.0.0.1', port, 500), false);
    const identified = await proxy.connectIdentify('127.0.0.1', port, 500);
    assert.deepStrictEqual(identified, { open: true, scheme: 'http' });
  } finally {
    server.close();
  }
});

test('گشتن پورت، اولین پورت باز را با نوع درست برمی‌گرداند', async () => {
  const server = await socks5Server();
  const port = server.address().port;
  try {
    const found = await proxy.scanLocalProxies({ ports: [1, port], timeout: 600 });
    assert.strictEqual(found.port, port);
    assert.strictEqual(found.scheme, 'socks5');
  } finally {
    server.close();
  }
});

test('پورت‌های اضافیِ کاربر هم در جست‌وجو شرکت می‌کنند', async () => {
  const result = await proxy.detectProxy({
    platform: 'linux',
    ports: [],
    extraPorts: [12345],
    connect: (host, p) => Promise.resolve(p === 12345 ? { open: true, scheme: 'socks5' } : { open: false, scheme: 'http' }),
  });
  assert.strictEqual(result.source, 'scan');
  assert.strictEqual(result.port, 12345);
  assert.strictEqual(result.scheme, 'socks5');
  assert.strictEqual(result.address, '127.0.0.1:12345');
});
