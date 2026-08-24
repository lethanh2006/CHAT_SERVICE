import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { withMessageSpan } from "@nrapp/observability";
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { StructuredLoggerService } from "../../common/observability/structured-logger.service";

interface TypingPayload {
  chatId?: unknown;
  targetUserId?: unknown;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server: Server;

  private readonly userSocketMap = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly logger: StructuredLoggerService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      try {
        const token: unknown = socket.handshake.auth?.token;
        const secret = this.configService.get<string>("JWT_SECRET");
        if (typeof token !== "string" || !secret) {
          this.logger.info("socket_handshake_rejected", {
            reason: "missing_credentials",
          });
          next(new Error("Unauthorized"));
          return;
        }

        const decoded = this.jwtService.verify<Record<string, unknown>>(token, {
          secret,
        });
        const nestedUser = this.asRecord(decoded.user);
        const candidate = nestedUser ?? decoded;
        const userId = candidate._id ?? candidate.userId ?? candidate.id;
        if (typeof userId !== "string" || userId.length === 0) {
          this.logger.info("socket_handshake_rejected", {
            reason: "invalid_identity",
          });
          next(new Error("Unauthorized"));
          return;
        }
        (socket.data as Record<string, unknown>).userId = userId;
        next();
      } catch {
        this.logger.info("socket_handshake_rejected", {
          reason: "invalid_token",
        });
        next(new Error("Unauthorized"));
      }
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    await this.withSocketEventSpan("connect", async () => {
      const userId = this.getSocketUserId(socket);
      if (!userId) return;
      const sockets = this.userSocketMap.get(userId) ?? new Set<string>();
      sockets.add(socket.id);
      this.userSocketMap.set(userId, sockets);
      this.emitOnlineUsers();
      this.logger.info("socket_connected", { "user.id": userId });
    });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    await this.withSocketEventSpan("disconnect", async () => {
      const userId = this.getSocketUserId(socket);
      if (userId) {
        const sockets = this.userSocketMap.get(userId);
        sockets?.delete(socket.id);
        if (!sockets?.size) this.userSocketMap.delete(userId);
        this.emitOnlineUsers();
      }
      this.logger.info("socket_disconnected", {
        ...(userId ? { "user.id": userId } : {}),
      });
    });
  }

  @SubscribeMessage("typing")
  async handleTyping(socket: Socket, payload: TypingPayload = {}): Promise<void> {
    await this.withSocketEventSpan("typing", async () => {
      const { chatId, targetUserId } = payload;
      if (typeof chatId !== "string" || typeof targetUserId !== "string") {
        return;
      }

      const receiverSocketIds = this.getReceiverSocketIds(targetUserId);
      const senderUserId = this.getSocketUserId(socket);
      if (receiverSocketIds.length && senderUserId) {
        this.server
          .to(receiverSocketIds)
          .emit("userTyping", { chatId, userId: senderUserId });
      }
    });
  }

  @SubscribeMessage("typingStop")
  async handleTypingStop(
    _socket: Socket,
    payload: TypingPayload = {},
  ): Promise<void> {
    await this.withSocketEventSpan("typingStop", async () => {
      const { chatId, targetUserId } = payload;
      if (typeof chatId !== "string" || typeof targetUserId !== "string") {
        return;
      }

      const receiverSocketIds = this.getReceiverSocketIds(targetUserId);
      if (receiverSocketIds.length) {
        this.server.to(receiverSocketIds).emit("userTypingStop", { chatId });
      }
    });
  }

  emitNewMessage(userId: string, message: unknown): void {
    const receiverSocketIds = this.getReceiverSocketIds(userId);
    if (receiverSocketIds.length) {
      this.server.to(receiverSocketIds).emit("newMessage", { message });
    }
  }

  emitMessagesSeen(senderId: string, chatId: string, seenBy: string): void {
    const socketIds = this.getReceiverSocketIds(senderId);
    if (socketIds.length) {
      this.server.to(socketIds).emit("messagesSeen", { chatId, seenBy });
    }
  }

  getReceiverSocketIds(userId: string): string[] {
    return Array.from(this.userSocketMap.get(userId) ?? []);
  }

  private emitOnlineUsers(): void {
    this.server.emit("getOnlineUsers", Array.from(this.userSocketMap.keys()));
  }

  private getSocketUserId(socket: Socket): string | undefined {
    const userId = (socket.data as Record<string, unknown>).userId;
    return typeof userId === "string" ? userId : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private async withSocketEventSpan(
    eventName: string,
    callback: () => Promise<void>,
  ): Promise<void> {
    await withMessageSpan(`socket.io ${eventName}`, {}, callback, {
      attributes: {
        "messaging.system": "socket.io",
        "messaging.operation.name": eventName,
      },
    });
  }
}
