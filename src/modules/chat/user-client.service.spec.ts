import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AxiosError, type AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import type { StructuredLoggerService } from '../../common/observability/structured-logger.service';
import { UserClientService } from './user-client.service';

describe('Chat UserClientService', () => {
  const httpGet = jest.fn();
  const logInfo = jest.fn();
  const logWarn = jest.fn();
  const httpService = { get: httpGet } as unknown as HttpService;
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'USER_SERVICE') return 'http://user:5000/';
      if (key === 'USER_SERVICE_TIMEOUT_MS') return '1400';
      return undefined;
    }),
  } as unknown as ConfigService;
  const logger = {
    info: logInfo,
    warn: logWarn,
    error: jest.fn(),
  } as unknown as StructuredLoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forward request-id và timeout khi lấy user', async () => {
    httpGet.mockReturnValue(
      of({ status: 200, data: { _id: 'user-id' } } as AxiosResponse),
    );
    const service = new UserClientService(httpService, config, logger);

    await expect(service.getUser('user/id', 'req-chat-1')).resolves.toEqual({
      _id: 'user-id',
    });

    expect(httpGet).toHaveBeenCalledWith(
      'http://user:5000/api/user/internal/user%2Fid',
      {
        headers: { 'x-request-id': 'req-chat-1' },
        timeout: 1400,
      },
    );
    expect(logInfo).toHaveBeenCalledWith(
      'user_service_request_completed',
      expect.objectContaining({
        requestId: 'req-chat-1',
        statusCode: 200,
      }),
    );
  });

  it('map 404 upstream thành NotFoundException', async () => {
    httpGet.mockReturnValue(throwError(() => axiosError(404)));
    const service = new UserClientService(httpService, config, logger);

    await expect(service.getUser('missing', 'req-404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('map 5xx upstream thành 503', async () => {
    httpGet.mockReturnValue(throwError(() => axiosError(500)));
    const service = new UserClientService(httpService, config, logger);

    await expect(service.getUser('user', 'req-500')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('map 4xx bất thường thành 502', async () => {
    httpGet.mockReturnValue(throwError(() => axiosError(401)));
    const service = new UserClientService(httpService, config, logger);

    await expect(service.getUser('user', 'req-401')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('map timeout thành 503 và log request-id', async () => {
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    httpGet.mockReturnValue(throwError(() => timeout));
    const service = new UserClientService(httpService, config, logger);

    await expect(service.getUser('user', 'req-timeout')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(logWarn).toHaveBeenCalledWith(
      'user_service_unavailable',
      expect.objectContaining({
        requestId: 'req-timeout',
        operation: 'get_user',
        errorName: 'AxiosError',
      }),
    );
  });

  function axiosError(status: number): AxiosError {
    return new AxiosError(
      `upstream ${status}`,
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      { status } as AxiosResponse,
    );
  }
});
