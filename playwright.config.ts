import { defineConfig } from '@playwright/test';

// 默认跑开发服务器（改代码即时生效）。跑「交付形态」回归时改用单进程：
// 同一端口同时提供构建产物与 API，与 npm start 完全一致。
// 触发方式：npm run test:browser:prod（跨平台，不依赖 shell 变量语法）或 PW_MODE=prod。
const prodMode = process.env.PW_MODE === 'prod' || process.env.npm_lifecycle_event === 'test:browser:prod';

const devServers = [
  {
    command: 'node server/index.mjs', url: 'http://127.0.0.1:3001/api/health',
    reuseExistingServer: !process.env.CI, timeout: 30000,
  },
  {
    command: 'node node_modules/vite/bin/vite.js --config vite.standalone.config.ts',
    url: 'http://127.0.0.1:8001/standalone.html', reuseExistingServer: !process.env.CI, timeout: 120000,
  },
];

const prodServers = [
  {
    command: 'node scripts/start.mjs', url: 'http://127.0.0.1:8001/api/health',
    reuseExistingServer: !process.env.CI, timeout: 120000, env: { PORT: '8001' },
  },
];

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8001', channel: 'msedge', headless: true,
    timezoneId: 'America/New_York', trace: 'retain-on-failure',
  },
  webServer: prodMode ? prodServers : devServers,
});
