import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 生成带前缀的唯一 id：优先使用 crypto.randomUUID（碰撞概率更低），
 * 环境不支持时回退到 Math.random。
 */
export function genId(prefix: string): string {
  let rand: string;
  try {
    rand =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
  } catch {
    rand = Math.random().toString(36).slice(2, 10);
  }
  return `${prefix}-${Date.now()}-${rand}`;
}
