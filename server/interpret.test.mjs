import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { interpretNotification, anchorEvidence } from './interpret-service.mjs';
import { createApiServer } from './index.mjs';

const config = { apiKey: 'interpret-test-secret', baseUrl: 'https://api.deepseek.com', model: 'default-model', interpretationModel: 'interpret-model', timeoutMs: 1000, maxTokens: 16384 };
const input = { text: '周三中午12点报名截止，不报名无法入场。', ruleContext: '【示例规则，仅供演示】报名不能保证加分。' };
const output = {
  original_notification_summary: '需先报名才能入场。',
  interpretation_items: [{ interpretation_content: '参加活动需要先完成报名。', action_suggestion: '截止前填写报名表。', confidence: '高', remarks: '原文明确', evidence: '不报名无法入场' }],
  overall_suggestion: '先完成报名，再安排参会。',
};
const completion = (value = output, finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }));

test('解读使用独立模型，原文与规则作为数据，保留原文依据并关闭思考，不自动重试', async () => {
  let calls = 0;
  const result = await interpretNotification(input, config, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.interpretationModel);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.max_tokens, 16384);
    assert.deepEqual(JSON.parse(body.messages[1].content), input);
    assert.match(body.messages[0].content, /推断，待确认/);
    return completion();
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ...output, source: 'real' });
});

test('解读未单独选模型时复用默认，兼容服务不收到专用参数', async () => {
  await interpretNotification(input, { ...config, interpretationModel: '', baseUrl: 'https://compatible.test/v1' }, async (url, options) => {
    assert.equal(url, 'https://compatible.test/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'default-model');
    assert.equal(body.thinking, undefined);
    return completion();
  });
});

test('解读拒绝空正文、无效可信度、非原文依据和输出截断，失败只调用一次', async () => {
  for (const [value, finish, code] of [
    ['', 'stop', 'AI_EMPTY_OUTPUT'], ['', 'length', 'AI_OUTPUT_TRUNCATED'],
    [{ ...output, interpretation_items: [] }, 'stop', 'INVALID_MODEL_OUTPUT'],
    [{ ...output, interpretation_items: [{ ...output.interpretation_items[0], confidence: '肯定' }] }, 'stop', 'INVALID_MODEL_OUTPUT'],
    [{ ...output, interpretation_items: [{ ...output.interpretation_items[0], evidence: '通知未说过的话' }] }, 'stop', 'INVALID_MODEL_OUTPUT'],
  ]) {
    let calls = 0;
    await assert.rejects(interpretNotification(input, config, async () => { calls++; return completion(value, finish); }), (error) => error.code === code);
    assert.equal(calls, 1);
  }
});

test('原文依据拼接了不相邻的句子时，收敛到其中一段真实原文，不整条作废', () => {
  const text = '一、提交方式\n1. 通过系统上传，不接受纸质材料。\n\n二、注意事项\n1. 提交后不可修改，请务必核对信息。';
  const spliced = '提交后不可修改，请务必核对信息。通过系统上传，不接受纸质材料。';
  // 拼接串整体不在原文，但拆开后每句都能逐字找到。
  assert.ok(!text.includes(spliced));
  assert.equal(anchorEvidence(spliced, text), '提交后不可修改，请务必核对信息。');
  // 原样命中时不做任何改动。
  assert.equal(anchorEvidence('不接受纸质材料', text), '不接受纸质材料');
  // 完全编造、或只剩过短片段时仍判为无依据，不放行。
  assert.equal(anchorEvidence('通知里根本没写过这句话。', text), null);
  assert.equal(anchorEvidence('假的', text), null);
});

test('拼接依据的解读能正常返回，返回的 evidence 必须能在原文中找到', async () => {
  const text = '一、提交方式\n1. 通过系统上传，不接受纸质材料。\n\n二、注意事项\n1. 提交后不可修改，请务必核对信息。';
  const spliced = '提交后不可修改，请务必核对信息。通过系统上传，不接受纸质材料。';
  const result = await interpretNotification({ text, ruleContext: '' }, config, async () => completion({
    ...output,
    interpretation_items: [{ ...output.interpretation_items[0], evidence: spliced }],
  }));
  assert.equal(result.interpretation_items[0].evidence, '提交后不可修改，请务必核对信息。');
  assert.ok(text.includes(result.interpretation_items[0].evidence));
});

test('无效输入及无密钥不调用解读模型', async () => {
  const neverFetch = () => assert.fail('不应调用模型');
  for (const invalid of [{ text: '' }, { ...input, ruleContext: '字'.repeat(60001) }]) {
    await assert.rejects(interpretNotification(invalid, config, neverFetch), (error) => error.code === 'INVALID_REQUEST');
  }
  await assert.rejects(interpretNotification(input, { ...config, apiKey: '' }, neverFetch), (error) => error.code === 'AI_NOT_CONFIGURED');
});

test('HTTP 深度解读成功不冒充基础解析验收，鉴权失败不泄露密钥', async () => {
  let authorized = true;
  const api = createApiServer(config, async () => authorized ? completion() : new Response(config.apiKey, { status: 401 }));
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${api.address().port}`;
  const post = () => fetch(`${base}/api/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  try {
    assert.deepEqual(await (await post()).json(), { ...output, source: 'real' });
    assert.equal((await (await fetch(`${base}/api/health`)).json()).realParseVerified, false);
    authorized = false;
    const failed = await post();
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes(config.apiKey));
  } finally { api.closeAllConnections(); await new Promise((resolve) => api.close(resolve)); }
});
