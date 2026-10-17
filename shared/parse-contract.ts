import { z } from 'zod';
import { DEFAULT_TIMEZONE, isCalendarDate } from './date-time.ts';

const calendarDate = z.string().refine(isCalendarDate, '日期必须是有效的 YYYY-MM-DD');
export const notificationTypes = ['比赛竞赛', '讲座分享', '作业任务', '缴费事务', '活动会议', '招募报名', '其他'] as const;

export const parseRequestSchema = z.object({
  text: z.string().trim().min(1, '请先粘贴通知原文').max(20000, '通知暂限 20000 字以内'),
  referenceDate: calendarDate,
  timezone: z.string().default(DEFAULT_TIMEZONE).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, '时区无效'),
});

const dateEvidenceSchema = z.object({
  date: calendarDate.nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  evidence: z.string(),
});

export const modelOutputSchema = z.object({
  title: z.string().trim().min(1),
  type: z.enum(notificationTypes),
  actionTitle: z.string().trim().min(1).nullable(),
  deadline: dateEvidenceSchema.nullable(),
  eventTime: dateEvidenceSchema.nullable(),
  location: z.string().default(''),
  targetAudience: z.string().default(''),
  requirements: z.string().default(''),
  contact: z.string().default(''),
  links: z.array(z.string().url()).default([]),
});

const isoDatetime = z.iso.datetime({ offset: true });

export const parseResponseSchema = z.object({
  source: z.literal('real'),
  notification: z.object({
    title: z.string(), type: z.enum(notificationTypes),
    registrationDeadline: isoDatetime.nullable(), eventStartTime: isoDatetime.nullable(),
    location: z.string(), targetAudience: z.string(), requirements: z.string(),
    contact: z.string(), links: z.array(z.string()),
  }),
  action: z.object({ title: z.string().nullable(), deadline: isoDatetime.nullable(), remindAt: isoDatetime.nullable() }),
  warnings: z.array(z.string()),
});

export type ParseRequest = z.infer<typeof parseRequestSchema>;
export type ParseResponse = z.infer<typeof parseResponseSchema>;
