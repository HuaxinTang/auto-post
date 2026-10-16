import type { BrowserContext, Page } from 'playwright';
import type { TaskEnvelope, WorkItem } from '@auto-post/contracts';
import type { TaskContext } from '../../task-runner';
import { uploadScreenshot } from '../../task-runner';
import { getProfileContext } from '../../browser/launcher';
import { DOUYIN_SELECTORS } from './selectors';

async function getPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  if (pages.length > 0) return pages[0];
  return context.newPage();
}

// 作品卡片解析：抖音管理页作品是 div 卡片（非链接），
// 以"编辑作品/删除作品"按钮为锚点向上找卡片容器。
// 注意：私密图文卡片无"已发布"文字（显示"私密"）、统计为"-"，
// 标题行可能是话题行（#xxx）也可能是标题正文拼接行。
const BUTTON_TEXTS = ['编辑作品', '设置权限', '作品置顶', '删除作品', '复制链接'];
const STAT_TEXTS = ['播放', '点赞', '评论', '分享', '收藏', '完播率', '2秒跳出率', '吸粉量', '划走率', '文案展开率', '平均浏览图片数'];

async function extractWorks(page: Page): Promise<WorkItem[]> {
  return page.evaluate(({ buttonTexts, statTexts }) => {
    const anchors = Array.from(document.querySelectorAll('div, span, button')).filter((el) => {
      const t = (el.textContent ?? '').trim();
      return t === '编辑作品' || t === '删除作品' || t === '设置权限';
    });
    const cards = new Set<HTMLElement>();
    for (const btn of anchors) {
      let node = btn.parentElement;
      for (let i = 0; i < 7 && node; i++) {
        const text = node.innerText ?? '';
        if (text.includes('播放') || text.includes('划走率')) {
          cards.add(node);
          break;
        }
        node = node.parentElement;
      }
    }
    const works: Array<{ id: string; title: string; publishTime: string; status: string }> = [];
    for (const card of cards) {
      const text = card.innerText ?? '';
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 1 && l.length < 120);
      const dateIdx = lines.findIndex((l) => /\d{4}年\d{1,2}月\d{1,2}日/.test(l));
      // 标题行 = 日期行之前、非按钮/统计/媒体数标签的行
      const titleLine =
        lines
          .slice(0, dateIdx > 0 ? dateIdx : lines.length)
          .filter(
            (l) =>
              !buttonTexts.includes(l) &&
              !statTexts.includes(l) &&
              !/^\d+张$/.test(l) &&
              !/^已发布/.test(l) &&
              !/^已同步/.test(l)
          )[0] ?? '';
      const status = text.includes('审核中') ? '审核中' : '已发布';
      const dateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})?/);
      let publishTime = new Date(0).toISOString();
      if (dateMatch) {
        const [, y, mo, d, h, mi] = dateMatch;
        publishTime = new Date(
          `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${(h ?? '00').padStart(2, '0')}:${(mi ?? '00').padStart(2, '0')}:00`
        ).toISOString();
      } else if (/(\d+)分钟前|(\d+)小时前|昨天|今天/.test(text)) {
        publishTime = new Date().toISOString();
      }
      if (titleLine) {
        works.push({ id: titleLine.slice(0, 40), title: titleLine, publishTime, status });
      }
    }
    return works;
  }, { buttonTexts: BUTTON_TEXTS, statTexts: STAT_TEXTS });
}

export async function listWorksFromManagePage(
  context: BrowserContext,
  ctx?: TaskContext
): Promise<WorkItem[]> {
  const page = await getPage(context);
  try {
    await page.goto(DOUYIN_SELECTORS.manage.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(8000);
    await page.mouse.wheel(0, 1500).catch(() => undefined);
    await page.waitForTimeout(2000);

    const works = await extractWorks(page);
    if (ctx) {
      await uploadScreenshot(page, 'works_list', ctx);
    }
    return works;
  } catch (e) {
    if (ctx) {
      ctx.emit({ type: 'log', level: 'warn', message: `作品列表读取失败: ${(e as Error).message}` });
    }
    return [];
  }
}

export async function runListWorks(task: TaskEnvelope, ctx: TaskContext) {
  const params = task.params as { profileKey: string; credentialTicket: string };
  const context = await getProfileContext(params.profileKey);
  try {
    const { fetchCredential } = await import('../../api-client');
    const state = await fetchCredential(params.credentialTicket);
    await context.addCookies((state.cookies ?? []) as never[]);
  } catch {
    ctx.emit({ type: 'log', level: 'warn', message: 'credential exchange failed, relying on local profile' });
  }

  const works = await listWorksFromManagePage(context, ctx);
  ctx.emit({ type: 'result', data: { ok: true, works } });
}
