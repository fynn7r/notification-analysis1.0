import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCcw,
  ChevronLeft,
  Plus,
  Play,
  Pause,
  Trash2,
  X,
  CalendarClock,
  Clock,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useRecurring } from '@/hooks/useRecurring';
import ImportanceBadge from '@/components/common/ImportanceBadge';
import { formatRecurringRule, getNextRecurringTime } from '@/lib/recurring-utils';
import { formatDateTime, formatLocalDateTime } from '@/lib/date-utils';
import type { RecurringType, ImportanceLevel } from '@/data/reminder';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const WEEKDAY_OPTIONS = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
];

interface RecurringDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function RecurringDrawer({ open, onClose }: RecurringDrawerProps) {
  const { recurringRules, addRecurring, togglePause, deleteRecurring, loading } =
    useRecurring();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 新建表单状态
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<RecurringType>('daily');
  const [newTime, setNewTime] = useState('08:00');
  const [newWeekdays, setNewWeekdays] = useState<number[]>([1, 3, 5]);
  const [newDayOfMonth, setNewDayOfMonth] = useState(1);
  const [newInterval, setNewInterval] = useState(7);
  const [newImportance, setNewImportance] = useState<ImportanceLevel>('medium');
  const [newNote, setNewNote] = useState('');

  const activeCount = useMemo(
    () => recurringRules.filter((r) => !r.paused).length,
    [recurringRules]
  );

  const handleSubmit = () => {
    if (!newTitle.trim()) {
      toast.error('请输入提醒标题');
      return;
    }
    addRecurring({
      title: newTitle.trim(),
      type: newType,
      timeOfDay: newTime,
      weekdays: newType === 'weekly' ? newWeekdays : undefined,
      dayOfMonth: newType === 'monthly' ? newDayOfMonth : undefined,
      intervalDays: newType === 'everyNDays' ? newInterval : undefined,
      importance: newImportance,
      note: newNote.trim() || undefined,
    });
    toast.success('周期提醒已创建');
    setDialogOpen(false);
    // 重置表单
    setNewTitle('');
    setNewType('daily');
    setNewTime('08:00');
    setNewWeekdays([1, 3, 5]);
    setNewDayOfMonth(1);
    setNewInterval(7);
    setNewImportance('medium');
    setNewNote('');
  };

  const toggleWeekday = (day: number) => {
    setNewWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />
          {/* 抽屉 */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed left-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-r border-border bg-background shadow-2xl"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <RefreshCcw className="size-4 text-primary" />
                <span className="font-medium">周期提醒</span>
                <Badge variant="secondary" className="text-xs">
                  {activeCount} 运行中
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-8"
              >
                <ChevronLeft className="size-4" />
              </Button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* 新建按钮 */}
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="mb-4 w-full">
                    <Plus className="mr-2 size-4" />
                    新建周期提醒
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>新建周期提醒</DialogTitle>
                    <DialogDescription>
                      设置重复规则，到点自动提醒
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        标题 <span className="text-destructive">*</span>
                      </label>
                      <Input
                        placeholder="如：每周组会、每日打卡"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          重复类型
                        </label>
                        <Select
                          value={newType}
                          onValueChange={(v) => setNewType(v as RecurringType)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">每天</SelectItem>
                            <SelectItem value="weekly">每周</SelectItem>
                            <SelectItem value="monthly">每月</SelectItem>
                            <SelectItem value="everyNDays">每N天</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          时间
                        </label>
                        <Input
                          type="time"
                          value={newTime}
                          onChange={(e) => setNewTime(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* 每周选项 */}
                    {newType === 'weekly' && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          选择星期
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAY_OPTIONS.map((d) => (
                            <button
                              key={d.value}
                              onClick={() => toggleWeekday(d.value)}
                              className={cn(
                                'flex h-9 w-9 items-center justify-center rounded-md border text-xs transition-all',
                                newWeekdays.includes(d.value)
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border bg-card hover:border-primary/50'
                              )}
                            >
                              {d.label.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 每月选项 */}
                    {newType === 'monthly' && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          每月第几天
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={newDayOfMonth}
                          onChange={(e) =>
                            setNewDayOfMonth(
                              Math.max(1, Math.min(31, Number(e.target.value) || 1))
                            )
                          }
                        />
                      </div>
                    )}

                    {/* 每 N 天选项 */}
                    {newType === 'everyNDays' && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                          间隔天数
                        </label>
                        <Input
                          type="number"
                          min={1}
                          value={newInterval}
                          onChange={(e) =>
                            setNewInterval(Math.max(1, Number(e.target.value) || 1))
                          }
                        />
                      </div>
                    )}

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        重要程度
                      </label>
                      <Select
                        value={newImportance}
                        onValueChange={(v) =>
                          setNewImportance(v as ImportanceLevel)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">高</SelectItem>
                          <SelectItem value="medium">中</SelectItem>
                          <SelectItem value="low">低</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                        备注
                      </label>
                      <Textarea
                        placeholder="可选，提醒时展示"
                        className="min-h-[60px] resize-y text-sm"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>
                      取消
                    </Button>
                    <Button onClick={handleSubmit}>创建</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* 列表 */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCcw className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : recurringRules.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <CalendarClock className="mb-3 size-10 text-muted-foreground/60" />
                    <p className="text-sm font-medium">暂无周期提醒</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      点击上方按钮创建第一个周期提醒
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {recurringRules.map((rule) => {
                    const nextTime = getNextRecurringTime(rule);
                    return (
                      <Card
                        key={rule.id}
                        className={cn(
                          'transition-all',
                          rule.paused && 'opacity-60'
                        )}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-medium">
                                  {rule.title}
                                </span>
                                <ImportanceBadge
                                  level={rule.importance}
                                  className="text-[10px]"
                                />
                                {rule.paused && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px]"
                                  >
                                    已暂停
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <RefreshCcw className="size-3" />
                                {formatRecurringRule(rule)}
                              </div>
                              {nextTime && !rule.paused && (
                                <div className="mt-1 flex items-center gap-1 text-[11px] text-primary">
                                  <Clock className="size-3" />
                                  下次：{formatLocalDateTime(nextTime)}
                                </div>
                              )}
                              {rule.note && (
                                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                  {rule.note}
                                </p>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-col gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => togglePause(rule.id)}
                                title={rule.paused ? '恢复' : '暂停'}
                              >
                                {rule.paused ? (
                                  <Play className="size-3.5 text-emerald-500" />
                                ) : (
                                  <Pause className="size-3.5 text-amber-500" />
                                )}
                              </Button>
                              <AlertDialog
                                open={deleteTarget === rule.id}
                                onOpenChange={(open) =>
                                  !open && setDeleteTarget(null)
                                }
                              >
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => setDeleteTarget(rule.id)}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      删除周期提醒
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      删除后将不再重复提醒，此操作不可恢复。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>取消</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => {
                                        deleteRecurring(rule.id);
                                        setDeleteTarget(null);
                                        toast.success('已删除');
                                      }}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      删除
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* 提示 */}
              <Card className="mt-4 border-amber-200 bg-amber-50/50">
                <CardContent className="p-3">
                  <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-700">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                    <span>网页应用关闭后无法响铃。请保持页面打开，或开启浏览器系统通知以接收提醒。</span>
                  </p>
                </CardContent>
              </Card>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
