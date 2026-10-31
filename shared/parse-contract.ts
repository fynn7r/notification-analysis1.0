import { z } from 'zod';
import { DEFAULT_TIMEZONE, isCalendarDate } from './date-time.ts';
import { MAX_NOTIFICATION_CHARS } from './limits.ts';

const calendarDate = z.string().refine(isCalendarDate, '日期必须是有效的 YYYY-MM-DD');
export const notificationTypes = ['比赛竞赛', '讲座分享', '作业任务', '缴费事务', '活动会议', '招募报名', '其他'] as const;

export const parseRequestSchema = z.object({
  text: z.string().trim().min(1, '请先粘贴通知原文')
    .max(MAX_NOTIFICATION_CHARS, `通知暂限 ${MAX_NOTIFICATION_CHARS} 字以内`),
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

export const knowledgeScopes = ['personal', 'application'] as const;

/** 模型只允许返回编号（K1/K2…），服务端再换成真实条目身份。 */
export const modelKnowledgeSchema = z.object({
  used: z.boolean().default(false),
  summary: z.string().max(800).default(''),
  citations: z.array(z.object({
    ref: z.string().trim().min(1).max(8),
    quote: z.string().trim().max(300).default(''),
  })).max(8).default([]),
  conflicts: z.array(z.object({
    topic: z.string().trim().min(1).max(120),
    refs: z.array(z.string().trim().min(1).max(8)).min(2).max(2),
    note: z.string().max(300).default(''),
  })).max(4).default([]),
}).optional();

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
  knowledge: modelKnowledgeSchema,
});

const isoDatetime = z.iso.datetime({ offset: true });

export const knowledgeCitationSchema = z.object({
  chunkId: z.string(),
  entryId: z.string(),
  scope: z.enum(knowledgeScopes),
  title: z.string(),
  version: z.number().int(),
  locationLabel: z.string(),
  quote: z.string(),
});

export const knowledgeConflictSchema = z.object({
  topic: z.string(),
  sides: z.array(z.object({
    title: z.string(),
    scope: z.enum(knowledgeScopes),
    quote: z.string(),
  })).length(2),
  note: z.string(),
});

export const knowledgeAnalysisSchema = z.object({
  used: z.boolean(),
  summary: z.string(),
  citations: z.array(knowledgeCitationSchema),
  conflicts: z.array(knowledgeConflictSchema),
  partial: z.boolean().default(false),
  note: z.string().default(''),
});

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
  knowledge: knowledgeAnalysisSchema.optional(),
});

export type ParseRequest = z.infer<typeof parseRequestSchema>;
export type ParseResponse = z.infer<typeof parseResponseSchema>;
