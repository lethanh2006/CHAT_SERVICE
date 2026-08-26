import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { GatewaySignatureService } from './gateway-signature.service';

describe('GatewaySignatureService', () => {
  const secret = '0123456789abcdef0123456789abcdef';

  it('ràng buộc chữ ký với method/path và chặn phát lại', () => {
    const service = new GatewaySignatureService(
      new ConfigService({ CHAT_INTERNAL_SECRET: secret }),
    );
    const timestamp = Date.now().toString();
    const context = 'POST:/api/chat/message';
    const payload = 'encoded-user';
    const requestId = 'request-123';
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${requestId}.${payload}.${context}`)
      .digest('hex');
    const headers = { context, payload, requestId, signature, timestamp };

    expect(() => service.assertTrusted(headers)).not.toThrow();
    expect(() => service.assertTrusted(headers)).toThrow('đã được sử dụng');
  });

  it('từ chối chữ ký bị sửa', () => {
    const service = new GatewaySignatureService(
      new ConfigService({ CHAT_INTERNAL_SECRET: secret }),
    );

    expect(() =>
      service.assertTrusted({
        context: 'GET:/api/chat/chat/all',
        payload: 'encoded-user',
        requestId: 'request-123',
        signature: '0'.repeat(64),
        timestamp: Date.now().toString(),
      }),
    ).toThrow('Chữ ký Gateway không hợp lệ');
  });
});
