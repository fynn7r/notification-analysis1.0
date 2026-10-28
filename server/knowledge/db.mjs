/**
 * 知识库数据层：SQLite 建表与连接管理。
 * 业务文件放在非公开目录（默认 .local/knowledge），测试传独立临时目录。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const SCHEMA_VERSION = 1;

export function nowIso() {
  return new Date().toISOString();
}

export function isoAfter(ms) {
  return new Date(Date.now() + ms).toISOString();
}

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal','application')),
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT 'text',
  source_meta TEXT NOT NULL DEFAULT '{}',
  demo INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope = 'personal' AND owner_id IS NOT NULL) OR (scope = 'application' AND owner_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_entries_scope_owner ON knowledge_entries(scope, owner_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  location_label TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  char_start INTEGER NOT NULL DEFAULT 0,
  char_end INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chunks_entry ON knowledge_chunks(entry_id, ordinal);

CREATE TABLE IF NOT EXISTS legacy_imports (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

/**
 * 打开知识库。FTS5 表单独创建：部分构建可能不支持，届时检索降级为 LIKE。
 * @param {{dir: string}} options
 */
export function openKnowledgeDb({ dir }) {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(resolve(root, 'knowledge.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(DDL);

  let ftsEnabled = true;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      chunk_id UNINDEXED, entry_id UNINDEXED, tokens
    )`);
  } catch {
    ftsEnabled = false;
  }

  const current = db.prepare('SELECT v FROM settings WHERE k = ?').get('schema_version');
  if (!current) {
    db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }

  return {
    db,
    dir: root,
    ftsEnabled,
    close() {
      try { db.close(); } catch { /* 已关闭 */ }
    },
  };
}
