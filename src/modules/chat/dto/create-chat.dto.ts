import { IsOptional, IsString } from 'class-validator';

export class CreateChatDto {
  @IsOptional()
  @IsString()
  otherUserId?: string;
}
