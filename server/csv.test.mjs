import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_HEADER, buildRemindersCsv, csvCell, csvFileName } from '../shared/csv.ts';

test('只有含分隔符/引号/换行的字段才加引号', () => {
  assert.equal(csvCell('填写报名表'), '填写报名表');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
});

test('null 与 undefined 都输出空串，不写 "null"', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('带 BOM，Excel 双击打开中文不乱码', () => {
  const csv = buildRemindersCsv([]);
  assert.ok(csv.startsWith('\uFEFF'), '必须以 BOM 开头');
});

test('行分隔用 CRLF，且末尾也有换行', () => {
  const csv = buildRemindersCsv([{ title: '交材料' }]);
  const body = csv.slice(1); // 去掉 BOM
  const lines = body.split('\r\n');
  assert.equal(lines.length, 3, '表头 + 1 行 + 末尾空串');
  assert.equal(lines[2], '');
  assert.ok(!/(?<!\r)\n/.test(body), '不应出现裸 LF');
});

test('列顺序与表头一致，缺字段留空', () => {
  const csv = buildRemindersCsv([{
    title: '交材料',
    type: '材料提交',
    importance: '高',
    deadline: '2026-11-07T17:00:00+08:00',
    remindAt: '2026-11-07T16:30:00+08:00',
    remindLeadMinutes: 30,
    completed: false,
  }]);
  const row = csv.split('\r\n')[1];
  assert.equal(row, '交材料,材料提交,高,2026-11-07T17:00:00+08:00,2026-11-07T16:30:00+08:00,30,否,');
  assert.equal(CSV_HEADER.length, row.split(',').length);
});

test('已完成的待办标「是」，备注里的逗号被引号包住', () => {
  const csv = buildRemindersCsv([{
    title: '组队', completed: true, note: '队长：张三, 队员：李四',
  }]);
  const row = csv.split('\r\n')[1];
  assert.ok(row.endsWith(',是,"队长：张三, 队员：李四"'), row);
});

test('文件名带日期，避免多次导出互相覆盖', () => {
  assert.equal(csvFileName(new Date('2026-03-09T10:00:00+08:00')), 'notizhi-reminders-20260309.csv');
  assert.equal(csvFileName(new Date('2026-11-23T10:00:00+08:00')), 'notizhi-reminders-20261123.csv');
});
