'use strict';
// Adapts Azure Functions (classic Node model) requests to the plain handlers in core.js.
const MAX_BODY = 20000;
function parseBody(req) {
  const raw = req.rawBody != null ? req.rawBody : req.body;
  // Size check first – Azure may already have parsed the JSON into req.body.
  const size = raw == null ? 0 : (typeof raw === 'string' || Buffer.isBuffer(raw)) ? raw.length : JSON.stringify(raw).length;
  if (size > MAX_BODY) return null;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (!raw) return {};
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch { return null; }
}
function send(context, r) {
  context.res = {
    status: r.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    body: JSON.stringify(r.body)
  };
}
module.exports = { parseBody, send };
