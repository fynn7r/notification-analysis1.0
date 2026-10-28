export interface IArticleImage {
  index: number;
  url: string;
  /** info=含文字信息；deco=装饰图；qr=二维码；other=无法归类；unread=未识别 */
  kind: 'info' | 'deco' | 'qr' | 'other' | 'unread';
  /** 图中誊抄出的文字，仅 kind=info 时有内容 */
  text: string;
}

export interface IArticleBody {
  url: string;
  title: string;
  text: string;
  chars: number;
  truncated: boolean;
  images: IArticleImage[];
  warnings: string[];
}

export function isWechatArticleUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed) || /\s/.test(trimmed)) return false;
  try {
    return new URL(trimmed).hostname.toLowerCase() === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

/** 从整段文字里找出所有公众号文章链接，去重后按出现顺序返回。 */
export function findWechatArticleUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/mp\.weixin\.qq\.com\/[^\s"'<>）)】]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[，。、；;,.]+$/, '');
    if (!isWechatArticleUrl(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export async function fetchWechatArticle(url: string): Promise<IArticleBody> {
  let response: Response;
  try {
    response = await fetch('/api/article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('读取文章失败，解析服务可能未运行。请直接粘贴正文。');
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('读取文章返回内容无效，请直接粘贴正文。'); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    throw new Error(error?.error?.message || '读取文章失败，请直接粘贴正文。');
  }
  return payload as IArticleBody;
}
