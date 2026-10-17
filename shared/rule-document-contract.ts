import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_RULE_CONTENT_CHARS = 200000;
export const MAX_RULE_LAYOUT_CHARS = 20 * 1024 * 1024;
export const ruleLayoutSchema = z.object({
  format: z.enum(['pdf', 'docx']),
  html: z.string().min(1).max(MAX_RULE_LAYOUT_CHARS),
  css: z.string().max(MAX_RULE_LAYOUT_CHARS),
});
export type RuleLayout = z.infer<typeof ruleLayoutSchema>;
export const ruleDocumentExtensions = /\.(pdf|docx?|txt)$/i;
export const ruleDocumentResponseSchema = z.object({
  filename: z.string().min(1),
  title: z.string().min(1),
  content: z.string().trim().min(1).max(MAX_RULE_CONTENT_CHARS),
  warnings: z.array(z.string()),
  layout: ruleLayoutSchema.optional(),
});
export type RuleDocumentResponse = z.infer<typeof ruleDocumentResponseSchema>;
