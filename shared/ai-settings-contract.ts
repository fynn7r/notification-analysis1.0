import { z } from 'zod';

const singleLine = z.string().trim().max(2000).refine((value) => !/[\r\n\0"\\]/.test(value), '配置不能包含换行、双引号或反斜杠');
const model = singleLine.refine((value) => !/\s/.test(value), '模型 ID 不能包含空格');
const url = singleLine.refine((value) => {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch { return false; }
}, '请填写完整的 HTTP 或 HTTPS 地址，不含密钥、查询参数或片段');

export const aiSettingsInputSchema = z.object({
  baseUrl: url.refine((value) => !/\/chat\/completions\/?$/.test(value), '填写基础地址，不要包含 /chat/completions'),
  apiKey: singleLine.default(''),
  model: model.refine((value) => !!value, '请填写默认模型 ID'),
  interpretationModel: model.default(''),
  generateModel: model.default(''),
  consoleUrl: z.union([z.literal(''), url]).default(''),
});
export const aiSettingsSchema = aiSettingsInputSchema.omit({ apiKey: true }).extend({
  configured: z.boolean(),
  balanceSupported: z.boolean(),
  maxOutputTokens: z.number(),
});
export const aiModelsSchema = z.object({ models: z.array(z.string().min(1).max(2000)).max(1000) });
const amount = z.string().regex(/^-?\d+(\.\d+)?$/);
export const aiBalanceSchema = z.object({
  available: z.boolean(),
  balances: z.array(z.object({ currency: z.enum(['CNY', 'USD']), total: amount, granted: amount, toppedUp: amount })).min(1),
  checkedAt: z.string(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type AiBalance = z.infer<typeof aiBalanceSchema>;
