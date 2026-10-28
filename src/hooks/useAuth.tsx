/**
 * 账号上下文。
 * 切换账号或退出时清空内存中的知识状态，避免 A 的数据残留到 B。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchSession, loginAccount, logoutAccount, registerAccount, setCsrfToken,
  type SessionUser,
} from '@/lib/knowledge-api';

interface AuthState {
  ready: boolean;
  user: SessionUser | null;
  hasUsers: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (input: { code: string; username: string; displayName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hasUsers, setHasUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 用于识别"这次响应回来时账号已经换了"
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const session = await fetchSession();
      if (current !== generation.current) return;
      setUser(session.user);
      setHasUsers(session.hasUsers);
      setCsrfToken(session.csrfToken);
      setError(null);
    } catch {
      if (current !== generation.current) return;
      setUser(null);
      setError('无法连接本地服务，账号与云端知识库暂不可用。');
    } finally {
      if (current === generation.current) setReady(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    generation.current += 1;
    const next = await loginAccount(username, password);
    setUser(next);
    setError(null);
  }, []);

  const register = useCallback(async (input: { code: string; username: string; displayName: string; password: string }) => {
    generation.current += 1;
    const next = await registerAccount(input);
    setUser(next);
    setError(null);
  }, []);

  const logout = useCallback(async () => {
    generation.current += 1;
    setUser(null);
    setCsrfToken(null);
    await logoutAccount().catch(() => { /* 本地已登出，忽略网络错误 */ });
  }, []);

  const value = useMemo<AuthState>(
    () => ({ ready, user, hasUsers, error, login, register, logout, refresh }),
    [ready, user, hasUsers, error, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
