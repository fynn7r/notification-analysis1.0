import { useCallback } from 'react';
import { IRecurringRule, MOCK_RECURRING } from '@/data/reminder';
import { storage } from '@/lib/storage';
import { createLocalStore } from '@/lib/create-local-store';
import { genId } from '@/lib/utils';

// 导出单例 store：useAlarm 的周期检查需要读取最新规则
export const recurringStore = createLocalStore<IRecurringRule>({
  storageKey: '__app_notizhi_recurring',
  initFlagKey: '__app_notizhi_recurring_init',
  mockData: MOCK_RECURRING,
  get: () => storage.getRecurring<IRecurringRule[] | null>(null),
  set: (v) => storage.setRecurring(v),
  getInitFlag: () => storage.getRecurringInitialized(),
  setInitFlag: (v) => storage.setRecurringInitialized(v),
});

export function useRecurring() {
  const { items: recurringRules, loading } = recurringStore.useStore();

  const addRecurring = useCallback(
    (rule: Omit<IRecurringRule, 'id' | 'createdAt' | 'paused'>) => {
      return recurringStore.addItem({
        ...rule,
        id: genId('recurring'),
        paused: false,
        createdAt: Date.now(),
      } as unknown as IRecurringRule);
    },
    []
  );

  const togglePause = useCallback((id: string) => {
    const target = recurringStore.findItem(id);
    if (!target) return;
    recurringStore.updateItem(id, { paused: !target.paused } as Partial<IRecurringRule>);
  }, []);

  const deleteRecurring = useCallback((id: string) => {
    recurringStore.deleteItem(id);
  }, []);

  const updateRecurring = useCallback((id: string, updates: Partial<IRecurringRule>) => {
    recurringStore.updateItem(id, updates);
  }, []);

  return {
    recurringRules,
    loading,
    addRecurring,
    togglePause,
    deleteRecurring,
    updateRecurring,
  };
}
