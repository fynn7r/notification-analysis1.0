import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { extractRuleDocument } from './rule-document-service.mjs';
import { createApiServer } from './index.mjs';
import { ApiError } from './parse-service.mjs';
import { pdfFixture, docxFixture, ruleParagraphs } from './document-fixtures.mjs';
import { MAX_DOCUMENT_BYTES, MAX_RULE_CONTENT_CHARS, ruleDocumentResponseSchema } from '../shared/rule-document-contract.ts';

const errorCode = (code, status) => (error) => error instanceof ApiError && error.code === code && error.status === status;

test('真正的中文 PDF 跨页提取，保留分值与上限，Windows 资源路径可用', async () => {
  const document = await extractRuleDocument('综测细则.PDF', pdfFixture([ruleParagraphs.slice(0, 2), ruleParagraphs.slice(2)]));
  assert.ok(ruleDocumentResponseSchema.safeParse(document).success);
  assert.equal(document.title, '综测细则');
  assert.equal(document.content, ruleParagraphs.slice(0, 2).join('\n') + '\n\n' + ruleParagraphs[2]);
  assert.match(document.warnings.join(''), /表格线/);
  assert.equal(document.layout.format, 'pdf');
  assert.equal((document.layout.html.match(/class="pdf-rule-page"/g) || []).length, 2);
  assert.match(document.layout.html, /contenteditable="plaintext-only"/);
});

test('真正的 DOCX 提取中文段落和表格单元格，保留条目与分值', async () => {
  const document = await extractRuleDocument('综测细则.docx', docxFixture());
  for (const paragraph of ruleParagraphs) assert.ok(document.content.includes(paragraph));
  assert.match(document.content, /校级一等奖\t加1分/);
});

test('真实的旧版 DOC 提取中文而非把二进制当文本', async () => {
  const bytes = await readFile(new URL('./test-fixtures/word-asian.doc', import.meta.url));
  const document = await extractRuleDocument('旧版中文.doc', bytes);
  assert.match(document.content, /这是一个用来测试nodejs解析Word文档/);
  assert.match(document.content, /This is a test for parsing the Word file in node\./);
});

test('TXT 支持 UTF-8、UTF-16 BOM 和 GB18030，清理换行并保护文件名', async () => {
  const text = ruleParagraphs.join('\r\n');
  for (const bytes of [Buffer.from(text), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()])]) {
    const document = await extractRuleDocument('C:\\临时\\规则.txt', bytes);
    assert.equal(document.content, ruleParagraphs.join('\n'));
    assert.equal(document.filename, '规则.txt');
    assert.equal(document.title, '规则');
    assert.deepEqual(document.warnings, []);
  }
  assert.equal((await extractRuleDocument('规则.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).content, '中文');
});

test('纯图片 PDF 明确要求 OCR，部分扫描页给出警告，不产生空规则', async () => {
  await assert.rejects(extractRuleDocument('扫描.pdf', pdfFixture([null])), (error) => {
    assert.ok(errorCode('NO_DOCUMENT_TEXT', 422)(error));
    assert.match(error.message, /OCR/);
    assert.match(error.message, /未保存空规则/);
    return true;
  });
  const document = await extractRuleDocument('混合.pdf', pdfFixture([ruleParagraphs, null]));
  assert.equal(document.content, ruleParagraphs.join('\n'));
  assert.match(document.warnings.join(''), /1页未提取到文字/);
});

test('不支持、空白、损坏、过大或过多页的文件明确失败', async () => {
  for (const [name, bytes, code, status] of [
    ['规则.png', Buffer.from('text'), 'UNSUPPORTED_DOCUMENT_TYPE', 415],
    ['规则.txt', Buffer.alloc(0), 'EMPTY_DOCUMENT', 400],
    ['规则.txt', Buffer.from(' \r\n\t'), 'NO_DOCUMENT_TEXT', 422],
    ['规则.pdf', Buffer.from('not a PDF'), 'DOCUMENT_READ_FAILED', 422],
    ['规则.doc', Buffer.from('not a Word document'), 'DOCUMENT_READ_FAILED', 422],
    ['规则.docx', Buffer.from('not a ZIP'), 'DOCUMENT_READ_FAILED', 422],
    ['规则.txt', Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'DOCUMENT_TOO_LARGE', 413],
    ['规则.txt', Buffer.from('字'.repeat(MAX_RULE_CONTENT_CHARS + 1)), 'DOCUMENT_TEXT_TOO_LARGE', 413],
    ['规则.pdf', pdfFixture(Array.from({ length: 201 }, () => [])), 'TOO_MANY_PAGES', 413],
  ]) await assert.rejects(extractRuleDocument(name, bytes), errorCode(code, status));
});

test('HTTP multipart 实际读取四种格式，无模型密钥也可用且绝不调用模型', async () => {
  const api = createApiServer({ apiKey: '' }, async () => { assert.fail('读取规则文档不应调用模型'); });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${api.address().port}`;
  const post = (form, headers) => fetch(`${base}/api/rules/import`, { method: 'POST', body: form, headers });
  const upload = (name, bytes) => {
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    return post(form);
  };
  try {
    for (const [name, bytes] of [
      ['规则.pdf', pdfFixture()], ['规则.docx', docxFixture()],
      ['规则.doc', await readFile(new URL('./test-fixtures/word-asian.doc', import.meta.url))], ['规则.txt', Buffer.from(ruleParagraphs.join('\n'))],
    ]) {
      const response = await upload(name, bytes);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(ruleDocumentResponseSchema.safeParse(result).success);
      assert.ok(result.content.includes(name.endsWith('.doc') ? '这是一个' : ruleParagraphs[0]));
    }
    for (const [response, status, code] of [
      [await upload('扫描.pdf', pdfFixture([null])), 422, 'NO_DOCUMENT_TEXT'],
      [await upload('规则.png', Buffer.from('text')), 415, 'UNSUPPORTED_DOCUMENT_TYPE'],
      [await upload('规则.docx', Buffer.from('bad')), 422, 'DOCUMENT_READ_FAILED'],
      [await upload('规则.txt', Buffer.alloc(MAX_DOCUMENT_BYTES + 1)), 413, 'DOCUMENT_TOO_LARGE'],
      [await post(new FormData()), 400, 'INVALID_DOCUMENT_UPLOAD'],
      [await post('{}', { 'Content-Type': 'application/json' }), 415, 'INVALID_CONTENT_TYPE'],
      [await post('broken', { 'Content-Type': 'multipart/form-data' }), 400, 'INVALID_DOCUMENT_UPLOAD'],
    ]) {
      assert.equal(response.status, status);
      assert.equal((await response.json()).error.code, code);
    }
    const multiple = new FormData();
    multiple.append('file', new Blob(['first']), '规则1.txt');
    multiple.append('file', new Blob(['second']), '规则2.txt');
    assert.equal((await post(multiple)).status, 400);
    assert.equal((await fetch(`${base}/api/rules/import`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).realParseVerified, false);
  } finally {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  }
});
