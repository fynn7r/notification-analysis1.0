import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ApiError, configuration, parseNotification } from './parse-service.mjs';
import { createApiServer } from './index.mjs';
import { signupRequest, signupModelOutput, competitionRequest } from './fixtures.mjs';
import { relativeDate, toDateTimeInput, toZonedIso } from '../shared/date-time.ts';

const config = { apiKey: 'test-key-never-use-in-production', baseUrl: 'https://test.invalid/v1', model: 'test-model', timeoutMs: 1000, maxTokens: 16384 };
const completion = (value = signupModelOutput, finishReason = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason: finishReason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }],
}));
const errorCode = (code, status) => (error) => error instanceof ApiError && error.code === code && error.status === status;
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test('解析接口契约：报名截止、活动开始和提前30分钟提醒保持独立', async () => {
  let callCount = 0;
  const result = await parseNotification(signupRequest, config, async (url, options) => {
    callCount++;
    assert.equal(url, 'https://test.invalid/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.match(body.messages[0].content, /2026-10-05/);
    assert.match(body.messages[0].content, /从周一开始/);
    assert.equal(body.messages[1].content, signupRequest.text);
    return completion();
  });
  assert.equal(callCount, 1);
  assert.equal(result.action.title, '填写青马学堂报名表');
  assert.equal(result.action.deadline, '2026-10-07T12:00:00+08:00');
  assert.equal(result.notification.eventStartTime, '2026-10-08T20:00:00+08:00');
  assert.equal(toDateTimeInput(result.action.remindAt), '2026-10-07T11:30');
  assert.deepEqual(result.warnings, []);
});

test('日期写成「11 月 7 日」这类中英混排时，空白不影响时间解析', async () => {
  // 微信、Word 排版常把数字与汉字之间加空格；这类证据曾被误判为「日期不完整」并丢弃截止时间。
  const text = '本周四晚20:00开展线下分享会，报名截止：本周三中午12点。系统填报：11 月 3 日 9:00 至 11 月 7 日 17:00。';
  const spaced = { ...signupModelOutput, deadline: { date: '2026-11-07', time: '17:00', evidence: '11 月 7 日 17:00' } };
  const result = await parseNotification({ ...signupRequest, text }, config, async () => completion(spaced));
  assert.equal(result.action.deadline, '2026-11-07T17:00:00+08:00');
  assert.equal(toDateTimeInput(result.action.remindAt), '2026-11-07T16:30');
  assert.deepEqual(result.warnings, []);
  assert.equal(relativeDate('本周 四', '2026-10-05'), '2026-10-08');
});

test('星期换算以参考日期的周一为基准，不信任模型错误的日期', async () => {
  const wrongDates = { ...signupModelOutput, deadline: { ...signupModelOutput.deadline, date: '2026-10-14' } };
  const result = await parseNotification({ ...signupRequest, referenceDate: '2026-10-11' }, config, async () => completion(wrongDates));
  assert.equal(result.action.deadline, '2026-10-07T12:00:00+08:00');
  assert.equal(relativeDate('下周一', '2026-12-31'), '2027-01-04');
  assert.equal(relativeDate('明天', '2026-12-31'), '2027-01-01');
});

test('没有截止时间时不把活动时间作为截止，不生成默认提醒', async () => {
  const result = await parseNotification({ ...signupRequest, text: '本周四晚20:00开展青马学堂线下分享会。' }, config, async () => completion({ ...signupModelOutput, deadline: null }));
  assert.equal(result.action.deadline, null);
  assert.equal(result.action.remindAt, null);
  assert.match(result.notification.eventStartTime, /20:00:00/);
  assert.match(result.warnings.join(''), /手动补齐/);
});

test('日期没有明确钟点时，即使模型猜测钟点也要求手动补齐', async () => {
  const result = await parseNotification({ ...signupRequest, text: '请在本周三报名。' }, config, async () => completion({
    ...signupModelOutput, deadline: { date: '2026-10-07', time: '23:59', evidence: '本周三' }, eventTime: null,
  }));
  assert.equal(result.action.deadline, null);
  assert.equal(result.action.remindAt, null);
});

test('无密钥或无效输入不会发起模型请求', async () => {
  const neverFetch = async () => { assert.fail('不应调用模型'); };
  await assert.rejects(parseNotification(signupRequest, { ...config, apiKey: '' }, neverFetch), errorCode('AI_NOT_CONFIGURED', 503));
  for (const input of [
    { ...signupRequest, text: '' }, { ...signupRequest, referenceDate: '2026-02-30' },
    { ...signupRequest, timezone: 'not-a-timezone' }, { ...signupRequest, text: '字'.repeat(20001) },
  ]) await assert.rejects(parseNotification(input, config, neverFetch), errorCode('INVALID_REQUEST', 400));
});

test('模型鉴权、余额、限流和服务器错误返回清楚的错误，不泄露密钥', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [403, 'AI_AUTH_FAILED'], [402, 'AI_BALANCE_REQUIRED'], [429, 'AI_RATE_LIMITED'], [500, 'AI_UPSTREAM_ERROR']]) {
    await assert.rejects(parseNotification(signupRequest, config, async () => new Response(config.apiKey, { status })), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes(config.apiKey));
      return true;
    });
  }
});

test('损坏和不符合字段要求的模型输出不会作为成功结果', async () => {
  for (const value of ['not json', '{}', { ...signupModelOutput, title: '' }, { ...signupModelOutput, deadline: { ...signupModelOutput.deadline, date: '2026-02-30' } }]) {
    await assert.rejects(parseNotification(signupRequest, config, async () => completion(value)), errorCode('INVALID_MODEL_OUTPUT', 502));
  }
  await assert.rejects(parseNotification(signupRequest, config, async () => completion(signupModelOutput, 'content_filter')), errorCode('INVALID_MODEL_OUTPUT', 502));
  await assert.rejects(parseNotification(signupRequest, config, async () => completion({ ...signupModelOutput, deadline: { ...signupModelOutput.deadline, evidence: '不存在的时间' } })), errorCode('INVALID_MODEL_OUTPUT', 502));
});

test('官方 DeepSeek 关闭思考并保持 JSON 和额度，兼容接口不接收专用参数', async () => {
  for (const baseUrl of ['https://api.deepseek.com', 'https://api.deepseek.com/v1', 'https://gateway.example/v1', 'https://api.deepseek.com.example/v1']) {
    await parseNotification(signupRequest, { ...config, baseUrl, model: 'deepseek-flash' }, async (_url, options) => {
      const body = JSON.parse(options.body);
      if (new URL(baseUrl).hostname === 'api.deepseek.com') assert.deepEqual(body.thinking, { type: 'disabled' });
      else assert.ok(!Object.hasOwn(body, 'thinking'));
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.max_tokens, 16384);
      return completion();
    });
  }
});

test('思考耗尽额度且正文为空时报告输出上限，不自动重试', async () => {
  let calls = 0;
  await assert.rejects(parseNotification(competitionRequest, config, async () => {
    calls++;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '测试占位思考内容' } }],
      usage: { completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 7900 } },
    }));
  }), errorCode('AI_OUTPUT_TRUNCATED', 502));
  assert.equal(calls, 1);
  // 即使被截断的正文碰巧是合法 JSON，也不能保存不完整结果。
  await assert.rejects(parseNotification(signupRequest, config, async () => completion(signupModelOutput, 'length')), errorCode('AI_OUTPUT_TRUNCATED', 502));
});

test('输出上限按服务商取默认值，可被 AI_MAX_TOKENS 覆盖，非法值回落到安全范围', () => {
  // 官方 DeepSeek 单次输出上限是 8192，给更大值会被直接拒绝；
  // 网关上的思考型模型思考更久，按 16384 起步。
  assert.equal(configuration({}).maxTokens, 8192);
  assert.equal(configuration({ AI_BASE_URL: 'https://maas.example.com/v1' }).maxTokens, 16384);
  assert.equal(configuration({ AI_MAX_TOKENS: '32768' }).maxTokens, 32768);
  assert.equal(configuration({ AI_MAX_TOKENS: '4096.7' }).maxTokens, 4096);
  // 过小会被正文截断，过大则被服务商拒绝，两侧都收敛到可用区间。
  assert.equal(configuration({ AI_MAX_TOKENS: '100' }).maxTokens, 512);
  assert.equal(configuration({ AI_MAX_TOKENS: '999999' }).maxTokens, 65536);
  assert.equal(configuration({ AI_MAX_TOKENS: 'abc' }).maxTokens, 8192);
  assert.equal(configuration({ AI_MAX_TOKENS: '0' }).maxTokens, 8192);
  // 长文解读实测约 80 秒，超时默认值必须与之匹配，否则提高上限只会变成超时。
  assert.equal(configuration({}).timeoutMs, 120000);
});

test('截断提示说明思考占用与可调项，不再一律归咎于通知太长', async () => {
  const truncate = (usage) => parseNotification(competitionRequest, config, async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '' } }], ...(usage ? { usage } : {}),
  }))).catch((error) => error);

  const withReasoning = await truncate({ completion_tokens: 8192, completion_tokens_details: { reasoning_tokens: 7300 } });
  assert.equal(withReasoning.code, 'AI_OUTPUT_TRUNCATED');
  assert.match(withReasoning.message, /16384 token 上限/);
  assert.match(withReasoning.message, /思考过程占用约 7300 token/);
  assert.match(withReasoning.message, /模型接入.*调高输出上限/);

  // 拿不到思考用量时退回到“内容较长”，不编造数字。
  const withoutUsage = await truncate(null);
  assert.match(withoutUsage.message, /16384 token 上限/);
  assert.doesNotMatch(withoutUsage.message, /思考过程占用约/);
});

test('正常结束但内容为空，与输出上限和字段错误分别提示', async () => {
  for (const content of ['', ' \n ', null]) {
    await assert.rejects(parseNotification(signupRequest, config, async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content } }],
    }))), errorCode('AI_EMPTY_OUTPUT', 502));
  }
});

test('竞赛示例的日期占位词不能生成实际日期或提醒', async () => {
  const result = await parseNotification(competitionRequest, config, async () => completion({
    ...signupModelOutput, title: '数学建模竞赛校内选拔赛', type: '比赛竞赛', actionTitle: '组队并完成报名',
    deadline: { date: '2026-10-07', time: '23:59', evidence: '报名截止日 23:59' },
    eventTime: { date: '2026-10-08', time: '09:00', evidence: '竞赛当天上午9:00' },
  }));
  assert.equal(result.action.deadline, null);
  assert.equal(result.action.remindAt, null);
  assert.equal(result.notification.eventStartTime, null);
  assert.match(result.warnings.join(''), /补齐/);
  assert.match(result.warnings.join(''), /报名截止日 23:59/);
  assert.match(result.warnings.join(''), /竞赛当天上午9:00/);
});

test('无效日历、午夜和非上海设备时区的转换不会产生时间偏移', () => {
  assert.equal(toZonedIso('2026-02-30T12:00'), null);
  assert.equal(toZonedIso('2026-10-07T24:00'), null);
  assert.equal(toZonedIso('2026-10-07T00:00'), '2026-10-07T00:00:00+08:00');
  assert.equal(toZonedIso('2026-03-08T02:30', 'America/New_York'), null);
});

test('HTTP路径经过真实本地上游传输后成功；健康状态仅在成功后更新', async () => {
  let requests = 0;
  const upstream = createServer(async (req, res) => {
    requests++;
    assert.equal(req.url, '/v1/chat/completions');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).model, 'test-model');
    res.setHeader('Content-Type', 'application/json');
    res.end(await completion().text());
  });
  const upstreamUrl = await listen(upstream);
  const api = createApiServer({ ...config, baseUrl: `${upstreamUrl}/v1` });
  const apiUrl = await listen(api);
  try {
    assert.deepEqual(await (await fetch(`${apiUrl}/api/health`)).json(), { configured: true, realParseVerified: false });
    const response = await fetch(`${apiUrl}/api/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signupRequest) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).action.title, '填写青马学堂报名表');
    assert.equal(requests, 1);
    assert.equal((await (await fetch(`${apiUrl}/api/health`)).json()).realParseVerified, true);
    assert.equal((await fetch(`${apiUrl}/api/parse`, { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(`${apiUrl}/api/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'broken' })).status, 400);
    assert.equal((await fetch(`${apiUrl}/other`)).status, 404);
  } finally { await close(api); await close(upstream); }
});

test('HTTP未配置密钥时明确保持未验证状态', async () => {
  const api = createApiServer({ ...config, apiKey: '' });
  const url = await listen(api);
  try {
    const result = await fetch(`${url}/api/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signupRequest) });
    assert.equal(result.status, 503);
    assert.match((await result.json()).error.message, /真实解析尚未验证/);
    assert.equal((await (await fetch(`${url}/api/health`)).json()).realParseVerified, false);
  } finally { await close(api); }
});

test('真实本地上游超时返回504，允许用户重试', async () => {
  const upstream = createServer(() => {});
  const url = await listen(upstream);
  try {
    await assert.rejects(parseNotification(signupRequest, { ...config, baseUrl: url, timeoutMs: 30 }), errorCode('AI_TIMEOUT', 504));
  } finally { await close(upstream); }
});
