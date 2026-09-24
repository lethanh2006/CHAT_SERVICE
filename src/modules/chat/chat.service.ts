import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { performance } from 'node:perf_hooks';
import { toError } from '../../common/utils/error.util';
import { StructuredLoggerService } from '../../common/logging/logger';
import type { AuthenticatedUser } from '../../common/interfaces/request-context.interface';
import { Chat } from '../../schemas/chat.schema';
import { Message, type MessageDocument } from '../../schemas/message.schema';
import { ChatGateway } from './chat.gateway';
import { ChatImageService, type UploadedImage } from './chat-image.service';
import type { CreateChatDto } from './dto/create-chat.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import { UserClientService } from './user-client.service';

export interface CreateChatResult {
  statusCode: 200 | 201;
  body: {
    message: string;
    chatId: Types.ObjectId;
  };
}

const CHAT_LIST_CACHE_TTL_MS = 5_000;

@Injectable()
export class ChatService {
  private readonly chatListCache = new Map<
    string,
    { expiresAt: number; value: { chats: unknown[] } }
  >();
  private readonly pendingChatListReads = new Map<
    string,
    Promise<{ chats: unknown[] }>
  >();
  private chatListGeneration = 0;

  constructor(
    @InjectModel(Chat.name) private readonly chatModel: Model<Chat>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    private readonly userClient: UserClientService,
    private readonly imageService: ChatImageService,
    private readonly chatGateway: ChatGateway,
    private readonly logger: StructuredLoggerService,
  ) {}

  async createChat(
    dto: CreateChatDto,
    user: AuthenticatedUser,
    requestId?: string,
  ): Promise<CreateChatResult> {
    const userId = user?._id;
    const otherUserId = dto.otherUserId;

    if (!otherUserId) {
      throw new BadRequestException({
        message: 'Cần cung cấp otherUserId ',
      });
    }
    if (otherUserId.toString() === userId?.toString()) {
      throw new BadRequestException({
        message: 'Không thể tạo cuộc trò chuyện với chính mình',
      });
    }
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(otherUserId)
    ) {
      throw new BadRequestException({
        message: 'ID người dùng không hợp lệ',
      });
    }

    try {
      await this.userClient.getUser(otherUserId, requestId);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException({
          message: 'Không tìm thấy người dùng để tạo cuộc trò chuyện',
        });
      }
      throw error;
    }

    const existingChat = await this.chatModel
      .findOne({ users: { $all: [userId, otherUserId], $size: 2 } })
      .exec();
    if (existingChat) {
      return {
        statusCode: 200,
        body: {
          message: 'Cuộc trò chuyện đã tồn tại',
          chatId: existingChat._id,
        },
      };
    }

    const chat = await this.chatModel.create({
      users: [userId, otherUserId],
    });
    this.invalidateChatLists();
    return {
      statusCode: 201,
      body: {
        message: 'Tạo cuộc trò chuyện mới thành công',
        chatId: chat._id,
      },
    };
  }

  async getAllChats(
    user: AuthenticatedUser,
    requestId?: string,
  ): Promise<{ chats: unknown[] }> {
    const userId = user?._id;
    if (!userId) {
      throw new BadRequestException({
        message: 'Cần cung cấp ID người dùng',
      });
    }

    const key = userId.toString();
    const generation = this.chatListGeneration;
    const cacheKey = `${generation}:${key}`;
    const cached = this.chatListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.chatListCache.delete(cacheKey);

    const pending = this.pendingChatListReads.get(cacheKey);
    if (pending) return pending;
    if (this.pendingChatListReads.size >= 128) {
      return this.loadAllChats(key, requestId);
    }

    const read = this.loadAllChats(key, requestId);
    this.pendingChatListReads.set(cacheKey, read);
    try {
      const value = await read;
      if (generation === this.chatListGeneration) {
        this.rememberChatList(cacheKey, value);
      }
      return value;
    } finally {
      if (this.pendingChatListReads.get(cacheKey) === read) {
        this.pendingChatListReads.delete(cacheKey);
      }
    }
  }

  private rememberChatList(key: string, value: { chats: unknown[] }): void {
    if (this.chatListCache.size >= 256) {
      const oldestKey: string | undefined = Array.from(
        this.chatListCache.keys(),
      )[0];
      if (oldestKey !== undefined) this.chatListCache.delete(oldestKey);
    }
    this.chatListCache.set(key, {
      expiresAt: Date.now() + CHAT_LIST_CACHE_TTL_MS,
      value,
    });
  }

  private invalidateChatLists(): void {
    // A single service replica can invalidate synchronously; TTL bounds any external write lag.
    this.chatListGeneration += 1;
    this.chatListCache.clear();
  }

  private async loadAllChats(
    userId: string,
    requestId?: string,
  ): Promise<{ chats: unknown[] }> {
    const started = performance.now();
    const findStarted = performance.now();
    const chats = await this.chatModel
      .find({ users: userId })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    const findMs = performance.now() - findStarted;
    if (chats.length === 0) {
      this.logChatListPerformance(requestId, 0, findMs, 0, 0, started);
      return { chats: [] };
    }

    const otherUserIds = [
      ...new Set(
        chats
          .map((chat) =>
            chat.users.find((id) => id.toString() !== userId.toString()),
          )
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const [unseenResult, userResult] = await Promise.all([
      this.timeStage(() =>
        this.messageModel
          .aggregate<{ _id: Types.ObjectId; count: number }>([
            {
              $match: {
                chatId: { $in: chats.map((chat) => chat._id) },
                sender: { $ne: userId },
                seen: false,
              },
            },
            { $group: { _id: '$chatId', count: { $sum: 1 } } },
          ])
          .exec(),
      ),
      this.timeStage(() =>
        this.userClient
          .getUsers(otherUserIds, requestId)
          .catch((error: unknown) => {
            return { error };
          }),
      ),
    ]);
    const unseenCounts = unseenResult.value;
    const directoryUsers = userResult.value;

    const unseenCountByChatId = new Map(
      unseenCounts.map((row) => [String(row._id), row.count]),
    );
    const lookupError = Array.isArray(directoryUsers)
      ? undefined
      : directoryUsers.error;
    const usersById = new Map<string, Record<string, unknown>>();
    if (Array.isArray(directoryUsers)) {
      for (const value of directoryUsers) {
        if (typeof value === 'object' && value !== null && '_id' in value) {
          const directoryUser = value as Record<string, unknown>;
          usersById.set(String(directoryUser._id), directoryUser);
        }
      }
    }

    const chatWithUserData = chats.map((chat) => {
      const otherUserId = chat.users.find(
        (id) => id.toString() !== userId.toString(),
      );
      const otherUserKey = String(otherUserId);
      const directoryUser = usersById.get(otherUserKey);
      let user: unknown;
      if (directoryUser) {
        // Preserve the existing { user: { user: ... } } response shape.
        user = { user: directoryUser };
      } else {
        this.logUserLookupFailure(
          'chat_user_lookup_failed',
          otherUserKey,
          lookupError ?? new NotFoundException('Không tìm thấy người dùng'),
          requestId,
        );
        user = { _id: otherUserId, name: 'Unknown User' };
      }

      return {
        user,
        chat: {
          ...chat,
          latestMessage: chat.latestMessage || null,
          unseenCount: unseenCountByChatId.get(String(chat._id)) ?? 0,
        },
      };
    });

    this.logChatListPerformance(
      requestId,
      chats.length,
      findMs,
      unseenResult.durationMs,
      userResult.durationMs,
      started,
    );
    return { chats: chatWithUserData };
  }

  private async timeStage<T>(
    operation: () => Promise<T>,
  ): Promise<{ value: T; durationMs: number }> {
    const started = performance.now();
    const value = await operation();
    return { value, durationMs: performance.now() - started };
  }

  private logChatListPerformance(
    requestId: string | undefined,
    chatCount: number,
    findMs: number,
    unseenAggregateMs: number,
    userBatchMs: number,
    started: number,
  ): void {
    const totalMs = performance.now() - started;
    const logMinMs = Number(process.env.CHAT_LIST_PERF_LOG_MIN_MS || 0);
    if (logMinMs <= 0 || totalMs < logMinMs) return;
    this.logger.info('chat_list.perf', {
      request_id: requestId,
      chat_count: chatCount,
      find_ms: Math.round(findMs * 100) / 100,
      unseen_aggregate_ms: Math.round(unseenAggregateMs * 100) / 100,
      user_batch_ms: Math.round(userBatchMs * 100) / 100,
      total_ms: Math.round(totalMs * 100) / 100,
    });
  }

  async sendMessage(
    dto: SendMessageDto,
    imageFile: Express.Multer.File | undefined,
    user: AuthenticatedUser,
  ): Promise<{ message: MessageDocument; sender: string }> {
    const senderId = user?._id;
    const { chatId, text } = dto;

    if (!senderId) {
      throw new UnauthorizedException({ message: 'Không có quyền truy cập' });
    }
    if (!chatId) {
      throw new BadRequestException({
        message: 'Cần cung cấp chatId (ID cuộc trò chuyện)',
      });
    }
    if (!Types.ObjectId.isValid(chatId)) {
      throw new BadRequestException({ message: 'chatId không hợp lệ' });
    }
    if (!text && !imageFile) {
      throw new BadRequestException({
        message: 'Cần có văn bản hoặc hình ảnh để gửi tin nhắn',
      });
    }

    const chat = await this.chatModel.findById(chatId).exec();
    if (!chat) {
      throw new NotFoundException({
        message: 'Không tìm thấy cuộc trò chuyện',
      });
    }
    const isUserInChat = chat.users.some(
      (memberId) => memberId.toString() === senderId.toString(),
    );
    if (!isUserInChat) {
      throw new ForbiddenException({
        message: 'Bạn không tham gia vào cuộc trò chuyện này',
      });
    }
    const otherUserId = chat.users.find(
      (memberId) => memberId.toString() !== senderId.toString(),
    );
    if (!otherUserId) {
      throw new UnauthorizedException({
        message: 'Không tìm thấy người dùng khác',
      });
    }

    let uploadedImage: UploadedImage | undefined;
    let savedMessage: MessageDocument | undefined;
    try {
      if (imageFile) {
        uploadedImage = await this.imageService.upload(imageFile.buffer);
      }

      savedMessage = await this.messageModel.create({
        chatId,
        sender: senderId,
        seen: false,
        ...(uploadedImage
          ? {
              image: uploadedImage,
              messageType: 'image',
              text: text || '',
            }
          : {
              text,
              messageType: 'text',
            }),
      });

      await this.chatModel.findByIdAndUpdate(
        chatId,
        {
          latestMessage: {
            text: uploadedImage ? 'Sent an image' : text,
            sender: senderId,
          },
          updatedAt: new Date(),
        },
        { new: true },
      );
      this.invalidateChatLists();
    } catch (error: unknown) {
      await this.rollbackFailedMessage(savedMessage, uploadedImage);
      throw error;
    }

    this.chatGateway.emitNewMessage(
      otherUserId.toString(),
      savedMessage.toObject(),
    );
    return { message: savedMessage, sender: senderId };
  }

  async getMessages(
    chatId: string,
    user: AuthenticatedUser,
    requestId?: string,
  ): Promise<{ messages: MessageDocument[]; user: unknown }> {
    const userId = user?._id;
    if (!userId) {
      throw new UnauthorizedException({ message: 'Không có quyền truy cập' });
    }
    if (!chatId) {
      throw new BadRequestException({
        message: 'Cần cung cấp chatId (ID cuộc trò chuyện)',
      });
    }
    if (!Types.ObjectId.isValid(chatId)) {
      throw new BadRequestException({ message: 'chatId không hợp lệ' });
    }

    const chat = await this.chatModel.findById(chatId).exec();
    if (!chat) {
      throw new NotFoundException({
        message: 'Không tìm thấy cuộc trò chuyện',
      });
    }
    const isUserInChat = chat.users.some(
      (memberId) => memberId.toString() === userId.toString(),
    );
    if (!isUserInChat) {
      throw new ForbiddenException({
        message: 'Bạn không tham gia vào cuộc trò chuyện này',
      });
    }

    const messagesToMarkSeen = await this.messageModel
      .find({
        chatId,
        sender: { $ne: userId },
        seen: false,
      })
      .exec();
    await this.messageModel.updateMany(
      {
        chatId,
        sender: { $ne: userId },
        seen: false,
      },
      { seen: true, seenAt: new Date() },
    );
    this.invalidateChatLists();
    const messages = await this.messageModel
      .find({ chatId })
      .sort({ createdAt: 1 })
      .exec();

    const senderIds = new Set(
      messagesToMarkSeen.map((message) => message.sender),
    );
    senderIds.forEach((senderId) => {
      this.chatGateway.emitMessagesSeen(senderId, chatId, userId);
    });

    const otherUserId = chat.users.find(
      (id) => id.toString() !== userId.toString(),
    );
    try {
      const otherUser = await this.userClient.getUser(
        String(otherUserId),
        requestId,
      );
      if (!otherUserId) {
        throw new BadRequestException({
          message: 'Không tìm thấy người dùng khác',
        });
      }
      return { messages, user: otherUser };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logUserLookupFailure(
        'conversation_user_lookup_failed',
        String(otherUserId),
        error,
        requestId,
        chatId,
      );
      return {
        messages,
        user: { _id: otherUserId, name: 'unknown User' },
      };
    }
  }

  private async rollbackFailedMessage(
    savedMessage: MessageDocument | undefined,
    uploadedImage: UploadedImage | undefined,
  ): Promise<void> {
    const cleanup: Promise<unknown>[] = [];
    if (savedMessage) {
      cleanup.push(this.messageModel.deleteOne({ _id: savedMessage._id }));
    }
    if (uploadedImage) {
      cleanup.push(this.imageService.remove(uploadedImage.publicId));
    }
    const results = await Promise.allSettled(cleanup);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      this.logger.error('message_rollback_failed', {
        messageId: savedMessage?._id?.toString(),
        imagePublicId: uploadedImage?.publicId,
        failureCount: failures.length,
      });
    }
  }

  private logUserLookupFailure(
    event: string,
    userId: string,
    error: unknown,
    requestId?: string,
    chatId?: string,
  ): void {
    this.logger.warn(event, {
      requestId,
      chatId,
      userId,
      statusCode: error instanceof HttpException ? error.getStatus() : 502,
      errorName: toError(error).name,
    });
  }
}
