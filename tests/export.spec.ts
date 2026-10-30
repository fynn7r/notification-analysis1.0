import { test, expect } from '@playwright/test';

/**
 * 导出功能的端到端验证。
 *
 * 这里只覆盖「无账号」这条路径：它完全在浏览器里生成文件，不需要服务端，
 * 所以断言可以做到内容级（真的打开了下载下来的文件看里面写了什么）。
 * 有账号那条由 server/reminders-http.test.mjs 覆盖。
 */

const reminders = [
  {
    id: 'r-1', title: '填写青马学堂报名表', type: '报名', importance: 'high',
    // 故意把备注写成带逗号的样子：CSV 必须引号包裹，否则表格列会错位。
    deadline: '2026-10-07T12:00:00+08:00', remindAt: '2026-10-07T11:30:00+08:00',
    remindLeadMinutes: 30, completed: false, source: 'notification',
    createdAt: Date.parse('2026-10-05T10:00:00+08:00'),
    note: '队长：张三, 提交材料：报名表',
  },
  {
    id: 'r-2', title: '没有时间的待办', type: '其他', importance: 'medium',
    deadline: '', remindAt: '', completed: false, source: 'personal',
    createdAt: Date.parse('2026-10-05T11:00:00+08:00'),
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.setItem('__app_notizhi_onboarded', '1');
    localStorage.setItem('__app_notizhi_reminders_init', '1');
    localStorage.setItem('__app_notizhi_reminders', JSON.stringify(data));
  }, reminders);
});

test('导出 CSV 是不带过滤的全量，含 BOM 与转义后的逗号', async ({ page }) => {
  await page.goto('/reminders');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出表格' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^notizhi-reminders-\d{8}\.csv$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');

  expect(text.startsWith('\uFEFF')).toBe(true);
  expect(text).toContain('标题,类型,重要度,截止时间,提醒时间,提前量(分钟),已完成,备注');
  // 没有时间的待办也必须在表格里：少行比空列更让人怀疑数据丢了。
  expect(text).toContain('没有时间的待办');
  // 备注里的逗号被引号包住，否则这一行会被切成 9 列。
  expect(text).toContain('"队长：张三, 提交材料：报名表"');
  expect(text.split('\r\n').filter(Boolean).length).toBe(3);
});

test('导出日历跳过没有时间的待办，并明确告知跳过了几条', async ({ page }) => {
  await page.goto('/reminders');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出日历' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');

  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('SUMMARY:填写青马学堂报名表');
  expect(text).toContain('TRIGGER:-PT30M');
  // 没有截止也没有提醒时间的条目进不了日历，必须被跳过而不是写成空事件。
  expect(text).not.toContain('SUMMARY:没有时间的待办');
  await expect(page.getByText(/1 条因没有截止或提醒时间被跳过/)).toBeVisible();
});
