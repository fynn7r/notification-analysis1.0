#!/usr/bin/env node
/**
 * 一键启动：单端口同时提供前端页面与 API。
 *
 * 目标是把「下载后能用」压缩到 npm install && npm start 两步，其余由本脚本兜住：
 * 补齐配置文件、缺构建产物时自动构建、首次运行时创建管理员并打印初始密码。
 */
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = resolve(ROOT, 'dist-standalone');
const ENV_FILE = resolve(ROOT, '.env.local');
const ENV_EXAMPLE = resolve(ROOT, '.env.example');

const log = (message = '') => console.log(message);
const fail = (message) => {
  console.error(`\n启动失败：${message}\n`);
  process.exit(1);
};

// node:sqlite 每次启动都会打印 ExperimentalWarning。对首次使用的人是误导性噪音，
// 这里只屏蔽这一条，其余警告照常输出。
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (text.includes('SQLite is an experimental feature')) return;
  emitWarning(warning, ...rest);
};

/** node:sqlite 需要较新的运行时；版本过低时报错信息往往难以理解，这里提前拦住。 */
function ensureNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supported = major > 22 || (major === 22 && minor >= 18);
  if (!supported) {
    fail(`需要 Node.js 22.18 或更高版本（当前 ${process.versions.node}）。请到 https://nodejs.org 安装 LTS 版本后重试。`);
  }
}

async function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return false;
  if (!existsSync(ENV_EXAMPLE)) fail('缺少 .env.example，仓库可能不完整。');
  await copyFile(ENV_EXAMPLE, ENV_FILE);
  return true;
}

/** 首次运行时需要构建产物；普通用户不该被要求先理解 vite build。 */
function ensureBuild() {
  if (existsSync(resolve(DIST_DIR, 'standalone.html'))) return false;
  const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  if (!existsSync(viteBin)) fail('未找到依赖，请先在项目目录执行 npm install。');
  log('首次启动需要构建前端，约需 20-40 秒，请稍候…');
  const result = spawnSync(process.execPath, [viteBin, 'build', '--config', 'vite.standalone.config.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) fail('前端构建失败，请查看上方输出。');
  log('构建完成。');
  return true;
}

async function ensureAdmin(store) {
  const { countUsers, createFirstAdmin } = await import('../server/knowledge/auth.mjs');
  if (countUsers(store.db) > 0) return null;
  const password = randomBytes(9).toString('base64url');
  await createFirstAdmin(store.db, { username: 'admin', displayName: '管理员', password });
  return { username: 'admin', password };
}

/** 用系统默认浏览器打开地址；失败不影响服务本身。 */
function openBrowser(url) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  try {
    spawn(command, { shell: true, stdio: 'ignore', detached: true }).unref();
  } catch {
    /* 打不开浏览器时，用户仍可按终端里打印的地址手动访问。 */
  }
}

async function main() {
  ensureNodeVersion();
  const createdEnv = await ensureEnvFile();
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`无法读取 .env.local：${error.message}`);
  }
  const built = ensureBuild();

  const { createEnvSettingsStore } = await import('../server/ai-settings-service.mjs');
  const { openKnowledgeDb } = await import('../server/knowledge/db.mjs');
  const { createApiServer } = await import('../server/index.mjs');

  const settingsStore = createEnvSettingsStore(ENV_FILE);
  const knowledgeStore = openKnowledgeDb({ dir: process.env.KNOWLEDGE_STORE || resolve(ROOT, '.local/knowledge') });
  const createdAdmin = await ensureAdmin(knowledgeStore);

  const port = Number(process.env.PORT) || Number(process.env.WEB_PORT) || 8001;
  const server = createApiServer(settingsStore.getConfig(), fetch, settingsStore, knowledgeStore, DIST_DIR);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      fail(`端口 ${port} 已被占用。请关闭占用该端口的程序，或用 PORT=8010 npm start 换一个端口。`);
    }
    fail(error.message);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    log('');
    log('  通知智析已启动');
    log(`  访问地址：${url}`);
    if (createdEnv) log('  已根据 .env.example 生成 .env.local，模型密钥可在页面里填写。');
    if (built) log('  本次为首次启动，已自动完成前端构建。');
    if (createdAdmin) {
      log('');
      log('  已创建管理员账号（仅首次启动显示一次，请立即记录）：');
      log(`    账号：${createdAdmin.username}`);
      log(`    密码：${createdAdmin.password}`);
      log('  该密码只显示这一次，请立刻保存到安全的地方。');
    }
    log('');
    log('  下一步：在页面「我的 → 模型接入」填写 API 密钥，否则无法真实解析。');
    log('  按 Ctrl+C 停止服务。');
    log('');

    // 便携版的启动脚本会带上 OPEN_BROWSER=1，双击后不必自己复制地址；
    // 命令行用户不设置该变量，避免占用浏览器抢焦点。
    if (process.env.OPEN_BROWSER === '1') openBrowser(url);
  });

  const shutdown = () => {
    log('\n正在停止服务…');
    server.close(() => {
      try { knowledgeStore.close(); } catch { /* 已关闭 */ }
      process.exit(0);
    });
    // 兜底：连接迟迟不释放时强制退出，避免按 Ctrl+C 无反应。
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => fail(error?.message || String(error)));
