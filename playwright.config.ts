import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:2929',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--enable-features=SharedArrayBuffer'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:2929',
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
