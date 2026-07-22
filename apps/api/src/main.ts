import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get(ConfigService);
  const port = Number(config.get<string>('PORT') ?? 3001);
  // WEB_ORIGIN supports a comma-separated list, e.g. custom domain + hosted.app URL.
  const webOrigin = (config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

  // Validation is zod-based: each handler binds a ZodValidationPipe with the
  // shared schema from @lms/shared (the single source of truth). No global
  // class-validator pipe is needed.

  app.use(cookieParser());

  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  // Socket.IO with the Redis adapter so room broadcasts work across instances.
  const wsAdapter = new RedisIoAdapter(app, webOrigin);
  await wsAdapter.connectToRedis(redisUrl);
  app.useWebSocketAdapter(wsAdapter);

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
