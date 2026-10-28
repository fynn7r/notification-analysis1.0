import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { openKnowledgeDb } from './knowledge/db.mjs';
import { createFirstAdmin, createInvite } from './knowledge/auth.mjs';
import { createEntry } from './knowledge/store.mjs';
import { createRemoteServer } from './remote.mjs';

const STATIC_DIR = resolve(import.meta.dirname ?? '.', '..', 'dist-standalone');

function hreq(server, method, path, { body, headers = {} } = {}) {
  const { port } = server.address();
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = httpRequest({
      host: '127.0.0.1', port, method, path,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON */ }
        resolvePromise({ status: res.statusCode, headers: res.headers, body: json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('远程入口：鉴权边界', () => {
  let store;
  let server;
  let tmp;
  let seenPrompt = '';
  let seenUserContent = '';

  const modelReply = {
    title: '校园歌手大赛报名',
    type: '比赛竞赛',
    actionTitle: '填写报名表',
    deadline: { date: '2026-10-22', time: '12:00', evidence: '10月22日12:00前' },
    eventTime: null,
    location: '大学生活动中心',
    targetAudience: '',
    requirements: '',
    contact: '',
    links: [],
    knowledge: {
      used: true,
      summary: '应用规则要求校级比赛获奖才可申报加分；个人资料说明本人已参加。',
      citations: [{ ref: 'K1', quote: '' }, { ref: 'K2', quote: '' }],
      conflicts: [],
    },
  };

  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seenPrompt = body.messages[0].content;
    seenUserContent = body.messages[1].content;
    return {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelReply) } }] }),
    };
  };

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'notizhi-remote-'));
    store = openKnowledgeDb({ dir: tmp });
    await createFirstAdmin(store.db, { username: 'root', displayName: '管理员', password: 'admin-password-123' });
    const admin = store.db.prepare('SELECT id FROM users WHERE username = ?').get('root');
    createEntry(store.db, {
      scope: 'application', title: '综合测评加分细则', category: '规则', body: '校级比赛获奖可申报综合素质加分。',
      createdBy: admin.id,
    });

    server = createRemoteServer({
      staticDir: STATIC_DIR,
      settingsStore: { getConfig: () => ({ apiKey: 'test-key', baseUrl: 'https://mock.local', model: 'mock', interpretationModel: '', generateModel: '', consoleUrl: '', timeoutMs: 5000 }) },
      knowledgeStore: store,
      fetchImpl: fakeFetch,
    });
    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  });

  after(() => {
    server.close();
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('提供构建后的前端入口', async () => {
    const res = await hreq(server, 'GET', '/standalone.html');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
  });

  it('未登录不能调用付费分析接口', async () => {
    const res = await hreq(server, 'POST', '/api/parse', {
      body: { text: '测试通知', referenceDate: '2026-10-20', timezone: 'Asia/Shanghai' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  });

  it('不暴露本机模型配置接口', async () => {
    const ai = await hreq(server, 'GET', '/api/ai/settings');
    assert.equal(ai.status, 404);
    const models = await hreq(server, 'POST', '/api/ai/models', { body: {} });
    assert.equal(models.status, 404);
  });

  it('拒绝路径穿越', async () => {
    const res = await hreq(server, 'GET', '/../.env.local');
    assert.ok(res.status === 404 || res.status === 400, `期望 404/400，实际 ${res.status}`);
    assert.ok(!res.text.includes('AI_API_KEY'));
  });

  it('登录后解析会同时带上个人库与应用库，并回传可核验引用', async () => {
    const invite = createInvite(store.db, { createdBy: 1 });
    const register = await hreq(server, 'POST', '/api/auth/register', {
      body: { code: invite.code, username: 'user1', displayName: '用户一', password: 'user-password-123' },
    });
    assert.equal(register.status, 201, register.text);
    const cookie = (register.headers['set-cookie'] ?? []).map((item) => item.split(';')[0]).join('; ');

    // 个人资料属于这个新用户自己；另一个账号的资料不应出现在这里。
    createEntry(store.db, {
      scope: 'personal', ownerId: register.body.user.id, title: '我的参赛记录', category: '个人',
      body: '本学期已参加校歌手大赛初赛。', createdBy: register.body.user.id,
    });

    const res = await hreq(server, 'POST', '/api/parse', {
      body: { text: '关于校园歌手比赛报名的通知：10月22日12:00前填写报名表，地点大学生活动中心。', referenceDate: '2026-10-20', timezone: 'Asia/Shanghai' },
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200, res.text);

    assert.match(seenUserContent, /综合测评加分细则/, '模型输入应包含应用库资料');
    assert.match(seenUserContent, /我的参赛记录/, '模型输入应包含个人库资料');
    assert.match(seenPrompt, /K1/, '提示词应说明知识片段编号规则');

    const knowledge = res.body.knowledge;
    assert.ok(knowledge, '响应必须带回知识分析');
    assert.equal(knowledge.used, true);
    assert.equal(knowledge.citations.length, 2);
    for (const citation of knowledge.citations) {
      assert.ok(citation.chunkId, '引用必须是服务端确认过的片段');
      assert.ok(['personal', 'application'].includes(citation.scope));
      assert.equal(typeof citation.version, 'number');
    }
    // 通知原文的截止时间不受知识影响
    assert.equal(res.body.notification.registrationDeadline, '2026-10-22T12:00:00+08:00');
  });

  it('伪造的知识引用不会被采纳', async () => {
    const original = modelReply.knowledge.citations;
    try {
      modelReply.knowledge.citations = [{ ref: 'K99', quote: '虚构内容' }];
      const login = await hreq(server, 'POST', '/api/auth/login', { body: { username: 'user1', password: 'user-password-123' } });
      const cookie = (login.headers['set-cookie'] ?? []).map((item) => item.split(';')[0]).join('; ');
      const res = await hreq(server, 'POST', '/api/parse', {
        body: { text: '关于校园歌手大赛的通知：10月22日12:00前填写报名表。', referenceDate: '2026-10-20', timezone: 'Asia/Shanghai' },
        headers: { Cookie: cookie },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.knowledge.used, false, '不存在的编号必须被判为未使用');
      assert.equal(res.body.knowledge.citations.length, 0);
    } finally {
      modelReply.knowledge.citations = original;
    }
  });
});
