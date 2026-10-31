import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STORAGE_STATE, BASE_URL } from './support/env';

const CI = !!process.env.CI;

/// The agent specs and the feature flags spec switch the instance-wide `agent.delegate` flag on and off, so they run one
/// at a time.
const AGENT_SPECS = /(agents[\\/].*|identity[\\/]feature-flags)\.spec\.ts/;

const PERF_SPECS = /\.perf\.spec\.ts$/;

/// The network service runs inside the browser process: as a separate process it was sometimes
/// killed at startup and every later context or cookie call hung (D-161). Chromium keeps only the
/// last `--enable-features`, so Playwright's own `CDPScreenshotNewSurface` is repeated here.
const CHROMIUM = {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    storageState: ADMIN_STORAGE_STATE,
    launchOptions: {
        args: ['--enable-features=CDPScreenshotNewSurface,NetworkServiceInProcess2'],
    },
};

/// Runs against an already running stack (docker compose: web on :8080 → api). Set
/// E2E_BASE_URL to target another environment, e.g. http://localhost:4200 for `ng serve`.
export default defineConfig({
    testDir: './tests',
    /// A full parallel run against a docker stack on a shared machine sees stalls of several seconds (D-161).
    timeout: 60_000,
    expect: { timeout: 10_000 },
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
            testIgnore: [AGENT_SPECS, PERF_SPECS],
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
        {
            name: 'perf',
            testMatch: PERF_SPECS,
            fullyParallel: false,
            use: CHROMIUM,
            dependencies: ['setup'],
        },
    ],
});
