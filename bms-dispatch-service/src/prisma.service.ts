import { poolMax, databaseReady } from './config/hosting';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  private readonly pool: pg.Pool;

  constructor() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: poolMax(process.env.DB_POOL_MAX), connectionTimeoutMillis: 1900 });
    // Idle connection failures must make readiness fail, rather than crash the process.
    pool.on('error', () => console.error('Database pool connection closed'));
    super({ adapter: new PrismaPg(pool, { disposeExternalPool: false }) });
    this.pool = pool;
  }

  async checkReady() { await databaseReady(() => { const query={text:'SELECT 1',query_timeout:1900};return this.pool.query(query); }); }

  async onApplicationShutdown() {
    await this.$disconnect();
    await this.pool.end();
  }
}
