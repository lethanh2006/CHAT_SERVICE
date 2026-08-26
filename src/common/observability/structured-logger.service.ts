import { Injectable } from '@nestjs/common';
import {
  createAppLogger,
  handleOriginHttpException,
  type HttpBoundaryContext,
  type HttpBoundaryResult,
} from '@nrapp/observability';

export type LogDetails = Record<string, unknown>;

export const chatAppLogger: ReturnType<typeof createAppLogger> =
  createAppLogger({ serviceName: 'chat' });

@Injectable()
export class StructuredLoggerService {
  private readonly logger = chatAppLogger;

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
