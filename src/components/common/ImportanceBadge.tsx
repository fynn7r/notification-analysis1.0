import { Badge } from '@/components/ui/badge';
import type { ImportanceLevel } from '@/data/notification';
import { cn } from '@/lib/utils';

interface ImportanceBadgeProps {
  level: ImportanceLevel;
  className?: string;
}

const config = {
  high: {
    label: '高重要',
    className: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
  },
  medium: {
    label: '中重要',
    className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  },
  low: {
    label: '低重要',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
} as const;

export default function ImportanceBadge({ level, className }: ImportanceBadgeProps) {
  // 数据是从 localStorage / SQLite 读回来的，历史版本或手工改过的记录里
  // 完全可能出现 '高' 这种没归一化的值。这里退到 medium 而不是让
  // 整个页面因为一个徽章白屏——渲染层的容错边界要守住。
  const { label, className: badgeClass } = config[level] ?? config.medium;
  return (
    <Badge variant="outline" className={cn(badgeClass, className)}>
      {label}
    </Badge>
  );
}
