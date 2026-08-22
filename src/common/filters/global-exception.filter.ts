import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { RequestContext } from "../interfaces/request-context.interface";
import { StructuredLoggerService } from "../observability/structured-logger.service";
import { toError } from "../utils/error.util";

interface ErrorRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  user?: { _id?: string };
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
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<ErrorRequest>();
    const error = toError(exception);
    const uploadTooLarge = exception instanceof PayloadTooLargeException;
    const statusCode = uploadTooLarge
      ? HttpStatus.BAD_REQUEST
      : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.requestContext?.requestId;

    const logDetails = {
      requestId,
      userId: request.user?._id,
      statusCode,
      method: request.method,
      path: request.originalUrl ?? request.url,
      errorName: error.name,
      message: error.message,
      durationMs: request.requestContext
        ? Number(process.hrtime.bigint() - request.requestContext.startedAt) /
          1e6
        : undefined,
    };
    if (statusCode >= 500) {
      this.logger.error("http_request_failed", logDetails, error.stack);
    } else {
      this.logger.warn("http_request_rejected", logDetails);
    }

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const responseBody = uploadTooLarge
      ? { message: "Ảnh không được vượt quá 5MB", requestId }
      : exceptionResponse !== null &&
          typeof exceptionResponse === "object" &&
          !Array.isArray(exceptionResponse)
        ? { ...(exceptionResponse as Record<string, unknown>), requestId }
        : {
            message:
              exceptionResponse ?? error.message ?? "Internal Server Error",
            requestId,
          };

    this.httpAdapterHost.httpAdapter.reply(
      httpContext.getResponse(),
      responseBody,
      statusCode,
    );
  }
}
