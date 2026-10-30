/**
 * @file reminder-sync.ts
 * @description 待办的双模同步：本地始终是权威副本，登录后异步推给服务端。
 *
 * 三条不能破的规则：
 * 1. **读永远同步**。`useAlarm` 是定时器回调，同步读内存；服务端数据只做异步回填。
 * 2. **写不阻塞**。先改内存并立刻渲染，再排队推送，失败进重试队列，
 *    绝不因为网络问题让用户点一下卡三秒。
 * 3. **登录不等于覆盖**。首次登录时本地已有待办、服务端是空的，要先问是否导入，
 *    不能直接把本地清空——那对用户来说就是「数据没了」。
 */

import type { IReminder } from '@/data/reminder';
import { reminderStore, setReminderChangeHandler } from '@/lib/reminder-store';
import { useSyncExternalStore } from 'react';
import {
  importLocalReminders,
  listReminders,
  removeReminder,
  saveReminder,
} from '@/lib/reminders-api';
import { ApiFailure } from '@/lib/knowledge-api';

export type ReminderSyncStatus = 'local' | 'pending-import' | 'syncing' | 'synced' | 'offline';

export interface ReminderSyncState {
  status: ReminderSyncStatus;
  /** 本地有、服务端还没有的条目数，用于「发现 N 条本地待办」提示。 */
  pendingImport: number;
  /** 还没推上去的变更数。 */
  unsynced: number;
  lastError: string | null;
}

const MAX_RETRY = 3;
const FLUSH_DELAY_MS = 400;

let userId: number | null = null;
let state: ReminderSyncState = { status: 'local', pendingImport: 0, unsynced: 0, lastError: null };
const listeners = new Set<() => void>();
const queue = new Map<string, 'upsert' | 'delete'>();
let timer: ReturnType<typeof setTimeout> | null = null;
let retry = 0;
let hydrating = false;

function setState(patch: Partial<ReminderSyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeReminderSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReminderSyncState(): ReminderSyncState {
  return state;
}

export function useReminderSync(): ReminderSyncState {
  return useSyncExternalStore(subscribeReminderSync, getReminderSyncState, getReminderSyncState);
}

function isEnabled() {
  return userId !== null;
}

/** 示例数据不该进账号，也不该算进「发现 N 条本地待办」。 */
function localUserReminders(): IReminder[] {
  return reminderStore.getItems().filter((item) => !item.id.startsWith('mock-'));
}

/**
 * 登录态变化时调用。首次登录先看服务端有没有数据，再决定是回填还是提示导入。
 */
export async function syncAfterAuth(nextUserId: number | null): Promise<void> {
  if (nextUserId === null) {
    userId = null;
    queue.clear();
    retry = 0;
    setState({ status: 'local', pendingImport: 0, unsynced: 0, lastError: null });
    return;
  }
  if (userId === nextUserId) return;
  userId = nextUserId;
  await hydrateFromServer();
}

export async function hydrateFromServer(): Promise<void> {
  if (!isEnabled() || hydrating) return;
  hydrating = true;
  setState({ status: 'syncing', lastError: null });
  try {
    const { reminders } = await listReminders('all');
    const local = localUserReminders();
    if (!reminders.length && local.length) {
      // 服务端是空的，本地却有东西：不覆盖，先问用户要不要导入。
      setState({ status: 'pending-import', pendingImport: local.length, unsynced: 0 });
      return;
    }
    reminderStore.hydrate(reminders);
    setState({ status: 'synced', pendingImport: 0, unsynced: 0 });
  } catch (error) {
    // 拉取失败不影响本地继续用，降级为「未同步」而不是报错遮断操作。
    setState({
      status: 'offline',
      lastError: describeError(error, '无法读取云端待办，当前使用本地数据。'),
    });
  } finally {
    hydrating = false;
  }
}

export async function importLocalToServer(): Promise<{ imported: number; skipped: number }> {
  if (!isEnabled()) return { imported: 0, skipped: 0 };
  setState({ status: 'syncing' });
  try {
    const result = await importLocalReminders(reminderStore.getItems());
    await hydrateFromServer();
    return { imported: result.imported, skipped: result.skippedDuplicate + result.skippedMock };
  } catch (error) {
    setState({ status: 'offline', lastError: describeError(error, '导入失败，本地数据仍然保留。') });
    return { imported: 0, skipped: 0 };
  }
}

/** 用户选择「暂不导入」：保持本地继续用，不再反复提示。 */
export function dismissPendingImport(): void {
  setState({ status: 'local', pendingImport: 0 });
}

function enqueue(id: string, type: 'upsert' | 'delete') {
  if (!isEnabled()) return;
  // 同一条待办被连续改动时只保留最后一次意图，避免把中间的瞬时状态也推上去。
  if (queue.has(id) && queue.get(id) === 'upsert' && type === 'upsert') {
    queue.set(id, 'upsert');
  } else {
    queue.set(id, type);
  }
  setState({ unsynced: queue.size, status: 'syncing' });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
}

export async function flush(): Promise<void> {
  if (!isEnabled() || hydrating || !queue.size) return;
  const batch = [...queue.entries()];
  queue.clear();
  let failed = 0;

  for (const [id, type] of batch) {
    const item = reminderStore.findItem(id);
    try {
      if (type === 'delete') {
        await removeReminder(id);
      } else if (item) {
        await saveReminder(item);
      }
    } catch (error) {
      // 404 说明服务端已经没有这条（可能是另一端删了），不必重试。
      const missing = error instanceof ApiFailure && error.status === 404;
      if (!missing) {
        failed += 1;
        if (!queue.has(id)) queue.set(id, type);
      }
    }
  }

  if (!failed) {
    retry = 0;
    setState({ status: 'synced', unsynced: queue.size });
    return;
  }

  retry += 1;
  if (retry >= MAX_RETRY) {
    setState({
      status: 'offline',
      unsynced: queue.size,
      lastError: '有改动未能同步到账号，本地数据已保留，恢复网络后可重试。',
    });
    return;
  }
  setState({ status: 'syncing', unsynced: queue.size });
  timer = setTimeout(() => { void flush(); }, 1000 * 2 ** retry);
}

/** 手动重试，给「未同步」提示条上的按钮用。 */
export async function retrySync(): Promise<void> {
  retry = 0;
  await hydrateFromServer();
  if (state.status === 'synced') await flush();
}

/** 把 store 的变更接到同步队列上；未登录时 enqueue 内部直接返回。 */
export function handleReminderChange(change: { type: 'add' | 'update' | 'delete'; id: string }): void {
  if (!isEnabled()) return;
  enqueue(change.id, change.type === 'delete' ? 'delete' : 'upsert');
}

// 模块加载时就把 store 的写入接到队列上，组件无需感知。
setReminderChangeHandler(handleReminderChange);

function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiFailure) {
    if (error.status === 401) return '登录已过期，改动会保留在本地，重新登录后自动同步。';
    return error.message || fallback;
  }
  return fallback;
}
