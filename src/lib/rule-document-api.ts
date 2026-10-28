import { MAX_DOCUMENT_BYTES, ruleDocumentExtensions, ruleDocumentResponseSchema, type RuleDocumentResponse } from '@shared/rule-document-contract';

async function uploadDocument(file: File): Promise<RuleDocumentResponse> {
  if (!ruleDocumentExtensions.test(file.name)) throw new Error('请选择 PDF、DOC、DOCX 或 TXT 文件。');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文件暂限10MB以内，请拆分或压缩后导入。');
  if (!file.size) throw new Error('文件为空，请选择有内容的文档。');
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try { response = await fetch('/api/rules/import', { method: 'POST', body: form, signal: AbortSignal.timeout(45000) }); }
  catch { throw new Error('文档读取服务未连接或请求超时，请确认本地服务正在运行。'); }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('文档读取服务返回内容无效，请重试。'); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    throw new Error(error?.error?.message || '文档读取失败，请重试。');
  }
  const result = ruleDocumentResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('提取内容为空或格式无效，未保存规则，请重试。');
  return result.data;
}

export async function readRuleDocument(file: File): Promise<RuleDocumentResponse> {
  const data = await uploadDocument(file);
  if (/\.docx$/i.test(file.name)) {
    try {
      const { renderAsync } = await import('docx-preview');
      const container = document.createElement('div');
      const styles = document.createElement('div');
      await renderAsync(await file.arrayBuffer(), container, styles, {
        className: 'rule-docx', useBase64URL: true, renderAltChunks: false,
        ignoreLastRenderedPageBreak: false,
      });
      const layout = { format: 'docx' as const, html: container.innerHTML,
        css: Array.from(styles.querySelectorAll('style')).map((style) => style.textContent).join('\n') };
      const parsed = ruleDocumentResponseSchema.safeParse({ ...data, layout });
      if (!parsed.success) throw new Error('排版内容过大');
      return { ...parsed.data, warnings: [...parsed.data.warnings, '已保留段落样式和表格，可直接编辑。复杂分页、缺失字体等可能存在差异，请对照原文件核对。'] };
    } catch { throw new Error('Word 排版转换失败，未保存规则。请用 Word 或 WPS 另存为 DOCX 后重试。'); }
  }
  return data;
}

/** 只取纯文本，不做排版还原；解析通知的"说明文件"用这个，避免 docx 排版失败拖垮提取。 */
export async function readDocumentText(file: File): Promise<RuleDocumentResponse> {
  return uploadDocument(file);
}
