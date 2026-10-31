/**
 * @file useReminderCounts.ts
 * @description 导航角标用的待办计数。
 *
 * 两个数字刻意分开算，因为它们回答的是两个不同问题：
 * - pending：还需要你动手的有多少条（红点，催办）；
 * - expired：已经过了截止的有多少条（灰点，提醒你清理或补救）。
 *
 * 二者互斥且相加等于「未完成总数」，和提醒事项页 tab 上的口径一致。
 * 如果红点按「全部未完成」算、灰点是它的子集，用户会看到 5 和 2 却算不出关系。
 */

import { useMemo } from 'react';
import { reminderStore } from '@/lib/reminder-store';
import { getUrgency } from '@/lib/date-utils';

export interface ReminderCounts {
  /** 未完成且尚未到期 */
  pending: number;
  /** 未完成但已过截止 */
  expired: number;
}

export function useReminderCounts(): ReminderCounts {
  const { items } = reminderStore.useStore();

  return useMemo(() => {
    let pending = 0;
    let expired = 0;
    for (const item of items) {
      if (item.completed) continue;
      // 没有截止时间的按「还没到期」算：它不会自己过期，也就不该算进灰点。
      if (getUrgency(item.deadline) === 'expired') expired += 1;
      else pending += 1;
    }
    return { pending, expired };
  }, [items]);
}
