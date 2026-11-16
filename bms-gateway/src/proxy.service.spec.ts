import express from "express";
import request from "supertest";
import { createServer, type Server } from "node:http";
import { ProxyService, MAX_BODY } from "./proxy.service";
describe("raw BMS proxy", () => {
  let upstream: Server;
  let app: ReturnType<typeof express>;
  let received: Buffer;
  let receivedId: string | undefined;
  beforeEach(async () => {
    received = Buffer.alloc(0);
    upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received = Buffer.concat(chunks);
      receivedId = req.headers["x-request-id"] as string;
      res.writeHead(400, { "content-type": "application/json" });
      res.end('{"message":"Mock booking validation"}');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );
    const port = (upstream.address() as { port: number }).port;
    const proxy = new ProxyService({} as any, {} as any, {} as any);
    proxy.upstreams.booking = `http://127.0.0.1:${port}`;
    app = express();
    app.use((req, res, next) => void proxy.serve(req, res).catch(next));
  });
  afterEach(async () => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  it("preserves exact webhook bytes and request IDs through a 5 MB request", async () => {
    const body = Buffer.from(
      '{ "unchanged": "' + "x".repeat(5 * 1024 * 1024) + '" }',
    );
    await request(app)
      .post("/bms/integrations/wix/bookings")
      .set("content-type", "application/json")
      .set("x-request-id", "body-test-1")
      .send(body.toString("utf8"))
      .expect(400);
    expect(received.equals(body)).toBe(true);
    expect(receivedId).toBe("body-test-1");
  });
  it("rejects an oversized body without forwarding it", async () => {
    await request(app)
      .post("/bms/integrations/wix/bookings")
      .set("content-type", "application/octet-stream")
      .send(Buffer.alloc(MAX_BODY + 1))
      .expect(413);
    expect(received.length).toBe(0);
  });
});
