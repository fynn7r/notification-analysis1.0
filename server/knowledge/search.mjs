/**
 * 授权检索：先按"当前用户个人库 + 应用库"限定语料，再检索、再组装上下文。
 * 检索失败与"确实没有资料"必须区分开，不能把系统错误伪装成空库。
 */
import { toMatchExpression } from './chunker.mjs';

export const DEFAULT_CONTEXT_BUDGET = 60000;
const PER_SCOPE_LIMIT = 12;
const MIN_TOKEN_QUERY_LENGTH = 1;

function scopeFilter(scope, userId) {
  return scope === 'application'
    ? { sql: `e.scope = 'application'`, params: [] }
    : { sql: `e.scope = 'personal' AND e.owner_id = ?`, params: [userId] };
}

function searchScope(db, { scope, userId, query, selectedEntryIds, ftsEnabled }) {
  const filter = scopeFilter(scope, userId);
  const params = [...filter.params];

  let entryClause = '';
  if (selectedEntryIds) {
    if (!selectedEntryIds.length) return [];
    entryClause = ` AND e.id IN (${selectedEntryIds.map(() => '?').join(',')})`;
    params.push(...selectedEntryIds);
  }

  const expression = toMatchExpression(query);
  if (ftsEnabled && expression.length >= MIN_TOKEN_QUERY_LENGTH) {
    try {
      const rows = db.prepare(`
        SELECT c.id AS chunk_id, c.entry_id, c.ordinal, c.location_label, c.text,
               e.title, e.category, e.version, e.updated_at, bm25(knowledge_fts) AS score
        FROM knowledge_fts f
        JOIN knowledge_chunks c ON c.id = f.chunk_id
        JOIN knowledge_entries e ON e.id = c.entry_id
        WHERE knowledge_fts MATCH ? AND ${filter.sql}${entryClause}
        ORDER BY score
        LIMIT ${PER_SCOPE_LIMIT}
      `).all(expression, ...params);
      if (rows.length) return rows.map((row) => ({ ...row, scope, matched: true }));
    } catch {
      // FTS 查询语法异常时退回 LIKE，不把检索故障暴露成"没有资料"。
    }
  }

  const likeNeedle = `%${String(query).trim().slice(0, 40).replaceAll('%', '').replaceAll('_', '')}%`;
  if (!String(query).trim()) return [];
  const rows = db.prepare(`
    SELECT c.id AS chunk_id, c.entry_id, c.ordinal, c.location_label, c.text,
           e.title, e.category, e.version, e.updated_at, 0 AS score
    FROM knowledge_chunks c
    JOIN knowledge_entries e ON e.id = c.entry_id
    WHERE ${filter.sql}${entryClause}
      AND (c.text LIKE ? OR e.title LIKE ? OR e.category LIKE ?)
    ORDER BY e.updated_at DESC
    LIMIT ${PER_SCOPE_LIMIT}
  `).all(...params, likeNeedle, likeNeedle, likeNeedle);
  return rows.map((row) => ({ ...row, scope, matched: true }));
}

/**
 * @param {{db: import('node:sqlite').DatabaseSync, ftsEnabled: boolean}} deps
 * @param {{userId: number, query?: string, budget?: number, selectedEntryIds?: string[]|null}} input
 */
export function retrieveContext(deps, input) {
  const { db, ftsEnabled } = deps;
  const { userId, query = '', budget = DEFAULT_CONTEXT_BUDGET, selectedEntryIds = null } = input;

  const personalTotal = db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE scope='personal' AND owner_id = ?`).get(userId).n;
  const applicationTotal = db.prepare(`SELECT COUNT(*) AS n FROM knowledge_entries WHERE scope='application'`).get().n;
  const empty = personalTotal + applicationTotal === 0;
  if (empty) {
    return {
      ok: true, empty: true, noMatch: false, segments: [], entries: [],
      charCount: 0, omitted: [], personalTotal, applicationTotal,
      note: '两个知识库都还没有资料，本次分析没有使用任何知识。',
    };
  }

  let personal = [];
  let application = [];
  try {
    personal = searchScope(db, { scope: 'personal', userId, query, selectedEntryIds, ftsEnabled });
    application = searchScope(db, { scope: 'application', userId, query, selectedEntryIds, ftsEnabled });
  } catch {
    return {
      ok: false, empty: false, noMatch: false, segments: [], entries: [],
      charCount: 0, omitted: [], personalTotal, applicationTotal,
      note: '知识检索暂时失败，本次没有使用知识库。这不代表你的知识库是空的。',
    };
  }

  const merged = [...personal, ...application].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const segments = [];
  const omitted = [];
  let charCount = 0;
  const seen = new Set();

  for (const row of merged) {
    if (seen.has(row.chunk_id)) continue;
    const cost = row.text.length + 80;
    if (charCount + cost > budget) {
      omitted.push({ entryId: row.entry_id, title: row.title, scope: row.scope, locationLabel: row.location_label });
      continue;
    }
    seen.add(row.chunk_id);
    charCount += cost;
    segments.push({
      chunkId: row.chunk_id,
      entryId: row.entry_id,
      scope: row.scope,
      title: row.title,
      category: row.category ?? '',
      version: row.version,
      locationLabel: row.location_label,
      text: row.text,
    });
  }

  const entryMap = new Map();
  for (const segment of segments) {
    if (!entryMap.has(segment.entryId)) {
      entryMap.set(segment.entryId, {
        id: segment.entryId, scope: segment.scope, title: segment.title,
        category: segment.category, version: segment.version,
      });
    }
  }

  const noMatch = segments.length === 0;
  return {
    ok: true,
    empty: false,
    noMatch,
    segments,
    entries: [...entryMap.values()],
    charCount,
    omitted,
    personalTotal,
    applicationTotal,
    note: noMatch
      ? '两个知识库里没有检索到与这条通知相关的内容，本次分析没有引用知识。'
      : omitted.length
        ? `有关键片段因长度限制未全部纳入（共 ${omitted.length} 段），引用只代表已选中的部分。`
        : '',
  };
}

/** 组装给模型的知识上下文。每段都带 scope、标题、版本与位置，便于事后核对。 */
export function buildKnowledgeContext(segments) {
  if (!segments.length) return '';
  return segments.map((segment) => {
    const scopeLabel = segment.scope === 'application' ? '应用知识库' : '个人知识库';
    return `【${scopeLabel}｜${segment.title}｜v${segment.version}｜${segment.locationLabel}】\n${segment.text}`;
  }).join('\n\n');
}

/** 只暴露能对外展示的字段，不含内部字符区间。 */
export function publicCitations(segments) {
  return segments.map((segment) => ({
    chunkId: segment.chunkId,
    entryId: segment.entryId,
    scope: segment.scope,
    title: segment.title,
    version: segment.version,
    locationLabel: segment.locationLabel,
    excerpt: segment.text.length > 240 ? `${segment.text.slice(0, 240)}…` : segment.text,
  }));
}

/**
 * 校验模型给出的引用确实来自本次授权片段。
 * 只认 chunkId；同时校验引用文字确实是该片段的一部分，防止拼接。
 */
export function validateCitations(rawCitations, allowedSegments) {
  const byChunk = new Map(allowedSegments.map((segment) => [segment.chunkId, segment]));
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(rawCitations) ? rawCitations : []) {
    const chunkId = typeof raw?.chunkId === 'string' ? raw.chunkId : '';
    const quote = typeof raw?.quote === 'string' ? raw.quote.trim() : '';
    const segment = byChunk.get(chunkId);
    if (!segment) { rejected.push({ chunkId, reason: 'NOT_AUTHORIZED' }); continue; }
    if (quote && !segment.text.includes(quote)) { rejected.push({ chunkId, reason: 'QUOTE_NOT_FOUND' }); continue; }
    accepted.push({
      chunkId,
      entryId: segment.entryId,
      scope: segment.scope,
      title: segment.title,
      version: segment.version,
      locationLabel: segment.locationLabel,
      quote: quote || segment.text.slice(0, 120),
    });
  }
  return { accepted, rejected };
}
