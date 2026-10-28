/**
 * 登录与邀请注册。
 * 没有账号时不能自助注册：必须由管理员生成邀请码。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { ApiFailure } from '@/lib/knowledge-api';

export default function LoginPage() {
  const { login, register, hasUsers, user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');

  if (user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-muted-foreground">已登录为 {user.displayName}</p>
        <div className="mt-4 flex justify-center gap-3">
          <Button onClick={() => navigate('/rules')}>前往知识库</Button>
          <Button variant="outline" onClick={() => void logout()}>退出登录</Button>
        </div>
      </div>
    );
  }

  async function submit(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      navigate('/rules', { replace: true });
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 py-10">
      <div>
        <h1 className="text-xl font-semibold">登录后使用双知识库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          登录后，你的个人资料只属于你；应用知识库由管理员统一维护，所有人只读。
          未登录仍然可以继续使用原来的本机规则。
        </p>
      </div>

      {!hasUsers && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">还没有任何账号</CardTitle>
            <CardDescription className="text-xs">
              首位管理员必须在电脑上运行
              <code className="mx-1 rounded bg-white px-1 py-0.5">node scripts/knowledge-admin.mjs init</code>
              创建，公网入口不提供自助注册。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Tabs value={tab} onValueChange={(value) => { setTab(value as 'login' | 'register'); setError(null); }}>
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">用邀请码注册</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-username">账号</Label>
                <Input id="login-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">密码</Label>
                <Input id="login-password" type="password" autoComplete="current-password" value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void submit(() => login(username, password)); }} />
              </div>
              <Button className="w-full" disabled={busy || !username || !password}
                onClick={() => void submit(() => login(username, password))}>
                {busy ? '登录中…' : '登录'}
              </Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reg-code">邀请码</Label>
                <Input id="reg-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="管理员提供，24 小时内有效" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-username">账号</Label>
                <Input id="reg-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3–32 位小写字母、数字" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-name">显示名称</Label>
                <Input id="reg-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">密码</Label>
                <Input id="reg-password" type="password" autoComplete="new-password" value={password}
                  onChange={(event) => setPassword(event.target.value)} placeholder="至少 12 位" />
              </div>
              <Button className="w-full" disabled={busy || !code || !username || !password}
                onClick={() => void submit(() => register({ code, username, displayName, password }))}>
                {busy ? '注册中…' : '注册并登录'}
              </Button>
            </TabsContent>
          </Tabs>

          {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
