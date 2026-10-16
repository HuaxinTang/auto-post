import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublishService } from './publish.service';

@Controller()
export class PublishController {
  constructor(private readonly publish: PublishService) {}

  @Post('posts')
  createPost(
    @Body()
    body: {
      title: string;
      body: string;
      visibility: 'PUBLIC' | 'PRIVATE';
      mediaIds: string[];
      accountId: string;
      mode: 'DRAFT_THEN_CONFIRM' | 'DIRECT';
    }
  ) {
    return this.publish.createPost(body);
  }

  @Get('posts')
  listPosts() {
    return this.publish.listPosts();
  }

  @Get('posts/:id')
  getPost(@Param('id') id: string) {
    return this.publish.getPost(id);
  }

  @Post('posts/:id/republish')
  republish(@Param('id') id: string) {
    return this.publish.republish(id);
  }

  @Post('targets/:targetId/confirm')
  confirmDraft(@Param('targetId') targetId: string) {
    return this.publish.confirmDraft(targetId);
  }
}
