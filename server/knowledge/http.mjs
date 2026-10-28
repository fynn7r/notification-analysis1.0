/**
 * 账号与知识库 HTTP 接口。
 * 身份只来自服务端会话；body / query / header 里的 userId、role、scope 一律不采信。
 */
import { KnowledgeError, publicUser, createSession, resolveSession, revokeSession, login, consumeInvite, createInvite, listInvites, createRateLimiter, countUsers } from './auth.mjs';
import { createEntry, updateEntry, deleteEntry, getEntry, listEntries, listChunks, countEntries, recordLegacyImport, findLegacyImport } from './store.mjs';
import { retrieveContext, buildKnowledgeContext, publicCitations } from './search.mjs';

const SESSION_COOKIE = 'nk_sid';
const CSRF_COOKIE = 'nk_csrf';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_BODY_CHARS = 200000;

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function cookie(name, value, { httpOnly = true, secure = false, maxAge = null } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function sendJson(response, status, value, cookies = []) {
  if (cookies.length) response.setHeader('Set-Cookie', cookies);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new KnowledgeError(413, 'REQUEST_TOO_LARGE', '请求内容过大。');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new KnowledgeError(400, 'INVALID_JSON', '提交的内容不是合法 JSON。'); }
}

function requireText(value, field, { max = 400, min = 1 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min) throw new KnowledgeError(400, 'INVALID_FIELD', `${field}不能为空。`);
  if (text.length > max) throw new KnowledgeError(400, 'INVALID_FIELD', `${field}最多 ${max} 字。`);
  return text;
}

function normalizeScope(raw, user) {
  const scope = raw === 'application' ? 'application' : 'personal';
  return scope;
}

/**
 * @param {{store: {db: any, ftsEnabled: boolean}, secureCookies?: boolean, sessionTtlMs?: number}} options
 */
export function createKnowledgeRouter({ store, secureCookies = false, sessionTtlMs }) {
  const { db, ftsEnabled } = store;
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });
  const registerLimiter = createRateLimiter({ windowMs: 60_000, max: 8 });

  /** 远程入口必须 HTTPS；本机回环允许 HTTP。 */
  const secureFor = (request) => secureCookies
    || Boolean(request.socket?.encrypted)
    || request.headers['x-forwarded-proto'] === 'https';

  function currentSession(request) {
    const cookies = parseCookies(request.headers.cookie);
    const resolved = resolveSession(db, cookies[SESSION_COOKIE]);
    return { cookies, resolved };
  }

  function requireUser(request) {
    const { cookies, resolved } = currentSession(request);
    if (!resolved) throw new KnowledgeError(401, 'UNAUTHENTICATED', '请先登录。');
    return { user: resolved.user, session: resolved.session, cookies };
  }

  function requireCsrf(request, session) {
    const { cookies } = currentSession(request);
    const header = String(request.headers['x-csrf-token'] ?? '');
    const cookieValue = cookies[CSRF_COOKIE] ?? '';
    if (!header || header !== session.csrf_secret || cookieValue !== session.csrf_secret) {
      throw new KnowledgeError(403, 'INVALID_CSRF', '请求校验失败，请刷新页面后重试。');
    }
    const origin = request.headers.origin;
    if (origin) {
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      try {
        if (new URL(origin).host !== host) throw new KnowledgeError(403, 'CROSS_ORIGIN', '不接受跨站请求。');
      } catch (error) {
        if (error instanceof KnowledgeError) throw error;
        throw new KnowledgeError(403, 'CROSS_ORIGIN', '不接受跨站请求。');
      }
    }
  }

  function loadAuthorizedEntry(user, id, { write = false } = {}) {
    const entry = getEntry(db, id);
    // 无权访问与不存在返回同一种结果，避免探测他人条目。
    if (!entry) throw new KnowledgeError(404, 'ENTRY_NOT_FOUND', '资料不存在。');
    if (entry.scope === 'application') {
      if (write && user.role !== 'admin') throw new KnowledgeError(403, 'FORBIDDEN', '只有管理员可以修改应用知识库。');
      return entry;
    }
    if (entry.ownerId !== user.id) throw new KnowledgeError(404, 'ENTRY_NOT_FOUND', '资料不存在。');
    return entry;
  }

  function publicEntry(entry, { withChunks = false } = {}) {
    const base = {
      id: entry.id, scope: entry.scope, title: entry.title, category: entry.category,
      body: entry.body, sourceName: entry.sourceName, sourceKind: entry.sourceKind,
      sourceMeta: entry.sourceMeta, demo: entry.demo, version: entry.version,
      updatedAt: entry.updatedAt, createdAt: entry.createdAt,
    };
    if (withChunks) base.chunks = listChunks(db, entry.id);
    return base;
  }

  async function route(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    const method = request.method;

    // ── 会话 ──────────────────────────────────────────────
    if (pathname === '/api/auth/session' && method === 'GET') {
      const { resolved } = currentSession(request);
      sendJson(response, 200, {
        authenticated: Boolean(resolved),
        user: resolved ? publicUser(resolved.user) : null,
        hasUsers: countUsers(db) > 0,
        csrfToken: resolved ? resolved.session.csrf_secret : null,
      });
      return true;
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const ip = request.socket?.remoteAddress ?? 'unknown';
      const limit = loginLimiter.hit(`login:${ip}`);
      if (!limit.allowed) throw new KnowledgeError(429, 'TOO_MANY_ATTEMPTS', '尝试过于频繁，请稍后再试。');
      const body = await readJson(request);
      const user = await login(db, { username: body.username, password: body.password });
      loginLimiter.reset(`login:${ip}`);
      const session = createSession(db, user.id, sessionTtlMs ? { ttlMs: sessionTtlMs } : {});
      sendJson(response, 200, { user: publicUser(user), csrfToken: session.csrfSecret }, [
        cookie(SESSION_COOKIE, session.token, { secure: secureFor(request) }),
        cookie(CSRF_COOKIE, session.csrfSecret, { httpOnly: false, secure: secureFor(request) }),
      ]);
      return true;
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const { cookies, resolved } = currentSession(request);
      if (resolved) {
        requireCsrf(request, resolved.session);
        revokeSession(db, cookies[SESSION_COOKIE]);
      }
      sendJson(response, 200, { ok: true }, [
        cookie(SESSION_COOKIE, '', { maxAge: 0, secure: secureFor(request) }),
        cookie(CSRF_COOKIE, '', { httpOnly: false, maxAge: 0, secure: secureFor(request) }),
      ]);
      return true;
    }

    if (pathname === '/api/auth/register' && method === 'POST') {
      const ip = request.socket?.remoteAddress ?? 'unknown';
      const limit = registerLimiter.hit(`register:${ip}`);
      if (!limit.allowed) throw new KnowledgeError(429, 'TOO_MANY_ATTEMPTS', '尝试过于频繁，请稍后再试。');
      const body = await readJson(request);
      const user = await consumeInvite(db, {
        code: body.code, username: body.username, displayName: body.displayName, password: body.password,
      });
      registerLimiter.reset(`register:${ip}`);
      const session = createSession(db, user.id, sessionTtlMs ? { ttlMs: sessionTtlMs } : {});
      sendJson(response, 201, { user: publicUser(user), csrfToken: session.csrfSecret }, [
        cookie(SESSION_COOKIE, session.token, { secure: secureFor(request) }),
        cookie(CSRF_COOKIE, session.csrfSecret, { httpOnly: false, secure: secureFor(request) }),
      ]);
      return true;
    }

    // ── 邀请（管理员） ─────────────────────────────────────
    if (pathname === '/api/auth/invites' && (method === 'GET' || method === 'POST')) {
      const { user, session } = requireUser(request);
      if (user.role !== 'admin') throw new KnowledgeError(403, 'FORBIDDEN', '只有管理员可以管理邀请码。');
      if (method === 'GET') {
        sendJson(response, 200, { invites: listInvites(db) });
        return true;
      }
      requireCsrf(request, session);
      const body = await readJson(request);
      const invite = createInvite(db, { createdBy: user.id, role: body.role === 'admin' ? 'admin' : 'user' });
      sendJson(response, 201, invite);
      return true;
    }

    // ── 知识条目 ─────────────────────────────────────────
    if (pathname === '/api/knowledge/entries' && method === 'GET') {
      const { user } = requireUser(request);
      const scope = normalizeScope(url.searchParams.get('scope'), user);
      sendJson(response, 200, {
        scope,
        canWrite: scope === 'personal' || user.role === 'admin',
        entries: listEntries(db, { scope, ownerId: user.id }).map((entry) => publicEntry(entry)),
      });
      return true;
    }

    if (pathname === '/api/knowledge/entries' && method === 'POST') {
      const { user, session } = requireUser(request);
      requireCsrf(request, session);
      const body = await readJson(request);
      const scope = normalizeScope(body.scope, user);
      if (scope === 'application' && user.role !== 'admin') {
        throw new KnowledgeError(403, 'FORBIDDEN', '只有管理员可以写入应用知识库。');
      }
      const text = requireText(body.body, '资料正文', { max: MAX_BODY_CHARS });
      const entry = createEntry(db, {
        scope,
        ownerId: user.id,
        title: requireText(body.title, '标题', { max: 200 }),
        category: String(body.category ?? '').slice(0, 60),
        body: text,
        sourceName: String(body.sourceName ?? '').slice(0, 200),
        sourceKind: ['text', 'txt', 'doc', 'docx', 'pdf', 'legacy'].includes(body.sourceKind) ? body.sourceKind : 'text',
        sourceMeta: sanitizeMeta(body.sourceMeta),
        demo: Boolean(body.demo),
        createdBy: user.id,
      });
      sendJson(response, 201, { entry: publicEntry(entry, { withChunks: true }) });
      return true;
    }

    const entryMatch = pathname.match(/^\/api\/knowledge\/entries\/([A-Za-z0-9-]+)$/);
    if (entryMatch) {
      const { user, session } = requireUser(request);
      const id = entryMatch[1];
      if (method === 'GET') {
        const entry = loadAuthorizedEntry(user, id);
        sendJson(response, 200, { entry: publicEntry(entry, { withChunks: true }) });
        return true;
      }
      if (method === 'PATCH') {
        requireCsrf(request, session);
        const entry = loadAuthorizedEntry(user, id, { write: true });
        const body = await readJson(request);
        if (body.body !== undefined && String(body.body).length > MAX_BODY_CHARS) {
          throw new KnowledgeError(413, 'DOCUMENT_TEXT_TOO_LARGE', '资料正文最多 20 万字。');
        }
        const updated = updateEntry(db, entry.id, {
          title: body.title,
          category: body.category,
          body: body.body,
          sourceName: body.sourceName,
          sourceKind: body.sourceKind,
          sourceMeta: body.sourceMeta === undefined ? undefined : sanitizeMeta(body.sourceMeta),
        });
        sendJson(response, 200, { entry: publicEntry(updated, { withChunks: true }) });
        return true;
      }
      if (method === 'DELETE') {
        requireCsrf(request, session);
        const entry = loadAuthorizedEntry(user, id, { write: true });
        deleteEntry(db, entry.id);
        sendJson(response, 200, { ok: true });
        return true;
      }
    }

    // ── 旧规则导入（幂等） ────────────────────────────────
    if (pathname === '/api/knowledge/import-legacy' && method === 'POST') {
      const { user, session } = requireUser(request);
      requireCsrf(request, session);
      const body = await readJson(request);
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const created = [];
      for (const item of items) {
        const legacyKey = String(item?.legacyKey ?? '').slice(0, 200);
        if (!legacyKey) continue;
        const existing = findLegacyImport(db, { userId: user.id, legacyKey });
        if (existing) { created.push({ legacyKey, entryId: existing, reused: true }); continue; }
        const text = String(item?.body ?? '').trim();
        if (!text) continue;
        const entry = createEntry(db, {
          scope: 'personal',
          ownerId: user.id,
          title: String(item.title ?? '').trim() || '导入的旧规则',
          category: String(item.category ?? '').slice(0, 60),
          body: text.slice(0, MAX_BODY_CHARS),
          sourceKind: 'legacy',
          sourceMeta: { legacyKey },
          demo: true,
          createdBy: user.id,
        });
        recordLegacyImport(db, { userId: user.id, legacyKey, entryId: entry.id });
        created.push({ legacyKey, entryId: entry.id, reused: false });
      }
      sendJson(response, 200, { imported: created });
      return true;
    }

    // ── 预览检索（手动选资料 / 核对范围） ─────────────────
    if (pathname === '/api/knowledge/preview' && method === 'POST') {
      const { user, session } = requireUser(request);
      requireCsrf(request, session);
      const body = await readJson(request);
      const result = retrieveContext({ db, ftsEnabled }, {
        userId: user.id,
        query: String(body.query ?? '').slice(0, 4000),
        selectedEntryIds: Array.isArray(body.entryIds) ? body.entryIds.map(String).slice(0, 50) : null,
      });
      sendJson(response, 200, {
        ...result,
        citations: publicCitations(result.segments),
        context: buildKnowledgeContext(result.segments),
      });
      return true;
    }

    if (pathname === '/api/knowledge/stats' && method === 'GET') {
      const { user } = requireUser(request);
      sendJson(response, 200, {
        personal: countEntries(db, { scope: 'personal', ownerId: user.id }),
        application: countEntries(db, { scope: 'application' }),
        role: user.role,
      });
      return true;
    }

    return false;
  }

  return {
    /** @returns {Promise<boolean>} 是否已处理该请求 */
    async handle(request, response) {
      try {
        const handled = await route(request, response);
        if (!handled) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
        return true;
      } catch (error) {
        if (error instanceof KnowledgeError) {
          sendJson(response, error.status, { error: { code: error.code, message: error.message } });
          return true;
        }
        console.error('[knowledge] 未预期错误：', error?.message);
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请重试。' } });
        return true;
      }
    },
    db,
  };
}

/** 供解析/解读入口取当前登录用户，读不到就返回 null（匿名用法保持不变）。 */
export function getSessionUser(db, request) {
  const cookies = parseCookies(request.headers?.cookie);
  return resolveSession(db, cookies[SESSION_COOKIE])?.user ?? null;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  if (typeof meta.pages === 'number') out.pages = meta.pages;
  if (typeof meta.legacyKey === 'string') out.legacyKey = meta.legacyKey.slice(0, 200);
  if (typeof meta.importedFrom === 'string') out.importedFrom = meta.importedFrom.slice(0, 200);
  return out;
}
