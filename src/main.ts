import '@nrapp/observability/register';

import dns from 'node:dns';
import {
  logAndRecordException,
  PinoNestLogger,
  shutdownTelemetry,
} from '@nrapp/observability';

dns.setServers(['8.8.8.8', '8.8.4.4']);

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { chatAppLogger } from './common/observability/structured-logger.service';
import { toError } from './common/utils/error.util';

const rootLogger = chatAppLogger;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new PinoNestLogger(rootLogger, 'NestApplication'),
  });

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
  rootLogger.info(
    { 'event.name': 'service.started', 'server.port': port },
    'Chat service started',
  );
}

void bootstrap().catch(async (value: unknown) => {
  const error = toError(value);
  logAndRecordException(
    rootLogger,
    'service.bootstrap.failed',
    error,
    {},
    {
      classification: {
        statusCode: 500,
        code: 'BOOTSTRAP_FAILED',
        expected: false,
        retryable: false,
        logLevel: 'fatal',
        safeMessage: 'Service bootstrap failed',
      },
    },
  );
  await shutdownTelemetry(2_000);
  process.exitCode = 1;
});
