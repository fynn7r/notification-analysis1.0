import { test, expect } from '@playwright/test';

const settings = {
  configured: true, baseUrl: 'https://api.deepseek.com', model: 'default-model',
  interpretationModel: '', generateModel: '', consoleUrl: 'https://platform.deepseek.com',
  balanceSupported: true, maxOutputTokens: 2048,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('__app_notizhi_onboarded', '1'));
});

test('页面读取配置不回显密钥，不自动查询或调用模型；保存后立即显示新模型，不在浏览器存密钥', async ({ page }) => {
  let calls = 0;
  let saved: Record<string, unknown> = {};
  await page.route('**/api/ai/settings', (route) => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { ...settings, ...saved, apiKey: undefined } });
    }
    return route.fulfill({ json: settings });
  });
  await page.route(/\/api\/(ai\/(models|balance)|parse|generate|interpret)$/, (route) => { calls++; return route.abort(); });
  await page.goto('/profile#model-access');
  await expect(page.getByLabel('API 密钥')).toHaveValue('');
  await page.getByLabel('API 密钥').fill('browser-test-secret');
  await page.getByLabel('深度解读模型（可选）', { exact: true }).fill('new-interpret');
  await page.getByLabel('通知生成模型（可选）', { exact: true }).fill('new-generate');
  await expect(page.getByRole('button', { name: '读取可用模型', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存模型配置', exact: true }).click();
  await expect(page.getByText('当前默认：default-model；解读：new-interpret；生成：new-generate', { exact: true })).toBeVisible();
  expect(saved.apiKey).toBe('browser-test-secret');
  await expect(page.getByLabel('API 密钥')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('browser-test-secret'))).toBe(false);
  expect(calls).toBe(0);
});

test('可用模型与账户余额由用户点击查询，显示货币与刷新时间，小屏幕无溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/ai/settings', (route) => route.fulfill({ json: settings }));
  let models = 0;
  let balances = 0;
  await page.route('**/api/ai/models', (route) => { models++; return route.fulfill({ json: { models: ['default-model', 'better-model'] } }); });
  await page.route('**/api/ai/balance', (route) => {
    balances++;
    return route.fulfill({ json: { available: true, balances: [{ currency: 'CNY', total: '12.34', granted: '2.00', toppedUp: '10.34' }], checkedAt: '2026-10-09T00:00:00Z' } });
  });
  await page.goto('/profile');
  await expect(page.getByLabel('默认模型（通知解析）', { exact: true })).toHaveValue('default-model');
  expect(models).toBe(0);
  expect(balances).toBe(0);
  await page.getByRole('button', { name: '读取可用模型', exact: true }).click();
  await expect(page.getByText('接口返回的模型：default-model、better-model', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查询账户余额', exact: true }).click();
  await expect(page.getByText('可用余额：12.34 CNY（赠金 2.00，充值 10.34）', { exact: true })).toBeVisible();
  await expect(page.getByText(/查询时间：/)).toBeVisible();
  expect(models).toBe(1);
  expect(balances).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#model-access').screenshot({ path: 'test-results/model-settings-mobile.png' });
});

test('配置保存失败保留填写信息和原有效模型，不误报已生效', async ({ page }) => {
  await page.route('**/api/ai/settings', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: settings })
    : route.fulfill({ status: 500, json: { error: { code: 'AI_SETTINGS_SAVE_FAILED', message: '模型配置未保存，原配置仍有效。' } } }));
  await page.goto('/profile');
  await page.getByLabel('API 密钥').fill('keep-me-on-failure');
  await page.getByLabel('默认模型（通知解析）', { exact: true }).fill('unsaved-model');
  await page.getByRole('button', { name: '保存模型配置', exact: true }).click();
  await expect(page.getByRole('alert').first()).toHaveText('模型配置未保存，原配置仍有效。');
  await expect(page.getByLabel('API 密钥')).toHaveValue('keep-me-on-failure');
  await expect(page.getByLabel('默认模型（通知解析）', { exact: true })).toHaveValue('unsaved-model');
  await expect(page.getByText('当前默认：default-model；解读：default-model；生成：default-model', { exact: true })).toBeVisible();
});

test('余额鉴权失败不显示假额度，兼容服务提供控制台入口', async ({ page }) => {
  await page.route('**/api/ai/settings', (route) => route.fulfill({ json: settings }));
  let calls = 0;
  await page.route('**/api/ai/balance', (route) => {
    calls++;
    return route.fulfill({ status: 502, json: { error: { code: 'AI_AUTH_FAILED', message: '密钥无效或无查询权限，请检查模型配置。' } } });
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: '查询账户余额', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('密钥无效');
  await expect(page.getByText(/可用余额：/)).not.toBeVisible();
  expect(calls).toBe(1);
  await page.route('**/api/ai/settings', (route) => route.fulfill({ json: { ...settings, baseUrl: 'https://compatible.test/v1', balanceSupported: false, consoleUrl: 'https://compatible.test/account' } }));
  await page.reload();
  await expect(page.getByRole('button', { name: '查询账户余额', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '打开服务商控制台' })).toHaveAttribute('href', 'https://compatible.test/account');
});

test('解析页与生成页均提供模型入口', async ({ page }) => {
  for (const url of ['/', '/generator']) {
    await page.goto(url);
    await expect(page.getByRole('link', { name: '配置模型 / 查看额度', exact: true })).toHaveAttribute('href', '/profile#model-access');
  }
});
