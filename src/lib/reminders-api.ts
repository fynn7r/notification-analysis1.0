/**
 * @file reminders-api.ts
 * @description 待办接口客户端。只在登录后使用；未登录时全部走本地存储。
 */

import { apiRequest } from '@/lib/knowledge-api';
import type { IReminder } from '@/data/reminder';

export interface ImportResult {
  imported: number;
  skippedMock: number;
  skippedDuplicate: number;
  failed: { id: string; message: string }[];
}

export function listReminders(status: 'open' | 'done' | 'all' = 'all') {
  return apiRequest<{ status: string; reminders: IReminder[] }>(`/api/reminders?status=${status}`);
}

export function saveReminder(reminder: IReminder) {
  return apiRequest<{ reminder: IReminder }>('/api/reminders', {
    method: 'POST',
    body: JSON.stringify(reminder),
  });
}

export function patchReminder(id: string, patch: Partial<IReminder>) {
  return apiRequest<{ reminder: IReminder }>(`/api/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function removeReminder(id: string) {
  return apiRequest<{ id: string; deletedAt: string }>(`/api/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function importLocalReminders(reminders: IReminder[]) {
  return apiRequest<ImportResult>('/api/reminders/import-local', {
    method: 'POST',
    body: JSON.stringify({ reminders }),
  });
}

/** 服务端导出是全量的（不受当前浏览器限制），走浏览器原生下载。 */
export function serverExportUrl(kind: 'ics' | 'csv', status: 'open' | 'all' = 'open') {
  return `/api/reminders/export.${kind}?status=${status}`;
}
