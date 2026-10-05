'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../src/lib/config');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'netsplit-cfg-'));
}

test('تنظیمات پیش‌فرض دو اکانت آماده می‌سازد: یکی با فیلترشکن، یکی بدون آن', () => {
  const cfg = config.defaultConfig();
  assert.strictEqual(cfg.accounts.length, 2);
  assert.deepStrictEqual(
    cfg.accounts.map((a) => a.mode),
    ['vpn', 'direct'],
  );
  assert.notStrictEqual(cfg.accounts[0].folder, cfg.accounts[1].folder);
  assert.strictEqual(cfg.proxy, 'auto');
});

test('ذخیره و خواندن تنظیمات بدون تغییر باقی می‌ماند', () => {
  const dir = tmpDir();
  const cfg = config.defaultConfig();
  config.addAccount(cfg, 'اکانت سوم', 'system');
  config.saveConfig(dir, cfg);

  const loaded = config.loadConfig(dir);
  assert.deepStrictEqual(loaded, cfg);
  assert.strictEqual(loaded.accounts[2].name, 'اکانت سوم');
  assert.strictEqual(loaded.accounts[2].mode, 'system');
});

test('فایل تنظیمات خراب باعث ساخت نسخه‌ی سالم می‌شود', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ این json نیست');
  const loaded = config.loadConfig(dir);
  assert.strictEqual(loaded.accounts.length, 2);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('config.json.broken-')));
});

test('حالت ناشناخته به «مستقیم» برمی‌گردد و نام پوشه‌ی تکراری اصلاح می‌شود', () => {
  const cfg = config.normalizeConfig({
    accounts: [
      { id: '1', name: 'الف', mode: 'weird', folder: 'one' },
      { id: '2', name: 'ب', mode: 'vpn', folder: 'one' },
    ],
  });
  assert.strictEqual(cfg.accounts[0].mode, 'direct');
  assert.strictEqual(cfg.accounts[1].mode, 'vpn');
  assert.notStrictEqual(cfg.accounts[0].folder, cfg.accounts[1].folder);
});

test('نام پوشه فقط کاراکترهای مجاز ویندوز دارد', () => {
  assert.strictEqual(config.sanitizeFolderName('اکانت/کار: *test*'), 'اکانت کار test');
  assert.strictEqual(config.sanitizeFolderName(''), '');
  assert.strictEqual(config.uniqueFolderName('', ['profile']), 'profile-2');
});

test('تغییر نام، پوشه‌ی پروفایل را عوض نمی‌کند (لاگین‌ها حفظ می‌شوند)', () => {
  const cfg = config.defaultConfig();
  const before = cfg.accounts[0].folder;
  config.renameAccount(cfg, cfg.accounts[0].id, 'نام تازه');
  assert.strictEqual(cfg.accounts[0].name, 'نام تازه');
  assert.strictEqual(cfg.accounts[0].folder, before);
});

test('اکانت جدید پوشه‌ی یکتا می‌گیرد حتی با نام تکراری', () => {
  const cfg = config.defaultConfig();
  const dup = config.addAccount(cfg, 'اکانت با فیلترشکن');
  assert.notStrictEqual(dup.folder, cfg.accounts[0].folder);
  assert.strictEqual(cfg.accounts.length, 3);
});

test('حذف و تغییر حالت روی اکانت ناموجود خطا می‌دهد', () => {
  const cfg = config.defaultConfig();
  assert.throws(() => config.removeAccount(cfg, 'nope'), /account-not-found/);
  assert.throws(() => config.setMode(cfg, 'nope', 'vpn'), /account-not-found/);
  assert.throws(() => config.setMode(cfg, cfg.accounts[0].id, 'turbo'), /bad-mode/);
  assert.throws(() => config.renameAccount(cfg, cfg.accounts[0].id, '   '), /empty-name/);
});

test('هر سه حالت اتصال پشتیبانی می‌شوند', () => {
  const cfg = config.defaultConfig();
  const id = cfg.accounts[0].id;
  ['direct', 'vpn', 'system'].forEach((mode) => {
    config.setMode(cfg, id, mode);
    assert.strictEqual(cfg.accounts[0].mode, mode);
  });
});
