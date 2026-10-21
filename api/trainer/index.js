'use strict';
const core = require('../shared/core');
const { parseBody, send } = require('../shared/http');
module.exports = async function (context, req) {
  const body = req.method === 'POST' ? parseBody(req) : {};
  if (body === null) return send(context, { status: 400, body: { error: 'invalid' } });
  const key = (req.headers && (req.headers['x-trainer-key'] || req.headers['X-Trainer-Key'])) || '';
  send(context, await core.trainer({
    action: (req.params && req.params.action) || '',
    method: req.method, query: req.query || {}, body, key
  }));
};
