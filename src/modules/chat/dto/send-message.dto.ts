import { IsOptional, IsString } from "class-validator";

export class SendMessageDto {
  @IsOptional()
  @IsString()
  chatId?: string;

  @IsOptional()
  @IsString()
  text?: string;
}
