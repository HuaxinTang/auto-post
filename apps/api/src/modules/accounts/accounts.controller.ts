import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  create(@Body() body: { provider?: 'DOUYIN' }) {
    return this.accounts.create(body.provider ?? 'DOUYIN');
  }

  @Get()
  list() {
    return this.accounts.list();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }

  @Post(':id/login')
  startLogin(@Param('id') id: string, @Body() body: { executorId?: string }) {
    return this.accounts.startLogin(id, body.executorId);
  }

  @Get(':id/login-sessions/:sid')
  sessionView(@Param('sid') sid: string) {
    return this.accounts.sessionView(sid);
  }

  @Post(':id/check')
  checkSession(@Param('id') id: string) {
    return this.accounts.checkSession(id);
  }
}
