/**
 * @file ReminderCountBadges.tsx
 * @description 「提醒事项」入口上的双角标：右上角红点催办，左上角灰点提醒已过期。
 *
 * 挂在图标上而不是整个导航项上，是因为桌面端导航项很宽（图标 + 文字 + 内边距），
 * 挂在项的角上离图标太远，看起来像贴到了隔壁菜单。
 *
 * 两个角标都只有一半压在图标上（用 translate 以图标角为圆心），
 * 否则 16px 的图标会被两个 16px 的圆点盖掉大半。
 *
 * 角标整体 `aria-hidden`：它们是纯视觉提示，数字一旦进了导航链接的
 * accessible name，读屏会念成「3 2 提醒事项」，菜单名也就不再等于「提醒事项」
 * （回归测试里 getByRole(name, { exact: true }) 直接失效）。数字对读屏用户
 * 没有额外价值 —— 进到列表页有完整的条数和状态。
 */

import { cn } from '@/lib/utils';

interface ReminderCountBadgesProps {
  /** 未完成且未到期 */
  pending: number;
  /** 未完成但已过截止 */
  expired: number;
}

const MAX = 99;

function formatCount(value: number): string {
  return value > MAX ? `${MAX}+` : String(value);
}

const BASE =
  'absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-none ring-2 ring-background';

export default function ReminderCountBadges({ pending, expired }: ReminderCountBadgesProps) {
  if (pending <= 0 && expired <= 0) return null;

  return (
    <>
      {expired > 0 && (
        <span
          className={cn(BASE, 'left-0 top-0 -translate-x-1/2 -translate-y-[60%] bg-muted-foreground text-background')}
          aria-hidden="true"
          title={`${expired} 条已过期`}
        >
          {formatCount(expired)}
        </span>
      )}
      {pending > 0 && (
        <span
          className={cn(BASE, 'right-0 top-0 translate-x-1/2 -translate-y-[60%] bg-destructive text-destructive-foreground')}
          aria-hidden="true"
          title={`${pending} 条待办`}
        >
          {formatCount(pending)}
        </span>
      )}
    </>
  );
}
