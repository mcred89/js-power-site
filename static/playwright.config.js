const { defineConfig, devices } = require('@playwright/test');

const remoteBaseUrl = process.env.SMOKE_BASE_URL;

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30000,
  use: {
    baseURL: remoteBaseUrl || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: remoteBaseUrl ? undefined : {
    command: 'npm run smoke:serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    {
      name: 'website-desktop',
      testMatch: /website\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'pwa-mobile',
      testMatch: /pwa\.spec\.js/,
      use: {
        ...devices['Pixel 7'],
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
  ],
});
