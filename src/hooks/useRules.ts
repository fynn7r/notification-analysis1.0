import { useCallback } from 'react';
import { IRule, MOCK_RULES } from '@/data/rule';
import { storage } from '@/lib/storage';
import { createLocalStore } from '@/lib/create-local-store';
import { genId } from '@/lib/utils';
import { deleteRuleLayout } from '@/lib/rule-layout-storage';

const ruleStore = createLocalStore<IRule>({
  storageKey: '__app_notizhi_rules',
  initFlagKey: '__app_notizhi_rules_init',
  mockData: MOCK_RULES,
  get: () => storage.getRules<IRule[] | null>(null),
  set: (v) => storage.setRules(v),
  getInitFlag: () => storage.getRulesInitialized(),
  setInitFlag: (v) => storage.setRulesInitialized(v),
});

export function useRules() {
  const { items: rules, loading } = ruleStore.useStore();

  const addRule = useCallback((rule: Omit<IRule, 'id' | 'createdAt'>) => {
    return ruleStore.addItem({
      ...rule,
      id: genId('rule'),
      createdAt: Date.now(),
    } as unknown as IRule);
  }, []);

  const updateRule = useCallback((id: string, updates: Partial<IRule>) => {
    ruleStore.updateItem(id, updates);
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    const documentId = ruleStore.findItem(id)?.richDocumentId;
    ruleStore.deleteItem(id);
    if (documentId && !storage.getRules<IRule[]>([]).some((rule) => rule.id === id)) {
      await deleteRuleLayout(documentId).catch(() => console.warn('规则已删除，排版缓存未清理。'));
    }
  }, []);

  const clearMockRules = useCallback(() => {
    ruleStore.updateItems((prev) => prev.filter((r) => r.source !== 'mock'));
  }, []);

  const setRules = useCallback((items: IRule[]) => {
    ruleStore.setItems(items);
  }, []);

  return {
    rules,
    loading,
    addRule,
    updateRule,
    deleteRule,
    clearMockRules,
    setRules,
  };
}
