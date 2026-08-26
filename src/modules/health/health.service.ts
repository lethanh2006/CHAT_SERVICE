import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConnectionStates, type Connection } from 'mongoose';

export interface ChatHealth {
  status: 'ok';
  service: 'chat';
}

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
  ) {}

  getLiveness(): ChatHealth {
    return { status: 'ok', service: 'chat' };
  }

  getReadiness(): ChatHealth {
    if (this.mongoConnection.readyState !== ConnectionStates.connected) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'chat',
        dependencies: { mongodb: 'down' },
      });
    }
    return { status: 'ok', service: 'chat' };
  }
}
