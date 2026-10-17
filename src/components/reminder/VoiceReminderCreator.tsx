import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { toast } from 'sonner';
import {
  Mic,
  MicOff,
  Loader2,
  Clock,
  Sparkles,
  Target,
  AlertTriangle,
  RefreshCw,
  Globe,
  Lock,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useReminders } from '@/hooks/useReminders';
import { useRecurring } from '@/hooks/useRecurring';
import { Textarea } from '@/components/ui/textarea';
import { formatRecurringRule } from '@/lib/recurring-utils';
import { formatLocalDateTime } from '@/lib/date-utils';
import type { IReminder, IRecurringRule, RecurringType, ImportanceLevel } from '@/data/reminder';

// 语音识别 API 类型声明（浏览器原生 API，TS 标准库未包含）
interface SpeechRecognitionEventResult {
  0: { transcript: string };
  isFinal: boolean;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionEventResult>;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

// 麦克风错误类型
type MicErrorType =
  | 'not-supported'   // 浏览器不支持语音识别
  | 'not-https'       // 非 HTTPS 环境
  | 'not-allowed'     // 权限被拒绝
  | 'service-not-allowed' // 浏览器不允许识别服务
  | 'no-device'       // 没有麦克风设备
  | 'no-speech'       // 没检测到语音
  | 'network'         // 网络错误
  | 'unknown';        // 其他错误

interface MicErrorInfo {
  type: MicErrorType;
  title: string;
  description: string;
  steps?: string[];
  canRetry: boolean;
}

function getErrorInfo(errorType: MicErrorType): MicErrorInfo {
  switch (errorType) {
    case 'not-supported':
      return {
        type: 'not-supported',
        title: '当前浏览器不支持语音输入',
        description: '语音识别功能基于 Web Speech API，目前仅支持 Chrome 和 Edge 浏览器。',
        steps: [
          '请使用 Chrome 或 Edge 浏览器打开本页面',
          'Safari / Firefox 暂不支持语音识别功能',
        ],
        canRetry: false,
      };
    case 'not-https':
      return {
        type: 'not-https',
        title: '语音输入需要 HTTPS 环境',
        description: '出于安全考虑，浏览器只允许在 HTTPS 环境下访问麦克风。',
        steps: [
          '请确认当前网址以 https:// 开头',
          '本地开发时可使用 localhost（被视为安全来源）',
        ],
        canRetry: false,
      };
    case 'not-allowed':
      return {
        type: 'not-allowed',
        title: '麦克风权限已被拒绝',
        description: '你之前拒绝了麦克风权限，需要手动重新开启才能使用语音输入。',
        steps: [
          '点击浏览器地址栏左侧的 🔒 锁形或 🎤 麦克风图标',
          '在弹出的面板中找到「麦克风」，选择「允许」',
          '刷新页面后重新点击语音输入按钮',
        ],
        canRetry: true,
      };
    case 'no-device':
      return {
        type: 'no-device',
        title: '未检测到麦克风设备',
        description: '系统没有可用的麦克风设备，无法进行语音识别。',
        steps: [
          '检查麦克风是否正确连接到电脑',
          '确认系统设置中麦克风已启用',
          '检查浏览器是否有权限访问麦克风设备',
        ],
        canRetry: true,
      };
    case 'service-not-allowed':
      return {
        type: 'service-not-allowed',
        title: '浏览器不允许使用语音识别服务',
        description: '当前浏览器未允许使用语音识别服务，这与麦克风权限是不同的问题。文字输入仍可使用。',
        steps: ['可在系统 Chrome 或 Edge 中打开当前页面后再试', '也可改用文字输入创建提醒'],
        canRetry: false,
      };
    case 'no-speech':
      return {
        type: 'no-speech',
        title: '没有检测到语音',
        description: '麦克风正常，但没有检测到清晰的语音输入。',
        steps: [
          '请靠近麦克风，确保音量适中',
          '检查麦克风是否被其他程序占用',
          '确认系统麦克风没有静音',
        ],
        canRetry: true,
      };
    case 'network':
      return {
        type: 'network',
        title: '语音识别服务连接失败',
        description: '浏览器未能连接语音识别服务，具体原因尚未确定。文字输入仍可使用。',
        steps: ['可在系统 Chrome 或 Edge 中打开当前页面后再试', '也可改用文字输入，或使用“新建提醒”填写内容和时间'],
        canRetry: true,
      };
    default:
      return {
        type: 'unknown',
        title: '语音识别失败',
        description: '发生了未知错误，请重试。',
        canRetry: true,
      };
  }
}

interface VoiceReminderCreatorProps {
  onCreated?: (reminder: IReminder) => void;
  trigger?: React.ReactNode;
}

// —— 中文数字转换（用于时间解析） ——
// 支持 一~九、十、十一~十九、二十~二十九、两
const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function cnNumToArabic(s: string): number | null {
  if (s.length === 1) {
    if (s === '十') return 10;
    return CN_DIGIT[s] ?? null;
  }
  if (s.startsWith('十')) {
    const ones = CN_DIGIT[s[1]];
    return ones === undefined ? 10 : 10 + ones;
  }
  if (s.endsWith('十')) {
    const tens = CN_DIGIT[s[0]];
    return tens === undefined ? null : tens * 10;
  }
  if (s.includes('十')) {
    const tens = CN_DIGIT[s[0]];
    const ones = CN_DIGIT[s[2]];
    return tens === undefined || ones === undefined ? null : tens * 10 + ones;
  }
  return null;
}

// 把"点/时"前的中文数字替换为阿拉伯数字，例如"下午三点" → "下午3点"
function normalizeCnNumerals(text: string): string {
  return text.replace(/[一两二三四五六七八九十]{1,3}(?=[点时])/g, (m) => {
    const n = cnNumToArabic(m);
    return n === null ? m : String(n);
  });
}

// 解析自然语言时间
function parseNaturalLanguageReminder(
  text: string
): {
  title: string;
  time?: Date;
  recurring?: RecurringType;
  weekdays?: number[];
  importance: ImportanceLevel;
  note?: string;
} | null {
  if (!text.trim()) return null;

  let title = text;
  let time: Date | undefined;
  let recurring: RecurringType | undefined;
  let weekdays: number[] = [];
  let importance: ImportanceLevel = 'medium';

  // 识别重要程度
  if (/重要|紧急|务必|必须/.test(text)) {
    importance = 'high';
  } else if (/不重要|随便|可以/.test(text)) {
    importance = 'low';
  }

  // 周期识别：每天
  if (/每天|每日/.test(text)) {
    recurring = 'daily';
    title = title.replace(/每天[，,]?|每日[，,]?/g, '');
  }

  // 周期识别：每周 X
  const weekMatch = text.match(/每周([一二三四五六日天])/);
  if (weekMatch) {
    recurring = 'weekly';
    const dayMap: Record<string, number> = {
      '一': 1,
      '二': 2,
      '三': 3,
      '四': 4,
      '五': 5,
      '六': 6,
      '日': 0,
      '天': 0,
    };
    const day = dayMap[weekMatch[1]];
    if (day !== undefined) weekdays = [day];
    title = title.replace(/每周[一二三四五六日天][，,]?/g, '');
  }

  // 明天 / 今天
  const now = new Date();
  if (/明天/.test(text)) {
    time = new Date(now);
    time.setDate(time.getDate() + 1);
    title = title.replace(/明天[，,]?/g, '');
  } else if (/今天/.test(text)) {
    time = new Date(now);
    title = title.replace(/今天[，,]?/g, '');
  }

  // 几点几分（先做中文数字归一化，支持"下午三点/三点半/3点15分"）
  const normalized = normalizeCnNumerals(text);
  const timeMatch = normalized.match(
    /(下午|晚上|上午|早上|中午|凌晨)?(\d{1,2})[点时](半|(\d{1,2}))?\s*(分|分钟)?/
  );
  if (timeMatch) {
    let hour = parseInt(timeMatch[2], 10);
    const minute = timeMatch[3] === '半' ? 30 : timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;
    const period = timeMatch[1];

    if ((period === '下午' || period === '晚上') && hour < 12) {
      hour += 12;
    }
    if (period === '中午' && hour < 12) {
      hour = 12;
    }
    if (period === '凌晨' && hour === 12) {
      hour = 0;
    }

    if (!time) time = new Date(now);
    time.setHours(hour, minute, 0, 0);

    title = title.replace(
      /(下午|晚上|上午|早上|中午|凌晨)?\s*([一两二三四五六七八九十\d]{1,3})[点时](半|\d{0,2})\s*(分|分钟)?[钟]?[，,]?/g,
      ''
    );
  } else if (time && !recurring) {
    // 只说了"明天"但没说时间，默认上午9点
    time.setHours(9, 0, 0, 0);
  }

  // 清理标题中常见的触发词
  title = title
    .replace(/提醒我[，,]?/g, '')
    .replace(/记得[，,]?/g, '')
    .replace(/不要忘了[，,]?/g, '')
    .trim();

  if (!title) title = '未命名提醒';

  // 没有识别出时间也没周期，返回 null
  if (!time && !recurring) {
    return null;
  }

  // 周期提醒不需要具体 date
  if (recurring) {
    const timeOfDay = time
      ? `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
      : '09:00';
    // 用 note 字段携带 timeOfDay + weekdays 信息
    return {
      title,
      recurring,
      weekdays: weekdays.length > 0 ? weekdays : undefined,
      importance,
      note: timeOfDay,
    };
  }

  return {
    title,
    time,
    recurring,
    importance,
  };
}

export default function VoiceReminderCreator({
  onCreated,
  trigger,
}: VoiceReminderCreatorProps) {
  const [open, setOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsed, setParsed] = useState<ReturnType<
    typeof parseNaturalLanguageReminder
  > | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef('');
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const focusTextOnCloseRef = useRef(false);
  const inputId = useId();
  const { addReminder } = useReminders();
  const { addRecurring } = useRecurring();

  // 错误详情弹窗
  const [errorInfo, setErrorInfo] = useState<MicErrorInfo | null>(null);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  // 检查浏览器是否支持语音识别
  const isSpeechApiSupported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // 检查是否在安全上下文中（HTTPS 或 localhost）
  const isSecureContext =
    typeof window !== 'undefined' &&
    (window.isSecureContext || window.location.hostname === 'localhost');

  // 整体是否可用（基础支持 + 安全上下文）
  const isSupported = isSpeechApiSupported && isSecureContext;

  // 根据错误码映射到我们的错误类型
  const mapSpeechError = (error: string): MicErrorType => {
    switch (error) {
      case 'not-allowed':
        return 'not-allowed';
      case 'service-not-allowed':
        return 'service-not-allowed';
      case 'audio-capture':
        return 'no-device';
      case 'no-speech':
        return 'no-speech';
      case 'network':
        return 'network';
      default:
        return 'unknown';
    }
  };

  // 用 getUserMedia 主动申请麦克风权限
  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      setIsRequestingPermission(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 申请成功后立即停止轨道，释放麦克风
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErrorInfo(getErrorInfo('not-allowed'));
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setErrorInfo(getErrorInfo('no-device'));
      } else if (name === 'NotReadableError') {
        setErrorInfo(getErrorInfo('no-device'));
      } else {
        setErrorInfo(getErrorInfo('unknown'));
      }
      return false;
    } finally {
      setIsRequestingPermission(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    // 先检查基础支持
    if (!isSpeechApiSupported) {
      setErrorInfo(getErrorInfo('not-supported'));
      return;
    }
    if (!isSecureContext) {
      setErrorInfo(getErrorInfo('not-https'));
      return;
    }

    // 主动用 getUserMedia 申请权限，让用户看到标准浏览器权限弹窗
    const hasPermission = await requestMicrophonePermission();
    if (!hasPermission) {
      // requestMicrophonePermission 内部已经设置了 errorInfo
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setErrorInfo(getErrorInfo('not-supported'));
      return;
    }

    // 如果之前已有实例，先清理
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalText = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcriptText = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcriptText;
        } else {
          interimText += transcriptText;
        }
      }
      const full = finalText + interimText;
      setTranscript(full);
      transcriptRef.current = full;
      setParsed(null);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsRecording(false);
      const errorType = mapSpeechError(event.error);
      setErrorInfo(getErrorInfo(errorType));
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    // 识别产生内容前保留已输入文字，避免连接失败时丢失输入。
    setParsed(null);
    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
      setErrorInfo(getErrorInfo('unknown'));
    }
  }, [isSpeechApiSupported, isSecureContext, requestMicrophonePermission]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsRecording(false);

    // 等一下让 final 结果都进来
    setTimeout(() => {
      processText();
    }, 500);
  }, []);

  const handleRetry = useCallback(() => {
    setErrorInfo(null);
    startRecording();
  }, [startRecording]);

  const closeErrorDialog = useCallback(() => {
    setErrorInfo(null);
  }, []);

  const processText = useCallback(() => {
    const text = transcriptRef.current.trim();
    if (!text) {
      toast.error('请输入或录入提醒内容');
      return;
    }
    setIsProcessing(true);
    const result = parseNaturalLanguageReminder(text);
    setParsed(result);
    setIsProcessing(false);

    if (!result) {
      toast.warning('未能识别出时间，请补充如“明天下午三点”，或使用“新建提醒”填写时间');
    }
  }, []);

  const handleCreate = useCallback(() => {
    if (!parsed) return;

    const now = new Date();

    if (parsed.recurring) {
      // 周期提醒 — 创建周期规则 + 首个一次性提醒
      const timeOfDay = parsed.note || '09:00';

      // 1. 创建周期规则
      const newRule = addRecurring({
        title: parsed.title,
        type: parsed.recurring,
        timeOfDay,
        weekdays: parsed.weekdays,
        dayOfMonth: undefined,
        intervalDays: undefined,
        importance: parsed.importance,
        note: '',
      });

      // 2. 计算下一次提醒时间并创建一次性提醒
      const reminderTime = new Date();
      const [h, m] = timeOfDay.split(':').map(Number);
      reminderTime.setHours(h, m, 0, 0);

      // 如果今天的时间已过，设为明天
      if (reminderTime <= now) {
        reminderTime.setDate(reminderTime.getDate() + 1);
        // weekly: 找下一个匹配的星期
        if (parsed.recurring === 'weekly' && parsed.weekdays?.length) {
          let guard = 0;
          while (!parsed.weekdays!.includes(reminderTime.getDay()) && guard < 14) {
            reminderTime.setDate(reminderTime.getDate() + 1);
            guard++;
          }
        }
      }

       const newReminder = addReminder({
         notificationId: '',
         title: parsed.title,
         type: '周期提醒',
         importance: parsed.importance,
         deadline: formatLocalDateTime(reminderTime),
         remindAt: formatLocalDateTime(reminderTime),
         remindOffset: '准时',
         source: 'personal',
         recurringType: parsed.recurring,
         recurringRuleId: newRule.id,
         note: `周期：${formatRecurringRule({
           id: newRule.id,
           title: parsed.title,
           type: parsed.recurring,
           timeOfDay,
           weekdays: parsed.weekdays,
           importance: parsed.importance,
           paused: false,
           createdAt: Date.now(),
         })}`,
       });

       toast.success('提醒已创建');
       onCreated?.(newReminder);
       setOpen(false);
       setTranscript('');
       setParsed(null);
    } else if (parsed.time) {
      const timeStr = formatLocalDateTime(parsed.time);

      const newReminder = addReminder({
        title: parsed.title,
        type: '个人提醒',
        importance: parsed.importance,
        deadline: timeStr,
        remindAt: timeStr,
        remindOffset: '准时',
        source: 'personal',
        note: parsed.note,
      });

      toast.success('提醒已创建');
      onCreated?.(newReminder);
      setOpen(false);
      setTranscript('');
      setParsed(null);
    }
  }, [parsed, addReminder, addRecurring, onCreated]);

  useEffect(() => {
    if (!open) {
      setTranscript('');
      transcriptRef.current = '';
      setParsed(null);
      setIsRecording(false);
      setErrorInfo(null);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
    }
  }, [open]);

  useEffect(() => {
    if (parsed) previewRef.current?.scrollIntoView({ block: 'nearest' });
  }, [parsed]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
         {trigger || (
           <Button variant="secondary">
             <Mic className="mr-2 size-4" />
             语音创建
           </Button>
         )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            语音创建提醒
          </DialogTitle>
          <DialogDescription>
            说一句话，或直接输入文字，识别内容和时间后核对创建提醒
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto py-2">
          {/* 录音区 */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-8">
             <button
               type="button"
               aria-label={isRecording ? '结束语音录入' : '开始语音录入'}
               onClick={isRecording ? stopRecording : startRecording}
               disabled={!isSupported || isRequestingPermission}
               className={`relative flex size-20 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                 isRecording
                   ? 'bg-red-500 text-white'
                   : 'bg-primary text-primary-foreground hover:bg-primary/90'
               }`}
             >
              {isRecording && (
                <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-50" />
              )}
              {isRecording ? (
                <MicOff className="relative size-8" />
              ) : (
                <Mic className="relative size-8" />
              )}
            </button>
            <p className="mt-3 text-sm font-medium">
              {isRecording ? '正在聆听...点击结束' : '点击开始说话'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
           例如："明天下午三点提醒我交作业"
             </p>
           </div>

           {/* 录音按钮状态提示 */}
           {isRequestingPermission && (
             <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
               <Loader2 className="size-3.5 animate-spin" />
               正在申请麦克风权限...
             </div>
           )}

           {/* 不可用提示（浏览器不支持 / 非 HTTPS） */}
           {!isSupported && (
             <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
               <AlertTriangle className="mt-0.5 size-4 shrink-0" />
               <div className="text-xs leading-relaxed">
                 <p className="font-medium">
                   {!isSpeechApiSupported
                     ? '当前浏览器不支持语音识别'
                     : '语音输入需要 HTTPS 环境'}
                 </p>
                 <p className="mt-1 text-amber-700">
                   {!isSpeechApiSupported
                     ? '可直接在下方输入文字，也可使用系统 Chrome 或 Edge 浏览器尝试语音。'
                     : '可直接在下方输入文字；语音需使用 https:// 或本地安全来源。'}
                 </p>
               </div>
             </div>
           )}

          {/* 识别失败或不支持语音时也可直接输入文字 */}
            <div className="space-y-1.5">
              <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
                提醒内容（可语音录入或直接填写）
              </label>
              <Textarea
                id={inputId}
                ref={textInputRef}
                value={transcript}
                disabled={isRecording || isRequestingPermission}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  transcriptRef.current = e.target.value;
                  setParsed(null);
                }}
                className="min-h-[80px] resize-y text-sm leading-relaxed"
                placeholder="例如：明天下午三点提醒我交作业"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={processText}
                disabled={!transcript.trim() || isRecording || isRequestingPermission || isProcessing}
              >
                解析文字
              </Button>
            </div>

          {/* 解析结果 */}
          {isProcessing && (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/30 p-4">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">智能解析中...</span>
            </div>
          )}

          {parsed && !isProcessing && (
            <div ref={previewRef} className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-medium text-primary">
                <Target className="mr-1 inline size-3.5" />
                解析结果预览
              </p>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">标题：</span>
                  <span className="font-medium">{parsed.title}</span>
                </div>
                {parsed.time && (
                  <div className="flex items-center gap-1">
                    <Clock className="size-3 text-muted-foreground" />
                    <span className="text-muted-foreground">时间：</span>
                    <span className="font-medium">
                      {parsed.time.toLocaleString('zh-CN')}
                    </span>
                  </div>
                )}
                {parsed.recurring && (
                  <div>
                    <span className="text-muted-foreground">周期：</span>
                    <span className="font-medium">
                      {parsed.recurring === 'daily' && '每天'}
                      {parsed.recurring === 'weekly' &&
                        `每周 ${['日', '一', '二', '三', '四', '五', '六'][
                          parsed.weekdays?.[0] ?? 0
                        ]}`}
                      {parsed.recurring === 'monthly' && '每月'}
                      {parsed.recurring === 'everyNDays' && '每N天'}
                      {parsed.note && ` ${parsed.note}`}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">重要程度：</span>
                  <span
                    className={
                      parsed.importance === 'high'
                        ? 'text-red-500'
                        : parsed.importance === 'medium'
                          ? 'text-amber-500'
                          : 'text-emerald-500'
                    }
                  >
                    {parsed.importance === 'high'
                      ? '高'
                      : parsed.importance === 'medium'
                        ? '中'
                        : '低'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={!parsed || isProcessing || isRecording || isRequestingPermission}>
            创建提醒
          </Button>
        </DialogFooter>
       </DialogContent>

       {/* 麦克风错误详情弹窗 */}
       <Dialog open={!!errorInfo} onOpenChange={(v) => !v && closeErrorDialog()}>
         <DialogContent
           className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
           onCloseAutoFocus={(event) => {
             if (focusTextOnCloseRef.current) {
               event.preventDefault();
               focusTextOnCloseRef.current = false;
               textInputRef.current?.focus();
             }
           }}
         >
           <DialogHeader>
             <DialogTitle className="flex items-center gap-2">
               {errorInfo?.type === 'not-supported' && (
                 <Globe className="size-5 text-amber-500" />
               )}
               {errorInfo?.type === 'not-https' && (
                 <Lock className="size-5 text-amber-500" />
               )}
               {(errorInfo?.type === 'not-allowed' ||
                 errorInfo?.type === 'service-not-allowed' ||
                 errorInfo?.type === 'no-device' ||
                 errorInfo?.type === 'no-speech' ||
                 errorInfo?.type === 'network' ||
                 errorInfo?.type === 'unknown') && (
                 <AlertTriangle className="size-5 text-amber-500" />
               )}
               {errorInfo?.title}
             </DialogTitle>
             <DialogDescription>{errorInfo?.description}</DialogDescription>
           </DialogHeader>

           {errorInfo?.steps && errorInfo.steps.length > 0 && (
             <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4">
               <p className="text-xs font-medium text-foreground">解决办法：</p>
               <ol className="space-y-1.5 text-xs text-muted-foreground">
                 {errorInfo.steps.map((step, idx) => (
                   <li key={idx} className="flex gap-2 leading-relaxed">
                     <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                       {idx + 1}
                     </span>
                     <span className="flex-1">{step}</span>
                   </li>
                 ))}
               </ol>
             </div>
           )}

           <DialogFooter>
             <Button variant="outline" onClick={() => {
               focusTextOnCloseRef.current = true;
               closeErrorDialog();
             }}>
               改用文字输入
             </Button>
             {errorInfo?.canRetry && (
               <Button onClick={handleRetry} disabled={isRequestingPermission}>
                 {isRequestingPermission ? (
                   <>
                     <Loader2 className="mr-2 size-4 animate-spin" />
                     申请中...
                   </>
                 ) : (
                   <>
                     <RefreshCw className="mr-2 size-4" />
                     重试
                   </>
                 )}
               </Button>
             )}
           </DialogFooter>
         </DialogContent>
       </Dialog>
     </Dialog>
  );
}
