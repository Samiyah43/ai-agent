import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;
}
