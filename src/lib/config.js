'use strict';

/**
 * لایه‌ی تنظیمات و اکانت‌ها — کاملاً خالص (بدون وابستگی به Electron)
 * تا بتوان آن را با node:test تست کرد.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODES = ['direct', 'vpn', 'system'];
const CONFIG_FILE = 'config.json';
const CONFIG_VERSION = 1;

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    chromePath: '', // خالی = جست‌وجوی خودکار
    proxy: 'auto', // 'auto' یا مثلاً '127.0.0.1:10808' یا 'socks5://127.0.0.1:1080'
    accounts: [
      createAccount('اکانت با فیلترشکن', 'vpn', []),
      createAccount('اکانت بدون فیلترشکن', 'direct', []),
    ],
  };
}

/** پاک‌سازی نام برای استفاده به‌عنوان نام پوشه‌ی پروفایل کروم */
function sanitizeFolderName(name) {
  const cleaned = String(name || '')
    // کاراکترهای غیرمجاز در نام پوشه‌ی ویندوز
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 40);
  return cleaned || '';
}

function uniqueFolderName(name, taken) {
  const base = sanitizeFolderName(name) || 'profile';
  const used = new Set((taken || []).map((x) => String(x).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let i = 2;
  while (used.has(`${base}-${i}`.toLowerCase())) i += 1;
  return `${base}-${i}`;
}

function createAccount(name, mode = 'direct', existingAccounts = []) {
  const id = crypto.randomUUID();
  const taken = (existingAccounts || []).map((a) => a.folder).filter(Boolean);
  return {
    id,
    name: String(name || '').trim() || 'اکانت جدید',
    mode: MODES.includes(mode) ? mode : 'direct',
    // پوشه‌ی پروفایل فقط هنگام ساخت تعیین می‌شود و با تغییر نام عوض نمی‌شود
    // تا لاگین‌های کاربر از بین نرود.
    folder: uniqueFolderName(name, taken),
    createdAt: new Date().toISOString(),
  };
}

function normalizeAccount(raw, index) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const id = typeof safe.id === 'string' && safe.id ? safe.id : crypto.randomUUID();
  const name = typeof safe.name === 'string' && safe.name.trim() ? safe.name.trim() : `اکانت ${index + 1}`;
  return {
    id,
    name,
    mode: MODES.includes(safe.mode) ? safe.mode : 'direct',
    folder: sanitizeFolderName(safe.folder) || uniqueFolderName(name, []),
    createdAt: typeof safe.createdAt === 'string' ? safe.createdAt : new Date().toISOString(),
  };
}

function normalizeConfig(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const accounts = Array.isArray(safe.accounts) ? safe.accounts.map(normalizeAccount) : [];
  const cfg = {
    version: CONFIG_VERSION,
    chromePath: typeof safe.chromePath === 'string' ? safe.chromePath.trim() : '',
    proxy: typeof safe.proxy === 'string' && safe.proxy.trim() ? safe.proxy.trim() : 'auto',
    accounts: accounts.length ? accounts : defaultConfig().accounts,
  };
  // نام پوشه‌ی تکراری = تداخل پروفایل‌ها؛ اصلاحش کن
  const seen = new Set();
  cfg.accounts.forEach((a) => {
    a.folder = uniqueFolderName(a.folder, [...seen]);
    seen.add(a.folder);
  });
  return cfg;
}

function loadConfig(dir) {
  const file = path.join(dir, CONFIG_FILE);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return normalizeConfig(JSON.parse(text));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      // فایل خراب است؛ نسخه‌ی سالم جدید بساز اما قبلی را نگه دار
      try {
        fs.renameSync(file, `${file}.broken-${Date.now()}`);
      } catch (_) {
        /* اهمیتی ندارد */
      }
    }
    return defaultConfig();
  }
}

function saveConfig(dir, config) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CONFIG_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return config;
}

function findAccount(config, id) {
  return config.accounts.find((a) => a.id === id) || null;
}

function setMode(config, id, mode) {
  const account = findAccount(config, id);
  if (!account) throw new Error('account-not-found');
  if (!MODES.includes(mode)) throw new Error('bad-mode');
  account.mode = mode;
  return config;
}

function renameAccount(config, id, name) {
  const account = findAccount(config, id);
  if (!account) throw new Error('account-not-found');
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('empty-name');
  account.name = clean; // پوشه عمداً تغییر نمی‌کند
  return config;
}

function addAccount(config, name, mode = 'direct') {
  const account = createAccount(name, mode, config.accounts);
  config.accounts.push(account);
  return account;
}

function removeAccount(config, id) {
  const before = config.accounts.length;
  config.accounts = config.accounts.filter((a) => a.id !== id);
  if (config.accounts.length === before) throw new Error('account-not-found');
  return config;
}

function updateSettings(config, patch = {}) {
  if (typeof patch.chromePath === 'string') config.chromePath = patch.chromePath.trim();
  if (typeof patch.proxy === 'string' && patch.proxy.trim()) config.proxy = patch.proxy.trim();
  return config;
}

module.exports = {
  MODES,
  CONFIG_FILE,
  defaultConfig,
  normalizeConfig,
  normalizeAccount,
  loadConfig,
  saveConfig,
  createAccount,
  findAccount,
  setMode,
  renameAccount,
  addAccount,
  removeAccount,
  updateSettings,
  sanitizeFolderName,
  uniqueFolderName,
};
