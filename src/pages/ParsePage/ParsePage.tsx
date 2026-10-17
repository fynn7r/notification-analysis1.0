import { useState, useCallback, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { capabilityClient, logger } from '@lark-apaas/client-toolkit-lite';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Loader2,
  BellPlus,
  Copy,
  Check,
  FileText,
  ChevronDown,
  FilePlus,
  Trash2,
  X,
  Plus,
  History,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ParseResultCard from '@/components/parse/ParseResultCard';
import ReminderConfirmation, { type ConfirmedReminder } from '@/components/parse/ReminderConfirmation';
import { IS_STANDALONE, parseWithApi } from '@/lib/parse-api';
import { interpretWithApi } from '@/lib/interpret-api';
import { Link } from 'react-router-dom';
import { DEFAULT_TIMEZONE, dateInTimezone } from '@shared/date-time';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ImportanceBadge from '@/components/common/ImportanceBadge';
import { useRules } from '@/hooks/useRules';
import { useGoals } from '@/hooks/useGoals';
import { reminderStore, useReminders } from '@/hooks/useReminders';
import { useHistory } from '@/hooks/useHistory';
import type {
  NotificationStructuredParseOneOutput,
  NotificationRuleMatchAnalysisOneOutput,
  NotificationSummaryGeneratorOneOutput,
  NotificationImpliedMeaningInterpretationOneOutput,
} from '@shared/plugin-types';
import { MOCK_NOTIFICATION, INotification, type NotificationType, type ImportanceLevel, type IHistoryFullItem } from '@/data/notification';
import {
  PLUGIN_NOTIFICATION_PARSE,
  PLUGIN_SUMMARY,
  PLUGIN_RULE_MATCH,
  PLUGIN_IMPLIED_MEANING,
} from '@/lib/plugin-instances';
import { addOffsetToDeadline, parseSmartDate } from '@/lib/date-utils';
import { useDebouncedCallback } from '@/hooks/use-debounce';
import { getCurrentParseResult, useParseSession } from '@/hooks/useParseSession';
import { storage } from '@/lib/storage';
import { extractMediaLinks } from '@/lib/recurring-utils';
import type { IMediaAttachment, ISupplementRecord } from '@/data/notification';

const NOTIFICATION_TYPES: NotificationType[] = [
  '比赛竞赛',
  '讲座分享',
  '作业任务',
  '缴费事务',
  '活动会议',
  '招募报名',
  '其他',
];

const REMIND_OFFSETS = [
  { value: '2d', label: '截止前2天' },
  { value: '1d', label: '截止前1天' },
  { value: '3h', label: '截止前3小时' },
  { value: '1h', label: '截止前1小时' },
];

const SAMPLE_TEXT = MOCK_NOTIFICATION.rawText;

export default function ParsePage() {
  const { rules } = useRules();
  const { goals } = useGoals();
  const { addReminder, reminders } = useReminders();
  const { addHistory, updateHistoryItem, getHistoryById } = useHistory();

  const [inputText, setInputText] = useState('');
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [referenceDate, setReferenceDate] = useState(() => dateInTimezone(new Date()));
  const [apiStatus, setApiStatus] = useState('真实解析尚未验证：正在检查本地解析服务。');
  const [parseError, setParseError] = useState('');
  const [impliedError, setImpliedError] = useState('');

  useEffect(() => {
    if (!IS_STANDALONE) return;
    let active = true;
    fetch('/api/health').then(async (response) => {
      if (!response.ok) throw new Error('Service unavailable');
      const health = await response.json();
      if (active) setApiStatus(health.realParseVerified ? '本地解析服务已完成真实模型调用。' : health.configured
        ? '真实解析尚未验证：密钥已配置，请提交一条通知完成首次验证。'
        : '真实解析尚未验证：服务端尚未配置模型密钥。');
    }).catch(() => { if (active) setApiStatus('真实解析尚未验证：本地解析服务尚未连接。'); });
    return () => { active = false; };
  }, []);

  // 解析会话全局 store（路由切换不丢失，持久化到 localStorage）
  const {
    result,
    parsing,
    summaryText,
    impliedLoading,
    supplements,
    setResult,
    setParsing,
    setSummaryText,
    setImpliedLoading,
    addSupplement,
    removeSupplement,
    clearResult: handleClearResult,
  } = useParseSession();

  useEffect(() => {
    if (IS_STANDALONE && result?.parseContext?.referenceDate) setReferenceDate(result.parseContext.referenceDate);
  }, [result?.parseContext?.referenceDate]);

  useEffect(() => { setImpliedError(''); }, [result?.id, result?.rawText]);

  // 草稿持久化：初始化时从 storage 读取
  useEffect(() => {
    const draft = storage.getDraft('');
    if (draft) setInputText(draft);
  }, []);

  // 草稿持久化：输入防抖保存（500ms）
  const saveDraft = useDebouncedCallback((text: string) => {
    storage.setDraft(text);
  }, 500);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setInputText(val);
      saveDraft(val);
    },
    [saveDraft]
  );
  const [selectedOffset, setSelectedOffset] = useState('2d');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSample, setShowSample] = useState(true);
  const [supplementDialogOpen, setSupplementDialogOpen] = useState(false);
  const [supplementInput, setSupplementInput] = useState('');
  const [supplementsExpanded, setSupplementsExpanded] = useState(true);

  // 完整解析 pipeline（字段提取 + 规则匹配 + 重要程度判断）
  const runParsePipeline = useCallback(
    async (text: string, existingId?: string): Promise<INotification> => {
      if (IS_STANDALONE) return parseWithApi(text, referenceDate, DEFAULT_TIMEZONE, existingId);
      // 1. 调用通知结构化解析插件
      const parseResult = await capabilityClient
        .load(PLUGIN_NOTIFICATION_PARSE)
        .call<NotificationStructuredParseOneOutput>('textToJson', {
          notification_content: text,
        });

      // 2. 调用规则匹配插件
      let matchedRules: INotification['matchedRules'] = [];
      let importanceReason = '根据通知类型和内容自动判断';
      let importance: ImportanceLevel = 'medium';

      try {
        const matchResult = await capabilityClient
          .load(PLUGIN_RULE_MATCH)
          .call<NotificationRuleMatchAnalysisOneOutput>('aiCategorize', {
            notification_content: text,
          });

        const resultCategories = matchResult?.categories && matchResult.categories.length > 0
          ? matchResult.categories
          : matchResult?.categories_string
            ? [matchResult.categories_string]
            : [];

        if (resultCategories.length > 0) {
          const topCategory = resultCategories[0];
          if (topCategory && topCategory !== '无匹配') {
            // AI 返回的就是 categories 列表中的 name，精确匹配
            const matchedRule = rules.find((r) => r.category === topCategory);
            matchedRules = [
              {
                ruleId: matchedRule?.id || `matched-${Date.now()}`,
                ruleTitle: matchedRule?.title || topCategory,
                category: topCategory,
                score: matchedRule?.score,
                matchReason: `该通知属于「${topCategory}」类别，符合规则库中的相关加分条件。`,
                worthAttending:
                  topCategory.includes('一级') ||
                  topCategory.includes('二级') ||
                  Number(matchedRule?.score ?? 0) >= 3,
              },
            ];
          }
        }
      } catch {
        // 规则匹配失败不影响主流程
      }

      // 根据匹配和目标计算重要程度
      if (matchedRules.length > 0 && goals.length > 0) {
        importance = 'high';
        importanceReason = `匹配到规则「${matchedRules[0].ruleTitle}」，与你的目标（${goals.join('、')}）相关，建议重点关注`;
      } else if (parseResult.registration_deadline) {
        const deadline = parseSmartDate(parseResult.registration_deadline);
        if (deadline) {
          const daysLeft = (deadline.getTime() - Date.now()) / 86400000;
          if (daysLeft < 3) {
            importance = 'high';
            importanceReason = '报名截止时间临近，建议尽快处理';
          } else if (daysLeft < 7) {
            importance = 'medium';
            importanceReason = '报名截止时间较近，请注意时间安排';
          } else {
            importance = 'medium';
            importanceReason = '有较充足的准备时间，可按计划推进';
          }
        }
      }

      const notificationType = (parseResult.notification_type || '其他') as NotificationType;
      const validType = NOTIFICATION_TYPES.includes(notificationType)
        ? notificationType
        : '其他';

      const parsed: INotification = {
        id: existingId || `parse-${Date.now()}`,
        rawText: text,
        type: validType,
        title: parseResult.notification_type
          ? `${parseResult.notification_type}通知`
          : '通知',
        registrationDeadline: parseResult.registration_deadline || undefined,
        eventStartTime: parseResult.activity_time || undefined,
        location: parseResult.submission_location || undefined,
        targetAudience: parseResult.participants || undefined,
        requirements: parseResult.work_requirements || undefined,
        contact: parseResult.contact_information || undefined,
        links: parseResult.related_links
          ? parseResult.related_links.split(/[;；\n]/).filter(Boolean)
          : undefined,
        importance,
        importanceReason,
        matchedRules: matchedRules.length > 0 ? matchedRules : undefined,
        detectedMediaLinks: extractMediaLinks(text),
        mediaAttachments: [],
        supplements: [],
        source: 'real',
        parsedAt: Date.now(),
      };

      return parsed;
    },
    [rules, goals, referenceDate]
  );

  // 拼接原文 + 补充内容（带时间标记，补充内容优先级高于原文冲突信息）
  const buildFullText = useCallback(
    (rawText: string, supps: ISupplementRecord[]): string => {
      if (!supps || supps.length === 0) return rawText;
      const supplementParts = supps
        .sort((a, b) => a.addedAt - b.addedAt)
        .map((s, idx) => {
          const d = new Date(s.addedAt);
          const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          const isLatest = idx === supps.length - 1;
          const prefix = isLatest
            ? '【重要补充 · 最新更新 · 以此内容为准】'
            : '【补充通知】';
          return `${prefix}（补充于 ${timeStr}，第${idx + 1}条补充）\n${s.content}`;
        })
        .join('\n\n');
      return `${rawText}\n\n\n━━━━━━━━━━━━━━━━━━━━━\n以下为后续补充内容，请综合原文与补充内容进行解析，补充内容优先级高于原文中冲突的信息。\n━━━━━━━━━━━━━━━━━━━━━\n\n${supplementParts}`;
    },
    []
  );

  // 解析通知
  const handleParse = useCallback(async () => {
    const text = inputText.trim();
    if (!text) {
      toast.error('请先粘贴通知原文');
      return;
    }

    setParsing(true);
    setParseError('');
    storage.setDraft(text);
    setResult(null);
    setSummaryText('');

    try {
      // 首次解析也将补充内容与原文拼接后一并送入 AI
      const fullText = buildFullText(text, supplements);
      const parsed = await runParsePipeline(fullText);
      // 保留原始通知原文（输入框展示用，不被补充内容污染）
      parsed.rawText = text;
      // 保留补充记录
      parsed.supplements = supplements.length > 0 ? supplements : undefined;
      setResult(parsed);

      // 加入历史记录（保存完整解析结果）
      addHistory(parsed as unknown as IHistoryFullItem);
      if (IS_STANDALONE) {
        setApiStatus('本地解析服务已完成真实模型调用。');
        setRemindDialogOpen(true);
      }

      // 解析成功后清除草稿
      storage.setDraft('');

      toast.success('解析完成');
    } catch (error) {
      const message = IS_STANDALONE && error instanceof Error ? error.message : '解析失败，请重试';
      setParseError(message);
      toast.error(message);
    } finally {
      setParsing(false);
    }
  }, [inputText, runParsePipeline, addHistory, supplements, buildFullText]);

  // 生成摘要
  const handleGenerateSummary = useCallback(async () => {
    if (!result) return;
    setSummaryLoading(true);
    setSummaryText('');

    try {
      const summaryInput = `通知类型：${result.type}
重要程度：${result.importance}
标题：${result.title}
报名截止：${result.registrationDeadline || '未提及'}
活动时间：${result.eventStartTime || '未提及'}
地点：${result.location || '未提及'}
加分匹配：${result.matchedRules?.map((r) => `${r.ruleTitle} ${r.score || ''}`).join('、') || '无'}
要求：${result.requirements || '未提及'}`;

      if (IS_STANDALONE) {
        setSummaryText(summaryInput);
        return;
      }

      const stream = capabilityClient
        .load(PLUGIN_SUMMARY)
        .callStream<NotificationSummaryGeneratorOneOutput>('textSummary', {
          raw_notification_content: summaryInput,
        });

      let full = '';
      for await (const chunk of stream) {
        if (chunk.summary) {
          full += chunk.summary;
          setSummaryText(full);
        }
      }
    } catch {
      toast.error('摘要生成失败');
    } finally {
      setSummaryLoading(false);
    }
  }, [result]);

  // 复制摘要
  const handleCopySummary = useCallback(async () => {
    const text = summaryText || result?.summary || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  }, [summaryText, result]);

  // 添加提醒（同一通知同一偏移去重）
  const handleAddReminder = useCallback(() => {
    if (!result) return;
    const deadline = result.registrationDeadline || result.eventStartTime;
    if (!deadline) {
      toast.error('该通知没有明确的时间信息，无法生成提醒');
      return;
    }
    const deadlineDate = parseSmartDate(deadline);
    if (!deadlineDate) {
      toast.error('无法识别该时间格式，请在提醒事项页手动添加');
      return;
    }
    const offsetLabel = REMIND_OFFSETS.find((o) => o.value === selectedOffset)?.label || '截止前2天';
    const duplicated = reminders.some(
      (r) => r.notificationId === result.id && r.remindOffset === offsetLabel && !r.completed
    );
    if (duplicated) {
      toast.info('已存在相同时间的提醒，无需重复添加');
      setRemindDialogOpen(false);
      return;
    }
    const remindAt = addOffsetToDeadline(deadline, offsetLabel);

    addReminder({
      notificationId: result.id,
      title: result.title || result.type,
      type: result.type,
      importance: result.importance,
      deadline,
      remindAt,
      remindOffset: offsetLabel,
      source: 'notification',
    });

    setRemindDialogOpen(false);
    toast.success('已添加提醒');
  }, [result, selectedOffset, addReminder, reminders]);

  const handleConfirmReminder = (values: ConfirmedReminder) => {
    if (!result) return;
    const duplicated = reminderStore.getItems().some((item) => item.notificationId === result.id && item.deadline === values.deadline && item.remindAt === values.remindAt && !item.completed);
    if (duplicated) {
      toast.info('这条提醒已经保存，无需重复添加。');
      setRemindDialogOpen(false);
      return;
    }
    const updated: INotification = {
      ...result, registrationDeadline: values.deadline, eventStartTime: values.eventStartTime,
      primaryAction: { title: values.title, deadline: values.deadline, remindAt: values.remindAt }, timeWarnings: [],
    };
    const offsetMinutes = Math.round((new Date(values.deadline).getTime() - new Date(values.remindAt).getTime()) / 60000);
    const saved = addReminder({
      notificationId: result.id, title: values.title, type: result.type,
      importance: result.importance, deadline: values.deadline, remindAt: values.remindAt,
      timezone: result.parseContext?.timezone || DEFAULT_TIMEZONE,
      remindOffset: `截止前${offsetMinutes}分钟`, source: 'notification',
    });
    if (!storage.getReminders<Array<{ id: string }>>([]).some((item) => item.id === saved.id)) {
      reminderStore.deleteItem(saved.id);
      toast.error('待办未保存，请释放浏览器存储空间后重试。');
      return;
    }
    setResult(updated);
    updateHistoryItem(result.id, updated);
    setRemindDialogOpen(false);
    toast.success('待办已保存，可在提醒事项中查看。');
  };

  // 调整重要程度
  const handleChangeImportance = useCallback(
    (level: ImportanceLevel) => {
      if (!result) return;
      setResult({ ...result, importance: level });
    },
    [result]
  );

  // 话里有话深度解读
  const handleImpliedMeaning = useCallback(async () => {
    if (!result || impliedLoading) return;
    setImpliedLoading(true);
    setImpliedError('');

    try {
      const ruleContext = rules
        .map((r) => `【${r.category}${r.source === 'mock' ? '；示例规则，仅供演示' : ''}】${r.title}：${r.content}`)
        .join('\n\n');

      if (IS_STANDALONE) {
        const impliedMeaning = await interpretWithApi(result.rawText, ruleContext);
        const current = getCurrentParseResult();
        if (current?.id !== result.id || current.rawText !== result.rawText) return;
        setResult({ ...current, impliedMeaning });
        updateHistoryItem(result.id, { impliedMeaning });
        toast.success('深度解读完成');
        return;
      }

      const res = await capabilityClient
        .load(PLUGIN_IMPLIED_MEANING)
        .call<NotificationImpliedMeaningInterpretationOneOutput>('textToJson', {
          notification_content: result.rawText,
          rule_base_context: ruleContext,
        });

      setResult({
        ...result,
        impliedMeaning: {
          original_notification_summary: res.original_notification_summary || '',
          interpretation_items: Array.isArray(res.interpretation_items)
            ? res.interpretation_items.map((item: any) => ({
                interpretation_content: item.interpretation_content || '',
                action_suggestion: item.action_suggestion || '',
                confidence: (item.confidence as '高' | '中' | '低') || '中',
                remarks: item.remarks,
              }))
            : [],
          overall_suggestion: res.overall_suggestion || '',
          source: 'real',
        },
      });

      toast.success('深度解读完成');
    } catch (error) {
      const message = IS_STANDALONE && error instanceof Error ? error.message : '深度解读失败，请重试';
      setImpliedError(message);
      toast.error(message);
    } finally {
      setImpliedLoading(false);
    }
  }, [result, rules, impliedLoading, updateHistoryItem]);

  // 使用示例
  const handleUseSample = useCallback(() => {
    setInputText(SAMPLE_TEXT);
    // 示例默认不生成深度解读，让用户主动点击体验
    setResult({
      ...MOCK_NOTIFICATION,
      impliedMeaning: undefined,
    });
    setSummaryText(MOCK_NOTIFICATION.summary || '');
    setShowSample(false);
  }, []);

  // 从操作栏的对话框添加补充（已移至输入区对话框，逻辑复用 addSupplement）
  const handleConfirmSupplement = useCallback(() => {
    if (!supplementInput.trim()) {
      toast.error('请输入补充内容');
      return;
    }
    addSupplement(supplementInput.trim());
    setSupplementInput('');
    setSupplementDialogOpen(false);
    toast.success('补充已添加，将与原文一并解析');
  }, [supplementInput, addSupplement]);

  // 复制通知原文
  const handleCopyRawText = useCallback(async () => {
    if (!result?.rawText) return;
    try {
      await navigator.clipboard.writeText(result.rawText);
      toast.success('已复制通知原文');
    } catch {
      toast.error('复制失败');
    }
  }, [result]);

  // 添加媒体附件
  const handleAddMedia = useCallback(
    (attachments: IMediaAttachment[]) => {
      if (!result) return;
      setResult({
        ...result,
        mediaAttachments: [...(result.mediaAttachments || []), ...attachments],
      });
    },
    [result]
  );

  // 删除本地媒体附件（链接型附件来源于通知原文，不提供删除）
  const handleRemoveMedia = useCallback(
    (id: string) => {
      if (!result) return;
      setResult({
        ...result,
        mediaAttachments: (result.mediaAttachments || []).filter((a) => a.id !== id),
      });
    },
    [result]
  );

  // 重新解析：完整重跑 pipeline（字段提取 + 规则匹配 + 重要程度）
  const handleReParse = useCallback(async () => {
    if (!result) return;

    // 用会话级 supplements + 原文拼接，确保与首次解析逻辑一致
    const allText = buildFullText(result.rawText, supplements);

    logger.info('[ReParse] supplements count:', supplements.length);

    setParsing(true);
    setSummaryText('');

    try {
      const reParsed = await runParsePipeline(allText, result.id);
      // 保留已有附件（重新解析不丢附件）
      reParsed.mediaAttachments = result.mediaAttachments || [];
      // 保留补充记录（独立于 rawText，单独展示）
      reParsed.supplements = supplements.length > 0 ? supplements : undefined;
      // 保留原始通知原文（不被补充内容污染，输入框始终显示原始内容）
      reParsed.rawText = result.rawText;
      // 话里有话需要重新生成（内容变了）
      reParsed.impliedMeaning = undefined;

      logger.info('[ReParse] new registrationDeadline:', reParsed.registrationDeadline);

      setResult(reParsed);

      // 同步更新历史记录中的完整数据（按 id 精准更新，不整体覆盖）
      updateHistoryItem(reParsed.id, reParsed);

      toast.success('重新解析完成');
    } catch (err) {
      logger.error('[ReParse] failed:', String(err));
      toast.error(IS_STANDALONE && err instanceof Error ? err.message : '重新解析失败');
    } finally {
      setParsing(false);
    }
  }, [result, runParsePipeline, updateHistoryItem, supplements, buildFullText]);

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
        {/* 标题区 */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            粘贴通知，一键智能解析
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {IS_STANDALONE ? '提取需要完成的动作和截止时间，核对具体日期后保存待办' : '把班级群/社区群通知原文粘贴进来，自动提取关键信息并对照规则库判断重要程度'}
          </p>
        </div>

        {/* 输入卡 */}
        <Card className="mb-6 border-border/60 shadow-sm">
          <CardContent className="p-4 md:p-6">
             {IS_STANDALONE && (
               <div className="mb-4 space-y-3">
                 <p role="status" className="text-sm text-muted-foreground">{apiStatus}</p>
                 <Link to="/profile#model-access" className="inline-block text-sm text-primary underline underline-offset-4">配置模型 / 查看额度</Link>
                 <div className="space-y-1.5">
                   <Label htmlFor="parse-reference-date">通知参考日期</Label>
                   <Input id="parse-reference-date" type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} className="max-w-[220px]" disabled={parsing} />
                   <p className="text-xs text-muted-foreground">默认使用导入当天。“本周”从周一开始，按上海时区计算；旧通知请改为原消息日期。</p>
                 </div>
               </div>
             )}
             <Textarea
               aria-label="通知原文"
               value={inputText}
               onChange={handleInputChange}
               placeholder="粘贴班级群/社区群通知原文..."
               className="min-h-[160px] resize-y rounded-lg border-border/60 text-sm leading-relaxed focus-visible:ring-1 break-all"
             />
             {parseError && <p role="alert" className="mt-3 text-sm text-destructive">{parseError}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex-1 min-w-[180px] text-xs text-muted-foreground leading-relaxed">
                  {IS_STANDALONE ? <span>解析后请核对截止时间与活动时间，默认提前30分钟提醒。</span> : rules.length > 0 ? (
                    <span className="whitespace-normal break-all">
                      已加载 {rules.length} 条规则 · 目标：{goals.join('、')}
                    </span>
                  ) : (
                    <span>暂未导入规则库，建议先去「规则库」配置</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Dialog
                    open={supplementDialogOpen}
                    onOpenChange={(v) => {
                      setSupplementDialogOpen(v);
                      if (!v) setSupplementInput('');
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" type="button">
                        <FilePlus className="mr-1.5 size-4" />
                        追加补充
                        {supplements.length > 0 && (
                          <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                            {supplements.length}
                          </span>
                        )}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>追加补充内容</DialogTitle>
                        <DialogDescription>
                          粘贴负责人后续补充的通知内容（如新的截止时间、补充要求等），补充内容会与原文一起送入 AI 解析。
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3 py-2">
                        <Textarea
                          placeholder="例如：截止时间提前到4月25日下午6点；需要提交电子版和纸质版各一份..."
                          className="min-h-[120px] resize-y text-sm"
                          value={supplementInput}
                          onChange={(e) => setSupplementInput(e.target.value)}
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSupplementDialogOpen(false);
                            setSupplementInput('');
                          }}
                        >
                          取消
                        </Button>
                        <Button size="sm" onClick={handleConfirmSupplement}>
                          添加补充
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button onClick={handleParse} disabled={parsing || !inputText.trim()}>
                   {parsing ? (
                     <>
                       <Loader2 className="mr-2 size-4 animate-spin" />
                       解析中
                     </>
                   ) : (
                     <>
                       <Sparkles className="mr-2 size-4" />
                       智能解析
                     </>
                   )}
                 </Button>
               </div>
             </div>
           </CardContent>
         </Card>

         {/* 补充内容展示区 */}
         <AnimatePresence>
           {supplements.length > 0 && (
             <motion.div
               initial={{ opacity: 0, height: 0 }}
               animate={{ opacity: 1, height: 'auto' }}
               exit={{ opacity: 0, height: 0 }}
               transition={{ duration: 0.25 }}
               className="overflow-hidden mb-6"
             >
               <Card className="border-amber-200/60 bg-amber-50/30 shadow-sm">
                 <button
                   onClick={() => setSupplementsExpanded(!supplementsExpanded)}
                   className="flex w-full items-center justify-between px-4 py-3 text-left md:px-6"
                 >
                   <div className="flex items-center gap-2">
                     <History className="size-4 text-amber-600" />
                     <span className="text-sm font-medium text-amber-900">补充内容</span>
                     <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                       {supplements.length} 条
                     </Badge>
                     <span className="text-xs text-amber-700/70">解析时将与原文一并送入 AI</span>
                   </div>
                   {supplementsExpanded ? (
                     <ChevronUp className="size-4 text-amber-700" />
                   ) : (
                     <ChevronDown className="size-4 text-amber-700" />
                   )}
                 </button>
                 <AnimatePresence initial={false}>
                   {supplementsExpanded && (
                     <motion.div
                       initial={{ height: 0, opacity: 0 }}
                       animate={{ height: 'auto', opacity: 1 }}
                       exit={{ height: 0, opacity: 0 }}
                       transition={{ duration: 0.2 }}
                       className="overflow-hidden"
                     >
                       <CardContent className="space-y-2 border-t border-amber-200/60 px-4 pt-3 md:px-6">
                         {supplements.map((supp, idx) => (
                           <div
                             key={supp.id}
                             className="group relative rounded-lg border border-amber-200/60 bg-white/70 p-3"
                           >
                              <div className="mb-1.5 flex items-center justify-between">
                                <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                                  补充 {idx + 1}
                                </Badge>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="!absolute right-2 top-2 z-20 h-7 w-7 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => removeSupplement(supp.id)}
                                  aria-label="删除补充"
                                >
                                  <Trash2 className="size-3.5 text-muted-foreground" />
                                </Button>
                              </div>
                             <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-foreground/90 break-all pr-8">
                               {supp.content}
                             </pre>
                           </div>
                         ))}
                       </CardContent>
                     </motion.div>
                   )}
                 </AnimatePresence>
               </Card>
             </motion.div>
           )}
         </AnimatePresence>

         {/* 示例提示 */}
        <AnimatePresence>
          {showSample && !result && !parsing && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-6"
            >
              <Card className="border-dashed border-primary/30 bg-primary/[0.02]">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="size-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">想先试试效果？</div>
                      <div className="text-xs text-muted-foreground">
                        加载静态示例「数学建模竞赛通知」，仅预览界面，不代表真实解析成功
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleUseSample}>
                    加载示例
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 解析结果区 */}
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.3 }}
            >
              {/* 操作栏 */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">重要程度：</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2">
                        <ImportanceBadge level={result.importance} className="text-xs" />
                        <ChevronDown className="size-3 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-28">
                      {(['high', 'medium', 'low'] as ImportanceLevel[]).map((lv) => (
                        <DropdownMenuItem
                          key={lv}
                          onClick={() => handleChangeImportance(lv)}
                          className="text-sm"
                        >
                          <ImportanceBadge level={lv} className="text-xs" />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={handleClearResult}
                    type="button"
                  >
                    <Trash2 className="mr-1.5 size-3.5" />
                    清空结果
                  </Button>

                  {IS_STANDALONE ? (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setRemindDialogOpen(true)}>
                        <BellPlus className="mr-1.5 size-4" />核对并添加待办
                      </Button>
                      <ReminderConfirmation notification={result} open={remindDialogOpen} onOpenChange={setRemindDialogOpen} onSave={handleConfirmReminder} />
                    </>
                  ) : <Dialog open={remindDialogOpen} onOpenChange={setRemindDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="secondary" size="sm">
                        <BellPlus className="mr-1.5 size-4" />
                        添加提醒
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>添加提醒事项</DialogTitle>
                        <DialogDescription>
                          选择提醒时间，将在截止前提醒你
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">提醒时间</label>
                          <Select value={selectedOffset} onValueChange={setSelectedOffset}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {REMIND_OFFSETS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {result.registrationDeadline && (
                          <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                            截止时间：{result.registrationDeadline}
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setRemindDialogOpen(false)}>
                          取消
                        </Button>
                        <Button onClick={handleAddReminder}>确认添加</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateSummary}
                    disabled={summaryLoading}
                  >
                    {summaryLoading ? (
                      <>
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        生成中
                      </>
                    ) : (
                      <>生成摘要</>
                    )}
                  </Button>
                </div>
              </div>

              <ParseResultCard
                notification={result}
                onSupplement={addSupplement}
                onReParse={handleReParse}
                onAddMedia={handleAddMedia}
                onRemoveMedia={handleRemoveMedia}
                onGenerateImpliedMeaning={handleImpliedMeaning}
                impliedMeaningLoading={impliedLoading}
                impliedMeaningError={impliedError}
              />

              {/* 摘要卡 */}
              <AnimatePresence>
                {(summaryText || result.summary) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <Card className="mt-5 border-primary/20 bg-gradient-to-br from-primary/[0.03] to-transparent">
                      <CardContent className="flex items-start justify-between gap-4 p-5">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="border-primary/30 text-primary"
                            >
                              通知摘要
                            </Badge>
                          </div>
                           <pre className="whitespace-pre-wrap text-sm text-foreground leading-relaxed font-sans break-all">
                             {summaryText || result.summary}
                           </pre>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={handleCopySummary}
                          className="shrink-0"
                        >
                          {copied ? (
                            <Check className="size-4 text-emerald-500" />
                          ) : (
                            <Copy className="size-4" />
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
