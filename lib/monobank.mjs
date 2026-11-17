/* monobank acquiring (plata by mono): invoices, status, refunds and webhook signature check.
   The merchant token lives only in the server environment (MONO_TOKEN); card data never touches this server:
   the customer pays on monobank's own payment page. Docs: https://api.monobank.ua/docs/acquiring.html */
import { createVerify } from 'node:crypto';
import { ApiError } from './store.mjs';

export const PAYMENT_STATUS = {
  created: 'pending', processing: 'pending', hold: 'pending',
  success: 'paid', failure: 'failed', expired: 'expired', reversed: 'refunded'
};

export function createMonobank({
  token = process.env.MONO_TOKEN || '',
  baseUrl = process.env.MONO_API_URL || 'https://api.monobank.ua',
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  let pubkey = null, pubkeyAt = 0;

  async function call(method, path, body) {
    if (!token) throw new ApiError(503, 'Оплата картой не настроена: нет токена monobank.', 'PAY_DISABLED');
    let response;
    try {
      response = await fetchImpl(baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: { 'X-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      logger.error?.('monobank unreachable:', error.message);
      throw new ApiError(503, 'Платёжный сервис monobank временно недоступен. Попробуйте ещё раз.', 'PAY_DOWN');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      logger.error?.('monobank error:', response.status, data.errCode, data.errText);
      throw new ApiError(response.status === 403 ? 503 : 502, response.status === 403 ? 'monobank отклонил токен магазина. Проверьте MONO_TOKEN.' : 'monobank не принял платёж: ' + (data.errText || 'ошибка сервиса') + '.', 'PAY_ERROR');
    }
    return data;
  }

  return {
    get enabled() { return !!token; },

    /* amount and basket sums are integers in kopiyky */
    async createInvoice({ amount, reference, destination, basket, redirectUrl, webHookUrl, validity = 24 * 3600 }) {
      const data = await call('POST', '/api/merchant/invoice/create', {
        amount, ccy: 980,
        merchantPaymInfo: { reference, destination, basketOrder: basket },
        redirectUrl, ...(webHookUrl ? { webHookUrl } : {}), validity, paymentType: 'debit'
      });
      const official = /^https:\/\/api\.monobank\.ua\/?$/.test(baseUrl);
      if (!data.invoiceId || !(official ? /^https:\/\// : /^https?:\/\//).test(data.pageUrl || '')) throw new ApiError(502, 'monobank вернул некорректный ответ.', 'PAY_ERROR');
      return { invoiceId: String(data.invoiceId), pageUrl: data.pageUrl };
    },

    async status(invoiceId) {
      const d = await call('GET', '/api/merchant/invoice/status?invoiceId=' + encodeURIComponent(invoiceId));
      return normalize(d);
    },

    async refund(invoiceId, extRef) {
      const d = await call('POST', '/api/merchant/invoice/cancel', { invoiceId, extRef });
      return { status: d.status || 'processing' };
    },

    async verifyWebhook(rawBody, signature) {
      if (!signature || typeof signature !== 'string') return false;
      const check = async force => {
        if (force || !pubkey || Date.now() - pubkeyAt > 24 * 3600e3) {
          const d = await call('GET', '/api/merchant/pubkey');
          pubkey = Buffer.from(String(d.key || ''), 'base64').toString('utf8'); pubkeyAt = Date.now();
        }
        try { const v = createVerify('SHA256'); v.update(rawBody); v.end(); return v.verify(pubkey, signature, 'base64'); }
        catch (_) { return false; }
      };
      // monobank may rotate its key: retry once with a freshly downloaded key
      return (await check(false)) || (await check(true));
    }
  };
}

export function normalize(d) {
  return {
    invoiceId: String(d.invoiceId || ''),
    providerStatus: String(d.status || ''),
    status: PAYMENT_STATUS[d.status] || 'pending',
    amount: Number(d.amount) || 0,
    finalAmount: Number(d.finalAmount ?? d.amount) || 0,
    reference: String(d.reference || ''),
    failureReason: String(d.failureReason || ''),
    modifiedDate: String(d.modifiedDate || d.createdDate || '')
  };
}
