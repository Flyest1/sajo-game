import { defineConfig, devices } from '@playwright/test';

const testPort=Number(process.env.PLAYWRIGHT_PORT||4174);
const testBase=`http://127.0.0.1:${testPort}/sajo-game/`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: testBase,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort}`,
    url: testBase,
    reuseExistingServer: !process.env.CI,
  },
});
