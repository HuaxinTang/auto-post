import type { Locator, Page } from 'playwright';
import type { TaskEnvelope } from '@auto-post/contracts';
import type { TaskContext } from '../../task-runner';
import { uploadScreenshot } from '../../task-runner';
import { getProfileContext, saveStorageState } from '../../browser/launcher';
import {
  DOUYIN_CREATOR_HOME,
  DOUYIN_SELECTORS,
  LOGIN_POLL_INTERVAL_MS,
  LOGIN_TOTAL_TIMEOUT_MS,
  QR_EMIT_TTL_MS,
  SMS_WAIT_MS,
} from './selectors';

interface LoginState {
  kind: 'qr' | 'scanned' | 'sms_wall' | 'logged_in' | 'unknown';
}

async function findQrElement(page: Page): Promise<Locator | null> {
  const frames = page.frames();
  for (const frame of frames) {
    for (const selector of DOUYIN_SELECTORS.qrCandidates) {
      try {
        const loc = frame.locator(selector).first();
        const count = await loc.count();
        if (count === 0) continue;
        const box = await loc.boundingBox();
        if (box && box.width >= 100 && box.height >= 100) {
          return loc;
        }
      } catch {
        /* frame 可能不可访问，继续 */
      }
    }
  }
  return null;
}

async function detectLoginState(page: Page): Promise<LoginState> {
  const qrVisible = !!(await findQrElement(page));

  // 短信墙：仅在二维码消失后（已扫码）出现验证码输入框才算
  if (!qrVisible) {
    const frames = page.frames();
    for (const frame of frames) {
      for (const selector of DOUYIN_SELECTORS.smsIndicators) {
        try {
          if (await frame.locator(selector).first().isVisible()) {
            return { kind: 'sms_wall' };
          }
        } catch {
          /* continue */
        }
      }
    }
  }

  const frames = page.frames();
  for (const frame of frames) {
    for (const selector of DOUYIN_SELECTORS.scannedIndicators) {
      try {
        if (await frame.locator(selector).first().isVisible()) {
          return { kind: 'scanned' };
        }
      } catch {
        /* continue */
      }
    }
  }
  for (const frame of frames) {
    for (const selector of DOUYIN_SELECTORS.loggedInIndicators) {
      try {
        if (await frame.locator(selector).first().isVisible()) {
          return { kind: 'logged_in' };
        }
      } catch {
        /* continue */
      }
    }
  }
  const url = page.url();
  if (!DOUYIN_SELECTORS.loginPathPattern.test(url)) {
    const onHome = url.startsWith(DOUYIN_CREATOR_HOME);
    if (onHome && !qrVisible) return { kind: 'logged_in' };
  }
  return qrVisible ? { kind: 'qr' } : { kind: 'unknown' };
}

async function scrapeProfile(page: Page): Promise<{
  displayName?: string;
  avatarUrl?: string;
  externalId?: string;
}> {
  try {
    await page.goto(DOUYIN_CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3000);
  } catch {
    /* 抓取失败不阻塞登录结果 */
  }
  const result: { displayName?: string; avatarUrl?: string; externalId?: string } = {};
  for (const selector of DOUYIN_SELECTORS.profile.nickname) {
    try {
      const text = await page.locator(selector).first().textContent();
      if (text && text.trim()) {
        result.displayName = text.trim().slice(0, 60);
        break;
      }
    } catch {
      /* continue */
    }
  }
  for (const selector of DOUYIN_SELECTORS.profile.avatar) {
    try {
      const src = await page.locator(selector).first().getAttribute('src');
      if (src) {
        result.avatarUrl = src;
        break;
      }
    } catch {
      /* continue */
    }
  }
  try {
    const cookies = await page.context().cookies();
    for (const c of cookies) {
      if (/uid/i.test(c.name) && c.value) {
        result.externalId = c.value.slice(0, 64);
        break;
      }
    }
  } catch {
    /* continue */
  }
  return result;
}

export async function runLoginQr(task: TaskEnvelope, ctx: TaskContext) {
  const params = task.params as { profileKey: string };
  const profileKey = params.profileKey;
  const context = await getProfileContext(profileKey);
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  ctx.emit({ type: 'progress', step: 'open_login_page' });
  await page.goto(DOUYIN_CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  const startedAt = Date.now();
  let smsWaitStartedAt: number | null = null;
  let lastScreenshotAt = 0;
  let lastScannedReported = false;

  while (Date.now() - startedAt < LOGIN_TOTAL_TIMEOUT_MS) {
    if (ctx.cancelled()) return;

    const state = await detectLoginState(page);

    if (state.kind === 'logged_in') {
      ctx.emit({ type: 'progress', step: 'login_success' });
      const storageState = await saveStorageState(profileKey);
      const profile = await scrapeProfile(page);
      await uploadScreenshot(page, 'logged_in', ctx);
      ctx.emit({
        type: 'result',
        data: {
          ok: true,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          externalId: profile.externalId,
          credentialState: storageState,
        },
      });
      return;
    }

    if (state.kind === 'sms_wall') {
      if (smsWaitStartedAt === null) {
        smsWaitStartedAt = Date.now();
        const shotKey = await uploadScreenshot(page, 'sms_wall', ctx);
        ctx.emit({
          type: 'awaiting_human',
          reason: 'sms',
          hint: '请在执行器电脑的浏览器窗口完成短信验证',
          screenshotKey: shotKey,
        });
      }
      if (Date.now() - smsWaitStartedAt > SMS_WAIT_MS) {
        ctx.emit({ type: 'failed', code: 'SMS_CHALLENGE', message: '短信验证等待超时' });
        return;
      }
      await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
      continue;
    }

    smsWaitStartedAt = null;

    if (state.kind === 'scanned') {
      if (!lastScannedReported) {
        lastScannedReported = true;
        ctx.emit({ type: 'progress', step: 'scanned' });
      }
      await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
      continue;
    }

    if (state.kind === 'qr') {
      const qrEl = await findQrElement(page);
      if (qrEl) {
        const { mkdtempSync, writeFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const { randomUUID } = await import('node:crypto');
        const buf = await qrEl.screenshot();
        const dir = mkdtempSync(join(tmpdir(), 'agent-qr-'));
        const file = join(dir, `${randomUUID()}.png`);
        writeFileSync(file, buf);
        const { uploadArtifact } = await import('../../api-client');
        const key = `qr/${randomUUID()}.png`;
        await uploadArtifact(key, file, ctx.token);
        ctx.emit({
          type: 'qr',
          imageKey: key,
          expiresAt: new Date(Date.now() + QR_EMIT_TTL_MS).toISOString(),
        });
        lastScannedReported = false;
      }
      // 二维码有效期内轮询登录状态；过期后循环自然重截新码
      const waitUntil = Date.now() + QR_EMIT_TTL_MS;
      while (Date.now() < waitUntil) {
        if (ctx.cancelled()) return;
        const s = await detectLoginState(page);
        if (s.kind === 'logged_in' || s.kind === 'sms_wall' || s.kind === 'scanned') break;
        await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
      }
      continue;
    }

    // unknown：拿截图辅助诊断，继续等待
    if (Date.now() - lastScreenshotAt > 30_000) {
      lastScreenshotAt = Date.now();
      ctx.emit({ type: 'log', level: 'warn', message: '登录状态未知，等待中' });
      await uploadScreenshot(page, 'login_unknown', ctx);
    }
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }

  ctx.emit({ type: 'failed', code: 'TIMED_OUT', message: '登录总超时' });
}
