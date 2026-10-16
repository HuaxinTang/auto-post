import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, Prisma, type PublishMode } from '@auto-post/db';
import { providerRegistry } from '@auto-post/platforms';
import type { TaskEnvelope, TaskEvent, TaskResult } from '@auto-post/contracts';
import { ExecutorsService } from '../executors/executors.service';
import { CredentialsService } from '../credentials/credentials.service';
import { getDefaultOrgId } from '../../bootstrap';

type ListenerKind = 'publish' | 'confirm' | 'reconcile';

interface ListenerBinding {
  kind: ListenerKind;
  targetId: string;
  runId?: string;
  dispatchMode?: 'draft' | 'publish';
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);
  private listeners = new Map<string, ListenerBinding>();

  constructor(
    private readonly executors: ExecutorsService,
    private readonly credentials: CredentialsService
  ) {}

  // ---------- 内容 CRUD ----------

  async createPost(input: {
    title: string;
    body: string;
    visibility: 'PUBLIC' | 'PRIVATE';
    mediaIds: string[];
    accountId: string;
    mode: PublishMode;
  }) {
    const orgId = await getDefaultOrgId();
    const account = await prisma.platformAccount.findUnique({ where: { id: input.accountId } });
    if (!account) throw new Error('账号不存在');
    if (account.status !== 'CONNECTED') throw new Error('账号未连接，请先扫码登录');

    const provider = providerRegistry.get(account.provider, account.authMode as never);

    const media = await prisma.mediaAsset.findMany({ where: { id: { in: input.mediaIds } } });
    if (media.length !== input.mediaIds.length) throw new Error('部分媒体不存在');

    const issues = provider.validateContent({
      kind: 'IMAGE_TEXT',
      title: input.title,
      body: input.body,
      visibility: input.visibility,
      media: media.map((m) => ({ mimeType: m.mimeType, sizeBytes: m.sizeBytes })),
    });
    if (issues.length > 0) {
      throw new Error(issues.map((i) => `${i.field}: ${i.message}`).join('; '));
    }

    const post = await prisma.post.create({
      data: {
        organizationId: orgId,
        kind: 'IMAGE_TEXT',
        title: input.title,
        body: input.body,
        visibility: input.visibility,
        state: 'PUBLISHING',
      },
    });
    await prisma.mediaAsset.updateMany({
      where: { id: { in: input.mediaIds } },
      data: { postId: post.id },
    });

    const target = await prisma.postTarget.create({
      data: {
        organizationId: orgId,
        postId: post.id,
        accountId: account.id,
        mode: input.mode,
        status: 'PENDING',
      },
    });

    await this.dispatchPublish(target.id, input.mode === 'DRAFT_THEN_CONFIRM' ? 'draft' : 'publish');
    return this.getPost(post.id);
  }

  async listPosts() {
    return prisma.post.findMany({
      where: { organizationId: await getDefaultOrgId() },
      include: { media: true, targets: { include: { account: true, runs: { orderBy: { attemptNo: 'desc' } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPost(postId: string) {
    return prisma.post.findUnique({
      where: { id: postId },
      include: { media: true, targets: { include: { account: true, runs: { orderBy: { attemptNo: 'desc' } } } } },
    });
  }

  async republish(postId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { targets: { include: { runs: true } } },
    });
    if (!post) throw new Error('内容不存在');
    if (post.targets.length === 0) throw new Error('内容没有发布目标');
    const target = post.targets[0];
    const draftSaved =
      target.status === 'AWAITING_CONFIRM' || target.runs.some((r) => r.draftRef != null);
    const dispatchMode: 'draft' | 'publish' =
      draftSaved || target.mode === 'DIRECT' ? 'publish' : 'draft';
    await this.dispatchPublish(target.id, dispatchMode);
    return this.getPost(postId);
  }

  async confirmDraft(targetId: string) {
    const target = await prisma.postTarget.findUnique({ where: { id: targetId } });
    if (!target) throw new Error('target not found');
    if (target.status !== 'AWAITING_CONFIRM') throw new Error('当前状态不可确认发布');
    // 确认发布 = 用同一内容重新走发布流程（执行器侧发布前有标题幂等检查防重复）
    await this.dispatchPublish(target.id, 'publish');
    return this.getPost(target.postId);
  }

  // ---------- 派发 ----------

  private async dispatchPublish(targetId: string, mode: 'draft' | 'publish') {
    const target = await prisma.postTarget.findUnique({
      where: { id: targetId },
      include: { account: true, post: { include: { media: true } } },
    });
    if (!target) throw new Error('target not found');

    const active = await prisma.publishRun.findFirst({
      where: {
        targetId,
        status: { in: ['QUEUED', 'LEASED', 'RUNNING', 'AWAITING_HUMAN'] },
      },
    });
    if (active) throw new Error('该内容已有进行中的发布任务');

    const provider = providerRegistry.get(target.account.provider, target.account.authMode as never);
    const run = await prisma.publishRun.create({
      data: {
        targetId,
        attemptNo: target.attemptCount + 1,
        mode: target.mode,
        status: 'QUEUED',
      },
    });
    await prisma.postTarget.update({
      where: { id: targetId },
      data: { status: 'LEASED', attemptCount: { increment: 1 }, failCode: null },
    });

    const ticket = this.credentials.issueTicket(target.accountId);
    const mediaRefs = await Promise.all(
      target.post.media.map(async (m) => ({
        presignedUrl: await this.mediaUrl(m.storageKey),
        sha256: m.sha256,
        filename: m.storageKey.split('/').pop() ?? 'image',
        mimeType: m.mimeType,
      }))
    );

    const task = provider.compilePublish({
      taskId: run.id,
      attempt: run.attemptNo,
      account: { id: target.accountId } as never,
      post: {
        kind: 'IMAGE_TEXT',
        title: target.post.title,
        body: target.post.body,
        visibility: target.post.visibility,
        media: [],
      },
      target: { id: targetId, scheduledAt: null, externalPostId: null },
      mode,
      credentialTicket: ticket,
      media: mediaRefs,
    });

    this.listeners.set(run.id, { kind: 'publish', targetId, runId: run.id, dispatchMode: mode });
    this.executors.taskEvents.on(`task:${run.id}`, (p: { event: TaskEvent }) => {
      this.handlePublishEvent(run.id, p.event).catch((e) =>
        this.logger.error(`publish event failed for ${run.id}: ${(e as Error).message}`)
      );
    });

    const dispatched = this.executors.dispatch(
      task,
      () => this.failRun(run.id, 'NO_EXECUTOR', 'no executor accepted'),
      target.account.executorId ?? undefined
    );
    if (!dispatched) {
      await this.failRun(run.id, 'NO_EXECUTOR', 'no online executor');
      throw new Error('没有在线执行器');
    }
    await prisma.publishRun.update({
      where: { id: run.id },
      data: { status: 'LEASED', leaseExpiresAt: new Date(Date.now() + 30 * 60_000) },
    });
  }

  private async mediaUrl(storageKey: string): Promise<string> {
    if (process.env.STORAGE_BACKEND === 'disk' || !process.env.S3_ENDPOINT) {
      const base = (process.env.API_PUBLIC_URL ?? 'http://localhost:3001').replace(/\/$/, '');
      return `${base}/api/storage/file/${encodeURIComponent(storageKey)}`;
    }
    const { createStorage } = await import('@auto-post/storage');
    return createStorage().presignedGetUrl(storageKey, 600);
  }

  // ---------- 事件处理 ----------

  private async handlePublishEvent(taskId: string, event: TaskEvent) {
    const binding = this.listeners.get(taskId);
    if (!binding) return;
    const runId = binding.runId;
    if (!runId) return;

    switch (event.type) {
      case 'accepted':
        await prisma.publishRun.update({
          where: { id: runId },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
        await prisma.postTarget.update({
          where: { id: binding.targetId },
          data: { status: 'RUNNING' },
        });
        break;
      case 'progress':
      case 'log':
      case 'awaiting_human':
        await this.appendEvent(runId, event);
        if (event.type === 'awaiting_human') {
          await prisma.publishRun.update({ where: { id: runId }, data: { status: 'AWAITING_HUMAN' } });
          await prisma.postTarget.update({ where: { id: binding.targetId }, data: { status: 'AWAITING_HUMAN' } });
        }
        break;
      case 'screenshot':
        await this.appendArtifact(runId, event.step, event.imageKey);
        break;
      case 'result':
        await this.applyResult(binding, event.data);
        break;
      case 'failed':
        await this.failRun(runId, event.code, event.message);
        break;
    }
  }

  private async appendEvent(runId: string, event: TaskEvent) {
    const run = await prisma.publishRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const eventsLog = (run.eventsLog as unknown[]) ?? [];
    const hint = (event as { hint?: string }).hint;
    eventsLog.push({
      at: new Date().toISOString(),
      type: event.type,
      step: (event as { step?: string }).step,
      message: (event as { message?: string }).message ?? hint,
    });
    await prisma.publishRun.update({ where: { id: runId }, data: { eventsLog: eventsLog as Prisma.InputJsonValue } });
  }

  private async appendArtifact(runId: string, step: string, key: string) {
    const run = await prisma.publishRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const artifacts = (run.artifacts as Array<{ step: string; type: string; key: string }>) ?? [];
    artifacts.push({ step, type: 'screenshot', key });
    await prisma.publishRun.update({ where: { id: runId }, data: { artifacts: artifacts as Prisma.InputJsonValue } });
  }

  private async applyResult(binding: ListenerBinding, result: TaskResult) {
    const { kind, targetId, runId } = binding;

    if (kind === 'publish' && binding.dispatchMode === 'draft' && result.ok) {
      await prisma.publishRun.update({
        where: { id: runId },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), draftRef: (result.draftRef ?? undefined) as Prisma.InputJsonValue | undefined },
      });
      await prisma.postTarget.update({
        where: { id: targetId },
        data: { status: 'AWAITING_CONFIRM' },
      });
      this.logger.log(`target ${targetId} draft saved, awaiting confirm`);
      return;
    }

    if (!result.ok) {
      if (runId) await this.failRun(runId, 'UNKNOWN', 'result not ok');
      return;
    }

    await prisma.publishRun.update({
      where: { id: runId },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });
    await this.dispatchReconcile(targetId);
  }

  private async failRun(runId: string, code: string, detail: string) {
    const run = await prisma.publishRun.findUnique({ where: { id: runId } });
    if (!run) return;
    await prisma.publishRun.update({
      where: { id: runId },
      data: { status: 'FAILED', finishedAt: new Date(), errorCode: code, errorDetail: detail },
    });
    await prisma.postTarget.update({
      where: { id: run.targetId },
      data: { status: 'FAILED', failCode: code },
    });
    const target = await prisma.postTarget.findUnique({ where: { id: run.targetId } });
    if (target) await this.updatePostState(target.postId);
  }

  // ---------- 对账 ----------

  private async dispatchReconcile(targetId: string) {
    const target = await prisma.postTarget.findUnique({
      where: { id: targetId },
      include: { account: true, post: true },
    });
    if (!target) return;
    const provider = providerRegistry.get(target.account.provider, target.account.authMode as never);

    const taskId = `reconcile_${targetId}_${randomUUID()}`;
    const ticket = this.credentials.issueTicket(target.accountId);
    const task = provider.compileListWorks({
      taskId,
      attempt: 1,
      account: { id: target.accountId } as never,
      credentialTicket: ticket,
      since: new Date(Date.now() - 60 * 60_000),
    });

    this.listeners.set(taskId, { kind: 'reconcile', targetId });
    this.executors.taskEvents.on(`task:${taskId}`, (p: { event: TaskEvent }) => {
      this.handleReconcileEvent(taskId, p.event).catch((e) =>
        this.logger.error(`reconcile event failed: ${(e as Error).message}`)
      );
    });

    this.executors.dispatch(
      task,
      () => {
        this.logger.warn(`reconcile task ${taskId} not accepted`);
        void prisma.postTarget.update({
          where: { id: targetId },
          data: { reconcileStatus: 'PENDING' },
        });
      },
      target.account.executorId ?? undefined
    );
  }

  private async handleReconcileEvent(taskId: string, event: TaskEvent) {
    if (event.type !== 'result') return;
    const binding = this.listeners.get(taskId);
    if (!binding) return;
    this.listeners.delete(taskId);

    const target = await prisma.postTarget.findUnique({
      where: { id: binding.targetId },
      include: { post: true, account: true },
    });
    if (!target) return;

    const provider = providerRegistry.get(target.account.provider, target.account.authMode as never);
    const works = (event.data.works ?? []).map((w) => ({
      id: w.id,
      title: w.title,
      publishTime: new Date(w.publishTime),
      status: w.status,
      url: w.url,
    }));

    const matched = provider.matchWork(works, target.post.title, 30, target.post.body);
    if (matched) {
      await prisma.postTarget.update({
        where: { id: target.id },
        data: {
          status: 'SUCCEEDED',
          publishedAt: new Date(),
          externalPostId: matched.id,
          externalUrl: matched.url ?? null,
          reconcileStatus: 'PRESENT',
          reconcileAt: new Date(),
        },
      });
      this.logger.log(`target ${target.id} reconciled: work ${matched.id}`);
    } else {
      await prisma.postTarget.update({
        where: { id: target.id },
        data: {
          status: 'SUCCEEDED',
          publishedAt: new Date(),
          reconcileStatus: 'PENDING',
          reconcileAt: new Date(),
        },
      });
      this.logger.warn(`target ${target.id} published but no matching work yet (${works.length} works listed)`);
    }
    await this.updatePostState(target.postId);
  }

  private async updatePostState(postId: string) {
    const post = await prisma.post.findUnique({ where: { id: postId }, include: { targets: true } });
    if (!post) return;
    const targets = post.targets;
    if (targets.length === 0) return;
    let state: 'PUBLISHING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED' = 'PUBLISHING';
    if (targets.every((t) => t.status === 'SUCCEEDED')) state = 'PUBLISHED';
    else if (targets.every((t) => t.status === 'FAILED')) state = 'FAILED';
    else if (targets.some((t) => t.status === 'SUCCEEDED')) state = 'PARTIAL';
    await prisma.post.update({ where: { id: postId }, data: { state } });
  }
}
