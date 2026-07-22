import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class IngestDocumentDto {
  @ApiProperty({ example: 'Refund Policy', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Refunds are available within 30 days of purchase.', maxLength: 50000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content: string;
}
