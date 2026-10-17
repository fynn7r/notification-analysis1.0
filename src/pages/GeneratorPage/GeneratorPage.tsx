import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { capabilityClient } from '@lark-apaas/client-toolkit-lite';
import { motion } from 'framer-motion';
import {
  FilePenLine,
  Sparkles,
  Copy,
  Check,
  Loader2,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { NotificationCopyGeneratorOneOutput } from '@shared/plugin-types';
import { PLUGIN_NOTIFICATION_GENERATE } from '@/lib/plugin-instances';
import { IS_STANDALONE } from '@/lib/parse-api';
import { generateWithApi } from '@/lib/generate-api';
import type { GenerateRequest } from '@shared/generate-contract';

const STYLES = [
  { value: '官方正式风', label: '官方正式风', desc: '学校/单位官方通知，措辞严谨' },
  { value: '班级通知风', label: '班级通知风', desc: '班委/班长口吻，亲切简洁' },
  { value: '社团活动风', label: '社团活动风', desc: '活泼有趣，吸引同学参与' },
  { value: '社区通知风', label: '社区通知风', desc: '居民社区/业主群，通俗易懂' },
] as const;

const SAMPLE_FORM = {
  topic: '校园摄影大赛报名',
  activityType: '比赛竞赛',
  time: '2025年5月15日 - 2025年6月10日',
  location: '大学生活动中心 / 线上提交',
  participants: '全校在校学生',
  registrationMethod: '扫描海报二维码报名，或登录校团委官网填写报名表',
  requirements:
    '作品需为原创，每人限投3张；格式为JPG，单张不超过10MB；题材不限，需附上拍摄说明（100字以内）',
  notes:
    '一等奖1名奖金1000元+证书；二等奖3名奖金500元+证书；三等奖6名奖金200元+证书；优秀奖20名证书',
  deadline: '2025年5月31日 23:59',
};

export default function GeneratorPage() {
  const [form, setForm] = useState({
    topic: '',
    activityType: '',
    time: '',
    location: '',
    participants: '',
    registrationMethod: '',
    requirements: '',
    notes: '',
    deadline: '',
  });
  const [style, setStyle] = useState<GenerateRequest['style']>('官方正式风');
  const [enableEmoji, setEnableEmoji] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const [copied, setCopied] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [generationError, setGenerationError] = useState('');

  const handleChange = useCallback(
    (field: keyof typeof form, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const loadSample = useCallback(() => {
    setForm(SAMPLE_FORM);
    setStyle('社团活动风');
    setEnableEmoji(true);
    setGeneratedText('');
    setHasGenerated(false);
    setGenerationError('');
    toast.success('已加载示例：校园摄影大赛');
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!form.topic.trim()) {
      toast.error('请填写通知主题');
      return;
    }
    if (!form.time.trim()) {
      toast.error('请填写活动时间');
      return;
    }
    if (!form.location.trim()) {
      toast.error('请填写活动地点');
      return;
    }
    if (!form.participants.trim()) {
      toast.error('请填写参加对象');
      return;
    }

    setGenerating(true);
    setGeneratedText('');
    setHasGenerated(true);
    setGenerationError('');
    setCopied(false);

    try {
      let full = '';
      if (IS_STANDALONE) {
        full = await generateWithApi({ ...form, style, enableEmoji });
      } else {
        const stream = capabilityClient
          .load(PLUGIN_NOTIFICATION_GENERATE)
          .callStream<NotificationCopyGeneratorOneOutput>('textGenerate', {
            topic: form.topic,
            activity_type: form.activityType || '活动',
            time: form.time,
            location: form.location,
            participants: form.participants,
            registration_method: form.registrationMethod || '待定',
            requirements: form.requirements || '无',
            notes: [form.notes, form.deadline && `截止时间：${form.deadline}`].filter(Boolean).join('\n') || '无',
            style,
            enable_emoji: enableEmoji ? '是' : '否',
          });

        for await (const chunk of stream) {
          if (chunk.content) {
            full += chunk.content;
            setGeneratedText(full);
          }
        }
      }

      if (!full.trim()) throw new Error('模型没有返回通知文案，填写内容已保留，请重试。');
      setGeneratedText(full);
      toast.success('通知文案生成完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知生成失败，填写内容已保留，请重试。';
      setGenerationError(message);
      setGeneratedText('');
      setHasGenerated(false);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }, [form, style, enableEmoji]);

  const handleCopy = useCallback(async () => {
    if (!generatedText) return;
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopied(true);
      toast.success('已复制全文');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  }, [generatedText]);

  const handleReset = useCallback(() => {
    setForm({
      topic: '',
      activityType: '',
      time: '',
      location: '',
      participants: '',
      registrationMethod: '',
      requirements: '',
      notes: '',
      deadline: '',
    });
    setGeneratedText('');
    setHasGenerated(false);
    setGenerationError('');
    setStyle('官方正式风');
    setEnableEmoji(false);
  }, []);

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              通知生成器
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              填写关键信息，一键生成不同风格的正式通知文案
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={loadSample} disabled={generating}>
              <Wand2 className="mr-1.5 size-4" />
              加载示例
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={generating}>
              <RotateCcw className="mr-1.5 size-4" />
              重置
            </Button>
          </div>
        </div>

        {IS_STANDALONE && <p className="mb-4 text-sm text-muted-foreground">通过已配置的真实模型生成。
          <Link to="/profile#model-access" className="ml-2 text-primary underline underline-offset-4">配置模型 / 查看额度</Link>
        </p>}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* 左侧表单 */}
          <div className="space-y-4 lg:col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">基础信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      通知主题 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      aria-label="通知主题"
                      disabled={generating}
                      placeholder="如：校园摄影大赛报名通知"
                      value={form.topic}
                      onChange={(e) => handleChange('topic', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      活动类型
                    </Label>
                    <Input
                      aria-label="活动类型"
                      disabled={generating}
                      placeholder="如：比赛/讲座/会议"
                      value={form.activityType}
                      onChange={(e) => handleChange('activityType', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      活动时间 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      aria-label="活动时间"
                      disabled={generating}
                      placeholder="如：2025年5月20日 14:00"
                      value={form.time}
                      onChange={(e) => handleChange('time', e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      活动地点 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      aria-label="活动地点"
                      disabled={generating}
                      placeholder="如：大学生活动中心"
                      value={form.location}
                      onChange={(e) => handleChange('location', e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      参加对象 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      aria-label="参加对象"
                      disabled={generating}
                      placeholder="如：全校在校学生"
                      value={form.participants}
                      onChange={(e) => handleChange('participants', e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">详情信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    报名方式
                  </Label>
                  <Input
                    aria-label="报名方式"
                    disabled={generating}
                    placeholder="如：扫描二维码报名 / 线上填写报名表"
                    value={form.registrationMethod}
                    onChange={(e) => handleChange('registrationMethod', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    截止时间
                  </Label>
                  <Input
                    aria-label="截止时间"
                    disabled={generating}
                    placeholder="如：2025年5月31日 23:59"
                    value={form.deadline}
                    onChange={(e) => handleChange('deadline', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    作品/材料要求
                  </Label>
                  <Textarea
                    aria-label="作品/材料要求"
                    disabled={generating}
                    placeholder="描述参赛要求、提交格式、数量限制等"
                    className="min-h-[80px] resize-y text-sm"
                    value={form.requirements}
                    onChange={(e) => handleChange('requirements', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    注意事项 / 奖励说明
                  </Label>
                  <Textarea
                    aria-label="注意事项 / 奖励说明"
                    disabled={generating}
                    placeholder="如奖励设置、注意事项、联系方式等"
                    className="min-h-[80px] resize-y text-sm"
                    value={form.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 右侧：风格 + 预览 */}
          <div className="space-y-4 lg:col-span-2">
            <Card className="sticky top-20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  生成设置
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-2 block text-xs font-medium text-muted-foreground">
                    通知风格
                  </Label>
                  <div className="space-y-2">
                    {STYLES.map((s) => (
                      <button
                        key={s.value}
                        aria-pressed={style === s.value}
                        disabled={generating}
                        onClick={() => setStyle(s.value)}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                          style === s.value
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border hover:border-border/80 hover:bg-muted/30'
                        }`}
                      >
                        <div
                          className={`mt-0.5 size-4 shrink-0 rounded-full border-2 ${
                            style === s.value
                              ? 'border-primary bg-primary'
                              : 'border-border'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{s.label}</div>
                          <div className="text-xs text-muted-foreground">{s.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
                  <div>
                    <div className="text-sm font-medium">活泼风模式</div>
                    <div className="text-xs text-muted-foreground">
                      加入 ✅⏰📍 等表情符号
                    </div>
                  </div>
                  <Switch aria-label="活泼风模式" checked={enableEmoji} onCheckedChange={setEnableEmoji} disabled={generating} />
                </div>

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <FilePenLine className="mr-2 size-4" />
                      智能生成通知
                    </>
                  )}
                </Button>
                {generationError && (
                  <p role="alert" className="text-sm text-destructive">{generationError}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* 生成结果 */}
        {hasGenerated && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-6"
          >
            <Card className="border-primary/20">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3 pb-3 sm:flex-row">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FilePenLine className="size-4 text-primary" />
                  生成结果
                  <Badge variant="outline" className="text-xs font-normal">
                    {style}
                    {enableEmoji && ' · 活泼风'}
                  </Badge>
                </CardTitle>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopy}
                  disabled={!generatedText}
                >
                  {copied ? (
                    <>
                      <Check className="mr-1.5 size-4 text-emerald-500" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 size-4" />
                      复制全文
                    </>
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                {generating && !generatedText ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    <span className="ml-3 text-sm text-muted-foreground">
                      正在生成通知文案...
                    </span>
                  </div>
                ) : generatedText ? (
                  <div className="rounded-lg bg-muted/30 p-5">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground break-all">
                      {generatedText}
                    </pre>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}
