import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { interpretResponseSchema } from '../shared/interpret-contract.ts';

// 从网页示例通知主动解读，真实调用一次配置的模型；不替换接口、不重试。
let browser;
try {
  const settings = await (await fetch('http://127.0.0.1:3001/api/ai/settings')).json();
  if (!settings.configured) throw new Error('真实深度解读尚未验证：请先在“我的 → 模型接入”配置有效密钥。');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 497, height: 618 }, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('__app_notizhi_onboarded', '1'));
  await page.goto('http://127.0.0.1:8001/');
  await page.getByRole('button', { name: '加载示例', exact: true }).click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/interpret'), { timeout: 45000 });
  await page.getByRole('button', { name: 'AI 解读', exact: true }).click();
  const response = await responsePromise;
  const payload = await response.json();
  if (!response.ok()) throw Object.assign(new Error(payload.error?.message || '深度解读接口返回失败。'), { code: payload.error?.code });
  const result = interpretResponseSchema.parse(payload);
  const text = response.request().postDataJSON().text;
  for (const item of result.interpretation_items) assert.ok(text.includes(item.evidence), '解读依据必须逐字来自原文');
  await expect(page.getByText(result.overall_suggestion, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(result.overall_suggestion, { exact: true })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const directory = new URL('../test-results/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('real-interpretation.json', directory), JSON.stringify(result, null, 2));
  await page.getByText(result.overall_suggestion, { exact: true }).screenshot({ path: 'test-results/real-interpretation.png' });
  console.log(JSON.stringify({ verified: true, model: settings.interpretationModel || settings.model, items: result.interpretation_items.length, persisted: true }));
} catch (error) {
  console.error(JSON.stringify({ verified: false, code: error.code || 'ACCEPTANCE_FAILED', message: error.message }));
  process.exitCode = 1;
} finally { await browser?.close(); }
