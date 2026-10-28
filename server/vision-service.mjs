/**
 * 公众号文章配图的文字识别。
 *
 * 走 OpenAI 兼容的视觉接口，把图片 URL 直接交给模型（DeepSeek 官方与多数中转网关都支持外链图片）。
 * 设计原则：任何失败都降级为「保留占位符 + 提示」，绝不阻断文章正文的解析流程——
 * 通知的文字部分才是主体，图片只是补充。
 */

// 单篇文章最多识别的图片张数。图片密集的文章（宣传长图）可能几十张，全读既慢又没必要。
const MAX_IMAGES = 12;
// 单批送几张。批量调用比逐张调用快，但一批失败会连带整批，故控制在 6 张。
const BATCH_SIZE = 6;
const VISION_TIMEOUT_MS = 60000;

/** 视觉模型独立配置：未配置 AI_VISION_MODEL 时沿用文本模型并不安全，故留空即视为关闭。 */
export function visionConfiguration(env = process.env) {
  return {
    apiKey: env.AI_VISION_API_KEY || env.AI_API_KEY || env.DEEPSEEK_API_KEY || '',
    baseUrl: (env.AI_VISION_BASE_URL || env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: env.AI_VISION_MODEL || '',
    timeoutMs: Number(env.AI_VISION_TIMEOUT_MS) || VISION_TIMEOUT_MS,
  };
}

export function visionEnabled(config) {
  return Boolean(config?.apiKey?.trim() && config?.model?.trim());
}

const PROMPT_HEAD = `你是通知类图片的识别器。下面是一个编号序列中的若干张图片，每张前面有【图片 N】标记。
逐张判断并输出：
- 含文字信息的（时间、地点、要求、报名方式、日程、名单、奖项、联系方式等）→ kind="info"，text 必须原样誊抄图中关键文字，保留数字、日期、单位名称与标点，不得改写、不得总结、不得补充原文没有的内容；
- 纯装饰、分割线、纯图案、logo → kind="deco"，text 为空字符串；
- 二维码、小程序码 → kind="qr"，text 写明扫码用途（如"扫码报名"，原文没有就写"二维码"）；
- 看不清或无法归类 → kind="other"，text 为空字符串。
只输出一个 JSON 对象，不要 Markdown，不要解释：
{"images":[{"index":1,"kind":"info","text":"..."}]}
index 必须与【图片 N】中的 N 完全一致。`;

function parseModelJson(raw) {
  const text = String(raw ?? '').trim();
  const attempts = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  const braced = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (braced >= 0 && lastBrace > braced) attempts.push(text.slice(braced, lastBrace + 1));
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Array.isArray(parsed.images)) return parsed.images;
    } catch { /* 继续尝试下一种方式 */ }
  }
  return null;
}

function normalizeItems(items, batch) {
  const byIndex = new Map();
  for (const item of items) {
    const index = Number(item?.index);
    if (!Number.isInteger(index) || !batch.some((entry) => entry.index === index)) continue;
    const kind = ['info', 'deco', 'qr', 'other'].includes(item?.kind) ? item.kind : 'other';
    // 誊抄文字要压成单行，否则回填后 [图片 N：…] 会跨行，破坏正文结构；
    // 半角方括号换成全角，避免与占位符标记自身的括号混淆。
    const text = typeof item?.text === 'string'
      ? item.text
        .replace(/\s+/g, ' ')
        .replace(/\[/g, '［')
        .replace(/\]/g, '］')
        .trim()
        .slice(0, 1500)
      : '';
    byIndex.set(index, { index, kind, text });
  }
  return byIndex;
}

async function readBatch(batch, config, fetchImpl) {
  const content = [{ type: 'text', text: `${PROMPT_HEAD}\n本批共 ${batch.length} 张。` }];
  for (const entry of batch) {
    content.push({ type: 'text', text: `【图片 ${entry.index}】` });
    content.push({ type: 'image_url', image_url: { url: entry.url } });
  }
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content }],
      max_tokens: 3000,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`视觉接口返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ''}`);
  }
  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content;
  const items = parseModelJson(typeof raw === 'string' ? raw : '');
  if (!items) throw new Error('视觉模型返回的内容不是预期的 JSON 结构');
  return normalizeItems(items, batch);
}

/**
 * 识别若干张图片。并发分两批上限，单批失败只影响该批。
 * @param {{index: number, url: string}[]} entries
 * @returns {Promise<{results: Map<number, {index: number, kind: string, text: string}>, warnings: string[]}>}
 */
export async function readImages(entries, config, fetchImpl = fetch) {
  const results = new Map();
  const warnings = [];
  if (!entries.length) return { results, warnings };

  const limited = entries.slice(0, MAX_IMAGES);
  if (entries.length > MAX_IMAGES) {
    warnings.push(`文中含 ${entries.length} 张图片，仅识别了前 ${MAX_IMAGES} 张。`);
  }

  const batches = [];
  for (let i = 0; i < limited.length; i += BATCH_SIZE) batches.push(limited.slice(i, i + BATCH_SIZE));

  let failedBatches = 0;
  for (const batch of batches) {
    try {
      const parsed = await readBatch(batch, config, fetchImpl);
      for (const entry of batch) {
        // 模型漏答的图片按未识别处理，不臆造内容。
        results.set(entry.index, parsed.get(entry.index) ?? { index: entry.index, kind: 'other', text: '' });
      }
    } catch (error) {
      failedBatches += 1;
      warnings.push(`有 ${batch.length} 张图片未能识别：${error?.message || '未知错误'}`);
      for (const entry of batch) results.set(entry.index, { index: entry.index, kind: 'unread', text: '' });
    }
  }
  if (failedBatches && failedBatches === batches.length) {
    warnings.push('图片文字全部读取失败，解析仅依据正文文字。');
  }
  return { results, warnings };
}

/**
 * 把识别结果原位替换回占位符，保持正文顺序，让时间/地点处在原来的上下文里。
 * 装饰图直接压缩成短标记，避免稀释模型对正文的注意力。
 */
export function applyImageText(text, results) {
  return text.replace(/\[图片 (\d+)\]/g, (whole, raw) => {
    const hit = results.get(Number(raw));
    if (!hit) return whole;
    if (hit.kind === 'deco') return '[此处为装饰图片]';
    if (hit.kind === 'qr') return `[图片 ${raw}：${hit.text || '二维码'}]`;
    if (hit.kind === 'unread') return `[图片 ${raw}：文字未能识别]`;
    if (!hit.text) return whole;
    return `[图片 ${raw}：${hit.text}]`;
  });
}
