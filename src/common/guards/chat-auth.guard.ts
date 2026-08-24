import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface";
import type { RequestWithContext } from "../interfaces/request-context.interface";
import { GatewaySignatureService } from "../security/gateway-signature.service";

@Injectable()
export class ChatAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly signatureService: GatewaySignatureService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const gatewayPayload = request.headers["x-user-payload"];

    if (typeof gatewayPayload === "string") {
      this.signatureService.assertTrusted({
        context: `${request.method.toUpperCase()}:${request.path}`,
        payload: gatewayPayload,
        requestId: this.headerValue(request.headers["x-request-id"]),
        signature: this.headerValue(request.headers["x-user-signature"]),
        timestamp: this.headerValue(request.headers["x-user-timestamp"]),
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          Buffer.from(gatewayPayload, "base64").toString("utf8"),
        );
      } catch {
        throw new UnauthorizedException({ message: "Unauthorized" });
      }

      if (!this.isAuthenticatedUser(parsed)) {
        throw new UnauthorizedException({
          message: "Payload người dùng không hợp lệ",
        });
      }
      request.user = parsed;
      return true;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException({ message: "Unauthorized" });
    }

    try {
      const decoded = this.jwtService.verify<Record<string, unknown>>(
        authHeader.slice(7),
        { secret: this.configService.get<string>("JWT_SECRET") },
      );
      const candidate = this.asRecord(decoded.user) ?? decoded;
      if (!this.isAuthenticatedUser(candidate)) {
        throw new UnauthorizedException({
          message: "Token payload không hợp lệ",
        });
      }
      const userWithoutPassword = { ...candidate };
      delete userWithoutPassword.password;
      request.user = userWithoutPassword;
      return true;
    } catch (error: unknown) {
      if (
        error instanceof UnauthorizedException &&
        error.getResponse() instanceof Object &&
        (error.getResponse() as { message?: string }).message ===
          "Token payload không hợp lệ"
      ) {
        throw error;
      }
      throw new UnauthorizedException({ message: "Unauthorized" });
    }
  }

  private isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
    const record = this.asRecord(value);
    return typeof record?._id === "string" && record._id.length > 0;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private headerValue(
    value: string | string[] | undefined,
  ): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}
