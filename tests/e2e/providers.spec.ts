import { test, expect } from './fixtures';
import type { StoredApiKeys } from '@/src/types';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('offers the three implemented providers with their required host permissions', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('.service-name')).toHaveText([
        'Google Translate (Web)', 'Lingva (Google Proxy)', 'DeepL',
    ]);
    const origins = [
        'https://translate.google.com/*', 'https://lingva.ml/*',
        'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
    ];
    expect(await page.evaluate(() => chrome.runtime.getManifest().host_permissions)).toEqual(origins);
    expect(await page.evaluate(origins => chrome.permissions.contains({ origins }), origins)).toBe(true);
});

test('preserves disable-all on reopened settings and keeps hidden credentials when re-enabling', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const url = `chrome-extension://${extensionId}/options.html`;
    await page.goto(url);
    await page.locator('[title="Disable service"]').click();
    const disabledMessage = await page.evaluate(() => chrome.i18n.getMessage('noServicesEnabled'));
    await expect(page.getByText(disabledMessage, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.service-item.enabled')).toHaveCount(0);
    await page.evaluate(() => chrome.storage.local.set({ apiKeys_local: {
        microsoft: { key: 'preserved-test-key', validated: true },
    } }));
    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(url);
    await expect(reopened.locator('.service-item.enabled')).toHaveCount(0);
    await reopened.locator('[data-id="lingva"] [title="Enable service"]').click();
    await reopened.reload();
    await expect(reopened.locator('.service-item.enabled')).toHaveAttribute('data-id', 'lingva');
    expect(await reopened.evaluate(async () => {
        const { apiKeys_local } = await chrome.storage.local.get<{ apiKeys_local: StoredApiKeys }>('apiKeys_local');
        return apiKeys_local.microsoft?.key === 'preserved-test-key';
    })).toBe(true);
});

test('validates DeepL with authenticated usage requests and preserves explicit enabling', async ({ context, extensionId }) => {
    const page = await context.newPage();
    let rejectKey = false;
    const checks: { url: string; authorization: string | undefined }[] = [];
    await page.route('https://*.deepl.com/v2/usage', async route => {
        checks.push({ url: route.request().url(), authorization: route.request().headers().authorization });
        await route.fulfill({
            status: rejectKey ? 403 : 200,
            contentType: 'application/json',
            body: JSON.stringify({ character_count: 0, character_limit: 500000 }),
        });
    });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const deepl = page.locator('[data-id="deepl"]');
    await deepl.getByText('API Key', { exact: true }).click();
    const input = deepl.locator('input');
    await input.fill('fixture-key:fx');
    await deepl.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(deepl.locator('.btn-success')).toBeVisible();
    await expect(deepl).toHaveClass(/disabled-item/);
    expect(checks).toEqual([{
        url: 'https://api-free.deepl.com/v2/usage', authorization: 'DeepL-Auth-Key fixture-key:fx',
    }]);

    await input.fill('fixture-pro-key');
    await deepl.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(deepl.locator('.btn-success')).toBeVisible();
    expect(checks[1]).toEqual({
        url: 'https://api.deepl.com/v2/usage', authorization: 'DeepL-Auth-Key fixture-pro-key',
    });

    rejectKey = true;
    await input.fill('fixture-rejected-key:fx');
    await deepl.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(deepl.getByText(/Validation failed/)).toBeVisible();
    await expect(deepl.locator('.btn-success')).toHaveCount(0);
    expect(await page.evaluate(async () => {
        const { apiKeys_local } = await chrome.storage.local.get<{ apiKeys_local: StoredApiKeys }>('apiKeys_local');
        return apiKeys_local.deepl?.validated;
    })).toBe(false);
});

test('persists successive provider reorders', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('[data-id="lingva"] [title="Enable service"]').click();
    await page.locator('[data-id="deepl"] [title="Enable service"]').click();
    const enabled = page.locator('.service-item.enabled');
    await expect(enabled).toHaveCount(3);

    for (const id of ['deepl', 'lingva']) {
        const handle = await page.locator(`[data-id="${id}"] .drag-handle`).boundingBox();
        const preceding = await enabled.nth(1).boundingBox();
        expect(handle).toBeTruthy();
        expect(preceding).toBeTruthy();
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle!.x + 5, preceding!.y + 5, { steps: 30 });
        await expect(enabled.nth(1)).toHaveAttribute('data-id', id);
        await page.mouse.up();
        await expect(enabled.nth(1)).toHaveAttribute('data-id', id);
    }

    await page.reload();
    await expect(enabled.locator('.service-name')).toHaveText([
        'Google Translate (Web)', 'Lingva (Google Proxy)', 'DeepL',
    ]);
});

test('keeps disable-all after closing and restarting Chrome', async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'bar-provider-restart-'));
    const extensionPath = path.resolve('.output/chrome-mv3');
    const launch = () => chromium.launchPersistentContext(profile, {
        headless: false,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let context = await launch();
    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const extensionId = new URL(worker.url()).host;
        const url = `chrome-extension://${extensionId}/options.html`;
        const page = await context.newPage();
        await page.goto(url);
        await page.locator('[title="Disable service"]').click();
        await expect.poll(() => page.evaluate(async () => {
            const { preferences } = await chrome.storage.sync.get<{ preferences: { fallbackOrder: string[] } }>('preferences');
            return preferences.fallbackOrder;
        })).toEqual([]);
        await context.close();

        context = await launch();
        const reopened = await context.newPage();
        await reopened.goto(url);
        const message = await reopened.evaluate(() => chrome.i18n.getMessage('noServicesEnabled'));
        await expect(reopened.getByText(message, { exact: true })).toBeVisible();
        await expect(reopened.locator('.service-item.enabled')).toHaveCount(0);
        await reopened.locator('[data-id="lingva"] [title="Enable service"]').click();
        await expect(reopened.locator('.service-item.enabled')).toHaveAttribute('data-id', 'lingva');
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});
