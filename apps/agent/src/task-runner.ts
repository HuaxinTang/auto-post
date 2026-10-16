import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { TaskEnvelope, TaskEvent } from '@auto-post/contracts';
import { getProfilePage } from './browser/launcher';
import { uploadArtifact } from './api-client';
import { runLoginQr } from './platforms/douyin/login';
import { runSessionCheck } from './platforms/douyin/session-check';
import { runPublishImage } from './platforms/douyin/publish-image';
import { runPublishConfirm } from './platforms/douyin/publish-confirm';
import { runListWorks } from './platforms/douyin/list-works';

export interface TaskContext {
  token: string;
  emit: (event: TaskEvent) => void;
  cancelled: () => boolean;
}

const activeRuns = new Map<string, TaskContext>();

export function registerRun(taskId: string, ctx: TaskContext) {
  activeRuns.set(taskId, ctx);
}

export function unregisterRun(taskId: string) {
  activeRuns.delete(taskId);
}

export function cancelRun(taskId: string) {
  const ctx = activeRuns.get(taskId);
  if (ctx) {
    ctx.emit({ type: 'failed', code: 'CANCELLED', message: 'cancelled by server' });
  }
}

export async function runTask(task: TaskEnvelope, token: string, emit: (e: TaskEvent) => void) {
  let cancelled = false;
  const ctx: TaskContext = {
    token,
    emit,
    cancelled: () => cancelled,
  };
  registerRun(task.taskId, ctx);
  emit({ type: 'accepted' });

  try {
    switch (task.kind) {
      case 'browser.screenshot':
        await runScreenshot(task, ctx);
        break;
      case 'douyin.login.qr':
        await runLoginQr(task, ctx);
        break;
      case 'douyin.session.check':
        await runSessionCheck(task, ctx);
        break;
      case 'douyin.publish.image':
        await runPublishImage(task, ctx);
        break;
      case 'douyin.publish.confirm':
        await runPublishConfirm(task, ctx);
        break;
      case 'douyin.list.works':
        await runListWorks(task, ctx);
        break;
      default:
        emit({ type: 'failed', code: 'UNKNOWN', message: `task kind not implemented yet: ${task.kind}` });
    }
  } catch (e) {
    if (cancelled) return;
    const msg = (e as Error).message;
    emit({ type: 'log', level: 'error', message: msg });
    emit({ type: 'failed', code: 'UNKNOWN', message: msg });
  } finally {
    unregisterRun(task.taskId);
  }
}

export async function uploadScreenshot(
  page: import('playwright').Page,
  step: string,
  ctx: TaskContext
): Promise<string> {
  const buf = await page.screenshot({ fullPage: false });
  const dir = mkdtempSync(join(tmpdir(), 'agent-shot-'));
  const file = join(dir, `${randomUUID()}.png`);
  writeFileSync(file, buf);
  const key = `screenshots/${randomUUID()}.png`;
  await uploadArtifact(key, file, ctx.token);
  ctx.emit({ type: 'screenshot', step, imageKey: key });
  return key;
}

async function screenshotPage(url: string, ctx: TaskContext, step: string): Promise<string> {
  const page = await getProfilePage('smoke');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3_000);
  return uploadScreenshot(page, step, ctx);
}

async function runScreenshot(task: TaskEnvelope, ctx: TaskContext) {
  const url = (task.params as { url?: string }).url ?? 'https://creator.douyin.com';
  ctx.emit({ type: 'progress', step: 'launch_browser' });
  ctx.emit({ type: 'progress', step: 'goto', pct: 10 });
  const key = await screenshotPage(url, ctx, 'page');
  ctx.emit({ type: 'result', data: { ok: true, screenshots: [key] } });
}
