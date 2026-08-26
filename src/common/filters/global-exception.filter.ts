import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { normalizeRouteTemplate } from '@nrapp/observability';
import type { RequestContext } from '../interfaces/request-context.interface';
import { StructuredLoggerService } from '../observability/structured-logger.service';

interface ErrorRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  route?: { path?: unknown };
  requestContext?: RequestContext;
}

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: StructuredLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ErrorRequest>();
    const normalized =
      exception instanceof PayloadTooLargeException
        ? new BadRequestException({
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Ảnh không được vượt quá 5MB',
          })
        : exception;
    const result = this.logger.handleHttpException(normalized, {
      requestId: request.requestContext?.requestId,
      method: request.method,
      route: this.routeOf(request),
    });

    this.httpAdapterHost.httpAdapter.reply(
      http.getResponse(),
      result.body,
      result.statusCode,
    );
  }

  private routeOf(request: ErrorRequest): string {
    return typeof request.route?.path === 'string'
      ? normalizeRouteTemplate(`${request.baseUrl ?? ''}${request.route.path}`)
      : 'unmatched';
  }
}
