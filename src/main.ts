import dns from "node:dns";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { toError } from "./common/utils/error.util";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  app.enableCors({
    origin: "*",
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT", 5002);
  await app.listen(port, "0.0.0.0");
  new Logger("Bootstrap").log(
    `Chat Service NestJS is running on: http://localhost:${port}`,
  );
}

void bootstrap().catch((value: unknown) => {
  const error = toError(value);
  new Logger("Bootstrap").error(
    `Không thể khởi động dịch vụ chat: ${error.message}`,
    error.stack,
  );
  process.exitCode = 1;
});
