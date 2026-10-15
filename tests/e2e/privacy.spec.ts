import { test, expect } from './fixtures';

test('preserves translation setup while removing analytics data and controls', async ({ context, extensionId }) => {
    const externalRequests: string[] = [];
    const diagnostics: string[] = [];
    context.on('request', request => {
        if (/^https?:/.test(request.url())) externalRequests.push(request.url());
    });
    const page = await context.newPage();
    page.on('console', message => diagnostics.push(message.text()));
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const privacyDescription = await page.evaluate(() => chrome.i18n.getMessage('privacyDesc'));
    await expect(page.getByText(privacyDescription, { exact: true })).toBeVisible();
    await expect(page.locator('.section').last().locator('input')).toHaveCount(0);
    expect(await page.evaluate(() => chrome.storage.sync.get('preferences'))).toEqual({});

    await page.evaluate(async () => {
        await chrome.storage.sync.set({
            preferences: {
                fallbackOrder: ['deepl'], defaultTargetLang: 'fr', defaultSourceLang: 'auto',
                storageType: 'local', languageOverrides: { zh: 'zh-TW' },
                telemetryEnabled: true, distinctId: 'obsolete-identity',
            },
            apiKeys: { microsoft: { key: 'preserved-sync-key', validated: true } },
        });
        await chrome.storage.local.set({ apiKeys_local: {
            deepl: { key: 'preserved-local-key:fx', validated: false, tier: 'free' },
        } });
        const token = 'phc_yI0ofU7zKrbDyBlCEwGTfsT5EkfcGnmmUE2XRewGg3h';
        for (const storage of [localStorage, sessionStorage]) {
            storage.setItem(`ph_${token}_posthog`, 'obsolete-identity');
            storage.setItem(`__ph_opt_in_out_${token}`, '1');
            storage.setItem('unrelated', 'preserved');
        }
    });
    await page.reload();
    await expect(page.getByText(privacyDescription, { exact: true })).toBeVisible();
    const state = await page.evaluate(async () => ({
        sync: await chrome.storage.sync.get(null),
        local: await chrome.storage.local.get(null),
        localBrowser: { ...localStorage }, sessionBrowser: { ...sessionStorage },
    }));
    expect(state).toEqual({
        sync: {
            preferences: {
                fallbackOrder: ['deepl'], defaultTargetLang: 'fr', defaultSourceLang: 'auto',
                storageType: 'local', languageOverrides: { zh: 'zh-TW' },
            },
            apiKeys: { microsoft: { key: 'preserved-sync-key', validated: true } },
        },
        local: { apiKeys_local: {
            deepl: { key: 'preserved-local-key:fx', validated: false, tier: 'free' },
        } },
        localBrowser: { unrelated: 'preserved' }, sessionBrowser: { unrelated: 'preserved' },
    });

    await page.locator('[data-id="lingva"] [title="Enable service"]').click();
    const deepl = page.locator('[data-id="deepl"]');
    await deepl.getByText('API Key', { exact: true }).click();
    let rejectKey = false;
    await page.route('https://api-free.deepl.com/v2/usage', route => route.fulfill({
        status: rejectKey ? 403 : 200, contentType: 'application/json', body: '{}',
    }));
    await deepl.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(deepl.locator('.btn-success')).toBeVisible();
    rejectKey = true;
    await deepl.locator('input').fill('rejected-private-key:fx');
    await deepl.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(deepl.getByText(/Validation failed/)).toBeVisible();

    expect(externalRequests).toEqual([
        'https://api-free.deepl.com/v2/usage', 'https://api-free.deepl.com/v2/usage',
    ]);
    expect(diagnostics.join('\n')).not.toMatch(/private-key|preserved-local-key|preserved-sync-key|obsolete-identity/);
});
