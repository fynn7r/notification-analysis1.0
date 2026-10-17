export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateInTimezone(date: Date, timezone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function toDateTimeInput(value: string, timezone = DEFAULT_TIMEZONE): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// 将用户确认的墙上时间转换为带时区偏移的时间；拒绝无效日期和夏令时跳过的时间。
export function toZonedIso(value: string, timezone = DEFAULT_TIMEZONE): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (!match || !isCalendarDate(match[1]) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(match[2])) return null;
  const wallTime = new Date(`${value}:00Z`).getTime();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, timeZoneName: 'longOffset',
  });
  const offsetAt = (timestamp: number) => {
    const name = formatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName')?.value;
    if (name === 'GMT') return '+00:00';
    return name?.replace('GMT', '') ?? '+00:00';
  };
  const offsetMilliseconds = (offset: string) => {
    const sign = offset[0] === '-' ? -1 : 1;
    return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60000;
  };
  const initialOffset = offsetAt(wallTime);
  const offset = offsetAt(wallTime - offsetMilliseconds(initialOffset));
  const iso = `${value}:00${offset}`;
  return toDateTimeInput(iso, timezone) === value ? iso : null;
}

export function relativeDate(evidence: string, referenceDate: string): string | null {
  const date = new Date(`${referenceDate}T00:00:00Z`);
  const week = evidence.match(/(本周|这周|下周|上周)([一二三四五六日天])/);
  if (week) {
    const weekday = '一二三四五六日'.indexOf(week[2] === '天' ? '日' : week[2]);
    const shift = week[1] === '下周' ? 7 : week[1] === '上周' ? -7 : 0;
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7 + weekday + shift);
  } else {
    const day = evidence.match(/大后天|后天|明天|今天/);
    if (!day) return null;
    const offsets: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 };
    date.setUTCDate(date.getUTCDate() + offsets[day[0]]);
  }
  return date.toISOString().slice(0, 10);
}
