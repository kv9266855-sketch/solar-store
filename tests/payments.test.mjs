import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/store.mjs';
import { createMonobank } from '../lib/monobank.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const sign = body => { const s = createSign('SHA256'); s.update(body); s.end(); return s.sign(privateKey, 'base64'); };

/* In-memory stand-in for api.monobank.ua; the real client code (createMonobank) talks to it. */
function fakeMonobankApi() {
  const invoices = new Map(); const calls = [];
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data });
  async function fetchImpl(url, options = {}) {
    const u = new URL(url); calls.push({ path: u.pathname, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
    if (options.headers?.['X-Token'] !== 'test-merchant-token') return reply(403, { errCode: 'FORBIDDEN', errText: 'forbidden' });
    if (u.pathname === '/api/merchant/pubkey') return reply(200, { key: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64') });
    if (u.pathname === '/api/merchant/invoice/create') {
      const body = JSON.parse(options.body); const invoiceId = 'inv' + (invoices.size + 1);
      invoices.set(invoiceId, { invoiceId, status: 'created', amount: body.amount, ccy: 980, reference: body.merchantPaymInfo.reference, createdDate: new Date().toISOString() });
      return reply(200, { invoiceId, pageUrl: 'https://pay.mbnk.biz/' + invoiceId });
    }
    if (u.pathname === '/api/merchant/invoice/status') { const inv = invoices.get(u.searchParams.get('invoiceId')); return inv ? reply(200, inv) : reply(400, { errText: 'not found' }); }
    if (u.pathname === '/api/merchant/invoice/cancel') { const inv = invoices.get(JSON.parse(options.body).invoiceId); inv.status = 'reversed'; return reply(200, { status: 'processing' }); }
    return reply(404, {});
  }
  return { invoices, calls, fetchImpl };
}

async function fixture() {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'solar-pay-'));
  const api = fakeMonobankApi();
  const monobank = createMonobank({ token: 'test-merchant-token', baseUrl: 'https://mono.test', fetchImpl: api.fetchImpl, logger: {} });
  const app = createApp({ rootDir, dataDir, logger: { error: () => {} }, monobank, publicUrl: 'https://solar.example' });
  app.store.createUser({ username: 'PayAdmin', passwordHash: await hashPassword('Pay-Admin-Password-1'), role: 'admin' });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const client = () => ({ cookie: '', csrf: '', async request(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && this.csrf ? { 'X-Solar-CSRF': this.csrf } : {}), Origin: base, ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const set = response.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    let data; try { data = await response.json(); } catch { data = null; } if (data?.csrfToken) this.csrf = data.csrfToken; return { status: response.status, data };
  } });
  return { app, api, base, client, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

test('card payments: invoice, access control, signed webhook, refund and switch-off', async () => {
  const f = await fixture(); try {
    const buyer = f.client(); await buyer.request('/api/auth/me');
    await buyer.request('/api/auth/register', { method: 'POST', body: { username: 'CardBuyer', email: 'card@example.test', password: 'Card-Buyer-Password-1' } });
    const site = (await buyer.request('/api/site')).data; assert.equal(site.payments.card, true);
    const p = site.products.find(x => Object.values(x.sizes).some(q => q > 1)); const size = Object.keys(p.sizes).find(k => p.sizes[k] > 1);
    const input = { items: [{ id: p.id, size, qty: 2 }], paymentMethod: 'card', lang: 'uk', idempotencyKey: 'card-order-request-1', customer: { name: 'Card Buyer', phone: '+380501234567', email: 'card@example.test', method: 'pickup' } };

    const placed = await buyer.request('/api/orders', { method: 'POST', body: input });
    assert.equal(placed.status, 201); assert.match(placed.data.pageUrl, /^https:\/\/pay\.mbnk\.biz\//);
    const order = placed.data.order; assert.equal(order.paymentMethod, 'card'); assert.equal(order.payment.status, 'pending'); assert.equal('sessionHash' in order, false);
    const create = f.api.calls.find(c => c.path === '/api/merchant/invoice/create').body;
    assert.equal(create.amount, Math.round(p.price * 100) * 2); assert.equal(create.ccy, 980); assert.equal(create.merchantPaymInfo.reference, order.id);
    assert.equal(create.merchantPaymInfo.basketOrder[0].sum * create.merchantPaymInfo.basketOrder[0].qty, create.amount);
    assert.equal(create.redirectUrl, 'https://solar.example/#/payment/' + order.id); assert.equal(create.webHookUrl, 'https://solar.example/api/payments/monobank/webhook');

    const again = await buyer.request('/api/orders', { method: 'POST', body: input });
    assert.equal(again.data.order.id, order.id); assert.equal(again.data.pageUrl, placed.data.pageUrl);
    assert.equal(f.api.calls.filter(c => c.path === '/api/merchant/invoice/create').length, 1);

    const stranger = f.client(); await stranger.request('/api/auth/me');
    assert.equal((await stranger.request('/api/orders/' + order.id + '/payment')).status, 404);
    assert.equal((await stranger.request('/api/orders/' + order.id + '/pay', { method: 'POST', body: {} })).status, 404);
    assert.equal((await buyer.request('/api/orders/' + order.id + '/payment')).data.order.payment.status, 'pending');

    const invoiceId = order.payment.invoiceId;
    const paidBody = JSON.stringify({ invoiceId, status: 'success', amount: create.amount, ccy: 980, reference: order.id, modifiedDate: new Date().toISOString() });
    assert.equal((await f.client().request('/api/payments/monobank/webhook', { method: 'POST', raw: paidBody, headers: { 'X-Sign': sign('{"tampered":true}') } })).status, 401);
    assert.equal((await f.client().request('/api/payments/monobank/webhook', { method: 'POST', raw: paidBody })).status, 401);
    const hook = await f.client().request('/api/payments/monobank/webhook', { method: 'POST', raw: paidBody, headers: { 'X-Sign': sign(paidBody) } });
    assert.equal(hook.status, 200);
    const paid = (await buyer.request('/api/orders/' + order.id + '/payment')).data.order;
    assert.equal(paid.payment.status, 'paid'); assert.ok(paid.history.some(h => h.status === 'payment_paid'));
    const stale = JSON.stringify({ invoiceId, status: 'created', amount: create.amount, reference: order.id, modifiedDate: new Date(Date.now() - 3600e3).toISOString() });
    await f.client().request('/api/payments/monobank/webhook', { method: 'POST', raw: stale, headers: { 'X-Sign': sign(stale) } });
    assert.equal((await buyer.request('/api/account/orders')).data.orders[0].payment.status, 'paid');
    assert.equal((await buyer.request('/api/orders/' + order.id + '/pay', { method: 'POST', body: {} })).status, 409);
    const cancel = await buyer.request('/api/account/orders/' + order.id + '/cancel', { method: 'POST', body: {} });
    assert.equal(cancel.status, 409); assert.equal(cancel.data.code, 'ORDER_PAID');

    const admin = f.client(); await admin.request('/api/auth/me'); await admin.request('/api/auth/login', { method: 'POST', body: { username: 'PayAdmin', password: 'Pay-Admin-Password-1' } });
    assert.equal((await buyer.request('/api/admin/orders/' + order.id + '/refund', { method: 'POST', body: {} })).status, 403);
    const overview = (await admin.request('/api/admin/overview')).data; assert.equal(overview.stats.paidOnline, p.price * 2);
    const refund = await admin.request('/api/admin/orders/' + order.id + '/refund', { method: 'POST', body: {} });
    assert.equal(refund.status, 200); assert.equal(refund.data.order.payment.status, 'refunding');
    const refreshed = await admin.request('/api/admin/orders/' + order.id + '/payment', { method: 'POST', body: {} });
    assert.equal(refreshed.data.order.payment.status, 'refunded');

    const cod = await buyer.request('/api/orders', { method: 'POST', body: { ...input, paymentMethod: 'cod', idempotencyKey: 'cod-order-request-1' } });
    assert.equal(cod.status, 201); assert.equal(cod.data.order.paymentMethod, 'cod'); assert.equal(cod.data.pageUrl, undefined);

    const doc = (await admin.request('/api/admin/site')).data; doc.config.cardPaymentsEnabled = false;
    assert.equal((await admin.request('/api/admin/site', { method: 'PUT', body: doc })).status, 200);
    assert.equal((await buyer.request('/api/site')).data.payments.card, false);
    const off = await buyer.request('/api/orders', { method: 'POST', body: { ...input, idempotencyKey: 'card-order-request-2' } });
    assert.equal(off.status, 409); assert.equal(off.data.code, 'PAY_DISABLED');
  } finally { await f.close(); }
});

test('card payments are hidden without a merchant token', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'solar-pay-off-'));
  const app = createApp({ rootDir, dataDir, logger: { error: () => {} }, monobank: createMonobank({ token: '' }) });
  try {
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const site = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/site`)).json();
    assert.equal(site.payments.card, false); assert.equal(site.payments.cod, true);
  } finally { await app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
