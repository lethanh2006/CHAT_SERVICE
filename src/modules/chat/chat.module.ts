import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { MongooseModule } from "@nestjs/mongoose";
import { ChatAuthGuard } from "../../common/guards/chat-auth.guard";
import { Chat, ChatSchema } from "../../schemas/chat.schema";
import { Message, MessageSchema } from "../../schemas/message.schema";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { ChatImageService } from "./chat-image.service";
import { ChatService } from "./chat.service";
import { UserClientService } from "./user-client.service";

@Module({
  imports: [
    HttpModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: Chat.name, schema: ChatSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [ChatController],
  providers: [
    ChatAuthGuard,
    ChatGateway,
    ChatImageService,
    ChatService,
    UserClientService,
  ],
})
export class ChatModule {}
