import { HttpService } from "@nestjs/axios";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";

@Injectable()
export class UserClientService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getUser(userId: string, requestId?: string): Promise<unknown> {
    const baseUrl =
      this.configService.get<string>("USER_SERVICE") ??
      this.configService.get<string>("USER_SERVICE_URL");
    if (!baseUrl) throw new Error("USER_SERVICE is not configured");

    const response = await firstValueFrom(
      this.httpService.get(
        `${baseUrl.replace(/\/$/, "")}/api/user/internal/${encodeURIComponent(userId)}`,
        {
          headers: requestId ? { "x-request-id": requestId } : undefined,
        },
      ),
    );
    return response.data;
  }
}
