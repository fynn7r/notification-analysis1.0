import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { openKnowledgeDb } from './knowledge/db.mjs';
import { createFirstAdmin, createInvite } from './knowledge/auth.mjs';
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
    /** 故意不带 CSRF，用来验证写接口确实校验了它。 */
    async callWithoutCsrf(method, path, body) {
      const current = cookieHeader();
      return hreq(server, method, path, { body, headers: current ? { Cookie: current } : {} });
    },
  };
}

function reminder(overrides = {}) {
  return {
    id: 'r-1',
    title: '交纸质材料',
    type: '作业任务',
    importance: 'high',
    deadline: '2026-11-10T17:00:00+08:00',
    remindAt: '2026-11-09T17:00:00+08:00',
    remindLeadMinutes: 1440,
    remindOffset: '截止前1天',
    completed: false,
    source: 'notification',
    createdAt: 1761000000000,
    ...overrides,
  };
}

describe('待办接口', () => {
  let store;
  let server;
  let tmp;
  let admin;
  let other;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'notizhi-reminders-http-'));
    store = openKnowledgeDb({ dir: tmp });
    server = createApiServer(BASE_CONFIG, fetch, null, store);
    await listen(server);
    await createFirstAdmin(store.db, { username: 'root', displayName: '管理员', password: 'admin-password-123' });
    admin = makeClient(server);
    await admin.call('POST', '/api/auth/login', { username: 'root', password: 'admin-password-123' });

    const invite = createInvite(store.db, { createdBy: 1 });
    other = makeClient(server);
    await other.call('POST', '/api/auth/register', {
      code: invite.code, username: 'bob', displayName: 'B', password: 'bob-password-123',
    });
  });

  after(() => {
    server.close();
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('未登录一律 401', async () => {
    const anonymous = makeClient(server);
    assert.equal((await anonymous.call('GET', '/api/reminders')).status, 401);
    assert.equal((await anonymous.call('POST', '/api/reminders', reminder())).status, 401);
    assert.equal((await anonymous.call('GET', '/api/reminders/export.ics')).status, 401);
  });

  it('写接口必须带 CSRF', async () => {
    const res = await admin.callWithoutCsrf('POST', '/api/reminders', reminder({ id: 'csrf-test' }));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'INVALID_CSRF');
  });

  it('创建后能在列表里读到', async () => {
    const created = await admin.call('POST', '/api/reminders', reminder());
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.reminder.id, 'r-1');
    const list = await admin.call('GET', '/api/reminders');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.reminders.map((item) => item.id), ['r-1']);
  });

  it('同 id 重复提交不产生第二条', async () => {
    await admin.call('POST', '/api/reminders', reminder({ title: '改过的标题' }));
    const list = await admin.call('GET', '/api/reminders?status=all');
    assert.equal(list.body.reminders.length, 1);
    assert.equal(list.body.reminders[0].title, '改过的标题');
  });

  it('PATCH 能标记完成，DELETE 后从列表消失', async () => {
    const patched = await admin.call('PATCH', '/api/reminders/r-1', { completed: true });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.reminder.completed, true);
    assert.equal((await admin.call('GET', '/api/reminders')).body.reminders.length, 0);

    const removed = await admin.call('DELETE', '/api/reminders/r-1');
    assert.equal(removed.status, 200);
    assert.equal((await admin.call('GET', '/api/reminders?status=all')).body.reminders.length, 0);
  });

  it('别人的待办既看不到也改不了', async () => {
    await admin.call('POST', '/api/reminders', reminder({ id: 'admin-only' }));
    const list = await other.call('GET', '/api/reminders?status=all');
    assert.equal(list.body.reminders.length, 0);
    const patched = await other.call('PATCH', '/api/reminders/admin-only', { completed: true });
    assert.equal(patched.status, 404);
    const removed = await other.call('DELETE', '/api/reminders/admin-only');
    assert.equal(removed.status, 404);
  });

  it('导入跳过示例数据与重复项', async () => {
    const res = await other.call('POST', '/api/reminders/import-local', {
      reminders: [
        reminder({ id: 'mock-reminder-001', title: '数学建模竞赛报名截止' }),
        reminder({ id: 'import-1' }),
        reminder({ id: 'import-2' }),
      ],
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.imported, 2);
    assert.equal(res.body.skippedMock, 1);

    const again = await other.call('POST', '/api/reminders/import-local', {
      reminders: [reminder({ id: 'import-1' })],
    });
    assert.equal(again.body.imported, 0);
    assert.equal(again.body.skippedDuplicate, 1);

    const list = await other.call('GET', '/api/reminders?status=all');
    assert.equal(list.body.reminders.length, 2);
  });

  it('导出的 ics 是标准日历且带 UTC 时间', async () => {
    const res = await admin.call('GET', '/api/reminders/export.ics');
    assert.equal(res.status, 200, res.text);
    assert.match(res.headers['content-type'], /text\/calendar/);
    assert.match(res.headers['content-disposition'], /attachment; filename="notizhi-reminders\.ics"/);
    assert.ok(res.text.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(res.text.includes('BEGIN:VEVENT'));
    assert.ok(res.text.includes('DTSTART:20261110T090000Z'));
    assert.ok(res.text.includes('TRIGGER:-P1D'));
    assert.equal(/[\r\n]/.test(res.text.replace(/\r\n/g, '')), false);
  });

  it('导出的 csv 带 BOM，Excel 打开不乱码', async () => {
    const res = await admin.call('GET', '/api/reminders/export.csv');
    assert.equal(res.status, 200, res.text);
    assert.ok(res.text.startsWith('\uFEFF'), '应当以 BOM 开头');
    assert.match(res.text, /标题,类型,重要度/);
  });

  it('没有日期可写时不返回空文件，而是说明原因', async () => {
    await other.call('DELETE', '/api/reminders/import-1');
    await other.call('DELETE', '/api/reminders/import-2');
    await other.call('POST', '/api/reminders', reminder({ id: 'no-time', title: '没有时间的待办', deadline: '', remindAt: '' }));
    const res = await other.call('GET', '/api/reminders/export.ics');
    assert.equal(res.status, 200);
    assert.equal(res.body.error.code, 'NOTHING_TO_EXPORT');
    assert.deepEqual(res.body.skipped, ['没有时间的待办']);
  });
});
