import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImageText, readImages, visionConfiguration, visionEnabled } from './vision-service.mjs';

/** 构造一个假的视觉接口：按调用顺序返回预设内容，或直接抛错/返回非 2xx。 */
function fakeVision(responses) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization });
    const next = responses.shift();
    if (!next) throw new Error('测试未提供更多响应');
    if (next.throw) throw next.throw;
    if (next.status && next.status !== 200) {
      return new Response(next.body ?? 'boom', { status: next.status });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: next.content } }] }), { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

const CONFIG = { apiKey: 'sk-test', baseUrl: 'https://vision.example.com', model: 'qwen3-vl-plus', timeoutMs: 5000 };

test('未配置视觉模型时不启用，配置完整才启用', () => {
  assert.equal(visionEnabled(visionConfiguration({ AI_API_KEY: 'k' })), false);
  assert.equal(visionEnabled(visionConfiguration({ AI_API_KEY: 'k', AI_VISION_MODEL: 'm' })), true);
  // 只有模型没有密钥也不能用
  assert.equal(visionEnabled(visionConfiguration({ AI_VISION_MODEL: 'm' })), false);
});

test('视觉配置默认复用文本模型的地址与密钥', () => {
  const config = visionConfiguration({
    AI_API_KEY: 'sk-main', AI_BASE_URL: 'https://gateway.example.com/v1/', AI_VISION_MODEL: 'vl',
  });
  assert.equal(config.apiKey, 'sk-main');
  assert.equal(config.baseUrl, 'https://gateway.example.com/v1');
  assert.equal(config.model, 'vl');
});

test('视觉配置支持单独指定地址与密钥', () => {
  const config = visionConfiguration({
    AI_API_KEY: 'sk-main', AI_VISION_API_KEY: 'sk-vision',
    AI_VISION_BASE_URL: 'https://other.example.com', AI_VISION_MODEL: 'vl',
  });
  assert.equal(config.apiKey, 'sk-vision');
  assert.equal(config.baseUrl, 'https://other.example.com');
});

test('装饰图压成短标记，信息图原位写入文字', () => {
  const text = '开头\n[图片 1]\n中间\n[图片 2]\n结尾';
  const results = new Map([
    [1, { index: 1, kind: 'deco', text: '' }],
    [2, { index: 2, kind: 'info', text: '报名截止 10月31日 23:59' }],
  ]);
  assert.equal(applyImageText(text, results), '开头\n[此处为装饰图片]\n中间\n[图片 2：报名截止 10月31日 23:59]\n结尾');
});

test('二维码、未识别、无结果三种情况分别处理', () => {
  const text = '[图片 1][图片 2][图片 3][图片 4]';
  const results = new Map([
    [1, { index: 1, kind: 'qr', text: '扫码报名' }],
    [2, { index: 2, kind: 'unread', text: '' }],
    [3, { index: 3, kind: 'other', text: '' }],
  ]);
  assert.equal(applyImageText(text, results), '[图片 1：扫码报名][图片 2：文字未能识别][图片 3][图片 4]');
});

test('正常识别时按序号回填，并使用视觉模型与鉴权头', async () => {
  const fetchImpl = fakeVision([{
    content: JSON.stringify({ images: [
      { index: 1, kind: 'info', text: '时间：11月8日 19:00' },
      { index: 2, kind: 'deco', text: '' },
    ] }),
  }]);
  const { results, warnings } = await readImages([
    { index: 1, url: 'https://img/1.jpg' },
    { index: 2, url: 'https://img/2.jpg' },
  ], CONFIG, fetchImpl);

  assert.equal(results.get(1).kind, 'info');
  assert.equal(results.get(1).text, '时间：11月8日 19:00');
  assert.equal(results.get(2).kind, 'deco');
  assert.deepEqual(warnings, []);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].auth, 'Bearer sk-test');
  assert.equal(fetchImpl.calls[0].body.model, 'qwen3-vl-plus');
  // 图片应按 URL 形式传给模型，而不是 base64 内联
  const imageBlocks = fetchImpl.calls[0].body.messages[0].content.filter((block) => block.type === 'image_url');
  assert.equal(imageBlocks.length, 2);
  assert.equal(imageBlocks[0].image_url.url, 'https://img/1.jpg');
});

test('模型把 JSON 包在代码块里也能解析', async () => {
  const fetchImpl = fakeVision([{
    content: '```json\n{"images":[{"index":1,"kind":"info","text":"地点：活动中心"}]}\n```',
  }]);
  const { results } = await readImages([{ index: 1, url: 'https://img/1.jpg' }], CONFIG, fetchImpl);
  assert.equal(results.get(1).text, '地点：活动中心');
});

test('模型漏答的图片按未识别处理，不臆造内容', async () => {
  const fetchImpl = fakeVision([{ content: JSON.stringify({ images: [{ index: 1, kind: 'info', text: 'A' }] }) }]);
  const { results } = await readImages([
    { index: 1, url: 'https://img/1.jpg' },
    { index: 2, url: 'https://img/2.jpg' },
  ], CONFIG, fetchImpl);
  assert.equal(results.get(1).kind, 'info');
  assert.equal(results.get(2).kind, 'other');
  assert.equal(results.get(2).text, '');
});

test('单批请求失败时整批降级为未识别并给出提示', async () => {
  const fetchImpl = fakeVision([{ status: 402, body: 'insufficient balance' }]);
  const { results, warnings } = await readImages([{ index: 1, url: 'https://img/1.jpg' }], CONFIG, fetchImpl);
  assert.equal(results.get(1).kind, 'unread');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /未能识别/);
  assert.match(warnings[0], /402/);
  assert.match(warnings[1], /图片文字全部读取失败/);
});

test('模型返回非 JSON 时降级而不抛错', async () => {
  const fetchImpl = fakeVision([{ content: '抱歉，我看不清这些图片。' }]);
  const { results, warnings } = await readImages([{ index: 1, url: 'https://img/1.jpg' }], CONFIG, fetchImpl);
  assert.equal(results.get(1).kind, 'unread');
  assert.ok(warnings.length >= 1);
});

test('图片超过上限时只识别前 12 张并提示', async () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({ index: i + 1, url: `https://img/${i + 1}.jpg` }));
  const batchOne = Array.from({ length: 6 }, (_, i) => ({ index: i + 1, kind: 'deco', text: '' }));
  const batchTwo = Array.from({ length: 6 }, (_, i) => ({ index: i + 7, kind: 'deco', text: '' }));
  const fetchImpl = fakeVision([
    { content: JSON.stringify({ images: batchOne }) },
    { content: JSON.stringify({ images: batchTwo }) },
  ]);
  const { results, warnings } = await readImages(entries, CONFIG, fetchImpl);
  assert.equal(fetchImpl.calls.length, 2, '13 张以上最多两次批量调用');
  assert.equal(results.size, 12);
  assert.match(warnings[0], /15 张图片，仅识别了前 12 张/);
});

test('没有图片时不发起任何请求', async () => {
  const fetchImpl = fakeVision([]);
  const { results, warnings } = await readImages([], CONFIG, fetchImpl);
  assert.equal(results.size, 0);
  assert.deepEqual(warnings, []);
  assert.equal(fetchImpl.calls.length, 0);
});

test('誊抄文字压成单行，半角方括号换成全角以免破坏占位符', async () => {
  const fetchImpl = fakeVision([{
    content: JSON.stringify({ images: [
      { index: 1, kind: 'info', text: '第二届\n"智创未来"\n\n报名截止 10月31日' },
      { index: 2, kind: 'info', text: '附表[一]内容' },
    ] }),
  }]);
  const { results } = await readImages([
    { index: 1, url: 'https://img/1.jpg' },
    { index: 2, url: 'https://img/2.jpg' },
  ], CONFIG, fetchImpl);

  assert.doesNotMatch(results.get(1).text, /\n/, '换行会让 [图片 N：…] 跨行');
  assert.match(results.get(1).text, /第二届 "智创未来" 报名截止 10月31日/);
  assert.equal(results.get(2).text, '附表［一］内容');
});
