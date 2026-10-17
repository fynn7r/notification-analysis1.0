import { IRule } from '@/data/rule';

// 规则库分享码编解码工具
// 使用 Base64(UTF-8) 编码 + 版本前缀，保证可读性和兼容性
// 注：不用 escape/unescape（已弃用），改用 TextEncoder/TextDecoder 做 UTF-8 转换

const SHARE_VERSION = 'v1';
const SHARE_PREFIX = `NTZR:${SHARE_VERSION}:`;
// 分享码条数上限，防止异常数据撑爆 localStorage
const MAX_SHARE_RULES = 200;
// 单字段长度上限
const MAX_FIELD_LENGTH = 5000;

export function generateShareCode(rules: IRule[]): string {
  // 只保留核心字段，去除 id/createdAt/source 等元数据
  const payload = rules.map((r) => ({
    t: r.title,
    c: r.category,
    co: r.content,
    s: r.score,
  }));
  const json = JSON.stringify(payload);
  return SHARE_PREFIX + toBase64(json);
}

export function parseShareCode(code: string): IRule[] | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(SHARE_PREFIX)) {
      // 兼容没有前缀的纯 base64
      return parsePayload(trimmed);
    }
    const base64 = trimmed.slice(SHARE_PREFIX.length);
    return parsePayload(base64);
  } catch {
    return null;
  }
}

function toBase64(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function fromBase64(base64: string): string {
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : fallback;
}

function parsePayload(base64: string): IRule[] | null {
  try {
    const json = fromBase64(base64);
    const payload: unknown = JSON.parse(json);
    if (!Array.isArray(payload) || payload.length === 0) return null;
    if (payload.length > MAX_SHARE_RULES) return null;

    const rules: IRule[] = [];
    payload.forEach((item, idx) => {
      // 逐条校验类型，跳过结构异常的条目而不是整体失败
      if (typeof item !== 'object' || item === null) return;
      const record = item as Record<string, unknown>;
      rules.push({
        id: `shared-${Date.now()}-${idx}`,
        title: asString(record.t, '未命名规则'),
        category: asString(record.c, '自定义'),
        content: asString(record.co, ''),
        score: typeof record.s === 'string' ? record.s.slice(0, MAX_FIELD_LENGTH) : undefined,
        source: 'text' as const,
        createdAt: Date.now(),
      });
    });

    return rules.length > 0 ? rules : null;
  } catch {
    return null;
  }
}
