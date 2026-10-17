import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const filename = process.argv[2];
if (!filename) throw new Error('请提供用于排版验收的 PDF 完整路径。');
const bytes = await readFile(filename);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const task = getDocument({ data: new Uint8Array(bytes) });
const pdf = await task.promise;
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
const page = await context.newPage();
let modelRequests = 0;
page.on('request', (request) => { if (/\/api\/(parse|generate)$/.test(request.url())) modelRequests++; });
await page.addInitScript(() => {
  localStorage.setItem('__app_notizhi_onboarded', '1');
  localStorage.setItem('__app_notizhi_rules_init', '1');
  if (!localStorage.getItem('__app_notizhi_rules')) localStorage.setItem('__app_notizhi_rules', '[]');
});
try {
  await mkdir('tmp/pdfs', { recursive: true });
  await page.goto('http://127.0.0.1:8001/rules');
  await page.getByLabel('选择规则文件').setInputFiles(filename);
  const frame = page.frameLocator('iframe[title="规则内容（保留排版）"]');
  await frame.locator('.pdf-rule-page').last().waitFor();
  assert.equal(await frame.locator('.pdf-rule-page').count(), pdf.numPages);
  const source = await page.locator('iframe').getAttribute('srcdoc');
  const inspection = await context.newPage();
  await inspection.setContent(source);
  const thumbnails = [];
  for (let i = 0; i < pdf.numPages; i++) {
    await inspection.locator('.pdf-rule-page').evaluateAll((pages, visible) => {
      pages.forEach((element, index) => { element.style.display = index === visible ? 'block' : 'none'; });
    }, i);
    const rendered = await inspection.locator('.pdf-rule-page').nth(i).screenshot();
    await writeFile(`tmp/pdfs/rules-edited-layout-${i + 1}.png`, rendered);
    thumbnails.push(await loadImage(rendered));
    if ([0, 5, 8, 20, pdf.numPages - 1].includes(i)) {
      const original = await pdf.getPage(i + 1);
      const viewport = original.getViewport({ scale: 1 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await original.render({ canvas: null, canvasContext: canvas.getContext('2d'), viewport }).promise;
      await writeFile(`tmp/pdfs/rules-original-${i + 1}.png`, canvas.toBuffer('image/png'));
      original.cleanup();
    }
  }
  const sheet = createCanvas(1200, Math.ceil(thumbnails.length / 5) * 360);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#e2e8f0'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  thumbnails.forEach((thumbnail, index) => {
    const x = index % 5 * 240; const y = Math.floor(index / 5) * 360;
    ctx.drawImage(thumbnail, x + 4, y + 20, 232, 328);
    ctx.fillStyle = '#111'; ctx.font = '14px sans-serif'; ctx.fillText(`Page ${index + 1}`, x + 6, y + 15);
  });
  await writeFile('tmp/pdfs/rules-layout-contact.png', sheet.toBuffer('image/png'));
  const editable = frame.locator('.pdf-rule-text').first();
  const originalText = await editable.innerText();
  await editable.fill(originalText + '（核对）');
  await page.getByRole('button', { name: '保存规则', exact: true }).click();
  await page.getByRole('button', { name: '查看 / 编辑排版', exact: true }).waitFor();
  const first = await page.evaluate(() => JSON.parse(localStorage.getItem('__app_notizhi_rules'))[0]);
  assert.ok(first.content.includes(originalText + '（核对）'));
  await page.reload();
  await page.getByRole('button', { name: '查看 / 编辑排版', exact: true }).click();
  assert.equal(await frame.locator('.pdf-rule-text').first().innerText(), originalText + '（核对）');
  assert.equal(await frame.locator('.pdf-rule-page').count(), pdf.numPages);
  assert.equal(modelRequests, 0);
  assert.equal(hash(await readFile(filename)), hash(bytes));
  console.log(JSON.stringify({ verified: true, pages: pdf.numPages, editedAndPersisted: true, sourceUnchanged: true, modelRequests }));
} finally {
  await context.close(); await browser.close(); await task.destroy();
}
