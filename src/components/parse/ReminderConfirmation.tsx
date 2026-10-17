import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DEFAULT_TIMEZONE, toDateTimeInput, toZonedIso } from '@shared/date-time';
import type { INotification } from '@/data/notification';
import { parseSmartDate } from '@/lib/date-utils';

export interface ConfirmedReminder {
  title: string;
  deadline: string;
  remindAt: string;
  eventStartTime?: string;
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

  useEffect(() => {
    if (!open) return;
    const due = notification.primaryAction?.deadline || notification.registrationDeadline || '';
    const dueDate = due ? parseSmartDate(due) : null;
    setTitle(notification.primaryAction?.title ?? notification.title ?? '');
    setDeadline(toDateTimeInput(due, timezone));
    setRemindAt(toDateTimeInput(notification.primaryAction?.remindAt || (dueDate ? new Date(dueDate.getTime() - 30 * 60000).toISOString() : ''), timezone));
    setEventTime(toDateTimeInput(notification.eventStartTime || '', timezone));
    setError('');
  }, [open, notification, timezone]);

  const changeDeadline = (value: string) => {
    setDeadline(value);
    const iso = toZonedIso(value, timezone);
    setRemindAt(iso ? toDateTimeInput(new Date(new Date(iso).getTime() - 30 * 60000).toISOString(), timezone) : '');
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
    onSave({ title: title.trim(), deadline: due, remindAt: reminder, eventStartTime: event ?? undefined });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>核对日期并添加待办</DialogTitle>
          <DialogDescription>请对照原文确认具体日期。所有时间按 {timezone} 显示；修改截止时间会重新设置提前30分钟提醒。</DialogDescription>
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
            <Label htmlFor="confirmed-remind-at">提醒时间（默认提前30分钟）</Label>
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
