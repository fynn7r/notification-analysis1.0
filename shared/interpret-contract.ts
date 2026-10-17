import { z } from 'zod';

export const interpretRequestSchema = z.object({
  text: z.string().trim().min(1, '请先提供通知原文').max(20000, '通知原文暂限20000字以内'),
  ruleContext: z.string().max(60000, '规则库上下文暂限60000字以内').default(''),
});

export const interpretationSchema = z.object({
  original_notification_summary: z.string().trim().min(1).max(2000),
  interpretation_items: z.array(z.object({
    interpretation_content: z.string().trim().min(1).max(2000),
    action_suggestion: z.string().trim().min(1).max(1000),
    confidence: z.enum(['高', '中', '低']),
    remarks: z.string().max(1000).optional(),
    evidence: z.string().trim().min(1).max(2000),
  })).min(1).max(6),
  overall_suggestion: z.string().trim().min(1).max(2000),
});
export const interpretResponseSchema = interpretationSchema.extend({ source: z.literal('real') });
