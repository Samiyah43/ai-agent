import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatRequestDto {
  @ApiProperty({ example: 'What is the refund policy?', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;

  @ApiPropertyOptional({ description: 'Groups messages into the same conversation history' })
  @IsOptional()
  @IsString()
  conversationId?: string;
}
