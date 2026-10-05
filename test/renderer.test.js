'use strict';

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');

const openWindows = [];
after(() => {
  openWindows.forEach((w) => {
    try {
      w.close();
    } catch (_) {
      /* noop */
    }
  });
});

function baseState(overrides = {}) {
  return {
    config: {
      version: 1,
      chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      proxy: 'auto',
      accounts: [
        { id: 'a1', name: 'اکانت با فیلترشکن', mode: 'vpn', folder: 'acc-vpn' },
        { id: 'a2', name: 'اکانت شخصی', mode: 'direct', folder: 'acc-direct' },
      ],
    },
    browser: { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'Google Chrome' },
    proxy: { source: 'scan', host: '127.0.0.1', port: 10808, scheme: 'http', address: '127.0.0.1:10808' },
    running: { a1: false, a2: false },
    profilesRoot: 'C:\\Users\\me\\AppData\\Roaming\\NetSplit\\ChromeProfiles',
    platform: 'win32',
    ...overrides,
  };
}

async function createApp(options = {}) {
  const state = options.state || baseState();
  const calls = [];
  // runScripts لازم است تا window.eval داخل کانتکست صفحه اجرا شود
  const dom = new JSDOM(HTML, {
    url: 'file:///app/index.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  const { window } = dom;

  window.api = {
    getState: async () => state,
    refreshProxy: async () => {
      calls.push(['refreshProxy']);
      return state;
    },
    setMode: async (id, mode) => {
      calls.push(['setMode', id, mode]);
      state.config.accounts.find((a) => a.id === id).mode = mode;
      return state;
    },
    rename: async (id, name) => {
      calls.push(['rename', id, name]);
      state.config.accounts.find((a) => a.id === id).name = name;
      return state;
    },
    addAccount: async (name, mode) => {
      calls.push(['addAccount', name, mode]);
      state.config.accounts.push({ id: `a${state.config.accounts.length + 1}`, name, mode, folder: 'new' });
      return state;
    },
    removeAccount: async (id) => {
      calls.push(['removeAccount', id]);
      state.config.accounts = state.config.accounts.filter((a) => a.id !== id);
      return state;
    },
    updateSettings: async (patch) => {
      calls.push(['updateSettings', patch]);
      Object.assign(state.config, patch);
      return state;
    },
    launch: async (id, opts) => {
      calls.push(['launch', id, opts || null]);
      return options.launchResult || { ok: true, pid: 1 };
    },
    close: async (id) => {
      calls.push(['close', id]);
      return { ok: true };
    },
    chooseBrowser: async () => {
      calls.push(['chooseBrowser']);
      return state;
    },
    openProfilesFolder: async () => {
      calls.push(['openProfilesFolder']);
      return true;
    },
    onState: () => () => {},
  };

  openWindows.push(window);
  window.eval(APP_JS);
  await window.NS.init();
  return { window, document: window.document, calls, state };
}

function click(node) {
  assert.ok(node, 'گره مورد نظر پیدا نشد');
  node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
}

function cardOf(document, id) {
  return document.querySelector(`.card[data-id="${id}"]`);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('هر دو اکانت به‌صورت کارت نمایش داده می‌شوند', async () => {
  const { document, window } = await createApp();
  const cards = document.querySelectorAll('.card');
  assert.strictEqual(cards.length, 2);
  assert.ok(document.body.textContent.includes('اکانت با فیلترشکن'));
  assert.ok(document.body.textContent.includes('اکانت شخصی'));
  assert.ok(cardOf(document, 'a1').querySelector('.mode-btn[data-mode="vpn"].active'));
  assert.ok(cardOf(document, 'a2').querySelector('.mode-btn[data-mode="direct"].active'));
  window.NS.stop();
});

test('یک کلیک روی «با فیلترشکن» حالت اکانت را عوض می‌کند', async () => {
  const { document, calls, window } = await createApp();
  click(cardOf(document, 'a2').querySelector('.mode-btn[data-mode="vpn"]'));
  await tick();
  assert.deepStrictEqual(calls[0], ['setMode', 'a2', 'vpn']);
  assert.ok(cardOf(document, 'a2').querySelector('.mode-btn[data-mode="vpn"]').classList.contains('active'));
  window.NS.stop();
});

test('دکمه‌ی «باز کردن کروم» همان اکانت را اجرا می‌کند', async () => {
  const { document, calls, window } = await createApp();
  click(cardOf(document, 'a1').querySelector('[data-action="launch"]'));
  await tick();
  assert.deepStrictEqual(calls[0], ['launch', 'a1', null]);
  assert.ok(document.getElementById('status').textContent.includes('باز شد'));
  window.NS.stop();
});

test('راهنمای هر کارت، اتصال انتخابی را توضیح می‌دهد', async () => {
  const { document, window } = await createApp();
  assert.ok(cardOf(document, 'a2').querySelector('.hint').textContent.includes('بدون پروکسی'));
  assert.ok(cardOf(document, 'a1').querySelector('.hint').textContent.includes('127.0.0.1:10808'));
  window.NS.stop();
});

test('وضعیت فیلترشکن در نوار بالا نشان داده می‌شود', async () => {
  const on = await createApp();
  assert.strictEqual(on.document.getElementById('proxyChip').className, 'proxy-chip on');
  assert.ok(on.document.getElementById('proxyText').textContent.includes('127.0.0.1:10808'));
  on.window.NS.stop();

  const off = await createApp({
    state: baseState({ proxy: { source: 'none', host: null, port: null, address: '' } }),
  });
  assert.strictEqual(off.document.getElementById('proxyChip').className, 'proxy-chip off');
  assert.ok(off.document.getElementById('proxyText').textContent.includes('پیدا نشد'));
  off.window.NS.stop();
});

test('اگر فیلترشکن پیدا نشود، پیام راهنما به کاربر می‌دهد نه اتصال اشتباه', async () => {
  const { document, window } = await createApp({ launchResult: { ok: false, error: 'no-proxy-detected' } });
  click(cardOf(document, 'a1').querySelector('[data-action="launch"]'));
  await tick();
  assert.ok(document.getElementById('status').textContent.includes('فیلترشکن را روشن کنید'));
  assert.strictEqual(document.getElementById('status').className, 'status error');
  window.NS.stop();
});

test('اگر کرومِ اکانت باز باشد، اول می‌پرسد و بعد با force دوباره باز می‌کند', async () => {
  const { document, calls, window } = await createApp({ launchResult: { ok: false, error: 'already-running' } });
  click(cardOf(document, 'a1').querySelector('[data-action="launch"]'));
  await tick();

  const backdrop = document.getElementById('modalBackdrop');
  assert.strictEqual(backdrop.hidden, false);
  assert.ok(document.getElementById('modalTitle').textContent.includes('باز است'));

  click(document.getElementById('modalOk'));
  await tick();
  await tick();
  assert.deepStrictEqual(calls.map((c) => c[0]), ['launch', 'launch']);
  // آبجکت آرگومان از realm خودِ صفحه می‌آید، پس فیلدبه‌فیلد بررسی می‌شود
  assert.strictEqual(calls[1][1], 'a1');
  assert.strictEqual(calls[1][2].force, true);
  window.NS.stop();
});

test('اکانت در حال اجرا، دکمه‌ی بستن و نشانِ «کروم باز است» دارد', async () => {
  const { document, calls, window } = await createApp({
    state: baseState({ running: { a1: true, a2: false } }),
  });
  assert.ok(cardOf(document, 'a1').textContent.includes('کروم باز است'));
  const closeBtn = cardOf(document, 'a1').querySelectorAll('.actions .btn')[1];
  click(closeBtn);
  await tick();
  assert.deepStrictEqual(calls[0], ['close', 'a1']);
  window.NS.stop();
});

test('افزودن اکانت از طریق پنجره‌ی کوچک', async () => {
  const { document, calls, window } = await createApp();
  click(document.querySelector('.bottombar [data-action="add"]'));
  await tick();
  assert.strictEqual(document.getElementById('modalBackdrop').hidden, false);

  const input = document.querySelector('#modalBody input');
  input.value = 'اکانت دانشگاه';
  click(document.getElementById('modalOk'));
  await tick();
  await tick();

  assert.deepStrictEqual(calls[0], ['addAccount', 'اکانت دانشگاه', 'direct']);
  assert.strictEqual(document.querySelectorAll('.card').length, 3);
  assert.strictEqual(document.getElementById('modalBackdrop').hidden, true);
  window.NS.stop();
});

test('تغییر نام از کارت انجام می‌شود', async () => {
  const { document, calls, window } = await createApp();
  click(cardOf(document, 'a1').querySelectorAll('.card-head .icon-btn')[0]);
  await tick();
  const input = document.querySelector('#modalBody input');
  input.value = 'اکانت کاری';
  click(document.getElementById('modalOk'));
  await tick();
  await tick();
  assert.deepStrictEqual(calls[0], ['rename', 'a1', 'اکانت کاری']);
  assert.ok(document.body.textContent.includes('اکانت کاری'));
  window.NS.stop();
});

test('حذف اکانت با تأیید کاربر انجام می‌شود', async () => {
  const { document, calls, window } = await createApp();
  click(cardOf(document, 'a2').querySelectorAll('.card-head .icon-btn')[1]);
  await tick();
  assert.ok(document.getElementById('modalBody').textContent.includes('حذف می‌شود'));
  click(document.getElementById('modalOk'));
  await tick();
  await tick();
  assert.deepStrictEqual(calls[0], ['removeAccount', 'a2']);
  assert.strictEqual(document.querySelectorAll('.card').length, 1);
  window.NS.stop();
});

test('انصراف در پنجره‌ی کوچک هیچ تغییری نمی‌دهد', async () => {
  const { document, calls, window } = await createApp();
  click(document.querySelector('.bottombar [data-action="add"]'));
  await tick();
  click(document.getElementById('modalCancel'));
  await tick();
  assert.strictEqual(document.getElementById('modalBackdrop').hidden, true);
  assert.strictEqual(calls.length, 0);
  window.NS.stop();
});

test('در تنظیمات می‌توان آدرس پروکسی را دستی وارد کرد', async () => {
  const { document, calls, window } = await createApp();
  click(document.querySelector('.bottombar [data-action="settings"]'));
  await tick();

  const inputs = document.querySelectorAll('#modalBody input');
  inputs[1].value = '127.0.0.1:7890';
  click(document.getElementById('modalOk'));
  await tick();
  await tick();

  assert.strictEqual(calls[0][0], 'updateSettings');
  assert.strictEqual(calls[0][1].proxy, '127.0.0.1:7890');
  window.NS.stop();
});

test('خالی گذاشتن پروکسی در تنظیمات یعنی «پیدا کردن خودکار»', async () => {
  const { document, calls, window } = await createApp();
  click(document.querySelector('.bottombar [data-action="settings"]'));
  await tick();
  click(document.getElementById('modalOk'));
  await tick();
  await tick();
  assert.strictEqual(calls[0][1].proxy, 'auto');
  window.NS.stop();
});

test('دکمه‌ی جست‌وجوی فیلترشکن، تشخیص را دوباره اجرا می‌کند', async () => {
  const { document, calls, window } = await createApp();
  click(document.getElementById('refreshProxy'));
  await tick();
  assert.deepStrictEqual(calls[0], ['refreshProxy']);
  assert.ok(document.getElementById('status').textContent.includes('127.0.0.1:10808'));
  window.NS.stop();
});

test('بدون اکانت، پیام خالی بودن نشان داده می‌شود', async () => {
  const state = baseState();
  state.config.accounts = [];
  const { document, window } = await createApp({ state });
  assert.strictEqual(document.querySelectorAll('.card').length, 0);
  assert.strictEqual(document.getElementById('emptyState').hidden, false);
  window.NS.stop();
});

test('صفحه راست‌به‌چپ و فارسی است', async () => {
  const { document, window } = await createApp();
  assert.strictEqual(document.documentElement.getAttribute('dir'), 'rtl');
  assert.strictEqual(document.documentElement.getAttribute('lang'), 'fa');
  window.NS.stop();
});
