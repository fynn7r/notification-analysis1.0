import { test, expect, type Page } from '@playwright/test';

/**
 * 导航角标的端到端验证。
 *
 * 重点不是「有没有渲染出来」，而是三个口径：
 * 1. 红点只数未完成的，勾掉的不算；
 * 2. 灰点只数已过截止的，且与红点互斥 —— 否则两数相加对不上，用户会怀疑数据；
 * 3. 某一类为 0 时对应的点必须消失，不能显示「0」。
 */

const DAY = 86_400_000;

function reminder(id: string, deadlineOffsetDays: number, completed = false) {
  const deadline = new Date(Date.now() + deadlineOffsetDays * DAY).toISOString();
  return {
    id,
    title: `待办 ${id}`,
    type: '其他',
    importance: 'medium',
    deadline,
    remindAt: deadline,
    completed,
    source: 'personal',
    createdAt: Date.now(),
  };
}

async function seed(page: Page, items: unknown[]) {
  await page.addInitScript((data) => {
    localStorage.setItem('__app_notizhi_onboarded', '1');
    localStorage.setItem('__app_notizhi_reminders_init', '1');
    localStorage.setItem('__app_notizhi_reminders', JSON.stringify(data));
  }, items);
}

test('角标：红点数未完成、灰点数已过期，已完成的不计入', async ({ page }) => {
  await seed(page, [
    reminder('a', 5),
    reminder('b', 2),
    reminder('c', 9),
    reminder('d', -3),
    reminder('e', -10),
    // 已完成：哪怕早就过期，也不该出现在任何一个角标里
    reminder('f', -20, true),
  ]);
  await page.goto('/reminders');

  await expect(page.getByTitle('3 条待办')).toBeVisible();
  await expect(page.getByTitle('2 条已过期')).toBeVisible();
});

test('角标：没有过期项时不显示灰点', async ({ page }) => {
  await seed(page, [reminder('a', 1), reminder('b', 4)]);
  await page.goto('/reminders');

  await expect(page.getByTitle('2 条待办')).toBeVisible();
  await expect(page.locator('[title$="条已过期"]')).toHaveCount(0);
});

test('角标：只剩过期项时红点消失，不留一个 0', async ({ page }) => {
  await seed(page, [reminder('a', -2), reminder('b', -6)]);
  await page.goto('/reminders');

  await expect(page.getByTitle('2 条已过期')).toBeVisible();
  await expect(page.locator('[title$="条待办"]')).toHaveCount(0);
});

test('角标：超过 99 收成 99+，不把三位数塞进小圆点', async ({ page }) => {
  await seed(page, Array.from({ length: 120 }, (_, i) => reminder(`n${i}`, 7)));
  await page.goto('/reminders');

  const badge = page.getByTitle('120 条待办');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('99+');
});

test('角标：全部完成时两个点都消失', async ({ page }) => {
  await seed(page, [reminder('a', 3, true), reminder('b', -3, true)]);
  await page.goto('/reminders');

  await expect(page.locator('[title$="条待办"]')).toHaveCount(0);
  await expect(page.locator('[title$="条已过期"]')).toHaveCount(0);
});
