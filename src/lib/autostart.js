'use strict';

/**
 * اجرای خودکار با ویندوز (پیشنهاد #۱) با کلید Run در رجیستری.
 * runner قابل تزریق است تا بدون ویندوز تست شود.
 */

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE = 'NetSplit';

function enable(runner, exePath) {
  return new Promise((resolve) => {
    try {
      runner('reg', ['add', RUN_KEY, '/v', VALUE, '/t', 'REG_SZ', '/d', exePath, '/f'], (err) => {
        resolve(!err);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function disable(runner) {
  return new Promise((resolve) => {
    try {
      runner('reg', ['delete', RUN_KEY, '/v', VALUE, '/f'], () => resolve(true));
    } catch (_) {
      resolve(true);
    }
  });
}

async function isEnabled(runner) {
  const out = await new Promise((resolve) => {
    try {
      runner('reg', ['query', RUN_KEY, '/v', VALUE], (err, stdout) => resolve(err ? null : stdout));
    } catch (_) {
      resolve(null);
    }
  });
  return !!out && out.includes(VALUE);
}

module.exports = { RUN_KEY, VALUE, enable, disable, isEnabled };
