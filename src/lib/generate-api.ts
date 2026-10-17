import { generateRequestSchema, generateResponseSchema, type GenerateRequest } from '@shared/generate-contract';

export async function generateWithApi(input: GenerateRequest): Promise<string> {
  const checked = generateRequestSchema.safeParse(input);
  if (!checked.success) throw new Error(checked.error.issues[0].message);
  let response: Response;
  try {
    response = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checked.data), signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new Error('通知生成服务未连接或请求超时，填写内容已保留，请确认本地服务正在运行。');
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('通知生成服务返回内容无效，填写内容已保留，请重试。'); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    throw new Error(error?.error?.message || '通知生成暂时不可用，填写内容已保留，请重试。');
  }
  const result = generateResponseSchema.safeParse(payload);
  if (!result.success) throw new Error('通知文案格式无效，填写内容已保留，请重试。');
  return result.data.content;
}
