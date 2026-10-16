import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ExecutorsService } from './executors.service';

@Controller('executors')
export class ExecutorsController {
  constructor(private readonly executors: ExecutorsService) {}

  @Post('enroll')
  enroll(
    @Body()
    body: {
      enrollCode: string;
      name: string;
      os: string;
      version: string;
      capabilities: string[];
    }
  ) {
    return this.executors.enroll(body);
  }

  @Get()
  list() {
    return this.executors.list();
  }

  @Delete(':id')
  revoke(@Param('id') id: string) {
    return this.executors.revoke(id);
  }
}
