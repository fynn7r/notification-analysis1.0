import { useState, useEffect, useCallback, useRef } from 'react';
import { differenceInSeconds, isValid } from 'date-fns';
import { toast } from 'sonner';
import type { IReminder } from '@/data/reminder';
import { getNextRecurringTime } from '@/lib/recurring-utils';
import { formatLocalDateTime, parseSmartDate } from '@/lib/date-utils';
import { genId } from '@/lib/utils';
import { storage } from '@/lib/storage';
import { reminderStore } from '@/hooks/useReminders';
import { recurringStore } from '@/hooks/useRecurring';

// 直接读取最新数据（绕过 hook，避免多实例状态分裂）
function getReminders(): IReminder[] {
  return reminderStore.getItems();
}

function updateReminder(id: string, updates: Partial<IReminder>): void {
  reminderStore.updateItem(id, updates);
}

function addReminder(reminder: IReminder): void {
  reminderStore.addItem(reminder);
}

// 全局单例状态（跨组件共享 activeAlarm）
let globalAlarm: IReminder | null = null;
let globalAlarmListeners: Array<(r: IReminder | null) => void> = [];

function emitAlarm(reminder: IReminder | null) {
  globalAlarm = reminder;
  globalAlarmListeners.forEach((fn) => fn(reminder));
}

export function useAlarm() {
  const [activeAlarm, setActiveAlarm] = useState<IReminder | null>(null);
  const checkIntervalRef = useRef<number | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set()); // 本次会话已触发的提醒 id，防重复

  // 初始化订阅全局状态
  useEffect(() => {
    const listener = (r: IReminder | null) => setActiveAlarm(r);
    globalAlarmListeners.push(listener);
    if (globalAlarm) setActiveAlarm(globalAlarm);
    return () => {
      globalAlarmListeners = globalAlarmListeners.filter((l) => l !== listener);
    };
  }, []);

  // 浏览器通知权限请求
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }, []);

  // 发送浏览器系统通知
  const sendSystemNotification = useCallback((reminder: IReminder) => {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(reminder.title, {
          body: reminder.note || reminder.type,
          tag: reminder.id,
        });
      } catch {
        /* 忽略 */
      }
    }
  }, []);

  // 播放提示音
  const playSound = useCallback(() => {
    try {
      const profile = storage.getProfile<{ soundEnabled?: boolean } | null>(null);
      if (!profile?.soundEnabled) return;      const AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const now = ctx.currentTime;

      const beep = (start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.3, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      };

      beep(now);
      beep(now + 0.4);
      beep(now + 0.8);

      setTimeout(() => ctx.close(), 1500);
    } catch {
      /* 静默失败 */
    }
  }, []);

  // 触发闹钟（立即标记 triggered，防止重复响铃）
  const triggerAlarm = useCallback(
    (reminder: IReminder) => {
      // 同一会话同一提醒只响一次
      if (triggeredRef.current.has(reminder.id)) return;
      triggeredRef.current.add(reminder.id);

      // 立即写入 triggered 标记（走 store，内存与存储同步更新，
      // 避免后续其它 store 写入把标记覆盖掉）
      updateReminder(reminder.id, { triggered: true });

      emitAlarm(reminder);
      playSound();
      sendSystemNotification(reminder);
    },
    [playSound, sendSystemNotification]
  );

  // 关闭闹钟
  const dismissAlarm = useCallback(() => {
    emitAlarm(null);
  }, []);

  // 稍后提醒 (5分钟后)
  const snoozeAlarm = useCallback(() => {
    if (!globalAlarm) return;
    const snoozeTime = new Date();
    snoozeTime.setMinutes(snoozeTime.getMinutes() + 5);
    const snoozeStr = formatLocalDateTime(snoozeTime);
    const newReminder: IReminder = {
      id: genId('snooze'),
      notificationId: globalAlarm.notificationId,
      title: `(稍后提醒) ${globalAlarm.title}`,
      type: globalAlarm.type,
      importance: globalAlarm.importance,
      deadline: globalAlarm.deadline,
      remindAt: snoozeStr,
      remindOffset: '稍后提醒',
      source: 'personal',
      completed: false,
      note: globalAlarm.note,
      createdAt: Date.now(),
      triggered: false,
    };
    addReminder(newReminder);
    emitAlarm(null);
    toast.success('已设置5分钟后再次提醒');
  }, []);

  // 主循环：每 30 秒检查一次提醒
  // 使用 ref 存放依赖，避免因数据变化重建 interval
  useEffect(() => {
    // 启动时清理"错过"的提醒：超过 24h 窗口仍未触发的直接标记 triggered，
    // 避免永远挂在待办里且下次再落入触发窗口
    const cleanupMissed = () => {
      const nowMs = Date.now();
      let missed = 0;
      for (const r of reminderStore.getItems()) {
        if (r.completed || r.triggered) continue;
        const d = parseSmartDate(r.remindAt);
        if (!d || !isValid(d)) continue;
        if (nowMs - d.getTime() >= 24 * 3600 * 1000) {
          updateReminder(r.id, { triggered: true });
          missed++;
        }
      }
      if (missed > 0) {
        toast.info(`${missed} 条已过期的提醒被标记为错过，不再响铃`);
      }
    };
    cleanupMissed();

    const checkReminders = () => {
      const now = new Date();
      const reminders = getReminders();
      const recurringRules = recurringStore.getItems();

      // 检查一次性提醒
      for (const r of reminders) {
        if (r.completed || r.triggered) continue;
        const remindDate = parseSmartDate(r.remindAt);
        if (!remindDate || !isValid(remindDate)) continue;

        // 到达提醒时间（允许 24 小时宽窗口，避免页面后台休眠错过触发）
        const diff = differenceInSeconds(now, remindDate);
        if (diff >= 0 && diff < 24 * 3600) {
          triggerAlarm(r);
          // 不 break，支持同时触发多个
        }
      }

      // 检查周期提醒
      for (const rule of recurringRules) {
        if (rule.paused) continue;
        const next = getNextRecurringTime(rule);
        if (!next) continue;

        // 距离现在 60 秒内的视为到达（支持过去 30 秒到未来 30 秒）
        const diff = differenceInSeconds(next, now);
        if (Math.abs(diff) < 60) {
          // 检查 lastTriggeredAt 今天是否已触发过（同一天同一规则只触发一次）
          const todayStr = formatDateKey(now);
          const lastKey = rule.lastTriggeredAt
            ? formatDateKey(new Date(rule.lastTriggeredAt))
            : '';
          if (lastKey !== todayStr) {
            const deadlineStr = formatLocalDateTime(next);
            const reminder: IReminder = {
              id: genId('recurring-trigger'),
              notificationId: '',
              title: rule.title,
              type: '周期提醒',
              importance: rule.importance,
              deadline: deadlineStr,
              remindAt: deadlineStr,
              remindOffset: '准时',
              completed: false,
              source: 'personal',
              recurringType: rule.type,
              recurringRuleId: rule.id,
              note: rule.note,
              createdAt: Date.now(),
              triggered: true,
            };
            // 回写 lastTriggeredAt 到规则本身（走 store，保证订阅方同步）
            recurringStore.updateItem(rule.id, { lastTriggeredAt: Date.now() });
            triggerAlarm(reminder);
          }
        }
      }
    };

    // 启动后立即检查一次
    checkReminders();
    checkIntervalRef.current = window.setInterval(checkReminders, 30000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [triggerAlarm]);

  return {
    activeAlarm,
    dismissAlarm,
    snoozeAlarm,
    requestNotificationPermission,
  };
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
