#!/usr/bin/env node
/**
 * 知识库账号管理（仅限本机运行）。
 *
 *   node scripts/knowledge-admin.mjs init              创建首位管理员（交互式）
 *   node scripts/knowledge-admin.mjs invite <账号>      为指定管理员生成一次性邀请码
 *   node scripts/knowledge-admin.mjs list              查看账号与邀请状态
 *
 * 首位管理员必须由这个脚本在本机创建；公网入口不提供任何"首个注册者成为管理员"的路径。
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKnowledgeDb } from '../server/knowledge/db.mjs';
import { countUsers, createFirstAdmin, createInvite, listInvites, findUserByUsername } from '../server/knowledge/auth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storeDir = process.env.KNOWLEDGE_STORE || resolve(ROOT, '.local/knowledge');

async function promptHidden(rl, question) {
  stdout.write(question);
  const wasRaw = stdin.isRaw;
  if (!stdin.isTTY) {
    const answer = await rl.question('');
    return answer;
  }
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolveAnswer) => {
    let value = '';
    const onData = (buffer) => {
      for (const char of buffer.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolveAnswer(value);
          return;
        }
        if (char === '\u0003') { stdout.write('\n'); process.exit(130); }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const store = openKnowledgeDb({ dir: storeDir });
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    if (command === 'init') {
      if (countUsers(store.db) > 0) {
        console.error('已存在账号，不能再创建首位管理员。请用 invite 子命令生成邀请码。');
        process.exit(1);
      }
      console.log(`知识库目录：${store.dir}`);
      const username = (await rl.question('管理员账号（3–32 位小写字母/数字/下划线）：')).trim();
      const displayName = (await rl.question('显示名称：')).trim();
      const password = await promptHidden(rl, '密码（至少 12 位，输入时不回显）：');
      const confirm = await promptHidden(rl, '再输入一次密码：');
      if (password !== confirm) {
        console.error('两次输入的密码不一致，未创建账号。');
        process.exit(1);
      }
      const user = await createFirstAdmin(store.db, { username, displayName, password });
      console.log(`已创建管理员：${user.username}（id=${user.id}）`);
      console.log('现在可以登录，或在后台生成邀请码给其他用户。');
      return;
    }

    if (command === 'invite') {
      const account = rest[0];
      if (!account) {
        console.error('用法：node scripts/knowledge-admin.mjs invite <管理员账号>');
        process.exit(1);
      }
      const admin = findUserByUsername(store.db, account);
      if (!admin) { console.error(`找不到账号：${account}`); process.exit(1); }
      if (admin.role !== 'admin') { console.error('该账号不是管理员。'); process.exit(1); }
      const invite = createInvite(store.db, { createdBy: admin.id });
      console.log(`邀请码：${invite.code}`);
      console.log(`有效期至：${invite.expiresAt}（24 小时，仅可使用一次）`);
      return;
    }

    if (command === 'list') {
      const users = store.db.prepare('SELECT id, username, display_name, role, created_at, last_login_at FROM users ORDER BY id').all();
      console.log(`账号（${users.length}）：`);
      for (const user of users) {
        console.log(`  #${user.id} ${user.username} ${user.display_name} [${user.role}] 创建于 ${user.created_at} 最近登录 ${user.last_login_at ?? '—'}`);
      }
      const invites = listInvites(store.db);
      console.log(`\n邀请（最近 ${invites.length} 条）：`);
      for (const invite of invites) {
        console.log(`  #${invite.id} ${invite.role} 到期 ${invite.expires_at} ${invite.consumed_at ? `已使用于 ${invite.consumed_at}` : '未使用'}`);
      }
      return;
    }

    console.log(`知识库账号管理

  node scripts/knowledge-admin.mjs init              创建首位管理员
  node scripts/knowledge-admin.mjs invite <账号>      生成一次性邀请码
  node scripts/knowledge-admin.mjs list              查看账号与邀请

数据目录：${storeDir}`);
  } finally {
    rl.close();
    store.close();
  }
}

main().catch((error) => {
  console.error('执行失败：', error?.message ?? error);
  process.exit(1);
});
