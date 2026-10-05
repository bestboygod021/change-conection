'use strict';

/**
 * سرور نسخه‌ی نمایشی: همان فایل‌های واقعی رابط کاربری را در مرورگر نشان می‌دهد
 * و فقط به‌جای Electron، پل شبیه‌سازی‌شده (demo/bridge.js) را تزریق می‌کند.
 *   npm run demo   →   http://localhost:4173
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const ALLOWED = ['/src/renderer/', '/demo/', '/assets/'];

function demoHtml() {
  const source = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  const banner = `  <div class="demo-banner">
    <span>نسخه‌ی نمایشی در مرورگر — در برنامه‌ی ویندوز، کروم واقعاً با اتصال انتخابی باز می‌شود.</span>
    <button id="demoReset" type="button">بازنشانی دمو</button>
  </div>
`;
  return source
    .replace('href="styles.css"', 'href="/src/renderer/styles.css"')
    .replace('<link rel="stylesheet" href="/src/renderer/styles.css" />', '<link rel="stylesheet" href="/src/renderer/styles.css" />\n  <link rel="stylesheet" href="/demo/demo.css" />')
    .replace('<body>', `<body>\n${banner}`)
    .replace('<script src="app.js"></script>', '<script src="/demo/bridge.js"></script>\n  <script src="/src/renderer/app.js"></script>');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const body = demoHtml();
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      res.end(body);
      return;
    }

    if (!ALLOWED.some((prefix) => pathname.startsWith(prefix))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(err && err.message));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NetSplit demo → http://localhost:${PORT}`);
});
