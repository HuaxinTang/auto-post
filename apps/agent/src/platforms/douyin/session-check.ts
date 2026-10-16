import type { TaskEnvelope } from '@auto-post/contracts';
import type { TaskContext } from '../../task-runner';
import { getProfileContext } from '../../browser/launcher';
import { DOUYIN_CREATOR_HOME, DOUYIN_SELECTORS } from './selectors';

export async function runSessionCheck(task: TaskEnvelope, ctx: TaskContext) {
  const params = task.params as { profileKey: string };
  const context = await getProfileContext(params.profileKey);
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  ctx.emit({ type: 'progress', step: 'check_session' });
  try {
    await page.goto(DOUYIN_CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    ctx.emit({ type: 'failed', code: 'NETWORK', message: '打开创作者中心失败' });
    return;
  }
  await page.waitForTimeout(3000);

  const url = page.url();
  if (DOUYIN_SELECTORS.loginPathPattern.test(url)) {
    ctx.emit({ type: 'result', data: { ok: false } });
    return;
  }

  for (const selector of DOUYIN_SELECTORS.loggedInIndicators) {
    try {
      if (await page.locator(selector).first().isVisible()) {
        ctx.emit({ type: 'result', data: { ok: true } });
        return;
      }
    } catch {
      /* continue */
    }
  }

  const qrVisible = await page
    .locator(DOUYIN_SELECTORS.qrCandidates[0])
    .first()
    .isVisible()
    .catch(() => false);
  ctx.emit({ type: 'result', data: { ok: !qrVisible } });
}
