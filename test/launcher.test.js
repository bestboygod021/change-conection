'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { Launcher } = require('../src/lib/launcher');

function fakeSpawn(failWith = null) {
  const calls = [];
  const fn = (cmd, args) => {
    if (failWith) {
      const err = new Error('spawn failed');
      err.code = failWith;
      throw err;
    }
    const child = new EventEmitter();
    child.pid = 4242 + calls.length;
    child.killed = false;
    child.kill = (signal) => {
      child.killed = true;
      child.signal = signal;
    };
    calls.push({ cmd, args, child });
    return child;
  };
  return { calls, fn };
}

const account = { id: 'acc-1', name: 'اکانت', folder: 'اکانت', mode: 'vpn' };

test('کروم با آرگومان‌های ساخته‌شده اجرا می‌شود', async () => {
  const { calls, fn } = fakeSpawn();
  const launcher = new Launcher({ spawn: fn, exists: () => false });
  const result = await launcher.launch({
    account,
    browserPath: 'C:\\chrome.exe',
    args: ['--proxy-server=http://127.0.0.1:10808'],
    profilesRoot: '/profiles',
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.pid, 4242);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].cmd, 'C:\\chrome.exe');
  assert.deepStrictEqual(calls[0].args, ['--proxy-server=http://127.0.0.1:10808']);
  assert.deepStrictEqual(launcher.runningIds(), ['acc-1']);
});

test('اجرای دوباره‌ی اکانتِ باز، خطای already-running می‌دهد', async () => {
  const { calls, fn } = fakeSpawn();
  const launcher = new Launcher({ spawn: fn, exists: () => false });
  await launcher.launch({ account, browserPath: 'chrome', args: [], profilesRoot: '/p' });
  const second = await launcher.launch({ account, browserPath: 'chrome', args: [], profilesRoot: '/p' });

  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.error, 'already-running');
  assert.strictEqual(calls.length, 1);
});

test('با force اول کروم بسته و بعد دوباره باز می‌شود', async () => {
  const { calls, fn } = fakeSpawn();
  const killed = [];
  const launcher = new Launcher({
    spawn: fn,
    exists: () => false,
    platform: 'win32',
    execFile: (cmd, args, cb) => {
      killed.push({ cmd, args });
      cb(null, '', '');
    },
  });

  await launcher.launch({ account, browserPath: 'chrome', args: ['--a'], profilesRoot: '/p' });
  const forced = await launcher.launch({ account, browserPath: 'chrome', args: ['--b'], profilesRoot: '/p', force: true });

  assert.strictEqual(forced.ok, true);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(killed.length, 1);
  assert.strictEqual(killed[0].cmd, 'taskkill');
  assert.ok(killed[0].args.includes('/T'));
  assert.ok(killed[0].args.includes(String(4242)));
});

test('پیدا نشدن فایل مرورگر پیام مشخص دارد', async () => {
  const { fn } = fakeSpawn('ENOENT');
  const launcher = new Launcher({ spawn: fn, exists: () => false });
  const result = await launcher.launch({ account, browserPath: 'nope', args: [], profilesRoot: '/p' });
  assert.deepStrictEqual(result, { ok: false, error: 'browser-not-found' });

  const noPath = await launcher.launch({ account, browserPath: '', args: [], profilesRoot: '/p' });
  assert.strictEqual(noPath.error, 'browser-not-found');
});

test('خطای asynchronous پروسه هم گزارش می‌شود', async () => {
  const { calls, fn } = fakeSpawn();
  const launcher = new Launcher({ spawn: fn, exists: () => false });
  const promise = launcher.launch({ account, browserPath: 'chrome', args: [], profilesRoot: '/p' });
  const err = new Error('nope');
  err.code = 'ENOENT';
  calls[0].child.emit('error', err);
  const result = await promise;
  assert.strictEqual(result.error, 'browser-not-found');
  assert.deepStrictEqual(launcher.runningIds(), []);
});

test('lockfile پوشه‌ی پروفایل یعنی کروم باز است (حتی بدون پروسه‌ی ثبت‌شده)', () => {
  const launcher = new Launcher({ exists: (p) => p.endsWith('lockfile') });
  assert.strictEqual(launcher.isRunning('unknown', { account, profilesRoot: '/p' }), true);
  const noLock = new Launcher({ exists: () => false });
  assert.strictEqual(noLock.isRunning('unknown', { account, profilesRoot: '/p' }), false);
});

test('بستن اکانتی که باز نیست خطای not-tracked می‌دهد', async () => {
  const launcher = new Launcher({ exists: () => false });
  const result = await launcher.close('acc-1');
  assert.strictEqual(result.error, 'not-tracked');
});

test('در لینوکس/مک به‌جای taskkill سیگنال ارسال می‌شود', async () => {
  const { calls, fn } = fakeSpawn();
  const launcher = new Launcher({ spawn: fn, exists: () => false, platform: 'linux' });
  await launcher.launch({ account, browserPath: 'chrome', args: [], profilesRoot: '/p' });
  const result = await launcher.close('acc-1');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls[0].child.killed, true);
  assert.strictEqual(calls[0].child.signal, 'SIGTERM');
});
