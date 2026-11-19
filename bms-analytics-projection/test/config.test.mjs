import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../config.mjs';

const hosted = {
  NODE_ENV: 'production',
  BOOKING_API_URL: 'https://booking.internal.example.test',
  DISPATCH_API_URL: 'https://dispatch.internal.example.test',
  COMPLETION_API_URL: 'https://completion.internal.example.test',
  DATABASE_URL: 'postgresql://app:example@psql-welinc-staging.postgres.database.azure.com/bms_analytics?sslmode=require',
};

test('worker uses the Azure database setting with a two-connection default', () => {
  assert.deepEqual(workerConfig(hosted), { databaseUrl: hosted.DATABASE_URL, max: 2 });
  assert.equal(workerConfig({ ...hosted, ANALYTICS_READ_MODEL_DATABASE_URL: ' ' }).databaseUrl, hosted.DATABASE_URL);
  assert.equal(workerConfig({ ...hosted, DB_POOL_MAX: '1' }).max, 1);
  assert.throws(() => workerConfig({ ...hosted, DB_POOL_MAX: '0' }), /DB_POOL_MAX/);
  assert.throws(() => workerConfig({ ...hosted, DATABASE_URL: '' }), /DATABASE_URL/);
});

test('worker preserves the local Compose database override', () => {
  const localUrl = 'postgresql://app:example@localhost/bms_analytics';
  assert.equal(workerConfig({
    DATABASE_URL: hosted.DATABASE_URL,
    ANALYTICS_READ_MODEL_DATABASE_URL: localUrl,
  }).databaseUrl, localUrl);
  assert.equal(workerConfig({ ANALYTICS_READ_MODEL_DATABASE_URL: localUrl }).databaseUrl, localUrl);
  assert.throws(
    () => workerConfig({ ...hosted, ANALYTICS_READ_MODEL_DATABASE_URL: localUrl }),
    /ANALYTICS_READ_MODEL_DATABASE_URL/,
  );
});

test('worker rejects insecure or invalid hosted settings', () => {
  assert.throws(
    () => workerConfig({ ...hosted, BOOKING_API_URL: 'http://booking.internal.example.test' }),
    /BOOKING_API_URL/,
  );
  const invalidUrls = [
    'invalid-url',
    'mysql://app:example@db.example.test/bms_analytics?sslmode=require',
    'postgresql:///bms_analytics?sslmode=require',
    'postgresql://app:example@db.example.test/bms_analytics',
    'postgresql://app:example@db.example.test/bms_analytics?sslmode=disable',
    ...['localhost', 'db.localhost', '127.0.0.1', '[::1]', '0.0.0.0'].map(
      host => `postgresql://app:example@${host}/bms_analytics?sslmode=require`,
    ),
  ];
  for (const databaseUrl of invalidUrls) {
    assert.throws(() => workerConfig({ ...hosted, DATABASE_URL: databaseUrl }), /DATABASE_URL/);
  }
});
