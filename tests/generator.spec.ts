import { test, expect, type Page } from '@playwright/test';
import { generationRequest } from '../server/fixtures.mjs';

// 页面交互测试响应，真实模型验收单独执行。
const content = `青马学堂线下分享会报名\n活动时间：${generationRequest.time}\n活动地点：${generationRequest.location}\n参加对象：${generationRequest.participants}\n报名截止：${generationRequest.deadline}\n${generationRequest.registrationMethod}\n${generationRequest.requirements}\n${generationRequest.notes}`;
const labels = {
  topic: '通知主题', activityType: '活动类型', time: '活动时间', location: '活动地点',
  participants: '参加对象', registrationMethod: '报名方式', deadline: '截止时间',
  requirements: '作品/材料要求', notes: '注意事项 / 奖励说明',
} as const;

async function fillForm(page: Page) {
  for (const [field, label] of Object.entries(labels)) {
    await page.getByLabel(label, { exact: true }).fill(generationRequest[field]);
  }
  await page.getByRole('button', { name: /^社团活动风/ }).click();
  await page.getByRole('switch', { name: '活泼风模式', exact: true }).check();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('__app_notizhi_onboarded', '1'));
});

test('生成通知传递截止与风格，等待时禁用重复操作，成功后可复制，小屏幕不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 497, height: 618 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as unknown as { copiedNotice: string }).copiedNotice = text; },
    } });
  });
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/generate', async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual(generationRequest);
    await pending;
    await route.fulfill({ json: { source: 'real', content } });
  });
  await page.goto('/generator');
  await fillForm(page);
  await page.getByRole('button', { name: '智能生成通知', exact: true }).click();
  await expect(page.getByRole('button', { name: '生成中...', exact: true })).toBeDisabled();
  await expect(page.getByLabel('截止时间', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重置', exact: true })).toBeDisabled();
  await expect(page.getByRole('switch', { name: '活泼风模式', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('pre')).toHaveText(content);
  await page.getByRole('button', { name: '复制全文', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copiedNotice: string }).copiedNotice)).toBe(content);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const [code, message] of [
  ['AI_AUTH_FAILED', '模型密钥无效或已失效，请检查服务端配置。'],
  ['AI_OUTPUT_TRUNCATED', '模型输出达到 16384 token 上限被截断：本轮思考过程占用约 7900 token，与正文共用同一额度；填写内容已保留。可在“我的 → 模型接入”调高输出上限后重试。'],
]) {
  test(`${code} 不留空成功卡片，保留输入且不自动重试`, async ({ page }) => {
    let requests = 0;
    await page.route('**/api/generate', (route) => {
      requests++;
      return route.fulfill({ status: 502, json: { error: { code, message } } });
    });
    await page.goto('/generator');
    await fillForm(page);
    await page.getByRole('button', { name: '智能生成通知', exact: true }).click();
    await expect(page.getByRole('alert').first()).toHaveText(message);
    await expect(page.getByText('生成结果', { exact: true })).not.toBeVisible();
    await expect(page.getByLabel('截止时间', { exact: true })).toHaveValue(generationRequest.deadline);
    await expect(page.getByLabel('通知主题', { exact: true })).toHaveValue(generationRequest.topic);
    await expect(page.getByRole('button', { name: '智能生成通知', exact: true })).toBeEnabled();
    expect(requests).toBe(1);
  });
}

test('空白文案即使接口返回200也不显示成功，重新点击可恢复生成', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/generate', (route) => {
    requests++;
    return route.fulfill({ json: { source: 'real', content: requests === 1 ? '  ' : content } });
  });
  await page.goto('/generator');
  await fillForm(page);
  await page.getByRole('button', { name: '智能生成通知', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('通知文案格式无效');
  await expect(page.getByText('生成结果', { exact: true })).not.toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole('button', { name: '智能生成通知', exact: true }).click();
  await expect(page.locator('pre')).toHaveText(content);
  expect(requests).toBe(2);
});
