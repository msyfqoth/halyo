import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/validate-license.js';
import { handler as legacy } from '../netlify/functions/netlify-validate-license.js';

// All licence values and IDs below are fixtures. Fetch is replaced in every case.
const key = 'fixture-halyo-key-not-a-real-license';
const meta = { store_id: 10, product_id: 20, product_name: 'Halyo' };
const valid = () => ({ valid: true, meta: { ...meta }, license_key: { status: 'inactive' }, instance: null });
const activated = () => ({ activated: true, meta: { ...meta }, license_key: { status: 'active' }, instance: { id: 'fixture-instance' } });
const request = (extra = {}) => ({ httpMethod: 'POST', body: JSON.stringify({ licenseKey: key, instanceName: 'halyo-web', ...extra }) });
async function run(responses, event = request(), env = {}) {
  const names = ['LEMONSQUEEZY_STORE_ID', 'LEMONSQUEEZY_PRODUCT_ID', 'LEMONSQUEEZY_API_KEY'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.LEMONSQUEEZY_STORE_ID = '10';
    process.env.LEMONSQUEEZY_PRODUCT_ID = '20';
    delete process.env.LEMONSQUEEZY_API_KEY;
    for (const [name, value] of Object.entries(env)) { if (value === null) delete process.env[name]; else process.env[name] = value; }
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      assert.match(url, /^https:\/\/api\.lemonsqueezy\.com\/v1\/licenses\/(validate|activate)$/);
      const fixture = responses[calls.length - 1];
      if (!fixture) throw new Error('Unexpected API call');
      if (fixture instanceof Error) throw fixture;
      return { ok: (fixture.status || 200) < 400, status: fixture.status || 200, json: async () => { if (fixture.badJson) throw new Error('bad json'); return fixture.body ?? fixture; } };
    };
    const result = await handler(event);
    return { ...result, data: result.body ? JSON.parse(result.body) : null, calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; }
  }
}

test('new Halyo key activates and returns the instance without merchant API credentials', async () => {
  const r = await run([valid(), activated()]);
  assert.equal(r.data.valid, true); assert.equal(r.data.activationToken, 'fixture-instance');
  assert.equal(r.calls.length, 2); assert.equal(r.calls[0].options.headers.Authorization, undefined);
  assert.equal(r.calls[1].options.body.get('instance_name'), 'halyo-web');
});
test('legacy Function route shares the identical handler', () => assert.equal(legacy, handler));
for (const [label, change] of [
  ['wrong product in same store', d => { d.meta.product_id = 21; }],
  ['wrong store', d => { d.meta.store_id = 11; }],
  ['missing product identity', d => { delete d.meta.product_id; }],
  ['missing metadata', d => { delete d.meta; }],
  ['disabled', d => { d.license_key.status = 'disabled'; }],
  ['expired', d => { d.license_key.status = 'expired'; }],
  ['missing status', d => { delete d.license_key.status; }],
  ['invalid key', d => { d.valid = false; }],
]) test(`rejects ${label} before activation`, async () => {
  const fixture = valid(); change(fixture); const r = await run([fixture]);
  assert.equal(r.data.valid, false); assert.equal(r.calls.length, 1);
});
for (const [label, change] of [
  ['activation refusal', d => { d.activated = false; }],
  ['missing activation instance', d => { delete d.instance; }],
  ['wrong activation product', d => { d.meta.product_id = 21; }],
  ['inactive activation response', d => { d.license_key.status = 'inactive'; }],
]) test(`does not grant access after ${label}`, async () => {
  const fixture = activated(); change(fixture); const r = await run([valid(), fixture]);
  assert.equal(r.data.valid, false); assert.equal(r.data.activationToken, undefined);
});
test('revalidates an active returning instance without consuming a new activation', async () => {
  const fixture = valid(); fixture.license_key.status = 'active'; fixture.instance = { id: 'fixture-instance' };
  const r = await run([fixture], request({ instanceId: 'fixture-instance' }));
  assert.equal(r.data.valid, true); assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].options.body.get('instance_id'), 'fixture-instance');
});
test('mismatched returning instance fails without activating', async () => {
  const fixture = valid(); fixture.license_key.status = 'active'; fixture.instance = { id: 'other-instance' };
  const r = await run([fixture], request({ instanceId: 'fixture-instance' }));
  assert.equal(r.data.valid, false); assert.equal(r.calls.length, 1);
});
for (const env of [{ LEMONSQUEEZY_PRODUCT_ID: null }, { LEMONSQUEEZY_STORE_ID: null }, { LEMONSQUEEZY_PRODUCT_ID: 'checkout-uuid' }]) {
  test(`missing/invalid config fails closed: ${JSON.stringify(env)}`, async () => {
    const r = await run([], request(), env); assert.equal(r.statusCode, 503); assert.equal(r.calls.length, 0);
  });
}
for (const event of [{ httpMethod: 'POST', body: '{' }, { httpMethod: 'POST', body: 'null' }, request({ licenseKey: 'short' }), request({ instanceName: '' })]) {
  test(`malformed request is rejected: ${event.body}`, async () => {
    const r = await run([], event); assert.equal(r.statusCode, 400); assert.equal(r.calls.length, 0);
  });
}
for (const fixture of [{ status: 429 }, { status: 503 }, { badJson: true }, new Error('network/timeout fixture')]) {
  test('upstream outage or invalid payload never grants access', async () => {
    const r = await run([fixture]); assert.equal(r.statusCode, 503); assert.equal(r.data.valid, false);
    assert(!r.body.includes(key)); assert.equal(r.headers['Cache-Control'], 'no-store');
  });
}
test('non-2xx cannot override denial even with valid:true payload', async () => {
  const r = await run([{ status: 422, body: valid() }]); assert.equal(r.data.valid, false); assert.equal(r.calls.length, 1);
});
test('preflight and unsupported methods do not contact upstream', async () => {
  assert.equal((await run([], { httpMethod: 'OPTIONS' })).statusCode, 200);
  assert.equal((await run([], { httpMethod: 'GET' })).statusCode, 405);
});
