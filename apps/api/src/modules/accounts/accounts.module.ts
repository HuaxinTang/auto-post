import { Module } from '@nestjs/common';
import { ExecutorsModule } from '../executors/executors.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [ExecutorsModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
