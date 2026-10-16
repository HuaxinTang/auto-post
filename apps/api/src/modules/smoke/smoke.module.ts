import { Module } from '@nestjs/common';
import { ExecutorsModule } from '../executors/executors.module';
import { SmokeController } from './smoke.controller';
import { SmokeService } from './smoke.service';

@Module({
  imports: [ExecutorsModule],
  controllers: [SmokeController],
  providers: [SmokeService],
})
export class SmokeModule {}
