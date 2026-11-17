/* Nova Poshta directory proxy: cities, every branch/postomat of a city, parcel tracking.
   The public API answers without a key; set NP_API_KEY for higher limits.
   Results are cached in memory so the storefront never talks to a third party directly. */
import { ApiError } from './store.mjs';

const ENDPOINT = 'https://api.novaposhta.ua/v2.0/json/';
const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 500;

export const isRef = value => typeof value === 'string' && REF.test(value);

const norm = value => String(value || '').toLowerCase().replace(/[’'`"«»]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function kind(w) {
  if (w.CategoryOfWarehouse === 'Postomat') return 'postomat';
  if (w.CategoryOfWarehouse === 'Branch' || w.CategoryOfWarehouse === 'DropOff') return w.TypeOfWarehouse === '9a68df70-0267-42a8-bb5c-37f427e36ee4' ? 'cargo' : 'branch';
  return null; // Fulfillment & service points cannot receive customer parcels
}

export function createNovaPoshta({ apiKey = process.env.NP_API_KEY || '', fetchImpl = globalThis.fetch, logger = console } = {}) {
  const cache = new Map();

  async function call(modelName, calledMethod, methodProperties) {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      logger.error?.('Nova Poshta unreachable:', error.message);
      throw new ApiError(503, 'Нова Пошта временно недоступна. Попробуйте через минуту.', 'NP_DOWN');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.success !== true) {
      logger.error?.('Nova Poshta error:', response.status, data?.errors);
      throw new ApiError(502, 'Нова Пошта не ответила на запрос. Попробуйте ещё раз.', 'NP_ERROR');
    }
    return data;
  }

  function cached(key, ttlMs, loader) {
    const now = Date.now(), hit = cache.get(key);
    if (hit && hit.until > now) return hit.promise;
    const promise = loader().catch(error => { cache.delete(key); throw error; });
    cache.set(key, { until: now + ttlMs, promise });
    if (cache.size > 600) for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
    return promise;
  }

  async function searchCities(query) {
    const q = String(query || '').trim().slice(0, 60);
    if (q.length < 2) return [];
    return cached('city:' + norm(q), 6 * 3600e3, async () => {
      const data = await call('AddressGeneral', 'searchSettlements', { CityName: q, Limit: '25', Page: '1' });
      const seen = new Set();
      return (data.data?.[0]?.Addresses || [])
        .filter(a => isRef(a.DeliveryCity) && Number(a.Warehouses) > 0)
        .filter(a => !seen.has(a.Ref) && seen.add(a.Ref))
        .map(a => ({
          ref: a.DeliveryCity,
          settlementRef: a.Ref,
          name: a.MainDescription,
          label: a.Present,
          area: a.Area,
          warehouses: Number(a.Warehouses) || 0
        }));
    });
  }

  function warehousesOf(cityRef) {
    if (!isRef(cityRef)) throw new ApiError(400, 'Сначала выберите город из списка.');
    return cached('wh:' + cityRef, 12 * 3600e3, async () => {
      const first = await call('AddressGeneral', 'getWarehouses', { CityRef: cityRef, Limit: String(PAGE), Page: '1' });
      const total = Number(first.info?.totalCount) || first.data.length;
      const pages = Math.min(40, Math.ceil(total / PAGE));
      const rest = [];
      for (let page = 2; page <= pages; page += 4) {
        const batch = [];
        for (let p = page; p < page + 4 && p <= pages; p++) batch.push(call('AddressGeneral', 'getWarehouses', { CityRef: cityRef, Limit: String(PAGE), Page: String(p) }));
        rest.push(...(await Promise.all(batch)));
      }
      const list = [];
      for (const w of [first, ...rest].flatMap(r => r.data || [])) {
        const type = kind(w);
        if (!type || w.DenyToSelect === '1' || (w.WarehouseStatus && w.WarehouseStatus !== 'Working')) continue;
        list.push({
          ref: w.Ref,
          number: w.Number,
          type,
          name: w.Description,
          nameRu: w.DescriptionRu || w.Description,
          address: w.ShortAddress,
          fitting: w.HasFittingRoom === '1',
          maxKg: Number(w.PlaceMaxWeightAllowed) || Number(w.TotalMaxWeightAllowed) || 0,
          search: norm([w.Number, w.Description, w.DescriptionRu, w.ShortAddress].join(' '))
        });
      }
      list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'branch' ? -1 : b.type === 'branch' ? 1 : a.type.localeCompare(b.type)) || (Number(a.number) - Number(b.number)));
      return list;
    });
  }

  async function warehouses({ cityRef, q = '', type = 'all', offset = 0, limit = 60 }) {
    const all = await warehousesOf(cityRef);
    const counts = { all: all.length, branch: 0, postomat: 0, cargo: 0 };
    for (const w of all) counts[w.type]++;
    const words = norm(q).split(' ').filter(Boolean);
    const filtered = all.filter(w => (type === 'all' || w.type === type) && words.every(word => word.startsWith('№') ? w.number === word.slice(1) : w.search.includes(word)));
    // exact number match first: "12" → №12
    const digits = norm(q).replace(/^№/, '');
    if (/^\d+$/.test(digits)) {
      const score = w => w.number === digits ? 0 : w.number.startsWith(digits) ? 1 : 2;
      filtered.sort((a, b) => score(a) - score(b));
    }
    const start = Math.max(0, Math.min(Number(offset) || 0, filtered.length));
    const size = Math.max(1, Math.min(Number(limit) || 60, 200));
    return {
      total: filtered.length,
      counts,
      offset: start,
      items: filtered.slice(start, start + size).map(({ search, ...w }) => w)
    };
  }

  async function findWarehouse(cityRef, ref) {
    if (!isRef(cityRef) || !isRef(ref)) return null;
    return (await warehousesOf(cityRef)).find(w => w.ref === ref) || null;
  }

  async function track(number, phone = '') {
    const ttn = String(number || '').replace(/\s+/g, '');
    if (!/^\d{10,20}$/.test(ttn)) throw new ApiError(400, 'Номер ТТН — 10–20 цифр.');
    return cached('ttn:' + ttn + ':' + phone, 5 * 60e3, async () => {
      const data = await call('TrackingDocument', 'getStatusDocuments', { Documents: [{ DocumentNumber: ttn, Phone: String(phone).replace(/\D/g, '').slice(-12) }] });
      const d = data.data?.[0] || {};
      return {
        number: ttn,
        found: d.StatusCode !== '3',
        statusCode: d.StatusCode || '',
        status: d.Status || '',
        city: d.CityRecipient || '',
        warehouse: d.WarehouseRecipient || '',
        scheduledDelivery: d.ScheduledDeliveryDate || '',
        receivedAt: d.RecipientDateTime || '',
        url: `https://novaposhta.ua/tracking/?cargo_number=${ttn}`
      };
    });
  }

  return { searchCities, warehouses, findWarehouse, track };
}
