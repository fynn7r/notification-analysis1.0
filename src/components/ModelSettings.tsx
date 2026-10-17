import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Cpu, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { aiSettingsInputSchema, type AiSettings, type AiSettingsInput, type AiBalance } from '@shared/ai-settings-contract';
import { getAiSettings, saveAiSettings, listAiModels, getAiBalance } from '@/lib/ai-settings-api';

export default function ModelSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [form, setForm] = useState<AiSettingsInput | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [balance, setBalance] = useState<AiBalance | null>(null);
  const [busy, setBusy] = useState('load');
  const [error, setError] = useState('');

  const acceptSettings = (value: AiSettings) => {
    setSettings(value);
    setForm({ baseUrl: value.baseUrl, model: value.model, interpretationModel: value.interpretationModel,
      generateModel: value.generateModel, consoleUrl: value.consoleUrl, apiKey: '' });
  };
  useEffect(() => {
    let active = true;
    getAiSettings().then((value) => { if (active) acceptSettings(value); })
      .catch((err: Error) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, []);

  const dirty = !!form && !!settings && (form.apiKey !== '' ||
    (['baseUrl', 'model', 'interpretationModel', 'generateModel', 'consoleUrl'] as const).some((key) => form[key] !== settings[key]));

  const operate = async (action: 'load' | 'save' | 'models' | 'balance') => {
    setBusy(action);
    setError('');
    try {
      if (action === 'load') acceptSettings(await getAiSettings());
      if (action === 'save' && form) {
        const checked = aiSettingsInputSchema.safeParse(form);
        if (!checked.success) throw new Error(checked.error.issues[0].message);
        acceptSettings(await saveAiSettings(checked.data));
        setModels(null);
        setBalance(null);
        toast.success('模型配置已保存，后续调用立即生效');
      }
      if (action === 'models') setModels((await listAiModels()).models);
      if (action === 'balance') {
        setBalance(null);
        setBalance(await getAiBalance());
      }
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败，请手动重试。'); }
    finally { setBusy(''); }
  };

  return (
    <Card id="model-access" className="mb-4 scroll-mt-20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Cpu className="size-4 text-primary" />模型接入</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">通知解析、话里有话深度解读、通知生成共用服务地址和密钥，可分别设置解读与生成模型。</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!form || !settings ? (
          busy ? <p role="status" className="text-sm text-muted-foreground">正在读取本地配置…</p>
            : <Button variant="outline" onClick={() => operate('load')}>重试连接</Button>
        ) : <>
          <p role="status" className="text-sm">密钥{settings.configured ? '已配置' : '未配置'} · 保存配置不会验证模型调用</p>
          <form onSubmit={(event) => { event.preventDefault(); void operate('save'); }}>
            <fieldset disabled={!!busy} className="min-w-0 space-y-3">
              <div>
                <Label htmlFor="ai-base-url">API 基础地址</Label>
                <Input id="ai-base-url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.deepseek.com" />
                <p className="mt-1 text-xs text-muted-foreground">支持 Chat Completions 与 JSON 模式的兼容服务；按服务商文档保留 /v1，不填 /chat/completions。</p>
              </div>
              <div>
                <Label htmlFor="ai-key">API 密钥</Label>
                <Input id="ai-key" type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={settings.configured ? '留空保留现有密钥' : '填写服务商提供的密钥'} />
                <p className="mt-1 text-xs text-muted-foreground">密钥仅保存于本机服务端 .env.local，不回显、不存入浏览器。更换服务商需填写新密钥。</p>
              </div>
              {([
                ['model', '默认模型（通知解析）', '填写服务商的模型 ID'],
                ['interpretationModel', '深度解读模型（可选）', '留空使用默认模型'],
                ['generateModel', '通知生成模型（可选）', '留空使用默认模型'],
              ] as const).map(([key, label, placeholder]) => <div key={key}>
                <Label htmlFor={`ai-${key}`}>{label}</Label>
                <Input id={`ai-${key}`} list="ai-model-list" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={placeholder} />
              </div>)}
              <datalist id="ai-model-list">{models?.map((model) => <option key={model} value={model} />)}</datalist>
              <div>
                <Label htmlFor="ai-console-url">服务商控制台地址（可选）</Label>
                <Input id="ai-console-url" value={form.consoleUrl} onChange={(event) => setForm({ ...form, consoleUrl: event.target.value })} placeholder="用于查看账单、额度和管理密钥" />
              </div>
              <Button type="submit">{busy === 'save' ? '保存中…' : '保存模型配置'}</Button>
            </fieldset>
          </form>
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="break-all">当前默认：{settings.model}；解读：{settings.interpretationModel || settings.model}；生成：{settings.generateModel || settings.model}</p>
            {dirty && <p className="text-muted-foreground">配置有未保存的修改，请先保存再查询。</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!!busy || dirty || !settings.configured} onClick={() => operate('models')}>{busy === 'models' ? '查询中…' : '读取可用模型'}</Button>
              <Button variant="outline" size="sm" disabled={!!busy || dirty || !settings.configured || !settings.balanceSupported} onClick={() => operate('balance')}>{busy === 'balance' ? '查询中…' : '查询账户余额'}</Button>
              {settings.consoleUrl && <a href={settings.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-4">打开服务商控制台<ExternalLink className="size-3" /></a>}
            </div>
            {models && !dirty && <p className="break-all">接口返回的模型：{models.length ? models.join('、') : '暂无模型，请查阅服务商文档'}</p>}
            {balance && !dirty && <div role="status" className="space-y-1">
              <p>{balance.available ? '账户余额可供调用' : '账户当前无可用余额'}</p>
              {balance.balances.map((item) => <p key={item.currency}>可用余额：{item.total} {item.currency}（赠金 {item.granted}，充值 {item.toppedUp}）</p>)}
              <p className="text-xs text-muted-foreground">查询时间：{new Date(balance.checkedAt).toLocaleString('zh-CN')}，再次查询可刷新。</p>
            </div>}
            <p className="text-xs text-muted-foreground">{settings.balanceSupported ? 'DeepSeek 余额由官方接口返回。' : '该服务商暂未接入余额查询，请填写控制台地址并前往查看。'}单次输出上限为 {settings.maxOutputTokens} token，与账户剩余额度不同。</p>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">接入与更换步骤</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>在服务商控制台创建 API 密钥，确认账户有可用额度。</li>
              <li>填写 API 基础地址、密钥、默认模型；按需单独填写解读和生成模型，然后保存。</li>
              <li>点击“读取可用模型”核对模型 ID；再到解析结果点“AI 解读”，或到通知生成页提交表单。成功生成才表示真实调用已验证。</li>
              <li>更换模型只需修改模型 ID 并保存，无需重启。更换服务商需一并更新地址、密钥和控制台地址。</li>
            </ol>
          </details>
        </>}
      </CardContent>
    </Card>
  );
}
