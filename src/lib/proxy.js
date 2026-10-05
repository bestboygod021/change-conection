'use strict';

/**
 * تشخیص پروکسی فیلترشکن روی سیستم — سازگار با انواع نرم‌افزارها.
 *
 * سه لایه، به ترتیب:
 *  ۱) پروکسی سیستم در رجیستری ویندوز (هر نرم‌افزاری که «تنظیم پروکسی سیستم» را بزند:
 *     v2rayN، Clash، Shadowsocks، Psiphon، Nekoray و …)
 *  ۲) گشتن پورت‌های رایج + «دست‌دادن» SOCKS5 برای تأیید اینکه پورت واقعاً پروکسی است
 *     و تشخیص نوعش (socks5 یا http) — بدون وابستگی به نام نرم‌افزار.
 *  ۳) اگر هیچ پروکسی پیدا نشد، حالت «با فیلترشکن» از اتصال فعال سیستم (TUN/آداپتور)
 *     پیروی می‌کند؛ این برای فیلترشکن‌های بدون‌پروکسی (Warp، OpenVPN، TUN) درست است.
 */

const net = require('net');
const os = require('os');
const { execFile } = require('child_process');

/** پورت‌های رایج انواع فیلترشکن‌ها و تغییر آی‌پی */
const COMMON_PORTS = [
  // v2ray / v2rayN / V2Box / Nekoray / Sing-box
  10808, 10809, 1080, 1081, 2080, 2081, 10801, 10802, 20170, 20171,
  // Clash / Clash Verge / Clash for Windows / Mihomo
  7890, 7891, 7892, 7893, 9090,
  // Shadowsocks / ShadowsocksR / Outline
  1080, 8388, 8389, 1087,
  // Hiddify / Sing-box mixed
  12334, 2053, 443,
  // عمومی / Privoxy / Polipo / Tor / Lantern / HTTP proxies
  8118, 8123, 8080, 8081, 8888, 8889, 9050, 9150, 40000, 40001,
];

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
  let autoConfig = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\w+)\s+REG_(SZ|DWORD)\s+(.*)$/);
    if (!m) continue;
    const [, key, type, value] = m;
    if (key.toLowerCase() === 'proxyenable') enabled = parseInt(value, 16) !== 0 || value.trim() === '1';
    if (key.toLowerCase() === 'proxyserver' && type === 'SZ') server = value.trim();
    if (key.toLowerCase() === 'autoconfigurl' && type === 'SZ') autoConfig = value.trim();
  }
  const parsed = parseProxyServer(server);
  return { enabled, server, autoConfig, ...(parsed || { host: null, port: null, scheme: null }) };
}

/** استخراج host/port از آدرس PAC برای بررسی زنده‌بودن */
function parsePacUrl(url) {
  const m = String(url || '').match(/^https?:\/\/([^:/]+):(\d{1,5})/i);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1], port };
}

/** نام الگوهای آداپتورهای مجازیِ فیلترشکن/تغییر آی‌پی (TUN/TAP/VPN) */
const TUN_ADAPTER_PATTERN = /wintun|wireguard|tap[- ]?windows|tap adapter|tun\b|tunnel|warp|vpn|openvpn|proxyfier|proxifier|tunnelbear|ipvanish|expressvpn|nordvpn|surfshark|hide\.?me|private internet|northlayer/i;

/** تشخیص آداپتور مجازی از روی فهرست رابط‌های شبکه (بدون وابستگی به نام نرم‌افزار) */
function detectTunAdapter(interfaces) {
  if (!interfaces || typeof interfaces !== 'object') return null;
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!Array.isArray(addrs) || addrs.length === 0) continue;
    const usable = addrs.some((a) => a && !a.internal);
    if (usable && TUN_ADAPTER_PATTERN.test(name)) return name;
  }
  return null;
}

function probePort(host, port, timeout = 400, netModule = net) {
  return new Promise((resolve) => {
    let done = false;
    let socket;
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
    socket = netModule.connect({ host, port });
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * دست‌دادن SOCKS5: اگر سرویس واقعاً پروکسی SOCKS5 باشد، به سلامِ ما
 * [0x05,0x01,0x00] با [0x05,0x00] پاسخ می‌دهد. این تأیید می‌کند پورت باز،
 * یک پروکسی است — مستقل از نام نرم‌افزار.
 */
function socks5Handshake(host, port, timeout = 500, netModule = net) {
  return new Promise((resolve) => {
    let done = false;
    let socket;
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
    socket = netModule.connect({ host, port });
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    socket.once('data', (data) => {
      finish(!!data && data.length >= 2 && data[0] === 0x05 && data[1] === 0x00);
    });
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * بررسی یک پورت: باز است؟ و اگر بله، نوع پروکسی چیست؟
 * @returns {Promise<{open:boolean, scheme:string}>}
 */
async function connectIdentify(host, port, timeout = 500, netModule = net) {
  const open = await probePort(host, port, timeout, netModule);
  if (!open) return { open: false, scheme: 'http' };
  const isSocks = await socks5Handshake(host, port, timeout, netModule);
  return { open: true, scheme: isSocks ? 'socks5' : 'http' };
}

/** گشتن پورت‌ها به ترتیب اولویت و تشخیص نوع پروکسی */
async function scanLocalProxies(options = {}) {
  const host = options.host || '127.0.0.1';
  const ports = options.ports && options.ports.length ? options.ports : COMMON_PORTS;
  const timeout = options.timeout || 500;
  const connect = options.connect || ((h, p, t) => connectIdentify(h, p, t));

  const results = await Promise.all(ports.map((port) => connect(host, port, timeout).then((r) => ({ port, ...r }))));
  const hit = results.find((r) => r.open);
  if (!hit) return null;
  return { host, port: hit.port, scheme: hit.scheme };
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
 * source: 'registry' | 'scan' | 'none'
 */
async function detectProxy(options = {}) {
  const platform = options.platform || process.platform;
  const runner = options.runner || execFile;
  const host = options.host || '127.0.0.1';
  const probe = options.probe || ((h, p, t) => probePort(h, p, t));
  const connect = options.connect || ((h, p, t) => connectIdentify(h, p, t));

  // ۱+۲) پروکسی سیستم یا PAC در رجیستری ویندوز (هر نرم‌افزاری که ست کند)
  if (platform === 'win32') {
    const out = await runRegQuery(runner);
    if (out) {
      const info = parseRegInternetSettings(out);

      // پروکسی مستقیم سیستم
      if (info.enabled && info.host && info.port) {
        const alive = await probe(info.host, info.port, options.timeout || 500);
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

      // حالت PAC (رایج در Shadowsocks و بسیاری از ابزارهای تغییر آی‌پی)
      // فقط آدرس‌های http/https معتبرند (رجیستری گاهی مسیر محلی می‌گذارد که به‌درد کروم نمی‌خورد)
      if (info.autoConfig && /^https?:\/\//i.test(info.autoConfig)) {
        const pac = parsePacUrl(info.autoConfig);
        const alive = pac ? await probe(pac.host, pac.port, options.timeout || 500) : true;
        if (alive) {
          return {
            source: 'pac',
            pacUrl: info.autoConfig,
            host: pac ? pac.host : null,
            port: pac ? pac.port : null,
            scheme: null,
            address: info.autoConfig,
          };
        }
      }
    }
  }

  // ۳) گشتن پورت‌های رایج + تأیید پروتکل
  const extra = Array.isArray(options.extraPorts) ? options.extraPorts : [];
  const scanned = await scanLocalProxies({
    host,
    ports: [...(options.ports || COMMON_PORTS), ...extra],
    timeout: options.timeout,
    connect,
  });
  if (scanned) {
    return { source: 'scan', ...scanned, address: `${scanned.host}:${scanned.port}` };
  }

  // ۴) آداپتور مجازی (TUN/TAP) — فیلترشکن‌های بدون پروکسی مثل Warp/WireGuard
  const interfaces = options.interfaces || os.networkInterfaces();
  const adapter = detectTunAdapter(interfaces);
  if (adapter) {
    return { source: 'tun', adapter, host: null, port: null, scheme: null, address: adapter };
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
  socks5Handshake,
  connectIdentify,
  scanLocalProxies,
  detectProxy,
  parsePacUrl,
  detectTunAdapter,
  TUN_ADAPTER_PATTERN,
};
