'use strict';

const test = require('node:test');
const assert = require('node:assert');

const autostart = require('../src/lib/autostart');

function runnerFactory(output = null) {
  const calls = [];
  const fn = (cmd, args, cb) => {
    calls.push({ cmd, args });
    cb(null, output || '', '');
  };
  return { calls, fn };
}

test('فعال‌سازی، کلید Run را با مسیر exe می‌نویسد', async () => {
  const { calls, fn } = runnerFactory();
  const ok = await autostart.enable(fn, 'C:\\app\\NetSplit.exe');
  assert.strictEqual(ok, true);
  assert.strictEqual(calls[0].cmd, 'reg');
  assert.ok(calls[0].args.includes('add'));
  assert.ok(calls[0].args.includes(autostart.RUN_KEY));
  assert.ok(calls[0].args.includes('C:\\app\\NetSplit.exe'));
});

test('غیرفعال‌سازی، کلید Run را حذف می‌کند', async () => {
  const { calls, fn } = runnerFactory();
  await autostart.disable(fn);
  assert.ok(calls[0].args.includes('delete'));
  assert.ok(calls[0].args.includes('/v'));
});

test('isEnabled فقط وقتی کلید هست درست است', async () => {
  const on = runnerFactory(`    NetSplit    REG_SZ    C:\\app\\NetSplit.exe`);
  assert.strictEqual(await autostart.isEnabled(on.fn), true);
  const off = runnerFactory('');
  assert.strictEqual(await autostart.isEnabled(off.fn), false);
});

test('خطای reg برنامه را نمی‌خواباند', async () => {
  const bad = { fn: (cmd, args, cb) => cb(new Error('no reg')) };
  assert.strictEqual(await autostart.enable(bad.fn, 'x'), false);
  assert.strictEqual(await autostart.isEnabled(bad.fn), false);
});
