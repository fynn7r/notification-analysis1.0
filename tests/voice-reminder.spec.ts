import { test, expect, type Page } from '@playwright/test';

// 只模拟浏览器识别服务错误，不访问麦克风、不调用真实语音或模型服务。
async function simulateSpeechFailure(page: Page, error: string) {
  await page.addInitScript((errorCode) => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => ({ getTracks: () => [{ stop() {} }] }),
    });
    class FailedRecognition {
      onerror?: (event: { error: string }) => void;
      onend?: () => void;
      start() {
        setTimeout(() => {
          this.onerror?.({ error: errorCode });
          this.onend?.();
        }, 0);
      }
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true, value: FailedRecognition,
    });
  }, error);
}

test.use({ viewport: { width: 497, height: 618 } });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-06T14:00:00-04:00'));
  await page.addInitScript(() => {
    localStorage.setItem('__app_notizhi_onboarded', '1');
    for (const key of ['reminders', 'recurring']) {
      localStorage.setItem(`__app_notizhi_${key}_init`, '1');
      if (localStorage.getItem(`__app_notizhi_${key}`) === null) {
        localStorage.setItem(`__app_notizhi_${key}`, '[]');
      }
    }
  });
});

test('语音服务连接失败保留文字，改用文字解析创建后刷新仍存在', async ({ page }) => {
  await simulateSpeechFailure(page, 'network');
  let modelRequests = 0;
  await page.route('**/api/parse', (route) => {
    modelRequests++;
    return route.abort();
  });
  await page.goto('/reminders');
  await page.getByRole('button', { name: '语音创建', exact: true }).click();
  const content = page.getByLabel('提醒内容（可语音录入或直接填写）');
  await expect(page.getByRole('button', { name: '解析文字', exact: true })).toBeDisabled();
  await content.fill('明天下午三点提醒我交作业');
  await page.getByRole('button', { name: '开始语音录入', exact: true }).click();
  const errorDialog = page.getByRole('dialog', { name: '语音识别服务连接失败', exact: true });
  await expect(errorDialog).toBeVisible();
  await expect(errorDialog).toContainText('具体原因尚未确定');
  await expect(errorDialog).not.toContainText('网络连接不稳定');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]').length)).toBe(0);
  await page.screenshot({ path: 'test-results/simulated-speech-network-error.png', animations: 'disabled' });
  await errorDialog.getByRole('button', { name: '改用文字输入', exact: true }).click();
  await expect(errorDialog).not.toBeVisible();
  await expect(content).toBeFocused();
  await expect(content).toHaveValue('明天下午三点提醒我交作业');
  await page.getByRole('button', { name: '解析文字', exact: true }).click();
  await expect(page.getByText('解析结果预览', { exact: true })).toBeVisible();
  await expect(page.getByText('解析结果预览', { exact: true })).toBeInViewport();
  await expect(page.getByRole('dialog', { name: '语音创建提醒', exact: true })).toContainText('交作业');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const createButton = page.getByRole('button', { name: '创建提醒', exact: true });
  await expect(createButton).toBeInViewport();
  await page.screenshot({ path: 'test-results/speech-text-fallback.png', animations: 'disabled' });
  await createButton.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('交作业', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_reminders') || '[]'));
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    title: '交作业', deadline: '2026-10-07 15:00:00',
    remindAt: '2026-10-07 15:00:00', source: 'personal',
  });
  await page.reload();
  await expect(page.getByText('交作业', { exact: true })).toBeVisible();
  await expect(page.getByText('截止：2026-10-07 15:00', { exact: true })).toBeVisible();
  await expect(page.getByText('提醒：准时', { exact: true })).toBeVisible();
  expect(modelRequests).toBe(0);
});

test('浏览器禁止识别服务时不误报麦克风权限，仍可改用文字', async ({ page }) => {
  await simulateSpeechFailure(page, 'service-not-allowed');
  await page.goto('/reminders');
  await page.getByRole('button', { name: '语音创建', exact: true }).click();
  await page.getByRole('button', { name: '开始语音录入', exact: true }).click();
  const errorDialog = page.getByRole('dialog', { name: '浏览器不允许使用语音识别服务', exact: true });
  await expect(errorDialog).toBeVisible();
  await expect(errorDialog).not.toContainText('你之前拒绝了麦克风权限');
  await expect(errorDialog.getByRole('button', { name: '重试', exact: true })).toHaveCount(0);
  await errorDialog.getByRole('button', { name: '改用文字输入', exact: true }).click();
  await expect(page.getByLabel('提醒内容（可语音录入或直接填写）')).toBeEnabled();
});

test('无语音接口也能输入，修改文字后必须重新解析，取消后不沿用旧内容', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  });
  await page.goto('/reminders');
  await page.getByRole('button', { name: '语音创建', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始语音录入', exact: true })).toBeDisabled();
  const content = page.getByLabel('提醒内容（可语音录入或直接填写）');
  await content.fill('明天下午三点提醒我交作业');
  await page.getByRole('button', { name: '解析文字', exact: true }).click();
  await expect(page.getByRole('button', { name: '创建提醒', exact: true })).toBeEnabled();
  await content.fill('明天下午四点提醒我填写报名表');
  await expect(page.getByText('解析结果预览', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '创建提醒', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '解析文字', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '语音创建提醒', exact: true })).toContainText('填写报名表');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '语音创建', exact: true }).click();
  await expect(content).toHaveValue('');
  await expect(page.getByRole('button', { name: '解析文字', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '创建提醒', exact: true })).toBeDisabled();
});
