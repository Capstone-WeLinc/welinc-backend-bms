import pg from 'pg';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Local Auth bridge adapter. It owns every BMS dependency on local Auth data;
 * a live Auth adapter must wait for the Auth owner's supported API contract.
 */
export class LocalAuthIntegration {
  constructor({ bridgeUrl, databaseUrl, serviceKey, fetchImpl = fetch, poolFactory } = {}) {
    this.bridgeUrl = bridgeUrl || 'http://127.0.0.1:3000';
    this.databaseUrl = databaseUrl;
    this.serviceKey = serviceKey;
    this.fetchImpl = fetchImpl;
    this.poolFactory = poolFactory || ((connectionString) => new pg.Pool({ connectionString }));
    this.pool = null;
  }

  async close() {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  async #profile(authorization) {
    if (!/^Bearer\s+\S+$/i.test(authorization)) return { status: 401 };
    try {
      const response = await this.fetchImpl(new URL('/auth/me', this.bridgeUrl), {
        headers: { authorization }, signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { status: response.status === 401 ? 401 : 503 };
      const user = await response.json();
      if (!USER_ID.test(String(user.id || ''))) return { status: 503 };
      return { status: 200, user };
    } catch {
      return { status: 503 };
    }
  }

  #localPool() {
    if (!this.databaseUrl) return null;
    try {
      const address = new URL(this.databaseUrl);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) return null;
      this.pool ??= this.poolFactory(this.databaseUrl);
      return this.pool;
    } catch {
      return null;
    }
  }

  async profileActivity(authorization) {
    const profile = await this.#profile(authorization);
    if (profile.status !== 200) return { status: profile.status };
    const pool = this.#localPool();
    if (!pool) return { status: 503 };
    try {
      const result = await pool.query(`SELECT id, action, device_info AS "deviceInfo", location,
        ip_address AS "ipAddress", created_at AS "createdAt"
        FROM user_activity_logs WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 50`, [profile.user.id]);
      return { status: 200, rows: result.rows };
    } catch {
      return { status: 503 };
    }
  }

  async activityLogs(authorization, serviceRows, serviceKey = this.serviceKey) {
    const profile = await this.#profile(authorization);
    if (profile.status !== 200) return { status: profile.status };
    if (!Array.isArray(profile.user.roles) || !profile.user.roles.some((role) => role.system === 'BMS' && role.role === 'ADMIN')) {
      return { status: 403 };
    }
    if (!serviceKey || serviceKey.length < 32) return { status: 503 };
    const pool = this.#localPool();
    if (!pool) return { status: 503 };
    try {
      const authRows = await pool.query(`SELECT l.id, l.user_id AS "userId", u.name AS "userName", u.email, l.action,
        l.ip_address AS "ipAddress", l.created_at AS "createdAt",
        (SELECT role::text FROM user_roles WHERE user_id = l.user_id AND system = 'BMS' ORDER BY created_at LIMIT 1) AS role
        FROM user_activity_logs l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 1000`);
      const actorIds = [...new Set(serviceRows.flat().map((row) => row.actorId).filter(Boolean))];
      const people = actorIds.length ? (await pool.query(
        'SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])', [actorIds],
      )).rows : [];
      const byId = new Map(people.map((person) => [person.id, person]));
      const service = serviceRows.flat().map((row) => ({
        id: row.id, userId: row.actorId, userName: byId.get(row.actorId)?.name ?? row.actorId,
        email: byId.get(row.actorId)?.email ?? '', role: row.role,
        action: row.action, ipAddress: row.ipAddress, createdAt: row.createdAt,
      }));
      return { status: 200, rows: [...service, ...authRows.rows] };
    } catch {
      return { status: 503 };
    }
  }
}
