/**
 * @file ReminderCountBadges.tsx
 * @description 「提醒事项」入口上的双角标：右上角红点催办，左上角灰点提醒已过期。
 *
 * 挂在图标上而不是整个导航项上，是因为桌面端导航项很宽（图标 + 文字 + 内边距），
 * 挂在项的角上离图标太远，看起来像贴到了隔壁菜单。
 *
 * 两个角标都只压住图标的一角（用 translate 以图标角为圆心），
 * 否则 20px 的图标会被两个圆点盖掉大半。
 *
 * 平移量取 60% 而不是 50%，是为了让字号多的胶囊**朝外长**：以左侧角标为例，
 * 宽度 W 的胶囊右边界落在 0.4W 处，W 变大时只向外扩 0.4，向内只占 0.4。
 * 取 50% 时两侧对等扩张，`23`/`12` 这种两位数间距只剩 0.89px，
 * `99+` 更是叠在一起（-5.95px，实测）——两个数字会粘成一个。
 * 内边距同步收到 3px，把 `99+` 的胶囊再压窄 4px。
 *
 * 角标整体 `aria-hidden`：它们是纯视觉提示，数字一旦进了导航链接的
 * accessible name，读屏会念成「3 2 提醒事项」，菜单名也就不再等于「提醒事项」
 * （回归测试里 getByRole(name, { exact: true }) 直接失效）。
 * 数量本身不因此丢失 —— 调用方用 `aria-describedby` 另挂一条描述，
 * 名字是名字、描述是描述，两者不互相改写。
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
  'absolute flex h-3.5 min-w-3.5 items-center justify-center whitespace-nowrap rounded-full px-[3px] text-[9px] font-semibold leading-none ring-2 ring-background';

/**
 * `99+` 比两位数还宽一档，20px 的图标塞两个就只剩 0.84px 间隙（实测）。
 * 只在这三个字符时才降一档字号，一位数、两位数维持原样 —— 统一缩小会让
 * 最常见的「个位数」变得没必要地小。
 */
const DENSE = 'px-[2px] text-[8px]';

function widthClass(count: number): string {
  return formatCount(count).length >= 3 ? DENSE : '';
}

export default function ReminderCountBadges({ pending, expired }: ReminderCountBadgesProps) {
  if (pending <= 0 && expired <= 0) return null;

  return (
    <>
      {expired > 0 && (
        <span
          className={cn(BASE, widthClass(expired), 'left-0 top-0 -translate-x-[60%] -translate-y-[60%] bg-muted-foreground text-background')}
          aria-hidden="true"
          title={`${expired} 条已过期`}
        >
          {formatCount(expired)}
        </span>
      )}
      {pending > 0 && (
        <span
          className={cn(BASE, widthClass(pending), 'right-0 top-0 translate-x-[60%] -translate-y-[60%] bg-destructive text-destructive-foreground')}
          aria-hidden="true"
          title={`${pending} 条待办`}
        >
          {formatCount(pending)}
        </span>
      )}
    </>
  );
}
