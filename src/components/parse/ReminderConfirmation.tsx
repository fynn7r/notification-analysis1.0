import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_TIMEZONE, toDateTimeInput, toZonedIso } from '@shared/date-time';
import type { INotification } from '@/data/notification';
import { parseSmartDate } from '@/lib/date-utils';
import {
  LEAD_MINUTE_OPTIONS,
  deriveLeadMinutes,
  describeLeadMinutes,
  getDefaultLeadMinutes,
  setDefaultLeadMinutes,
} from '@/lib/preferences';

export interface ConfirmedReminder {
  title: string;
  deadline: string;
  remindAt: string;
  eventStartTime?: string;
  /** 提前量（分钟），随待办一起存，闹钟与日历导出都读它。 */
  remindLeadMinutes: number;
}

export default function ReminderConfirmation({ notification, open, onOpenChange, onSave }: {
  notification: INotification;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: ConfirmedReminder) => void;
}) {
  const timezone = notification.parseContext?.timezone || DEFAULT_TIMEZONE;
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [error, setError] = useState('');
  // 默认值来自本地偏好，用户改过一次之后全局生效，不再是写死的 30 分钟。
  const [leadMinutes, setLeadMinutes] = useState(() => getDefaultLeadMinutes());

  useEffect(() => {
    if (!open) return;
    const due = notification.primaryAction?.deadline || notification.registrationDeadline || '';
    const dueDate = due ? parseSmartDate(due) : null;
    // 已有提醒时间时以它为准反推提前量（可能是解析结果带来的，也可能是默认值算出来的）。
    const existingRemindAt = notification.primaryAction?.remindAt || '';
    const lead = deriveLeadMinutes(due, existingRemindAt) ?? getDefaultLeadMinutes();
    const nextRemindAt = existingRemindAt
      || (dueDate ? new Date(dueDate.getTime() - lead * 60000).toISOString() : '');
    setTitle(notification.primaryAction?.title ?? notification.title ?? '');
    setDeadline(toDateTimeInput(due, timezone));
    setLeadMinutes(lead);
    setRemindAt(toDateTimeInput(nextRemindAt, timezone));
    setEventTime(toDateTimeInput(notification.eventStartTime || '', timezone));
    setError('');
  }, [open, notification, timezone]);

  /** 改了截止时间就按当前提前量重算提醒；提前量始终以分钟数为准，不再硬编码 30。 */
  const recomputeRemindAt = (deadlineValue: string, lead: number) => {
    const iso = toZonedIso(deadlineValue, timezone);
    setRemindAt(iso ? toDateTimeInput(new Date(new Date(iso).getTime() - lead * 60000).toISOString(), timezone) : '');
  };

  const changeDeadline = (value: string) => {
    setDeadline(value);
    recomputeRemindAt(value, leadMinutes);
  };

  /** 用户主动改了提前量才写回偏好，避免打开弹窗就悄悄改掉全局设置。 */
  const changeLead = (value: string) => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return;
    setLeadMinutes(minutes);
    setDefaultLeadMinutes(minutes);
    recomputeRemindAt(deadline, minutes);
  };

  const save = () => {
    const due = toZonedIso(deadline, timezone);
    const reminder = toZonedIso(remindAt, timezone);
    const event = eventTime ? toZonedIso(eventTime, timezone) : null;
    if (!title.trim()) { setError('请填写需要完成的具体动作。'); return; }
    if (!due) { setError('请补齐有效的待办截止日期和时间，活动时间不能代替截止时间。'); return; }
    if (!reminder) { setError('请填写有效的提醒日期和时间。'); return; }
    if (new Date(reminder).getTime() >= new Date(due).getTime()) { setError('提醒时间必须早于待办截止时间。'); return; }
    if (eventTime && !event) { setError('活动日期或时间无效，请修改或清空。'); return; }
    // 用户可能直接手改提醒时间，所以以最终两个时间为准反推，而不是相信下拉框的值。
    const finalLead = deriveLeadMinutes(due, reminder) ?? leadMinutes;
    onSave({ title: title.trim(), deadline: due, remindAt: reminder, eventStartTime: event ?? undefined, remindLeadMinutes: finalLead });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>核对日期并添加待办</DialogTitle>
          <DialogDescription>请对照原文确认具体日期。所有时间按 {timezone} 显示；修改截止时间会按下面的提前量重新计算提醒时间。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="confirmed-action-title">需要完成的动作</Label>
            <Input id="confirmed-action-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：填写青马学堂报名表" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmed-deadline">待办截止时间（必填）</Label>
            <Input id="confirmed-deadline" type="datetime-local" value={deadline} onChange={(event) => changeDeadline(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmed-lead">提醒提前量</Label>
            <Select value={String(leadMinutes)} onValueChange={changeLead}>
              <SelectTrigger id="confirmed-lead" aria-label="提醒提前量">
                <SelectValue placeholder="选择提前量" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_MINUTE_OPTIONS.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>{describeLeadMinutes(minutes)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">改这里会同时更新你的默认设置，下次打开沿用。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmed-remind-at">提醒时间（当前为{describeLeadMinutes(leadMinutes)}，也可直接改）</Label>
            <Input id="confirmed-remind-at" type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmed-event-time">活动开始时间（可选，独立于截止时间）</Label>
            <Input id="confirmed-event-time" type="datetime-local" value={eventTime} onChange={(event) => setEventTime(event.target.value)} />
          </div>
          {!!notification.timeWarnings?.length && <ul className="list-disc space-y-1 pl-4 text-sm text-amber-700">{notification.timeWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer">对照通知原文</summary>
            <p className="mt-2 whitespace-pre-wrap break-words">{notification.rawText}</p>
          </details>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>暂不添加</Button>
          <Button onClick={save}>确认并保存待办</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
