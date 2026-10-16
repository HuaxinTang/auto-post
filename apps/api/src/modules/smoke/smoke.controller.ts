import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SmokeService } from './smoke.service';

@Controller('smoke')
export class SmokeController {
  constructor(private readonly smoke: SmokeService) {}

  @Post()
  start(@Body() body: { url?: string }) {
    return this.smoke.start(body.url ?? 'https://creator.douyin.com');
  }

  @Get()
  list() {
    return this.smoke.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const run = this.smoke.get(id);
    if (!run) throw new Error('smoke run not found');
    return run;
  }
}
