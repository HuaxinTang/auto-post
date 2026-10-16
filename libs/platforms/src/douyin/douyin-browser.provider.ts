import type {
  TaskEvent,
  TaskResult,
  WorkItem,
} from '@auto-post/contracts';
import type {
  LoginContext,
  LoginProgress,
  PlatformAccountLite,
  PostDraft,
  PostTargetLite,
  RemoteWork,
  SocialProvider,
  TargetOutcome,
  ValidationIssue,
} from '../provider.interface';
import { DOUYIN_SPEC } from './spec';

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/#[^#\s]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export class DouyinBrowserProvider implements SocialProvider {
  readonly spec = DOUYIN_SPEC;
  readonly authMode = 'BROWSER' as const;

  validateContent(draft: PostDraft): ValidationIssue[] {
    const c = this.spec.constraints;
    const issues: ValidationIssue[] = [];

    if (draft.kind === 'IMAGE_TEXT') {
      const len = draft.title.trim().length;
      if (len < c.title.min || len > c.title.max) {
        issues.push({
          field: 'title',
          message: `标题需 ${c.title.min}-${c.title.max} 字（当前 ${len} 字）`,
        });
      }
      if (draft.media.length < c.media.min || draft.media.length > c.media.max) {
        issues.push({
          field: 'media',
          message: `图片需 ${c.media.min}-${c.media.max} 张（当前 ${draft.media.length} 张）`,
        });
      }
      for (const m of draft.media) {
        if (!c.media.mimeTypes.includes(m.mimeType)) {
          issues.push({ field: 'media', message: `不支持的图片格式: ${m.mimeType}` });
        }
        if (m.sizeBytes > c.media.maxSizeMB * 1024 * 1024) {
          issues.push({ field: 'media', message: `图片超过 ${c.media.maxSizeMB}MB 限制` });
        }
      }
    }
    return issues;
  }

  startLogin(ctx: LoginContext) {
    return {
      taskId: ctx.taskId,
      kind: this.spec.tasks.login,
      attempt: ctx.attempt,
      deadlineAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      idempotencyKey: `${ctx.taskId}:${ctx.attempt}`,
      params: {
        accountId: ctx.accountId,
        profileKey: ctx.profileKey,
      },
    };
  }

  interpretLoginEvent(ev: TaskEvent): LoginProgress | null {
    switch (ev.type) {
      case 'qr':
        return { status: 'QR_READY', qrImageKey: ev.imageKey, expiresAt: new Date(ev.expiresAt) };
      case 'awaiting_human':
        return { status: 'AWAITING_HUMAN', hint: ev.reason };
      case 'progress':
        if (ev.step === 'scanned') return { status: 'SCANNED' };
        return null;
      case 'result':
        return ev.data.ok ? { status: 'CONFIRMED' } : { status: 'FAILED' };
      case 'failed':
        return { status: 'FAILED', errorCode: ev.code };
      default:
        return null;
    }
  }

  buildSessionCheck(account: PlatformAccountLite, taskId: string, attempt: number) {
    return {
      taskId,
      kind: this.spec.tasks.sessionCheck,
      attempt,
      deadlineAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      idempotencyKey: `${taskId}:${attempt}`,
      params: {
        accountId: account.id,
        profileKey: `acct_${account.id}`,
      },
    };
  }

  compilePublish(opts: {
    taskId: string;
    attempt: number;
    account: PlatformAccountLite;
    post: PostDraft;
    target: PostTargetLite;
    mode: 'draft' | 'publish';
    credentialTicket: string;
    media: Array<{ presignedUrl: string; sha256: string; filename: string; mimeType: string }>;
  }) {
    return {
      taskId: opts.taskId,
      kind: this.spec.tasks.publish,
      attempt: opts.attempt,
      deadlineAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      idempotencyKey: `${opts.taskId}:${opts.attempt}`,
      params: {
        accountId: opts.account.id,
        profileKey: `acct_${opts.account.id}`,
        credentialTicket: opts.credentialTicket,
        mode: opts.mode,
        title: opts.post.title,
        body: opts.post.body,
        visibility: opts.post.visibility === 'PRIVATE' ? 'self_only' : 'public',
        media: opts.media,
      },
    };
  }

  compileConfirmDraft(opts: {
    taskId: string;
    attempt: number;
    account: PlatformAccountLite;
    credentialTicket: string;
    draftRef?: Record<string, unknown>;
  }) {
    return {
      taskId: opts.taskId,
      kind: this.spec.tasks.confirmDraft!,
      attempt: opts.attempt,
      deadlineAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      idempotencyKey: `${opts.taskId}:${opts.attempt}`,
      params: {
        accountId: opts.account.id,
        profileKey: `acct_${opts.account.id}`,
        credentialTicket: opts.credentialTicket,
        draftRef: opts.draftRef ?? {},
      },
    };
  }

  compileListWorks(opts: {
    taskId: string;
    attempt: number;
    account: PlatformAccountLite;
    credentialTicket: string;
    since?: Date;
  }) {
    return {
      taskId: opts.taskId,
      kind: this.spec.tasks.listWorks,
      attempt: opts.attempt,
      deadlineAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      idempotencyKey: `${opts.taskId}:${opts.attempt}`,
      params: {
        accountId: opts.account.id,
        profileKey: `acct_${opts.account.id}`,
        credentialTicket: opts.credentialTicket,
        since: opts.since?.toISOString(),
      },
    };
  }

  matchWork(works: RemoteWork[], title: string, publishedWindowMin = 10, extraText?: string): RemoteWork | null {
    // 候选 = 标题 + 正文（管理页卡片显示的是话题行，需同时匹配）
    const candidates = [title, extraText ?? '']
      .map(normalizeTitle)
      .filter((c) => c.length > 0);
    if (candidates.length === 0) return null;
    const now = Date.now();
    const windowMs = publishedWindowMin * 60 * 1000;

    const unique = new Map(works.map((w) => [w.id, w]));
    for (const w of unique.values()) {
      const wn = normalizeTitle(w.title);
      if (!wn) continue;
      const hit = candidates.some((c) => wn.includes(c) || c.includes(wn));
      if (!hit) continue;
      const delta = Math.abs(new Date(w.publishTime).getTime() - now);
      if (delta <= windowMs) return w;
    }
    return null;
  }

  applyPublishResult(result: TaskResult, mode: 'draft' | 'publish'): TargetOutcome {
    if (!result.ok) {
      return { status: 'FAILED', errorCode: 'UNKNOWN' };
    }
    if (mode === 'draft') {
      return { status: 'AWAITING_CONFIRM', draftRef: result.draftRef };
    }
    const matchedWork: WorkItem | undefined = result.works?.[0] ?? (result.workId ? {
      id: result.workId,
      title: '',
      publishTime: new Date().toISOString(),
      url: result.url,
    } : undefined);
    return {
      status: 'SUCCEEDED',
      externalPostId: result.workId,
      externalUrl: result.url,
      matchedWork,
    };
  }
}
