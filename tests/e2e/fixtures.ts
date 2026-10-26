import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { startNetworkGuard } from './network-guard';

/** Load the built extension with launch-time HTTP(S) denial and routed fixtures. */
export async function launchExtension(userDataDir: string, headless: boolean, options: { extensionPath?: string; installRouting?: boolean } = {}) {
    const edge = test.info().project.name === 'edge-extension';
    const extensionPath = options.extensionPath ?? path.resolve(edge ? '.output/edge-mv3' : '.output/chrome-mv3');
    const guard = await startNetworkGuard();
    let context: BrowserContext;
    try {
        context = await chromium.launchPersistentContext(userDataDir, {
        channel: edge ? 'msedge' : 'chromium',
        ...(edge && process.env.EDGE_EXECUTABLE_PATH ? { executablePath: process.env.EDGE_EXECUTABLE_PATH } : {}),
        headless,
        proxy: guard.proxy,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--lang=en-US',
        ],
        locale: 'en-US',
        });
    } catch (error) {
        await guard.close();
        throw error;
    }
    const unexpectedRequests: string[] = [];
    if (options.installRouting !== false) await context.route(/^https?:\/\//, async route => {
        const url = new URL(route.request().url());
        unexpectedRequests.push(`${route.request().method()} ${url.origin}`);
        await route.abort();
    });

    return {
        context,
        startupDenials: guard.attempts,
        async close(expectedBlockedRequests: readonly string[] = []) {
            try {
                await context.close();
            } finally {
                await guard.close();
            }
            expect(unexpectedRequests, 'External requests require an explicit response fixture').toEqual(expectedBlockedRequests);
        },
    };
}

/** Wait only on fresh profiles; a restarted profile has no install event. */
export async function waitForInstalledSettings(context: BrowserContext) {
    const background = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(background.url()).hostname;
    const settingsUrl = `chrome-extension://${id}/options.html`;
    // onInstalled reuses an existing options tab. Wait for its navigation
    // before a test opens another page that the install handler could reuse.
    await expect.poll(() => context.pages().some(page => page.url() === settingsUrl)).toBe(true);
    const installedSettings = context.pages().find(page => page.url() === settingsUrl)!;
    await expect(installedSettings.locator('#providers')).toBeVisible();
    return id;
}

export const test = base.extend<{
    context: BrowserContext;
    extensionId: string;
}>({
    context: async ({ headless }, use) => {
        const extension = await launchExtension('', headless);
        try {
            const browser = extension.context.browser();
            if (!browser) throw new Error('Browser runtime metadata is unavailable');
            await test.info().attach('browser-runtime', {
                body: JSON.stringify({
                    project: test.info().project.name,
                    engine: browser.browserType().name(),
                    version: browser.version(),
                }),
                contentType: 'application/json',
            });
            await use(extension.context);
        } finally {
            await extension.close();
        }
    },
    extensionId: async ({ context }, use) => {
        await use(await waitForInstalledSettings(context));
    },
});

export { expect };
