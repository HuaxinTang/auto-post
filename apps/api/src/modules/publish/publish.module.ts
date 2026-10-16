import { Module } from '@nestjs/common';
import { ExecutorsModule } from '../executors/executors.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { PublishController } from './publish.controller';
import { PublishService } from './publish.service';

@Module({
  imports: [ExecutorsModule, CredentialsModule],
  controllers: [PublishController],
  providers: [PublishService],
})
export class PublishModule {}
