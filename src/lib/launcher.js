'use strict';

/**
 * اجرا و مدیریت پروسه‌ی کروم هر اکانت.
 * نکته: اگر کرومِ همان پروفایل از قبل باز باشد، پروسه‌ی جدید سریع بسته می‌شود
 * و کار را به نمونه‌ی قبلی می‌سپارد؛ پس «در حال اجرا بودن» را از روی
 * فایل lockfile پوشه‌ی پروفایل هم بررسی می‌کنیم.
 */

const fs = require('fs');
const path = require('path');
const { spawn: defaultSpawn, execFile: defaultExecFile } = require('child_process');

const LOCK_FILES = ['lockfile', 'SingletonLock'];

class Launcher {
  constructor(options = {}) {
    this.spawnFn = options.spawn || defaultSpawn;
    this.execFileFn = options.execFile || defaultExecFile;
    this.platform = options.platform || process.platform;
    this.exists = options.exists || ((p) => {
      try {
        return fs.existsSync(p);
      } catch (_) {
        return false;
      }
    });
    /** @type {Map<string, {pid:number, child:object, startedAt:number}>} */
    this.processes = new Map();
  }

  userDataDir(profilesRoot, account) {
    return path.join(profilesRoot, account.folder);
  }

  hasLockFile(profilesRoot, account) {
    const dir = this.userDataDir(profilesRoot, account);
    return LOCK_FILES.some((name) => this.exists(path.join(dir, name)));
  }

  isRunning(id, context = null) {
    const entry = this.processes.get(id);
    if (entry && entry.child && !entry.child.killed && entry.exitCode === undefined) return true;
    if (context && context.account && context.profilesRoot) return this.hasLockFile(context.profilesRoot, context.account);
    return false;
  }

  runningIds() {
    return [...this.processes.keys()];
  }

  /**
   * @param {object} p {account, browserPath, args, profilesRoot, force}
   * @returns {Promise<{ok:boolean, pid?:number, error?:string}>}
   */
  launch(p) {
    const { account, browserPath, args, profilesRoot, force = false, skipRunningCheck = false } = p;
    if (!browserPath) return Promise.resolve({ ok: false, error: 'browser-not-found' });
    if (!account) return Promise.resolve({ ok: false, error: 'account-not-found' });

    if (!skipRunningCheck && this.isRunning(account.id, { account, profilesRoot })) {
      if (!force) return Promise.resolve({ ok: false, error: 'already-running' });
      return this.close(account.id, { account, profilesRoot }).then(() => this.launch({ ...p, force: false }));
    }

    return new Promise((resolve) => {
      let child;
      try {
        child = this.spawnFn(browserPath, args, {
          detached: false,
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch (err) {
        return resolve({ ok: false, error: err && err.code === 'ENOENT' ? 'browser-not-found' : 'spawn-failed' });
      }

      const entry = { pid: child.pid || 0, child, startedAt: Date.now(), exitCode: undefined };
      this.processes.set(account.id, entry);

      child.once('error', (err) => {
        this.processes.delete(account.id);
        resolve({ ok: false, error: err && err.code === 'ENOENT' ? 'browser-not-found' : 'spawn-failed' });
      });

      child.once('exit', (code) => {
        entry.exitCode = code === null ? 1 : code;
        // کرومِ در حال اجرا = این پروسه کار را به نمونه‌ی قبلی سپرده است
        if (Date.now() - entry.startedAt < 3000 && this.hasLockFile(profilesRoot, account)) return;
        this.processes.delete(account.id);
      });

      // کمی صبر می‌کنیم تا خطای احتمالی ENOENT گزارش شود
      setTimeout(() => {
        if (this.processes.get(account.id) === entry) resolve({ ok: true, pid: entry.pid });
      }, 120);
    });
  }

  close(id, context = {}) {
    const entry = this.processes.get(id);
    if (!entry) {
      return Promise.resolve({ ok: false, error: 'not-tracked' });
    }
    return new Promise((resolve) => {
      const finish = (result) => {
        this.processes.delete(id);
        resolve(result);
      };
      try {
        if (this.platform === 'win32' && entry.pid) {
          this.execFileFn('taskkill', ['/F', '/T', '/PID', String(entry.pid)], () => finish({ ok: true }));
        } else {
          entry.child.kill('SIGTERM');
          finish({ ok: true });
        }
      } catch (_) {
        finish({ ok: false, error: 'kill-failed' });
      }
    });
  }
}

module.exports = { Launcher, LOCK_FILES };
