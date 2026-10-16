import { Module } from '@nestjs/common';
import { ExecutorsController } from './executors.controller';
import { ExecutorsGateway } from './executors.gateway';
import { ExecutorsService } from './executors.service';

@Module({
  controllers: [ExecutorsController],
  providers: [ExecutorsService, ExecutorsGateway],
  exports: [ExecutorsService],
})
export class ExecutorsModule {}
