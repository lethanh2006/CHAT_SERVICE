import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { StructuredLoggerService } from '../../common/observability/structured-logger.service';
import { toError } from '../../common/utils/error.util';

@Injectable()
export class UserClientService {
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
    private readonly logger: StructuredLoggerService,
  ) {
    this.baseUrl = (
      configService.get<string>('USER_SERVICE') ??
      configService.get<string>('USER_SERVICE_URL')
    )?.replace(/\/+$/, '');
    this.timeoutMs = this.parseTimeout(
      configService.get<string | number>('USER_SERVICE_TIMEOUT_MS'),
    );
  }

  async getUser(userId: string, requestId?: string): Promise<unknown> {
    const logRequestId = requestId ?? 'unknown';
    if (!this.baseUrl) {
      this.logger.error('user_service_not_configured', {
        requestId: logRequestId,
        operation: 'get_user',
        statusCode: 503,
      });
      throw new ServiceUnavailableException({
        message: 'Dịch vụ người dùng chưa được cấu hình',
      });
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.baseUrl}/api/user/internal/${encodeURIComponent(userId)}`,
          {
            headers: requestId ? { 'x-request-id': requestId } : undefined,
            timeout: this.timeoutMs,
          },
        ),
      );
      this.logger.info('user_service_request_completed', {
        requestId: logRequestId,
        operation: 'get_user',
        statusCode: response.status,
      });
      return response.data;
    } catch (error: unknown) {
      const statusCode = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const details = {
        requestId: logRequestId,
        operation: 'get_user',
        upstreamStatusCode: statusCode,
        errorName: toError(error).name,
      };

      if (statusCode === 404) {
        this.logger.warn('user_service_user_not_found', details);
        throw new NotFoundException({ message: 'Không tìm thấy người dùng' });
      }
      if (statusCode !== undefined && statusCode < 500 && statusCode !== 429) {
        this.logger.warn('user_service_bad_response', details);
        throw new BadGatewayException({
          message: 'Phản hồi từ dịch vụ người dùng không hợp lệ',
        });
      }

      this.logger.warn('user_service_unavailable', details);
      throw new ServiceUnavailableException({
        message: 'Dịch vụ người dùng tạm thời không khả dụng',
      });
    }
  }

  private parseTimeout(value: string | number | undefined): number {
    const timeoutMs = Number(value ?? 3000);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(Math.trunc(timeoutMs), 60_000)
      : 3000;
  }
}
