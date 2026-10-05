'use strict';

/**
 * تشخیص پروکسی فیلترشکن روی سیستم.
 * دو راه: ۱) خواندن پروکسی سیستم از رجیستری ویندوز  ۲) گشتن پورت‌های رایج روی 127.0.0.1
 */

const net = require('net');
const { execFile } = require('child_process');

/** پورت‌های رایج فیلترشکن‌ها (v2rayN / Clash / Psiphon / Outline / Nekoray و ...) */
const COMMON_PORTS = [10808, 10809, 1080, 7890, 7891, 1087, 2080, 8888, 8080, 8118, 20171, 40000];

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/** تجزیه‌ی مقدار ProxyServer رجیستری */
function parseProxyServer(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // حالت «http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891»
  if (raw.includes('=') || raw.includes(';')) {
    const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
    const map = {};
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      map[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
    const preferred = ['https', 'http', 'socks'];
    for (const key of preferred) {
      const parsed = parseHostPort(map[key], key === 'socks' ? 'socks5' : 'http');
      if (parsed) return parsed;
    }
    return null;
  }

  return parseHostPort(raw, 'http');
}

function parseHostPort(value, scheme = 'http') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // IPv6 ساده مثل [::1]:1080
  const m = raw.match(/^\[?([0-9a-fA-F:.]+|[a-z0-9.-]+)\]?:(\d{1,5})$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = m[1].includes(':') ? `[${m[1].replace(/^\[|\]$/g, '')}]` : m[1];
  return { host, port, scheme };
}

/** تجزیه‌ی خروجی reg query */
function parseRegInternetSettings(stdout) {
  const text = String(stdout || '');
  let enabled = false;
  let server = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\w+)\s+REG_(SZ|DWORD)\s+(.*)$/);
    if (!m) continue;
    const [, key, type, value] = m;
    if (key.toLowerCase() === 'proxyenable') enabled = parseInt(value, 16) !== 0 || value.trim() === '1';
    if (key.toLowerCase() === 'proxyserver' && type === 'SZ') server = value.trim();
  }
  const parsed = parseProxyServer(server);
  return { enabled, server, ...(parsed || { host: null, port: null, scheme: null }) };
}

function probePort(host, port, timeout = 400, netModule = net) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch (_) {
        /* noop */
      }
      resolve(ok);
    };
    const socket = netModule.connect({ host, port });
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** گشتن پورت‌های رایج به ترتیب اولویت */
async function scanLocalProxies(options = {}) {
  const host = options.host || '127.0.0.1';
  const ports = options.ports || COMMON_PORTS;
  const timeout = options.timeout || 400;
  const probe = options.probe || ((h, p, t) => probePort(h, p, t));

  const results = await Promise.all(ports.map((port) => probe(host, port, timeout)));
  const index = results.findIndex(Boolean);
  if (index < 0) return null;
  return { host, port: ports[index], scheme: 'http' };
}

function runRegQuery(runner) {
  return new Promise((resolve) => {
    try {
      runner('reg', ['query', REG_KEY], (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * تشخیص پروکسی فعال. خروجی: {source, host, port, scheme, address} یا source:'none'
 * @param {object} options  {platform, runner, probe, ports, timeout, host}
 */
async function detectProxy(options = {}) {
  const platform = options.platform || process.platform;
  const runner = options.runner || execFile;
  const host = options.host || '127.0.0.1';
  const probe = options.probe || ((h, p, t) => probePort(h, p, t));

  // ۱) پروکسی سیستم در ویندوز
  if (platform === 'win32') {
    const out = await runRegQuery(runner);
    if (out) {
      const info = parseRegInternetSettings(out);
      if (info.enabled && info.host && info.port) {
        const alive = await probe(info.host, info.port, options.timeout || 400);
        if (alive) {
          return {
            source: 'registry',
            host: info.host,
            port: info.port,
            scheme: info.scheme || 'http',
            address: `${info.host}:${info.port}`,
          };
        }
      }
    }
  }

  // ۲) گشتن پورت‌های رایج
  const scanned = await scanLocalProxies({ host, ports: options.ports, timeout: options.timeout, probe });
  if (scanned) {
    return { source: 'scan', ...scanned, address: `${scanned.host}:${scanned.port}` };
  }

  return { source: 'none', host: null, port: null, scheme: null, address: '' };
}

module.exports = {
  COMMON_PORTS,
  REG_KEY,
  parseProxyServer,
  parseHostPort,
  parseRegInternetSettings,
  probePort,
  scanLocalProxies,
  detectProxy,
};
