import { interpretRequestSchema, interpretResponseSchema } from '@shared/interpret-contract';
import { AI_REQUEST_TIMEOUT_MS } from '@/lib/request-timeout';

export async function interpretWithApi(text: string, ruleContext: string) {
  const checked = interpretRequestSchema.safeParse({ text, ruleContext });
  if (!checked.success) throw new Error(checked.error.issues[0].message);
  let response: Response;
  try {
    response = await fetch('/api/interpret', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checked.data), signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  } catch { throw new Error('深度解读服务未连接或请求超时，请确认本地服务正在运行；原文和已有结果已保留。'); }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('深度解读服务返回内容无效；原文和已有结果已保留。'); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    throw new Error(error?.error?.message || '深度解读暂时不可用；原文和已有结果已保留。');
  }
  const result = interpretResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('深度解读格式无效；原文和已有结果已保留。');
  return result.data;
}
