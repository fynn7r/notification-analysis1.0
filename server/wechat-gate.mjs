// TASK-001 M0 r3：微信客服最小接收程序（第四版）
// r3 修正：旧库迁移、持久游标+hasMore分页、单消费者锁、状态机恢复、回调OpenKfId校验、测试正常退出

import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual, createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'node:querystring';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STORE = resolve(ROOT, '.local', 'wechat-gate');
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

// ── 配置 ────────────────────────────────────────────

function loadConfig() {
  const envFile = resolve(ROOT, '.env.wechat.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return {
    corpId: process.env.WECOM_CORP_ID || '',
    secret: process.env.WECOM_SECRET || '',
    token: process.env.WECOM_TOKEN || '',
    encodingAESKey: process.env.WECOM_ENCODING_AES_KEY || '',
    openKfId: process.env.WECOM_OPEN_KFID || '',
    publicUrl: process.env.WECHAT_GATE_PUBLIC_URL || '',
    allowedSenderIds: (process.env.WECHAT_GATE_TESTER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    host: process.env.WECHAT_GATE_HOST || '127.0.0.1',
    storePath: process.env.WECHAT_GATE_STORE || '',
  };
}

// ── 数据库（含旧库迁移） ──────────────────────────

function currentColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

function initDb(storePath) {
  mkdirSync(storePath, { recursive: true });
  mkdirSync(resolve(storePath, 'media'), { recursive: true });
  const db = new DatabaseSync(resolve(storePath, 'state.db'));
  db.exec('PRAGMA journal_mode = WAL');

  // 基础建表（CREATE IF NOT EXISTS）
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, msg_id TEXT, event_type TEXT, sender_id TEXT,
      msg_type TEXT, media_id TEXT, file_name TEXT, raw_body TEXT,
      status TEXT DEFAULT 'received',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pending_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL, payload TEXT,
      status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS msg_cursors (
      cursor_id TEXT PRIMARY KEY, next_cursor TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dedup (
      msg_id TEXT PRIMARY KEY,
      saved INTEGER DEFAULT 0, replied INTEGER DEFAULT 0,
      reply_error TEXT, media_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS raw_events (
      id TEXT PRIMARY KEY, sender_id TEXT, event_type TEXT, raw_xml TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 迁移：events 补 is_authorized
  if (!currentColumns(db, 'events').includes('is_authorized')) {
    db.exec("ALTER TABLE events ADD COLUMN is_authorized INTEGER DEFAULT 0");
  }

  // 迁移：dedup 补 media_status / media_error / media_id
  if (!currentColumns(db, 'dedup').includes('media_status')) {
    db.exec("ALTER TABLE dedup ADD COLUMN media_status TEXT DEFAULT ''");
  }
  if (!currentColumns(db, 'dedup').includes('media_id')) {
    db.exec("ALTER TABLE dedup ADD COLUMN media_id TEXT DEFAULT ''");
  }
  if (!currentColumns(db, 'dedup').includes('media_error')) {
    db.exec("ALTER TABLE dedup ADD COLUMN media_error TEXT DEFAULT ''");
  }
  if (!currentColumns(db, 'dedup').includes('reply_state')) {
    db.exec("ALTER TABLE dedup ADD COLUMN reply_state TEXT DEFAULT ''");
  }

  // 迁移：pending_tasks 的 r1 结构（event_id/task_type NOT NULL，无 event_type）
  // 需事务化重建，保留旧记录：task_type → event_type，event_token 置空（缺 Token 由消费时标明确状态）
  const ptCols = currentColumns(db, 'pending_tasks');
  if (!ptCols.includes('event_type')) {
    db.exec('BEGIN');
    try {
      db.exec('ALTER TABLE pending_tasks RENAME TO pending_tasks_old');
      db.exec(`CREATE TABLE pending_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_token TEXT DEFAULT '',
        event_type TEXT NOT NULL DEFAULT '',
        payload TEXT,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      // 旧结构列：event_id, task_type, payload, status, attempts, last_error, created_at
      const oldCols = currentColumns(db, 'pending_tasks_old');
      const hasPayload = oldCols.includes('payload');
      const hasStatus = oldCols.includes('status');
      const hasAttempts = oldCols.includes('attempts');
      const hasLastError = oldCols.includes('last_error');
      const hasCreatedAt = oldCols.includes('created_at');
      db.exec(`INSERT INTO pending_tasks (id, event_token, event_type, payload, status, attempts, last_error, created_at)
        SELECT id, '', COALESCE(task_type, ''), ${hasPayload ? 'payload' : "''"}, ${hasStatus ? 'status' : "'pending'"}, ${hasAttempts ? 'attempts' : '0'}, ${hasLastError ? 'last_error' : 'NULL'}, ${hasCreatedAt ? 'created_at' : "datetime('now')"}
        FROM pending_tasks_old`);
      db.exec('DROP TABLE pending_tasks_old');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } else if (!ptCols.includes('event_token')) {
    db.exec("ALTER TABLE pending_tasks ADD COLUMN event_token TEXT DEFAULT ''");
  }

  return db;
}

// ── XML 解析 ────────────────────────────────────────

function xmlToJSON(xml) {
  if (/<!DOCTYPE|<![ \t\n]*ENTITY/i.test(xml)) return { _error: 'DTD/ENTITY rejected' };
  const obj = {};
  const cdataRe = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/gs;
  let m;
  while ((m = cdataRe.exec(xml))) {
    if (obj[m[1]] !== undefined) return { _error: `duplicate field: ${m[1]}` };
    obj[m[1]] = m[2];
  }
  const plainRe = /<(\w+)>([^<]*)<\/\1>/g;
  while ((m = plainRe.exec(xml))) {
    if (obj[m[1]] !== undefined) {
      if (m[2].trim() === '') continue;
      return { _error: `duplicate field: ${m[1]}` };
    }
    obj[m[1]] = m[2].trim();
  }
  return obj;
}

// ── 签名与解密 ──────────────────────────────────────

function sha1(data) { return createHash('sha1').update(data, 'utf8').digest('hex'); }

function verifySignature(token, timestamp, nonce, encrypt, signature) {
  if (!token || !timestamp || !nonce || !encrypt || !signature) return false;
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  try { return timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(sha1(sorted), 'utf8')); }
  catch { return false; }
}

function decryptMsg(encodingAESKey, encrypted) {
  try {
    const key = Buffer.from(encodingAESKey + '=', 'base64');
    if (key.length !== 32) return { error: '无效 EncodingAESKey 长度' };
    const iv = key.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
    const padLen = decrypted[decrypted.length - 1];
    if (padLen < 1 || padLen > 32) return { error: '解密失败：无效填充' };
    decrypted = decrypted.subarray(0, decrypted.length - padLen);
    if (decrypted.length < 20) return { error: '解密结果过短' };
    const content = decrypted.subarray(16);
    const msgLen = content.readUInt32BE(0);
    if (4 + msgLen > content.length) return { error: '消息长度溢出' };
    return { msg: content.subarray(4, 4 + msgLen).toString('utf8'), corpId: content.subarray(4 + msgLen).toString('utf8') };
  } catch (e) { return { error: `解密异常: ${e.message}` }; }
}

// ── 白名单 ──────────────────────────────────────────

function isAllowedUser(senderId, config) {
  return !!senderId && config.allowedSenderIds.includes(senderId);
}

// ── access_token ────────────────────────────────────

let tokenCache = { token: '', expires: 0 };

async function getAccessToken(config, fetchImpl) {
  if (!config.corpId || !config.secret) return null;
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  try {
    const resp = await fetchImpl(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpId}&corpsecret=${config.secret}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await resp.json();
    if (data.errcode !== 0) return null;
    tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 300) * 1000 };
    return tokenCache.token;
  } catch { return null; }
}

// ── 消息拉取（sync_msg） ────────────────────────────

async function syncMessagesPage(config, eventToken, cursor, fetchImpl) {
  const accessToken = await getAccessToken(config, fetchImpl);
  if (!accessToken) return { error: 'NO_ACCESS_TOKEN' };
  const body = JSON.stringify({ cursor: cursor || '', token: eventToken, open_kfid: config.openKfId, limit: 100 });
  try {
    const resp = await fetchImpl(`https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json();
    if (data.errcode !== 0) return { error: `sync_msg: ${data.errcode} ${data.errmsg}` };
    return { ok: true, msgList: data.msg_list || [], nextCursor: data.next_cursor || '', hasMore: data.has_more === 1 };
  } catch (e) { return { error: `sync_msg 异常: ${e.message}` }; }
}

// ── 媒体下载 ────────────────────────────────────────

async function downloadMedia(config, mediaId, fileName, mediaDir, fetchImpl) {
  const accessToken = await getAccessToken(config, fetchImpl);
  if (!accessToken) return { error: 'NO_ACCESS_TOKEN' };
  try {
    const resp = await fetchImpl(`https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${accessToken}&media_id=${mediaId}`, {
      signal: AbortSignal.timeout(60000), redirect: 'error',
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try { const err = await resp.json(); return { error: `媒体下载: ${err.errcode} ${err.errmsg}` }; }
      catch { return { error: '媒体下载返回非预期内容' }; }
    }
    if (!resp.ok) return { error: `媒体下载 HTTP ${resp.status}` };
    const cl = parseInt(resp.headers.get('content-length') || '0', 10);
    if (cl > MAX_MEDIA_BYTES) return { error: `文件过大 (${cl} > ${MAX_MEDIA_BYTES})` };
    const chunks = []; let size = 0;
    for await (const chunk of resp.body) {
      size += chunk.length;
      if (size > MAX_MEDIA_BYTES) return { error: `下载超出限额` };
      chunks.push(chunk);
    }
    if (size === 0) return { error: '媒体文件为空（0 字节）' };
    const ext = (() => {
      if (!fileName) return '';
      const e = extname(fileName).toLowerCase();
      return /^\.(pdf|doc|docx|txt|xlsx?|pptx?|jpe?g|png|gif|bmp|mp[34]|wav|amr)$/.test(e) ? e : '';
    })();
    const dest = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    await writeFile(resolve(mediaDir, `.${dest}.tmp`), Buffer.concat(chunks), { mode: 0o600 });
    await rename(resolve(mediaDir, `.${dest}.tmp`), resolve(mediaDir, dest));
    return { ok: true, path: resolve(mediaDir, dest), size, fileName: fileName || dest };
  } catch (e) { return { error: `媒体下载异常: ${e.message}` }; }
}

// ── 回复 ────────────────────────────────────────────

function msgTypeLabel(t) {
  const m = { text: '文字', image: '图片', voice: '语音', video: '视频', file: '文件', link: '链接', weapp: '小程序' };
  return m[t] || t || '其他';
}

async function sendTextReply(config, senderId, text, fetchImpl) {
  const accessToken = await getAccessToken(config, fetchImpl);
  if (!accessToken) return { ok: false, error: 'NO_ACCESS_TOKEN', uncertain: true };
  let resp;
  try {
    resp = await fetchImpl(`https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${accessToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser: senderId, open_kfid: config.openKfId, msgtype: 'text', text: { content: text } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    // 连接中断/超时：远端是否收到不确定
    return { ok: false, error: e.message, uncertain: true };
  }
  try {
    const r = await resp.json();
    if (r.errcode === 0) return { ok: true };
    // 微信明确拒绝：确定未发送成功，可重试
    return { ok: false, error: `${r.errcode}: ${r.errmsg}`, uncertain: false };
  } catch (e) {
    // 响应体解析失败：发送结果不确定
    return { ok: false, error: `响应解析失败: ${e.message}`, uncertain: true };
  }
}

// ── 消费者循环 ──────────────────────────────────────

// ── 阶段2：处理已保存但未完成的授权消息（下载媒体 + 回执） ──

async function processPendingMedia(db, config, mediaDir, fetchImpl) {
  // 每个 msg_id 只取一条最新 events 记录（去重），不依赖上游再次返回
  const rows = db.prepare(`
    SELECT d.msg_id, d.media_status, d.replied, d.reply_error, d.reply_state,
      (SELECT raw_body FROM events WHERE msg_id = d.msg_id AND is_authorized = 1 ORDER BY created_at DESC, rowid DESC LIMIT 1) AS raw_body
    FROM dedup d
    WHERE d.saved = 1
      AND EXISTS (SELECT 1 FROM events WHERE msg_id = d.msg_id AND is_authorized = 1)
  `).all();

  for (const row of rows) {
    let payload;
    try { payload = JSON.parse(row.raw_body); } catch { continue; }
    const { senderId, msgType, mediaId, fileName, content, linkUrl } = payload;
    if (!senderId || !msgType) continue;

    // 下载媒体：仅 media_status 为空（尚未尝试）才下载；永久失败 failed 不自动重试，等待明确重投
    if (mediaId && row.media_status === '') {
      const mr = await downloadMedia(config, mediaId, fileName, mediaDir, fetchImpl);
      if (mr.ok) {
        db.prepare('UPDATE dedup SET media_path = ?, media_status = ?, media_error = NULL WHERE msg_id = ?').run(mr.path, 'ok', row.msg_id);
      } else {
        db.prepare('UPDATE dedup SET media_status = ?, media_error = ? WHERE msg_id = ?').run('failed', mr.error, row.msg_id);
      }
    }

    // 重新读取最新状态构造回执
    const fresh = db.prepare('SELECT media_status, media_error, replied, reply_error, reply_state FROM dedup WHERE msg_id = ?').get(row.msg_id);
    if (!fresh) continue;
    if (fresh.replied) continue;              // 回执已成功，不重发
    if (fresh.reply_state === 'uncertain') continue; // 发送结果不确定，不自动重发，保留待确认
    if (fresh.reply_state === 'failed') continue;    // 明确失败，不无限立即重发，等待明确重投
    if (fresh.reply_state === 'sending') continue;   // 发送中（极端情况），不重复发送

    let label = msgTypeLabel(msgType);
    if (mediaId && fileName) label += `（${fileName}）`;
    else if (mediaId) label += `（${mediaId}）`;
    else if (msgType === 'text') label += `「${(content || '').slice(0, 30)}」`;
    else if (msgType === 'link') label += `「${linkUrl || ''}」`;
    let replyText = `收到 ${label}；当前仅为接入验证，尚未解析通知内容。`;
    if (mediaId && fresh.media_status === 'failed') {
      replyText += ` ⚠️ 文件未成功保存：${fresh.media_error || '下载失败'}`;
    }

    // 发送前先持久化「发送中」，覆盖进程在 await 期间退出的窗口
    db.prepare("UPDATE dedup SET reply_state = 'sending' WHERE msg_id = ?").run(row.msg_id);

    const rr = await sendTextReply(config, senderId, replyText, fetchImpl);
    if (rr.ok) {
      db.prepare('UPDATE dedup SET replied = 1, reply_error = NULL, reply_state = \'ok\' WHERE msg_id = ?').run(row.msg_id);
    } else if (rr.uncertain) {
      // 结果不确定：保留待确认状态，不盲目自动重发
      db.prepare('UPDATE dedup SET reply_state = \'uncertain\', reply_error = ? WHERE msg_id = ?').run(rr.error, row.msg_id);
    } else {
      // 明确失败：记录，等待明确重投（不无限立即重试）
      db.prepare('UPDATE dedup SET reply_state = \'failed\', reply_error = ? WHERE msg_id = ?').run(rr.error, row.msg_id);
    }
  }
}

async function consumeLoop(db, config, storePath, fetchImpl, onIdle) {
  const mediaDir = resolve(storePath, 'media');
  const maxPages = 20;

  // 阶段1：逐个 pending 任务拉取消息（每页原子提交消息 + 游标）
  while (true) {
    const task = db.prepare("SELECT * FROM pending_tasks WHERE status = 'pending' ORDER BY id LIMIT 1").get();
    if (!task) break;

    db.prepare("UPDATE pending_tasks SET status = 'processing', attempts = attempts + 1 WHERE id = ?").run(task.id);
    const eventToken = task.event_token || '';

    // 旧任务缺 Token：明确失败状态，不继续
    if (!eventToken) {
      db.prepare("UPDATE pending_tasks SET status = 'failed', last_error = 'MISSING_EVENT_TOKEN' WHERE id = ?").run(task.id);
      continue;
    }

    let cursorRow = db.prepare('SELECT next_cursor FROM msg_cursors WHERE cursor_id = ?').get(config.openKfId);
    let cursor = cursorRow ? cursorRow.next_cursor : '';
    let pageCount = 0;
    let hasMore = true;
    let pullError = null;
    let prevCursor = cursor;

    // 逐页拉取，每页成功即原子保存消息 + 游标（避免 20 页上限时丢消息）
    while (hasMore && pageCount < maxPages) {
      const page = await syncMessagesPage(config, eventToken, cursor, fetchImpl);
      if (!page.ok) {
        pullError = page.error;
        break;
      }

      // 游标停滞检测：has_more 持续为 1 但 next_cursor 未推进，停止避免无限续跑
      if (page.hasMore && !page.nextCursor) {
        pullError = 'CURSOR_STALLED: has_more=1 但 next_cursor 为空';
        break;
      }
      if (page.hasMore && page.nextCursor === prevCursor) {
        pullError = `CURSOR_STALLED: 游标未推进 (${page.nextCursor})`;
        break;
      }

      const messagesToProcess = [];
      db.exec('BEGIN');
      try {
        for (const msg of (page.msgList || [])) {
          const msgId = msg.msgid;
          const senderId = msg.external_userid || msg.sender || '';
          const msgType = msg.msgtype;
          const origin = msg.origin;
          if (msg.open_kfid !== config.openKfId) continue;
          if (origin !== 3 && origin !== '3') continue;

          const authorized = isAllowedUser(senderId, config);
          const fp = { msgId, senderId, msgType, mediaId: msg[msgType]?.media_id || '' };
          if (authorized) {
            fp.content = msg.text?.content || '';
            fp.fileName = msg.file?.file_name || msg.image?.file_name || '';
            fp.linkTitle = msg.link?.title || '';
            fp.linkUrl = msg.link?.url || '';
            fp.linkPicUrl = msg.link?.pic_url || '';
          }

          const existing = db.prepare('SELECT saved, media_status, reply_state FROM dedup WHERE msg_id = ?').get(msgId);
          if (!existing) {
            db.prepare('INSERT OR REPLACE INTO dedup (msg_id, saved, media_id) VALUES (?, 1, ?)').run(msgId, fp.mediaId || '');
          } else {
            // 重投同一 msgid：明确重投视为允许恢复，重置失败状态
            const resetMedia = existing.media_status === 'failed' ? "media_status = '', media_error = NULL" : '';
            const resetReply = (existing.reply_state === 'failed' && existing.replied === 0) ? "reply_state = ''" : '';
            const sets = ['media_id = ?', resetMedia, resetReply].filter(Boolean).join(', ');
            db.prepare(`UPDATE dedup SET ${sets} WHERE msg_id = ?`).run(fp.mediaId || '', msgId);
          }

          // 按 msg_id 去重：已有 events 记录则更新，避免同一消息存多条材料
          const existingEvent = db.prepare('SELECT id FROM events WHERE msg_id = ?').get(msgId);
          if (existingEvent) {
            db.prepare('UPDATE events SET sender_id = ?, msg_type = ?, media_id = ?, file_name = ?, raw_body = ?, is_authorized = ? WHERE msg_id = ?')
              .run(senderId, msgType, fp.mediaId, fp.fileName || '', JSON.stringify(fp), authorized ? 1 : 0, msgId);
          } else {
            db.prepare(`INSERT INTO events (id, msg_id, event_type, sender_id, msg_type, media_id, file_name, raw_body, is_authorized)
              VALUES (?,?,?,?,?,?,?,?,?)`)
              .run(randomUUID(), msgId, 'message', senderId, msgType, fp.mediaId, fp.fileName || '', JSON.stringify(fp), authorized ? 1 : 0);
          }
        }

        // 本页成功，游标同事务推进
        if (page.nextCursor) {
          db.prepare("INSERT OR REPLACE INTO msg_cursors (cursor_id, next_cursor, updated_at) VALUES (?, ?, datetime('now'))")
            .run(config.openKfId, page.nextCursor);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        pullError = `事务: ${e.message}`;
        break;
      }

      cursor = page.nextCursor;
      hasMore = page.hasMore;
      pageCount++;
      prevCursor = page.nextCursor || prevCursor;
      if ((page.msgList || []).length === 0 && !hasMore) break; // 空页且无更多
    }

    if (pullError) {
      // 拉取/保存失败：明确 failed，不标 completed（已成功页的游标与消息已提交）
      db.prepare("UPDATE pending_tasks SET status = 'failed', last_error = ? WHERE id = ?").run(pullError, task.id);
      continue;
    }

    if (pageCount >= maxPages && hasMore) {
      // 安全上限：消息已逐页保存，游标已推进；任务标 pending 供下次继续（break 避免本循环立即重取）
      db.prepare("UPDATE pending_tasks SET status = 'pending', last_error = 'MAX_PAGES_REACHED' WHERE id = ?").run(task.id);
      break;
    }

    db.prepare("UPDATE pending_tasks SET status = 'completed' WHERE id = ?").run(task.id);
  }

  // 阶段2：处理已保存未完成消息（含重启恢复，不依赖本次新拉取）
  await processPendingMedia(db, config, mediaDir, fetchImpl);

  if (onIdle) onIdle();
}

// ── 创建服务 ────────────────────────────────────────

export function createWechatGate(overrideConfig = null, options = {}) {
  const storePath = options.storePath || DEFAULT_STORE;
  const fetchImpl = options.fetchImpl || fetch;
  const getConfig = () => overrideConfig || loadConfig();
  const db = initDb(storePath);

  // 消费锁
  let consuming = false;
  let closed = false;

  function hasPendingWork() {
    const pending = db.prepare("SELECT COUNT(*) as cnt FROM pending_tasks WHERE status = 'pending'").get().cnt > 0;
    // 只认「可立即处理」的未完成项，排除已空闲（文字无附件回执成功）与永久失败（media failed / reply failed / uncertain / sending）
    const unfinished = db.prepare(`
      SELECT COUNT(*) as cnt FROM dedup d
      WHERE d.saved = 1
        AND EXISTS (SELECT 1 FROM events WHERE msg_id = d.msg_id AND is_authorized = 1)
        AND (
          (d.media_id IS NOT NULL AND d.media_id != '' AND d.media_status = '')
          OR (d.replied = 0 AND d.reply_state NOT IN ('uncertain', 'failed', 'sending'))
        )
    `).get().cnt > 0;
    return pending || unfinished;
  }

  function runConsumer() {
    consumeLoop(db, getConfig(), storePath, fetchImpl, () => {
      // 清锁前复查：媒体阶段收到的新回调、或 20 页上限后的续跑，都要继续处理
      const more = !closed && hasPendingWork();
      consuming = false;
      if (more) {
        // 让出事件循环，有界调度下一轮，避免紧密同步循环阻塞请求
        setImmediate(() => signalConsumer());
      }
    }).catch(() => {
      const more = !closed && hasPendingWork();
      consuming = false;
      if (more) setImmediate(() => signalConsumer());
    });
  }

  function signalConsumer() {
    if (consuming || closed) return;
    consuming = true;
    runConsumer();
  }

  // 启动恢复：processing → pending；存在待办或未完成媒体/回执时触发消费
  db.prepare("UPDATE pending_tasks SET status = 'pending' WHERE status = 'processing'").run();
  // 发送中退出 → 转为待确认，避免重启当作从未发送而盲目重发
  db.prepare("UPDATE dedup SET reply_state = 'uncertain' WHERE reply_state = 'sending'").run();
  if (hasPendingWork()) {
    signalConsumer();
  }

  const server = createServer(async (request, response) => {
    const config = getConfig();
    const send = (status, body, ct) => {
      response.statusCode = status;
      response.setHeader('Content-Type', ct || ((typeof body === 'object') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'));
      response.setHeader('Cache-Control', 'no-store');
      response.end(typeof body === 'object' ? JSON.stringify(body) : body);
    };

    const url = new URL(request.url, 'http://localhost');
    const pn = url.pathname;
    const params = parse(url.searchParams.toString());

    if (request.method === 'GET' && pn === '/') {
      send(200, '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>通知智析 · 微信接入</title><style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#334155}</style></head><body><div style="text-align:center;padding:2rem"><h2 style="font-weight:600">通知智析 · 微信接入</h2><p style="color:#94a3b8;margin-top:.5rem">M0 · r3</p></div></body></html>', 'text/html; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && pn === '/health') {
      send(200, { status: 'running', configured: !!(config.corpId && config.secret && config.token && config.encodingAESKey), allowedSenders: config.allowedSenderIds.length, stage: 'M0', revision: 'r3' });
      return;
    }
    if (request.method === 'GET' && pn === '/wechat/callback') {
      const { msg_signature, timestamp, nonce, echostr } = params;
      if (!msg_signature || !timestamp || !nonce || !echostr) { send(400, 'missing parameters'); return; }
      if (!config.token || !config.encodingAESKey) { send(500, 'server not configured'); return; }
      if (!verifySignature(config.token, timestamp, nonce, echostr, msg_signature)) { send(403, 'signature failed'); return; }
      const d = decryptMsg(config.encodingAESKey, echostr);
      if (d.error) { send(500, d.error); return; }
      if (config.corpId && d.corpId !== config.corpId) { send(403, 'corpId mismatch'); return; }
      send(200, d.msg); return;
    }
    if (request.method === 'POST' && pn === '/wechat/callback') {
      const chunks = []; let sz = 0;
      for await (const c of request) { sz += c.length; if (sz > 512 * 1024) { send(413, 'too large'); return; } chunks.push(c); }
      const body = Buffer.concat(chunks).toString('utf8');
      const { msg_signature, timestamp, nonce } = params;
      if (!msg_signature) { send(400, 'missing signature'); return; }
      if (!config.token || !config.encodingAESKey) { send(500, 'not configured'); return; }

      const outer = xmlToJSON(body);
      if (outer._error) { send(400, `xml: ${outer._error}`); return; }
      const enc = outer.Encrypt;
      if (!enc) { send(400, 'missing Encrypt'); return; }
      if (!verifySignature(config.token, timestamp, nonce, enc, msg_signature)) { send(403, 'signature failed'); return; }

      const dec = decryptMsg(config.encodingAESKey, enc);
      if (dec.error) { send(500, dec.error); return; }
      if (config.corpId && dec.corpId !== config.corpId) { send(403, 'corpId mismatch'); return; }

      const inner = xmlToJSON(dec.msg);
      if (inner._error) { send(400, `inner xml: ${inner._error}`); return; }

      // 校验事件合法性
      const evType = inner.Event || inner.MsgType;
      if (!evType) { send(400, 'unknown event type'); return; }
      const innerOpenKfId = inner.OpenKfId || '';
      if (innerOpenKfId !== config.openKfId) { send(200, 'success'); return; } // 非本账号，安全忽略
      const eventToken = inner.Token || '';
      if (!eventToken) { send(200, 'success'); return; } // 无 Token 无法拉消息

      // 记录 raw_event
      try {
        db.prepare('INSERT INTO raw_events (id, sender_id, event_type, raw_xml) VALUES (?,?,?,?)')
          .run(randomUUID(), inner.FromUserName || '', evType, JSON.stringify(inner));
      } catch { /* ok */ }

      // 入队
      let taskId;
      try {
        const r = db.prepare('INSERT INTO pending_tasks (event_token, event_type, payload) VALUES (?,?,?)')
          .run(eventToken, evType, JSON.stringify(inner));
        taskId = r.lastInsertRowid;
      } catch (e) {
        send(500, 'enqueue failed'); return;
      }

      send(200, 'success');
      signalConsumer();
      return;
    }
    send(404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  server._db = db;
  server._storePath = storePath;
  server._close = () => {
    closed = true;      // 阻止后续 setImmediate 续跑访问已关闭 db
    server.close();
    db.close();
  };

  return server;
}

// ── 直接启动 ────────────────────────────────────────

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const port = Number(process.env.WECHAT_GATE_PORT) || 3002;
  const storePath = config.storePath ? resolve(config.storePath) : DEFAULT_STORE;
  createWechatGate(config, { storePath }).listen(port, config.host, () => {
    console.log(`微信接入网关 r3 :${port} (${config.host})`);
    console.log(`数据目录：${storePath}`);
    console.log(config.token ? '回调就绪。' : '缺 Token/AESKey。');
  });
}