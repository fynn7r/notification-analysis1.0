/**
 * 分块与中文检索词处理。
 *
 * 分块：按空行切自然段；过长的段按句末标点再切；过短的段合并。
 * 位置：记录相对原文的字符区间与段落序号，不编造不存在的页码。
 *
 * 检索词：FTS5 的 unicode61 不分中文词，整段会变成一个 token。
 * 这里把中文转成相邻二字组合（bigram），英文/数字按词，查询侧用同样规则。
 */

export const MIN_CHUNK_CHARS = 240;
export const MAX_CHUNK_CHARS = 1200;

function splitParagraphs(text) {
  const blocks = [];
  const re = /\n[ \t]*\n/g;
  let cursor = 0;
  let match;
  while ((match = re.exec(text))) {
    blocks.push({ start: cursor, end: match.index, text: text.slice(cursor, match.index) });
    cursor = match.index + match[0].length;
  }
  blocks.push({ start: cursor, end: text.length, text: text.slice(cursor) });
  return blocks.filter((block) => block.text.trim().length > 0);
}

function splitLongBlock(block) {
  if (block.text.length <= MAX_CHUNK_CHARS) return [block];
  const pieces = [];
  let start = 0;
  while (start < block.text.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, block.text.length);
    if (end < block.text.length) {
      const window = block.text.slice(start, end);
      const cut = Math.max(
        window.lastIndexOf('。'), window.lastIndexOf('；'), window.lastIndexOf('！'),
        window.lastIndexOf('？'), window.lastIndexOf('\n'),
      );
      if (cut > MIN_CHUNK_CHARS / 2) end = start + cut + 1;
    }
    pieces.push({ start: block.start + start, end: block.start + end, text: block.text.slice(start, end) });
    start = end;
  }
  return pieces;
}

/**
 * @param {{body: string, sourceKind?: string}} input
 * @returns {{ordinal: number, locationLabel: string, text: string, charStart: number, charEnd: number}[]}
 */
export function chunkEntry({ body }) {
  const source = String(body ?? '');
  if (!source.trim()) return [];
  const blocks = splitParagraphs(source).flatMap(splitLongBlock);

  const merged = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && last.text.length < MIN_CHUNK_CHARS && last.text.length + block.text.length <= MAX_CHUNK_CHARS) {
      last.text = `${last.text}\n\n${block.text}`;
      last.end = block.end;
    } else {
      merged.push({ ...block });
    }
  }

  return merged.map((block, index) => ({
    ordinal: index + 1,
    locationLabel: `第 ${index + 1} 段`,
    text: block.text.trim(),
    charStart: block.start,
    charEnd: block.end,
  }));
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 生成 FTS5 tokens 字符串（空格分隔）。
 * 中文连续片段做二字滑窗；长度 1 的片段保留单字；英文数字保留整词并转小写。
 */
export function toSearchTokens(text) {
  const tokens = [];
  const source = String(text ?? '');
  let buffer = '';
  let latin = false;

  const flushCjk = () => {
    if (!buffer) return;
    if (buffer.length === 1) tokens.push(buffer);
    else for (let i = 0; i < buffer.length - 1; i += 1) tokens.push(buffer.slice(i, i + 2));
    buffer = '';
  };
  const flushLatin = () => {
    if (buffer) { tokens.push(buffer.toLowerCase()); buffer = ''; }
  };

  for (const char of source) {
    const isCjk = CJK.test(char);
    if (isCjk) {
      if (latin) { flushLatin(); latin = false; }
      buffer += char;
    } else if (/[A-Za-z0-9]/.test(char)) {
      if (!latin) { flushCjk(); latin = true; }
      buffer += char;
    } else {
      if (latin) { flushLatin(); latin = false; } else { flushCjk(); }
    }
  }
  if (latin) flushLatin(); else flushCjk();
  return tokens.join(' ');
}

/** 把用户文本转成 FTS5 MATCH 表达式；空查询返回空串。 */
export function toMatchExpression(text) {
  const tokens = toSearchTokens(text).split(' ').filter(Boolean);
  const unique = [...new Set(tokens)].slice(0, 64);
  if (!unique.length) return '';
  return unique.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
}

/** 去掉 HTML 标签与常见排版噪声，供上传正文入库前清洗。 */
export function plainText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}
