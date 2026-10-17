import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

// 仅在独立 Vite 配置中替换平台工具包；平台入口继续使用原 SDK。
export const scopedStorage = window.localStorage;
export const logger = console;

export function UniversalLink({ to, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children?: ReactNode }) {
  return /^https?:\/\//i.test(to)
    ? <a href={to} {...props}>{children}</a>
    : <Link to={to} {...props}>{children}</Link>;
}

export const capabilityClient = {
  load: (_id: string) => ({
    async call<T>(_method: string, _input: unknown): Promise<T> {
      throw new Error('此功能暂未接入独立版，请先使用通知解析与待办功能。');
    },
    async *callStream<T>(_method: string, _input: unknown): AsyncGenerator<T> {
      yield await Promise.reject<T>(new Error('此功能暂未接入独立版，请先使用通知解析与待办功能。'));
    },
  }),
};
