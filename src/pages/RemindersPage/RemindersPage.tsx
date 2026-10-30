import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Plus, Check, Trash2, Clock, CalendarDays, CalendarPlus, User, AlertTriangle, Info, Loader2, Mic, Sparkles, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { useReminders } from '@/hooks/useReminders';
import ImportanceBadge from '@/components/common/ImportanceBadge';
import VoiceReminderCreator from '@/components/reminder/VoiceReminderCreator';
import { formatCountdown, getUrgency, formatDateTime, formatLocalDateTime, getSafeTime, parseSmartDate } from '@/lib/date-utils';
import { describeSkipped, downloadFromServer, downloadRemindersIcs } from '@/lib/export-ics';
import { useReminderSync, importLocalToServer, dismissPendingImport, retrySync } from '@/lib/reminder-sync';
import { useAuth } from '@/hooks/useAuth';
import type { ImportanceLevel } from '@/data/reminder';
import { cn } from '@/lib/utils';

type FilterTab = 'all' | 'pending' | 'completed';
type SourceFilter = 'all' | 'notification' | 'personal';

export default function RemindersPage() {
  const { reminders, loading, toggleComplete, deleteReminder, addReminder } =
    useReminders();
  const { user } = useAuth();
  const sync = useReminderSync();
  const [filter, setFilter] = useState<FilterTab>('pending');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // 新建表单
  const [newTitle, setNewTitle] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newImportance, setNewImportance] = useState<ImportanceLevel>('medium');
  const [newType, setNewType] = useState('个人提醒');
  const [newNote, setNewNote] = useState('');
  const [newOffset, setNewOffset] = useState('准时');

  const sortedReminders = useMemo(() => {
    let list = [...reminders];
    if (sourceFilter !== 'all') {
      list = list.filter((r) => r.source === sourceFilter);
    }
    return list.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return getSafeTime(a.deadline) - getSafeTime(b.deadline);
    });
  }, [reminders, sourceFilter]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sortedReminders;
    if (filter === 'pending') return sortedReminders.filter((r) => !r.completed);
    return sortedReminders.filter((r) => r.completed);
  }, [sortedReminders, filter]);

  const pendingCount = reminders.filter((r) => !r.completed).length;
  const completedCount = reminders.filter((r) => r.completed).length;
  const personalCount = reminders.filter((r) => r.source === 'personal').length;
  const notifCount = reminders.filter((r) => r.source === 'notification').length;

  const handleDelete = useCallback((id: string) => {
    deleteReminder(id);
    setDeleteTarget(null);
    toast.success('已删除提醒');
  }, [deleteReminder]);

  /** 导出 .ics：登录后走服务端（能带上其他设备同步来的待办），未登录时浏览器本地生成。 */
  const handleExportIcs = useCallback(async () => {
    const pending = reminders.filter((r) => !r.completed);
    if (!pending.length) {
      toast.info('没有可导出的待办');
      return;
    }
    try {
      if (user) {
        const result = await downloadFromServer('ics');
        if (!result.included) {
          toast.error(result.reason ?? '这些待办都没有日期，暂时无法导出到日历');
          return;
        }
        toast.success(`已导出 ${result.included} 条待办，双击文件即可导入系统日历`);
        return;
      }
      const { included, skipped } = downloadRemindersIcs(reminders);
      if (included === 0) {
        toast.error('这些待办都没有日期，暂时无法导出到日历');
        return;
      }
      const missing = describeSkipped(reminders);
      if (skipped > 0) {
        toast.warning(`已导出 ${included} 条；${skipped} 条因没有截止或提醒时间被跳过`, {
          description: missing.slice(0, 3).join('、') + (missing.length > 3 ? ` 等 ${missing.length} 条` : ''),
        });
      } else {
        toast.success(`已导出 ${included} 条待办，双击文件即可导入系统日历`);
      }
    } catch (error) {
      console.error('[export] 生成 ics 失败', error);
      toast.error('导出失败，请重试');
    }
  }, [reminders, user]);

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) {
      toast.error('请输入提醒标题');
      return;
    }
    if (!newDeadline) {
      toast.error('请选择提醒时间');
      return;
    }
    // datetime-local 格式：YYYY-MM-DDTHH:mm → 转成 YYYY-MM-DD HH:mm:ss
    const deadlineStr = newDeadline.replace('T', ' ') + ':00';

    // 计算 remindAt（基于 offset）；parseSmartDate 显式解析本地格式，Safari 兼容
    const deadlineDate = parseSmartDate(deadlineStr);
    if (!deadlineDate) {
      toast.error('时间格式无效，请重新选择');
      return;
    }
    let remindDate = new Date(deadlineDate);
    // 把下拉里的中文提前量同时记成分钟数，导出日历和闹钟都读这个值。
    let leadMinutes = 0;

    switch (newOffset) {
      case '提前1天':
        remindDate.setDate(remindDate.getDate() - 1);
        leadMinutes = 1440;
        break;
      case '提前2天':
        remindDate.setDate(remindDate.getDate() - 2);
        leadMinutes = 2880;
        break;
      case '提前1小时':
        remindDate.setHours(remindDate.getHours() - 1);
        leadMinutes = 60;
        break;
      case '提前30分钟':
        remindDate.setMinutes(remindDate.getMinutes() - 30);
        leadMinutes = 30;
        break;
      default:
        remindDate = deadlineDate;
        leadMinutes = 0;
    }

    const remindAt = formatLocalDateTime(remindDate);

    addReminder({
      title: newTitle.trim(),
      type: newType,
      importance: newImportance,
      deadline: deadlineStr,
      remindAt,
      remindOffset: newOffset,
      remindLeadMinutes: leadMinutes,
      source: 'personal',
      note: newNote.trim() || undefined,
    });

    toast.success('提醒已创建');
    setAddDialogOpen(false);
    setNewTitle('');
    setNewDeadline('');
    setNewImportance('medium');
    setNewType('个人提醒');
    setNewNote('');
    setNewOffset('准时');
  }, [newTitle, newDeadline, newImportance, newType, newNote, newOffset, addReminder]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-6 flex items-end justify-between">
         <div>
           <h1 className="text-2xl font-bold tracking-tight md:text-3xl">提醒事项</h1>
           <p className="mt-2 text-sm text-muted-foreground">
             追踪所有通知截止日期，不错过任何重要事项
           </p>
         </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{pendingCount}</div>
            <div className="text-xs text-muted-foreground">待办</div>
          </div>
        </div>

       {/* 提醒机制说明 */}
       <div className="mb-5 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-sm">
         <Info className="mt-0.5 size-4 shrink-0 text-primary" />
         <div className="flex-1 leading-relaxed text-foreground/80">
           <p className="font-medium text-foreground">提醒说明</p>
           <p className="mt-1 text-xs text-muted-foreground">
             网页提醒需要<span className="font-medium text-foreground">保持本页面在浏览器中打开</span>才能触发。
             想让它真的响，点「导出日历」把待办存成 <code className="rounded bg-muted px-1">.ics</code> 文件，
             双击导入系统日历（Windows 日历、Google 日历、手机日历都支持），之后由系统负责提醒，关掉页面也不影响。
           </p>
         </div>
       </div>

       {/* 本地数据迁移提示：只在「服务端为空、本地有东西」时出现，不打扰已有账号 */}
       {sync.status === 'pending-import' && (
         <div className="mb-4 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm">
           <p className="font-medium text-amber-900">发现 {sync.pendingImport} 条本地待办</p>
           <p className="mt-1 text-xs text-amber-800">
             这些待办目前只存在这台浏览器里，清缓存就会丢。导入账号后会保存到本机数据库，换设备登录也能看到。
           </p>
           <div className="mt-3 flex gap-2">
             <Button
               size="sm"
               onClick={async () => {
                 const result = await importLocalToServer();
                 if (result.imported) {
                   toast.success(`已导入 ${result.imported} 条待办${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`);
                 } else {
                   toast.error('没有导入任何待办，请稍后重试');
                 }
               }}
             >
               导入账号
             </Button>
             <Button size="sm" variant="ghost" onClick={dismissPendingImport}>暂不导入</Button>
           </div>
         </div>
       )}

       {/* 同步异常：降级提示，不遮挡操作 */}
       {sync.status === 'offline' && (
         <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm">
           <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
           <div className="flex-1">
             <p className="font-medium text-amber-900">未同步</p>
             <p className="mt-1 text-xs text-amber-800">
               {sync.lastError ?? '改动已保存在本地，恢复后会自动同步。'}
             </p>
           </div>
           <Button size="sm" variant="outline" onClick={() => void retrySync()}>重试</Button>
         </div>
       )}

       <div className="mb-4 flex flex-wrap gap-2">
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 size-4" />
                新建提醒
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>新建个人提醒</DialogTitle>
                <DialogDescription>
                  手动创建一条提醒事项
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    标题 <span className="text-destructive">*</span>
                  </label>
                  <Input
                    placeholder="提醒内容"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                   <div>
                     <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                       截止时间 <span className="text-destructive">*</span>
                     </label>
                    <Input
                      type="datetime-local"
                      value={newDeadline}
                      onChange={(e) => setNewDeadline(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      提醒偏移
                    </label>
                    <Select value={newOffset} onValueChange={setNewOffset}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="准时">准时提醒</SelectItem>
                        <SelectItem value="提前30分钟">提前30分钟</SelectItem>
                        <SelectItem value="提前1小时">提前1小时</SelectItem>
                        <SelectItem value="提前1天">提前1天</SelectItem>
                        <SelectItem value="提前2天">提前2天</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                   <div>
                     <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                       类型
                     </label>
                    <Input
                      placeholder="个人提醒"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      重要程度
                    </label>
                    <Select
                      value={newImportance}
                      onValueChange={(v) => setNewImportance(v as ImportanceLevel)}
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
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleAdd}>创建</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <VoiceReminderCreator
            trigger={
              <Button variant="secondary" size="sm">
                <Mic className="mr-1.5 size-4" />
                语音创建
              </Button>
            }
          />

          <Button variant="outline" size="sm" onClick={handleExportIcs}>
            <CalendarPlus className="mr-1.5 size-4" />
            导出日历
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-2 space-y-3">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
              <TabsList className="flex w-full gap-1 overflow-x-auto">
                <TabsTrigger value="pending" className="shrink-0">待办 ({pendingCount})</TabsTrigger>
                <TabsTrigger value="completed" className="shrink-0">已完成 ({completedCount})</TabsTrigger>
                <TabsTrigger value="all" className="shrink-0">全部 ({reminders.length})</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* 来源筛选 */}
            <div className="flex gap-1.5">
              <button
                onClick={() => setSourceFilter('all')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                  sourceFilter === 'all'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Sparkles className="size-3" />
                全部
              </button>
              <button
                onClick={() => setSourceFilter('notification')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                  sourceFilter === 'notification'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <CalendarDays className="size-3" />
                通知解析 ({notifCount})
              </button>
              <button
                onClick={() => setSourceFilter('personal')}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                  sourceFilter === 'personal'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <User className="size-3" />
                个人 ({personalCount})
              </button>
            </div>
          </CardHeader>
        </Card>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted">
                <CalendarDays className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">暂无{filter === 'completed' ? '已完成' : filter === 'pending' ? '待办' : ''}提醒</p>
              <p className="mt-1 text-xs text-muted-foreground">
                解析通知后可一键添加提醒，也可手动或语音创建
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {filtered.map((reminder, idx) => {
                const urgency = getUrgency(reminder.deadline);
                const countdown = formatCountdown(reminder.deadline);

                return (
                  <motion.div
                    key={reminder.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
                    transition={{ delay: idx * 0.03 }}
                  >
                    <Card
                      className={cn(
                        'transition-colors',
                        reminder.completed && 'opacity-60',
                        urgency === 'urgent' && !reminder.completed &&
                          'border-red-300 bg-red-50/50',
                        urgency === 'soon' && !reminder.completed &&
                          'border-amber-300 bg-amber-50/30',
                        urgency === 'expired' && !reminder.completed &&
                          'border-dashed opacity-70'
                      )}
                    >
                      <CardContent className="flex items-start gap-4 p-4">
                        {/* 勾选按钮 */}
                        <button
                          onClick={() => toggleComplete(reminder.id)}
                          className={cn(
                            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                            reminder.completed
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-border hover:border-primary'
                          )}
                        >
                          {reminder.completed && <Check className="size-3.5" />}
                        </button>

                        {/* 内容区 */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'font-medium',
                                reminder.completed && 'line-through text-muted-foreground'
                              )}
                            >
                              {reminder.title}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {reminder.type}
                            </Badge>
                            {reminder.source === 'personal' && (
                              <Badge
                                variant="secondary"
                                className="flex items-center gap-1 text-[10px]"
                              >
                                <User className="size-2.5" />
                                个人
                              </Badge>
                            )}
                            {reminder.recurringType && (
                              <Badge
                                variant="outline"
                                className="flex items-center gap-1 text-[10px] text-primary"
                              >
                                <RefreshCcw className="size-2.5" />
                                周期
                              </Badge>
                            )}
                            {!reminder.completed && (
                              <ImportanceBadge level={reminder.importance} className="text-xs" />
                            )}
                            {urgency === 'urgent' && !reminder.completed && (
                              <Badge
                                variant="destructive"
                                className="flex items-center gap-1 text-xs"
                              >
                                <AlertTriangle className="size-3" />
                                紧急
                              </Badge>
                            )}
                            {urgency === 'expired' && !reminder.completed && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                已过期
                              </Badge>
                            )}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {countdown}
                            </span>
                            <span className="flex items-center gap-1">
                              <CalendarDays className="size-3" />
                              截止：{formatDateTime(reminder.deadline, reminder.timezone)}
                            </span>
                            {(reminder.timezone || reminder.remindOffset) && (
                              <span className="text-muted-foreground/70">
                                提醒：{reminder.timezone ? formatDateTime(reminder.remindAt, reminder.timezone) : reminder.remindOffset}
                              </span>
                            )}
                          </div>

                          {reminder.note && (
                            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                              {reminder.note}
                            </p>
                          )}
                        </div>

                        {/* 删除按钮 */}
                        <AlertDialog
                          open={deleteTarget === reminder.id}
                          onOpenChange={(open) => !open && setDeleteTarget(null)}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTarget(reminder.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确认删除提醒</AlertDialogTitle>
                              <AlertDialogDescription>
                                删除后将不再提醒，此操作不可恢复。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(reminder.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
