import { Module } from '@nestjs/common';
import { ExecutorsModule } from './modules/executors/executors.module';
import { SmokeModule } from './modules/smoke/smoke.module';
import { StorageModule } from './modules/storage/storage.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { MediaModule } from './modules/media/media.module';
import { PublishModule } from './modules/publish/publish.module';

@Module({
  imports: [ExecutorsModule, SmokeModule, StorageModule, AccountsModule, CredentialsModule, MediaModule, PublishModule],
})
export class AppModule {}
