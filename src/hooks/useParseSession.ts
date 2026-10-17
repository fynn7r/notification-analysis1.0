import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/storage';
import { genId } from '@/lib/utils';
import type { INotification, ISupplementRecord } from '@/data/notification';

/**
 * 当前解析会话 store —— 模块级单例，保证路由切换不丢失。
 * 持久化到 localStorage，刷新页面也能恢复上次的解析结果。
 *
 * 管理范围：输入框草稿之外的会话状态（解析结果、解析中标志、摘要文本、话里有话 loading 等）。
 * 输入框草稿已由 storage.draft 独立管理，这里不再重复。
 */

const STORAGE_KEY = '__app_notizhi_parse_session';

interface ParseSession {
  /** 解析结果（完整 INotification 对象） */
  result: INotification | null;
  /** 是否正在解析中 */
  parsing: boolean;
  /** 已生成的摘要文本（流式生成过程中持续更新） */
  summaryText: string;
  /** 话里有话是否正在加载 */
  impliedLoading: boolean;
  /** 补充内容列表（会话级，解析前也可添加，解析时一并送入 AI） */
  supplements: ISupplementRecord[];
  /** 上次更新时间戳 */
  updatedAt: number;
}

const initialSession: ParseSession = {
  result: null,
  parsing: false,
  summaryText: '',
  impliedLoading: false,
  supplements: [],
  updatedAt: 0,
};

// 模块级单例状态
let session: ParseSession = initialSession;
let initialized = false;
const listeners = new Set<(s: ParseSession) => void>();

function notify() {
  listeners.forEach((fn) => fn(session));
}

function init() {
  if (initialized) return;
  initialized = true;
  try {
    const raw = storage.getParseSession<ParseSession | null>(null);
    if (raw && raw.result) {
      // 恢复时解析中状态重置为 false（页面刷新后异步调用已中断）
      // supplements 字段兜底（兼容旧版存储数据无该字段的情况）
      session = {
        ...initialSession,
        ...raw,
        parsing: false,
        impliedLoading: false,
        supplements: raw.supplements ?? [],
      };
    }
  } catch {
    // ignore
  }
}

function persist() {
  try {
    storage.setParseSession(session);
  } catch {
    // ignore
  }
}

function updateSession(updates: Partial<ParseSession>) {
  init();
  session = { ...session, ...updates, updatedAt: Date.now() };
  persist();
  notify();
}

function clearSession() {
  init();
  session = { ...initialSession, updatedAt: Date.now() };
  persist();
  notify();
}

/** React hook：订阅当前解析会话 */
export function useParseSession() {
  const [state, setState] = useState<ParseSession>(session);

  useEffect(() => {
    init();
    const listener = (s: ParseSession) => setState(s);
    listeners.add(listener);
    // 同步最新值
    setState(session);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setResult = useCallback((result: INotification | null) => {
    updateSession({ result });
  }, []);

  const setParsing = useCallback((parsing: boolean) => {
    updateSession({ parsing });
  }, []);

  const setSummaryText = useCallback((summaryText: string) => {
    updateSession({ summaryText });
  }, []);

  const setImpliedLoading = useCallback((impliedLoading: boolean) => {
    updateSession({ impliedLoading });
  }, []);

  const addSupplement = useCallback((content: string) => {
    init();
    const newSupp: ISupplementRecord = {
      id: genId('supp'),
      content,
      addedAt: Date.now(),
    };
    updateSession({ supplements: [...session.supplements, newSupp] });
    // 同步写入 result（若已有解析结果），保持补充记录展示一致
    if (session.result) {
      session.result = {
        ...session.result,
        supplements: [...(session.result.supplements || []), newSupp],
      };
      persist();
      notify();
    }
    return newSupp;
  }, []);

  const removeSupplement = useCallback((id: string) => {
    init();
    const newSupps = session.supplements.filter((s) => s.id !== id);
    updateSession({ supplements: newSupps });
    if (session.result) {
      session.result = {
        ...session.result,
        supplements: (session.result.supplements || []).filter((s) => s.id !== id),
      };
      persist();
      notify();
    }
  }, []);

  const clearSupplements = useCallback(() => {
    init();
    updateSession({ supplements: [] });
    if (session.result) {
      session.result = { ...session.result, supplements: [] };
      persist();
      notify();
    }
  }, []);

  const clearResult = useCallback(() => {
    clearSession();
  }, []);

  return {
    result: state.result,
    parsing: state.parsing,
    summaryText: state.summaryText,
    impliedLoading: state.impliedLoading,
    supplements: state.supplements,
    setResult,
    setParsing,
    setSummaryText,
    setImpliedLoading,
    addSupplement,
    removeSupplement,
    clearSupplements,
    clearResult,
  };
}

/** 非 hook 场景下直接读取当前 result */
export function getCurrentParseResult(): INotification | null {
  init();
  return session.result;
}
