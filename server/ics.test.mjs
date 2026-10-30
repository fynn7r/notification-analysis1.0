import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  leadMinutesToTrigger,
  toIcsUtc,
} from '../shared/ics.ts';

const NOW = new Date('2026-10-30T15:00:00+08:00');

function bytes(line) {
  return new TextEncoder().encode(line).length;
}

test('转义反斜杠、分号、逗号与换行', () => {
  assert.equal(escapeIcsText('a,b;c\\d'), 'a\\,b\\;c\\\\d');
  assert.equal(escapeIcsText('第一行\n第二行'), '第一行\\n第二行');
  assert.equal(escapeIcsText('第一行\r\n第二行'), '第一行\\n第二行');
});

test('按字节折行，续行以空格开头且每行不超过 75 字节', () => {
  const line = `DESCRIPTION:${'中文测试'.repeat(20)}`;
  const folded = foldIcsLine(line);
  assert.ok(folded.includes('\r\n '), '应当出现续行');
  for (const part of folded.split('\r\n')) {
    assert.ok(bytes(part) <= 75, `折行后仍有 ${bytes(part)} 字节：${part}`);
  }
  // 折行不能改变内容：去掉 CRLF + 空格 后应与原始行一致
  assert.equal(folded.replace(/\r\n /g, ''), line);
});

test('短行不折', () => {
  const line = 'SUMMARY:短标题';
  assert.equal(foldIcsLine(line), line);
});

test('UTC 转换：北京 17:00 写成 09:00Z', () => {
  assert.equal(toIcsUtc('2026-11-07T17:00:00+08:00'), '20261107T090000Z');
  assert.equal(toIcsUtc('2026-11-07T09:00:00Z'), '20261107T090000Z');
  assert.equal(toIcsUtc('not-a-date'), null);
});

test('提前量转换为 RFC 5545 时长', () => {
  assert.equal(leadMinutesToTrigger(0), null);
  assert.equal(leadMinutesToTrigger(-5), null);
  assert.equal(leadMinutesToTrigger(30), '-PT30M');
  assert.equal(leadMinutesToTrigger(60), '-PT1H');
  assert.equal(leadMinutesToTrigger(180), '-PT3H');
  assert.equal(leadMinutesToTrigger(1440), '-P1D');
  assert.equal(leadMinutesToTrigger(2880), '-P2D');
  assert.equal(leadMinutesToTrigger(90), '-PT90M');
});

test('生成完整的 VCALENDAR，字段齐全且只用 CRLF', () => {
  const { content, included, skipped } = buildIcs([
    {
      id: 'r1',
      title: '纸质材料提交',
      deadline: '2026-11-10T17:00:00+08:00',
      remindAt: '2026-11-09T17:00:00+08:00',
      remindLeadMinutes: 1440,
      type: '作业任务',
    },
  ], { now: NOW });

  assert.equal(included, 1);
  assert.equal(skipped.length, 0);
  assert.ok(content.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(content.endsWith('END:VCALENDAR\r\n'));
  assert.ok(content.includes('VERSION:2.0'));
  assert.ok(content.includes('UID:r1@notizhi.local'));
  assert.ok(content.includes('DTSTAMP:20261030T070000Z'));
  // 截止时间按 UTC 写，客户端按本地时区渲染回来仍是 17:00
  assert.ok(content.includes('DTSTART:20261110T090000Z'));
  assert.ok(content.includes('TRIGGER:-P1D'));
  // 不允许出现裸 LF：把 CRLF 全部去掉后不应再有 \n 或 \r
  assert.equal(/[\r\n]/.test(content.replace(/\r\n/g, '')), false);
});

test('UID 稳定：同一待办导出两次，UID 与事件体一致（只 DTSTAMP 可能不同）', () => {
  const reminder = { id: 'stable-1', title: '同一件事', deadline: '2026-11-10T17:00:00+08:00' };
  const first = buildIcs([reminder], { now: NOW, uidDomain: 'notizhi.local' });
  const second = buildIcs([reminder], { now: new Date('2026-11-01T00:00:00+08:00'), uidDomain: 'notizhi.local' });
  assert.equal(first.content, second.content.replace('DTSTAMP:20261031T160000Z', 'DTSTAMP:20261030T070000Z'));
  assert.match(first.content, /UID:stable-1@notizhi\.local/);
});

test('没有截止时间时退化为提醒时刻', () => {
  const { content, included } = buildIcs([
    { id: 'r2', title: '仅有提醒', remindAt: '2026-11-05T09:00:00+08:00' },
  ], { now: NOW });
  assert.equal(included, 1);
  assert.ok(content.includes('DTSTART:20261105T010000Z'));
  assert.ok(content.includes('提醒：2026-11-05 09:00'));
});

test('两个时间都没有的条目被跳过并如实回报', () => {
  const { included, skipped } = buildIcs([
    { id: 'r3', title: '空时间' },
    { id: 'r4', title: '空串时间', deadline: '', remindAt: '' },
    { id: 'r5', title: '正常', deadline: '2026-11-10T17:00:00+08:00' },
  ], { now: NOW });
  assert.equal(included, 1);
  assert.deepEqual(skipped.map((item) => item.id), ['r3', 'r4']);
});

test('标题含逗号分号不截断，导入后仍是完整标题', () => {
  // 只有 ASCII 的 , ; \ 需要转义；中文顿号「、」是普通字符，转义反而会显示成反斜杠。
  const title = '报名,缴费;并提交材料\\附件';
  const { content } = buildIcs([
    { id: 'r6', title, deadline: '2026-11-07T17:00:00+08:00' },
  ], { now: NOW });
  const summaryLine = content.split('\r\n').find((line) => line.startsWith('SUMMARY:'));
  assert.equal(summaryLine, 'SUMMARY:报名\\,缴费\\;并提交材料\\\\附件');
  // 反解回来应与原标题一致
  const unescaped = summaryLine.slice('SUMMARY:'.length).replace(/\\([\\;,])/g, '$1');
  assert.equal(unescaped, title);
});

test('没有提前量时不生成闹钟', () => {
  const { content } = buildIcs([
    { id: 'r7', title: '无闹钟', deadline: '2026-11-07T17:00:00+08:00', remindLeadMinutes: 0 },
  ], { now: NOW });
  assert.equal(content.includes('BEGIN:VALARM'), false);
});

test('描述里带出本地墙钟时间，便于人读', () => {
  const { content } = buildIcs([
    { id: 'r8', title: '看时间', deadline: '2026-11-07T17:00:00+08:00', timezone: 'Asia/Shanghai' },
  ], { now: NOW });
  assert.ok(content.includes('截止：2026-11-07 17:00（Asia/Shanghai）'));
});
