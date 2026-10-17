import {
  addDays,
  addWeeks,
  isSameDay,
  parseISO,
  format,
  isAfter,
  isBefore,
  startOfDay,
} from 'date-fns';
import type { IRecurringRule, IReminder } from '@/data/reminder';

// 计算周期提醒的下次触发时间
export function getNextRecurringTime(
  rule: IRecurringRule,
  from: Date = new Date()
): Date | null {
  if (rule.paused) return null;

  const [hour, minute] = rule.timeOfDay.split(':').map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  let base = new Date(from);
  base.setHours(hour, minute, 0, 0);

  // 如果今天的时间已过，从明天开始找
  if (isBefore(base, from)) {
    base = addDays(startOfDay(new Date()), 1);
    base.setHours(hour, minute, 0, 0);
  }

  switch (rule.type) {
    case 'daily':
      if (isBefore(base, from)) {
        return addDays(base, 1);
      }
      return base;

    case 'weekly': {
      if (!rule.weekdays || rule.weekdays.length === 0) return null;
      // 找到未来最近的一个星期几
      for (let i = 0; i < 8; i++) {
        const candidate = addDays(base, i);
        if (rule.weekdays.includes(candidate.getDay())) {
          if (isAfter(candidate, from) || isSameDay(candidate, from)) {
            return candidate;
          }
        }
      }
      return null;
    }

    case 'monthly': {
      if (!rule.dayOfMonth) return null;
      // 每月日期 clamp 到当月最后一天： setDate(31) 在 30 天月份会进位到下月 1 日
      const mk = (y: number, m: number) =>
        new Date(y, m, Math.min(rule.dayOfMonth!, new Date(y, m + 1, 0).getDate()), hour, minute, 0, 0);
      let candidate = mk(base.getFullYear(), base.getMonth());
      if (isBefore(candidate, from)) {
        const nextMonth = base.getMonth() + 1;
        candidate = mk(base.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12);
      }
      return candidate;
    }

    case 'everyNDays': {
      if (!rule.intervalDays || rule.intervalDays < 1) return null;
      let start = rule.startDate ? parseISO(rule.startDate) : new Date();
      start.setHours(hour, minute, 0, 0);
      // 找到下一个 N 天的整数倍
      while (isBefore(start, from)) {
        start = addDays(start, rule.intervalDays);
      }
      return start;
    }

    default:
      return null;
  }
}

// 格式化周期规则的人类可读描述
export function formatRecurringRule(rule: IRecurringRule): string {
  switch (rule.type) {
    case 'daily':
      return `每天 ${rule.timeOfDay}`;
    case 'weekly': {
      const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      // 拷贝后排序，避免就地修改存储中的 weekdays 数组
      const days = [...(rule.weekdays || [])]
        .sort((a, b) => a - b)
        .map((d) => weekNames[d])
        .join('、');
      return `每周 ${days} ${rule.timeOfDay}`;
    }
    case 'monthly':
      return `每月${rule.dayOfMonth}日 ${rule.timeOfDay}`;
    case 'everyNDays':
      return `每${rule.intervalDays}天 ${rule.timeOfDay}`;
    default:
      return '';
  }
}

// 从 reminder 中提取媒体链接
export function extractMediaLinks(text: string): string[] {
  const imageRegex = /https?:\/\/[^\s<>"']+\.(?:jpg|jpeg|png|gif|webp|svg|bmp)(?:\?[^\s<>"']*)?/gi;
  const videoRegex = /https?:\/\/[^\s<>"']+\.(?:mp4|webm|ogg|mov|avi)(?:\?[^\s<>"']*)?/gi;

  const images = [...text.matchAll(imageRegex)].map((m) => m[0]);
  const videos = [...text.matchAll(videoRegex)].map((m) => m[0]);
  return [...new Set([...images, ...videos])];
}

// 从链接后缀判断媒体类型
export function detectMediaType(url: string): 'image' | 'video' | 'unknown' {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/.test(lower)) return 'image';
  if (/\.(mp4|webm|ogg|mov|avi)(\?|$)/.test(lower)) return 'video';
  return 'unknown';
}

// 格式化文件大小
export function formatFileSize(bytes?: number): string {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
