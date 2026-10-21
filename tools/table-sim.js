'use strict';
/* In-memory Azure Table Storage simulator for local testing (subset of the REST API).
   Verifies SharedKeyLite signatures like the real service, and pages query results
   (small page size) so continuation handling gets exercised. */
const http = require('http');
const crypto = require('crypto');

function startTableSim({ port = 0, account = 'devacct', key = crypto.randomBytes(32).toString('base64'), pageSize = 3 } = {}) {
  const tables = new Map(); // name -> Map("pk\u0000rk" -> entity)
  const stats = { requests: 0, authFailures: 0, byMethod: {} };
  const err = (res, status, code) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ 'odata.error': { code, message: { lang: 'en-US', value: code } } })); };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      stats.requests++; stats.byMethod[req.method] = (stats.byMethod[req.method] || 0) + 1;
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      // ---- auth (SharedKeyLite) ----
      const date = req.headers['x-ms-date'];
      const auth = req.headers['authorization'] || '';
      const expected = 'SharedKeyLite ' + account + ':' + crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(date + '\n' + '/' + account + path, 'utf8').digest('base64');
      if (!date || auth !== expected || Math.abs(Date.parse(date) - Date.now()) > 15 * 60e3) { stats.authFailures++; return err(res, 403, 'AuthenticationFailed'); }
      if (!req.headers['x-ms-version']) return err(res, 400, 'MissingRequiredHeader');
      let body = null;
      if (raw) { try { body = JSON.parse(raw); } catch { return err(res, 400, 'InvalidInput'); } }

      if (path === '/Tables' && req.method === 'POST') {
        const name = body && body.TableName;
        if (!/^[A-Za-z][A-Za-z0-9]{2,62}$/.test(name || '')) return err(res, 400, 'InvalidResourceName');
        if (tables.has(name)) return err(res, 409, 'TableAlreadyExists');
        tables.set(name, new Map()); res.writeHead(204); return res.end();
      }
      const m = decodeURIComponent(path).match(/^\/([A-Za-z0-9]+)\((?:PartitionKey='([^']*)',RowKey='([^']*)')?\)$/);
      if (!m) return err(res, 400, 'InvalidUri');
      const [, tname, pk, rk] = m;
      const t = tables.get(tname);
      if (!t) return err(res, 404, 'TableNotFound');
      const id = pk + '\u0000' + rk;
      if (pk !== undefined) {
        if (req.method === 'PUT') {
          if (!body || body.PartitionKey !== pk || body.RowKey !== rk) return err(res, 400, 'PropertiesNeedValue');
          t.set(id, { ...body, Timestamp: new Date().toISOString() }); res.writeHead(204); return res.end();
        }
        if (req.method === 'GET') {
          if (!t.has(id)) return err(res, 404, 'ResourceNotFound');
          res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(t.get(id)));
        }
        if (req.method === 'DELETE') {
          if (req.headers['if-match'] !== '*') return err(res, 400, 'MissingRequiredHeader');
          if (!t.has(id)) return err(res, 404, 'ResourceNotFound');
          t.delete(id); res.writeHead(204); return res.end();
        }
        return err(res, 405, 'UnsupportedHttpVerb');
      }
      if (req.method !== 'GET') return err(res, 405, 'UnsupportedHttpVerb');
      const filter = url.searchParams.get('$filter');
      let rows = [...t.values()];
      if (filter) {
        const fm = filter.match(/^PartitionKey eq '([^']*)'$/);
        if (!fm) return err(res, 400, 'InvalidInput');
        rows = rows.filter((r) => r.PartitionKey === fm[1]);
      }
      rows.sort((a, b) => (a.PartitionKey + '\u0000' + a.RowKey).localeCompare(b.PartitionKey + '\u0000' + b.RowKey));
      const npk = url.searchParams.get('NextPartitionKey'), nrk = url.searchParams.get('NextRowKey');
      let start = 0;
      if (npk != null) start = rows.findIndex((r) => r.PartitionKey === npk && r.RowKey === nrk);
      if (start < 0) start = rows.length;
      const page = rows.slice(start, start + pageSize);
      const headers = { 'Content-Type': 'application/json' };
      const nxt = rows[start + pageSize];
      if (nxt) { headers['x-ms-continuation-NextPartitionKey'] = nxt.PartitionKey; headers['x-ms-continuation-NextRowKey'] = nxt.RowKey; }
      res.writeHead(200, headers); res.end(JSON.stringify({ value: page }));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    resolve({ server, port: p, account, key, tables, stats,
      connectionString: `DefaultEndpointsProtocol=http;AccountName=${account};AccountKey=${key};TableEndpoint=http://127.0.0.1:${p}` });
  }));
}
module.exports = { startTableSim };
