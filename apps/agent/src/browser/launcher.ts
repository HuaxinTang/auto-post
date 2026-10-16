import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';

const profileContexts = new Map<string, BrowserContext>();

const ANTI_DETECTION_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--disable-infobars',
  '--disable-dev-shm-usage',
];

function isContextAlive(ctx: BrowserContext): boolean {
  try {
    ctx.pages();
    return true;
  } catch {
    return false;
  }
}

export async function getProfileContext(profileKey: string): Promise<BrowserContext> {
  let ctx = profileContexts.get(profileKey);
  if (ctx && !isContextAlive(ctx)) {
    // 用户手动关掉了浏览器窗口：丢弃缓存引用，重新启动
    // 登录态保存在磁盘 userDataDir 中，重建后仍然有效
    profileContexts.delete(profileKey);
    ctx = undefined;
  }
  if (!ctx) {
    const userDataDir = join(config.profileDir, profileKey);
    mkdirSync(userDataDir, { recursive: true });
    ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: config.headless,
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: ANTI_DETECTION_ARGS,
    });
    ctx.on('close', () => {
      profileContexts.delete(profileKey);
    });
    profileContexts.set(profileKey, ctx);
  }
  return ctx;
}

export async function getProfilePage(profileKey: string): Promise<Page> {
  const ctx = await getProfileContext(profileKey);
  const pages = ctx.pages();
  if (pages.length > 0) return pages[0];
  return ctx.newPage();
}

export async function saveStorageState(profileKey: string): Promise<Record<string, unknown>> {
  const ctx = await getProfileContext(profileKey);
  return (await ctx.storageState()) as unknown as Record<string, unknown>;
}

export async function closeProfile(profileKey: string): Promise<void> {
  const ctx = profileContexts.get(profileKey);
  if (ctx) {
    profileContexts.delete(profileKey);
    await ctx.close().catch(() => undefined);
  }
}

export async function closeAll(): Promise<void> {
  for (const [key, ctx] of profileContexts) {
    profileContexts.delete(key);
    await ctx.close().catch(() => undefined);
  }
  profileContexts.clear();
}
