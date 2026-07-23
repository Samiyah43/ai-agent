import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so every module (AppModule's health check, ChatModule's services)
// shares the same PrismaService instance instead of each opening its own
// database connection.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
