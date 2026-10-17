import { z } from 'zod';
import { aiSettingsSchema, aiModelsSchema, aiBalanceSchema, type AiSettingsInput } from '@shared/ai-settings-contract';

async function request<T>(path: string, schema: z.ZodType<T>, input?: unknown) {
  let response: Response;
  try {
    response = await fetch(`/api/ai/${path}`, {
      method: input === undefined ? 'GET' : 'POST',
      ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(45000),
    });
  } catch { throw new Error('无法连接模型配置服务，请确认本地服务正在运行。'); }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('模型配置服务返回内容无效，请手动重试。'); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    throw new Error(error?.error?.message || '操作失败，请手动重试。');
  }
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error('模型配置或账户信息格式无效，请手动重试。');
  return result.data;
}

export const getAiSettings = () => request('settings', aiSettingsSchema);
export const saveAiSettings = (input: AiSettingsInput) => request('settings', aiSettingsSchema, input);
export const listAiModels = () => request('models', aiModelsSchema, {});
export const getAiBalance = () => request('balance', aiBalanceSchema, {});
