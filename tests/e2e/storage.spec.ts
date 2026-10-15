import { test, expect } from './fixtures';

test('switches credentials per device and keeps shared keys after choosing local', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const storageLabel = await page.evaluate(() => chrome.i18n.getMessage('labelStorage'));
    const selector = page.getByRole('combobox', { name: storageLabel, exact: true });
    await expect(selector).toHaveValue('local');
    await page.evaluate(async () => {
        await chrome.storage.local.set({ apiKeys_local: {
            deepl: { key: 'device-key:fx', validated: true, tier: 'free' },
        } });
        await chrome.storage.sync.set({
            preferences: { fallbackOrder: ['deepl'], defaultTargetLang: 'fr', defaultSourceLang: 'auto', languageOverrides: {} },
            apiKeys: { microsoft: { key: 'other-provider', validated: true } },
        });
    });
    await page.reload();
    await page.getByText('API Key', { exact: true }).click();
    const key = page.locator('[data-id="deepl"] input');
    await expect(key).toHaveValue('device-key:fx');
    await selector.selectOption('sync');
    await expect(selector).toHaveValue('sync');
    await expect(selector).toBeEnabled();
    await expect(key).toHaveValue('device-key:fx');
    const synced = await page.evaluate(() => chrome.storage.sync.get(null));
    expect(synced.apiKeys).toEqual({
        deepl: { key: 'device-key:fx', validated: true, tier: 'free' },
        microsoft: { key: 'other-provider', validated: true },
    });
    expect(synced.preferences).not.toHaveProperty('storageType');
    expect(await page.evaluate(() => chrome.storage.local.get(null))).toEqual({ credentialStorageType: 'sync' });
    await page.reload();
    await expect(selector).toHaveValue('sync');
    await selector.selectOption('local');
    await expect(selector).toHaveValue('local');
    await expect(selector).toBeEnabled();
    expect(await page.evaluate(() => chrome.storage.sync.get(null))).toEqual(synced);
    await page.reload();
    await expect(selector).toHaveValue('local');
    await page.getByText('API Key', { exact: true }).click();
    await expect(key).toHaveValue('device-key:fx');
});

for (const stage of ['destination', 'selection', 'cleanup'] as const) {
    test(`recovers from ${stage} failure with the saved selection and keys visible`, async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        await page.evaluate(async () => {
            await chrome.storage.local.set({ apiKeys_local: {
                deepl: { key: 'recoverable-key:fx', validated: true, tier: 'free' },
            } });
        });
        await page.reload();
        await page.getByText('API Key', { exact: true }).click();
        await page.evaluate(failure => {
            const area = failure === 'destination' ? chrome.storage.sync : chrome.storage.local;
            const operation = failure === 'cleanup' ? 'remove' : 'set';
            const original = area[operation];
            Reflect.set(area, operation, async () => {
                Reflect.set(area, operation, original);
                throw new Error('Storage unavailable');
            });
        }, stage);
        const labels = await page.evaluate(() => ({
            storage: chrome.i18n.getMessage('labelStorage'),
            failure: chrome.i18n.getMessage('storageChangeFailed'),
            retry: chrome.i18n.getMessage('retry'),
        }));
        const selector = page.getByRole('combobox', { name: labels.storage, exact: true });
        await selector.selectOption('sync');
        await expect(page.getByRole('alert')).toContainText(labels.failure);
        await expect(selector).toHaveValue(stage === 'cleanup' ? 'sync' : 'local');
        await expect(page.locator('[data-id="deepl"] input')).toHaveValue('recoverable-key:fx');
        await page.getByRole('button', { name: labels.retry, exact: true }).click();
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(selector).toHaveValue('sync');
        await expect(selector).toBeEnabled();
        await page.reload();
        await expect(selector).toHaveValue('sync');
        await page.getByText('API Key', { exact: true }).click();
        await expect(page.locator('[data-id="deepl"] input')).toHaveValue('recoverable-key:fx');
        expect(await page.evaluate(() => chrome.storage.local.get('apiKeys_local'))).toEqual({});
    });
}
