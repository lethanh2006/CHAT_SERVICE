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
import { performance } from 'node:perf_hooks';
import { toError } from '../../common/utils/error.util';
import { StructuredLoggerService } from '../../common/logging/logger';

function isBatchUsersResponse(value: unknown): value is { users: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'users' in value &&
    Array.isArray(value.users)
  );
}

@Injectable()
export class UserClientService {
  private readonly baseUrl?: string;
  private readonly timeoutMs: number;
  private readonly pendingUserBatches = new Map<string, Promise<unknown[]>>();

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

  async getUsers(userIds: string[], requestId?: string): Promise<unknown[]> {
    if (!userIds.length) return [];
    if (!this.baseUrl) {
      this.logger.error('user_service_not_configured', {
        requestId: requestId ?? 'unknown',
        operation: 'get_users',
        statusCode: 503,
      });
      throw new ServiceUnavailableException({
        message: 'Dịch vụ người dùng chưa được cấu hình',
      });
    }

    const key = JSON.stringify(userIds);
    const existing = this.pendingUserBatches.get(key);
    if (existing) return existing;

    const pending = this.loadUsers(userIds, requestId);
    if (this.pendingUserBatches.size < 256) {
      this.pendingUserBatches.set(key, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.pendingUserBatches.get(key) === pending) {
        this.pendingUserBatches.delete(key);
      }
    }
  }

  private async loadUsers(
    userIds: string[],
    requestId?: string,
  ): Promise<unknown[]> {
    const users: unknown[] = [];
    for (let offset = 0; offset < userIds.length; offset += 100) {
      const ids = userIds.slice(offset, offset + 100);
      const started = performance.now();
      try {
        const response = await firstValueFrom(
          this.httpService.post<{ users: unknown[] }>(
            this.baseUrl + '/api/user/internal/public-batch',
            { ids },
            {
              headers: requestId ? { 'x-request-id': requestId } : undefined,
              timeout: this.timeoutMs,
            },
          ),
        );
        const responseData: unknown = response.data;
        if (!isBatchUsersResponse(responseData)) {
          throw new BadGatewayException(
            'Phản hồi danh sách người dùng không hợp lệ',
          );
        }
        users.push(...responseData.users);
        this.logger.info('user_service_request_completed', {
          requestId: requestId ?? 'unknown',
          operation: 'get_users',
          statusCode: response.status,
          userCount: responseData.users.length,
          duration_ms: Math.round((performance.now() - started) * 100) / 100,
        });
      } catch (error: unknown) {
        const statusCode = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        const details = {
          requestId: requestId ?? 'unknown',
          operation: 'get_users',
          upstreamStatusCode: statusCode,
          errorName: toError(error).name,
          duration_ms: Math.round((performance.now() - started) * 100) / 100,
        };

        if (error instanceof BadGatewayException) throw error;
        if (
          statusCode !== undefined &&
          statusCode < 500 &&
          statusCode !== 429
        ) {
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
    return users;
  }

  private parseTimeout(value: string | number | undefined): number {
    const timeoutMs = Number(value ?? 3000);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(Math.trunc(timeoutMs), 60_000)
      : 3000;
  }
}
