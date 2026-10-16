import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { TaskEnvelope, MediaRef } from '@auto-post/contracts';
import type { TaskContext } from '../../task-runner';
import { uploadScreenshot } from '../../task-runner';
import { getProfileContext } from '../../browser/launcher';
import { fetchCredential } from '../../api-client';
import { DOUYIN_SELECTORS } from './selectors';
import { listWorksFromManagePage } from './list-works';

interface PublishParams {
  accountId: string;
  profileKey: string;
  credentialTicket: string;
  mode: 'draft' | 'publish';
  title: string;
  body: string;
  visibility: 'public' | 'self_only';
  media: MediaRef[];
}

async function typeSlowly(page: Page, selector: string, text: string) {
  const el = page.locator(selector).first();
  await el.click();
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 30 });
  }
}

async function downloadMedia(ref: MediaRef, dir: string): Promise<string> {
  const res = await fetch(ref.presignedUrl);
  if (!res.ok) throw new Error(`media download failed: ${res.status} ${ref.presignedUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== ref.sha256) throw new Error(`media sha256 mismatch: ${ref.filename}`);
  const file = join(dir, ref.filename);
  writeFileSync(file, buf);
  return file;
}

async function findFirst(page: Page, selectors: readonly string[]) {
  for (const s of selectors) {
    try {
      const loc = page.locator(s).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return loc;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

async function waitForEditorLoaded(page: Page, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const s of DOUYIN_SELECTORS.publish.titleInputs) {
      try {
        if (await page.locator(s).first().isVisible()) return;
      } catch {
        /* continue */
      }
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('编辑器加载超时（图片上传可能失败）');
}

async function setVisibilityIfPresent(page: Page, visibility: 'public' | 'self_only') {
  if (visibility !== 'self_only') return;
  for (const s of DOUYIN_SELECTORS.publish.visibilityOptions) {
    try {
      const loc = page.locator(s).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.click();
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      /* continue */
    }
  }
}

async function smsWallVisible(page: Page): Promise<boolean> {
  for (const s of DOUYIN_SELECTORS.publish.smsWallIndicators) {
    try {
      if (await page.locator(s).first().isVisible()) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

const SMS_WALL_WAIT_MS = 300_000;

async function handleSmsWall(page: Page, ctx: TaskContext): Promise<'none' | 'resolved' | 'timeout'> {
  if (!(await smsWallVisible(page))) return 'none';
  const key = await uploadScreenshot(page, 'sms_wall', ctx);
  ctx.emit({
    type: 'awaiting_human',
    reason: 'sms',
    hint: '请在执行器电脑的浏览器窗口完成安全验证（手机验证码/滑块）',
    screenshotKey: key,
  });
  const start = Date.now();
  while (Date.now() - start < SMS_WALL_WAIT_MS) {
    if (ctx.cancelled()) return 'timeout';
    await page.waitForTimeout(3000);
    if (!(await smsWallVisible(page))) {
      await page.waitForTimeout(2000);
      return 'resolved';
    }
  }
  return 'timeout';
}

async function waitForPublishOutcome(page: Page, timeoutMs = 60_000): Promise<"success" | "unknown"> {
  const start = Date.now();
  let lastUrl = '';
  try {
    lastUrl = page.url();
  } catch {
    /* page may be closing */
  }
  while (Date.now() - start < timeoutMs) {
    for (const s of DOUYIN_SELECTORS.publish.successIndicators) {
      try {
        if (await page.locator(s).first().isVisible()) return 'success';
      } catch {
        /* continue */
      }
    }
    // 页面离开编辑器/上传页 = 已提交（跳转到管理页或成功页）
    try {
      const url = page.url();
      if (lastUrl && url !== lastUrl && !/content\/(upload|post)/.test(url)) {
        return 'success';
      }
    } catch {
      /* continue */
    }
    await page.waitForTimeout(2000);
  }
  return 'unknown';
}

export async function runPublishImage(task: TaskEnvelope, ctx: TaskContext) {
  const params = task.params as unknown as PublishParams;
  const context = await getProfileContext(params.profileKey);

  // 登录态：优先本地 profile；云备份注入兜底
  try {
    const state = await fetchCredential(params.credentialTicket);
    await context.addCookies((state.cookies ?? []) as never[]);
  } catch {
    ctx.emit({ type: 'log', level: 'warn', message: 'credential exchange failed, relying on local profile' });
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  ctx.emit({ type: 'progress', step: 'open_upload_page' });
  await page.goto(DOUYIN_SELECTORS.publish.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  // 登录态检查
  if (DOUYIN_SELECTORS.loginPathPattern.test(page.url())) {
    ctx.emit({ type: 'failed', code: 'LOGIN_EXPIRED', message: '登录态已失效' });
    return;
  }

  // publish 模式：发布前幂等检查（在编辑前做，此时页面导航无损失）
  if (params.mode === 'publish') {
    ctx.emit({ type: 'progress', step: 'idempotency_check' });
    const recentWorks = await listWorksFromManagePage(context, ctx);
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/#/g, '');
    const topicLine = params.body
      .split(/\s+/)
      .filter((w) => w.startsWith('#'))
      .join(' ');
    const candidates = [params.title, topicLine].map(normalize).filter((c) => c.length > 0);
    const dup = recentWorks.find((w) => {
      const wn = normalize(w.title);
      if (!wn) return false;
      return candidates.some((c) => wn.includes(c) || c.includes(wn));
    });
    if (dup) {
      ctx.emit({ type: 'log', level: 'warn', message: `疑似重复作品: ${dup.title}` });
      ctx.emit({
        type: 'result',
        data: { ok: true, workId: dup.id, url: dup.url, works: recentWorks },
      });
      return;
    }
    await page.goto(DOUYIN_SELECTORS.publish.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
  }

  // 下载媒体并上传
  ctx.emit({ type: 'progress', step: 'download_media' });
  const dir = mkdtempSync(join(tmpdir(), 'agent-pub-'));
  try {
    const files: string[] = [];
    for (const ref of params.media) {
      files.push(await downloadMedia(ref, dir));
    }

    ctx.emit({ type: 'progress', step: 'upload_images' });
    // 文件输入框是隐藏的，按存在性查找（不要求可见）
    let fileInput = page.locator(DOUYIN_SELECTORS.publish.fileInputs[0]).first();
    if ((await fileInput.count()) === 0) {
      // 编辑器残留状态：先清空重传
      const clearBtn = await findFirst(page, DOUYIN_SELECTORS.publish.clearResetButtons);
      if (clearBtn) {
        ctx.emit({ type: 'log', level: 'info', message: '检测到编辑器残留，清空并重新上传' });
        await clearBtn.click();
        await page.waitForTimeout(3000);
        fileInput = page.locator(DOUYIN_SELECTORS.publish.fileInputs[0]).first();
      }
    }
    if ((await fileInput.count()) === 0) {
      const entryBtn = await findFirst(page, DOUYIN_SELECTORS.publish.uploadEntryButtons);
      if (entryBtn) {
        await entryBtn.click();
        await page.waitForTimeout(3000);
        fileInput = page.locator(DOUYIN_SELECTORS.publish.fileInputs[0]).first();
      }
    }
    if ((await fileInput.count()) === 0) {
      await uploadScreenshot(page, 'no_file_input', ctx);
      ctx.emit({ type: 'failed', code: 'SELECTOR_MISSING', message: '未找到图片上传入口' });
      return;
    }
    await fileInput.setInputFiles(files);
    // 上传后页面会跳转到编辑器（/content/post/image），等待编辑器出现
    await waitForEditorLoaded(page);
    await uploadScreenshot(page, 'images_uploaded', ctx);

    // 标题
    ctx.emit({ type: 'progress', step: 'fill_title' });
    const titleInput = await findFirst(page, DOUYIN_SELECTORS.publish.titleInputs);
    if (!titleInput) {
      ctx.emit({ type: 'failed', code: 'SELECTOR_MISSING', message: '未找到标题输入框' });
      return;
    }
    await titleInput.click();
    for (const ch of params.title) {
      await page.keyboard.type(ch, { delay: 30 });
    }

    // 正文 + 话题
    ctx.emit({ type: 'progress', step: 'fill_body' });
    const bodyEditor = await findFirst(page, DOUYIN_SELECTORS.publish.bodyEditors);
    if (bodyEditor) {
      await bodyEditor.click();
      for (const ch of params.body) {
        await page.keyboard.type(ch, { delay: 20 });
        if (ch === '#') {
          // 话题联想：等待下拉出现后按 Enter 选中第一个
          await page.waitForTimeout(1500);
          const suggestion = await findFirst(page, DOUYIN_SELECTORS.publish.topicSuggestion);
          if (suggestion) {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
          }
        }
      }
    } else {
      ctx.emit({ type: 'log', level: 'warn', message: '未找到正文编辑器，跳过正文' });
    }

    await page.waitForTimeout(1500);
    await uploadScreenshot(page, 'filled', ctx);

    if (params.mode === 'draft') {
      ctx.emit({ type: 'progress', step: 'save_draft' });
      const draftBtn = await findFirst(page, DOUYIN_SELECTORS.publish.saveDraftButtons);
      if (!draftBtn) {
        ctx.emit({ type: 'failed', code: 'SELECTOR_MISSING', message: '未找到存草稿按钮' });
        return;
      }
      await draftBtn.click();
      await page.waitForTimeout(5000);
      await uploadScreenshot(page, 'draft_saved', ctx);
      ctx.emit({
        type: 'result',
        data: { ok: true, draftRef: { savedAt: new Date().toISOString() } },
      });
      return;
    }

    // publish 模式：直接点发布（幂等检查已在上传前完成）
    ctx.emit({ type: 'progress', step: 'click_publish' });
    const publishBtn = await findFirst(page, DOUYIN_SELECTORS.publish.publishButtons);
    if (!publishBtn) {
      ctx.emit({ type: 'failed', code: 'SELECTOR_MISSING', message: '未找到发布按钮' });
      return;
    }
    await publishBtn.click();
    await page.waitForTimeout(3000);

    // 发布确认弹窗：设置可见性 + 最终确认
    await setVisibilityIfPresent(page, params.visibility);
    await uploadScreenshot(page, 'publish_dialog', ctx);

    // 安全验证墙（手机验证码/滑块）：等待人工在执行器电脑完成
    const wallResult = await handleSmsWall(page, ctx);
    if (wallResult === 'timeout') {
      ctx.emit({ type: 'failed', code: 'SMS_CHALLENGE', message: '手机验证码等待超时' });
      return;
    }
    // 验证完成后弹窗可能还需要点一次确认发布
    const confirmBtn = await findFirst(page, DOUYIN_SELECTORS.publish.finalConfirmButtons);
    if (confirmBtn) {
      await confirmBtn.click();
      ctx.emit({ type: 'log', level: 'info', message: wallResult === 'resolved' ? '验证完成，已点击确认发布' : '已点击确认发布' });
    }

    // 判定发布结果：成功提示/页面跳转 = 成功；
    // 验证弹窗残留不再判失败（人工已完成验证），不确定时按成功处理（对账兜底验证）
    const outcome = await waitForPublishOutcome(page);
    await uploadScreenshot(page, 'published', ctx);
    ctx.emit({
      type: 'log',
      level: outcome === 'success' ? 'info' : 'warn',
      message:
        outcome === 'success'
          ? '检测到发布成功'
          : '页面无明确成功提示，按已提交处理，由对账验证发布结果',
    });
    ctx.emit({ type: 'result', data: { ok: true } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
