/**
 * @file date-utils.ts
 * @description 日期时间处理工具函数库
 * 提供校园通知场景下常用的日期解析、格式化和倒计时计算功能：
 * - 智能日期解析：支持 ISO格式、中文格式（2025年4月30日）、时间戳等多种输入
 * - 倒计时计算：自动计算距截止时间还有多久，显示"还有X天X小时"
 * - 紧急程度判断：根据剩余时间分为 正常/临近/紧急/已过期 四级
 * - 本地时区安全处理：避免 toISOString 导致的 UTC 时区差问题
 * 所有函数均做了异常安全处理，解析失败时返回原始输入而非报错。
 */

import { formatDistanceToNow, parseISO, isBefore, differenceInHours, differenceInDays, isValid } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toDateTimeInput } from '@shared/date-time';

/**
 * 智能解析日期字符串，支持多种常见格式（包括中文自然语言）
 * 解析成功返回 Date，失败返回 null
 *
 * 支持的格式：
 * - ISO: 2025-04-30 / 2025-04-30 23:59 / 2025-04-30T23:59:00
 * - 本地格式（Safari 兼容，显式解析）: 2025-04-30 23:59:00 / 2025/4/30
 * - 中文: 2025年4月30日 / 2025年4月30日 23:59 / 4月30日 / 4月30日 23:59
 * - 中文区间: 5月20-23日（取起始日）
 * - 时间数字串（兜底）: 13位毫秒时间戳
 *
 * 注意：无法解析的模糊表达（如"下周三""本月底"等）返回 null，调用方应回退显示原始文本
 */
export function parseSmartDate(input: string | number): Date | null {
  if (input == null) return null;

  // 数字时间戳
  if (typeof input === 'number') {
    const d = new Date(input);
    return isValid(d) ? d : null;
  }

  const str = String(input).trim();
  if (!str) return null;

  // 1. 尝试 date-fns parseISO（标准 ISO 格式）
  try {
    const d = parseISO(str);
    if (isValid(d)) return d;
  } catch {
    /* 忽略 */
  }

  // 1.5 本地日期时间格式：YYYY-M-D[H m[:s]|/m/d ...]
  // Safari 的 new Date() 不解析 "2026-04-30 23:59:00"（空格分隔）会得到 Invalid Date，
  // 必须显式解析并按本地时区构造
  const localRegex =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/;
  const localMatch = str.match(localRegex);
  if (localMatch) {
    const d = new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4] || 0),
      Number(localMatch[5] || 0),
      Number(localMatch[6] || 0)
    );
    if (isValid(d)) return d;
  }

  // 2. 原生 Date 解析（部分浏览器可解析 2025/04/30 等格式）
  try {
    const d = new Date(str);
    if (isValid(d)) return d;
  } catch {
    /* 忽略 */
  }

  // 3. 中文日期格式解析
  // 匹配：[YYYY年][M月][D日][ ][HH:mm[:ss]]
  // 同时支持区间形式 5月20-23日（取起始日 20）
  const cnDateRegex =
    /^(?:(\d{4})年)?(?:(\d{1,2})月)?(?:(\d{1,2})(?:-\d{1,2})?日)?(?:\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?\s*$/;
  const cnMatch = str.match(cnDateRegex);
  if (cnMatch && (cnMatch[1] || cnMatch[2] || cnMatch[3])) {
    const now = new Date();
    const year = cnMatch[1] ? Number(cnMatch[1]) : now.getFullYear();
    const month = cnMatch[2] ? Number(cnMatch[2]) - 1 : now.getMonth();
    const day = cnMatch[3] ? Number(cnMatch[3]) : now.getDate();
    const hour = cnMatch[4] ? Number(cnMatch[4]) : 0;
    const minute = cnMatch[5] ? Number(cnMatch[5]) : 0;
    const second = cnMatch[6] ? Number(cnMatch[6]) : 0;

    // 必须至少有 月+日 或 年+月+日 才算有效日期（单有月或单有日不足以确定日期）
    if (!cnMatch[2] && !cnMatch[1]) {
      // 只有日，没有年月，信息量不足，返回 null
      return null;
    }
    if (!cnMatch[3] && !cnMatch[1]) {
      // 只有月，没有年和日，信息量不足
      return null;
    }

    const d = new Date(year, month, day, hour, minute, second);
    if (isValid(d)) return d;
  }

  // 4. 纯数字时间戳（13位毫秒 or 10位秒）
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    const d = new Date(num < 1e12 ? num * 1000 : num);
    if (isValid(d)) return d;
  }

  return null;
}

/**
 * 判断输入是否为有效的可解析日期
 */
export function isValidDate(input: string | number | undefined | null): boolean {
  if (input == null) return false;
  return parseSmartDate(input) !== null;
}

export function formatCountdown(deadline: string): string {
  const date = parseSmartDate(deadline);
  if (!date) return deadline || '暂无';
  const now = new Date();
  if (isBefore(date, now)) return '已截止';

  const days = differenceInDays(date, now);
  const hours = differenceInHours(date, now) % 24;
  if (days > 0) return `还有 ${days} 天 ${hours} 小时`;
  if (hours > 0) {
    const mins = Math.floor((date.getTime() - now.getTime()) / 60000) % 60;
    return `还有 ${hours} 小时 ${mins} 分`;
  }
  const mins = Math.floor((date.getTime() - now.getTime()) / 60000);
  return `还有 ${mins} 分钟`;
}

export function getUrgency(deadline: string): 'normal' | 'soon' | 'urgent' | 'expired' {
  const date = parseSmartDate(deadline);
  if (!date) return 'normal';
  const now = new Date();
  if (isBefore(date, now)) return 'expired';
  const hours = differenceInHours(date, now);
  if (hours <= 3) return 'urgent';
  if (hours <= 24) return 'soon';
  return 'normal';
}

export function formatDate(input: string | number): string {
  const date = parseSmartDate(input);
  if (!date) return String(input);
  try {
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN });
  } catch {
    return String(input);
  }
}

export function formatDateTime(input: string | number | null | undefined, timezone?: string): string {
  if (input == null) return '';
  const date = parseSmartDate(input);
  if (!date) return String(input);
  if (timezone) return toDateTimeInput(date.toISOString(), timezone).replace('T', ' ');
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  // 如果是 00:00 且输入本身不含时间信息，只展示日期
  const str = String(input);
  const hasTime = /[\d:：时]{2,}/.test(str) && /(:|：|时)/.test(str);
  if (!hasTime && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
    return `${y}-${m}-${d}`;
  }
  return `${y}-${m}-${d} ${h}:${min}`;
}

export function addOffsetToDeadline(deadline: string, offset: string): string {
  const date = parseSmartDate(deadline);
  if (!date) return deadline;

  const result = new Date(date);
  if (offset.includes('2天')) {
    result.setDate(result.getDate() - 2);
  } else if (offset.includes('1天')) {
    result.setDate(result.getDate() - 1);
  } else if (offset.includes('3小时')) {
    result.setHours(result.getHours() - 3);
  } else if (offset.includes('1小时')) {
    result.setHours(result.getHours() - 1);
  } else {
    return deadline;
  }
  return formatLocalDateTime(result);
}

/**
 * 本地时间格式化（重要！不要用 toISOString，那是 UTC，中国时区会差 8 小时）
 * 输出格式：YYYY-MM-DD HH:mm:ss（本地时区）
 */
export function formatLocalDateTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * 本地日期格式化：YYYY-MM-DD
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 生成相对当前日期的未来日期字符串
 * @param daysFromNow 从今天起第几天（7 = 7天后）
 */
export function getFutureDate(daysFromNow: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return formatLocalDateTime(d);
}

/**
 * 安全获取日期时间戳，解析失败返回 Infinity（排序用，无效日期排到末尾）
 */
export function getSafeTime(input: string | number | undefined | null): number {
  if (input == null) return Infinity;
  const d = parseSmartDate(input);
  return d ? d.getTime() : Infinity;
}
