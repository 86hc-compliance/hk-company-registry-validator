import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90000,
  retries: 0,
  reporter: 'list',
  outputDir: '../../.context/e2e-results',
  use: {
    baseURL: 'http://localhost:3188',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_EXECUTABLE || (existsSync(macChrome) ? macChrome : undefined),
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3188/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'development',
      PORT: '3188',
      BASE_URL: 'http://localhost:3188',
      DATA_DIRECTORY: '../../.context/e2e-data',
      NORBY_STAFF_EMAILS: 'e2e-ops@example.test',
      TPSI_MODE: 'disabled',
      SMTP_URL: '',
    },
  },
});
