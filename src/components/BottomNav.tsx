import { NavLink } from 'react-router-dom';
import { Sparkles, FilePenLine, BookOpen, Bell, History, User } from 'lucide-react';
import ReminderCountBadges from '@/components/ReminderCountBadges';
import { useReminderCounts } from '@/hooks/useReminderCounts';

const NAV_ITEMS = [
  { path: '/', label: '智能解析', icon: Sparkles },
  { path: '/generator', label: '通知生成', icon: FilePenLine },
  { path: '/rules', label: '规则库', icon: BookOpen },
  { path: '/reminders', label: '提醒事项', icon: Bell },
  { path: '/history', label: '历史记录', icon: History },
  { path: '/profile', label: '我的', icon: User },
];

export default function BottomNav() {
  const { pending, expired } = useReminderCounts();
  // 读屏要听到的句子。角标本身是 aria-hidden 的（见 ReminderCountBadges），
  // 数量改由 aria-describedby 挂到链接上：accessible name 仍严格等于「提醒事项」，
  // 描述另说一条。若把数量写进链接里，菜单名就会被数字改写，
  // 读屏会念成「3 2 提醒事项」。
  const countText = [pending > 0 ? `${pending} 条待办` : '', expired > 0 ? `${expired} 条已过期` : '']
    .filter(Boolean)
    .join('，');

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-around px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isReminders = item.path === '/reminders';
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              // 描述节点必须挂在链接外面：放进去就成了链接内容，
              // 会被算进 accessible name。
              aria-describedby={isReminders && countText ? 'reminder-count-desc' : undefined}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[11px] transition-colors ${
                  isActive
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <span className="relative inline-flex">
                <Icon className="size-5" />
                {isReminders && <ReminderCountBadges pending={pending} expired={expired} />}
              </span>
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
      {countText && (
        <span id="reminder-count-desc" className="sr-only">
          {countText}
        </span>
      )}
    </nav>
  );
}
