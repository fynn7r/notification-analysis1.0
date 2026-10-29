import { test, expect } from '@playwright/test';

const text = '本周四晚20:00开展青马学堂分享会，报名截止为本周三中午12点，不报名无法入场。';
const notification = { id: 'interpret-test', rawText: text, type: '讲座分享', title: '青马学堂', importance: 'medium', importanceReason: '报名有截止', source: 'real', parsedAt: 1 };
const result = {
  source: 'real', original_notification_summary: '参加分享会需要提前报名。',
  interpretation_items: [{ interpretation_content: '报名是入场的前置条件。', action_suggestion: '先填写报名表。', confidence: '高', evidence: '不报名无法入场', remarks: '原文明确' }],
  overall_suggestion: '优先完成报名，再安排参会。',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    localStorage.setItem('__app_notizhi_onboarded', '1');
    if (!localStorage.getItem('__app_notizhi_parse_session')) {
      localStorage.setItem('__app_notizhi_parse_session', JSON.stringify({ result: value, parsing: false, impliedLoading: false, supplements: [], summaryText: '', updatedAt: 1 }));
      localStorage.setItem('__app_notizhi_history', JSON.stringify([value]));
      localStorage.setItem('__app_notizhi_history_init', '1');
      localStorage.setItem('__app_notizhi_draft', JSON.stringify(value.rawText));
    }
  }, notification);
});

test('深度解读使用本地接口，等待时禁止重复点击，显示原文依据，保存现有历史后刷新仍在', async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/interpret', async (route) => {
    calls++;
    const input = route.request().postDataJSON();
    expect(input.text).toBe(text);
    expect(input.ruleContext).toContain('示例规则，仅供演示');
    await pending;
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 解读', exact: true }).click();
  await expect(page.getByRole('button', { name: '解读中', exact: true })).toBeDisabled();
  release();
  await expect(page.getByText('报名是入场的前置条件。', { exact: true })).toBeVisible();
  await expect(page.getByText('原文依据：不报名无法入场', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_history') || '[]')[0].impliedMeaning.source)).toBe('real');
  await page.reload();
  await expect(page.getByText('报名是入场的前置条件。', { exact: true })).toBeVisible();
});

for (const [code, message] of [
  ['AI_NOT_CONFIGURED', '请在“我的 → 模型接入”完成配置。'],
  ['AI_OUTPUT_TRUNCATED', '模型输出达到 16384 token 上限被截断：本轮思考过程占用约 7900 token，与正文共用同一额度；原文已保留。可在“我的 → 模型接入”调高输出上限后重试。'],
  ['AI_AUTH_FAILED', '模型密钥无效或已失效，请检查服务端配置。'],
]) {
  test(`${code} 解读失败保留原文、解析结果与历史，不自动重试`, async ({ page }) => {
    let calls = 0;
    await page.route('**/api/interpret', (route) => { calls++; return route.fulfill({ status: 502, json: { error: { code, message } } }); });
    await page.goto('/');
    await page.getByRole('button', { name: 'AI 解读', exact: true }).click();
    await expect(page.getByRole('alert').first()).toHaveText(message);
    await expect(page.getByText('青马学堂', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI 解读', exact: true })).toBeEnabled();
    expect(calls).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_parse_session') || '{}').result)).toEqual(notification);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_history') || '[]'))).toEqual([notification]);
  });
}

test('解读接口返回无效结构不当作成功，不保存空解读', async ({ page }) => {
  await page.route('**/api/interpret', (route) => route.fulfill({ json: { ...result, interpretation_items: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 解读', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('深度解读格式无效');
  await expect(page.getByText('原文依据：不报名无法入场', { exact: true })).not.toBeVisible();
});
