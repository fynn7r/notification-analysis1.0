/**
 * @file storage.ts
 * @description 本地存储封装工具
 * 统一管理所有本地持久化数据的读写操作，包括：
 * - 加分规则、学习目标、提醒列表、历史记录等业务数据
 * - 用户引导状态、用户资料等配置数据
 * - 解析草稿、当前解析会话等临时状态
 * 特性：自动 JSON 序列化/反序列化、旧 key 自动迁移、存储配额溢出提示、异常安全捕获
 * @exports storage（包含所有数据的 get/set 方法）
 */

import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import { toast } from 'sonner';

const STORAGE_KEYS = {
  rules: '__app_notizhi_rules',
  rulesInit: '__app_notizhi_rules_init',
  goals: '__app_notizhi_goals',
  goalsInit: '__app_notizhi_goals_init',
  reminders: '__app_notizhi_reminders',
  remindersInit: '__app_notizhi_reminders_init',
  recurring: '__app_notizhi_recurring',
  recurringInit: '__app_notizhi_recurring_init',
  history: '__app_notizhi_history',
  historyInit: '__app_notizhi_history_init',
  onboarded: '__app_notizhi_onboarded',
  profile: '__app_notizhi_profile',
  notificationMedia: '__app_notizhi_notification_media',
  draft: '__app_notizhi_draft',
  parseSession: '__app_notizhi_parse_session',
  preferences: '__app_notizhi_preferences',
} as const;

// 旧 key 列表，用于迁移
const OLD_KEYS: Record<string, string> = {
  notizhi_rules: STORAGE_KEYS.rules,
  notizhi_goals: STORAGE_KEYS.goals,
  notizhi_reminders: STORAGE_KEYS.reminders,
  notizhi_recurring: STORAGE_KEYS.recurring,
  notizhi_history: STORAGE_KEYS.history,
  notizhi_onboarded: STORAGE_KEYS.onboarded,
  notizhi_profile: STORAGE_KEYS.profile,
  notizhi_notification_media: STORAGE_KEYS.notificationMedia,
  __notizhi_rules_init__: STORAGE_KEYS.rulesInit,
};

// 一次性迁移旧 key 到新 key
function migrateOldKeys(): void {
  try {
    for (const [oldKey, newKey] of Object.entries(OLD_KEYS)) {
      const raw = scopedStorage.getItem(oldKey);
      if (raw !== null && scopedStorage.getItem(newKey) === null) {
        scopedStorage.setItem(newKey, raw);
      }
      // 迁移后不删旧 key，留作兜底（安全第一）
    }
  } catch {
    // ignore
  }
}

// 执行迁移（模块加载时执行一次）
migrateOldKeys();

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = scopedStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    scopedStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // 配额溢出等错误不能静默：用户需要知道数据没存上。
    // 每次会话只提示一次，避免连续写操作刷屏。
    console.error(`[storage] 写入失败 key=${key}:`, err);
    if (!quotaWarned) {
      quotaWarned = true;
      try {
        toast.error('本地存储空间不足，最近的数据可能没有保存成功');
      } catch {
        /* toast 初始化失败时静默 */
      }
    }
  }
}

let quotaWarned = false;

function safeGetFlag(key: string): boolean {
  try {
    return scopedStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function safeSetFlag(key: string, value: boolean): void {
  try {
    scopedStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export const storage = {
  // rules
  getRules: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.rules, fallback),
  setRules: <T>(value: T) => safeSet(STORAGE_KEYS.rules, value),
  getRulesInitialized: () => safeGetFlag(STORAGE_KEYS.rulesInit),
  setRulesInitialized: (v: boolean) => safeSetFlag(STORAGE_KEYS.rulesInit, v),

  // goals
  getGoals: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.goals, fallback),
  setGoals: <T>(value: T) => safeSet(STORAGE_KEYS.goals, value),
  getGoalsInitialized: () => safeGetFlag(STORAGE_KEYS.goalsInit),
  setGoalsInitialized: (v: boolean) => safeSetFlag(STORAGE_KEYS.goalsInit, v),

  // reminders
  getReminders: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.reminders, fallback),
  setReminders: <T>(value: T) => safeSet(STORAGE_KEYS.reminders, value),
  getRemindersInitialized: () => safeGetFlag(STORAGE_KEYS.remindersInit),
  setRemindersInitialized: (v: boolean) => safeSetFlag(STORAGE_KEYS.remindersInit, v),

  // history
  getHistory: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.history, fallback),
  setHistory: <T>(value: T) => safeSet(STORAGE_KEYS.history, value),
  getHistoryInitialized: () => safeGetFlag(STORAGE_KEYS.historyInit),
  setHistoryInitialized: (v: boolean) => safeSetFlag(STORAGE_KEYS.historyInit, v),

  // onboarding
  getOnboarded: () => safeGetFlag(STORAGE_KEYS.onboarded),
  setOnboarded: (v: boolean) => safeSetFlag(STORAGE_KEYS.onboarded, v),

  // recurring reminders
  getRecurring: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.recurring, fallback),
  setRecurring: <T>(value: T) => safeSet(STORAGE_KEYS.recurring, value),
  getRecurringInitialized: () => safeGetFlag(STORAGE_KEYS.recurringInit),
  setRecurringInitialized: (v: boolean) => safeSetFlag(STORAGE_KEYS.recurringInit, v),

  // user profile
  getProfile: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.profile, fallback),
  setProfile: <T>(value: T) => safeSet(STORAGE_KEYS.profile, value),

  // 草稿
  getDraft: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.draft, fallback),
  setDraft: <T>(value: T) => safeSet(STORAGE_KEYS.draft, value),

  // 当前解析会话（路由切换/刷新后恢复）
  getParseSession: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.parseSession, fallback),
  setParseSession: <T>(value: T) => safeSet(STORAGE_KEYS.parseSession, value),

  // 本地偏好（默认提醒提前量等）
  getPreferences: <T>(fallback: T) => safeGet<T>(STORAGE_KEYS.preferences, fallback),
  setPreferences: <T>(value: T) => safeSet(STORAGE_KEYS.preferences, value),
};
