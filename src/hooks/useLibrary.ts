/**
 * 知识库统一数据源。
 * 未登录：沿用原来的浏览器本地规则（不进账号体系）。
 * 已登录：读写服务端，按 scope 区分个人库与应用库。
 * 切换账号时丢弃在途响应，避免 A 的结果写进 B 的界面。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { IRule } from '@/data/rule';
import { useAuth } from '@/hooks/useAuth';
import { useRules } from '@/hooks/useRules';
import {
  ApiFailure, createEntry, deleteEntry, listEntries, patchEntry,
  type KnowledgeEntry, type Scope,
} from '@/lib/knowledge-api';

function toRule(entry: KnowledgeEntry): IRule {
  const source: IRule['source'] = entry.sourceKind === 'mock' ? 'mock' : entry.sourceKind === 'text' ? 'text' : 'file';
  return {
    id: entry.id,
    title: entry.title,
    category: entry.category,
    content: entry.body,
    source,
    createdAt: Date.parse(entry.createdAt) || Date.now(),
    richDocumentId: entry.id,
  };
}

export interface LibraryApi {
  rules: IRule[];
  loading: boolean;
  canWrite: boolean;
  remote: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addRule: (rule: Omit<IRule, 'id' | 'createdAt'>) => Promise<IRule | null>;
  updateRule: (id: string, updates: Partial<IRule>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  setRules: (items: IRule[]) => Promise<void>;
  clearMockRules: () => Promise<void>;
}

export function useLibrary(scope: Scope): LibraryApi {
  const { user } = useAuth();
  const local = useRules();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await listEntries(scope);
      if (current !== generation.current) return;
      setEntries(result.entries);
      setCanWrite(result.canWrite);
      setError(null);
    } catch (failure) {
      if (current !== generation.current) return;
      setEntries([]);
      setCanWrite(false);
      setError(failure instanceof ApiFailure ? failure.message : '知识库加载失败。');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [user, scope]);

  useEffect(() => {
    if (!user) {
      generation.current += 1;
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    void load();
  }, [user, load]);

  const addRule = useCallback(async (rule: Omit<IRule, 'id' | 'createdAt'>) => {
    if (!user) return local.addRule(rule);
    try {
      const result = await createEntry({
        scope,
        title: rule.title,
        category: rule.category,
        body: rule.content,
        sourceKind: rule.source === 'mock' ? 'mock' : rule.source === 'text' ? 'text' : 'file',
        demo: rule.source === 'mock',
      });
      setEntries((prev) => [result.entry, ...prev]);
      return toRule(result.entry);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '保存失败。');
      return null;
    }
  }, [user, scope, local]);

  const updateRule = useCallback(async (id: string, updates: Partial<IRule>) => {
    if (!user) { local.updateRule(id, updates); return; }
    try {
      const result = await patchEntry(id, {
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.category !== undefined ? { category: updates.category } : {}),
        ...(updates.content !== undefined ? { body: updates.content } : {}),
      });
      setEntries((prev) => prev.map((entry) => (entry.id === id ? result.entry : entry)));
      setError(null);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '保存失败，修改内容已保留在编辑框。');
      throw failure;
    }
  }, [user, local]);

  const deleteRule = useCallback(async (id: string) => {
    if (!user) { await local.deleteRule(id); return; }
    try {
      await deleteEntry(id);
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
      setError(null);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '删除失败。');
    }
  }, [user, local]);

  /** 批量导入（合并/覆盖/选择性）在登录态逐条落到服务端，失败即停并保留已完成的部分。 */
  const setRules = useCallback(async (items: IRule[]) => {
    if (!user) { local.setRules(items); return; }
    const existing = new Map(entries.map((entry) => [entry.id, entry]));
    const keep = new Set(items.map((item) => item.id));
    for (const entry of entries) {
      if (!keep.has(entry.id)) await deleteEntry(entry.id).catch(() => { /* 单条失败不阻断 */ });
    }
    for (const item of items) {
      if (existing.has(item.id)) {
        await patchEntry(item.id, { title: item.title, category: item.category, body: item.content }).catch(() => {});
      } else {
        await createEntry({
          scope, title: item.title, category: item.category, body: item.content,
          sourceKind: item.source === 'mock' ? 'mock' : item.source === 'text' ? 'text' : 'file',
          demo: item.source === 'mock',
        }).catch(() => {});
      }
    }
    await load();
  }, [user, scope, entries, local, load]);

  const clearMockRules = useCallback(async () => {
    if (!user) { local.clearMockRules(); return; }
    for (const entry of entries.filter((item) => item.sourceKind === 'mock')) {
      await deleteEntry(entry.id).catch(() => {});
    }
    await load();
  }, [user, entries, local, load]);

  if (!user) {
    return {
      rules: local.rules, loading: local.loading, canWrite: true, remote: false, error: null,
      refresh: async () => {},
      addRule: async (rule) => local.addRule(rule),
      updateRule: async (id, updates) => { local.updateRule(id, updates); },
      deleteRule: local.deleteRule,
      setRules: async (items) => { local.setRules(items); },
      clearMockRules: async () => { local.clearMockRules(); },
    };
  }

  return {
    rules: entries.map(toRule), loading, canWrite, remote: true, error,
    refresh: load, addRule, updateRule, deleteRule, setRules, clearMockRules,
  };
}
