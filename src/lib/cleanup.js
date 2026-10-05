'use strict';

/**
 * پاک‌سازی کوکی‌ها/تاریخچه‌ی یک اکانت (پیشنهاد #۱۴).
 * پوشه‌ی پروفایل هر اکانت جداست، پس فقط داده‌های همان اکانت پاک می‌شود.
 * فقط وقتی کرومِ آن اکانت بسته باشد انجام می‌شود.
 */

const fs = require('fs');
const path = require('path');

const DATA_SUBPATHS = [
  'Cookies',
  'Cookies-journal',
  'History',
  'History-journal',
  'Cache',
  'Code Cache',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Web Data',
  'Web Data-journal',
];

function browsingDataPaths(profilesRoot, account) {
  const base = path.join(profilesRoot, account.folder, 'Default');
  return DATA_SUBPATHS.map((sub) => path.join(base, sub));
}

function clearBrowsingData(options) {
  const { account, profilesRoot } = options;
  if (!account || !account.folder) return { ok: false, error: 'account-not-found' };
  const exists = options.exists || ((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });
  const rm = options.rmSync || ((p) => fs.rmSync(p, { recursive: true, force: true }));
  if (options.isRunning) return { ok: false, error: 'close-first' };

  let removed = 0;
  for (const p of browsingDataPaths(profilesRoot, account)) {
    if (exists(p)) {
      try {
        rm(p);
        removed += 1;
      } catch (_) {
        /* نادیده بگیر */
      }
    }
  }
  return { ok: true, removed };
}

module.exports = { DATA_SUBPATHS, browsingDataPaths, clearBrowsingData };
