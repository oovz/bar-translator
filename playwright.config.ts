import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Chrome extension E2E testing.
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // Extensions require sequential execution
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Chrome extensions require single worker
    reporter: [['html'], ['list']],
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    use: {
        headless: false, // Extensions require headed mode
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium-extension',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
    ],
});
