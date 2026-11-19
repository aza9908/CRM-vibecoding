import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/redis-io.adapter';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

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
  // No framework banner; basic hardening headers on every API response.
  app.disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  // Catch-all filter: turns unexpected errors into a clean, logged 500 instead
  // of leaking stacks (and makes storage/config faults return a real message).
  app.useGlobalFilters(new AllExceptionsFilter());

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
