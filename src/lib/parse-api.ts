import { parseResponseSchema } from '@shared/parse-contract';
import type { INotification } from '@/data/notification';
import { genId } from '@/lib/utils';
import { extractMediaLinks } from '@/lib/recurring-utils';

export const IS_STANDALONE = import.meta.env.VITE_STANDALONE === true || import.meta.env.VITE_STANDALONE === 'true';

export async function parseWithApi(text: string, referenceDate: string, timezone: string, existingId?: string): Promise<INotification> {
  let response: Response;
  try {
    response = await fetch('/api/parse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, referenceDate, timezone }), signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new Error('解析服务未连接或请求超时，原文已保留，请确认本地服务正在运行。');
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error('解析服务返回内容无效，原文已保留，请重试。'); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string } } | null;
    throw new Error(error?.error?.message || '解析服务暂时不可用，请重试。');
  }
  const checked = parseResponseSchema.safeParse(payload);
  if (!checked.success) throw new Error('解析结果格式无效，未保存结果，请重试。');
  const { notification, action, warnings, knowledge } = checked.data;
  return {
    ...notification,
    registrationDeadline: notification.registrationDeadline ?? undefined,
    eventStartTime: notification.eventStartTime ?? undefined,
    id: existingId || genId('parse'), rawText: text, source: 'real', parsedAt: Date.now(),
    importance: 'medium', importanceReason: '请核对待办动作和具体日期，可按个人需要调整重要程度。',
    primaryAction: { title: action.title || '', deadline: action.deadline ?? undefined, remindAt: action.remindAt ?? undefined },
    parseContext: { referenceDate, timezone }, timeWarnings: warnings,
    detectedMediaLinks: extractMediaLinks(text), mediaAttachments: [], supplements: [],
    ...(knowledge ? { knowledge } : {}),
  };
}
