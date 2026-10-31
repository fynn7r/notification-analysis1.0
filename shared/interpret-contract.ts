import { z } from 'zod';
import { knowledgeAnalysisSchema, modelKnowledgeSchema } from './parse-contract.ts';
import { MAX_NOTIFICATION_CHARS } from './limits.ts';

export const interpretRequestSchema = z.object({
  text: z.string().trim().min(1, '请先提供通知原文')
    .max(MAX_NOTIFICATION_CHARS, `通知原文暂限 ${MAX_NOTIFICATION_CHARS} 字以内`),
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
  knowledge: modelKnowledgeSchema,
});

/** 对外响应：knowledge 已由服务端换成可核验的条目身份。 */
export const interpretResponseSchema = interpretationSchema.omit({ knowledge: true }).extend({
  source: z.literal('real'),
  knowledge: knowledgeAnalysisSchema.optional(),
});
