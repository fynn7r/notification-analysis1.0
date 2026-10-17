import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './parse-service.mjs';
import { MAX_DOCUMENT_BYTES, MAX_RULE_CONTENT_CHARS, MAX_RULE_LAYOUT_CHARS, ruleDocumentExtensions } from '../shared/rule-document-contract.ts';
import { renderPdfRulePage, pdfRuleCss } from './pdf-rule-layout.mjs';

async function readPdf(buffer, warnings) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, fontExtraProperties: true,
    cMapUrl: join(assets, 'cmaps').replaceAll('\\', '/') + '/', cMapPacked: true,
    standardFontDataUrl: join(assets, 'standard_fonts').replaceAll('\\', '/') + '/',
  });
  try {
    const document = await task.promise;
    if (document.numPages > 200) throw new ApiError(413, 'TOO_MANY_PAGES', 'PDF 暂限200页以内，请拆分后导入。');
    const pages = [];
    const layouts = [];
    let layoutLength = 0;
    let emptyPages = 0;
    let length = 0;
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const textContent = await page.getTextContent();
      const { items } = textContent;
      const text = items.filter((item) => typeof item.str === 'string')
        .map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
      if (!text) emptyPages++;
      length += text.length;
      if (length > MAX_RULE_CONTENT_CHARS) throw new ApiError(413, 'DOCUMENT_TEXT_TOO_LARGE', '提取文字暂限20万字以内，请拆分文档后导入。');
      pages.push(text);
      const layout = await renderPdfRulePage(page, textContent, i, pdfjs);
      layoutLength += layout.length;
      if (layoutLength > MAX_RULE_LAYOUT_CHARS) throw new ApiError(413, 'DOCUMENT_LAYOUT_TOO_LARGE', '文档排版内容过大，请拆分后导入。');
      layouts.push(layout);
      page.cleanup();
    }
    if (emptyPages && emptyPages < document.numPages) warnings.push(`有${emptyPages}页未提取到文字，可能是扫描页或空白页，请对照原文核对。`);
    return { content: pages.join('\n\n'), layout: { format: 'pdf', html: layouts.join(''), css: pdfRuleCss } };
  } finally {
    await task.destroy();
  }
}

async function readWord(buffer) {
  const { default: WordExtractor } = await import('word-extractor');
  const document = await new WordExtractor().extract(buffer);
  const options = { filterUnicode: false };
  return [
    document.getBody(options), document.getFootnotes(options), document.getEndnotes(options),
    document.getHeaders({ ...options, includeFooters: false }), document.getFooters(options),
    document.getTextboxes(options),
  ].map((text) => text.trim()).filter(Boolean).join('\n\n');
}

function readText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030', { fatal: true }).decode(buffer); }
}

export async function extractRuleDocument(filename, buffer) {
  if (typeof filename !== 'string' || !ruleDocumentExtensions.test(filename)) {
    throw new ApiError(415, 'UNSUPPORTED_DOCUMENT_TYPE', '请选择 PDF、DOC、DOCX 或 TXT 文件。');
  }
  if (!buffer.length) throw new ApiError(400, 'EMPTY_DOCUMENT', '文件为空，请选择有内容的文档。');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new ApiError(413, 'DOCUMENT_TOO_LARGE', '文件暂限10MB以内，请拆分或压缩后导入。');
  const warnings = [];
  let content;
  let layout;
  try {
    if (/\.pdf$/i.test(filename)) ({ content, layout } = await readPdf(buffer, warnings));
    else content = /\.docx?$/i.test(filename) ? await readWord(buffer) : readText(buffer);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'PasswordException') throw new ApiError(422, 'DOCUMENT_PASSWORD_REQUIRED', 'PDF 已加密，请先解除密码保护后再导入。');
    throw new ApiError(422, 'DOCUMENT_READ_FAILED', '无法读取文档，文件可能损坏或格式不符。请另存为 PDF、DOCX 或 TXT 后重试。');
  }
  content = content.replace(/\r\n?/g, '\n').trim();
  if (!content || !/\S/.test(content)) {
    throw new ApiError(422, 'NO_DOCUMENT_TEXT', /\.pdf$/i.test(filename)
      ? 'PDF 未提取到文字，可能是扫描版。请先进行 OCR 识别，或复制可选中的文字导入；未保存空规则。'
      : '文档中没有可提取的文字，图片中的文字需要先进行 OCR；未保存空规则。');
  }
  if (content.length > MAX_RULE_CONTENT_CHARS) throw new ApiError(413, 'DOCUMENT_TEXT_TOO_LARGE', '提取文字暂限20万字以内，请拆分文档后导入。');
  if (/\.pdf$/i.test(filename)) warnings.push('已保留分页、文字位置和表格线，可点击文字修改；PDF 固定排版不会随编辑自动重排，请核对修改后的页面。');
  if (/\.doc$/i.test(filename)) warnings.push('旧版 DOC 暂只提取文字。若需保留表格和排版，请用 Word 或 WPS 另存为 DOCX 后导入。');
  const name = filename.split(/[\\/]/).pop();
  return { filename: name, title: name.replace(/\.[^.]+$/, '') || '导入规则', content, warnings, ...(layout ? { layout } : {}) };
}
