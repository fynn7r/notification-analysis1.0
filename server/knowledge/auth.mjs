/**
 * 密码、会话、邀请码与限流。
 * 口令只在服务端校验，浏览器只持有不透明的会话令牌。
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { nowIso, isoAfter } from './db.mjs';

const scrypt = promisify(scryptCb);

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export class KnowledgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validatePassword(password) {
  if (typeof password !== 'string') throw new KnowledgeError(400, 'INVALID_PASSWORD', '密码格式无效。');
  if (password.length < PASSWORD_MIN) throw new KnowledgeError(400, 'PASSWORD_TOO_SHORT', `密码至少 ${PASSWORD_MIN} 位。`);
  if (password.length > PASSWORD_MAX) throw new KnowledgeError(400, 'PASSWORD_TOO_LONG', `密码最多 ${PASSWORD_MAX} 位。`);
  return password;
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { hash: Buffer.from(derived).toString('hex'), salt };
}

export async function verifyPassword(password, hash, salt) {
  if (typeof password !== 'string' || !hash || !salt) return false;
  const expected = Buffer.from(hash, 'hex');
  const derived = Buffer.from(await scrypt(password, salt, expected.length, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  }));
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function normalizeUsername(username) {
  const value = String(username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(value)) {
    throw new KnowledgeError(400, 'INVALID_USERNAME', '账号需 3–32 位，仅限小写字母、数字、下划线和连字符。');
  }
  return value;
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function findUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(normalizeUsername(username)) ?? null;
}

/** 首位管理员：仅允许在 users 为空时创建，必须由本机脚本触发。 */
export async function createFirstAdmin(db, { username, displayName, password }) {
  if (countUsers(db) > 0) throw new KnowledgeError(409, 'ADMIN_EXISTS', '管理员已存在，请使用邀请注册。');
  const { hash, salt } = await hashPassword(password);
  const name = normalizeUsername(username);
  const display = String(displayName ?? '').trim() || name;
  const info = db.prepare(`INSERT INTO users (username, display_name, role, password_hash, password_salt, created_at)
    VALUES (?, ?, 'admin', ?, ?, ?)`).run(name, display, hash, salt, nowIso());
  return findUserById(db, Number(info.lastInsertRowid));
}

export function createInvite(db, { createdBy, role = 'user', ttlMs = INVITE_TTL_MS }) {
  if (role !== 'user' && role !== 'admin') throw new KnowledgeError(400, 'INVALID_ROLE', '邀请角色无效。');
  const code = randomBytes(12).toString('base64url');
  db.prepare(`INSERT INTO invites (code_hash, created_by, role, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(sha256(code), createdBy, role, isoAfter(ttlMs), nowIso());
  return { code, role, expiresAt: isoAfter(ttlMs) };
}

export function listInvites(db) {
  return db.prepare(`SELECT id, role, created_at, expires_at, consumed_at FROM invites ORDER BY id DESC LIMIT 50`).all();
}

/**
 * 消费邀请并建号：同一事务，条件更新保证只能成功一次。
 * 并发下第二个请求 changes = 0 → 拒绝。
 */
export async function consumeInvite(db, { code, username, displayName, password }) {
  const codeHash = sha256(String(code ?? '').trim());
  const row = db.prepare('SELECT * FROM invites WHERE code_hash = ?').get(codeHash);
  if (!row) throw new KnowledgeError(400, 'INVALID_INVITE', '邀请码无效。');
  if (row.consumed_at) throw new KnowledgeError(409, 'INVITE_USED', '邀请码已被使用。');
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new KnowledgeError(410, 'INVITE_EXPIRED', '邀请码已过期，请向管理员重新申请。');

  const { hash, salt } = await hashPassword(password);
  const name = normalizeUsername(username);
  const display = String(displayName ?? '').trim() || name;

  db.exec('BEGIN IMMEDIATE');
  try {
    const claimed = db.prepare(`UPDATE invites SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
      .run(nowIso(), row.id);
    if (Number(claimed.changes) !== 1) throw new KnowledgeError(409, 'INVITE_USED', '邀请码已被使用。');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
      throw new KnowledgeError(409, 'USERNAME_TAKEN', '该账号已被占用。');
    }
    const info = db.prepare(`INSERT INTO users (username, display_name, role, password_hash, password_salt, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(name, display, row.role, hash, salt, nowIso());
    const userId = Number(info.lastInsertRowid);
    db.prepare('UPDATE invites SET consumed_by = ? WHERE id = ?').run(userId, row.id);
    db.exec('COMMIT');
    return findUserById(db, userId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function login(db, { username, password }) {
  const user = findUserByUsername(db, username);
  // 用户不存在时也走一次哈希，避免用响应时间枚举账号。
  const ok = user
    ? await verifyPassword(password, user.password_hash, user.password_salt)
    : await verifyPassword(String(password ?? ''), '00'.repeat(64), '00'.repeat(16));
  if (!user || !ok) throw new KnowledgeError(401, 'INVALID_CREDENTIALS', '账号或密码不正确。');
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  return user;
}

export function createSession(db, userId, { ttlMs = SESSION_TTL_MS } = {}) {
  const token = randomBytes(32).toString('base64url');
  const csrfSecret = randomBytes(24).toString('base64url');
  const expiresAt = isoAfter(ttlMs);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_secret, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(sha256(token), userId, csrfSecret, nowIso(), expiresAt);
  return { token, csrfSecret, expiresAt };
}

/** 每次请求都查库：退出即撤销，不能靠前端状态。 */
export function resolveSession(db, token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  const user = findUserById(db, row.user_id);
  if (!user) return null;
  return { user, session: row };
}

export function revokeSession(db, token) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(nowIso(), sha256(token));
}

export function revokeAllSessions(db, userId) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
}

/** 固定窗口内存限流：登录/注册防爆破，单进程足够。 */
export function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const buckets = new Map();
  return {
    hit(key) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.start >= windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return { allowed: true, retryAfterMs: 0 };
      }
      bucket.count += 1;
      if (bucket.count > max) return { allowed: false, retryAfterMs: windowMs - (now - bucket.start) };
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key) { buckets.delete(key); },
  };
}

export function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
}
