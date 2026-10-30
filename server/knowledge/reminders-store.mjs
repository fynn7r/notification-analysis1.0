/**
 * 待办/提醒数据层。
 *
 * 设计取舍：关键列（标题、截止、提醒时间、完成态、提前量）单列，其余字段整体存进
 * `payload`。前端 IReminder 有十来个字段，逐列建模会让表结构跟着前端一起漂；
 * 而排序、筛选、闹钟、日历导出只用到那几列，单列就够了。
 *
 * 删除用墓碑（deleted_at）而不是物理删除，因为浏览器本地还留着一份副本：
 * 硬删之后，任何一次同步都会把本地那份推回服务端，删掉的东西自己复活。
 */
import { nowIso } from './db.mjs';

const MAX_TITLE_CHARS = 200;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_IMPORT_ITEMS = 500;

export class ReminderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 只接受带偏移或 Z 的严格 ISO；空串视为「没有这个时间」。 */
function normalizeIso(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) {
    throw new ReminderError(400, 'INVALID_REMINDER', `${label}不是有效的时间格式。`);
  }
  return text;
}

/**
 * 附件里的 dataUrl 是 base64 原图，动辄几 MB：进库会让 SQLite 行撑爆，
 * 也会顶穿接口的请求体上限。只保留元数据，原文不入库。
 */
function stripAttachmentData(attachments) {
  if (!Array.isArray(attachments)) return undefined;
  return attachments.map((item) => {
    const { dataUrl: _drop, ...rest } = item ?? {};
    return rest;
  });
}

function sanitizePayload(payload = {}) {
  const next = { ...payload };
  delete next.id;
  delete next.ownerId;
  if (next.attachments) next.attachments = stripAttachmentData(next.attachments);
  const text = JSON.stringify(next);
  if (Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new ReminderError(413, 'REMINDER_TOO_LARGE', '这条待办的附加内容过大，请减少附件后重试。');
  }
  return text;
}

function toRow(record) {
  return {
    id: record.id,
    title: record.title,
    type: record.type ?? '',
    importance: record.importance ?? 'medium',
    deadline: record.deadline ?? null,
    remindAt: record.remindAt ?? null,
    remindLeadMinutes: record.remindLeadMinutes ?? 30,
    recurrence: record.recurrence ?? null,
    completed: record.completed ? 1 : 0,
    createdAt: record.createdAt ?? nowIso(),
    updatedAt: record.updatedAt ?? nowIso(),
    deletedAt: record.deletedAt ?? null,
  };
}

/** 列 + payload 合并回前端认识的形状。列优先，避免 payload 里的旧值盖掉新值。 */
function fromRow(row) {
  let extra = {};
  try {
    extra = JSON.parse(row.payload || '{}');
  } catch {
    extra = {};
  }
  return {
    ...extra,
    id: row.id,
    title: row.title,
    type: row.type,
    importance: row.importance,
    deadline: row.deadline ?? '',
    remindAt: row.remind_at ?? '',
    remindLeadMinutes: row.remind_lead_minutes,
    recurrence: row.recurrence ?? undefined,
    completed: Boolean(row.completed),
    createdAt: extra.createdAt ?? (Date.parse(row.created_at) || Date.now()),
    updatedAt: row.updated_at,
  };
}

function assertId(id) {
  const text = String(id ?? '').trim();
  if (!text || text.length > 120) {
    throw new ReminderError(400, 'INVALID_REMINDER', '待办 id 无效。');
  }
  return text;
}

function assertTitle(title) {
  const text = String(title ?? '').trim();
  if (!text) throw new ReminderError(400, 'INVALID_REMINDER', '请填写待办标题。');
  if (text.length > MAX_TITLE_CHARS) {
    throw new ReminderError(400, 'INVALID_REMINDER', `待办标题不能超过 ${MAX_TITLE_CHARS} 字。`);
  }
  return text;
}

/** 空的 deadline 在前端是空串，在这里统一变成 NULL，否则排序会把它顶到最前面。 */
function normalizeDeadline(value) {
  return normalizeIso(value, '截止时间');
}

function normalizeLeadMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return 30;
  return Math.min(Math.trunc(minutes), 60 * 24 * 60);
}

export function listReminders(db, ownerId, status = 'open') {
  const allowed = status === 'done' ? 1 : status === 'all' ? null : 0;
  // deadline 为 NULL 的排最后：未定时间的待办不该顶在最前面冒充「最紧急」。
  const order = 'ORDER BY (deadline IS NULL), deadline ASC, created_at DESC';
  const rows = allowed === null
    ? db.prepare(`SELECT * FROM reminders WHERE owner_id = ? AND deleted_at IS NULL ${order}`).all(ownerId)
    : db.prepare(`SELECT * FROM reminders WHERE owner_id = ? AND deleted_at IS NULL AND completed = ? ${order}`).all(ownerId, allowed);
  return rows.map(fromRow);
}

export function countReminders(db, ownerId) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM reminders WHERE owner_id = ? AND deleted_at IS NULL').get(ownerId);
  return Number(row?.total ?? 0);
}

export function getReminder(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(assertId(id));
  if (!row || row.deleted_at) return null;
  if (row.owner_id !== ownerId) return null;
  return fromRow(row);
}

/**
 * 新建或整条覆盖。带前端 id 时幂等：同一条待办重复提交不会产生第二行。
 * 已经软删过的 id 再提交时视为「恢复」，把墓碑清掉。
 */
export function upsertReminder(db, ownerId, input) {
  const id = assertId(input?.id);
  const title = assertTitle(input?.title);
  const existing = db.prepare('SELECT owner_id FROM reminders WHERE id = ?').get(id);
  if (existing && existing.owner_id !== ownerId) {
    throw new ReminderError(409, 'REMINDER_CONFLICT', '该待办 id 已被占用，请重新创建。');
  }
  const now = nowIso();
  const row = toRow({
    id,
    title,
    type: input.type,
    importance: input.importance,
    deadline: normalizeDeadline(input.deadline),
    remindAt: normalizeIso(input.remindAt, '提醒时间'),
    remindLeadMinutes: normalizeLeadMinutes(input.remindLeadMinutes),
    recurrence: input.recurrence ? String(input.recurrence).slice(0, 200) : null,
    completed: Boolean(input.completed),
    createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : now,
    updatedAt: now,
    deletedAt: null,
  });
  const payload = sanitizePayload(input);

  if (existing) {
    // 不覆盖 created_at，保留第一次创建的时间。
    db.prepare(`UPDATE reminders SET title = ?, type = ?, importance = ?, deadline = ?, remind_at = ?,
      remind_lead_minutes = ?, recurrence = ?, completed = ?, payload = ?, updated_at = ?, deleted_at = NULL
      WHERE id = ? AND owner_id = ?`).run(
      row.title, row.type, row.importance, row.deadline, row.remindAt,
      row.remindLeadMinutes, row.recurrence, row.completed, payload, row.updatedAt, id, ownerId,
    );
  } else {
    db.prepare(`INSERT INTO reminders (id, owner_id, title, type, importance, deadline, remind_at,
      remind_lead_minutes, recurrence, completed, payload, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
      row.id, ownerId, row.title, row.type, row.importance, row.deadline, row.remindAt,
      row.remindLeadMinutes, row.recurrence, row.completed, payload, row.createdAt, row.updatedAt,
    );
  }
  return getReminder(db, ownerId, id);
}

export function patchReminder(db, ownerId, id, patch = {}) {
  const current = getReminder(db, ownerId, id);
  if (!current) throw new ReminderError(404, 'REMINDER_NOT_FOUND', '待办不存在或已删除。');
  const merged = { ...current, ...patch, id: current.id };
  return upsertReminder(db, ownerId, merged);
}

/** 软删：留下墓碑，同步时让其他端把本地那份也删掉。 */
export function deleteReminder(db, ownerId, id) {
  const text = assertId(id);
  const existing = db.prepare('SELECT owner_id FROM reminders WHERE id = ?').get(text);
  if (!existing || existing.owner_id !== ownerId) {
    throw new ReminderError(404, 'REMINDER_NOT_FOUND', '待办不存在或已删除。');
  }
  const now = nowIso();
  db.prepare('UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(now, now, text, ownerId);
  return { id: text, deletedAt: now };
}

/**
 * 一次性迁移：把浏览器里的旧待办搬进账号。
 *
 * 两个必须做的过滤：
 * 1. `mock-` 开头的示例数据不能进库——新装用户打开就有两条演示待办，照单全收等于
 *    往账号里塞假数据；
 * 2. 已存在的 id 跳过，重复点导入不产生重复数据。
 */
export function importLocalReminders(db, ownerId, items) {
  if (!Array.isArray(items)) {
    throw new ReminderError(400, 'INVALID_REMINDER', '导入内容必须是待办数组。');
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    throw new ReminderError(413, 'IMPORT_TOO_LARGE', `一次最多导入 ${MAX_IMPORT_ITEMS} 条待办。`);
  }
  const existing = new Set(
    db.prepare('SELECT id FROM reminders WHERE owner_id = ?').all(ownerId).map((row) => row.id),
  );
  let imported = 0;
  let skippedMock = 0;
  let skippedDuplicate = 0;
  const failed = [];

  for (const item of items) {
    const id = String(item?.id ?? '');
    if (id.startsWith('mock-')) {
      skippedMock += 1;
      continue;
    }
    if (existing.has(id)) {
      skippedDuplicate += 1;
      continue;
    }
    try {
      upsertReminder(db, ownerId, item);
      existing.add(id);
      imported += 1;
    } catch (error) {
      failed.push({ id, message: error.message });
    }
  }
  return { imported, skippedMock, skippedDuplicate, failed };
}

/** 导出用：不设上限，但要排除墓碑。 */
export function listForExport(db, ownerId, status = 'open') {
  return listReminders(db, ownerId, status);
}
