import { NavLink } from 'react-router-dom';
import { Sparkles, FilePenLine, BookOpen, Bell, History, User } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: '智能解析', icon: Sparkles },
  { path: '/generator', label: '通知生成', icon: FilePenLine },
  { path: '/rules', label: '规则库', icon: BookOpen },
  { path: '/reminders', label: '提醒事项', icon: Bell },
  { path: '/history', label: '历史记录', icon: History },
  { path: '/profile', label: '我的', icon: User },
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-around px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[11px] transition-colors ${
                  isActive
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              <Icon className="size-5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
