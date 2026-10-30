/**
 * @file csv.ts
 * @description 把待办导出成 CSV。
 *
 * 与 ics.ts 一样放在 shared/：有账号时服务端生成（能导出其他设备同步上来的全部待办），
 * 无账号时浏览器本地生成。两边共用同一份实现，导出的列和顺序才不会分叉——
 * 用户拿同一个应用导两次，结果应该一模一样。
 *
 * 两个细节决定「双击能不能直接看」：
 * 1. **BOM**。不带 `\uFEFF` 的 UTF-8 CSV，Excel 在中文 Windows 上会按 GBK 解码，
 *    「标题」变成「鏍囬」。
 * 2. **CRLF**。RFC 4180 要求行分隔是 CRLF，Excel 对裸 LF 的兼容时好时坏。
 */

/** CSV 只对包含分隔符、引号、换行的字段加引号，其余保持原样，方便人肉查看。 */
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvReminder {
  title?: string;
  type?: string;
  importance?: string;
  deadline?: string | null;
  remindAt?: string | null;
  remindLeadMinutes?: number | null;
  completed?: boolean;
  note?: string | null;
}

/** 列固定在这一个地方，改顺序只需要改这里。 */
export const CSV_HEADER = ['标题', '类型', '重要度', '截止时间', '提醒时间', '提前量(分钟)', '已完成', '备注'] as const;

/**
 * 生成 CSV 内容（含 BOM）。
 * 时间原样输出仓储里的带偏移 ISO 串：换算成某个时区的墙钟时间属于展示层的事，
 * 表格里保留完整信息才经得起二次加工。
 */
export function buildRemindersCsv(rows: CsvReminder[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push([
      row.title, row.type, row.importance,
      row.deadline ?? '', row.remindAt ?? '',
      row.remindLeadMinutes ?? '', row.completed ? '是' : '否',
      row.note ?? '',
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** 文件名带日期，避免多次导出在下载目录里互相覆盖。 */
export function csvFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `notizhi-reminders-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.csv`;
}
