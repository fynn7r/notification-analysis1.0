/**
 * @file useReminders.ts
 * @description 提醒列表管理 Hook
 * 提供提醒事项的增删改查功能，数据自动持久化到本地存储。
 * 导出 reminderStore 单例，供闹钟调度等非组件场景直接读写。
 * @exports useReminders（React Hook）, reminderStore（全局状态单例）
 */

import { useCallback, useEffect } from 'react';
import { IReminder } from '@/data/reminder';
import { reminderStore } from '@/lib/reminder-store';
import { syncAfterAuth } from '@/lib/reminder-sync';
import { useAuth } from '@/hooks/useAuth';
import { genId } from '@/lib/utils';

// 单例 store 拆到 @/lib/reminder-store，避免同步层与 store 互相 import 形成环。
// 这里继续导出，保持 useAlarm 等既有调用点不变。
export { reminderStore };

export function useReminders() {
  const { items: reminders, loading } = reminderStore.useStore();
  const { ready, user } = useAuth();

  // 登录态明确之后才决定要不要和服务端对齐：
  // 未登录 → 纯本地，行为与之前完全一致；登录 → 拉云端，必要时提示导入本地数据。
  useEffect(() => {
    if (!ready) return;
    void syncAfterAuth(user?.id ?? null);
  }, [ready, user?.id]);

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
