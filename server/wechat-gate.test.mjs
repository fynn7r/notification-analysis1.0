// TASK-001 M0 r3 测试
// 覆盖：旧库迁移、持久游标+hasMore、单消费者、状态机恢复、OpenKfId校验、正常退出

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import http from 'node:http';
import { resolve } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, createCipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createWechatGate } from './wechat-gate.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

const TEST_CONFIG = {
  corpId: 'ww_test123', secret: 'test_secret', token: 'tok_abc123',
  encodingAESKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  openKfId: 'kf_test12345', publicUrl: '',
  allowedSenderIds: ['s001'],
};

// ── 工具 ──────────────────────────────────────────

function encMsg(corpId, key, text) {
  const rnd = Array.from({ length: 16 }, () => String.fromCharCode(Math.floor(Math.random() * 256))).join('');
  const mb = Buffer.from(text, 'utf8');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(mb.length, 0);
  const raw = Buffer.concat([Buffer.from(rnd, 'latin1'), lb, mb, Buffer.from(corpId, 'utf8')]);
  const bs = 32; const pl = bs - (raw.length % bs);
  const pad = Buffer.concat([raw, Buffer.alloc(pl, pl)]);
  const k = Buffer.from(key + '=', 'base64');
  const c = createCipheriv('aes-256-cbc', k, k.subarray(0, 16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(pad), c.final()]).toString('base64');
}

function msig(token, ts, nonce, encrypt) {
  return createHash('sha1').update([token, ts, nonce, encrypt].sort().join(''), 'utf8').digest('hex');
}

function hreq(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, 'http://127.0.0.1');
    const opts = { method, hostname: '127.0.0.1', port: server.address().port,
      path: u.pathname + u.search, headers: body ? { 'Content-Type': 'text/xml' } : {} };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeSrv(config, storePath, fetchImpl) {
  return new Promise((resolve) => {
    const s = createWechatGate(config, { storePath, fetchImpl });
    s.listen(() => resolve(s));
  });
}

function closeSrv(s) { return new Promise(r => { if (s._close) s._close(); else s.close(); r(); }); }

function mFetch(resps) {
  let i = 0;
  return async (url) => {
    const u = typeof url === 'string' ? url : '';
    if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
    if (u.includes('sync_msg')) {
      const r = resps[i] || { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 };
      i++;
      return Response.json(r);
    }
    if (u.includes('media/get')) return new Response(Buffer.from('fake_media'), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' } });
    if (u.includes('send_msg')) return Response.json({ errcode: 0, errmsg: 'ok' });
    return Response.json({}, { status: 404 });
  };
}

// ── 等待消费者完成的辅助 ──────────────────────────

async function waitForConsumer(db, maxWait) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM pending_tasks WHERE status IN ('pending','processing')").get();
    if (row.cnt === 0) return;
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── 测试 ──────────────────────────────────────────

describe('r3', () => {
  describe('基础页面', () => {
    let s;
    before(async () => { s = await makeSrv(TEST_CONFIG, resolve(ROOT, '.local', 'gt-r3-base'), mFetch([])); });
    after(() => closeSrv(s));
    it('GET / html', async () => { const r = await hreq(s, 'GET', '/'); assert.ok(r.body.includes('r3')); });
    it('GET /health', async () => { assert.equal(JSON.parse((await hreq(s, 'GET', '/health')).body).revision, 'r3'); });
    it('404', async () => { assert.equal((await hreq(s, 'GET', '/x')).status, 404); });
  });

  describe('GET 签名', () => {
    let s;
    before(async () => { s = await makeSrv(TEST_CONFIG, resolve(ROOT, '.local', 'gt-r3-get'), mFetch([])); });
    after(() => closeSrv(s));
    it('正确签名+解密→200', async () => {
      const ts = String(Date.now() / 1000 | 0), n = 'n1';
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, 'hello');
      const r = await hreq(s, 'GET', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, ts, n, e)}&timestamp=${ts}&nonce=${n}&echostr=${encodeURIComponent(e)}`);
      assert.equal(r.status, 200); assert.equal(r.body, 'hello');
    });
    it('错误签名→403', async () => {
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, 'x');
      assert.equal((await hreq(s, 'GET', `/wechat/callback?msg_signature=bad&timestamp=1&nonce=2&echostr=${encodeURIComponent(e)}`)).status, 403);
    });
    it('错企业 ID → 403', async () => {
      const ts = String(Date.now() / 1000 | 0), n = 'n2';
      const e = encMsg('ww_wrong_corp', TEST_CONFIG.encodingAESKey, 'hello');
      const sig = msig(TEST_CONFIG.token, ts, n, e);
      const r = await hreq(s, 'GET', `/wechat/callback?msg_signature=${sig}&timestamp=${ts}&nonce=${n}&echostr=${encodeURIComponent(e)}`);
      assert.equal(r.status, 403);
    });
  });

  describe('POST 完整链路', () => {
    let s, sp, db;
    before(async () => {
      sp = resolve(ROOT, '.local', 'gt-r3-post');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}
      s = await makeSrv(TEST_CONFIG, sp, mFetch([{
        errcode: 0, msg_list: [{ msgid: 'm1', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: '3', text: { content: 'hi' } }],
        next_cursor: 'c1', has_more: 0,
      }]));
      db = s._db;
    });
    after(() => closeSrv(s));
    it('入队→拉取→保存→回复', async () => {
      const ts = '1';
      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      const r = await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, ts, 'n', e)}&timestamp=${ts}&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);
      assert.equal(r.status, 200);

      await waitForConsumer(db, 5000);

      const dd = db.prepare("SELECT * FROM dedup WHERE msg_id = 'm1'").get();
      assert.ok(dd, '应有 dedup 记录');
      assert.equal(dd.saved, 1, `saved=${dd.saved}`);
      assert.equal(dd.replied, 1, `replied=${dd.replied}, reply_error=${dd.reply_error}`);

      const ev = db.prepare("SELECT * FROM events WHERE msg_id = 'm1'").get();
      assert.ok(ev); assert.equal(ev.is_authorized, 1);

      const cur = db.prepare("SELECT next_cursor FROM msg_cursors WHERE cursor_id = ?").get(TEST_CONFIG.openKfId);
      assert.ok(cur, '游标应存在');
      assert.equal(cur.next_cursor, 'c1');
    });
    it('过大请求体 → 413', async () => {
      const big = 'x'.repeat(600 * 1024);
      const r = await hreq(s, 'POST', '/wechat/callback?msg_signature=s&timestamp=1&nonce=2', big);
      assert.equal(r.status, 413);
    });
  });

  describe('OpenKfId 校验', () => {
    let s, sp;
    before(async () => {
      sp = resolve(ROOT, '.local', 'gt-r3-kfid');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}
      s = await makeSrv(TEST_CONFIG, sp, mFetch([]));
    });
    after(() => closeSrv(s));
    it('其他客服账号→200但不入队', async () => {
      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et2]]></Token><OpenKfId><![CDATA[kf_other]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      const r = await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);
      assert.equal(r.status, 200);
      assert.equal(s._db.prepare("SELECT COUNT(*) AS c FROM pending_tasks").get().c, 0, '不应入队');
    });
  });

  describe('单消费者保护', () => {
    let s, sp, db;
    before(async () => {
      sp = resolve(ROOT, '.local', 'gt-r3-lock');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}
      s = await makeSrv(TEST_CONFIG, sp, mFetch([{
        errcode: 0, msg_list: [{ msgid: 'ma', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'a' } }],
        next_cursor: '', has_more: 0,
      }]));
      db = s._db;
    });
    after(() => closeSrv(s));
    it('回调入队→消费者处理完成', async () => {
      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);

      await waitForConsumer(db, 5000);

      const cnt = db.prepare("SELECT COUNT(*) AS c FROM pending_tasks WHERE status = 'completed'").get().c;
      assert.equal(cnt, 1, '应有 1 个完成的任务');

      const dd = db.prepare("SELECT * FROM dedup WHERE msg_id = 'ma'").get();
      assert.ok(dd); assert.equal(dd.replied, 1);
    });
  });

  describe('旧库迁移', () => {
    it('r1 旧库可升级，旧记录保留，新消息可入库', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r3-mig');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}
      mkdirSync(sp, { recursive: true });
      mkdirSync(resolve(sp, 'media'), { recursive: true });

      // 模拟真实 r1 数据库结构
      const oldDb = new DatabaseSync(resolve(sp, 'state.db'));
      // events: r1 原列（无 is_authorized）
      oldDb.exec("CREATE TABLE events (id TEXT PRIMARY KEY, msg_id TEXT, event_type TEXT, sender_id TEXT, msg_type TEXT, media_id TEXT, file_name TEXT, raw_body TEXT, status TEXT DEFAULT 'received', created_at TEXT DEFAULT (datetime('now')))");
      // pending_tasks: 真实 r1 结构 = event_id/task_type 两个 NOT NULL 列，无 event_type
      oldDb.exec("CREATE TABLE pending_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, task_type TEXT NOT NULL, payload TEXT, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, last_error TEXT, created_at TEXT DEFAULT (datetime('now')))");
      // dedup: r1 原列（无 media_status/media_error）
      oldDb.exec("CREATE TABLE dedup (msg_id TEXT PRIMARY KEY, saved INTEGER DEFAULT 0, replied INTEGER DEFAULT 0, reply_error TEXT, media_path TEXT, created_at TEXT DEFAULT (datetime('now')))");
      oldDb.exec("CREATE TABLE msg_cursors (cursor_id TEXT PRIMARY KEY, next_cursor TEXT, updated_at TEXT DEFAULT (datetime('now')))");
      oldDb.exec("CREATE TABLE raw_events (id TEXT PRIMARY KEY, sender_id TEXT, event_type TEXT, raw_xml TEXT, created_at TEXT DEFAULT (datetime('now')))");
      // 旧数据：一条 dedup 记录 + 一条 pending_tasks 记录（用 task_type）
      oldDb.exec("INSERT INTO dedup (msg_id, saved, replied) VALUES ('old_m', 1, 0)");
      oldDb.exec("INSERT INTO pending_tasks (event_id, task_type, payload, status) VALUES ('evt_old', 'kf_msg_or_event', '{}', 'pending')");
      oldDb.close();

      // 用升级后的 initDb 加载
      const s = await makeSrv(TEST_CONFIG, sp, mFetch([{
        errcode: 0, msg_list: [{ msgid: 'new_m', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'hi' } }],
        next_cursor: '', has_more: 0,
      }]));

      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);

      const db = s._db;
      await waitForConsumer(db, 5000);

      // 旧记录保留
      const old = db.prepare("SELECT * FROM dedup WHERE msg_id = 'old_m'").get();
      assert.ok(old, '旧记录应保留');
      assert.equal(old.saved, 1);
      // 新记录入库
      const nw = db.prepare("SELECT * FROM events WHERE msg_id = 'new_m'").get();
      assert.ok(nw, '新记录应入库');
      // 新列存在（迁移成功）
      const cols = db.prepare("PRAGMA table_info(events)").all().map(r => r.name);
      assert.ok(cols.includes('is_authorized'), 'events 应有 is_authorized 列');

      await closeSrv(s);
    });
  });

  describe('配置缺失', () => {
    it('无 token', async () => {
      const s = await makeSrv({ ...TEST_CONFIG, token: '', encodingAESKey: '' }, resolve(ROOT, '.local', 'gt-r3-nocfg'), mFetch([]));
      assert.equal(JSON.parse((await hreq(s, 'GET', '/health')).body).configured, false);
      await closeSrv(s);
    });
  });

  // ── r4 新增：记录式 mock + 恢复/上限/失败/媒体错误 ──

  function recordFetch({ syncPages, mediaError }) {
    let syncIdx = 0;
    const calls = { sendMsgBodies: [], mediaCount: 0, syncCount: 0 };
    const fn = async (url, opts) => {
      const u = typeof url === 'string' ? url : '';
      if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      if (u.includes('sync_msg')) {
        calls.syncCount++;
        const r = syncPages[syncIdx] || { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 };
        syncIdx++;
        return Response.json(r);
      }
      if (u.includes('media/get')) {
        calls.mediaCount++;
        if (mediaError) return Response.json({ errcode: 40001, errmsg: 'media not found' }, { status: 200 });
        return new Response(Buffer.from('fake_media'), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' } });
      }
      if (u.includes('send_msg')) {
        try { calls.sendMsgBodies.push(JSON.parse(opts?.body || '{}')); } catch { /* ignore */ }
        return Response.json({ errcode: 0, errmsg: 'ok' });
      }
      return Response.json({}, { status: 404 });
    };
    fn.calls = calls;
    return fn;
  }

  // 可控媒体下载：media/get 挂起直到 releaseMedia，用于模拟"媒体处理中新回调入队"
  function gatedMediaFetch({ syncPages }) {
    let syncIdx = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    const calls = { syncCount: 0, mediaCount: 0, mediaStarted: false, sendMsgCount: 0 };
    const fn = async (url) => {
      const u = typeof url === 'string' ? url : '';
      if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      if (u.includes('sync_msg')) {
        calls.syncCount++;
        const r = syncPages[syncIdx] || { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 };
        syncIdx++;
        return Response.json(r);
      }
      if (u.includes('media/get')) {
        calls.mediaCount++;
        calls.mediaStarted = true;
        await gate; // 挂起直到 releaseMedia
        return new Response(Buffer.from('fake_media'), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' } });
      }
      if (u.includes('send_msg')) { calls.sendMsgCount++; return Response.json({ errcode: 0, errmsg: 'ok' }); }
      return Response.json({}, { status: 404 });
    };
    fn.calls = calls;
    fn.releaseMedia = () => release();
    return fn;
  }

  // 回执故障注入：send_msg 按 sendResults 序列返回（ok/reject/err）
  function replyFaultFetch({ syncPages, sendResults }) {
    let syncIdx = 0;
    let sendIdx = 0;
    const calls = { syncCount: 0, sendCount: 0 };
    const fn = async (url) => {
      const u = typeof url === 'string' ? url : '';
      if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      if (u.includes('sync_msg')) {
        calls.syncCount++;
        const r = syncPages[syncIdx] || { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 };
        syncIdx++;
        return Response.json(r);
      }
      if (u.includes('media/get')) return new Response(Buffer.from('fake_media'), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' } });
      if (u.includes('send_msg')) {
        calls.sendCount++;
        const mode = sendResults[Math.min(sendIdx++, sendResults.length - 1)] || 'ok';
        if (mode === 'reject') throw new Error('connection reset'); // 连接中断，结果不确定
        if (mode === 'err') return Response.json({ errcode: 40001, errmsg: 'invalid' });
        return Response.json({ errcode: 0, errmsg: 'ok' });
      }
      return Response.json({}, { status: 404 });
    };
    fn.calls = calls;
    return fn;
  }

  // 媒体失败序列：media/get 按 mediaResults 序列返回（fail/ok）
  function mediaSeqFetch({ syncPages, mediaResults }) {
    let syncIdx = 0;
    let mediaIdx = 0;
    const calls = { syncCount: 0, mediaCount: 0 };
    const fn = async (url) => {
      const u = typeof url === 'string' ? url : '';
      if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      if (u.includes('sync_msg')) {
        calls.syncCount++;
        const r = syncPages[syncIdx] || { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 };
        syncIdx++;
        return Response.json(r);
      }
      if (u.includes('media/get')) {
        calls.mediaCount++;
        const mode = mediaResults[Math.min(mediaIdx++, mediaResults.length - 1)] || 'ok';
        if (mode === 'fail') return Response.json({ errcode: 40001, errmsg: 'media not found' }, { status: 200 });
        return new Response(Buffer.from('fake_media'), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' } });
      }
      if (u.includes('send_msg')) return Response.json({ errcode: 0, errmsg: 'ok' });
      return Response.json({}, { status: 404 });
    };
    fn.calls = calls;
    return fn;
  }

  describe('r4 恢复：已保存未完成，重启后补媒体+回执', () => {
    it('资料已存、游标已前移、上游不再返回，重启仍恢复下载+回执', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r4-resume');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      // 第一段：创建服务，手动构造"已保存但媒体/回执未完成"的状态
      const s1 = await makeSrv(TEST_CONFIG, sp, mFetch([]));
      const db1 = s1._db;
      // 模拟已入库未完成的授权文件消息
      const payload = { msgId: 'resume_m', senderId: 's001', msgType: 'file', mediaId: 'media_x', fileName: 'a.pdf', content: '', linkUrl: '' };
      db1.prepare("INSERT INTO dedup (msg_id, saved, replied, media_status) VALUES ('resume_m', 1, 0, '')").run();
      db1.prepare("INSERT INTO events (id, msg_id, event_type, sender_id, msg_type, media_id, file_name, raw_body, is_authorized) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), 'resume_m', 'message', 's001', 'file', 'media_x', 'a.pdf', JSON.stringify(payload), 1);
      // 游标已前移（模拟旧消息已不在上游）
      db1.prepare("INSERT OR REPLACE INTO msg_cursors (cursor_id, next_cursor) VALUES (?, 'done_cursor')").run(TEST_CONFIG.openKfId);
      await closeSrv(s1);

      // 第二段：重启同一 storePath，上游不再返回 resume_m
      const rec = recordFetch({ syncPages: [{ errcode: 0, msg_list: [], next_cursor: '', has_more: 0 }] });
      const s2 = await makeSrv(TEST_CONFIG, sp, rec);

      // 等待恢复完成：轮询 media_status 变化
      const start = Date.now();
      let dd;
      while (Date.now() - start < 8000) {
        dd = s2._db.prepare("SELECT * FROM dedup WHERE msg_id = 'resume_m'").get();
        if (dd && dd.media_status === 'ok' && dd.replied === 1) break;
        await new Promise(r => setTimeout(r, 200));
      }

      assert.ok(dd, '恢复消息应在 dedup');
      assert.equal(dd.media_status, 'ok', `media_status=${dd.media_status}`);
      assert.ok(dd.media_path, '应下载媒体');
      assert.equal(dd.replied, 1, `replied=${dd.replied}, reply_error=${dd.reply_error}`);
      assert.ok(rec.calls.mediaCount >= 1, `应调用 media/get，实际 ${rec.calls.mediaCount}`);

      await closeSrv(s2);
    });
  });

  describe('r4 20页上限不丢消息', () => {
    it('连续 21 页，前 20 页触发上限，续跑自动拉第 21 页，全部入库', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r4-pagelimit');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      // 构造 21 页：前 20 页 has_more=1（触发上限），第 21 页 has_more=0
      const syncPages = [];
      for (let i = 1; i <= 21; i++) {
        syncPages.push({
          errcode: 0,
          msg_list: [{ msgid: `pmsg_${i}`, external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: `msg ${i}` } }],
          next_cursor: `cursor_${i}`, has_more: i < 21 ? 1 : 0,
        });
      }

      const s = await makeSrv(TEST_CONFIG, sp, recordFetch({ syncPages }));

      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);

      // 轮询等待 21 条消息全部入库 + 任务最终 completed（续跑自动拉第 21 页）
      const db = s._db;
      const start = Date.now();
      let cnt = 0;
      let taskStatus = '';
      while (Date.now() - start < 10000) {
        cnt = db.prepare("SELECT COUNT(*) as c FROM events WHERE msg_id LIKE 'pmsg_%'").get().c;
        const task = db.prepare("SELECT status FROM pending_tasks ORDER BY id DESC LIMIT 1").get();
        taskStatus = task ? task.status : '';
        if (cnt === 21 && taskStatus === 'completed') break;
        await new Promise(r => setTimeout(r, 200));
      }

      // 21 条消息都入库（含续跑拉取的第 21 页）
      assert.equal(cnt, 21, `应保存 21 条消息，实际 ${cnt}`);
      // 游标推进到第 21 页
      const cur = db.prepare("SELECT next_cursor FROM msg_cursors WHERE cursor_id = ?").get(TEST_CONFIG.openKfId);
      assert.equal(cur.next_cursor, 'cursor_21', `游标应为 cursor_21，实际 ${cur?.next_cursor}`);
      // 续跑完成后任务标 completed
      assert.equal(taskStatus, 'completed', `任务应续跑完成后 completed，实际 ${taskStatus}`);

      await closeSrv(s);
    });
  });

  describe('r4 拉取失败不标完成', () => {
    it('第二页读取失败，第一页已保存，任务标 failed', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r4-pullfail');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const s = await makeSrv(TEST_CONFIG, sp, recordFetch({ syncPages: [
        { errcode: 0, msg_list: [{ msgid: 'ok_m', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'first' } }], next_cursor: 'c1', has_more: 1 },
        { errcode: 40001, errmsg: 'sync fail' },
      ]}));

      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);

      await waitForConsumer(s._db, 5000);

      const db = s._db;
      // 第一页消息已保存
      const okMsg = db.prepare("SELECT * FROM events WHERE msg_id = 'ok_m'").get();
      assert.ok(okMsg, '第一页消息应保存');
      // 游标推进到第一页
      const cur = db.prepare("SELECT next_cursor FROM msg_cursors WHERE cursor_id = ?").get(TEST_CONFIG.openKfId);
      assert.equal(cur.next_cursor, 'c1');
      // 任务标 failed，不 completed
      const task = db.prepare("SELECT status, last_error FROM pending_tasks ORDER BY id DESC LIMIT 1").get();
      assert.equal(task.status, 'failed', `任务应为 failed，实际 ${task.status}`);
      assert.ok(task.last_error.includes('sync fail'), `last_error 应含错误，实际 ${task.last_error}`);

      await closeSrv(s);
    });
  });

  describe('r4 首条媒体错误回执', () => {
    it('媒体下载失败，保存 media_error，回执带缺件提示', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r4-mediaerr');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const rec = recordFetch({ syncPages: [
        { errcode: 0, msg_list: [{ msgid: 'f_m', external_userid: 's001', msgtype: 'file', open_kfid: TEST_CONFIG.openKfId, origin: 3, file: { media_id: 'media_bad', file_name: 'bad.pdf' } }], next_cursor: '', has_more: 0 },
      ], mediaError: true });

      const s = await makeSrv(TEST_CONFIG, sp, rec);

      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);

      await waitForConsumer(s._db, 5000);

      const db = s._db;
      const dd = db.prepare("SELECT * FROM dedup WHERE msg_id = 'f_m'").get();
      assert.equal(dd.media_status, 'failed', `media_status=${dd.media_status}`);
      assert.ok(dd.media_error, '应保存 media_error');
      assert.equal(dd.replied, 1, '回执应发送');
      assert.equal(dd.media_path, null, '媒体路径应为空');

      await closeSrv(s);
    });
  });

  describe('r5 空文件拒绝', () => {
    it('0 字节媒体明确失败，不落盘', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r5-empty');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const emptyMediaFetch = async (url) => {
        const u = typeof url === 'string' ? url : '';
        if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
        if (u.includes('sync_msg')) return Response.json({ errcode: 0, msg_list: [{ msgid: 'e_m', external_userid: 's001', msgtype: 'file', open_kfid: TEST_CONFIG.openKfId, origin: 3, file: { media_id: 'media_e', file_name: 'empty.pdf' } }], next_cursor: '', has_more: 0 });
        if (u.includes('media/get')) return new Response('', { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '0' } });
        if (u.includes('send_msg')) return Response.json({ errcode: 0, errmsg: 'ok' });
        return Response.json({}, { status: 404 });
      };

      const s = await makeSrv(TEST_CONFIG, sp, emptyMediaFetch);

      const inner = `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, inner);
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e}]]></Encrypt></xml>`);

      await waitForConsumer(s._db, 5000);

      const db = s._db;
      const dd = db.prepare("SELECT * FROM dedup WHERE msg_id = 'e_m'").get();
      assert.equal(dd.media_status, 'failed', `media_status=${dd.media_status}`);
      assert.ok(dd.media_error, '应保存空文件错误');
      assert.equal(dd.media_path, null, '空文件不应落盘');

      await closeSrv(s);
    });
  });

  // ── r5 新增测试 ──

  describe('r5 媒体阶段入队新任务', () => {
    it('媒体下载挂起时新回调入队，无第三次回调仍完成', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r5-gated');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const gated = gatedMediaFetch({ syncPages: [
        { errcode: 0, msg_list: [{ msgid: 'g_a', external_userid: 's001', msgtype: 'file', open_kfid: TEST_CONFIG.openKfId, origin: 3, file: { media_id: 'media_a', file_name: 'a.pdf' } }], next_cursor: '', has_more: 0 },
        { errcode: 0, msg_list: [{ msgid: 'g_b', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'second' } }], next_cursor: '', has_more: 0 },
      ]});

      const s = await makeSrv(TEST_CONFIG, sp, gated);

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;

      // 第一个回调：触发拉取 g_a，阶段2 下载媒体挂起
      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      // 等待 media/get 被调用（阶段2 挂起中）
      const start = Date.now();
      while (!gated.calls.mediaStarted && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 50));
      }
      assert.ok(gated.calls.mediaStarted, 'media/get 应已开始（阶段2挂起）');

      // 第二个回调：媒体挂起期间入队新任务 g_b
      const e2 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '2', 'n', e2)}&timestamp=2&nonce=n`, `<xml><Encrypt><![CDATA[${e2}]]></Encrypt></xml>`);

      // 放行媒体，让阶段2完成
      gated.releaseMedia();

      // 轮询等待 g_b 也入库（不靠第三次回调）
      const db = s._db;
      const start2 = Date.now();
      let bSaved = false;
      while (Date.now() - start2 < 8000) {
        bSaved = !!db.prepare("SELECT 1 FROM events WHERE msg_id = 'g_b'").get();
        if (bSaved) break;
        await new Promise(r => setTimeout(r, 100));
      }

      assert.ok(bSaved, 'g_b 应被处理（媒体阶段的新回调不丢）');
      const aRec = db.prepare("SELECT * FROM dedup WHERE msg_id = 'g_a'").get();
      assert.equal(aRec.media_status, 'ok', 'g_a 媒体应下载成功');
      assert.equal(aRec.replied, 1, 'g_a 应回执');
      assert.ok(gated.calls.syncCount >= 2, `应至少 2 次 sync，实际 ${gated.calls.syncCount}`);

      await closeSrv(s);
    });
  });

  describe('r5 发送结果不确定不盲目重发', () => {
    it('远端接受后断链 → reply_state=uncertain，无关回调不自动重发', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r5-uncertain');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      // 第一条消息触发回执，send_msg 第一次 reject（连接重置），之后 ok
      const ff = replyFaultFetch({
        syncPages: [
          { errcode: 0, msg_list: [{ msgid: 'u_m', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'hello' } }], next_cursor: '', has_more: 0 },
          { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 }, // 第二个回调无新消息
        ],
        sendResults: ['reject', 'ok'],
      });

      const s = await makeSrv(TEST_CONFIG, sp, ff);

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;

      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      // 等第一次回执失败（uncertain）
      const db = s._db;
      const start = Date.now();
      let uRec;
      while (Date.now() - start < 5000) {
        uRec = db.prepare("SELECT * FROM dedup WHERE msg_id = 'u_m'").get();
        if (uRec && uRec.reply_state === 'uncertain') break;
        await new Promise(r => setTimeout(r, 100));
      }
      assert.equal(uRec?.reply_state, 'uncertain', `reply_state=${uRec?.reply_state}`);
      assert.equal(ff.calls.sendCount, 1, `第一次回执应只发 1 次，实际 ${ff.calls.sendCount}`);

      // 第二个无关回调（无新消息），不应自动重发 u_m
      const e2 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '2', 'n', e2)}&timestamp=2&nonce=n`, `<xml><Encrypt><![CDATA[${e2}]]></Encrypt></xml>`);

      await new Promise(r => setTimeout(r, 1500));
      assert.equal(ff.calls.sendCount, 1, `不确定状态不应由无关回调重发，实际 sendCount=${ff.calls.sendCount}`);
      const uRec2 = db.prepare("SELECT * FROM dedup WHERE msg_id = 'u_m'").get();
      assert.equal(uRec2.reply_state, 'uncertain', '状态应保持 uncertain');
      assert.equal(uRec2.replied, 0, '不应标记已回执');

      await closeSrv(s);
    });
  });

  // ── r6 新增：发送前持久化 + 空闲不空转 ──

  // send_msg 挂起：模拟"远端已接受但请求未返回"，通过 releaseReply 放行
  function hangingReplyFetch({ syncPages, acceptThenHang }) {
    let syncIdx = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    const calls = { syncCount: 0, sendCount: 0, sendStarted: false };
    const fn = async (url) => {
      const u = typeof url === 'string' ? url : '';
      if (u.includes('gettoken')) return Response.json({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      if (u.includes('sync_msg')) {
        calls.syncCount++;
        const r = syncPages[syncIdx] || { errcode: 0, msg_list: [], next_cursor: '', has_more: 0 };
        syncIdx++;
        return Response.json(r);
      }
      if (u.includes('media/get')) return new Response(Buffer.from('fake_media'), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' } });
      if (u.includes('send_msg')) {
        calls.sendCount++;
        calls.sendStarted = true;
        if (acceptThenHang) await gate; // 远端已接受但请求未返回
        return Response.json({ errcode: 0, errmsg: 'ok' });
      }
      return Response.json({}, { status: 404 });
    };
    fn.calls = calls;
    fn.releaseReply = () => release();
    return fn;
  }

  describe('r6 发送中退出，重启不盲目重发', () => {
    it('远端已接受但请求未返回时关闭，重启接受次数仍为 1，进入待确认', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r6-hang');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      // 第一段：send_msg 挂起（远端已接受），进程在 await 期间"退出"
      const hf = hangingReplyFetch({
        syncPages: [
          { errcode: 0, msg_list: [{ msgid: 'h_m', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'hi' } }], next_cursor: '', has_more: 0 },
        ],
        acceptThenHang: true,
      });
      const s1 = await makeSrv(TEST_CONFIG, sp, hf);

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s1, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      // 等待 send_msg 开始（reply_state 已持久化为 sending）
      const start = Date.now();
      while (!hf.calls.sendStarted && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 50));
      }
      assert.ok(hf.calls.sendStarted, 'send_msg 应已开始');

      // 检查发送前已持久化 sending 状态
      const db1 = s1._db;
      const mid1 = db1.prepare("SELECT * FROM dedup WHERE msg_id = 'h_m'").get();
      assert.equal(mid1.reply_state, 'sending', `发送前应持久化 sending，实际 ${mid1.reply_state}`);
      assert.equal(hf.calls.sendCount, 1, `远端应接受 1 次，实际 ${hf.calls.sendCount}`);

      // 模拟进程退出：直接关闭（不 release），send_msg 仍挂起
      await closeSrv(s1);

      // 第二段：重启同一 storePath，上游不再返回 h_m
      const rec = recordFetch({ syncPages: [{ errcode: 0, msg_list: [], next_cursor: '', has_more: 0 }] });
      const s2 = await makeSrv(TEST_CONFIG, sp, rec);

      // 等待启动恢复完成
      await new Promise(r => setTimeout(r, 1500));

      // sending → uncertain（待确认），不再发送
      const db2 = s2._db;
      const mid2 = db2.prepare("SELECT * FROM dedup WHERE msg_id = 'h_m'").get();
      assert.equal(mid2.reply_state, 'uncertain', `重启后应转 uncertain，实际 ${mid2.reply_state}`);
      assert.equal(mid2.replied, 0, '不应标记已回执');
      assert.equal(rec.calls.sendMsgBodies.length, 0, '重启后不应再发送回执');

      await closeSrv(s2);
    });
  });

  describe('r6 完成后空闲不空转', () => {
    it('文字回执成功后，连续观察窗口不再增加扫描', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r6-idle');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const rec = recordFetch({ syncPages: [
        { errcode: 0, msg_list: [{ msgid: 'i_m', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'hi' } }], next_cursor: '', has_more: 0 },
      ]});
      const s = await makeSrv(TEST_CONFIG, sp, rec);

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      // 等待回执完成
      const db = s._db;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const dd = db.prepare("SELECT replied FROM dedup WHERE msg_id = 'i_m'").get();
        if (dd && dd.replied === 1) break;
        await new Promise(r => setTimeout(r, 100));
      }

      // 记录当前 sync 次数
      const syncAfterDone = rec.calls.syncCount;
      assert.ok(syncAfterDone >= 1, '应至少 sync 一次拉取消息');

      // 两个观察窗口，不应再有额外 sync（空闲不空转）
      await new Promise(r => setTimeout(r, 800));
      const s1 = rec.calls.syncCount;
      await new Promise(r => setTimeout(r, 800));
      const s2 = rec.calls.syncCount;
      assert.equal(s1, syncAfterDone, `第一窗口不应新增 sync，实际 ${s1 - syncAfterDone} 次`);
      assert.equal(s2, syncAfterDone, `第二窗口不应新增 sync，实际 ${s2 - syncAfterDone} 次`);

      await closeSrv(s);
    });

    it('永久媒体失败后，不再增加媒体下载调用', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r6-mediaidle');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const rec = recordFetch({
        syncPages: [
          { errcode: 0, msg_list: [{ msgid: 'f_i', external_userid: 's001', msgtype: 'file', open_kfid: TEST_CONFIG.openKfId, origin: 3, file: { media_id: 'media_fail', file_name: 'x.pdf' } }], next_cursor: '', has_more: 0 },
        ],
        mediaError: true,
      });
      const s = await makeSrv(TEST_CONFIG, sp, rec);

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      // 等待媒体失败状态落库
      const db = s._db;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const dd = db.prepare("SELECT media_status FROM dedup WHERE msg_id = 'f_i'").get();
        if (dd && dd.media_status === 'failed') break;
        await new Promise(r => setTimeout(r, 100));
      }

      const mediaAfterFail = rec.calls.mediaCount;
      assert.equal(mediaAfterFail, 1, `媒体应只尝试 1 次，实际 ${mediaAfterFail}`);

      // 两个观察窗口，不应再有媒体下载
      await new Promise(r => setTimeout(r, 800));
      const m1 = rec.calls.mediaCount;
      await new Promise(r => setTimeout(r, 800));
      const m2 = rec.calls.mediaCount;
      assert.equal(m1, 1, `第一窗口不应新增媒体下载，实际 ${m1 - 1} 次`);
      assert.equal(m2, 1, `第二窗口不应新增媒体下载，实际 ${m2 - 1} 次`);

      await closeSrv(s);
    });
  });

  describe('r6 游标停滞明确停止', () => {
    it('has_more=1 但 next_cursor 空，任务标 failed，不无限续跑', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r6-stall');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const s = await makeSrv(TEST_CONFIG, sp, recordFetch({ syncPages: [
        { errcode: 0, msg_list: [{ msgid: 'st_m', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'x' } }], next_cursor: '', has_more: 1 },
      ]}));

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;
      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      // 等待任务标 failed
      const db = s._db;
      const start = Date.now();
      let task;
      while (Date.now() - start < 5000) {
        task = db.prepare("SELECT status, last_error FROM pending_tasks ORDER BY id DESC LIMIT 1").get();
        if (task && task.status === 'failed') break;
        await new Promise(r => setTimeout(r, 100));
      }
      assert.equal(task.status, 'failed', `任务应 failed，实际 ${task.status}`);
      assert.ok(task.last_error.includes('CURSOR_STALLED'), `last_error 应含 CURSOR_STALLED，实际 ${task.last_error}`);

      await closeSrv(s);
    });
  });

  describe('r6 新回调仍能唤醒', () => {
    it('空闲后新回调入队，仍能拉取处理新消息', async () => {
      const sp = resolve(ROOT, '.local', 'gt-r6-wake');
      try { rmSync(sp, { recursive: true, force: true }); } catch {}

      const rec = recordFetch({ syncPages: [
        { errcode: 0, msg_list: [{ msgid: 'w_a', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'first' } }], next_cursor: 'c1', has_more: 0 },
        { errcode: 0, msg_list: [{ msgid: 'w_b', external_userid: 's001', msgtype: 'text', open_kfid: TEST_CONFIG.openKfId, origin: 3, text: { content: 'second' } }], next_cursor: '', has_more: 0 },
      ]});
      const s = await makeSrv(TEST_CONFIG, sp, rec);

      const mkInner = () => `<xml><ToUserName><![CDATA[${TEST_CONFIG.corpId}]]></ToUserName><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[et]]></Token><OpenKfId><![CDATA[${TEST_CONFIG.openKfId}]]></OpenKfId></xml>`;

      // 第一个回调
      const e1 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '1', 'n', e1)}&timestamp=1&nonce=n`, `<xml><Encrypt><![CDATA[${e1}]]></Encrypt></xml>`);

      const db = s._db;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const dd = db.prepare("SELECT replied FROM dedup WHERE msg_id = 'w_a'").get();
        if (dd && dd.replied === 1) break;
        await new Promise(r => setTimeout(r, 100));
      }

      // 第二个回调，应唤醒并处理 w_b
      const e2 = encMsg(TEST_CONFIG.corpId, TEST_CONFIG.encodingAESKey, mkInner());
      await hreq(s, 'POST', `/wechat/callback?msg_signature=${msig(TEST_CONFIG.token, '2', 'n', e2)}&timestamp=2&nonce=n`, `<xml><Encrypt><![CDATA[${e2}]]></Encrypt></xml>`);

      const start2 = Date.now();
      while (Date.now() - start2 < 5000) {
        const dd = db.prepare("SELECT replied FROM dedup WHERE msg_id = 'w_b'").get();
        if (dd && dd.replied === 1) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const wb = db.prepare("SELECT * FROM dedup WHERE msg_id = 'w_b'").get();
      assert.ok(wb, 'w_b 应入库');
      assert.equal(wb.replied, 1, 'w_b 应回执');

      await closeSrv(s);
    });
  });
});