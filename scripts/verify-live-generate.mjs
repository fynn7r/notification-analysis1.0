import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { generateResponseSchema } from '../shared/generate-contract.ts';
import { generationRequest } from '../server/fixtures.mjs';

// 通过网页按钮真实调用一次配置的模型，不替换接口、不自动重试。
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 497, height: 618 }, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('__app_notizhi_onboarded', '1'));
  await page.goto('http://127.0.0.1:8001/generator');
  for (const [field, label] of Object.entries({
    topic: '通知主题', activityType: '活动类型', time: '活动时间', location: '活动地点',
    participants: '参加对象', registrationMethod: '报名方式', deadline: '截止时间',
    requirements: '作品/材料要求', notes: '注意事项 / 奖励说明',
  })) await page.getByLabel(label, { exact: true }).fill(generationRequest[field]);
  await page.getByRole('button', { name: /^社团活动风/ }).click();
  await page.getByRole('switch', { name: '活泼风模式', exact: true }).check();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/generate'), { timeout: 45000 });
  await page.getByRole('button', { name: '智能生成通知', exact: true }).click();
  const response = await responsePromise;
  assert.deepEqual(response.request().postDataJSON(), generationRequest);
  const payload = await response.json();
  if (!response.ok()) throw Object.assign(new Error(payload.error?.message || '通知生成接口返回失败。'), { code: payload.error?.code });
  const result = generateResponseSchema.parse(payload);
  const artifactDirectory = new URL('../test-results/', import.meta.url);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(new URL('real-generated-notice.json', artifactDirectory), JSON.stringify(result, null, 2));
  await expect(page.locator('pre')).toHaveText(result.content);
  await page.locator('pre').screenshot({ path: 'test-results/real-generated-notice.png' });
  for (const field of ['topic', 'time', 'location', 'participants', 'deadline', 'registrationMethod']) {
    assert.ok(result.content.includes(generationRequest[field]), `真实文案缺少 ${field}`);
  }
  // 分句后的条件分别核对，允许把逗号改成换行或编号；不要求整段逐字相同。
  for (const condition of generationRequest.requirements.split('，')) {
    assert.ok(result.content.includes(condition), `真实文案缺少要求：${condition}`);
  }
  assert.ok(result.content.includes('10分钟'), '真实文案缺少提前到场的时间要求');
  assert.doesNotMatch(result.content, /名额有限|先到先得|额满即止|免费参加|赠品/, '示例未提供的限制或福利不能添加到文案');
  assert.match(result.content, /\p{Extended_Pictographic}/u, '启用表情开关时应有表情装饰');
  await expect(page.getByRole('button', { name: '复制全文', exact: true })).toBeEnabled();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log(JSON.stringify({ verified: true, sample: '社团活动风（含表情与独立截止时间）', result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ verified: false, code: error.code || 'ACCEPTANCE_FAILED', message: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
