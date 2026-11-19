function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(hostname)
    || hostname.endsWith('.localhost');
}

export function workerConfig(raw) {
  const override = raw.ANALYTICS_READ_MODEL_DATABASE_URL?.trim();
  const databaseVariable = override ? 'ANALYTICS_READ_MODEL_DATABASE_URL' : 'DATABASE_URL';
  const databaseUrl = override || raw.DATABASE_URL?.trim();
  const poolLimit = String(raw.DB_POOL_MAX ?? '').trim();
  const max = poolLimit ? Number(poolLimit) : 2;
  const invalid = [];

  if (!Number.isInteger(max) || max < 1 || max > 50) invalid.push('DB_POOL_MAX');
  if (!databaseUrl) invalid.push(databaseVariable);

  if (raw.NODE_ENV === 'production') {
    for (const name of ['BOOKING_API_URL', 'DISPATCH_API_URL', 'COMPLETION_API_URL']) {
      try {
        const url = new URL(raw[name]);
        if (url.protocol !== 'https:' || isLoopback(url.hostname)) invalid.push(name);
      } catch {
        invalid.push(name);
      }
    }

    if (databaseUrl) {
      try {
        const url = new URL(databaseUrl);
        if (
          !['postgresql:', 'postgres:'].includes(url.protocol)
          || !url.hostname
          || isLoopback(url.hostname)
          || !['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode'))
        ) {
          invalid.push(databaseVariable);
        }
      } catch {
        invalid.push(databaseVariable);
      }
    }
  }

  if (invalid.length) throw new Error('Invalid environment names: ' + invalid.join(', '));
  return { databaseUrl, max };
}
