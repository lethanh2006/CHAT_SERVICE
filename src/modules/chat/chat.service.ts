import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import axios from "axios";
import { Types, type Model } from "mongoose";
import type { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";
import { StructuredLoggerService } from "../../common/observability/structured-logger.service";
import { Chat } from "../../schemas/chat.schema";
import { Message, type MessageDocument } from "../../schemas/message.schema";
import { ChatGateway } from "./chat.gateway";
import { ChatImageService, type UploadedImage } from "./chat-image.service";
import type { CreateChatDto } from "./dto/create-chat.dto";
import type { SendMessageDto } from "./dto/send-message.dto";
import { UserClientService } from "./user-client.service";

export interface CreateChatResult {
  statusCode: 200 | 201;
  body: {
    message: string;
    chatId: Types.ObjectId;
  };
}

@Injectable()
export class ChatService {
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
        message: "Cần cung cấp otherUserId ",
      });
    }
    if (otherUserId.toString() === userId?.toString()) {
      throw new BadRequestException({
        message: "Không thể tạo cuộc trò chuyện với chính mình",
      });
    }
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(otherUserId)
    ) {
      throw new BadRequestException({
        message: "ID người dùng không hợp lệ",
      });
    }

    try {
      await this.userClient.getUser(otherUserId, requestId);
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new NotFoundException({
          message: "Không tìm thấy người dùng để tạo cuộc trò chuyện",
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
          message: "Cuộc trò chuyện đã tồn tại",
          chatId: existingChat._id,
        },
      };
    }

    const chat = await this.chatModel.create({
      users: [userId, otherUserId],
    });
    return {
      statusCode: 201,
      body: {
        message: "Tạo cuộc trò chuyện mới thành công",
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
        message: "Cần cung cấp ID người dùng",
      });
    }

    const chats = await this.chatModel
      .find({ users: userId })
      .sort({ updatedAt: -1 })
      .exec();
    const chatWithUserData = await Promise.all(
      chats.map(async (chat) => {
        const otherUserId = chat.users.find(
          (id) => id.toString() !== userId.toString(),
        );
        const unseenCount = await this.messageModel.countDocuments({
          chatId: chat._id,
          sender: { $ne: userId },
          seen: false,
        });

        try {
          const otherUser = await this.userClient.getUser(
            String(otherUserId),
            requestId,
          );
          return {
            user: otherUser,
            chat: {
              ...chat.toObject(),
              latestMessage: chat.latestMessage || null,
              unseenCount,
            },
          };
        } catch (error: unknown) {
          this.logUserLookupFailure(
            "chat_user_lookup_failed",
            String(otherUserId),
            error,
            requestId,
          );
          return {
            user: { _id: otherUserId, name: "Unknown User" },
            chat: {
              ...chat.toObject(),
              latestMessage: chat.latestMessage || null,
              unseenCount,
            },
          };
        }
      }),
    );

    return { chats: chatWithUserData };
  }

  async sendMessage(
    dto: SendMessageDto,
    imageFile: Express.Multer.File | undefined,
    user: AuthenticatedUser,
  ): Promise<{ message: MessageDocument; sender: string }> {
    const senderId = user?._id;
    const { chatId, text } = dto;

    if (!senderId) {
      throw new UnauthorizedException({ message: "Không có quyền truy cập" });
    }
    if (!chatId) {
      throw new BadRequestException({
        message: "Cần cung cấp chatId (ID cuộc trò chuyện)",
      });
    }
    if (!Types.ObjectId.isValid(chatId)) {
      throw new BadRequestException({ message: "chatId không hợp lệ" });
    }
    if (!text && !imageFile) {
      throw new BadRequestException({
        message: "Cần có văn bản hoặc hình ảnh để gửi tin nhắn",
      });
    }

    const chat = await this.chatModel.findById(chatId).exec();
    if (!chat) {
      throw new NotFoundException({
        message: "Không tìm thấy cuộc trò chuyện",
      });
    }
    const isUserInChat = chat.users.some(
      (memberId) => memberId.toString() === senderId.toString(),
    );
    if (!isUserInChat) {
      throw new ForbiddenException({
        message: "Bạn không tham gia vào cuộc trò chuyện này",
      });
    }
    const otherUserId = chat.users.find(
      (memberId) => memberId.toString() !== senderId.toString(),
    );
    if (!otherUserId) {
      throw new UnauthorizedException({
        message: "Không tìm thấy người dùng khác",
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
              messageType: "image",
              text: text || "",
            }
          : {
              text,
              messageType: "text",
            }),
      });

      await this.chatModel.findByIdAndUpdate(
        chatId,
        {
          latestMessage: {
            text: uploadedImage ? "Sent an image" : text,
            sender: senderId,
          },
          updatedAt: new Date(),
        },
        { new: true },
      );
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
      throw new UnauthorizedException({ message: "Không có quyền truy cập" });
    }
    if (!chatId) {
      throw new BadRequestException({
        message: "Cần cung cấp chatId (ID cuộc trò chuyện)",
      });
    }
    if (!Types.ObjectId.isValid(chatId)) {
      throw new BadRequestException({ message: "chatId không hợp lệ" });
    }

    const chat = await this.chatModel.findById(chatId).exec();
    if (!chat) {
      throw new NotFoundException({
        message: "Không tìm thấy cuộc trò chuyện",
      });
    }
    const isUserInChat = chat.users.some(
      (memberId) => memberId.toString() === userId.toString(),
    );
    if (!isUserInChat) {
      throw new ForbiddenException({
        message: "Bạn không tham gia vào cuộc trò chuyện này",
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
          message: "Không tìm thấy người dùng khác",
        });
      }
      return { messages, user: otherUser };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      this.logUserLookupFailure(
        "conversation_user_lookup_failed",
        String(otherUserId),
        error,
        requestId,
        chatId,
      );
      return {
        messages,
        user: { _id: otherUserId, name: "unknown User" },
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
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      this.logger.error("message_rollback_failed", {
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
      status: axios.isAxiosError(error) ? error.response?.status : undefined,
      message: axios.isAxiosError(error) ? error.message : String(error),
    });
  }
}
