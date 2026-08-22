import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { ChatAuthGuard } from "../../common/guards/chat-auth.guard";
import type { RequestWithContext } from "../../common/interfaces/request-context.interface";
import { ChatService } from "./chat.service";
import { CreateChatDto } from "./dto/create-chat.dto";
import { SendMessageDto } from "./dto/send-message.dto";

@Controller("api/chat")
@UseGuards(ChatAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("chat/new")
  async createChat(
    @Body() dto: CreateChatDto,
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.chatService.createChat(
      dto,
      request.user!,
      request.requestContext?.requestId,
    );
    response.status(result.statusCode);
    return result.body;
  }

  @Get("chat/all")
  getAllChats(@Req() request: RequestWithContext) {
    return this.chatService.getAllChats(
      request.user!,
      request.requestContext?.requestId,
    );
  }

  @Post("message")
  @UseInterceptors(
    FileInterceptor("image", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        if (file.mimetype.startsWith("image/")) {
          callback(null, true);
          return;
        }
        callback(
          new BadRequestException({
            message: "Only image files are allowed!",
          }),
          false,
        );
      },
    }),
  )
  sendMessage(
    @Body() dto: SendMessageDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Req() request: RequestWithContext,
  ) {
    return this.chatService.sendMessage(dto, image, request.user!);
  }

  @Get("message/:chatId")
  getMessages(
    @Param("chatId") chatId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.chatService.getMessages(
      chatId,
      request.user!,
      request.requestContext?.requestId,
    );
  }
}
