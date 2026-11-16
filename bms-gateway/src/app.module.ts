import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BmsAuthModule } from "./auth/bms-auth.module";
import { SessionModule } from "./session/session.module";
import { validateEnv } from "./config/env";
import { ProxyService } from "./proxy.service";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => validateEnv({ ...raw, BMS_SESSION_HOST: "true" }),
    }),
    BmsAuthModule,
    SessionModule,
  ],
  providers: [ProxyService],
})
export class AppModule {}
