import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  DIRECTORY_TOKENS,
  ServiceTokenClient,
  VERIFY_CONFIG,
  type VerifyConfig,
} from "./verify";
export type DirectoryPerson = {
  id: string;
  name: string;
  email: string;
  /** Filled because this service's token holds `directory.contact`; null when the person has none. */
  phone?: string | null;
  roles: string[];
  temporaryRoles?: string[];
  isActive: boolean;
  deleted: boolean;
  erased?: boolean;
};

/** How long a full read of the BMS roster is reused. The directory allows 120 calls a minute. */
const ROSTER_TTL_MS = 30_000;
const unavailable = () =>
  new ServiceUnavailableException({
    code: "AUTH_UNAVAILABLE",
    message: "Directory unavailable",
  });

@Injectable()
export class DirectoryClient {
  private rosterCache?: { until: number; people: Promise<DirectoryPerson[]> };

  constructor(
    @Inject(DIRECTORY_TOKENS) private readonly tokens: ServiceTokenClient,
    @Inject(VERIFY_CONFIG) private readonly config: VerifyConfig,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    return this.tokens.withToken(async (token) => {
      let res: Response;
      try {
        res = await fetch(`${this.config.internalUrl}${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            ...(init?.body ? { "content-type": "application/json" } : {}),
          },
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        throw unavailable();
      }
      if (res.status === 401)
        throw new HttpException("Directory token expired", 401);
      if (!res.ok) throw unavailable();
      return (await res.json()) as T;
    });
  }

  async lookup(ids: string[]): Promise<Map<string, DirectoryPerson>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const people = new Map<string, DirectoryPerson>();
    for (let i = 0; i < unique.length; i += 100) {
      const answer = await this.call<{ users: DirectoryPerson[]; missing: string[] }>(
        "/auth/directory/users/lookup",
        { method: "POST", body: JSON.stringify({ ids: unique.slice(i, i + 100) }) },
      );
      if (!Array.isArray(answer.users))
        throw new ServiceUnavailableException("Directory answer is invalid");
      for (const person of answer.users) people.set(person.id, person);
    }
    return people;
  }

  /**
   * Everyone who holds a role in BMS right now, with name, email and phone (spec bms/0012). Team
   * Management lists drivers and helpers from this, so a new account shows up without being added
   * in BMS. Reused for 30 seconds; a failed read is not kept.
   */
  roster(): Promise<DirectoryPerson[]> {
    if (this.rosterCache && this.rosterCache.until > Date.now()) return this.rosterCache.people;
    const people = this.readRoster();
    this.rosterCache = { until: Date.now() + ROSTER_TTL_MS, people };
    people.catch(() => { this.rosterCache = undefined; });
    return people;
  }

  private async readRoster(): Promise<DirectoryPerson[]> {
    const people: DirectoryPerson[] = [];
    let cursor: string | null = null;
    // 50 pages of 500 is far beyond any real roster; it stops a bad cursor from looping forever.
    for (let page = 0; page < 50; page++) {
      const query: string = cursor ? `?limit=500&cursor=${encodeURIComponent(cursor)}` : "?limit=500";
      const answer: { users: DirectoryPerson[]; next: string | null } = await this.call(`/auth/directory/users${query}`);
      if (!Array.isArray(answer.users))
        throw new ServiceUnavailableException("Directory answer is invalid");
      people.push(...answer.users);
      cursor = answer.next;
      if (!cursor) return people;
    }
    throw new ServiceUnavailableException("Directory answer is invalid");
  }
}
