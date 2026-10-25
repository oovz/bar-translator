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

export const test = base.extend<{
    context: BrowserContext;
    extensionId: string;
}>({
    context: async ({ headless }, use) => {
        const extension = await launchExtension('', headless);
        try {
            await use(extension.context);
        } finally {
            await extension.close();
        }
    },
    extensionId: async ({ context }, use) => {
        const background = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        await use(new URL(background.url()).hostname);
    },
});

export { expect };
