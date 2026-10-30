/**
 * @file reminder-store.ts
 * @description 待办的单例 store。
 *
 * 单独成文件是为了断开循环依赖：同步层要读 store 的数据，而 store 写入时又要通知
 * 同步层。让两边都只依赖这个模块、通过 setChangeHandler 注册回调，就没有环。
 *
 * 「内存是权威副本」这件事在 createLocalStore 里已经成立：读永远命中模块级 state，
 * 同步命中内存，所以 useAlarm 这类定时器回调完全不需要改成异步。
 */

import { createLocalStore } from '@/lib/create-local-store';
import { storage } from '@/lib/storage';
import { MOCK_REMINDERS, type IReminder } from '@/data/reminder';

type ChangeHandler = (change: { type: 'add' | 'update' | 'delete'; id: string }) => void;

let changeHandler: ChangeHandler | null = null;

export function setReminderChangeHandler(handler: ChangeHandler | null): void {
  changeHandler = handler;
}

export const reminderStore = createLocalStore<IReminder>({
  storageKey: '__app_notizhi_reminders',
  initFlagKey: '__app_notizhi_reminders_init',
  mockData: MOCK_REMINDERS,
  get: () => storage.getReminders<IReminder[] | null>(null),
  set: (v) => storage.setReminders(v),
  getInitFlag: () => storage.getRemindersInitialized(),
  setInitFlag: (v) => storage.setRemindersInitialized(v),
  onChange: (change) => changeHandler?.(change),
});
