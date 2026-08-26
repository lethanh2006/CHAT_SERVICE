import { createAppLogger, PinoNestLogger } from '@nrapp/observability';

export const appLogger: ReturnType<typeof createAppLogger> = createAppLogger({
  serviceName: 'chat',
});

export const nestLogger = new PinoNestLogger(appLogger, 'Chat');
