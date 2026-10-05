'use strict';

/* رابط کاربری نت‌اسپلیت — بدون وابستگی به Node، هم در Electron و هم در نسخه‌ی دمو کار می‌کند */

(function () {
  const MODES = [
    { id: 'direct', label: 'مستقیم' },
    { id: 'vpn', label: 'با فیلترشکن' },
    { id: 'system', label: 'پیش‌فرض ویندوز' },
  ];

  const MESSAGES = {
    'browser-not-found': 'کروم پیدا نشد. از «تنظیمات» مسیر فایل chrome.exe را انتخاب کنید.',
    'no-proxy-detected': 'پروکسی فیلترشکن پیدا نشد. فیلترشکن را روشن کنید یا آدرس پروکسی را در تنظیمات وارد کنید.',
    'already-running': 'کرومِ این اکانت باز است. برای اعمال تغییر، اول آن را ببندید.',
    'spawn-failed': 'اجرای کروم ناموفق بود.',
    'account-not-found': 'این اکانت وجود ندارد.',
    'not-tracked': 'این پنجره را نت‌اسپلیت باز نکرده است؛ دستی ببندیدش.',
  };

  const state = { data: null, busy: new Set(), modalOpen: false };
  const api = window.api;

  /* ---------- ابزار DOM ---------- */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
    });
    (children || []).forEach((child) => child && node.appendChild(child));
    return node;
  }

  function icon(paths, size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 15));
    svg.setAttribute('height', String(size || 15));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    paths.forEach((d) => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  const ICONS = {
    close: ['M6 6l12 12', 'M18 6L6 18'],
    edit: ['M4 20h4l10-10-4-4L4 16v4z', 'M14 6l4 4'],
    trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'],
    folder: ['M3 7h6l2 2h10v9H3z'],
  };

  /* ---------- وضعیت ---------- */
  function setStatus(text, kind) {
    const node = document.getElementById('status');
    if (!node) return;
    node.textContent = text || '';
    node.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function message(code, fallback) {
    return MESSAGES[code] || fallback || code || 'خطای نامشخص';
  }

  function proxyAddress(data) {
    if (!data) return '';
    const configured = data.config && data.config.proxy;
    if (configured && configured !== 'auto') return configured;
    if (data.proxy && data.proxy.address) return data.proxy.address;
    return '';
  }

  function hintText(account, data) {
    if (account.mode === 'direct') return 'بدون پروکسی — حتی اگر فیلترشکن روشن باشد';
    if (account.mode === 'system') return 'همان پروکسی که در تنظیمات ویندوز فعال است';
    const address = proxyAddress(data);
    if (address) return `از طریق پروکسی ${address}`;
    return 'پروکسی پیدا نشد؛ از اتصال فعال سیستم پیروی می‌کند (TUN یا پروکسی سیستم)';
  }

  async function refresh() {
    if (!api) return;
    try {
      state.data = await api.getState();
      if (!state.modalOpen) render();
    } catch (err) {
      setStatus('ارتباط با برنامه قطع شد.', 'error');
    }
  }

  /* ---------- کارت اکانت ---------- */
  function avatarLetter(name) {
    const trimmed = String(name || '').trim();
    return trimmed ? trimmed[0] : '؟';
  }

  function modeButtons(account) {
    const wrap = el('div', { class: 'modes', role: 'group', 'aria-label': 'انتخاب اتصال' });
    MODES.forEach((mode) => {
      const active = account.mode === mode.id;
      wrap.appendChild(
        el('button', {
          class: `mode-btn${active ? ' active' : ''}`,
          type: 'button',
          'data-mode': mode.id,
          'data-id': account.id,
          'aria-pressed': active ? 'true' : 'false',
          title: mode.label,
          onclick: () => chooseMode(account.id, mode.id),
          text: mode.label,
        }),
      );
    });
    return wrap;
  }

  function cardFor(account, data) {
    const running = !!(data.running && data.running[account.id]);
    const card = el('article', { class: `card mode-${account.mode}`, 'data-id': account.id });

    const head = el('div', { class: 'card-head' }, [
      el('div', { class: 'avatar', text: avatarLetter(account.name) }),
      el('div', { class: 'card-title' }, [
        el('h3', { text: account.name, title: account.name }),
        el('span', {
          class: `badge${running ? ' running' : ''}`,
          text: running ? 'کروم باز است' : 'بسته',
        }),
      ]),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        title: 'تغییر نام',
        'aria-label': 'تغییر نام',
        onclick: () => askRename(account),
      }, [icon(ICONS.edit)]),
      el('button', {
        class: 'icon-btn danger',
        type: 'button',
        title: 'حذف اکانت',
        'aria-label': 'حذف اکانت',
        onclick: () => askRemove(account),
      }, [icon(ICONS.trash)]),
    ]);

    const actions = el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn btn-primary btn-open',
        type: 'button',
        disabled: state.busy.has(account.id),
        'data-action': 'launch',
        'data-id': account.id,
        onclick: () => launch(account),
        text: running ? 'باز کردن پنجره‌ی جدید' : 'باز کردن کروم',
      }),
      running
        ? el('button', {
            class: 'btn btn-ghost',
            type: 'button',
            title: 'بستن کروم این اکانت',
            'aria-label': 'بستن کروم این اکانت',
            onclick: () => closeAccount(account),
          }, [icon(ICONS.close)])
        : null,
    ]);

    card.appendChild(head);
    card.appendChild(modeButtons(account));
    card.appendChild(el('p', { class: 'hint', text: hintText(account, data) }));
    card.appendChild(actions);
    return card;
  }

  function render() {
    const host = document.getElementById('cards');
    const empty = document.getElementById('emptyState');
    if (!host || !state.data) return;

    const accounts = state.data.config.accounts;
    host.textContent = '';
    accounts.forEach((account) => host.appendChild(cardFor(account, state.data)));
    if (empty) empty.hidden = accounts.length > 0;

    renderProxyChip();
  }

  function renderProxyChip() {
    const chip = document.getElementById('proxyChip');
    const dot = document.getElementById('proxyDot');
    const text = document.getElementById('proxyText');
    if (!chip || !state.data) return;
    const proxy = state.data.proxy || {};
    if (proxy.source && proxy.source !== 'none' && proxy.address) {
      chip.className = 'proxy-chip on';
      text.textContent = 'فیلترشکن فعال: ';
      text.appendChild(el('b', { text: proxy.address }));
    } else {
      chip.className = 'proxy-chip off';
      text.textContent = 'فیلترشکن پیدا نشد';
    }
    if (dot) dot.className = 'dot';
  }

  /* ---------- کارها ---------- */
  async function chooseMode(id, mode) {
    if (!api || !state.data) return;
    const account = state.data.config.accounts.find((a) => a.id === id);
    if (!account || account.mode === mode) return;
    try {
      state.data = await api.setMode(id, mode);
      render();
      const label = (MODES.find((m) => m.id === mode) || {}).label || mode;
      const running = state.data.running && state.data.running[id];
      setStatus(
        `«${account.name}» روی حالت ${label} گذاشته شد.${running ? ' برای اعمال، کروم این اکانت را ببندید و دوباره باز کنید.' : ''}`,
        'ok',
      );
    } catch (err) {
      setStatus(message(err && err.message), 'error');
    }
  }

  async function launch(account) {
    if (!api) return;
    state.busy.add(account.id);
    render();
    try {
      const result = await api.launch(account.id);
      if (result && result.ok) {
        const note = result.warning === 'no-proxy-follow-system'
          ? ' (پروکسی پیدا نشد؛ از اتصال فعال سیستم استفاده شد)'
          : '';
        setStatus(`کروم «${account.name}» باز شد.${note}`, 'ok');
      } else if (result && result.error === 'already-running') {
        const reopen = await askRelaunch(account);
        if (reopen) {
          const forced = await api.launch(account.id, { force: true });
          if (forced && forced.ok) setStatus(`کروم «${account.name}» با اتصال جدید باز شد.`, 'ok');
          else setStatus(message(forced && forced.error), 'error');
        }
      } else {
        setStatus(message(result && result.error), 'error');
      }
    } catch (err) {
      setStatus(message(err && err.message), 'error');
    } finally {
      state.busy.delete(account.id);
      await refresh();
    }
  }

  async function closeAccount(account) {
    if (!api) return;
    try {
      const result = await api.close(account.id);
      if (result && result.ok) setStatus(`کروم «${account.name}» بسته شد.`, 'ok');
      else setStatus(message(result && result.error), 'error');
    } finally {
      await refresh();
    }
  }

  function askRename(account) {
    openModal({
      title: 'تغییر نام اکانت',
      okLabel: 'ذخیره',
      build: () => {
        const input = el('input', { type: 'text', value: account.name, maxlength: '40' });
        return {
          node: el('div', { class: 'field' }, [
            el('label', { text: 'نام اکانت' }),
            input,
            el('p', { class: 'note', text: 'تغییر نام، لاگین‌های این اکانت را پاک نمی‌کند.' }),
          ]),
          read: () => input.value,
        };
      },
      onOk: async (value) => {
        const name = String(value || '').trim();
        if (!name) return false;
        state.data = await api.rename(account.id, name);
        render();
        setStatus('نام اکانت تغییر کرد.', 'ok');
        return true;
      },
    });
  }

  function askAdd() {
    openModal({
      title: 'افزودن اکانت جدید',
      okLabel: 'افزودن',
      build: () => {
        const input = el('input', { type: 'text', placeholder: 'مثلاً: اکانت کاری', maxlength: '40' });
        return {
          node: el('div', { class: 'field' }, [el('label', { text: 'نام اکانت' }), input]),
          read: () => input.value,
        };
      },
      onOk: async (value) => {
        const name = String(value || '').trim() || 'اکانت جدید';
        state.data = await api.addAccount(name, 'direct');
        render();
        setStatus(`اکانت «${name}» اضافه شد. حالت اتصالش را انتخاب کنید.`, 'ok');
        return true;
      },
    });
  }

  function askRemove(account) {
    openModal({
      title: 'حذف اکانت',
      okLabel: 'حذف',
      danger: true,
      build: () => ({
        node: el('p', {
          text: `اکانت «${account.name}» از برنامه حذف می‌شود. پوشه‌ی پروفایل و لاگین‌های آن پاک نمی‌شوند.`,
        }),
        read: () => true,
      }),
      onOk: async () => {
        state.data = await api.removeAccount(account.id);
        render();
        setStatus(`اکانت «${account.name}» حذف شد.`, 'ok');
        return true;
      },
    });
  }

  function askRelaunch(account) {
    return new Promise((resolve) => {
      openModal({
        title: 'کروم این اکانت باز است',
        okLabel: 'بستن و باز کردن دوباره',
        build: () => ({
          node: el('p', {
            text: 'برای این‌که اتصال جدید اعمال شود، کرومِ این اکانت بسته و دوباره باز می‌شود. تب‌های باز از بین می‌روند.',
          }),
          read: () => true,
        }),
        onOk: () => {
          resolve(true);
          return true;
        },
        onCancel: () => resolve(false),
      });
    });
  }

  function askSettings() {
    if (!state.data) return;
    const data = state.data;
    openModal({
      title: 'تنظیمات',
      okLabel: 'ذخیره',
      wide: true,
      build: () => {
        const browserInput = el('input', {
          type: 'text',
          value: data.config.chromePath || '',
          placeholder: data.browser ? data.browser.path : 'خودکار',
          dir: 'ltr',
        });
        const proxyInput = el('input', {
          type: 'text',
          value: data.config.proxy === 'auto' ? '' : data.config.proxy,
          placeholder: data.proxy && data.proxy.address ? `خودکار (${data.proxy.address})` : '127.0.0.1:10808',
          dir: 'ltr',
        });
        const portsInput = el('input', {
          type: 'text',
          value: (data.config.proxyPorts || []).join(', '),
          placeholder: 'مثلاً: 10808, 7890',
          dir: 'ltr',
        });

        const browseBtn = el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: 'انتخاب فایل',
          onclick: async () => {
            if (!api || !api.chooseBrowser) return;
            const next = await api.chooseBrowser();
            if (next) {
              state.data = next;
              browserInput.value = next.config.chromePath || '';
            }
          },
        });

        return {
          node: el('div', {}, [
            el('div', { class: 'field' }, [
              el('label', { text: 'مرورگر (chrome.exe)' }),
              el('div', { class: 'row' }, [browserInput, browseBtn]),
              el('p', {
                class: 'note',
                text: data.browser
                  ? `پیدا شد: ${data.browser.name}`
                  : 'کروم پیدا نشد؛ مسیر آن را دستی انتخاب کنید.',
              }),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: 'آدرس پروکسی فیلترشکن' }),
              proxyInput,
              el('p', {
                class: 'note',
                text: 'خالی بگذارید تا خودش پیدایش کند. مثال: 127.0.0.1:10808',
              }),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: 'پورت‌های اضافی برای جست‌وجو (اختیاری)' }),
              portsInput,
              el('p', {
                class: 'note',
                text: 'اگر فیلترشکن شما پورت خاص خودش را دارد، اینجا اضافه کنید تا پیدایش کند.',
              }),
            ]),
            el('div', { class: 'field' }, [
              el('label', { text: 'پوشه‌ی پروفایل‌ها' }),
              el('input', { type: 'text', value: data.profilesRoot, dir: 'ltr', readonly: 'readonly' }),
              el('div', { class: 'row', style: 'margin-top:8px' }, [
                el('button', {
                  class: 'btn btn-ghost',
                  type: 'button',
                  onclick: () => api && api.openProfilesFolder && api.openProfilesFolder(),
                }, [icon(ICONS.folder), document.createTextNode(' باز کردن پوشه')]),
              ]),
            ]),
          ]),
          read: () => ({
            chromePath: browserInput.value,
            proxy: proxyInput.value.trim() || 'auto',
            proxyPorts: String(portsInput.value)
              .split(/[\s,،]+/)
              .map(Number)
              .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535),
          }),
        };
      },
      onOk: async (value) => {
        state.data = await api.updateSettings(value);
        await api.refreshProxy();
        await refresh();
        setStatus('تنظیمات ذخیره شد.', 'ok');
        return true;
      },
    });
  }

  /* ---------- مودال ---------- */
  let modalController = null;

  function openModal(options) {
    const backdrop = document.getElementById('modalBackdrop');
    const modalNode = document.querySelector('.modal');
    const titleNode = document.getElementById('modalTitle');
    const bodyNode = document.getElementById('modalBody');
    const okBtn = document.getElementById('modalOk');
    const cancelBtn = document.getElementById('modalCancel');
    if (!backdrop) return;

    const built = options.build();
    if (modalNode) modalNode.className = `modal${options.wide ? ' wide' : ''}`;
    titleNode.textContent = options.title;
    bodyNode.textContent = '';
    bodyNode.appendChild(built.node);
    okBtn.textContent = options.okLabel || 'تأیید';
    okBtn.className = `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`;
    cancelBtn.textContent = options.cancelLabel || 'انصراف';
    backdrop.hidden = false;
    state.modalOpen = true;

    const close = () => {
      backdrop.hidden = true;
      state.modalOpen = false;
      modalController = null;
      document.removeEventListener('keydown', onKey);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (options.onCancel) options.onCancel();
        close();
      }
    };

    cancelBtn.onclick = () => {
      if (options.onCancel) options.onCancel();
      close();
    };
    backdrop.onclick = (event) => {
      if (event.target === backdrop) {
        if (options.onCancel) options.onCancel();
        close();
      }
    };
    okBtn.onclick = async () => {
      okBtn.disabled = true;
      try {
        const result = await options.onOk(built.read());
        if (result !== false) close();
      } catch (err) {
        setStatus(message(err && err.message), 'error');
        close();
      } finally {
        okBtn.disabled = false;
      }
    };

    document.addEventListener('keydown', onKey);
    modalController = { close };

    const focusable = bodyNode.querySelector('input');
    if (focusable) {
      focusable.focus();
      focusable.select && focusable.select();
    } else {
      okBtn.focus();
    }
  }

  function closeModal() {
    if (modalController) modalController.close();
  }

  /* ---------- راه‌اندازی ---------- */
  function bindGlobal() {
    document.querySelectorAll('[data-action="add"]').forEach((node) => {
      node.addEventListener('click', askAdd);
    });
    document.querySelectorAll('[data-action="settings"]').forEach((node) => {
      node.addEventListener('click', askSettings);
    });
    const refreshBtn = document.getElementById('refreshProxy');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        setStatus('در حال جست‌وجوی فیلترشکن…');
        if (api && api.refreshProxy) state.data = await api.refreshProxy();
        else await refresh();
        render();
        const proxy = state.data && state.data.proxy;
        setStatus(
          proxy && proxy.source !== 'none' ? `فیلترشکن روی ${proxy.address} پیدا شد.` : 'فیلترشکنی پیدا نشد.',
          proxy && proxy.source !== 'none' ? 'ok' : 'error',
        );
      });
    }
  }

  let timer = null;
  let bootPromise = null;

  function init() {
    if (!bootPromise) bootPromise = boot();
    return bootPromise;
  }

  async function boot() {
    bindGlobal();
    await refresh();
    if (api && api.onState) {
      api.onState((next) => {
        state.data = next;
        if (!state.modalOpen) render();
      });
    }
    // به‌روزرسانی نشانِ «کروم باز است»
    timer = setInterval(() => {
      if (!state.modalOpen) refresh();
    }, 5000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    bootPromise = null;
  }

  window.NS = {
    state,
    init,
    stop,
    refresh,
    render,
    chooseMode,
    launch,
    closeAccount,
    askAdd,
    askSettings,
    askRename,
    askRemove,
    openModal,
    closeModal,
    setStatus,
    hintText,
    MODES,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
