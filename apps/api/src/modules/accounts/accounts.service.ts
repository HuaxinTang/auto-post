import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma } from '@auto-post/db';
import { encryptJson } from '@auto-post/crypto';
import { providerRegistry } from '@auto-post/platforms';
import type { TaskEnvelope, TaskEvent } from '@auto-post/contracts';
import { ExecutorsService } from '../executors/executors.service';
import { getDefaultOrgId } from '../../bootstrap';

const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class AccountsService implements OnModuleInit {
  private readonly logger = new Logger(AccountsService.name);
  private checkListeners = new Map<string, { accountId: string }>();

  constructor(private readonly executors: ExecutorsService) {}

  onModuleInit() {
    setInterval(() => void this.healthSweep(), HEALTH_CHECK_INTERVAL_MS).unref();
    this.healthSweep();
  }

  private async orgId() {
    return getDefaultOrgId();
  }

  async create(provider: 'DOUYIN' = 'DOUYIN') {
    return prisma.platformAccount.create({
      data: {
        organizationId: await this.orgId(),
        provider,
        authMode: 'BROWSER',
        status: 'PENDING',
      },
    });
  }

  async list() {
    return prisma.platformAccount.findMany({
      where: { organizationId: await this.orgId() },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(accountId: string) {
    await prisma.accountCredential.deleteMany({ where: { accountId } });
    await prisma.loginSession.deleteMany({ where: { accountId } });
    await prisma.platformAccount.delete({ where: { id: accountId } });
    return { ok: true };
  }

  // ---------- 登录 ----------

  async startLogin(accountId: string, preferredExecutorId?: string) {
    const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('account not found');

    const provider = providerRegistry.get(account.provider, account.authMode as never);

    const session = await prisma.loginSession.create({
      data: {
        organizationId: account.organizationId,
        accountId: account.id,
        provider: account.provider,
        status: 'CREATED',
      },
    });

    const task = provider.startLogin({
      taskId: session.id,
      organizationId: account.organizationId,
      accountId: account.id,
      profileKey: `acct_${account.id}`,
      attempt: 1,
    });

    this.executors.taskEvents.on(`task:${session.id}`, (payload: { event: TaskEvent }) => {
      this.handleLoginEvent(session.id, payload.event).catch((e) => {
        this.logger.error(`login event handling failed for ${session.id}: ${(e as Error).message}`);
      });
    });

    const targetExecutor = preferredExecutorId ?? account.executorId ?? undefined;
    const dispatched = this.executors.dispatch(task, (taskId) => {
      void prisma.loginSession
        .update({
          where: { id: taskId },
          data: { status: 'FAILED', hint: 'no executor accepted' },
        })
        .catch(() => undefined);
    }, targetExecutor);

    if (!dispatched) {
      await prisma.loginSession.update({
        where: { id: session.id },
        data: { status: 'FAILED', hint: 'no online executor' },
      });
      throw new Error('没有在线执行器，请先在本机启动 agent');
    }

    if (!account.executorId && targetExecutor) {
      await prisma.platformAccount.update({
        where: { id: account.id },
        data: { executorId: targetExecutor },
      });
    }

    await prisma.loginSession.update({
      where: { id: session.id },
      data: { status: 'DISPATCHED', executorId: targetExecutor ?? null },
    });
    return this.sessionView(session.id);
  }

  private async handleLoginEvent(sessionId: string, event: TaskEvent) {
    const provider = providerRegistry.get('DOUYIN', 'BROWSER');
    const session = await prisma.loginSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const progress = provider.interpretLoginEvent(event);
    if (!progress) return;

    switch (progress.status) {
      case 'QR_READY':
        await prisma.loginSession.update({
          where: { id: sessionId },
          data: {
            status: 'QR_READY',
            qrImageKey: progress.qrImageKey,
            qrUpdatedAt: new Date(),
            expiresAt: progress.expiresAt ?? null,
          },
        });
        break;
      case 'SCANNED':
        await prisma.loginSession.update({
          where: { id: sessionId },
          data: { status: 'SCANNED' },
        });
        break;
      case 'AWAITING_HUMAN':
        await prisma.loginSession.update({
          where: { id: sessionId },
          data: { status: 'AWAITING_HUMAN', hint: progress.hint ?? null },
        });
        break;
      case 'CONFIRMED':
        await this.completeLogin(sessionId, event);
        break;
      case 'EXPIRED':
      case 'FAILED':
        await prisma.loginSession.update({
          where: { id: sessionId },
          data: { status: progress.status === 'EXPIRED' ? 'EXPIRED' : 'FAILED', hint: progress.errorCode ?? null },
        });
        break;
    }
  }

  private async completeLogin(sessionId: string, event: TaskEvent) {
    if (event.type !== 'result') return;
    const data = event.data;
    const session = await prisma.loginSession.findUnique({ where: { id: sessionId } });
    if (!session?.accountId) return;

    const account = await prisma.platformAccount.findUnique({ where: { id: session.accountId } });
    if (!account) return;

    await prisma.platformAccount.update({
      where: { id: account.id },
      data: {
        status: 'CONNECTED',
        displayName: data.displayName ?? account.displayName,
        avatarUrl: data.avatarUrl ?? account.avatarUrl,
        externalId: data.externalId ?? account.externalId,
        lastHealthOkAt: new Date(),
        healthError: null,
      },
    });

    if (data.credentialState) {
      const ciphertext = encryptJson(data.credentialState);
      await prisma.accountCredential.upsert({
        where: { accountId: account.id },
        create: {
          accountId: account.id,
          kind: 'STORAGE_STATE',
          ciphertext: Buffer.from(ciphertext, 'base64'),
        },
        update: {
          ciphertext: Buffer.from(ciphertext, 'base64'),
          updatedAt: new Date(),
        },
      });
    }

    await prisma.loginSession.update({
      where: { id: sessionId },
      data: { status: 'CONFIRMED' },
    });
    this.logger.log(`account ${account.id} connected (${data.displayName ?? 'unknown'})`);
  }

  async sessionView(sessionId: string) {
    const session = await prisma.loginSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error('login session not found');
    return {
      id: session.id,
      status: session.status,
      qrImageKey: session.qrImageKey,
      qrUpdatedAt: session.qrUpdatedAt,
      expiresAt: session.expiresAt,
      hint: session.hint,
    };
  }

  // ---------- 登录态巡检 ----------

  async checkSession(accountId: string) {
    const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('account not found');
    const provider = providerRegistry.get(account.provider, account.authMode as never);

    const taskId = `check_${account.id}_${randomUUID()}`;
    this.checkListeners.set(taskId, { accountId });

    const task = provider.buildSessionCheck({ id: account.id } as never, taskId, 1);
    this.executors.taskEvents.on(`task:${taskId}`, (payload: { event: TaskEvent }) => {
      this.handleCheckEvent(taskId, payload.event).catch((e) => {
        this.logger.error(`check event handling failed for ${taskId}: ${(e as Error).message}`);
      });
    });

    const dispatched = this.executors.dispatch(
      task,
      () => this.checkListeners.delete(taskId),
      account.executorId ?? undefined
    );
    if (!dispatched) {
      this.checkListeners.delete(taskId);
      throw new Error('没有在线执行器');
    }
    return { ok: true, taskId };
  }

  private async handleCheckEvent(taskId: string, event: TaskEvent) {
    if (event.type !== 'result') return;
    const binding = this.checkListeners.get(taskId);
    if (!binding) return;
    this.checkListeners.delete(taskId);

    await prisma.platformAccount.update({
      where: { id: binding.accountId },
      data: event.data.ok
        ? { status: 'CONNECTED', lastHealthOkAt: new Date(), healthError: null }
        : { status: 'EXPIRED', healthError: '登录态已失效' },
    });
    this.logger.log(`account ${binding.accountId} session check: ${event.data.ok ? 'ok' : 'EXPIRED'}`);
  }

  private async healthSweep() {
    const orgId = await this.orgId().catch(() => null);
    if (!orgId) return;
    const threshold = new Date(Date.now() - HEALTH_CHECK_INTERVAL_MS);
    const accounts = await prisma.platformAccount.findMany({
      where: {
        organizationId: orgId,
        status: 'CONNECTED',
        OR: [{ lastHealthOkAt: null }, { lastHealthOkAt: { lt: threshold } }],
      },
    });
    for (const account of accounts) {
      this.checkSession(account.id).catch((e) => {
        this.logger.warn(`health check dispatch failed for ${account.id}: ${(e as Error).message}`);
      });
    }
  }
}
