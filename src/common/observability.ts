import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  createAppLogger,
  flushLoggerAndShutdownTelemetry,
  handleOriginHttpException,
  type HttpBoundaryContext,
  type HttpBoundaryResult,
  PinoNestLogger,
} from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'chat',
});

export const nestLogger = new PinoNestLogger(appLogger, 'Chat');

export type LogDetails = Record<string, unknown>;

@Injectable()
export class StructuredLoggerService {
  private readonly logger = appLogger;

  info(event: string, details: LogDetails = {}): void {
    this.logger.info({ ...details, 'event.name': event }, event);
  }

  warn(event: string, details: LogDetails = {}): void {
    this.logger.warn({ ...details, 'event.name': event }, event);
  }

  error(event: string, details: LogDetails = {}, stack?: string): void {
    this.logger.error(
      {
        ...details,
        'event.name': event,
        ...(stack ? { 'exception.stacktrace': stack } : {}),
      },
      event,
    );
  }

  handleHttpException(
    exception: unknown,
    context: HttpBoundaryContext,
  ): HttpBoundaryResult {
    return handleOriginHttpException(this.logger, exception, context);
  }
}

@Injectable()
export class TelemetryLifecycleService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await flushLoggerAndShutdownTelemetry(appLogger, 3_000);
  }
}
