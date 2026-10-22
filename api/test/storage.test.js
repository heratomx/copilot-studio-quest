'use strict';
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { ClientSecretCredential } = require('@azure/identity');
const { TableClient, TableError, parseConnectionString } = require('../shared/tables');
const core = require('../shared/core');
const { startTableSim } = require('../../tools/table-sim');

const ENV_NAMES = [
  'RESULTS_STORAGE_AUTH', 'RESULTS_STORAGE_ACCOUNT', 'RESULTS_STORAGE',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'TRAINER_KEY', 'LIVE_RESULTS'
];
const TRAINER_KEY = 'trainer-test-key';
const SCOPE = 'https://storage.azure.com/.default';
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ENV_NAMES) delete process.env[name];
  process.env.TRAINER_KEY = TRAINER_KEY;
  core.resetCaches();
});
afterEach(() => {
  core.resetCaches();
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function entraConfiguration() {
  Object.assign(process.env, {
    RESULTS_STORAGE_AUTH: 'entra',
    RESULTS_STORAGE_ACCOUNT: 'devstore',
    AZURE_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    AZURE_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    AZURE_CLIENT_SECRET: 'test-only-not-a-real-secret'
  });
}
function trainer(action, body, fetchImpl, query) {
  return core.trainer({ action, method: body ? 'POST' : 'GET', body, query, key: TRAINER_KEY }, fetchImpl);
}

test('Table requests use the current Entra token and storage scope', async () => {
  const requests = [];
  let tokenNumber = 0;
  const credential = {
    async getToken(scope) {
      assert.equal(scope, SCOPE);
      return { token: `test-token-${++tokenNumber}`, expiresOnTimestamp: Date.now() + 3600000 };
    }
  };
  const client = new TableClient({ endpoint: 'https://devstore.table.core.windows.net', credential }, async (url, options) => {
    requests.push({ url, ...options });
    return new Response(null, { status: 204 });
  });
  await client.createTable('csqResults');
  await client.upsert('csqResults', { PartitionKey: 'ABC23', RowKey: 'player001', data: '{}' });
  assert.equal(requests[0].headers.Authorization, 'Bearer test-token-1');
  assert.equal(requests[1].headers.Authorization, 'Bearer test-token-2');
  assert.equal(requests[0].headers['x-ms-version'], '2019-02-02');
  assert.equal(requests[0].url, 'https://devstore.table.core.windows.net/Tables');
});

test('Entra token failures never fall back to an account key', async () => {
  const failure = new Error('Test identity authentication failed');
  const conn = parseConnectionString('AccountName=devstore;AccountKey=dGVzdC1vbmx5');
  conn.credential = { getToken: async () => { throw failure; } };
  const client = new TableClient(conn, () => assert.fail('No storage request may be made after a token failure'));
  await assert.rejects(client.createTable('csqResults'), (error) => error === failure);
});

test('An empty Entra token fails explicitly without sending a request', async () => {
  const client = new TableClient({
    endpoint: 'https://devstore.table.core.windows.net',
    credential: { getToken: async () => null }
  }, () => assert.fail('An unauthenticated request must not be sent'));
  await assert.rejects(client.get('csqResults', 'ABC23', 'player001'), (error) =>
    error instanceof TableError && error.status === 503 && error.code === 'StorageTokenUnavailable');
});

test('Entra configuration errors reach trainer notifications, not a legacy fallback', async () => {
  process.env.RESULTS_STORAGE_AUTH = 'entra';
  process.env.RESULTS_STORAGE = 'AccountName=devstore;AccountKey=dGVzdC1vbmx5';
  const noFetch = () => assert.fail('Invalid configuration must not access storage');
  const result = await trainer('overview', null, noFetch);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'storage-error');
  assert.match(result.body.detail, /Entra storage requires RESULTS_STORAGE_ACCOUNT/);
  assert.deepEqual(await core.status({ query: {} }, noFetch), { status: 503, body: { error: 'storage-unavailable' } });
  assert.equal((await core.progress({ body: {} }, noFetch)).status, 503);
});

test('Invalid modes and account names are rejected without disclosing credentials', async () => {
  const noFetch = () => assert.fail('Invalid configuration must not access storage');
  process.env.RESULTS_STORAGE_AUTH = 'unrecognized';
  assert.match((await trainer('overview', null, noFetch)).body.detail, /RESULTS_STORAGE_AUTH must be/);
  entraConfiguration();
  process.env.RESULTS_STORAGE_ACCOUNT = 'https://not-storage.example';
  const result = await trainer('overview', null, noFetch);
  assert.equal(result.status, 503);
  assert.match(result.body.detail, /3-24 character Azure storage account name/);
  assert.ok(!result.body.detail.includes(process.env.AZURE_CLIENT_SECRET));
});

test('Missing legacy storage remains unconfigured and hard off makes no requests', async () => {
  const noFetch = () => assert.fail('Disabled or missing storage must not be accessed');
  assert.deepEqual(await core.status({ query: {} }, noFetch), { status: 200, body: { enabled: false, reason: 'not-configured' } });
  entraConfiguration();
  process.env.LIVE_RESULTS = 'off';
  assert.deepEqual(await core.status({ query: {} }, noFetch), { status: 200, body: { enabled: false, reason: 'off' } });
  assert.equal((await core.progress({ body: {} }, noFetch)).body.error, 'off');
  assert.deepEqual((await trainer('overview', null, noFetch)).body, { enabled: false, hardOff: true, configured: true, sessions: [] });
  delete process.env.AZURE_CLIENT_SECRET;
  assert.equal((await trainer('overview', null, noFetch)).body.configured, false);
});

test('Rotating the Entra secret rebuilds the cached token credential', async (t) => {
  entraConfiguration();
  const instances = new Set();
  t.mock.method(ClientSecretCredential.prototype, 'getToken', async function (scope) {
    assert.equal(scope, SCOPE);
    instances.add(this);
    return { token: 'test-only-token', expiresOnTimestamp: Date.now() + 3600000 };
  });
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    return new Response(null, { status: options.method === 'POST' ? 204 : 404 });
  };
  assert.equal((await core.status({ query: {} }, fetchImpl)).body.enabled, true);
  assert.equal((await core.status({ query: {} }, fetchImpl)).body.enabled, true);
  assert.equal(instances.size, 1);
  process.env.AZURE_CLIENT_SECRET = 'different-test-only-secret';
  assert.equal((await core.status({ query: {} }, fetchImpl)).body.enabled, true);
  assert.equal(instances.size, 2);
});

for (const auth of ['shared-key', 'entra']) {
  test(`${auth}: sessions, paginated results, pause, hard off and cleanup`, async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const bearerToken = auth === 'entra' ? 'simulator-test-token' : null;
    const sim = await startTableSim({ pageSize: 2, bearerToken });
    t.after(() => new Promise((resolve) => sim.server.close(resolve)));
    process.env.RESULTS_STORAGE = sim.connectionString;
    if (auth === 'entra') {
      entraConfiguration();
      t.mock.method(ClientSecretCredential.prototype, 'getToken', async (scope) => {
        assert.equal(scope, SCOPE);
        return { token: bearerToken, expiresOnTimestamp: Date.now() + 3600000 };
      });
    } else {
      t.mock.method(ClientSecretCredential.prototype, 'getToken', () => assert.fail('Legacy mode must not request an Entra token'));
    }
    const fetchImpl = (url, options) => {
      if (auth === 'entra') {
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://devstore.table.core.windows.net');
        assert.equal(options.headers.Authorization, `Bearer ${bearerToken}`);
        url = `http://127.0.0.1:${sim.port}${parsed.pathname}${parsed.search}`;
      } else {
        assert.ok(options.headers.Authorization.startsWith('SharedKeyLite '));
      }
      return fetch(url, options);
    };
    assert.deepEqual(await core.status({ query: {} }, fetchImpl), { status: 200, body: { enabled: true } });
    assert.equal(sim.tables.size, 3);
    const opened = await trainer('session-open', { title: 'Auth regression', hours: 1 }, fetchImpl);
    assert.equal(opened.status, 200);
    const code = opened.body.session.code;
    for (let i = 0; i < 5; i++) {
      const result = await core.progress({ body: { code, pid: `player00${i}`, name: 'Test player', lang: 'en', data: { xp: 42, topics: {}, missed: [] } } }, fetchImpl);
      assert.equal(result.status, 200);
    }
    const throttled = await core.progress({ body: { code, pid: 'player000', data: {} } }, fetchImpl);
    assert.equal(throttled.status, 429);
    now += 1500;
    assert.equal((await core.progress({ body: { code, pid: 'player000', data: { xp: 42 } } }, fetchImpl)).status, 200);
    const report = await trainer('report', null, fetchImpl, { code });
    assert.equal(report.status, 200);
    assert.equal(report.body.players.length, 5);
    assert.ok(report.body.players.every((player) => player.data.xp === 42));
    const requestCount = sim.stats.requests;
    assert.equal((await core.trainer({ action: 'overview', key: 'incorrect-key' }, fetchImpl)).status, 401);
    assert.equal(sim.stats.requests, requestCount);
    assert.equal((await trainer('settings', { enabled: false }, fetchImpl)).status, 200);
    assert.equal((await core.status({ query: {} }, fetchImpl)).body.reason, 'paused');
    assert.equal((await core.progress({ body: { code, pid: 'player006' } }, fetchImpl)).body.error, 'paused');
    process.env.LIVE_RESULTS = 'off';
    const beforeHardOff = sim.stats.requests;
    assert.equal((await core.status({ query: {} }, fetchImpl)).body.reason, 'off');
    assert.equal((await trainer('overview', null, fetchImpl)).body.hardOff, true);
    assert.equal(sim.stats.requests, beforeHardOff);
    delete process.env.LIVE_RESULTS;
    assert.equal((await trainer('session-close', { code, purge: true }, fetchImpl)).body.deleted, 5);
    assert.equal((await trainer('report', null, fetchImpl, { code })).status, 404);
    assert.equal(sim.tables.get('csqResults').size, 0);
    assert.equal(sim.stats.authFailures, 0);
  });
}
