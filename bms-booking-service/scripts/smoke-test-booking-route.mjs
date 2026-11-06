import assert from 'node:assert/strict';
import routeModule from '../dist/src/booking/booking-route.service.js';

const { BookingRouteService } = routeModule;
const originalFetch = globalThis.fetch;
const requests = [];
const polyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes('/geocode/json')) {
    const address = new URL(url).searchParams.get('address');
    requests.push({ type: 'geocode', address });
    if (address === 'Unknown pickup') return { ok: true, json: async () => ({ status: 'ZERO_RESULTS' }) };
    if (address === 'Pickup landmark') return { ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'pickup-landmark-id' }] }) };
    if (address === 'Known delivery') return { ok: true, json: async () => ({ status: 'OK', results: [{ place_id: 'delivery-id' }] }) };
    return { ok: false };
  }
  if (url.includes('/directions/v2:computeRoutes')) {
    requests.push({ type: 'route', body: JSON.parse(options.body), headers: options.headers });
    return { ok: true, json: async () => ({
      routes: [{ distanceMeters: 25000, duration: '3600s', polyline: { encodedPolyline: polyline } }],
    }) };
  }
  throw new Error(`Unexpected URL: ${url}`);
};

try {
  const unconfigured = new BookingRouteService({ get: () => undefined });
  await assert.rejects(() => unconfigured.calculateRoute('A', 'B'), (error) => error.getStatus?.() === 503);

  const service = new BookingRouteService({ get: (name) => name === 'GOOGLE_MAPS_API_KEY' ? 'local-test-key' : undefined });
  const result = await service.calculateRoute('Unknown pickup', 'Known delivery', 'Pickup landmark');
  assert.equal(result.provider, 'google');
  assert.equal(result.distanceKm, 25);
  assert.equal(result.durationMin, 60);
  assert.equal(result.geometry.length, 3);
  const route = requests.find((request) => request.type === 'route');
  assert.deepEqual(route.body.origin, { placeId: 'pickup-landmark-id' });
  assert.deepEqual(route.body.destination, { placeId: 'delivery-id' });
  assert.equal(route.headers['X-Goog-Api-Key'], 'local-test-key');
  console.log('Google route response shape and ZERO_RESULTS landmark fallback: PASS');

  requests.length = 0;
  await service.calculateRoute('Geocoding unavailable', 'Known delivery', 'Unused landmark');
  assert.deepEqual(requests.find((request) => request.type === 'route').body.origin, { address: 'Geocoding unavailable' });
  assert.equal(requests.some((request) => request.address === 'Unused landmark'), false);
  console.log('Geocoding failure preserves the supplied address: PASS');
} finally {
  globalThis.fetch = originalFetch;
}
