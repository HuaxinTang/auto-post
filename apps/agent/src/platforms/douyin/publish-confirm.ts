import type { TaskEnvelope } from '@auto-post/contracts';
import type { TaskContext } from '../../task-runner';
import { uploadScreenshot } from '../../task-runner';
import { getProfileContext } from '../../browser/launcher';
import { fetchCredential } from '../../api-client';
import { DOUYIN_SELECTORS } from './selectors';

interface ConfirmParams {
  profileKey: string;
  credentialTicket: string;
  draftRef?: Record<string, unknown>;
}

async function findFirst(page: import('playwright').Page, selectors: readonly string[]) {
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

export async function runPublishConfirm(task: TaskEnvelope, ctx: TaskContext) {
  const params = task.params as unknown as ConfirmParams;
  const context = await getProfileContext(params.profileKey);
  try {
    const state = await fetchCredential(params.credentialTicket);
    await context.addCookies((state.cookies ?? []) as never[]);
  } catch {
    ctx.emit({ type: 'log', level: 'warn', message: 'credential exchange failed, relying on local profile' });
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  // 打开作品管理页，进入草稿箱
  ctx.emit({ type: 'progress', step: 'open_drafts' });
  await page.goto(DOUYIN_SELECTORS.manage.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(4000);

  const draftTab = await findFirst(page, ['text=草稿', '[class*="draft"] [class*="tab"]', 'text=草稿箱']);
  if (draftTab) {
    await draftTab.click();
    await page.waitForTimeout(3000);
  }

  await uploadScreenshot(page, 'drafts_list', ctx);

  // 打开第一个草稿（最近保存的）
  const draftCard = await findFirst(page, [
    '[class*="draft"] [class*="item"]',
    '[data-e2e*="draft"]',
    '[class*="card"] [class*="draft"]',
  ]);
  let opened = false;
  if (draftCard) {
    await draftCard.click();
    opened = true;
    await page.waitForTimeout(4000);
  } else {
    // 兜底：直接进上传页（草稿可能已自动回填）
    ctx.emit({ type: 'log', level: 'warn', message: '未找到草稿卡片，尝试上传页' });
    await page.goto(DOUYIN_SELECTORS.publish.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(4000);
  }
  await uploadScreenshot(page, 'draft_opened', ctx);

  // 点击发布
  const publishBtn = await findFirst(page, DOUYIN_SELECTORS.publish.publishButtons);
  if (!publishBtn) {
    ctx.emit({ type: 'failed', code: 'SELECTOR_MISSING', message: '未找到发布按钮' });
    return;
  }
  await publishBtn.click();
  await page.waitForTimeout(3000);
  await uploadScreenshot(page, 'publish_dialog', ctx);

  // 可见性 + 最终确认
  const visibility = await findFirst(page, DOUYIN_SELECTORS.publish.visibilityOptions);
  if (visibility) {
    await visibility.click();
    await page.waitForTimeout(1000);
  }
  const confirmBtn = await findFirst(page, DOUYIN_SELECTORS.publish.finalConfirmButtons);
  if (confirmBtn) {
    await confirmBtn.click();
  }
  await page.waitForTimeout(5000);
  await uploadScreenshot(page, 'published', ctx);
  ctx.emit({ type: 'result', data: { ok: true } });
}
