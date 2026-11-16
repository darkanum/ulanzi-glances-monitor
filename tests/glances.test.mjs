import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GlancesClient } = require('../com.ulanzi.glancesmonitor.ulanziPlugin/plugin/glances.js');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const route = routes[new URL(url).pathname];
    if (!route) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
  };
  return calls;
}

test('a plugin the server does not run reports no data, not offline', async () => {
  const calls = serve({ '/api/4/sensors': { status: 400, body: { detail: 'Unknown plugin sensors' } } });
  const client = new GlancesClient('127.0.0.1:61208');
  await assert.rejects(client.load('sensors'), { code: 'nodata' });
  assert.equal(client.version, 4);
  assert.deepEqual(calls, ['http://127.0.0.1:61208/api/4/sensors']);
});

test('a refused connection reports offline', async () => {
  serve({});
  const client = new GlancesClient('127.0.0.1:61208');
  await assert.rejects(client.load('cpu'), { code: 'offline' });
});

test('a wrong password reports a login failure', async () => {
  serve({ '/api/4/cpu': { status: 401 } });
  const client = new GlancesClient('127.0.0.1:61208', 'glances', 'wrong');
  await assert.rejects(client.load('cpu'), { code: 'auth' });
});

test('a Glances 3 server is found after API v4 fails', async () => {
  serve({ '/api/3/cpu': { body: { total: 12 } } });
  const client = new GlancesClient('127.0.0.1:61208');
  assert.deepEqual(await client.load('cpu'), { total: 12 });
  assert.equal(client.version, 3);
});
