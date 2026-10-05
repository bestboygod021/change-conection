'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cleanup = require('../src/lib/cleanup');

const account = { id: 'a1', name: 'اکانت', folder: 'acc-one', mode: 'direct' };

function makeProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-clean-'));
  const base = path.join(root, 'acc-one', 'Default');
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'Cookies'), 'x');
  fs.writeFileSync(path.join(base, 'History'), 'x');
  fs.mkdirSync(path.join(base, 'Cache'), { recursive: true });
  return root;
}

test('مسیرهای داده‌ی یک اکانت زیر Default ساخته می‌شوند', () => {
  const paths = cleanup.browsingDataPaths('/root', account);
  assert.ok(paths.includes(path.join('/root', 'acc-one', 'Default', 'Cookies')));
  assert.ok(paths.includes(path.join('/root', 'acc-one', 'Default', 'History')));
});

test('پاک‌سازی فقط داده‌های همان اکانت را حذف می‌کند', () => {
  const root = makeProfile();
  const result = cleanup.clearBrowsingData({ account, profilesRoot: root });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.removed, 3);
  const base = path.join(root, 'acc-one', 'Default');
  assert.ok(!fs.existsSync(path.join(base, 'Cookies')));
  assert.ok(!fs.existsSync(path.join(base, 'History')));
  assert.ok(!fs.existsSync(path.join(base, 'Cache')));
});

test('اگر کروم باز باشد، پاک‌سازی رد می‌شود', () => {
  const root = makeProfile();
  const result = cleanup.clearBrowsingData({ account, profilesRoot: root, isRunning: true });
  assert.deepStrictEqual(result, { ok: false, error: 'close-first' });
  const base = path.join(root, 'acc-one', 'Default');
  assert.ok(fs.existsSync(path.join(base, 'Cookies')));
});

test('اکانت ناموجود خطا می‌دهد', () => {
  const result = cleanup.clearBrowsingData({ account: null, profilesRoot: '/x' });
  assert.strictEqual(result.error, 'account-not-found');
});
