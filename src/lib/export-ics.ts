/**
 * @file export-ics.ts
 * @description 浏览器端把待办导出成 .ics。
 *
 * 无账号模式下没有服务端可查，只能在这里生成；有账号时服务端也能导出「全部」，
 * 两者共用 shared/ics.ts，所以行为一致。
 */

import { buildIcs, icsFileName } from '@shared/ics';
import type { IReminder } from '@/data/reminder';
import { DEFAULT_TIMEZONE, dateInTimezone } from '@shared/date-time';
import { deriveLeadMinutes, leadMinutesToOffsetLabel } from '@/lib/preferences';

export interface ExportOutcome {
  included: number;
  skipped: number;
}

/** 只导出未完成的待办；已完成的留在列表里，但没必要再进日历。 */
export function toIcsReminders(reminders: IReminder[]) {
  return reminders
    .filter((reminder) => !reminder.completed)
    .map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      deadline: reminder.deadline,
      remindAt: reminder.remindAt,
      // 旧数据没有这个字段，从两个时间现算，避免导出时闹钟静默消失。
      remindLeadMinutes: reminder.remindLeadMinutes
        ?? deriveLeadMinutes(reminder.deadline, reminder.remindAt)
        ?? 0,
      note: reminder.note,
      type: reminder.type,
      timezone: reminder.timezone || DEFAULT_TIMEZONE,
    }));
}

export function downloadRemindersIcs(reminders: IReminder[], calendarName = '通知智析'): ExportOutcome {
  const prepared = toIcsReminders(reminders);
  const { content, included, skipped } = buildIcs(prepared, { calendarName });
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = icsFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立刻 revoke 会让部分浏览器取消下载，留一拍。
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return { included, skipped: skipped.length };
}

/** 导出失败的条目要说清是哪些，不能静默少几条。 */
export function describeSkipped(reminders: IReminder[]): string[] {
  return reminders
    .filter((reminder) => !reminder.completed && !reminder.deadline?.trim() && !reminder.remindAt?.trim())
    .map((reminder) => reminder.title);
}

/** 提示语里用到的提前量描述，例如「提前 1 天」，与界面上的说法保持一致。 */
export function offsetLabelOf(reminder: IReminder): string {
  const minutes = reminder.remindLeadMinutes ?? deriveLeadMinutes(reminder.deadline, reminder.remindAt) ?? 0;
  return leadMinutesToOffsetLabel(minutes);
}

/**
 * 从服务端导出（登录态才可用）。相比本地导出，它能带上其他设备同步上来的待办。
 * 服务端在没有可写事件时会返回 JSON 说明原因，所以要判断内容类型再下载。
 */
export async function downloadFromServer(kind: 'ics' | 'csv', status: 'open' | 'all' = 'open'): Promise<ExportOutcome & { reason?: string }> {
  const response = await fetch(`/api/reminders/export.${kind}?status=${status}`, { credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/')) {
    // 形如 { error: { code: 'NOTHING_TO_EXPORT' }, skipped: [...] }
    let payload: { error?: { message?: string }; skipped?: string[] } | null = null;
    try { payload = await response.json(); } catch { /* 忽略 */ }
    return {
      included: 0,
      skipped: payload?.skipped?.length ?? 0,
      reason: payload?.error?.message ?? '导出失败，请重试。',
    };
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = kind === 'ics' ? icsFileName() : `notizhi-reminders-${dateInTimezone(new Date()).replace(/-/g, '')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return {
    included: Number(response.headers.get('x-exported-events') ?? 0),
    skipped: Number(response.headers.get('x-skipped-events') ?? 0),
  };
}
