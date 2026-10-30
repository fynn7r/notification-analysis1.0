/**
 * @file preferences.ts
 * @description 本地偏好设置。目前只有一项：默认提醒提前量。
 * 之所以要单独抽出来，是因为「提前多久提醒」原先硬编码在提醒确认弹窗里（`- 30 * 60000`），
 * 解析结果页的下拉又是另一套值，两处各算各的，用户改了这个那个不变。
 * 现在统一从这里取默认值，并且只在用户主动改动时写回。
 */

import { storage } from '@/lib/storage';

export interface IPreferences {
  /** 默认提醒提前量（分钟）。0 表示准时提醒。 */
  defaultLeadMinutes: number;
}

export const DEFAULT_PREFERENCES: IPreferences = {
  defaultLeadMinutes: 30,
};

/** 提前量下拉的候选值。数值即分钟数，文案由 describeLeadMinutes 生成，避免两处各写一份中文。 */
export const LEAD_MINUTE_OPTIONS = [5, 10, 30, 60, 180, 720, 1440, 2880] as const;

/** 把分钟数说成人话：「准时」「提前 30 分钟」「提前 2 小时」「提前 1 天」。 */
export function describeLeadMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '准时';
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '提前 1 天' : `提前 ${days} 天`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '提前 1 小时' : `提前 ${hours} 小时`;
  }
  return `提前 ${minutes} 分钟`;
}

/** 写入 `remindOffset` 的中文文案，与 ParsePage 中 `REMIND_OFFSETS` 的命名保持一致。 */
export function leadMinutesToOffsetLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '准时';
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '截止前1天' : `截止前${days}天`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '截止前1小时' : `截止前${hours}小时`;
  }
  return `截止前${minutes}分钟`;
}

export function getPreferences(): IPreferences {
  const stored = storage.getPreferences<Partial<IPreferences> | null>(null);
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_PREFERENCES };
  const lead = Number(stored.defaultLeadMinutes);
  return {
    ...DEFAULT_PREFERENCES,
    defaultLeadMinutes: Number.isFinite(lead) && lead >= 0 ? lead : DEFAULT_PREFERENCES.defaultLeadMinutes,
  };
}

export function getDefaultLeadMinutes(): number {
  return getPreferences().defaultLeadMinutes;
}

export function setDefaultLeadMinutes(minutes: number): void {
  const safe = Number.isFinite(minutes) && minutes >= 0 ? Math.trunc(minutes) : DEFAULT_PREFERENCES.defaultLeadMinutes;
  storage.setPreferences({ ...getPreferences(), defaultLeadMinutes: safe });
}

/**
 * 从已有的 deadline / remindAt 反推提前量，用于旧数据与外部导入的数据。
 * 拿不到有效时间时返回 null，调用方应回退到默认值而不是猜 0。
 */
export function deriveLeadMinutes(deadline?: string | null, remindAt?: string | null): number | null {
  if (!deadline || !remindAt) return null;
  const due = new Date(deadline).getTime();
  const remind = new Date(remindAt).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(remind)) return null;
  return Math.max(0, Math.round((due - remind) / 60000));
}
