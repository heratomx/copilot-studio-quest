'use strict';
const core = require('../shared/core');
const { send } = require('../shared/http');
module.exports = async function (context, req) {
  send(context, await core.status({ query: req.query || {} }));
};
