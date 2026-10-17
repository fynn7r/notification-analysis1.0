import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, BookOpen, Bell, History, FileText, FilePenLine, User, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NAV_ITEMS = [
  { path: '/', label: '智能解析', shortLabel: '智能解析', icon: Sparkles },
  { path: '/generator', label: '通知生成', shortLabel: '通知生成', icon: FilePenLine },
  { path: '/rules', label: '规则库', shortLabel: '规则库', icon: BookOpen },
  { path: '/reminders', label: '提醒事项', shortLabel: '提醒事项', icon: Bell },
  { path: '/history', label: '历史记录', shortLabel: '历史记录', icon: History },
  { path: '/profile', label: '我的', shortLabel: '我的', icon: User },
];

// 给定 pathname，找到对应的路由项用于显示当前页中文标签
function getCurrentKey(pathname: string): string {
  if (pathname === '/' || pathname === '') return '/';
  const matched = NAV_ITEMS.find(
    (item) => item.path !== '/' && pathname.startsWith(item.path)
  );
  return matched?.path ?? '/';
}

interface HeaderProps {
  onOpenRecurring?: () => void;
}

export default function Header({ onOpenRecurring }: HeaderProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const currentKey = getCurrentKey(pathname);

  return (
    <TooltipProvider>
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
        <NavLink to="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">通知智析</span>
        </NavLink>

        <nav className="flex items-center gap-1">
          {/* 桌面端：横向导航 */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.filter((item) => item.path !== '/profile').map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive: navActive }) =>
                    `flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      navActive
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }`
                  }
                >
                  <Icon className="size-4" />
                  <span>{item.shortLabel}</span>
                </NavLink>
              );
            })}
          </div>

          {/* 移动端：中文路由下拉选择器 */}
          <div className="md:hidden">
            <Select value={currentKey} onValueChange={(val) => navigate(val)}>
              <SelectTrigger className="w-[150px] h-9 text-sm">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    {(() => {
                      const cur = NAV_ITEMS.find((i) => i.path === currentKey);
                      const CurIcon = cur?.icon ?? Sparkles;
                      return <CurIcon className="size-4 text-muted-foreground" />;
                    })()}
                    <span>{NAV_ITEMS.find((i) => i.path === currentKey)?.label}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="w-[180px]">
                {NAV_ITEMS.map((item) => (
                  <SelectItem key={item.path} value={item.path} className="text-sm">
                    <div className="flex items-center gap-2">
                      <item.icon className="size-4 text-muted-foreground" />
                      <span>{item.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 周期提醒隐藏入口（桌面端） */}
          {onOpenRecurring && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onOpenRecurring}
                  className="ml-1 hidden md:inline-flex size-9 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCcw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">周期提醒</TooltipContent>
            </Tooltip>
          )}

          {/* 我的入口（桌面端） */}
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `ml-1 hidden md:flex items-center justify-center rounded-lg p-2 transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`
            }
          >
            <User className="size-4" />
          </NavLink>
        </nav>
      </div>
    </header>
    </TooltipProvider>
  );
}
