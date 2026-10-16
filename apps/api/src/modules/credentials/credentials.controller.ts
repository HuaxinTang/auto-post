import { Body, Controller, Post } from '@nestjs/common';
import { CredentialsService } from './credentials.service';

@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Post('exchange')
  exchange(@Body() body: { ticket: string }) {
    return this.credentials.exchange(body.ticket);
  }
}
