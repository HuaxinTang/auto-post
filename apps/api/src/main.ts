import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { bootstrapOrg } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('api');
  await bootstrapOrg();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`API listening on :${port}`);
}
bootstrap();
