import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pdfFixture, docxFixture, ruleParagraphs } from '../server/document-fixtures.mjs';

async function drop(page: Page, file?: { name: string; bytes: Buffer }, text?: string) {
  const transfer = await page.evaluateHandle(({ file, text }) => {
    const data = new DataTransfer();
    if (file) data.items.add(new File([new Uint8Array(file.bytes)], file.name));
    else data.setData('text/plain', text || '');
    return data;
  }, { file: file ? { name: file.name, bytes: Array.from(file.bytes) } : undefined, text });
  await page.getByRole('button', { name: '导入规则文件', exact: true }).dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}

async function savedRules(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_rules') || '[]'));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 497, height: 570 });
  await page.addInitScript(() => {
    localStorage.setItem('__app_notizhi_onboarded', '1');
    localStorage.setItem('__app_notizhi_rules_init', '1');
    if (!localStorage.getItem('__app_notizhi_rules')) localStorage.setItem('__app_notizhi_rules', '[]');
  });
});

for (const format of ['pdf', 'docx', 'doc'] as const) {
  test(`真实 ${format.toUpperCase()} ${format === 'pdf' ? '拖入' : '选择'}→核对编辑→保存→刷新，读取不调用模型`, async ({ page }, testInfo) => {
    const bytes = format === 'pdf' ? pdfFixture() : format === 'docx' ? docxFixture()
      : await readFile(new URL('../server/test-fixtures/word-asian.doc', import.meta.url));
    const name = `综测细则.${format}`;
    let modelRequests = 0;
    let documentRequests = 0;
    page.on('request', (request) => {
      if (/\/api\/(parse|generate)$/.test(request.url())) modelRequests++;
      if (request.url().endsWith('/api/rules/import')) documentRequests++;
    });
    await page.goto('/rules');
    const response = page.waitForResponse('**/api/rules/import');
    if (format === 'pdf') await drop(page, { name, bytes });
    else await page.getByLabel('选择规则文件').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
    expect((await response).status()).toBe(200);
    await expect(page.getByRole('tab', { name: '粘贴文本', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByLabel('规则名称')).toHaveValue('综测细则');
    if (format !== 'doc') await page.getByRole('button', { name: '改用纯文字（舍弃排版）', exact: true }).click();
    await expect(page.getByLabel('规则内容')).toHaveValue(format === 'doc' ? /这是一个用来测试nodejs解析Word文档/ : new RegExp(ruleParagraphs[2]));
    if (format === 'docx') await expect(page.getByLabel('规则内容')).toHaveValue(/校级一等奖\t加1分/);
    expect(await savedRules(page)).toEqual([]);
    const original = await page.getByLabel('规则内容').inputValue();
    await page.getByLabel('规则名称').fill('已核对的综测细则');
    await page.getByLabel('规则分类').fill('综测');
    await page.getByLabel('规则内容').fill(original + '\n以上分值适用于本学年。');
    await page.getByRole('button', { name: '保存规则', exact: true }).click();
    await expect(page.getByText('已核对的综测细则', { exact: true })).toBeVisible();
    expect(await savedRules(page)).toMatchObject([{ title: '已核对的综测细则', category: '综测', source: 'file', content: original + '\n以上分值适用于本学年。' }]);
    await page.reload();
    await expect(page.getByText('已核对的综测细则', { exact: true })).toBeVisible();
    expect((await savedRules(page)).length).toBe(1);
    expect(documentRequests).toBe(1);
    expect(modelRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`rules-${format}.png`), fullPage: true });
  });
}

for (const format of ['pdf', 'docx'] as const) {
  test(`${format.toUpperCase()} 保留排版直接编辑、保存及重新编辑，文字与排版一致且不重复添加`, async ({ page }) => {
    await page.goto('/rules');
    const bytes = format === 'pdf' ? pdfFixture([ruleParagraphs], true) : docxFixture();
    await page.getByLabel('选择规则文件').setInputFiles({ name: `排版细则.${format}`, mimeType: 'application/octet-stream', buffer: bytes });
    const frame = page.frameLocator('iframe[title="规则内容（保留排版）"]');
    const cell = format === 'pdf' ? frame.locator('.pdf-rule-text').filter({ hasText: ruleParagraphs[1] }) : frame.locator('td').nth(1);
    if (format === 'docx') {
      await expect(frame.locator('table')).toBeVisible();
      await expect(frame.locator('td').first()).toHaveCSS('border-top-style', 'solid');
      await expect(frame.locator('p').first()).toHaveCSS('text-align', 'center');
      await expect(frame.locator('p').first().locator('span')).toHaveCSS('font-weight', '700');
    } else {
      await expect(frame.locator('.pdf-rule-page')).toHaveCSS('background-image', /data:image\/png;base64/);
      await expect(cell).toHaveCSS('position', 'absolute');
      await expect.poll(() => cell.evaluate((node: HTMLElement) => {
        const range = document.createRange(); range.selectNodeContents(node);
        return Math.abs(range.getBoundingClientRect().width - Number(node.dataset.pdfWidth));
      })).toBeLessThan(2);
    }
    await cell.fill(format === 'pdf' ? '学科竞赛：国家级一等奖加6分。' : '加2分');
    await page.getByRole('button', { name: '保存规则', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看 / 编辑排版', exact: true })).toBeVisible();
    const first = (await savedRules(page))[0];
    expect(first.content).toContain(format === 'pdf' ? '一等奖加6分' : '加2分');
    expect(first.richDocumentId).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: '查看 / 编辑排版', exact: true }).click();
    const reopened = format === 'pdf' ? frame.locator('.pdf-rule-text').filter({ hasText: '学科竞赛' }) : frame.locator('td').nth(1);
    await expect(reopened).toHaveText(format === 'pdf' ? '学科竞赛：国家级一等奖加6分。' : '加2分');
    await reopened.fill(format === 'pdf' ? '学科竞赛：国家级一等奖加7分。' : '加3分');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存规则', exact: true })).toBeVisible();
    const edited = await savedRules(page);
    expect(edited.length).toBe(1);
    expect(edited[0].id).toBe(first.id);
    expect(edited[0].content).toContain(format === 'pdf' ? '一等奖加7分' : '加3分');
    await page.getByRole('button', { name: '查看 / 编辑排版', exact: true }).click();
    await expect(format === 'pdf' ? frame.locator('.pdf-rule-text').filter({ hasText: '学科竞赛' }) : frame.locator('td').nth(1))
      .toHaveText(format === 'pdf' ? '学科竞赛：国家级一等奖加7分。' : '加3分');
    if (format === 'docx') await expect(frame.locator('p').first()).toHaveCSS('text-align', 'center');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('排版存储失败保留编辑内容，元数据失败时清理排版，不生成空壳规则', async ({ page }) => {
  await page.goto('/rules');
  await page.getByLabel('选择规则文件').setInputFiles({ name: '排版.docx', mimeType: 'application/octet-stream', buffer: docxFixture() });
  const frame = page.frameLocator('iframe[title="规则内容（保留排版）"]');
  await frame.locator('td').nth(1).fill('加2分');
  await page.evaluate(() => {
    const open = indexedDB.open.bind(indexedDB);
    (window as unknown as { restoreRuleDB: () => void }).restoreRuleDB = () => { indexedDB.open = open; };
    indexedDB.open = () => { throw new DOMException('满了', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  expect(await savedRules(page)).toEqual([]);
  await expect(frame.locator('td').nth(1)).toHaveText('加2分');
  await page.evaluate(() => {
    (window as unknown as { restoreRuleDB: () => void }).restoreRuleDB();
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === '__app_notizhi_rules') throw new DOMException('满了', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('规则未保存');
  await expect(frame.locator('td').nth(1)).toHaveText('加2分');
  expect(await savedRules(page)).toEqual([]);
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('__app_notizhi_rule_layouts', 1); request.onsuccess = () => resolve(request.result); });
    const count = await new Promise<number>((resolve) => { const request = db.transaction('documents').objectStore('documents').count(); request.onsuccess = () => resolve(request.result); });
    db.close(); return count;
  })).toBe(0);
});

test('文档文字中的 HTML 标记按文字显示，隔离样式，忽略外部伪造的编辑消息', async ({ page }) => {
  await page.goto('/rules');
  const literal = '<img src=x onerror=alert(1)>';
  await page.getByLabel('选择规则文件').setInputFiles({ name: '文字.pdf', mimeType: 'application/pdf', buffer: pdfFixture([[literal]]) });
  const frame = page.frameLocator('iframe[title="规则内容（保留排版）"]');
  await expect(frame.locator('.pdf-rule-page')).toContainText('<img');
  await expect(frame.locator('img')).toHaveCount(0);
  await page.evaluate(() => window.postMessage({ type: 'RULE_LAYOUT_CHANGE', html: '伪造', text: '伪造' }, '*'));
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看 / 编辑排版', exact: true })).toBeVisible();
  expect((await savedRules(page))[0].content.replace(/\s+/g, ' ').trim()).toBe(literal);
  expect(await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)).not.toBe('rgb(243, 244, 246)');
});

test('已有排版规则修改失败保留旧版本与本次编辑，重试不重复，删除会清理排版', async ({ page }) => {
  await page.goto('/rules');
  await page.getByLabel('选择规则文件').setInputFiles({ name: '继续编辑.docx', mimeType: 'application/octet-stream', buffer: docxFixture() });
  const frame = page.frameLocator('iframe[title="规则内容（保留排版）"]');
  await frame.locator('td').nth(1).waitFor();
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await page.getByRole('button', { name: '查看 / 编辑排版', exact: true }).click();
  const original = (await savedRules(page))[0];
  await frame.locator('td').nth(1).fill('加2分');
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    (window as unknown as { restoreRuleStorage: () => void }).restoreRuleStorage = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === '__app_notizhi_rules') throw new DOMException('满了', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('规则未保存');
  expect(await savedRules(page)).toEqual([original]);
  await expect(frame.locator('td').nth(1)).toHaveText('加2分');
  await page.evaluate(() => (window as unknown as { restoreRuleStorage: () => void }).restoreRuleStorage());
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存规则', exact: true })).toBeVisible();
  const updated = await savedRules(page);
  expect(updated.length).toBe(1);
  expect(updated[0].id).toBe(original.id);
  expect(updated[0].content).toContain('加2分');
  await page.getByRole('button', { name: '删除规则 继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  expect(await savedRules(page)).toEqual([]);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('__app_notizhi_rule_layouts', 1); request.onsuccess = () => resolve(request.result); });
    const count = await new Promise<number>((resolve) => { const request = db.transaction('documents').objectStore('documents').count(); request.onsuccess = () => resolve(request.result); });
    db.close(); return count;
  })).toBe(0);
});

test('扫描版和损坏文件明确失败，原核对内容保留，不生成空规则，选择同一文件可重试', async ({ page }) => {
  await page.goto('/rules');
  const file = { name: '规则.docx', mimeType: 'application/octet-stream', buffer: docxFixture() };
  await page.getByLabel('选择规则文件').setInputFiles(file);
  await page.getByRole('button', { name: '改用纯文字（舍弃排版）', exact: true }).click();
  await expect(page.getByLabel('规则内容')).toHaveValue(new RegExp(ruleParagraphs[0]));
  const original = await page.getByLabel('规则内容').inputValue();
  for (const failed of [{ name: '扫描.pdf', mimeType: 'application/pdf', buffer: pdfFixture([null]) }, { name: '损坏.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') }]) {
    await page.getByRole('tab', { name: '导入文件', exact: true }).click();
    await page.getByLabel('选择规则文件').setInputFiles(failed);
    await expect(page.getByRole('alert').first()).toContainText(failed.name.endsWith('.pdf') ? 'OCR' : '无法读取文档');
    expect(await savedRules(page)).toEqual([]);
    await page.getByRole('tab', { name: '粘贴文本', exact: true }).click();
    await expect(page.getByLabel('规则内容')).toHaveValue(original);
  }
  await page.getByRole('tab', { name: '导入文件', exact: true }).click();
  await page.getByLabel('选择规则文件').setInputFiles(file);
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.getByRole('button', { name: '改用纯文字（舍弃排版）', exact: true }).click();
  await expect(page.getByLabel('规则内容')).toHaveValue(original);
  expect(await savedRules(page)).toEqual([]);
});

test('拖入选中文字与 TXT 文件均进入核对表单，空文件和不支持的格式不发送请求', async ({ page }) => {
  let documentRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/rules/import')) documentRequests++; });
  await page.goto('/rules');
  await drop(page, undefined, ruleParagraphs.join('\n'));
  await expect(page.getByLabel('规则内容')).toHaveValue(ruleParagraphs.join('\n'));
  expect(documentRequests).toBe(0);
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  expect(await savedRules(page)).toMatchObject([{ source: 'text', content: ruleParagraphs.join('\n') }]);
  await page.getByRole('tab', { name: '导入文件', exact: true }).click();
  for (const [name, bytes, message] of [
    ['规则.png', Buffer.from('text'), '请选择 PDF、DOC、DOCX 或 TXT 文件'],
    ['规则.txt', Buffer.alloc(0), '文件为空'],
  ] as const) {
    await drop(page, { name, bytes });
    await expect(page.getByRole('alert').first()).toContainText(message);
    expect(documentRequests).toBe(0);
  }
  await drop(page, { name: '规则.txt', bytes: Buffer.from(ruleParagraphs.join('\n')) });
  await expect(page.getByLabel('规则内容')).toHaveValue(ruleParagraphs.join('\n'));
  expect(documentRequests).toBe(1);
});

test('本地服务失败保留填写内容，不自动重试；浏览器存储失败不显示虚假保存成功', async ({ page }) => {
  await page.goto('/rules');
  await page.getByRole('tab', { name: '粘贴文本', exact: true }).click();
  await page.getByLabel('规则名称').fill('待保存规则');
  await page.getByLabel('规则内容').fill(ruleParagraphs.join('\n'));
  let documentRequests = 0;
  await page.route('**/api/rules/import', (route) => {
    documentRequests++;
    return route.fulfill({ status: 500, json: { error: { message: '本地服务暂时不可用，请重试。' } } });
  });
  await page.getByRole('tab', { name: '导入文件', exact: true }).click();
  await drop(page, { name: '规则.pdf', bytes: pdfFixture() });
  await expect(page.getByRole('alert').first()).toHaveText('本地服务暂时不可用，请重试。');
  await page.getByRole('tab', { name: '粘贴文本', exact: true }).click();
  await expect(page.getByLabel('规则名称')).toHaveValue('待保存规则');
  await expect(page.getByLabel('规则内容')).toHaveValue(ruleParagraphs.join('\n'));
  expect(documentRequests).toBe(1);
  expect(await savedRules(page)).toEqual([]);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === '__app_notizhi_rules') throw new DOMException('满了', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('规则未保存');
  await expect(page.getByLabel('规则内容')).toHaveValue(ruleParagraphs.join('\n'));
  await expect(page.getByText('待保存规则', { exact: true })).not.toBeVisible();
  expect(await savedRules(page)).toEqual([]);
});
