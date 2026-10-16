import { chromium } from 'playwright';
import { join } from 'node:path';

async function dump(page: import('playwright').Page, label: string) {
  console.log(`===== ${label} | URL: ${page.url()}`);
  for (const frame of page.frames()) {
    const inputs = await frame
      .locator('input')
      .evaluateAll((els) =>
        els.slice(0, 15).map((e) => ({
          type: e.getAttribute('type'),
          accept: (e.getAttribute('accept') ?? '').slice(0, 60),
          placeholder: e.getAttribute('placeholder'),
          cls: e.className.toString().slice(0, 80),
        }))
      )
      .catch(() => []);
    if (inputs.length) console.log('  frame:', frame.url().slice(0, 90), '\n  inputs:', JSON.stringify(inputs, null, 1));
    const divs = await frame
      .locator('div[contenteditable="true"], [contenteditable="true"]')
      .evaluateAll((els) => els.slice(0, 5).map((e) => ({ cls: e.className.toString().slice(0, 80) })))
      .catch(() => []);
    if (divs.length) console.log('  contenteditables:', JSON.stringify(divs));
    const buttons = await frame
      .locator('button')
      .evaluateAll((els) =>
        els.slice(0, 25).map((e) => ({ text: (e.textContent ?? '').trim().slice(0, 30), cls: e.className.toString().slice(0, 60) }))
      )
      .catch(() => []);
    if (buttons.length) console.log('  buttons:', JSON.stringify(buttons, null, 1));
  }
}

async function main() {
  const profileDir = process.argv[2] ?? './.profiles/acct_diag';
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(process.argv[3] ?? 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(5000);
  await dump(page, '初始状态');

  // 点击上传图文按钮
  const uploadBtn = page.locator('button:has-text("上传图文")').first();
  if (await uploadBtn.isVisible().catch(() => false)) {
    console.log('>>> 点击 上传图文');
    await uploadBtn.click();
    await page.waitForTimeout(3000);
    await dump(page, '点击上传图文后');
  }

  // 直接尝试 setInputFiles
  const fileInput = page.locator('input[type="file"]').first();
  const count = await fileInput.count();
  console.log('>>> file input count:', count);
  if (count > 0) {
    await fileInput.setInputFiles([
      join(process.cwd(), '..', 'api', '.storage', 'screenshots', '85628071-edff-43bf-961d-4fa262dc2029.png'),
      join(process.cwd(), '..', 'api', '.storage', 'screenshots', '5c2f015e-287f-4de6-8a3b-fd639ca7d187.png'),
    ]);
    console.log('>>> files set, waiting upload...');
    await page.waitForTimeout(15000);
    await dump(page, '上传后（编辑器状态）');
  }
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
