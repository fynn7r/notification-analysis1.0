import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWechatArticle, isWechatArticleUrl } from './article-extract.mjs';

const ARTICLE_URL = 'https://mp.weixin.qq.com/s/AbCdEfG';

const articleHtml = `<!DOCTYPE html><html><head>
<meta property="og:title" content="测试通知：征文比赛">
</head><body>
<div class="rich_media_content js_content" id="js_content" style="visibility: hidden; opacity: 0; ">
<section><p>各位同学：</p><p>报名截止时间为2026年10月31日23:59。</p><p>报名地点：线上系统</p></section>
</div>
<script>var msg_title = '不该被读到';</script>
<div class="rich_media_tool"><p>预览时标签不可点</p></div>
</body></html>`;

function stubFetch(html, init = {}) {
  let called = null;
  const fn = async (url) => {
    called = url;
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
  };
  fn.calls = () => called;
  return fn;
}

test('只接受公众号文章链接', () => {
  assert.equal(isWechatArticleUrl('https://mp.weixin.qq.com/s/abc'), true);
  assert.equal(isWechatArticleUrl('http://mp.weixin.qq.com/s/abc?x=1'), true);
  assert.equal(isWechatArticleUrl('https://mp.weixin.qq.com.evil.com/s/abc'), false);
  assert.equal(isWechatArticleUrl('https://example.com/s/abc'), false);
  assert.equal(isWechatArticleUrl('mp.weixin.qq.com/s/abc'), false);
  assert.equal(isWechatArticleUrl('https://mp.weixin.qq.com/s/a b'), false);
  assert.equal(isWechatArticleUrl(''), false);
});

test('非公众号链接直接拒绝，且不发起请求', async () => {
  const fetchImpl = stubFetch(articleHtml);
  await assert.rejects(
    () => extractWechatArticle('https://example.com/notice', fetchImpl),
    (error) => error.status === 400 && error.code === 'UNSUPPORTED_URL',
  );
  assert.equal(fetchImpl.calls(), null, '不应向外发起请求');
});

test('提取正文与标题，且不混入脚本和页脚', async () => {
  const fetchImpl = stubFetch(articleHtml);
  const result = await extractWechatArticle(ARTICLE_URL, fetchImpl);
  assert.equal(fetchImpl.calls(), ARTICLE_URL);
  assert.equal(result.title, '测试通知：征文比赛');
  assert.match(result.text, /报名截止时间为2026年10月31日23:59/);
  assert.match(result.text, /报名地点：线上系统/);
  assert.doesNotMatch(result.text, /不该被读到/, '正文之后的脚本不能混入');
  assert.doesNotMatch(result.text, /预览时标签不可点/, '页脚噪声应被丢弃');
  assert.equal(result.truncated, false);
  assert.ok(result.chars > 0);
});

test('正文超过 20000 字时截断并标记', async () => {
  const long = `<div id="js_content">${'<p>' + '通'.repeat(500) + '</p>'.repeat(1)}</div>`;
  const html = `<div id="js_content">${'<p>' + '通知'.repeat(20000) + '</p>'}</div>${long}<script></script>`;
  const result = await extractWechatArticle(ARTICLE_URL, stubFetch(html));
  assert.equal(result.truncated, true);
  assert.equal(result.chars, 20000);
  assert.equal(result.text.length, 20000);
});

test('风控验证页给出可理解的提示', async () => {
  const html = '<html><body><div>环境异常，完成验证后即可继续访问</div></body></html>';
  await assert.rejects(
    () => extractWechatArticle(ARTICLE_URL, stubFetch(html)),
    (error) => error.status === 422 && error.code === 'ARTICLE_UNREADABLE' && /验证/.test(error.message),
  );
});

test('文章被删除时提示已删除', async () => {
  const html = '<html><body><div>该内容已被发布者删除</div></body></html>';
  await assert.rejects(
    () => extractWechatArticle(ARTICLE_URL, stubFetch(html)),
    (error) => error.status === 422 && /删除/.test(error.message),
  );
});

test('超时与网络失败分开报错', async () => {
  await assert.rejects(
    () => extractWechatArticle(ARTICLE_URL, async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; }),
    (error) => error.status === 504 && error.code === 'ARTICLE_TIMEOUT',
  );
  await assert.rejects(
    () => extractWechatArticle(ARTICLE_URL, async () => { throw new Error('ECONNRESET'); }),
    (error) => error.status === 504 && error.code === 'ARTICLE_UNREACHABLE',
  );
});

test('上游返回非 2xx 时报读取失败', async () => {
  const fetchImpl = async () => new Response('blocked', { status: 403 });
  await assert.rejects(
    () => extractWechatArticle(ARTICLE_URL, fetchImpl),
    (error) => error.status === 502 && error.code === 'ARTICLE_FETCH_FAILED',
  );
});

// ── 正文配图 ────────────────────────────────────────────────────────────

const articleWithImages = `<!DOCTYPE html><html><head>
<meta property="og:title" content="带图通知">
</head><body>
<div class="rich_media_content js_content" id="js_content">
<p>第二届征文竞赛通知如下。</p>
<img data-src="https://mmbiz.qpic.cn/poster.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
<p>请于10月31日前提交。</p>
<img data-src="https://mmbiz.qpic.cn/divider.gif" />
</div>
<script>var x = 'data-src="https://mmbiz.qpic.cn/script.jpg"';</script>
</body></html>`;

const VISION_CONFIG = { apiKey: 'sk-test', baseUrl: 'https://vision.example.com', model: 'vl-test', timeoutMs: 5000 };

/** 文章请求返回 HTML，视觉请求返回预设内容。 */
function stubDualFetch(html, visionContent, visionStatus = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: init?.body });
    if (String(url).startsWith('https://mp.weixin.qq.com')) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (visionStatus !== 200) return new Response('rejected', { status: visionStatus });
    return new Response(JSON.stringify({ choices: [{ message: { content: visionContent } }] }), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}

test('未配置视觉模型时保留图片占位符并明确提示未读', async () => {
  const fetchImpl = stubFetch(articleWithImages);
  const result = await extractWechatArticle(ARTICLE_URL, fetchImpl);

  assert.match(result.text, /\[图片 1\]/);
  assert.match(result.text, /\[图片 2\]/);
  assert.match(result.text, /请于10月31日前提交/, '占位符不能打乱正文顺序');
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].url, 'https://mmbiz.qpic.cn/poster.jpg');
  assert.equal(result.images[1].url, 'https://mmbiz.qpic.cn/divider.gif');
  assert.equal(result.images[0].kind, 'unread');
  assert.ok(result.warnings.some((item) => /2 张图片，未读取图中文字/.test(item)));
});

test('脚本里的图片地址不算正文配图', async () => {
  const result = await extractWechatArticle(ARTICLE_URL, stubFetch(articleWithImages));
  const urls = result.images.map((item) => item.url);
  assert.ok(!urls.includes('https://mmbiz.qpic.cn/script.jpg'), '只应统计正文容器内的图片');
});

test('配置视觉模型后把图中文字原位写回正文', async () => {
  const fetchImpl = stubDualFetch(articleWithImages, JSON.stringify({
    images: [
      { index: 1, kind: 'info', text: '报名截止 2026年10月31日 23:59' },
      { index: 2, kind: 'deco', text: '' },
    ],
  }));
  const result = await extractWechatArticle(ARTICLE_URL, { fetchImpl, visionConfig: VISION_CONFIG });

  assert.match(result.text, /\[图片 1：报名截止 2026年10月31日 23:59\]/);
  assert.match(result.text, /\[此处为装饰图片\]/, '装饰图应压缩成短标记');
  assert.doesNotMatch(result.text, /\[图片 2\]\n/);
  assert.equal(result.images[0].kind, 'info');
  assert.equal(result.images[1].kind, 'deco');
  assert.ok(result.warnings.some((item) => /已从 1 张图片中读取文字/.test(item)));
  // 视觉请求应带上配置的模型
  const visionCall = fetchImpl.calls.find((call) => String(call.url).includes('/chat/completions'));
  assert.match(visionCall.body, /vl-test/);
});

test('视觉接口失败时正文仍可用，图片标记为未识别', async () => {
  const fetchImpl = stubDualFetch(articleWithImages, '', 500);
  const result = await extractWechatArticle(ARTICLE_URL, { fetchImpl, visionConfig: VISION_CONFIG });

  assert.match(result.text, /请于10月31日前提交/, '正文不能因图片识别失败而丢失');
  assert.match(result.text, /\[图片 1：文字未能识别\]/);
  assert.equal(result.images[0].kind, 'unread');
  assert.ok(result.warnings.some((item) => /未能识别/.test(item)));
});

test('只有图片没有文字的文章按有效内容处理', async () => {
  const onlyImages = '<div id="js_content"><img data-src="https://mmbiz.qpic.cn/only.jpg" /></div><script></script>';
  const result = await extractWechatArticle(ARTICLE_URL, stubFetch(onlyImages));
  assert.equal(result.images.length, 1);
  assert.match(result.text, /\[图片 1\]/);
});

test('base64 内联图与缺少地址的图片不计入配图', async () => {
  const html = `<div id="js_content">
<p>正文内容足够长以通过长度检查，这里再写一些文字。</p>
<img src="data:image/png;base64,iVBORw0KGgo=" />
<img />
<img data-src="https://mmbiz.qpic.cn/real.jpg" />
</div><script></script>`;
  const result = await extractWechatArticle(ARTICLE_URL, stubFetch(html));
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].url, 'https://mmbiz.qpic.cn/real.jpg');
});
