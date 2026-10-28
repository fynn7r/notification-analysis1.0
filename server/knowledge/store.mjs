/**
 * 知识条目读写。所有查询都要求调用方已确认 scope/owner 授权。
 * 索引与条目在同一事务内更新，避免出现"有正文没索引"或反过来的状态。
 */
import { randomUUID } from 'node:crypto';
import { nowIso } from './db.mjs';
import { chunkEntry, toSearchTokens, plainText } from './chunker.mjs';

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    ownerId: row.owner_id,
    title: row.title,
    category: row.category,
    body: row.body,
    sourceName: row.source_name,
    sourceKind: row.source_kind,
    sourceMeta: safeJson(row.source_meta),
    demo: Boolean(row.demo),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function writeChunks(db, entry) {
  db.prepare('DELETE FROM knowledge_fts WHERE entry_id = ?').run(entry.id);
  db.prepare('DELETE FROM knowledge_chunks WHERE entry_id = ?').run(entry.id);
  const chunks = chunkEntry({ body: entry.body });
  const insertChunk = db.prepare(`INSERT INTO knowledge_chunks
    (id, entry_id, ordinal, location_label, text, char_start, char_end) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertFts = db.prepare('INSERT INTO knowledge_fts (chunk_id, entry_id, tokens) VALUES (?, ?, ?)');
  for (const chunk of chunks) {
    const id = randomUUID();
    insertChunk.run(id, entry.id, chunk.ordinal, chunk.locationLabel, chunk.text, chunk.charStart, chunk.charEnd);
    insertFts.run(id, entry.id, toSearchTokens(`${entry.title} ${entry.category} ${chunk.text}`));
  }
  return chunks.length;
}

export function createEntry(db, input) {
  const id = randomUUID();
  const timestamp = nowIso();
  const body = plainText(input.body);
  const entry = {
    id,
    scope: input.scope,
    ownerId: input.scope === 'personal' ? input.ownerId : null,
    title: String(input.title ?? '').trim() || '未命名资料',
    category: String(input.category ?? '').trim(),
    body,
    sourceName: String(input.sourceName ?? '').trim(),
    sourceKind: input.sourceKind ?? 'text',
    sourceMeta: input.sourceMeta ?? {},
    demo: input.demo ? 1 : 0,
    version: 1,
    createdBy: input.createdBy ?? null,
  };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO knowledge_entries
      (id, scope, owner_id, title, category, body, source_name, source_kind, source_meta, demo, version, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      entry.id, entry.scope, entry.ownerId, entry.title, entry.category, entry.body,
      entry.sourceName, entry.sourceKind, JSON.stringify(entry.sourceMeta), entry.demo,
      entry.version, entry.createdBy, timestamp, timestamp,
    );
    writeChunks(db, entry);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getEntry(db, id);
}

export function updateEntry(db, id, input) {
  const current = db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id);
  if (!current) return null;
  const body = input.body === undefined ? current.body : plainText(input.body);
  const next = {
    id,
    scope: current.scope,
    ownerId: current.owner_id,
    title: input.title === undefined ? current.title : (String(input.title).trim() || '未命名资料'),
    category: input.category === undefined ? current.category : String(input.category).trim(),
    body,
    sourceName: input.sourceName === undefined ? current.source_name : String(input.sourceName).trim(),
    sourceKind: input.sourceKind === undefined ? current.source_kind : input.sourceKind,
    sourceMeta: input.sourceMeta === undefined ? safeJson(current.source_meta) : input.sourceMeta,
  };
  const version = current.version + 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`UPDATE knowledge_entries SET title = ?, category = ?, body = ?, source_name = ?,
      source_kind = ?, source_meta = ?, version = ?, updated_at = ? WHERE id = ?`).run(
      next.title, next.category, next.body, next.sourceName,
      next.sourceKind, JSON.stringify(next.sourceMeta), version, nowIso(), id,
    );
    writeChunks(db, next);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getEntry(db, id);
}

export function deleteEntry(db, id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM knowledge_fts WHERE entry_id = ?').run(id);
    const info = db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
    db.exec('COMMIT');
    return Number(info.changes) > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getEntry(db, id) {
  return rowToEntry(db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id));
}

export function listEntries(db, { scope, ownerId = null }) {
  const rows = scope === 'application'
    ? db.prepare(`SELECT * FROM knowledge_entries WHERE scope = 'application' ORDER BY updated_at DESC`).all()
    : db.prepare(`SELECT * FROM knowledge_entries WHERE scope = 'personal' AND owner_id = ? ORDER BY updated_at DESC`).all(ownerId);
  return rows.map(rowToEntry);
}

export function listChunks(db, entryId) {
  return db.prepare(`SELECT id, ordinal, location_label, text, char_start, char_end
    FROM knowledge_chunks WHERE entry_id = ? ORDER BY ordinal`).all(entryId).map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    locationLabel: row.location_label,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
  }));
}

export function countEntries(db, { scope, ownerId = null }) {
  return scope === 'application'
    ? db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE scope = 'application'`).get().n
    : db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE scope = 'personal' AND owner_id = ?`).get(ownerId).n;
}

export function recordLegacyImport(db, { userId, legacyKey, entryId }) {
  const id = `${userId}:${legacyKey}`;
  const existing = db.prepare('SELECT * FROM legacy_imports WHERE id = ?').get(id);
  if (existing) return existing.entry_id;
  db.prepare('INSERT INTO legacy_imports (id, user_id, entry_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, entryId, nowIso());
  return entryId;
}

export function findLegacyImport(db, { userId, legacyKey }) {
  return db.prepare('SELECT entry_id FROM legacy_imports WHERE id = ?').get(`${userId}:${legacyKey}`)?.entry_id ?? null;
}
