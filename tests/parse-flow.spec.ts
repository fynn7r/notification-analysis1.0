import { test, expect } from '@playwright/test';
import { competitionRequest } from '../server/fixtures.mjs';

const notice = 'QQ社团群通知：本周四晚20:00开展青马学堂线下分享会，需要提前填写在线报名表报名，截止时间是本周三中午12点，不报名无法入场。';
// 浏览器测试响应仅用于验证交互与持久化，不能替代 verify:live 的真实模型验收。
const parsed = {
  source: 'real',
  notification: {
    title: '青马学堂线下分享会', type: '讲座分享', registrationDeadline: '2026-10-07T12:00:00+08:00',
    eventStartTime: '2026-10-08T20:00:00+08:00', location: '', targetAudience: '', requirements: '不报名无法入场', contact: '', links: [],
  },
  action: { title: '填写青马学堂报名表', deadline: '2026-10-07T12:00:00+08:00', remindAt: '2026-10-07T11:30:00+08:00' },
  warnings: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('__app_notizhi_onboarded', '1'));
});

test('核对、修改时间后保存，导航及刷新后待办和解析历史均恢复', async ({ page }) => {
  await page.route('**/api/parse', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ referenceDate: '2026-10-05', timezone: 'Asia/Shanghai' });
    await route.fulfill({ json: parsed });
  });
  await page.goto('/');
  await page.getByLabel('通知参考日期').fill('2026-10-05');
  await page.getByLabel('通知原文').fill(notice);
  await page.getByRole('button', { name: '智能解析', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('需要完成的动作')).toHaveValue('填写青马学堂报名表');
  await expect(page.getByLabel('待办截止时间（必填）')).toHaveValue('2026-10-07T12:00');
  await expect(page.getByLabel('提醒时间（默认提前30分钟）')).toHaveValue('2026-10-07T11:30');
  await page.getByLabel('需要完成的动作').fill('填写青马学堂报名表（已核对）');
  await page.getByLabel('待办截止时间（必填）').fill('2026-10-07T13:00');
  await expect(page.getByLabel('提醒时间（默认提前30分钟）')).toHaveValue('2026-10-07T12:30');
  await page.getByLabel('活动开始时间（可选，独立于截止时间）').fill('2026-10-08T21:00');
  await page.getByRole('button', { name: '确认并保存待办' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('2026-10-07 13:00', { exact: true })).toBeVisible();
  await expect(page.getByText('2026-10-08 21:00', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]').find((item: { title: string }) => item.title === '填写青马学堂报名表（已核对）'));
  expect(saved.deadline).toBe('2026-10-07T13:00:00+08:00');
  expect(saved.remindAt).toBe('2026-10-07T12:30:00+08:00');
  expect(saved.deadline).not.toBe('2026-10-08T21:00:00+08:00');
  await page.getByRole('button', { name: '核对并添加待办' }).click();
  await page.getByRole('button', { name: '确认并保存待办' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]').filter((item: { title: string }) => item.title === '填写青马学堂报名表（已核对）').length)).toBe(1);
  await page.getByRole('link', { name: '提醒事项', exact: true }).click();
  await expect(page.getByText('填写青马学堂报名表（已核对）', { exact: true })).toBeVisible();
  await expect(page.getByText('截止：2026-10-07 13:00', { exact: true })).toBeVisible();
  await expect(page.getByText('提醒：2026-10-07 12:30', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('填写青马学堂报名表（已核对）', { exact: true })).toBeVisible();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_history') || '[]').find((item: { source: string }) => item.source === 'real'));
  expect(history.eventStartTime).toBe('2026-10-08T21:00:00+08:00');
  expect(history.primaryAction.title).toBe('填写青马学堂报名表（已核对）');
});

test('缺失截止时间时要求补齐，拒绝把活动开始直接保存为截止', async ({ page }) => {
  await page.route('**/api/parse', (route) => route.fulfill({ json: {
    ...parsed, notification: { ...parsed.notification, registrationDeadline: null },
    action: { ...parsed.action, deadline: null, remindAt: null }, warnings: ['请手动补齐待办截止时间'],
  } }));
  await page.goto('/');
  await page.getByLabel('通知原文').fill('本周四晚20:00开展青马学堂线下分享会。');
  await page.getByRole('button', { name: '智能解析', exact: true }).click();
  await expect(page.getByLabel('待办截止时间（必填）')).toHaveValue('');
  await expect(page.getByLabel('活动开始时间（可选，独立于截止时间）')).toHaveValue('2026-10-08T20:00');
  await page.getByRole('button', { name: '确认并保存待办' }).click();
  await expect(page.getByRole('alert')).toContainText('活动时间不能代替截止时间');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]').some((item: { title: string }) => item.title === '填写青马学堂报名表'))).toBe(false);
  await page.getByLabel('待办截止时间（必填）').fill('2026-10-07T12:00');
  await page.getByRole('button', { name: '确认并保存待办' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('解析失败保留原文和草稿，不写入真实记录，页面明确显示未验证', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { configured: false, realParseVerified: false } }));
  await page.route('**/api/parse', (route) => route.fulfill({ status: 503, json: { error: { code: 'AI_NOT_CONFIGURED', message: '真实解析尚未验证：服务端尚未配置模型密钥。' } } }));
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('真实解析尚未验证');
  await page.getByLabel('通知原文').fill(notice);
  await page.getByRole('button', { name: '智能解析', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('服务端尚未配置模型密钥');
  await expect(page.getByLabel('通知原文')).toHaveValue(notice);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_history') || '[]').filter((item: { source: string }) => item.source === 'real').length)).toBe(0);
  await page.reload();
  await expect(page.getByLabel('通知原文')).toHaveValue(notice);
});

test('手机宽度下可填写与核对，无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/parse', (route) => route.fulfill({ json: parsed }));
  await page.goto('/');
  await page.getByLabel('通知原文').fill(notice);
  await page.getByRole('button', { name: '智能解析', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/confirmation-mobile.png', animations: 'disabled' });
});

test('浏览器存储失败时保留确认表单，不误报待办已保存', async ({ page }) => {
  await page.route('**/api/parse', (route) => route.fulfill({ json: parsed }));
  await page.goto('/');
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === '__app_notizhi_reminders') throw new DOMException('Storage full', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    };
  });
  await page.getByLabel('通知原文').fill(notice);
  await page.getByRole('button', { name: '智能解析', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存待办' }).click();
  await expect(page.getByText('待办未保存，请释放浏览器存储空间后重试。', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('需要完成的动作')).toHaveValue('填写青马学堂报名表');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]').some((item: { title: string }) => item.title === '填写青马学堂报名表'))).toBe(false);
});

for (const [code, message] of [
  ['AI_OUTPUT_TRUNCATED', '模型输出达到 16384 token 上限被截断：本轮思考过程占用约 7900 token，与正文共用同一额度；原文已保留。可在“我的 → 模型接入”调高输出上限后重试。'],
  ['AI_EMPTY_OUTPUT', '模型没有返回解析内容，原文已保留，请重试。'],
  ['INVALID_MODEL_OUTPUT', '模型返回的 JSON 或字段格式无效，请重试；未保存解析结果。'],
]) {
  test(`${code} 保留输入和草稿，不保存真实记录或自动重试`, async ({ page }) => {
    let requests = 0;
    await page.route('**/api/parse', (route) => {
      requests++;
      return route.fulfill({ status: 502, json: { error: { code, message } } });
    });
    await page.goto('/');
    await page.getByLabel('通知原文').fill(competitionRequest.text);
    await page.getByRole('button', { name: '智能解析', exact: true }).click();
    await expect(page.getByRole('alert').first()).toHaveText(message);
    await expect(page.getByLabel('通知原文')).toHaveValue(competitionRequest.text);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(requests).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_history') || '[]').filter((item: { source: string }) => item.source === 'real').length)).toBe(0);
    await page.reload();
    await expect(page.getByLabel('通知原文')).toHaveValue(competitionRequest.text);
  });
}

test('完整竞赛示例解析后进入核对，日期占位词需要人工补齐', async ({ page }) => {
  await page.route('**/api/parse', (route) => route.fulfill({ json: {
    ...parsed,
    notification: { ...parsed.notification, title: '数学建模竞赛校内选拔赛', type: '比赛竞赛', registrationDeadline: null, eventStartTime: null, location: '数模竞赛管理系统-作品提交栏' },
    action: { title: '组队并完成报名', deadline: null, remindAt: null },
    warnings: ['截止时间原文「报名截止日 23:59」缺少明确完整的日期或时间，请手动补齐。', '活动时间原文「竞赛当天上午9:00」缺少明确完整的日期或时间，请手动补齐。'],
  } }));
  await page.goto('/');
  await page.getByLabel('通知参考日期').fill(competitionRequest.referenceDate);
  await page.getByLabel('通知原文').fill(competitionRequest.text);
  await page.getByRole('button', { name: '智能解析', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('需要完成的动作')).toHaveValue('组队并完成报名');
  await expect(page.getByLabel('待办截止时间（必填）')).toHaveValue('');
  await expect(page.getByLabel('提醒时间（默认提前30分钟）')).toHaveValue('');
  await expect(page.getByLabel('活动开始时间（可选，独立于截止时间）')).toHaveValue('');
  await page.getByRole('button', { name: '确认并保存待办' }).click();
  await expect(page.getByRole('alert')).toContainText('请补齐有效的待办截止日期');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]').some((item: { title: string }) => item.title === '组队并完成报名'))).toBe(false);
  await page.getByRole('button', { name: '暂不添加', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('待补齐具体截止日期/时间', { exact: true })).toBeVisible();
  await expect(page.getByText('数模竞赛管理系统-作品提交栏', { exact: true })).toBeVisible();
  await expect(page.getByText('截止时间原文「报名截止日 23:59」缺少明确完整的日期或时间，请手动补齐。', { exact: true })).toBeVisible();
  await expect(page.getByText('活动时间原文「竞赛当天上午9:00」缺少明确完整的日期或时间，请手动补齐。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI 解读', exact: true })).toBeEnabled();
});
