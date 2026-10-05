'use strict';

/**
 * پیدا کردن مرورگر کروم و ساخت آرگومان‌های راه‌اندازی.
 * هسته‌ی کار همین‌جاست: هر پروفایل کروم با user-data-dir جداگانه اجرا می‌شود
 * و پروکسی آن با --proxy-server تعیین می‌شود؛ بنابراین دو اکانت می‌توانند
 * هم‌زمان یکی با فیلترشکن و یکی بدون آن آنلاین باشند.
 */

const fs = require('fs');
const path = require('path');

/** مرورگرهایی که از --proxy-server پشتیبانی می‌کنند */
const BROWSERS = [
  {
    name: 'Google Chrome',
    exe: 'chrome.exe',
    win: (env) => [
      path.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.LocalAppData || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  },
  {
    name: 'Microsoft Edge',
    exe: 'msedge.exe',
    win: (env) => [
      path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    linux: ['/usr/bin/microsoft-edge'],
    darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  },
  {
    name: 'Brave',
    exe: 'brave.exe',
    win: (env) => [
      path.join(env.ProgramFiles || 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(env.LocalAppData || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
    linux: ['/usr/bin/brave-browser'],
    darwin: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
  },
];

function candidatesFor(browser, env = process.env, platform = process.platform) {
  if (platform === 'win32') return typeof browser.win === 'function' ? browser.win(env) : [];
  if (platform === 'darwin') return browser.darwin || [];
  return browser.linux || [];
}

/**
 * پیدا کردن مرورگر. اگر مسیر دستی داده شده و وجود داشته باشد همان برگردانده می‌شود.
 * @returns {{path:string,name:string,custom:boolean}|null}
 */
function findBrowser(customPath = '', options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const exists = options.exists || ((p) => {
    try {
      return !!p && fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });

  if (customPath && exists(customPath)) {
    return { path: customPath, name: path.basename(customPath, path.extname(customPath)), custom: true };
  }

  for (const browser of BROWSERS) {
    for (const candidate of candidatesFor(browser, env, platform)) {
      if (candidate && exists(candidate)) return { path: candidate, name: browser.name, custom: false };
    }
  }
  return null;
}

function toProxyUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
}

/**
 * ساخت فلگ(های) پروکسی کروم برای هر حالت — سازگار با همه‌ی انواع اتصال:
 *  - direct : همیشه direct:// (دور زدن پروکسی سیستم)
 *  - system : بدون فلگ
 *  - vpn    : پروکسی دستی > پروکسی/PAC تشخیص‌داده‌شده > بدون فلگ (پیروی از TUN)
 * @returns {string[]}
 */
function proxyFlagsFor(mode, proxySetting = 'auto', detected = null) {
  if (mode === 'direct') return ['--proxy-server=direct://'];
  if (mode !== 'vpn') return [];

  const raw = String(proxySetting || '').trim();
  if (raw && raw !== 'auto') return [`--proxy-server=${toProxyUrl(raw)}`];

  if (detected) {
    if (detected.source === 'pac' && detected.pacUrl) {
      return [`--proxy-pac-url=${detected.pacUrl}`];
    }
    const value = formatDetected(detected);
    if (value) return [`--proxy-server=${value}`];
  }
  return [];
}

/**
 * مقدار --proxy-server برای نمایش/ذخیره؛ null یعنی بدون فلگ.
 */
function resolveProxyServer(mode, proxySetting = 'auto', detected = null) {
  if (mode === 'direct') return 'direct://';
  const flag = proxyFlagsFor(mode, proxySetting, detected).find(
    (f) => f.startsWith('--proxy-server='),
  );
  return flag ? flag.slice('--proxy-server='.length) : null;
}

function formatDetected(detected) {
  if (!detected || !detected.host || !detected.port) return '';
  const scheme = detected.scheme || 'http';
  return `${scheme}://${detected.host}:${detected.port}`;
}

/**
 * ساخت آرگومان‌های خط فرمان برای باز کردن یک اکانت.
 */
function buildLaunchArgs(account, options = {}) {
  const profilesRoot = options.profilesRoot;
  if (!profilesRoot) throw new Error('profiles-root-required');
  if (!account || !account.folder) throw new Error('account-folder-required');

  const userDataDir = path.join(profilesRoot, account.folder);
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
  ];

  args.push(...proxyFlagsFor(account.mode, options.proxy, options.detected));

  if (Array.isArray(options.extraArgs)) args.push(...options.extraArgs);
  if (options.url) args.push(String(options.url));
  return args;
}

module.exports = {
  BROWSERS,
  candidatesFor,
  findBrowser,
  proxyFlagsFor,
  resolveProxyServer,
  formatDetected,
  buildLaunchArgs,
};
