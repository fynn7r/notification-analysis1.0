import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { generateNotification } from './generate-service.mjs';
import { ApiError } from './parse-service.mjs';
import { createApiServer } from './index.mjs';
import { generationRequest } from './fixtures.mjs';
import { generateStyles } from '../shared/generate-contract.ts';

const config = { apiKey: 'test-key-never-use-in-production', baseUrl: 'https://api.deepseek.com', model: 'test-model', timeoutMs: 1000 };
// 测试用模型响应，不作为真实生成验收结果。
const content = Object.values(generationRequest).filter((value) => typeof value === 'string').join('\n');
const completion = (value = { content }, finishReason = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason: finishReason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }],
}));
const errorCode = (code, status) => (error) => error instanceof ApiError && error.code === code && error.status === status;

test('生成模型请求包含全部字段与截止时间，四种风格和表情开关均传给模型', async () => {
  for (const style of generateStyles) {
    for (const enableEmoji of [true, false]) {
      const input = { ...generationRequest, style, enableEmoji };
      let calls = 0;
      const result = await generateNotification(input, config, async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.deepseek.com/chat/completions');
        const body = JSON.parse(options.body);
        assert.deepEqual(body.thinking, { type: 'disabled' });
        assert.deepEqual(body.response_format, { type: 'json_object' });
        assert.equal(body.max_tokens, 2048);
        assert.deepEqual(JSON.parse(body.messages[1].content), input);
        assert.match(body.messages[0].content, /不得编造/);
        return completion();
      });
      assert.equal(calls, 1);
      assert.deepEqual(result, { source: 'real', content });
    }
  }
});

test('无密钥、必填缺失、风格无效、非布尔开关及超长输入都不调用模型', async () => {
  const neverFetch = async () => { assert.fail('不应调用模型'); };
  await assert.rejects(generateNotification(generationRequest, { ...config, apiKey: '' }, neverFetch), errorCode('AI_NOT_CONFIGURED', 503));
  for (const input of [
    ...['topic', 'time', 'location', 'participants'].map((field) => ({ ...generationRequest, [field]: '  ' })),
    { ...generationRequest, style: '不存在的风格' }, { ...generationRequest, enableEmoji: '是' },
    { ...generationRequest, notes: '字'.repeat(5001) },
  ]) await assert.rejects(generateNotification(input, config, neverFetch), errorCode('INVALID_REQUEST', 400));
});

test('通知正文为空、损坏、截断或遗漏关键截止时间不能作为成功结果，不重试', async () => {
  for (const [value, finish, code] of [
    ['', 'stop', 'AI_EMPTY_OUTPUT'], ['not json', 'stop', 'INVALID_MODEL_OUTPUT'],
    [{ content: '' }, 'stop', 'INVALID_MODEL_OUTPUT'], [42, 'stop', 'INVALID_MODEL_OUTPUT'],
    [{ content }, 'length', 'AI_OUTPUT_TRUNCATED'], ['', 'length', 'AI_OUTPUT_TRUNCATED'],
    [{ content: content.replace(generationRequest.deadline, '') }, 'stop', 'INVALID_MODEL_OUTPUT'],
    [{ content }, 'content_filter', 'INVALID_MODEL_OUTPUT'],
  ]) {
    let calls = 0;
    await assert.rejects(generateNotification(generationRequest, config, async () => {
      calls++;
      return completion(value, finish);
    }), errorCode(code, 502));
    assert.equal(calls, 1);
  }
});

test('生成端显示鉴权、余额、限流、超时和连接错误，不泄露上游或密钥', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [402, 'AI_BALANCE_REQUIRED'], [429, 'AI_RATE_LIMITED'], [500, 'AI_UPSTREAM_ERROR']]) {
    await assert.rejects(generateNotification(generationRequest, config, async () => new Response(config.apiKey, { status })), (error) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(config.apiKey));
      return true;
    });
  }
  await assert.rejects(generateNotification(generationRequest, config, async () => { throw new DOMException('timeout', 'TimeoutError'); }), errorCode('AI_TIMEOUT', 504));
  await assert.rejects(generateNotification(generationRequest, config, async () => { throw new TypeError('fetch failed'); }), errorCode('AI_NETWORK_ERROR', 502));
});

test('HTTP生成接口成功与输入错误，生成成功不冒充通知解析已验收', async () => {
  const api = createApiServer(config, async () => completion());
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${api.address().port}`;
  const post = (body, headers = { 'Content-Type': 'application/json' }) => fetch(`${base}/api/generate`, { method: 'POST', headers, body });
  try {
    const result = await post(JSON.stringify(generationRequest));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { source: 'real', content });
    assert.equal((await (await fetch(`${base}/api/health`)).json()).realParseVerified, false);
    assert.equal((await post('{}', {})).status, 415);
    assert.equal((await post('broken')).status, 400);
    assert.equal((await post('{}')).status, 400);
    assert.equal((await fetch(`${base}/api/generate`)).status, 404);
  } finally {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  }
});
