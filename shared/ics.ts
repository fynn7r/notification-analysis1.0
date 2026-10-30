/**
 * @file ics.ts
 * @description 把待办导出成 iCalendar（RFC 5545）。
 *
 * 放在 shared/ 而不是 server/，因为两种运行模式都要用：
 * - 有账号：服务端生成，能导出「全部」而不只是当前浏览器里的；
 * - 无账号（解压即用的默认形态）：浏览器本地生成，走 Blob 下载，不经过服务端。
 * 一份实现两边共用，行为才不会分叉。
 *
 * 关于时区的取舍：这里统一用 UTC 实例（`DTSTART:20261107T090000Z`），而不是
 * `DTSTART;TZID=Asia/Shanghai:20261107T170000`。原因是后者要求文件里带匹配的
 * VTIMEZONE 组件，缺了它 Outlook 和部分安卓日历会把墙钟时间当成 UTC 读，反而偏 8 小时；
 * 而 VTIMEZONE 只能为「已知且无夏令时」的少数时区手写。用 UTC 实例则任何客户端都正确：
 * 同一时刻在北京显示 17:00，在伦敦显示 09:00——两边都对。
 * 为便于人读，事件描述里同时写出本地墙钟时间。
 */

import { DEFAULT_TIMEZONE, dateInTimezone } from './date-time.ts';

export interface IcsReminder {
  id: string;
  title: string;
  /** 带偏移的 ISO 时间；空串或缺失表示「没有截止时间」。 */
  deadline?: string | null;
  /** 带偏移的 ISO 时间；空串或缺失表示「没有提醒时间」。 */
  remindAt?: string | null;
  /** 提前量（分钟）。0 或缺失表示不加闹钟。 */
  remindLeadMinutes?: number;
  note?: string;
  type?: string;
  importance?: string;
  timezone?: string;
}

export interface IcsOptions {
  /** 日历显示名，会写进 X-WR-CALNAME。 */
  calendarName?: string;
  /** BUILT 时的当前时间，测试可注入固定值。 */
  now?: Date;
  /** UID 域名后缀，保持稳定才能让重复导入覆盖而非新增。 */
  uidDomain?: string;
}

export interface IcsResult {
  content: string;
  /** 成功写入的事件数。 */
  included: number;
  /** 既没有截止时间也没有提醒时间、被跳过的条目。 */
  skipped: IcsReminder[];
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;

/** RFC 5545 3.3.11：反斜杠、分号、逗号要转义，换行写成字面 \n。 */
export function escapeIcsText(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * 按「字节」折行，不是按字符。中文在 UTF-8 下一个字 3 字节，
 * 按字符数折会得到超过 75 字节的长行，严格实现的客户端会拒收。
 * 续行以一个空格开头，且空格计入该行长度。
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_OCTETS) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = MAX_OCTETS;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = char;
      currentBytes = size;
      limit = MAX_OCTETS - 1; // 续行开头的空格占 1 字节
    } else {
      current += char;
      currentBytes += size;
    }
  }
  if (current) out.push(current);
  return out.join(`${CRLF} `);
}

/** ISO 时间 → UTC 紧凑格式 20261107T090000Z。 */
export function toIcsUtc(iso: string): string | null {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  return `${new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

/** 给人看的墙钟时间，例如「2026-11-07 17:00（Asia/Shanghai）」。 */
export function toLocalLabel(iso: string, timezone = DEFAULT_TIMEZONE): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const date = dateInTimezone(new Date(time), timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${date} ${get('hour')}:${get('minute')}（${timezone}）`;
}

/** 提前量 → RFC 5545 时长。0 表示不加闹钟，返回 null。 */
export function leadMinutesToTrigger(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const whole = Math.trunc(minutes);
  if (whole % 1440 === 0) return `-P${whole / 1440}D`;
  if (whole % 60 === 0) return `-PT${whole / 60}H`;
  return `-PT${whole}M`;
}

/**
 * 生成整份 .ics。
 * 事件时间优先取 deadline；只有提醒时间时退化为在提醒时刻建一个事件，
 * 这样「先提醒你去做」这件事仍然是日历里的一个确定时刻。
 */
export function buildIcs(reminders: IcsReminder[], options: IcsOptions = {}): IcsResult {
  const {
    calendarName = '通知智析',
    now = new Date(),
    uidDomain = 'notizhi.local',
  } = options;

  const stamp = toIcsUtc(now.toISOString()) ?? '19700101T000000Z';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Notizhi//Reminder Export//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${DEFAULT_TIMEZONE}`,
  ];

  const skipped: IcsReminder[] = [];
  let included = 0;

  for (const reminder of reminders) {
    const deadline = reminder.deadline?.trim() || '';
    const remindAt = reminder.remindAt?.trim() || '';
    const startIso = deadline || remindAt;
    const start = startIso ? toIcsUtc(startIso) : null;
    // 两个时间都没有，就没有可写进日历的时刻。跳过并如实回报，不静默丢弃。
    if (!start || !startIso) {
      skipped.push(reminder);
      continue;
    }

    const timezone = reminder.timezone || DEFAULT_TIMEZONE;
    const summary = escapeIcsText(reminder.title || '未命名待办');
    const descriptionParts: string[] = [];
    if (deadline) descriptionParts.push(`截止：${toLocalLabel(deadline, timezone)}`);
    if (remindAt && remindAt !== deadline) descriptionParts.push(`提醒：${toLocalLabel(remindAt, timezone)}`);
    if (reminder.type) descriptionParts.push(`类型：${reminder.type}`);
    if (reminder.note?.trim()) descriptionParts.push('', reminder.note.trim());
    descriptionParts.push('', '由通知智析导出');

    lines.push('BEGIN:VEVENT');
    // UID 由 reminder id 派生且始终不变，重复导入才会覆盖同一事件而不是新增一条。
    lines.push(`UID:${escapeIcsText(reminder.id)}@${uidDomain}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:${escapeIcsText(descriptionParts.join('\n'))}`);
    if (reminder.type) lines.push(`CATEGORIES:${escapeIcsText(reminder.type)}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:TRANSPARENT');

    const trigger = leadMinutesToTrigger(Number(reminder.remindLeadMinutes ?? 0));
    if (trigger) {
      lines.push('BEGIN:VALARM');
      lines.push(`TRIGGER:${trigger}`);
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${summary}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
    included += 1;
  }

  lines.push('END:VCALENDAR');
  const content = `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
  return { content, included, skipped };
}

/** 浏览器端下载用：生成 Blob 并触发下载。文件名固定，重复导出会覆盖本地同名文件。 */
export function icsFileName(now = new Date()): string {
  const stamp = `${dateInTimezone(now)}`.replace(/-/g, '');
  return `notizhi-reminders-${stamp}.ics`;
}
