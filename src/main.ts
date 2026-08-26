import '@nrapp/observability/register';

import dns from 'node:dns';
import {
  flushLoggerAndShutdownTelemetry,
  logAndRecordException,
} from '@nrapp/observability';

dns.setServers(['8.8.8.8', '8.8.4.4']);

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { appLogger, nestLogger } from './common/observability/app-logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: nestLogger });

  app.enableShutdownHooks();
  app.enableCors({
    origin: '*',
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 5002);
  await app.listen(port, '0.0.0.0');
  appLogger.info(
    { 'event.name': 'service.started', 'server.port': port },
    'Chat service started',
  );
}

void bootstrap().catch(async (error: unknown) => {
  logAndRecordException(
    appLogger,
    'process.bootstrap.failed',
    error,
    {},
    {
      message: 'Không thể khởi động dịch vụ trò chuyện',
      classification: {
        statusCode: 500,
        code: 'BOOTSTRAP_FAILED',
        expected: false,
        retryable: false,
        logLevel: 'fatal',
      },
    },
  );
  await flushLoggerAndShutdownTelemetry(appLogger, 3_000);
  process.exitCode = 1;
});
