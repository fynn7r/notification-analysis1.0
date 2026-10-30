import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openKnowledgeDb } from './knowledge/db.mjs';
import { createFirstAdmin } from './knowledge/auth.mjs';
import {
  deleteReminder,
  getReminder,
  importLocalReminders,
  listReminders,
  patchReminder,
  upsertReminder,
} from './knowledge/reminders-store.mjs';

let dir;
let store;
let ownerId;
let otherId;

function makeReminder(overrides = {}) {
  return {
    id: 'r-1',
    title: '交纸质材料',
    type: '作业任务',
    importance: 'high',
    deadline: '2026-11-10T17:00:00+08:00',
    remindAt: '2026-11-09T17:00:00+08:00',
    remindLeadMinutes: 1440,
    remindOffset: '截止前1天',
    completed: false,
    source: 'notification',
    createdAt: 1761000000000,
    ...overrides,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'notizhi-reminders-'));
  store = openKnowledgeDb({ dir });
  const admin = await createFirstAdmin(store.db, { username: 'admin', displayName: '管理员', password: 'notizhi-admin-2026' });
  ownerId = admin.id;
  const row = store.db.prepare('INSERT INTO users (username, display_name, role, password_hash, password_salt, created_at) VALUES (?,?,?,?,?,?)')
    .run('other', 'Other', 'user', 'x', 'y', new Date().toISOString());
  otherId = Number(row.lastInsertRowid);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('待办数据层', () => {
  it('新建后能读回，关键列与 payload 都保留', () => {
    const saved = upsertReminder(store.db, ownerId, makeReminder());
    assert.equal(saved.id, 'r-1');
    assert.equal(saved.title, '交纸质材料');
    assert.equal(saved.deadline, '2026-11-10T17:00:00+08:00');
    assert.equal(saved.remindLeadMinutes, 1440);
    assert.equal(saved.completed, false);
    // payload 里的自定义字段原样保留
    assert.equal(saved.remindOffset, '截止前1天');
    assert.equal(saved.source, 'notification');
  });

  it('带同一个 id 重复提交是幂等更新，不产生第二行', () => {
    upsertReminder(store.db, ownerId, makeReminder());
    upsertReminder(store.db, ownerId, makeReminder({ title: '改名了' }));
    const all = listReminders(store.db, ownerId, 'all');
    assert.equal(all.length, 1);
    assert.equal(all[0].title, '改名了');
  });

  it('空串 deadline 存成 NULL，排序时排在有时间的待办之后', () => {
    upsertReminder(store.db, ownerId, makeReminder({ id: 'no-date', title: '没有截止', deadline: '', remindAt: '' }));
    upsertReminder(store.db, ownerId, makeReminder({ id: 'has-date', deadline: '2026-11-10T17:00:00+08:00' }));
    const list = listReminders(store.db, ownerId, 'open');
    assert.deepEqual(list.map((item) => item.id), ['has-date', 'no-date']);
    assert.equal(list[1].deadline, '');
  });

  it('附件里的 dataUrl 被剥离，只留元数据', () => {
    const saved = upsertReminder(store.db, ownerId, makeReminder({
      attachments: [{ id: 'a1', type: 'image', name: 'p.png', dataUrl: 'data:image/png;base64,' + 'A'.repeat(5000), size: 1024 }],
    }));
    assert.equal(saved.attachments.length, 1);
    assert.equal(saved.attachments[0].name, 'p.png');
    assert.equal(saved.attachments[0].dataUrl, undefined);
  });

  it('payload 过大时拒绝，避免撑爆数据库行', () => {
    assert.throws(() => upsertReminder(store.db, ownerId, makeReminder({
      note: 'x'.repeat(40 * 1024),
    })), /过大/);
  });

  it('标题为空或超长被拒绝', () => {
    assert.throws(() => upsertReminder(store.db, ownerId, makeReminder({ title: '   ' })), /标题/);
    assert.throws(() => upsertReminder(store.db, ownerId, makeReminder({ title: 'x'.repeat(201) })), /200/);
  });

  it('删除是软删：列表里消失，行还在并带墓碑', () => {
    upsertReminder(store.db, ownerId, makeReminder());
    deleteReminder(store.db, ownerId, 'r-1');
    assert.equal(listReminders(store.db, ownerId, 'all').length, 0);
    assert.equal(getReminder(store.db, ownerId, 'r-1'), null);
    const row = store.db.prepare('SELECT deleted_at FROM reminders WHERE id = ?').get('r-1');
    assert.ok(row.deleted_at, '应当留下墓碑');
  });

  it('同 id 再次提交会把软删的待办恢复', () => {
    upsertReminder(store.db, ownerId, makeReminder());
    deleteReminder(store.db, ownerId, 'r-1');
    const restored = upsertReminder(store.db, ownerId, makeReminder());
    assert.equal(restored.id, 'r-1');
    assert.equal(listReminders(store.db, ownerId, 'all').length, 1);
  });

  it('部分更新只改传入字段', () => {
    upsertReminder(store.db, ownerId, makeReminder());
    const patched = patchReminder(store.db, ownerId, 'r-1', { completed: true });
    assert.equal(patched.completed, true);
    assert.equal(patched.title, '交纸质材料');
    assert.equal(listReminders(store.db, ownerId, 'open').length, 0);
    assert.equal(listReminders(store.db, ownerId, 'done').length, 1);
  });

  it('看不到别人的待办，也不能覆盖别人的 id', () => {
    upsertReminder(store.db, ownerId, makeReminder());
    assert.equal(getReminder(store.db, otherId, 'r-1'), null);
    assert.equal(listReminders(store.db, otherId, 'all').length, 0);
    assert.throws(() => upsertReminder(store.db, otherId, makeReminder()), /已被占用/);
    assert.throws(() => deleteReminder(store.db, otherId, 'r-1'), /不存在/);
  });

  it('导入跳过 mock- 示例数据与已存在的 id', () => {
    upsertReminder(store.db, ownerId, makeReminder({ id: 'r-existing' }));
    const result = importLocalReminders(store.db, ownerId, [
      makeReminder({ id: 'mock-reminder-001', title: '数学建模竞赛报名截止' }),
      makeReminder({ id: 'mock-reminder-002', title: '每周组会' }),
      makeReminder({ id: 'r-existing', title: '已存在' }),
      makeReminder({ id: 'r-new-1' }),
      makeReminder({ id: 'r-new-2' }),
    ]);
    assert.equal(result.imported, 2);
    assert.equal(result.skippedMock, 2);
    assert.equal(result.skippedDuplicate, 1);
    assert.equal(result.failed.length, 0);
    const all = listReminders(store.db, ownerId, 'all');
    assert.equal(all.length, 3);
    assert.equal(all.some((item) => item.title === '每周组会'), false);
  });

  it('重复导入同一批不产生重复数据', () => {
    const batch = [makeReminder({ id: 'a' }), makeReminder({ id: 'b' })];
    const first = importLocalReminders(store.db, ownerId, batch);
    const second = importLocalReminders(store.db, ownerId, batch);
    assert.equal(first.imported, 2);
    assert.equal(second.imported, 0);
    assert.equal(second.skippedDuplicate, 2);
    assert.equal(listReminders(store.db, ownerId, 'all').length, 2);
  });

  it('导入时坏数据不中断整批，逐条记录失败原因', () => {
    const result = importLocalReminders(store.db, ownerId, [
      makeReminder({ id: 'good' }),
      makeReminder({ id: 'bad-title', title: '' }),
    ]);
    assert.equal(result.imported, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, 'bad-title');
  });

  it('非法时间被拒绝，而不是悄悄存成 Invalid Date', () => {
    assert.throws(() => upsertReminder(store.db, ownerId, makeReminder({ deadline: '不是时间' })), /时间格式/);
  });
});
