import { HttpException, Inject, Injectable } from "@nestjs/common";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { AccountCheck } from "./auth/account-check";
import { DirectoryClient } from "./auth/directory.client";
import { TOKEN_VERIFIER, TokenVerifier, checkPerson } from "./auth/verify";
import { route, type Owner } from "./routes";

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);
export const MAX_BODY = 10 * 1024 * 1024;
@Injectable()
export class ProxyService {
  readonly upstreams: Record<Owner, string> = {
    booking: process.env.BOOKING_API_URL ?? "http://bms-booking:3021",
    dispatch: process.env.DISPATCH_API_URL ?? "http://bms-dispatch:3022",
    completion: process.env.COMPLETION_API_URL ?? "http://bms-completion:3023",
    analytics: process.env.ANALYTICS_API_URL ?? "http://bms-analytics:3025",
  };
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly accounts: AccountCheck,
    private readonly directory: DirectoryClient,
  ) {}
  async serve(req: Request, res: Response) {
    const url = new URL(req.originalUrl, "http://gateway");
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(
      String(req.headers["x-request-id"] ?? ""),
    )
      ? String(req.headers["x-request-id"])
      : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/bms/health" && req.method === "GET")
      return this.health(res);
    if (url.pathname === "/bms/activity-logs" && req.method === "GET")
      return this.activity(req, res);
    const target = route(url.pathname);
    if (!target)
      return res
        .status(404)
        .json({
          code: "NOT_FOUND",
          message: "No BMS API owner for this route",
        });
    if (!target.public) {
      const { raw, token } = await checkPerson(this.verifier, req);
      await this.accounts.confirm(raw, token);
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
      req.resume();
      await new Promise<void>((resolve) => {
        req.once("end", resolve);
        req.once("error", () => resolve());
      });
      return res.status(413).json({ code: "PAYLOAD_TOO_LARGE" });
    }
    const upstreamUrl = new URL(
      target.path + url.search,
      this.upstreams[target.owner],
    );
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(
        ([name]) => !HOP.has(name.toLowerCase()),
      ),
    );
    headers["x-request-id"] = requestId;
    const upstream = (
      upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest
    )(upstreamUrl, { method: req.method, headers }, (incoming) => {
      res.statusCode = incoming.statusCode ?? 502;
      for (const [name, value] of Object.entries(incoming.headers))
        if (value !== undefined && !HOP.has(name.toLowerCase()))
          res.setHeader(name, value);
      incoming.on("error", () => res.destroy());
      incoming.pipe(res);
    });
    const fail = () => {
      if (res.writableEnded) return;
      if (!res.headersSent)
        res
          .status(502)
          .json({
            code: "UPSTREAM_UNAVAILABLE",
            message: "BMS service unavailable",
            requestId,
          });
      else res.destroy();
    };
    upstream.on("error", fail);
    upstream.setTimeout(30_000, () =>
      upstream.destroy(new Error("Upstream timeout")),
    );
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) {
          if (!res.headersSent)
            res.status(413).json({ code: "PAYLOAD_TOO_LARGE" });
          upstream.destroy();
          callback(new Error("Body limit exceeded"));
        } else callback(null, chunk);
      },
    });
    limit.on("error", () => {
      req.unpipe(limit);
      req.resume();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(limit).pipe(upstream);
  }
  private async health(res: Response) {
    const healthUpstreams = {
      ...this.upstreams,
      ...(process.env.ANALYTICS_PROJECTION_URL ? { projection: process.env.ANALYTICS_PROJECTION_URL } : {}),
    };
    const entries = await Promise.all(
      Object.entries(healthUpstreams).map(async ([name, root]) => {
        try {
          const response = await fetch(new URL("/health/ready", root), {
            signal: AbortSignal.timeout(2000),
          });
          return [name, response.ok ? "ok" : "failed"] as const;
        } catch {
          return [name, "failed"] as const;
        }
      }),
    );
    const checks = Object.fromEntries(entries);
    const ok = entries.every(([, status]) => status === "ok");
    return res
      .status(ok ? 200 : 503)
      .json(
        ok
          ? { status: "ok", checks }
          : { status: "unavailable", code: "HEALTH_CHECK_FAILED", checks },
      );
  }
  private async activity(req: Request, res: Response) {
    const { raw, token } = await checkPerson(this.verifier, req);
    const { user } = await this.accounts.confirm(raw, token);
    const key = process.env.BMS_INTERNAL_SERVICE_KEY;
    if (!key || key.length < 32)
      throw new HttpException(
        "Internal service authentication unavailable",
        503,
      );
    const isAdmin = user.roles.some((r) => r.role === "ADMIN");
    const groups = await Promise.all(
      (["booking", "dispatch", "completion"] as const).map(async (name) => {
        const response = await fetch(
          new URL("/internal/audit", this.upstreams[name]),
          {
            headers: { "x-bms-service-key": key },
            signal: AbortSignal.timeout(3000),
          },
        );
        if (!response.ok)
          throw new HttpException("Work activity unavailable", 503);
        return (await response.json()) as Array<{
          id: string;
          actorId: string;
          createdAt: string;
          action: string;
          role: string;
        }>;
      }),
    );
    const rows = groups
      .flat()
      .filter((row) => isAdmin || row.actorId === token.sub);
    const names = await this.directory.lookup(rows.map((row) => row.actorId));
    const items = rows
      .map((row) => ({
        ...row,
        userId: row.actorId,
        userName: names.get(row.actorId)?.erased
          ? "Deleted user"
          : (names.get(row.actorId)?.name ?? "Unknown user"),
        email: names.get(row.actorId)?.email ?? "",
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json({
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
    });
  }
}
