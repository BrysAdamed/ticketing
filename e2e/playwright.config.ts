import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STORAGE_STATE, BASE_URL } from './support/env';

const CI = !!process.env.CI;

/// The agent specs switch the instance-wide `agent.delegate` flag on and off, so they run one at a time.
const AGENT_SPECS = /agents[\\/].*\.spec\.ts/;

const CHROMIUM = {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    storageState: ADMIN_STORAGE_STATE,
};

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
            testIgnore: AGENT_SPECS,
            use: CHROMIUM,
            dependencies: ['setup'],
        },
        {
            name: 'agents',
            testMatch: AGENT_SPECS,
            fullyParallel: false,
            workers: 1,
            use: CHROMIUM,
            dependencies: ['setup'],
        },
    ],
});
