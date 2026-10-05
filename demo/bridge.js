'use strict';

/**
 * پل نمایشی (demo): همان window.api که در Electron از preload می‌آید،
 * ولی برای مرورگر شبیه‌سازی شده تا بتوان ظاهر و رفتار برنامه را دید.
 * در نسخه‌ی ویندوز، این کارها واقعاً انجام می‌شوند.
 */

(function () {
  const KEY = 'netsplit-demo-state';

  const defaults = () => ({
    config: {
      version: 1,
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      proxy: 'auto',
      accounts: [
        { id: 'a1', name: 'اکانت با فیلترشکن', mode: 'vpn', folder: 'اکانت-با-فیلترشکن' },
        { id: 'a2', name: 'اکانت بدون فیلترشکن', mode: 'direct', folder: 'اکانت-بدون-فیلترشکن' },
      ],
    },
    running: {},
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      if (!parsed.config || !Array.isArray(parsed.config.accounts)) return defaults();
      parsed.running = parsed.running || {};
      return parsed;
    } catch (_) {
      return defaults();
    }
  }

  const data = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (_) {
      /* noop */
    }
  };

  // در دمو فرض می‌کنیم فیلترشکن روی پورت رایج v2rayN فعال است
  const proxy = { source: 'scan', host: '127.0.0.1', port: 10808, scheme: 'http', address: '127.0.0.1:10808' };
  const listeners = [];

  function snapshot() {
    return JSON.parse(
      JSON.stringify({
        config: data.config,
        browser: { path: data.config.chromePath, name: 'Google Chrome' },
        proxy,
        running: data.running,
        profilesRoot: 'C:\\Users\\You\\AppData\\Roaming\\NetSplit\\ChromeProfiles',
        platform: 'demo',
      }),
    );
  }

  function emit() {
    const state = snapshot();
    listeners.forEach((fn) => fn(state));
    return state;
  }

  function find(id) {
    return data.config.accounts.find((a) => a.id === id);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  window.api = {
    async getState() {
      return snapshot();
    },
    async refreshProxy() {
      await wait(250);
      return emit();
    },
    async setMode(id, mode) {
      const account = find(id);
      if (account) account.mode = mode;
      save();
      return emit();
    },
    async rename(id, name) {
      const account = find(id);
      if (account) account.name = name;
      save();
      return emit();
    },
    async addAccount(name, mode) {
      data.config.accounts.push({
        id: `a${Date.now().toString(36)}`,
        name: name || 'اکانت جدید',
        mode: mode || 'direct',
        folder: `پروفایل-${data.config.accounts.length + 1}`,
      });
      save();
      return emit();
    },
    async removeAccount(id) {
      data.config.accounts = data.config.accounts.filter((a) => a.id !== id);
      delete data.running[id];
      save();
      return emit();
    },
    async updateSettings(patch) {
      Object.assign(data.config, patch);
      save();
      return emit();
    },
    async launch(id, opts) {
      await wait(300);
      const account = find(id);
      if (!account) return { ok: false, error: 'account-not-found' };
      if (account.mode === 'vpn' && data.config.proxy === 'none') return { ok: false, error: 'no-proxy-detected' };
      if (data.running[id] && !(opts && opts.skipRunningCheck)) return { ok: false, error: 'already-running' };
      data.running[id] = true;
      save();
      emit();
      return { ok: true, pid: 1000 + data.config.accounts.length };
    },
    async closeAll() {
      const count = Object.keys(data.running).length;
      data.running = {};
      save();
      emit();
      return { ok: true, closed: count };
    },
    async clearData(id) {
      if (data.running[id]) return { ok: false, error: 'close-first' };
      return { ok: true, removed: 3 };
    },
    async setAutoLaunch(on) {
      data.autoLaunch = !!on;
      save();
      return { ok: true, enabled: !!on };
    },
    async getAutoLaunch() {
      return !!data.autoLaunch;
    },
    async close(id) {
      await wait(200);
      if (!data.running[id]) return { ok: false, error: 'not-tracked' };
      delete data.running[id];
      save();
      emit();
      return { ok: true };
    },
    async chooseBrowser() {
      data.config.chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      save();
      return emit();
    },
    async openProfilesFolder() {
      return true;
    },
    onState(callback) {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    __resetDemo() {
      localStorage.removeItem(KEY);
      location.reload();
    },
  };
})();

// دکمه‌ی بازنشانی بنر دمو (بدون handler درون‌خطی، چون CSP اجازه نمی‌دهد)
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('demoReset');
  if (btn) btn.addEventListener('click', () => window.api.__resetDemo());
});
