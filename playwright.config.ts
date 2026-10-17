import { defineConfig } from '@playwright/test';

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
  webServer: [
    {
      command: 'node server/index.mjs', url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !process.env.CI, timeout: 30000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --config vite.standalone.config.ts',
      url: 'http://127.0.0.1:8001/standalone.html', reuseExistingServer: !process.env.CI, timeout: 120000,
    },
  ],
});
