import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    failOnFlakyTests: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [['html'], ['list']],
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    use: {
        // The bundled Chromium channel's new headless mode supports extension loading.
        headless: true,
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
        {
            name: 'edge-extension',
            use: { ...devices['Desktop Edge'] },
        },
    ],
});
