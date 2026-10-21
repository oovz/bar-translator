import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import path from 'node:path';

/** Load the built extension in a disposable context with controlled network access. */
export async function launchExtension(userDataDir: string, headless: boolean) {
    const extensionPath = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            '--lang=en-US',
        ],
        locale: 'en-US',
    });
    const unexpectedRequests: string[] = [];
    await context.route(/^https?:\/\//, async route => {
        const url = new URL(route.request().url());
        unexpectedRequests.push(`${route.request().method()} ${url.origin}`);
        await route.abort();
    });

    return {
        context,
        async close() {
            await context.close();
            expect(unexpectedRequests, 'External requests require an explicit response fixture').toEqual([]);
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
