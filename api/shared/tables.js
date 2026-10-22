'use strict';
/* Azure Table Storage REST client: Entra token credentials or legacy SharedKeyLite.
   Legacy connection strings come from RESULTS_STORAGE, e.g.
   DefaultEndpointsProtocol=https;AccountName=xxx;AccountKey=yyy;EndpointSuffix=core.windows.net
   (an explicit TableEndpoint=... is also supported). */
const crypto = require('crypto');

const API_VERSION = '2019-02-02';

function parseConnectionString(cs) {
  if (!cs) return null;
  const parts = {};
  for (const seg of String(cs).split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  if (!parts.AccountName || !parts.AccountKey) return null;
  const protocol = parts.DefaultEndpointsProtocol || 'https';
  const suffix = parts.EndpointSuffix || 'core.windows.net';
  const endpoint = (parts.TableEndpoint || `${protocol}://${parts.AccountName}.table.${suffix}`).replace(/\/+$/, '');
  return { account: parts.AccountName, key: Buffer.from(parts.AccountKey, 'base64'), endpoint };
}

class TableError extends Error {
  constructor(status, code, message) { super(message || code || ('HTTP ' + status)); this.status = status; this.code = code; }
}

class TableClient {
  constructor(conn, fetchImpl) {
    this.c = conn;
    this.fetch = fetchImpl || globalThis.fetch;
  }

  // resource: path after the endpoint, e.g. "Tables" or "csqResults(PartitionKey='A',RowKey='b')"
  async request(method, resource, { query, body, headers } = {}) {
    const date = new Date().toUTCString();
    const pathOnly = '/' + resource;
    let authorization;
    if (this.c.credential) {
      const token = await this.c.credential.getToken('https://storage.azure.com/.default');
      if (!token || !token.token) throw new TableError(503, 'StorageTokenUnavailable', 'Entra ID did not return a storage access token');
      authorization = `Bearer ${token.token}`;
    } else {
      // SharedKeyLite: StringToSign = Date + "\n" + CanonicalizedResource.
      const canonical = '/' + this.c.account + pathOnly;
      const sig = crypto.createHmac('sha256', this.c.key).update(date + '\n' + canonical, 'utf8').digest('base64');
      authorization = `SharedKeyLite ${this.c.account}:${sig}`;
    }
    const qs = query ? '?' + Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
    const h = {
      'x-ms-date': date,
      'x-ms-version': API_VERSION,
      'DataServiceVersion': '3.0;NetFx',
      'MaxDataServiceVersion': '3.0;NetFx',
      'Accept': 'application/json;odata=nometadata',
      'Authorization': authorization,
      ...(headers || {})
    };
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await this.fetch(this.c.endpoint + pathOnly + qs, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { json = null; } }
    if (!res.ok) {
      const code = json && json['odata.error'] && json['odata.error'].code;
      throw new TableError(res.status, code, code ? `${code} (${res.status})` : `Table storage error ${res.status}`);
    }
    return { status: res.status, json, headers: res.headers };
  }

  static key(v) {
    // We only ever use safe keys; reject anything else so nothing can be injected into the URL.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(v))) throw new TableError(400, 'InvalidKey', 'Invalid key');
    return String(v);
  }
  static entityPath(table, pk, rk) { return `${table}(PartitionKey='${TableClient.key(pk)}',RowKey='${TableClient.key(rk)}')`; }

  async createTable(table) {
    try { await this.request('POST', 'Tables', { body: { TableName: table }, headers: { Prefer: 'return-no-content' } }); }
    catch (e) { if (e.status !== 409) throw e; } // 409 = already exists
  }
  async upsert(table, entity) {
    await this.request('PUT', TableClient.entityPath(table, entity.PartitionKey, entity.RowKey), { body: entity });
  }
  async get(table, pk, rk) {
    try { return (await this.request('GET', TableClient.entityPath(table, pk, rk))).json; }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async remove(table, pk, rk) {
    try { await this.request('DELETE', TableClient.entityPath(table, pk, rk), { headers: { 'If-Match': '*' } }); }
    catch (e) { if (e.status !== 404) throw e; }
  }
  async query(table, partitionKey, max = 1000) {
    const out = [];
    let next = {};
    do {
      const query = { $filter: partitionKey != null ? `PartitionKey eq '${TableClient.key(partitionKey)}'` : undefined, NextPartitionKey: next.pk, NextRowKey: next.rk };
      const r = await this.request('GET', table + '()', { query });
      out.push(...((r.json && r.json.value) || []));
      const pk = r.headers.get('x-ms-continuation-nextpartitionkey');
      const rk = r.headers.get('x-ms-continuation-nextrowkey');
      next = pk ? { pk, rk } : {};
    } while (next.pk && out.length < max);
    return out;
  }
}

module.exports = { TableClient, TableError, parseConnectionString };
