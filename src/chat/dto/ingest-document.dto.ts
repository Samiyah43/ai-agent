import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class IngestDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content: string;
}
