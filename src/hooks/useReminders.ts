/**
 * @file useReminders.ts
 * @description 提醒列表管理 Hook
 * 提供提醒事项的增删改查功能，数据自动持久化到本地存储。
 * 导出 reminderStore 单例，供闹钟调度等非组件场景直接读写。
 * @exports useReminders（React Hook）, reminderStore（全局状态单例）
 */

import { useCallback } from 'react';
import { IReminder, MOCK_REMINDERS } from '@/data/reminder';
import { storage } from '@/lib/storage';
import { createLocalStore } from '@/lib/create-local-store';
import { genId } from '@/lib/utils';

// 导出单例 store：闹钟调度（useAlarm）等非组件场景需要直接读写，
// 必须走同一份内存状态，避免绕过 store 直写 localStorage 造成状态覆盖
export const reminderStore = createLocalStore<IReminder>({
  storageKey: '__app_notizhi_reminders',
  initFlagKey: '__app_notizhi_reminders_init',
  mockData: MOCK_REMINDERS,
  get: () => storage.getReminders<IReminder[] | null>(null),
  set: (v) => storage.setReminders(v),
  getInitFlag: () => storage.getRemindersInitialized(),
  setInitFlag: (v) => storage.setRemindersInitialized(v),
});

export function useReminders() {
  const { items: reminders, loading } = reminderStore.useStore();

  const addReminder = useCallback(
    (reminder: Omit<IReminder, 'id' | 'createdAt' | 'completed'>) => {
      return reminderStore.addItem({
        ...reminder,
        id: genId('reminder'),
        completed: false,
        createdAt: Date.now(),
      } as unknown as IReminder);
    },
    []
  );

  const toggleComplete = useCallback((id: string) => {
    const target = reminderStore.findItem(id);
    if (!target) return;
    reminderStore.updateItem(id, { completed: !target.completed } as Partial<IReminder>);
  }, []);

  const deleteReminder = useCallback((id: string) => {
    reminderStore.deleteItem(id);
  }, []);

  const updateReminder = useCallback((id: string, updates: Partial<IReminder>) => {
    reminderStore.updateItem(id, updates);
  }, []);

  const setReminders = useCallback((items: IReminder[]) => {
    reminderStore.setItems(items);
  }, []);

  return {
    reminders,
    loading,
    addReminder,
    toggleComplete,
    deleteReminder,
    updateReminder,
    setReminders,
  };
}
