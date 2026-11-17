import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<import('@nestjs/platform-express').NestExpressApplication>(AppModule, { rawBody: true, bodyParser: false });
  app.useBodyParser('json', { limit: '10mb' });
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  app.enableCors({ origin: origins });
  await app.listen(Number(process.env.PORT ?? 3023), '0.0.0.0');
}

void bootstrap();
