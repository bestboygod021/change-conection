'use strict';

/**
 * هسته‌ی برنامه: ترکیب تنظیمات + تشخیص مرورگر + تشخیص پروکسی + اجرا.
 * این ماژول به Electron وابسته نیست تا بتوان آن را مستقیم تست کرد.
 */

const fs = require('fs');
const { spawn, execFile } = require('child_process');

const configLib = require('./config');
const chrome = require('./chrome');
const proxyLib = require('./proxy');
const { Launcher } = require('./launcher');

function createStore(options = {}) {
  const configDir = options.configDir;
  if (!configDir) throw new Error('config-dir-required');
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const exists = options.exists;
  const spawnFn = options.spawn || spawn;
  const execFileFn = options.execFile || execFile;
  const detect = options.detectProxy || ((opts) => proxyLib.detectProxy(opts));

  const profilesRoot = options.profilesRoot || (platform === 'win32'
    ? `${env.APPDATA || env.LocalAppData || configDir}\\NetSplit\\ChromeProfiles`
    : `${configDir}/ChromeProfiles`);

  let config = configLib.loadConfig(configDir);
  const launcher = new Launcher({ platform, spawn: spawnFn, execFile: execFileFn, exists });
  let detected = { source: 'none', host: null, port: null, scheme: null, address: '' };

  function persist() {
    configLib.saveConfig(configDir, config);
  }

  async function refreshProxy() {
    detected = await detect({
      platform,
      runner: execFileFn,
      probe: options.probe,
      connect: options.connect,
      ports: options.proxyPorts,
      extraPorts: config.proxyPorts,
      timeout: options.proxyTimeout,
    });
    return detected;
  }

  function browserInfo() {
    return chrome.findBrowser(config.chromePath, { env, platform, exists });
  }

  function runningMap() {
    const map = {};
    for (const account of config.accounts) {
      map[account.id] = launcher.isRunning(account.id, { account, profilesRoot });
    }
    return map;
  }

  async function getState() {
    return {
      config,
      browser: browserInfo(),
      proxy: detected,
      running: runningMap(),
      profilesRoot,
      platform,
    };
  }

  function setMode(id, mode) {
    configLib.setMode(config, id, mode);
    persist();
    return getState();
  }

  function rename(id, name) {
    configLib.renameAccount(config, id, name);
    persist();
    return getState();
  }

  function add(name, mode) {
    configLib.addAccount(config, name, mode);
    persist();
    return getState();
  }

  function remove(id) {
    configLib.removeAccount(config, id);
    persist();
    return getState();
  }

  function updateSettings(patch) {
    configLib.updateSettings(config, patch);
    persist();
    return getState();
  }

  async function launch(id, opts = {}) {
    const account = configLib.findAccount(config, id);
    if (!account) return { ok: false, error: 'account-not-found' };

    const browser = browserInfo();
    if (!browser) return { ok: false, error: 'browser-not-found' };

    let warning = null;
    if (account.mode === 'vpn' && !chrome.resolveProxyServer('vpn', config.proxy, detected)) {
      // پروکسی پیدا نشد؛ احتمالاً فیلترشکن از نوع TUN/آداپتور است.
      // بدون فلگ پروکسی اجرا می‌کنیم تا از همان اتصال فعال سیستم پیروی کند.
      warning = 'no-proxy-follow-system';
    }

    fs.mkdirSync(profilesRoot, { recursive: true });
    const args = chrome.buildLaunchArgs(account, {
      profilesRoot,
      proxy: config.proxy,
      detected,
      extraArgs: opts.extraArgs,
      url: opts.url,
    });

    const result = await launcher.launch({
      account,
      browserPath: browser.path,
      args,
      profilesRoot,
      force: !!opts.force,
    });
    if (result.ok && warning) result.warning = warning;
    return result;
  }

  function close(id) {
    const account = configLib.findAccount(config, id);
    if (!account) return Promise.resolve({ ok: false, error: 'account-not-found' });
    return launcher.close(id, { account, profilesRoot });
  }

  return {
    get config() {
      return config;
    },
    get detectedProxy() {
      return detected;
    },
    get profilesRoot() {
      return profilesRoot;
    },
    launcher,
    refreshProxy,
    getState,
    setMode,
    rename,
    add,
    remove,
    updateSettings,
    launch,
    close,
    browserInfo,
  };
}

module.exports = { createStore };
