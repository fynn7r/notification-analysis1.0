import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { openKnowledgeDb } from './knowledge/db.mjs';
import { createFirstAdmin, createInvite } from './knowledge/auth.mjs';
import { createEntry, listEntries } from './knowledge/store.mjs';
import { retrieveContext, validateCitations } from './knowledge/search.mjs';
import { createApiServer } from './index.mjs';

const BASE_CONFIG = {
  apiKey: 'test-key', baseUrl: 'https://mock.local', model: 'mock-model',
  interpretationModel: '', generateModel: '', consoleUrl: '', timeoutMs: 5000,
};

function hreq(server, method, path, { body, headers = {} } = {}) {
  const { port } = server.address();
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = httpRequest({
      host: '127.0.0.1', port, method, path,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
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

function listen(server) {
  return new Promise((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise(server)));
}

function makeClient(server) {
  const jar = new Map();
  let csrf = '';
  const capture = (res) => {
    const setCookie = res.headers['set-cookie'];
    if (!setCookie) return;
    for (const item of setCookie) {
      const pair = item.split(';')[0];
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
  };
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  return {
    getCsrf: () => csrf,
    getCookie: () => cookieHeader(),
    async call(method, path, body) {
      const current = cookieHeader();
      const res = await hreq(server, method, path, {
        body,
        headers: { ...(current ? { Cookie: current } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      });
      capture(res);
      if (res.body?.csrfToken) csrf = res.body.csrfToken;
      return res;
    },
    async logout() { jar.clear(); csrf = ''; },
  };
}

describe('双知识库：账号、隔离与检索', () => {
  let store;
  let server;
  let tmp;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'notizhi-kb-'));
    store = openKnowledgeDb({ dir: tmp });
    server = createApiServer(BASE_CONFIG, fetch, null, store);
    await listen(server);
    await createFirstAdmin(store.db, { username: 'root', displayName: '管理员', password: 'admin-password-123' });
  });

  after(() => {
    server.close();
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('邀请码只能消费一次', async () => {
    const admin = { id: 1 };
    const invite = createInvite(store.db, { createdBy: admin.id });
    const client = makeClient(server);
    const first = await client.call('POST', '/api/auth/register', {
      code: invite.code, username: 'alice', displayName: 'A', password: 'alice-password-123',
    });
    assert.equal(first.status, 201, first.text);

    const second = makeClient(server);
    const again = await second.call('POST', '/api/auth/register', {
      code: invite.code, username: 'alice2', displayName: 'A2', password: 'alice2-password-123',
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'INVITE_USED');
  });

  it('登录后可读会话，退出后会话立即失效', async () => {
    const client = makeClient(server);
    const login = await client.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-password-123' });
    assert.equal(login.status, 200);
    const cookieBeforeLogout = client.getCookie();
    assert.ok(cookieBeforeLogout, '应下发会话 cookie');

    const session = await client.call('GET', '/api/auth/session');
    assert.equal(session.body.authenticated, true);

    const out = await client.call('POST', '/api/auth/logout', {});
    assert.equal(out.status, 200);

    const replay = await hreq(server, 'GET', '/api/auth/session', { headers: { Cookie: cookieBeforeLogout } });
    assert.equal(replay.body.authenticated, false, '退出后旧 cookie 不能继续使用');
  });

  it('错误密码与不存在账号返回同一结果', async () => {
    const client = makeClient(server);
    const wrong = await client.call('POST', '/api/auth/login', { username: 'alice', password: 'wrong-password-000' });
    const missing = await client.call('POST', '/api/auth/login', { username: 'nobody', password: 'wrong-password-000' });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.body.error.code, missing.body.error.code);
  });

  it('未登录不能读写任何个人资料', async () => {
    const client = makeClient(server);
    const res = await client.call('GET', '/api/knowledge/entries?scope=personal');
    assert.equal(res.status, 401);
  });

  it('A 的个人资料 B 读不到、改不了，列表也不出现', async () => {
    const alice = makeClient(server);
    await alice.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-password-123' });
    const created = await alice.call('POST', '/api/knowledge/entries', {
      scope: 'personal', title: 'A 的竞赛加分细则', category: '竞赛', body: 'A 同学获得校级一等奖可加 2 分。',
    });
    assert.equal(created.status, 201, created.text);
    const entryId = created.body.entry.id;

    const invite = createInvite(store.db, { createdBy: 1 });
    const bob = makeClient(server);
    await bob.call('POST', '/api/auth/register', {
      code: invite.code, username: 'bob', displayName: 'B', password: 'bob-password-12345',
    });

    const bobList = await bob.call('GET', '/api/knowledge/entries?scope=personal');
    assert.equal(bobList.body.entries.length, 0);

    const read = await bob.call('GET', `/api/knowledge/entries/${entryId}`);
    assert.equal(read.status, 404, '越权读取应表现为不存在');

    const patch = await bob.call('PATCH', `/api/knowledge/entries/${entryId}`, { title: '篡改' });
    assert.equal(patch.status, 404);

    const del = await bob.call('DELETE', `/api/knowledge/entries/${entryId}`);
    assert.equal(del.status, 404);

    const stillThere = await alice.call('GET', `/api/knowledge/entries/${entryId}`);
    assert.equal(stillThere.status, 200);
    assert.equal(stillThere.body.entry.title, 'A 的竞赛加分细则');
  });

  it('普通用户不能写应用知识库，管理员可以；双方都能读', async () => {
    const admin = makeClient(server);
    await admin.call('POST', '/api/auth/login', { username: 'root', password: 'admin-password-123' });
    const shared = await admin.call('POST', '/api/knowledge/entries', {
      scope: 'application', title: '全校通用加分规则', category: '规则', body: '参加校级比赛并获得名次，可申报综合素质加分。',
    });
    assert.equal(shared.status, 201, shared.text);

    const alice = makeClient(server);
    await alice.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-password-123' });
    const forged = await alice.call('POST', '/api/knowledge/entries', {
      scope: 'application', title: '伪造共享条目', body: '伪造内容',
    });
    assert.equal(forged.status, 403);
    assert.equal(forged.body.error.code, 'FORBIDDEN');

    const patchShared = await alice.call('PATCH', `/api/knowledge/entries/${shared.body.entry.id}`, { title: '改掉' });
    assert.equal(patchShared.status, 403);

    const list = await alice.call('GET', '/api/knowledge/entries?scope=application');
    assert.equal(list.body.entries.length, 1);
    assert.equal(list.body.canWrite, false);
  });

  it('缺少 CSRF 令牌的写请求被拒绝', async () => {
    const client = makeClient(server);
    await client.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-password-123' });
    const res = await hreq(server, 'POST', '/api/knowledge/entries', {
      body: { scope: 'personal', title: 'x', body: '内容' },
      headers: { Cookie: client.getCookie(), 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'INVALID_CSRF');
  });

  it('检索先按账号过滤：A 的结果里没有 B 的条目', async () => {
    const invite = createInvite(store.db, { createdBy: 1 });
    const bob = makeClient(server);
    await bob.call('POST', '/api/auth/register', {
      code: invite.code, username: 'bob2', displayName: 'B2', password: 'bob2-password-12345',
    });
    await bob.call('POST', '/api/knowledge/entries', {
      scope: 'personal', title: 'B 的独家条件', body: '只有 B 知道：需要先提交纸质材料到学院办公室。',
    });

    const aliceUser = store.db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
    const result = retrieveContext(store, { userId: aliceUser.id, query: '纸质材料 学院办公室' });
    assert.ok(result.ok);
    const titles = result.segments.map((segment) => segment.title);
    assert.ok(!titles.some((title) => title.includes('B 的独家条件')), '不能检索到其他用户的资料');
  });

  it('应用知识库参与同一账号的检索', async () => {
    const aliceUser = store.db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
    const result = retrieveContext(store, { userId: aliceUser.id, query: '综合素质加分 校级比赛' });
    const scopes = new Set(result.segments.map((segment) => segment.scope));
    assert.ok(scopes.has('application'), '应检索到应用知识库');
  });

  it('长文档末尾的条款能被检索到，而不是只截取开头', async () => {
    const aliceUser = store.db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
    const filler = Array.from({ length: 320 }, (_, i) => `第 ${i + 1} 条：普通条款内容，与本次检索无关。`).join('\n\n');
    const body = `${filler}\n\n第九十九条：参加省级以上比赛并获得前三名，可申请专项奖学金。`;
    assert.ok(body.length > 6000);

    const entry = createEntry(store.db, {
      scope: 'personal', ownerId: aliceUser.id, title: '长文档规则汇编', body, createdBy: aliceUser.id,
    });
    assert.ok(entry.version === 1);

    const result = retrieveContext(store, { userId: aliceUser.id, query: '省级以上比赛 前三名 专项奖学金' });
    const hit = result.segments.find((segment) => segment.entryId === entry.id);
    assert.ok(hit, '应检索到长文档中的相关片段');
    assert.ok(hit.text.includes('专项奖学金'), '命中的是末尾条款而不是开头');
  });

  it('引用校验：不存在的编号、对不上的引文被拒绝', () => {
    const aliceUser = store.db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
    const result = retrieveContext(store, { userId: aliceUser.id, query: '加分' });
    assert.ok(result.segments.length > 0);
    const target = result.segments[0];

    const ok = validateCitations([{ chunkId: target.chunkId, quote: target.text.slice(0, 10) }], result.segments);
    assert.equal(ok.accepted.length, 1);

    const fake = validateCitations([{ chunkId: 'not-a-real-chunk', quote: '任意' }], result.segments);
    assert.equal(fake.accepted.length, 0);
    assert.equal(fake.rejected[0].reason, 'NOT_AUTHORIZED');

    const mismatched = validateCitations([{ chunkId: target.chunkId, quote: '这段文字不在片段里' }], result.segments);
    assert.equal(mismatched.accepted.length, 0);
    assert.equal(mismatched.rejected[0].reason, 'QUOTE_NOT_FOUND');
  });

  it('空知识库与检索失败要能区分', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'notizhi-kb-empty-'));
    const emptyStore = openKnowledgeDb({ dir: emptyDir });
    try {
      const user = { id: 99 };
      const empty = retrieveContext(emptyStore, { userId: user.id, query: '任意内容' });
      assert.equal(empty.empty, true);
      assert.equal(empty.ok, true);
      assert.match(empty.note, /还没有资料/);
    } finally {
      emptyStore.close();
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('旧规则导入幂等：同一账号重复提交不重复建条目', async () => {
    const client = makeClient(server);
    await client.call('POST', '/api/auth/login', { username: 'alice', password: 'alice-password-123' });
    const payload = { items: [{ legacyKey: 'rule-1', title: '旧规则', body: '旧规则正文内容。' }] };
    const first = await client.call('POST', '/api/knowledge/import-legacy', payload);
    assert.equal(first.status, 200);
    const second = await client.call('POST', '/api/knowledge/import-legacy', payload);
    assert.equal(second.status, 200);
    assert.equal(second.body.imported[0].reused, true);
    assert.equal(first.body.imported[0].entryId, second.body.imported[0].entryId);

    const aliceUser = store.db.prepare('SELECT id FROM users WHERE username = ?').get('alice');
    const entries = listEntries(store.db, { scope: 'personal', ownerId: aliceUser.id });
    assert.equal(entries.filter((entry) => entry.sourceKind === 'legacy').length, 1);
  });
});
