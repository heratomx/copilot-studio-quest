'use strict';
/* Local test server: serves the static site AND runs the /api functions the same way
   Azure Static Web Apps calls them (classic Node model). Storage = in-memory simulator.
   Usage:  node tools/dev-server.js            → http://localhost:4280
           PORT=8080 TRAINER_KEY=my-secret-key node tools/dev-server.js           */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { startTableSim } = require('./table-sim');

const ROOT = path.resolve(__dirname, '..');
const API = path.join(ROOT, 'api');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain; charset=utf-8' };

function loadFunctions() {
  const fns = [];
  for (const dir of fs.readdirSync(API)) {
    const fj = path.join(API, dir, 'function.json');
    if (!fs.existsSync(fj)) continue;
    const def = JSON.parse(fs.readFileSync(fj, 'utf8'));
    const trig = def.bindings.find((b) => b.type === 'httpTrigger');
    const names = [];
    const re = new RegExp('^' + trig.route.replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    fns.push({ re, names, methods: trig.methods.map((m) => m.toUpperCase()), handler: require(path.join(API, dir, 'index.js')) });
  }
  return fns;
}

async function start({ port = Number(process.env.PORT) || 4280, quiet = false } = {}) {
  const sim = await startTableSim();
  if (!process.env.RESULTS_STORAGE) process.env.RESULTS_STORAGE = sim.connectionString;
  if (!process.env.TRAINER_KEY) process.env.TRAINER_KEY = 'trainer-demo-key';
  const fns = loadFunctions();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const route = url.pathname.slice(5);
        const fn = fns.find((f) => f.re.test(route));
        if (!fn || !fn.methods.includes(req.method)) { res.writeHead(404); return res.end(); }
        const params = {}; const mm = route.match(fn.re); fn.names.forEach((n, i) => (params[n] = decodeURIComponent(mm[i + 1])));
        let body = raw;
        if (raw && /json/.test(req.headers['content-type'] || '')) { try { body = JSON.parse(raw); } catch { body = raw; } }
        const context = { res: null, log: Object.assign(() => {}, { error() {}, warn() {}, info() {} }) };
        const r = { method: req.method, url: req.url, headers: req.headers, query: Object.fromEntries(url.searchParams), params, body, rawBody: raw };
        try { await fn.handler(context, r); } catch (e) { context.res = { status: 500, body: JSON.stringify({ error: 'crash', detail: String(e) }) }; }
        const out = context.res || { status: 204 };
        res.writeHead(out.status || 200, out.headers || {}); res.end(out.body == null ? '' : out.body);
      });
      return;
    }
    let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || file.includes(`${path.sep}api${path.sep}`) || file.includes(`${path.sep}tools${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, r));
  if (!quiet) console.log(`Quest:      http://localhost:${port}\nDashboard:  http://localhost:${port}/dashboard.html   (trainer key: ${process.env.TRAINER_KEY})\nStorage:    in-memory simulator (data is lost when you stop this server)`);
  return { server, sim, port };
}
if (require.main === module) start();
module.exports = { start };
