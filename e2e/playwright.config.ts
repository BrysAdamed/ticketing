import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STORAGE_STATE, BASE_URL } from './support/env';

const CI = !!process.env.CI;

/// Runs against an already running stack (docker compose: web on :8080 → api). Set
/// E2E_BASE_URL to target another environment, e.g. http://localhost:4200 for `ng serve`.
export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: CI,
    retries: CI ? 2 : 0,
    reporter: CI
        ? [
              ['html', { open: 'never' }],
              ['junit', { outputFile: 'results.xml' }],
          ]
        : 'list',
    use: {
        baseURL: BASE_URL,
        testIdAttribute: 'data-testid',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'setup', testMatch: /global\.setup\.ts/ },
        {
            name: 'chromium',
            testIgnore: /\.perf\.spec\.ts$/,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
                storageState: ADMIN_STORAGE_STATE,
            },
            dependencies: ['setup'],
        },
        {
            name: 'perf',
            testMatch: /\.perf\.spec\.ts$/,
            fullyParallel: false,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
                storageState: ADMIN_STORAGE_STATE,
            },
            dependencies: ['setup'],
        },
    ],
});
