import { test, expect, launchExtension } from './fixtures';
import type { StoredApiKeys } from '@/src/types';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mockOptionalPermissionsForSettings } from './permissions';

test('starts without optional provider or copy access', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const origins = [
        'https://translate.google.com/*',
        'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
    ];
    expect(await page.evaluate(() => chrome.permissions.getAll())).toEqual({ permissions: ['storage'], origins: [] });
    expect(await page.evaluate(origins => chrome.permissions.contains({ origins }), origins)).toBe(false);
    const grantAccess = await page.evaluate(() => chrome.i18n.getMessage('grantAccess'));
    await expect(page.locator('[data-id="google-web"]').getByRole('button', { name: grantAccess, exact: true })).toBeVisible();
    await expect(page.locator('#copy input[type="checkbox"]')).not.toBeChecked();
});

test('preserves disable-all on reopened settings and keeps hidden credentials when re-enabling', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const url = `chrome-extension://${extensionId}/options.html`;
    await page.goto(url);
    await page.locator('[title="Disable service"]').click();
    await expect(page.locator('.service-item.enabled')).toHaveCount(0);
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
    await expect(reopened.locator('.service-item.enabled')).toHaveAttribute('data-id', 'lingva');
    await reopened.reload();
    await expect(reopened.locator('.service-item.enabled')).toHaveAttribute('data-id', 'lingva');
    expect(await reopened.evaluate(async () => {
        const { apiKeys_local } = await chrome.storage.local.get<{ apiKeys_local: StoredApiKeys }>('apiKeys_local');
        return apiKeys_local.microsoft?.key === 'preserved-test-key';
    })).toBe(true);
});

test('tests enabled DeepL keys with both domains through a mocked permission boundary', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await mockOptionalPermissionsForSettings(page);
    let rejectKey = false;
    const checks: { url: string; authorization: string | undefined }[] = [];
    await page.route('https://*.deepl.com/v2/usage', async route => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: {
                'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization',
                'Access-Control-Allow-Methods': 'GET',
            } });
            return;
        }
        checks.push({ url: route.request().url(), authorization: route.request().headers().authorization });
        await route.fulfill({
            status: rejectKey ? 403 : 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ character_count: 0, character_limit: 500000 }),
        });
    });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const text = await page.evaluate(() => ({
        apiKey: chrome.i18n.getMessage('apiKeyLabel'), test: chrome.i18n.getMessage('testKey'),
        ready: chrome.i18n.getMessage('providerReady'),
    }));
    const deepl = page.locator('[data-id="deepl"]');
    await deepl.getByText(text.apiKey, { exact: true }).click();
    const input = deepl.locator('input');
    await input.fill('fixture-key:fx');
    await expect(deepl.getByRole('button', { name: text.test, exact: true })).toBeDisabled();
    expect(checks).toEqual([]);
    await deepl.locator('[title="Enable service"]').click();
    await expect(deepl).toHaveClass(/enabled/);
    await expect(deepl.getByLabel(text.ready)).toBeVisible();
    expect(checks).toEqual([]);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([{ origins: [
        'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
    ] }]);
    await deepl.getByRole('button', { name: text.test, exact: true }).click();
    await expect(deepl.locator('.btn-success')).toBeVisible();
    expect(checks).toEqual([{
        url: 'https://api-free.deepl.com/v2/usage', authorization: 'DeepL-Auth-Key fixture-key:fx',
    }]);

    await input.fill('fixture-pro-key');
    await deepl.getByRole('button', { name: text.test, exact: true }).click();
    await expect(deepl.locator('.btn-success')).toBeVisible();
    expect(checks[1]).toEqual({
        url: 'https://api.deepl.com/v2/usage', authorization: 'DeepL-Auth-Key fixture-pro-key',
    });

    rejectKey = true;
    await input.fill('fixture-rejected-key:fx');
    await deepl.getByRole('button', { name: text.test, exact: true }).click();
    await expect(deepl.getByRole('alert')).toBeVisible();
    await expect(deepl.locator('.btn-success')).toHaveCount(0);
    await expect(deepl).toHaveClass(/enabled/);
    await expect(deepl.getByLabel(text.ready)).toBeVisible();
    expect(await page.evaluate(async () => {
        const { apiKeys_local } = await chrome.storage.local.get<{ apiKeys_local: StoredApiKeys }>('apiKeys_local');
        return apiKeys_local.deepl?.validated;
    })).toBe(false);
    await deepl.locator('[title="Disable service"]').click();
    await expect(deepl).toHaveClass(/disabled-item/);
    expect(await page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([{ origins: [
        'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
    ] }]);
});

test('persists successive provider reorders', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await mockOptionalPermissionsForSettings(page);
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.locator('[data-id="lingva"] [title="Enable service"]').click();
    await page.locator('[data-id="deepl"] [title="Enable service"]').click();
    const enabled = page.locator('.service-item.enabled');
    await expect(enabled).toHaveCount(3);

    for (const id of ['deepl', 'lingva']) {
        const dragHandle = page.locator(`[data-id="${id}"] .drag-handle`);
        // Actionability waits for the preceding reorder animation to settle.
        await dragHandle.hover();
        const handle = await dragHandle.boundingBox();
        const preceding = await enabled.nth(1).boundingBox();
        expect(handle).toBeTruthy();
        expect(preceding).toBeTruthy();
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle!.x + 5, preceding!.y + 5, { steps: 30 });
        await expect(enabled.nth(1)).toHaveAttribute('data-id', id);
        await page.mouse.up();
        await expect(enabled.nth(1)).toHaveAttribute('data-id', id);
        await expect.poll(() => page.evaluate(async () => {
            const { preferences } = await chrome.storage.sync.get<{ preferences: { fallbackOrder: string[] } }>('preferences');
            return preferences.fallbackOrder;
        })).toEqual(id === 'deepl'
            ? ['google-web', 'deepl', 'lingva']
            : ['google-web', 'lingva', 'deepl']);
    }

    await page.reload();
    await expect.poll(() => enabled.evaluateAll(items => items.map(item => item.getAttribute('data-id'))))
        .toEqual(['google-web', 'lingva', 'deepl']);
});

test('keeps disable-all after closing and restarting Chrome', async ({ headless }) => {
    const profile = await mkdtemp(path.join(tmpdir(), 'bar-provider-restart-'));
    let extension = await launchExtension(profile, headless);
    let context = extension.context;
    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const extensionId = new URL(worker.url()).host;
        const url = `chrome-extension://${extensionId}/options.html`;
        const settingsPage = async () => {
            await expect.poll(() => context.pages().map(page => page.url())).toContain(url);
            const page = context.pages().find(page => page.url() === url)!;
            await expect(page.locator('#providers')).toBeVisible();
            return page;
        };
        const page = await settingsPage();
        await page.locator('[title="Disable service"]').click();
        await expect.poll(() => page.evaluate(async () => {
            const { preferences } = await chrome.storage.sync.get<{ preferences?: { fallbackOrder: string[] } }>('preferences');
            return preferences?.fallbackOrder;
        })).toEqual([]);
        await extension.close();

        extension = await launchExtension(profile, headless);
        context = extension.context;
        const restartedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        await restartedWorker.evaluate(() => chrome.runtime.openOptionsPage());
        const reopened = await settingsPage();
        await expect(reopened.locator('.service-item.enabled')).toHaveCount(0);
        await reopened.locator('[data-id="lingva"] [title="Enable service"]').click();
        await expect(reopened.locator('.service-item.enabled')).toHaveAttribute('data-id', 'lingva');
    } finally {
        try {
            await extension.close();
        } finally {
            await rm(profile, { recursive: true, force: true });
        }
    }
});

test('keeps a denied provider disabled and its key saved through the mocked permission boundary', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await mockOptionalPermissionsForSettings(page);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const labels = await page.evaluate(() => ({
        apiKey: chrome.i18n.getMessage('apiKeyLabel'),
        test: chrome.i18n.getMessage('testKey'),
    }));
    const deepl = page.locator('[data-id="deepl"]');
    await deepl.getByText(labels.apiKey, { exact: true }).click();
    await deepl.locator('input').fill('saved-without-a-grant:fx');
    await page.evaluate(() => window.settingsPermissionMock.denyNextRequest());
    await deepl.locator('[title="Enable service"]').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(deepl).toHaveClass(/disabled-item/);
    await expect(deepl.getByRole('button', { name: labels.test, exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([{ origins: [
        'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
    ] }]);

    await page.reload();
    await expect(deepl).toHaveClass(/disabled-item/);
    await deepl.getByText(labels.apiKey, { exact: true }).click();
    await expect(deepl.locator('input')).toHaveValue('saved-without-a-grant:fx');
    await expect(deepl.getByRole('button', { name: labels.test, exact: true })).toBeDisabled();
});

test('updates an enabled provider after partial access revocation through the mocked permission boundary', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await mockOptionalPermissionsForSettings(page);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const labels = await page.evaluate(() => ({
        apiKey: chrome.i18n.getMessage('apiKeyLabel'),
        test: chrome.i18n.getMessage('testKey'),
        ready: chrome.i18n.getMessage('providerReady'),
        grant: chrome.i18n.getMessage('grantAccess'),
    }));
    const deepl = page.locator('[data-id="deepl"]');
    await deepl.getByText(labels.apiKey, { exact: true }).click();
    await deepl.locator('input').fill('untested-key:fx');
    await deepl.locator('[title="Enable service"]').click();
    await expect(deepl.getByLabel(labels.ready)).toBeVisible();
    await expect(deepl.getByRole('button', { name: labels.test, exact: true })).toBeEnabled();

    await page.evaluate(() => window.settingsPermissionMock.revoke({ origins: ['https://api.deepl.com/*'] }));
    await expect(deepl.getByRole('button', { name: labels.test, exact: true })).toBeDisabled();
    await expect(deepl.getByLabel(labels.ready)).toHaveCount(0);
    await expect(deepl).toHaveClass(/enabled/);
    await expect(deepl.locator('input')).toHaveValue('untested-key:fx');

    await deepl.getByRole('button', { name: labels.grant, exact: true }).click();
    await expect(deepl.getByLabel(labels.ready)).toBeVisible();
    await expect(deepl.getByRole('button', { name: labels.test, exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toHaveLength(2);
    expect(await page.evaluate(async () => {
        const { apiKeys_local } = await chrome.storage.local.get<{ apiKeys_local: StoredApiKeys }>('apiKeys_local');
        return apiKeys_local.deepl?.validated;
    })).toBe(false);
});
