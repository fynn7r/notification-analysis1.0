/**
 * 账号与知识库接口客户端。
 * 会话凭证在 HttpOnly cookie 里，前端只持有 CSRF 令牌。
 */
export type Role = 'admin' | 'user';
export type Scope = 'personal' | 'application';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface KnowledgeEntry {
  id: string;
  scope: Scope;
  title: string;
  category: string;
  body: string;
  sourceName: string;
  sourceKind: string;
  sourceMeta: Record<string, unknown>;
  demo: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  ordinal: number;
  locationLabel: string;
  text: string;
  charStart: number;
  charEnd: number;
}

export interface KnowledgeCitation {
  chunkId: string;
  entryId: string;
  scope: Scope;
  title: string;
  version: number;
  locationLabel: string;
  excerpt: string;
}

let csrfToken = '';

export function setCsrfToken(value: string | null) {
  csrfToken = value ?? '';
}

export class ApiFailure extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiFailure(0, 'NETWORK_ERROR', '无法连接服务，请确认本地服务正在运行。');
  }
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* 空响应 */ }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiFailure(response.status, error?.code ?? 'UNKNOWN', error?.message ?? '请求失败，请重试。');
  }
  return payload as T;
}

/** 供其他资源模块复用：自动带 CSRF、统一错误形状。 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init);
}

export async function fetchSession() {
  return request<{ authenticated: boolean; user: SessionUser | null; hasUsers: boolean; csrfToken: string | null }>(
    '/api/auth/session',
  );
}

export async function loginAccount(username: string, password: string) {
  const result = await request<{ user: SessionUser; csrfToken: string }>('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  });
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function registerAccount(input: { code: string; username: string; displayName: string; password: string }) {
  const result = await request<{ user: SessionUser; csrfToken: string }>('/api/auth/register', {
    method: 'POST', body: JSON.stringify(input),
  });
  setCsrfToken(result.csrfToken);
  return result.user;
}

export async function logoutAccount() {
  try { await request('/api/auth/logout', { method: 'POST', body: '{}' }); }
  finally { setCsrfToken(null); }
}

export async function listEntries(scope: Scope) {
  return request<{ scope: Scope; canWrite: boolean; entries: KnowledgeEntry[] }>(
    `/api/knowledge/entries?scope=${scope}`,
  );
}

export async function getEntry(id: string) {
  return request<{ entry: KnowledgeEntry & { chunks: KnowledgeChunk[] } }>(`/api/knowledge/entries/${id}`);
}

export async function createEntry(input: {
  scope: Scope; title: string; category: string; body: string;
  sourceName?: string; sourceKind?: string; sourceMeta?: Record<string, unknown>; demo?: boolean;
}) {
  return request<{ entry: KnowledgeEntry }>('/api/knowledge/entries', { method: 'POST', body: JSON.stringify(input) });
}

export async function patchEntry(id: string, input: Partial<{
  title: string; category: string; body: string; sourceName: string; sourceKind: string;
}>) {
  return request<{ entry: KnowledgeEntry }>(`/api/knowledge/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteEntry(id: string) {
  return request<{ ok: boolean }>(`/api/knowledge/entries/${id}`, { method: 'DELETE' });
}

export async function importLegacy(items: { legacyKey: string; title: string; category: string; body: string }[]) {
  return request<{ imported: { legacyKey: string; entryId: string; reused: boolean }[] }>(
    '/api/knowledge/import-legacy', { method: 'POST', body: JSON.stringify({ items }) },
  );
}

export async function previewKnowledge(query: string, entryIds?: string[] | null) {
  return request<{
    ok: boolean; empty: boolean; noMatch: boolean;
    segments: unknown[]; charCount: number; note: string;
    citations: KnowledgeCitation[];
  }>('/api/knowledge/preview', {
    method: 'POST', body: JSON.stringify({ query, entryIds: entryIds ?? null }),
  });
}

export async function createInvite() {
  return request<{ code: string; role: Role; expiresAt: string }>('/api/auth/invites', { method: 'POST', body: '{}' });
}

export async function listInvites() {
  return request<{ invites: { id: number; role: Role; created_at: string; expires_at: string; consumed_at: string | null }[] }>(
    '/api/auth/invites',
  );
}
