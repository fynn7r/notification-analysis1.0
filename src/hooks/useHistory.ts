import { useCallback } from 'react';
import { IHistoryFullItem, MOCK_HISTORY_FULL } from '@/data/notification';
import { storage } from '@/lib/storage';
import { createLocalStore } from '@/lib/create-local-store';
import { genId } from '@/lib/utils';

const historyStore = createLocalStore<IHistoryFullItem>({
  storageKey: '__app_notizhi_history',
  initFlagKey: '__app_notizhi_history_init',
  mockData: MOCK_HISTORY_FULL,
  get: () => storage.getHistory<IHistoryFullItem[] | null>(null),
  set: (v) => storage.setHistory(v),
  getInitFlag: () => storage.getHistoryInitialized(),
  setInitFlag: (v) => storage.setHistoryInitialized(v),
});

export function useHistory() {
  const { items: history, loading } = historyStore.useStore();

  const addHistory = useCallback((item: IHistoryFullItem) => {
    return historyStore.addItem({
      ...item,
      id: item.id ?? genId('history'),
      parsedAt: item.parsedAt ?? Date.now(),
    } as unknown as IHistoryFullItem);
  }, []);

  const getHistoryById = useCallback((id: string): IHistoryFullItem | undefined => {
    return historyStore.findItem(id);
  }, []);

  // 按 id 更新单条历史（重新解析后同步完整数据用）
  const updateHistoryItem = useCallback((id: string, updates: Partial<IHistoryFullItem>) => {
    historyStore.updateItem(id, updates);
  }, []);

  const deleteHistory = useCallback((id: string) => {
    historyStore.deleteItem(id);
  }, []);

  const clearHistory = useCallback(() => {
    historyStore.setItems([]);
  }, []);

  const setHistory = useCallback((items: IHistoryFullItem[]) => {
    historyStore.setItems(items);
  }, []);

  return {
    history,
    loading,
    addHistory,
    getHistoryById,
    updateHistoryItem,
    deleteHistory,
    clearHistory,
    setHistory,
  };
}
