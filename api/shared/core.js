'use strict';
/* Live results logic. Kept free of Azure Functions specifics so it can be tested locally.
   App settings (Static Web App > Settings > Environment variables):
     RESULTS_STORAGE_AUTH - "entra" or "shared-key" (legacy default)
     RESULTS_STORAGE_ACCOUNT + AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET - Entra configuration
     RESULTS_STORAGE  - legacy storage account connection string
     TRAINER_KEY      – password for the trainer dashboard (min. 10 characters)
     LIVE_RESULTS     – optional; set to "off" to stop ALL storage access immediately   */
const crypto = require('crypto');
const { TableClient, parseConnectionString } = require('./tables');

const T = { settings: 'csqSettings', sessions: 'csqSessions', results: 'csqResults' };
const CACHE_MS = 20000;          // settings/session cache per function instance
const THROTTLE_MS = 1500;        // min gap between writes from one player
const MAX_HOURS = 48;

let client = null, clientConfig = null, tablesReady = false;
const cache = new Map();          // key -> { at, value }
const lastWrite = new Map();      // pid -> timestamp

function env(name) { return (process.env[name] || '').trim(); }
function hardOff() { return env('LIVE_RESULTS').toLowerCase() === 'off'; }
function storageConfiguration() {
  const auth = env('RESULTS_STORAGE_AUTH').toLowerCase() || 'shared-key';
  return auth === 'entra'
    ? { auth, account: env('RESULTS_STORAGE_ACCOUNT'), tenantId: env('AZURE_TENANT_ID'), clientId: env('AZURE_CLIENT_ID'), clientSecret: env('AZURE_CLIENT_SECRET') }
    : { auth, connectionString: env('RESULTS_STORAGE') };
}
function storageConfigured(config) {
  return config.auth === 'entra'
    ? [config.account, config.tenantId, config.clientId, config.clientSecret].every(Boolean)
    : config.auth === 'shared-key' && !!config.connectionString;
}
function getClient(fetchImpl) {
  const config = storageConfiguration();
  if (!['entra', 'shared-key'].includes(config.auth)) throw new Error('RESULTS_STORAGE_AUTH must be "entra" or "shared-key"');
  if (config.auth === 'shared-key' && !config.connectionString) return null;
  const signature = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (!client || signature !== clientConfig) {
    let conn;
    if (config.auth === 'entra') {
      if (!storageConfigured(config)) throw new Error('Entra storage requires RESULTS_STORAGE_ACCOUNT, AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET');
      if (!/^[a-z0-9]{3,24}$/.test(config.account)) throw new Error('RESULTS_STORAGE_ACCOUNT must be a 3-24 character Azure storage account name');
      const { ClientSecretCredential } = require('@azure/identity');
      conn = {
        endpoint: `https://${config.account}.table.core.windows.net`,
        credential: new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret)
      };
    } else {
      conn = parseConnectionString(config.connectionString);
      if (!conn) return null;
    }
    client = new TableClient(conn, fetchImpl); clientConfig = signature; tablesReady = false;
    cache.clear(); lastWrite.clear();
  }
  return client;
}
async function ensureTables(c) {
  if (tablesReady) return;
  await Promise.all(Object.values(T).map((t) => c.createTable(t)));
  tablesReady = true;
}
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
function resetCaches() { cache.clear(); lastWrite.clear(); tablesReady = false; client = null; clientConfig = null; }

const ok = (body, status = 200) => ({ status, body });
const fail = (status, error, extra) => ({ status, body: { error, ...(extra || {}) } });

// ---------- helpers ----------
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const PID_RE = /^[a-z0-9]{8,32}$/;
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

function sanitizeSnapshot(d) {
  d = d && typeof d === 'object' ? d : {};
  const topics = {};
  if (d.topics && typeof d.topics === 'object') {
    for (const [k, v] of Object.entries(d.topics).slice(0, 20)) {
      if (!/^[a-z0-9-]{1,24}$/.test(k) || !v) continue;
      const m = num(v.m, 0, 100), s = num(v.s, 0, m);
      if (m > 0) topics[k] = { s: Math.round(s * 100) / 100, m };
    }
  }
  const missed = Array.isArray(d.missed) ? d.missed.filter((x) => /^[a-z0-9-]{1,24}:\d{1,3}$/.test(String(x))).slice(0, 80) : [];
  const out = {
    xp: Math.round(num(d.xp, 0, 100000)),
    rank: Math.round(num(d.rank, 0, 10)),
    done: Math.round(num(d.done, 0, 50)),
    level: clean(d.level, 24),
    topics, missed
  };
  if (d.idea && typeof d.idea === 'object') {
    out.idea = {};
    for (const k of ['name', 'audience', 'problem', 'source', 'action']) out.idea[k] = clean(d.idea[k], 120);
  }
  if (d.feedback && typeof d.feedback === 'object') out.feedback = { stars: Math.round(num(d.feedback.stars, 0, 5)), text: clean(d.feedback.text, 500) };
  return out;
}

function newCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  let s = ''; const bytes = crypto.randomBytes(5);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
function trainerOk(key) {
  const expected = env('TRAINER_KEY');
  if (expected.length < 10 || !key) return false;
  const a = crypto.createHash('sha256').update(String(key)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function getSettings(c) {
  return cached('settings', async () => {
    const e = await c.get(T.settings, 'cfg', 'global');
    return { enabled: e ? e.enabled !== false : true };
  });
}
async function getSession(c, code) {
  return cached('s:' + code, () => c.get(T.sessions, 'session', code));
}
function sessionView(s) {
  if (!s) return null;
  const expired = Date.parse(s.expiresAt) < Date.now();
  return { code: s.RowKey, title: s.title || '', open: !!s.open && !expired, closed: !s.open, expired, createdAt: s.createdAt, expiresAt: s.expiresAt };
}
async function purgeSession(c, code) {
  const rows = await c.query(T.results, code, 5000);
  for (let i = 0; i < rows.length; i += 20) await Promise.all(rows.slice(i, i + 20).map((r) => c.remove(T.results, r.PartitionKey, r.RowKey)));
  await c.remove(T.sessions, 'session', code);
  cache.delete('s:' + code);
  return rows.length;
}

// ---------- participant endpoints ----------
async function status({ query }, fetchImpl) {
  if (hardOff()) return ok({ enabled: false, reason: 'off' });
  try {
    const c = getClient(fetchImpl);
    if (!c) return ok({ enabled: false, reason: 'not-configured' });
    await ensureTables(c);
    const st = await getSettings(c);
    if (!st.enabled) return ok({ enabled: false, reason: 'paused' });
    const code = String((query && query.code) || '').toUpperCase();
    if (!code) return ok({ enabled: true });
    if (!CODE_RE.test(code)) return ok({ enabled: true, session: null });
    const s = sessionView(await getSession(c, code));
    return ok({ enabled: true, session: s ? { open: s.open, title: s.title } : null });
  } catch (e) { return fail(503, 'storage-unavailable'); }
}

async function progress({ body }, fetchImpl) {
  if (hardOff()) return fail(403, 'off');
  try {
    const c = getClient(fetchImpl);
    if (!c) return fail(403, 'not-configured');
    body = body && typeof body === 'object' ? body : {};
    const code = String(body.code || '').toUpperCase();
    const pid = String(body.pid || '');
    if (!CODE_RE.test(code) || !PID_RE.test(pid)) return fail(400, 'invalid');
    const now = Date.now();
    if (now - (lastWrite.get(pid) || 0) < THROTTLE_MS) return fail(429, 'slow-down');
    await ensureTables(c);
    const st = await getSettings(c);
    if (!st.enabled) return fail(403, 'paused');
    const s = sessionView(await getSession(c, code));
    if (!s || !s.open) return fail(403, 'session-closed');
    lastWrite.set(pid, now);
    if (lastWrite.size > 5000) lastWrite.clear();
    const data = sanitizeSnapshot(body.data);
    await c.upsert(T.results, {
      PartitionKey: code, RowKey: pid,
      name: clean(body.name, 24) || 'Player', avatar: clean(body.avatar, 16), lang: clean(body.lang, 5),
      data: JSON.stringify(data), updated: new Date(now).toISOString()
    });
    return ok({ ok: true });
  } catch (e) { return fail(503, 'storage-unavailable'); }
}

// ---------- trainer endpoints ----------
async function trainer({ action, method, query, body, key }, fetchImpl) {
  if (!env('TRAINER_KEY') || env('TRAINER_KEY').length < 10) return fail(503, 'trainer-key-not-configured');
  if (!trainerOk(key)) return fail(401, 'unauthorized');
  if (hardOff()) return ok({ enabled: false, hardOff: true, configured: storageConfigured(storageConfiguration()), sessions: [] });
  try {
    const c = getClient(fetchImpl);
    if (!c) return fail(503, 'storage-not-configured');
    body = body && typeof body === 'object' ? body : {};
    await ensureTables(c);
    switch (action) {
      case 'overview': {
        const all = await c.query(T.sessions, 'session', 500);
        // Auto-cleanup: sessions that expired are deleted together with their results.
        let cleaned = 0;
        for (const s of all) if (Date.parse(s.expiresAt) < Date.now()) { await purgeSession(c, s.RowKey); cleaned++; }
        const live = all.filter((s) => Date.parse(s.expiresAt) >= Date.now());
        const sessions = [];
        for (const s of live) {
          const rows = await c.query(T.results, s.RowKey, 5000);
          sessions.push({ ...sessionView(s), players: rows.length });
        }
        sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        cache.delete('settings');
        const st = await getSettings(c);
        return ok({ enabled: st.enabled, hardOff: false, configured: true, cleaned, sessions });
      }
      case 'settings': {
        if (method !== 'POST') return fail(405, 'method');
        const enabled = !!body.enabled;
        await c.upsert(T.settings, { PartitionKey: 'cfg', RowKey: 'global', enabled, updated: new Date().toISOString() });
        cache.delete('settings');
        return ok({ enabled });
      }
      case 'session-open': {
        if (method !== 'POST') return fail(405, 'method');
        const hours = Math.round(num(body.hours || 4, 1, MAX_HOURS));
        let code = newCode();
        for (let i = 0; i < 5 && await c.get(T.sessions, 'session', code); i++) code = newCode();
        const now = new Date();
        const s = { PartitionKey: 'session', RowKey: code, title: clean(body.title, 80) || 'Workshop', open: true, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + hours * 3600e3).toISOString() };
        await c.upsert(T.sessions, s);
        cache.delete('s:' + code);
        return ok({ session: sessionView(s) });
      }
      case 'session-close': {
        if (method !== 'POST') return fail(405, 'method');
        const code = String(body.code || '').toUpperCase();
        if (!CODE_RE.test(code)) return fail(400, 'invalid');
        if (body.purge) { const n = await purgeSession(c, code); return ok({ deleted: n }); }
        const s = await c.get(T.sessions, 'session', code);
        if (!s) return fail(404, 'not-found');
        const closed = { PartitionKey: 'session', RowKey: code, title: s.title || '', open: false, createdAt: s.createdAt, expiresAt: s.expiresAt };
        await c.upsert(T.sessions, closed); cache.delete('s:' + code);
        return ok({ session: sessionView(closed) });
      }
      case 'report': {
        const code = String((query && query.code) || '').toUpperCase();
        if (!CODE_RE.test(code)) return fail(400, 'invalid');
        const s = await c.get(T.sessions, 'session', code);
        if (!s) return fail(404, 'not-found');
        const rows = await c.query(T.results, code, 5000);
        const players = rows.map((r) => {
          let data = {}; try { data = JSON.parse(r.data || '{}'); } catch { data = {}; }
          return { pid: r.RowKey, name: r.name, avatar: r.avatar, lang: r.lang, updated: r.updated, data };
        });
        return ok({ session: sessionView(s), players });
      }
      case 'purge-all': {
        if (method !== 'POST') return fail(405, 'method');
        const all = await c.query(T.sessions, 'session', 500);
        let deleted = 0;
        for (const s of all) deleted += await purgeSession(c, s.RowKey);
        // Results whose session row is already gone
        const orphans = await c.query(T.results, null, 5000);
        for (const r of orphans) { await c.remove(T.results, r.PartitionKey, r.RowKey); deleted++; }
        cache.clear();
        return ok({ sessions: all.length, deleted });
      }
      default: return fail(404, 'unknown-action');
    }
  } catch (e) {
    return fail(503, 'storage-error', { detail: String(e.message || e).slice(0, 200) });
  }
}

module.exports = { status, progress, trainer, sanitizeSnapshot, resetCaches, _T: T };
