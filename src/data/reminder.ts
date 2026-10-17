/**
 * @file reminder.ts
 * @description 提醒与周期规则数据模型定义文件
 * 定义了提醒功能相关的所有 TypeScript 接口和类型，包括：
 * - 提醒来源类型（来自通知解析 / 个人手动创建）
 * - 重复提醒类型（每日/每周/每月/每N天）
 * - 单条提醒 IReminder（含截止时间、提醒时间、完成状态等）
 * - 周期重复规则 IRecurringRule（用于自动生成重复提醒）
 * - 附件结构 IAttachment（图片/视频）
 * - 内置示例提醒数据（数模竞赛报名提醒、每周组会等）
 * @exports IReminder, IRecurringRule, IAttachment, MOCK_REMINDERS, MOCK_RECURRING
 */

import { getFutureDate } from '@/lib/date-utils';

export type ImportanceLevel = 'high' | 'medium' | 'low';
export type ReminderSource = 'notification' | 'personal';
export type RecurringType = 'none' | 'daily' | 'weekly' | 'monthly' | 'everyNDays';

export interface IAttachment {
  id: string;
  type: 'image' | 'video';
  name: string;
  dataUrl?: string;
  url?: string;
  size?: number;
  mimeType?: string;
  addedAt: number;
}

export interface IRecurringRule {
  id: string;
  title: string;
  type: RecurringType;
  timeOfDay: string;
  weekdays?: number[];
  dayOfMonth?: number;
  intervalDays?: number;
  startDate?: string;
  importance: ImportanceLevel;
  note?: string;
  paused: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
}

export interface IReminder {
  id: string;
  notificationId?: string;
  title: string;
  type: string;
  importance: ImportanceLevel;
  deadline: string;
  remindAt: string;
  timezone?: string;
  remindOffset: string;
  completed: boolean;
  source: ReminderSource;
  recurringType?: RecurringType;
  recurringRuleId?: string;
  note?: string;
  attachments?: IAttachment[];
  createdAt: number;
  triggered?: boolean;
}

// 示例提醒：截止日 20 天后，提醒在截止前 2 天（18 天后）
const mockDeadline = getFutureDate(20, 23, 59);
const mockRemindAt = getFutureDate(18, 23, 59);

export const MOCK_REMINDERS: IReminder[] = [
  {
    id: 'mock-reminder-001',
    notificationId: 'mock-notice-001',
    title: '数学建模竞赛报名截止',
    type: '比赛竞赛',
    importance: 'high',
    deadline: mockDeadline,
    remindAt: mockRemindAt,
    remindOffset: '截止前2天',
    completed: false,
    source: 'notification',
    createdAt: Date.now() - 3600_000 * 2,
  },
  {
    id: 'mock-reminder-002',
    title: '每周组会',
    type: '个人提醒',
    importance: 'medium',
    deadline: getFutureDate(6, 20, 0), // 6 天后 20:00
    remindAt: getFutureDate(6, 19, 50),
    remindOffset: '提前10分钟',
    completed: false,
    source: 'personal',
    recurringType: 'weekly',
    note: '准备本周工作进展汇报',
    createdAt: Date.now() - 3600_000 * 5,
  },
];

export const MOCK_RECURRING: IRecurringRule[] = [
  {
    id: 'mock-recurring-001',
    title: '每周五组会',
    type: 'weekly',
    timeOfDay: '20:00',
    weekdays: [5],
    importance: 'medium',
    note: '准备每周汇报材料',
    paused: false,
    createdAt: Date.now() - 86400_000 * 3,
  },
  {
    id: 'mock-recurring-002',
    title: '每日英语打卡',
    type: 'daily',
    timeOfDay: '07:30',
    importance: 'low',
    note: '背单词 + 听力练习',
    paused: false,
    createdAt: Date.now() - 86400_000 * 7,
  },
];
