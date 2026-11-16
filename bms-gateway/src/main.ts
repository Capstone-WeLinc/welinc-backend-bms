import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { json } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { ProxyService } from "./proxy.service";

export async function createApplication() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.use(cookieParser());
  app.use((req: any, res: any, next: any) => {
    const id = String(req.headers["x-request-id"] ?? "");
    res.setHeader(
      "X-Request-Id",
      /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : randomUUID(),
    );
    next();
  });
  const proxy = app.get(ProxyService);
  app.use((req: any, res: any, next: any) => {
    if (/^\/bms\/session(?:\/|$)/.test(req.originalUrl)) return next();
    void proxy.serve(req, res).catch((error: any) => {
      if (res.headersSent) return res.destroy();
      const status =
        typeof error.getStatus === "function" ? error.getStatus() : 503;
      const response =
        typeof error.getResponse === "function"
          ? error.getResponse()
          : { code: "UPSTREAM_UNAVAILABLE", message: "BMS unavailable" };
      res
        .status(status)
        .json(typeof response === "string" ? { message: response } : response);
    });
  });
  app.use(json({ limit: "10mb" }));
  return app;
}
if (require.main === module)
  void createApplication().then((app) =>
    app.listen(Number(process.env.PORT ?? 3020), "0.0.0.0"),
  );
