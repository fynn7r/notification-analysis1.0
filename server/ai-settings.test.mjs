import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createEnvSettingsStore, publicAiSettings, listAiModels, getAiBalance } from './ai-settings-service.mjs';
import { createApiServer } from './index.mjs';
import { generationRequest } from './fixtures.mjs';

const config = { apiKey: 'settings-test-secret', baseUrl: 'https://api.deepseek.com/v1', model: 'default-model', timeoutMs: 1000, maxTokens: 16384 };
const input = { baseUrl: config.baseUrl, model: 'new-default', interpretationModel: 'new-interpret', generateModel: 'new-generate', consoleUrl: '', apiKey: '' };
const balance = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' }] };
const json = (value) => new Response(JSON.stringify(value));

async function temporaryStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'notizhi-ai-settings-'));
  const path = join(directory, '.env.local');
  await writeFile(path, `# existing settings\nAI_API_KEY=${config.apiKey}\nAI_BASE_URL=${config.baseUrl}\nAI_MODEL=${config.model}\nAPI_PORT=3999\nAI_TIMEOUT_MS=12000\nOTHER_VALUE=preserve-me\n`);
  try { await run(createEnvSettingsStore(path, {}), path); }
  finally { await unlink(path); await rmdir(directory); }
}

test('页面配置从不回传密钥，仅返回配置状态、模型和输出上限', () => {
  const result = publicAiSettings(config);
  assert.equal(result.configured, true);
  assert.equal(result.balanceSupported, true);
  assert.equal(result.maxTokens, 16384);
  assert.equal(result.consoleUrl, 'https://platform.deepseek.com');
  assert.ok(!JSON.stringify(result).includes(config.apiKey));
  assert.ok(!Object.hasOwn(result, 'apiKey'));
});

test('保存模型后即时读取，空密钥保留旧值，重建服务仍可读取且保留无关环境变量', async () => {
  await temporaryStore(async (store, path) => {
    const saved = await store.save(input);
    assert.equal(saved.generateModel, input.generateModel);
    assert.equal(store.getConfig().apiKey, config.apiKey);
    assert.equal(store.getConfig().timeoutMs, 12000);
    assert.equal(createEnvSettingsStore(path, {}).getConfig().interpretationModel, input.interpretationModel);
    const content = await readFile(path, 'utf8');
    assert.match(content, /API_PORT=3999/);
    assert.match(content, /OTHER_VALUE=preserve-me/);
    await store.save({ ...input, apiKey: 'replacement-key' });
    assert.equal(store.getConfig().apiKey, 'replacement-key');
  });
});

test('服务商更换要求对应密钥，无效配置不写文件；保存失败不破坏原配置', async () => {
  await temporaryStore(async (store, path) => {
    const original = await readFile(path, 'utf8');
    for (const invalid of [
      { ...input, baseUrl: 'https://other.test/v1' },
      { ...input, apiKey: 'key\nAPI_PORT=1234' }, { ...input, baseUrl: 'javascript:alert(1)' },
      { ...input, baseUrl: 'https://user:password@api.deepseek.com' },
      { ...input, baseUrl: 'https://api.deepseek.com/chat/completions' },
      { ...input, model: 'bad model' }, { ...input, consoleUrl: 'file:///private' },
    ]) await assert.rejects(store.save(invalid), (error) => ['INVALID_SETTINGS', 'AI_NEW_KEY_REQUIRED'].includes(error.code));
    assert.equal(await readFile(path, 'utf8'), original);
    const missing = createEnvSettingsStore(join(path, 'missing.env'), {});
    await assert.rejects(missing.save(input), (error) => ['AI_SETTINGS_READ_FAILED', 'AI_SETTINGS_SAVE_FAILED'].includes(error.code));
    assert.equal(await readFile(path, 'utf8'), original);
    await store.save({ ...input, baseUrl: 'https://other.test/v1', apiKey: 'other-provider-key' });
    assert.equal(store.getConfig().baseUrl, 'https://other.test/v1');
  });
});

test('可用模型与官方余额使用服务端密钥，余额按货币返回且不调用生成接口', async () => {
  const urls = [];
  const upstream = async (url, options) => {
    urls.push(url);
    assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
    assert.equal(options.redirect, 'error');
    return json(url.endsWith('/models') ? { data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }] } : balance);
  };
  assert.deepEqual(await listAiModels(config, upstream), { models: ['model-a', 'model-b'] });
  const result = await getAiBalance(config, upstream);
  assert.deepEqual(result.balances, [{ currency: 'CNY', total: '12.34', granted: '2.00', toppedUp: '10.34' }]);
  assert.equal(result.available, true);
  assert.deepEqual(urls, ['https://api.deepseek.com/v1/models', 'https://api.deepseek.com/user/balance']);
});

test('不支持余额的服务不发送账户请求，密钥缺失、鉴权和无效数据明确失败且不重试', async () => {
  await assert.rejects(getAiBalance({ ...config, baseUrl: 'https://compatible.test/v1' }, () => assert.fail('不应请求')), (error) => error.code === 'AI_BALANCE_UNSUPPORTED');
  await assert.rejects(listAiModels({ ...config, apiKey: '' }, () => assert.fail('不应请求')), (error) => error.code === 'AI_NOT_CONFIGURED');
  for (const [query, response, code] of [
    [listAiModels, new Response(config.apiKey, { status: 401 }), 'AI_AUTH_FAILED'],
    [listAiModels, json({ data: {} }), 'INVALID_ACCOUNT_OUTPUT'],
    [getAiBalance, json({}), 'INVALID_ACCOUNT_OUTPUT'],
  ]) {
    let calls = 0;
    await assert.rejects(query(config, async () => { calls++; return response; }), (error) => error.code === code && !error.message.includes(config.apiKey));
    assert.equal(calls, 1);
  }
});

test('HTTP 本机保存配置后，通知生成立即使用新模型；跨站配置和账户查询被拒绝', async () => {
  await temporaryStore(async (store) => {
    let model;
    const api = createApiServer(config, async (_url, options) => {
      model = JSON.parse(options.body).model;
      return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ content: Object.values(generationRequest).filter((value) => typeof value === 'string').join('\n') }) } }] });
    }, store);
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    const base = `http://127.0.0.1:${api.address().port}`;
    const post = (path, value, origin = 'http://127.0.0.1:8001') => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(value) });
    try {
      assert.equal((await post('/api/ai/settings', input, 'https://evil.test')).status, 403);
      assert.equal((await post('/api/ai/balance', {}, 'https://evil.test')).status, 403);
      const foreignHostStatus = await new Promise((resolve, reject) => {
        const request = httpRequest(`${base}/api/ai/settings`, { headers: { Host: 'evil.test' } }, (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(foreignHostStatus, 403);
      const saved = await post('/api/ai/settings', input);
      assert.equal(saved.status, 200);
      assert.ok(!(await saved.text()).includes(config.apiKey));
      assert.equal((await post('/api/generate', generationRequest)).status, 200);
      assert.equal(model, 'new-generate');
      const status = await (await fetch(`${base}/api/ai/settings`)).json();
      assert.equal(status.model, 'new-default');
      assert.ok(!Object.hasOwn(status, 'apiKey'));
    } finally { api.closeAllConnections(); await new Promise((resolve) => api.close(resolve)); }
  });
});
