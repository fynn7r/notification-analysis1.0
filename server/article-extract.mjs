/**
 * 微信公众号文章正文提取。
 *
 * 只接受 mp.weixin.qq.com 的文章链接，避免这个接口变成任意网址的代理（SSRF）。
 * 抓不到的常见原因是微信的风控验证页、文章被删除，或文章需要登录态。
 */
import { ApiError } from './parse-service.mjs';
import { applyImageText, readImages, visionEnabled } from './vision-service.mjs';

const ARTICLE_HOST = 'mp.weixin.qq.com';
const MAX_HTML_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
const FETCH_TIMEOUT_MS = 15000;

// 微信会按 UA 决定返回正文还是"请在微信客户端打开"，这里伪装成微信内置浏览器。
const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN';

export function isWechatArticleUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  // 带空白的输入按多段文本处理，避免把"链接 + 一段话"误判成纯链接。
  if (/\s/.test(trimmed)) return false;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return parsed.hostname.toLowerCase() === ARTICLE_HOST;
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * 把 <img> 换成 [图片 N] 占位符，并按顺序收集图片地址。
 *
 * 公众号正文用 data-src 懒加载，src 常是空白占位图，因此优先读 data-src。
 * 保留占位符是为了让模型知道「这里原本有图」，避免图片里的关键信息被静默丢弃。
 */
function markImages(html, images) {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const dataSrc = tag.match(/data-src="([^"]*)"/i)?.[1];
    const src = tag.match(/\ssrc="([^"]*)"/i)?.[1];
    const url = decodeEntities((dataSrc || src || '').trim());
    if (!/^https?:\/\//i.test(url) || /^data:/i.test(url)) return '';
    images.push(url);
    return `\n[图片 ${images.length}]\n`;
  });
}

function htmlToText(html, images = []) {
  return decodeEntities(
    markImages(html, images)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|section|div|li|h\d|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(预览时标签不可点|微信扫一扫关注该公众号|继续滑动看下一个|向上滑动看下一个)$/.test(line))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function extractTitle(html) {
  const og = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const script = html.match(/var\s+msg_title\s*=\s*'([^']*)'/);
  if (script?.[1]) return decodeEntities(script[1]).trim();
  return '';
}

function explainUnreadable(html) {
  if (/环境异常|去验证|完成验证后即可继续访问/.test(html)) {
    return '微信要求人机验证，暂时读不到正文。请打开文章手动复制正文粘贴进来。';
  }
  if (/请在微信客户端打开|请在微信中打开/.test(html)) {
    return '这篇文章要求在微信里打开。请在微信里复制正文后粘贴进来。';
  }
  if (/该内容已被发布者删除|此内容因违规无法查看|该公众号已迁移|参数错误/.test(html)) {
    return '这篇文章已被删除或无法访问。';
  }
  return '没有在页面里找到文章正文，可能是不支持的文章类型。请直接粘贴正文。';
}

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
    throw new ApiError(413, 'ARTICLE_TOO_LARGE', '文章页面过大，已停止读取。请直接粘贴正文。');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_HTML_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413, 'ARTICLE_TOO_LARGE', '文章页面过大，已停止读取。请直接粘贴正文。');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/**
 * @param {string} rawUrl
 * @param {{visionConfig?: object, fetchImpl?: typeof fetch, readImagesImpl?: Function}} options
 *   visionConfig 未启用时只保留 [图片 N] 占位符，不发起视觉调用。
 * @returns {Promise<{url: string, title: string, text: string, chars: number, truncated: boolean,
 *   images: {index: number, url: string, kind: string, text: string}[], warnings: string[]}>}
 */
export async function extractWechatArticle(rawUrl, options = {}) {
  // 兼容旧调用方式 extractWechatArticle(url, fetchImpl)
  const opts = typeof options === 'function' ? { fetchImpl: options } : options;
  const { visionConfig = null, fetchImpl = fetch } = opts;
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!url) throw new ApiError(400, 'INVALID_URL', '请提供文章链接。');
  if (!isWechatArticleUrl(url)) {
    throw new ApiError(400, 'UNSUPPORTED_URL', '目前只支持微信公众号文章链接（mp.weixin.qq.com）。');
  }

  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': WECHAT_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new ApiError(
      504,
      timedOut ? 'ARTICLE_TIMEOUT' : 'ARTICLE_UNREACHABLE',
      timedOut ? '读取文章超时，请重试或直接粘贴正文。' : '无法访问这篇文章，请检查网络或直接粘贴正文。',
    );
  }
  if (!response.ok) {
    throw new ApiError(502, 'ARTICLE_FETCH_FAILED', `读取文章失败（HTTP ${response.status}），请直接粘贴正文。`);
  }

  const html = await readLimited(response);
  // 正文在 id="js_content" 的容器里；脚本标签出现即视为正文结束，避免把页脚和推荐混进来。
  const containerAt = html.indexOf('id="js_content"');
  if (containerAt < 0) throw new ApiError(422, 'ARTICLE_UNREADABLE', explainUnreadable(html));
  const bodyStart = html.indexOf('>', containerAt);
  if (bodyStart < 0) throw new ApiError(422, 'ARTICLE_UNREADABLE', explainUnreadable(html));
  const scriptAt = html.indexOf('<script', bodyStart);
  const bodyEnd = scriptAt > 0 ? Math.min(scriptAt, bodyStart + 400000) : bodyStart + 400000;

  const imageUrls = [];
  let text = htmlToText(html.slice(bodyStart + 1, bodyEnd), imageUrls);
  // 只有图片没有文字的文章（海报通知）也是有效内容，不能按「读不到正文」处理。
  if (text.length < 20 && !imageUrls.length) throw new ApiError(422, 'ARTICLE_UNREADABLE', explainUnreadable(html));

  const warnings = [];
  let images = imageUrls.map((imageUrl, i) => ({ index: i + 1, url: imageUrl, kind: 'unread', text: '' }));

  if (imageUrls.length && visionEnabled(visionConfig)) {
    const entries = imageUrls.map((imageUrl, i) => ({ index: i + 1, url: imageUrl }));
    const read = await readImages(entries, visionConfig, fetchImpl);
    warnings.push(...read.warnings);
    text = applyImageText(text, read.results);
    images = entries.map((entry) => (
      read.results.get(entry.index) ?? { index: entry.index, kind: 'unread', text: '' }
    )).map((item, i) => ({ ...item, url: imageUrls[i] }));
    const infoCount = images.filter((item) => item.kind === 'info' && item.text).length;
    if (infoCount) warnings.push(`已从 ${infoCount} 张图片中读取文字，请核对关键时间与地点是否与图中一致。`);
  } else if (imageUrls.length) {
    warnings.push(`文中含 ${imageUrls.length} 张图片，未读取图中文字（未配置视觉模型）。若关键信息在图片里，请手动补充。`);
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    url,
    title: extractTitle(html),
    text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
    chars: Math.min(text.length, MAX_TEXT_CHARS),
    truncated,
    images,
    warnings,
  };
}
