'use strict';
const core = require('../shared/core');
const { parseBody, send } = require('../shared/http');
module.exports = async function (context, req) {
  const body = parseBody(req);
  if (body === null) return send(context, { status: 400, body: { error: 'invalid' } });
  send(context, await core.progress({ body }));
};
