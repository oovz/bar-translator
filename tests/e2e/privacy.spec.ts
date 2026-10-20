import { test, expect } from './fixtures';
import { mockOptionalPermissionsForSettings } from './permissions';

test('preserves translation setup and privacy with a mocked settings permission boundary', async ({ context, extensionId }) => {
    const externalRequests: string[] = [];
    const diagnostics: string[] = [];
    context.on('request', request => {
        if (/^https?:/.test(request.url()) && request.method() !== 'OPTIONS') externalRequests.push(request.url());
    });
    const page = await context.newPage();
    await mockOptionalPermissionsForSettings(page);
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
                languageOverrides: { zh: 'zh-TW' },
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
                languageOverrides: { zh: 'zh-TW' },
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
    const text = await page.evaluate(() => ({
        apiKey: chrome.i18n.getMessage('apiKeyLabel'), test: chrome.i18n.getMessage('testKey'),
        grant: chrome.i18n.getMessage('grantAccess'), failed: chrome.i18n.getMessage('keyTestFailed'),
    }));
    await deepl.getByText(text.apiKey, { exact: true }).click();
    await expect(deepl.getByRole('button', { name: text.test, exact: true })).toBeDisabled();
    await deepl.getByRole('button', { name: text.grant, exact: true }).click();
    let rejectKey = false;
    await page.route('https://api-free.deepl.com/v2/usage', route => route.fulfill(route.request().method() === 'OPTIONS' ? {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization', 'Access-Control-Allow-Methods': 'GET' },
    } : {
        status: rejectKey ? 403 : 200, contentType: 'application/json', body: '{}',
        headers: { 'Access-Control-Allow-Origin': '*' },
    }));
    await deepl.getByRole('button', { name: text.test, exact: true }).click();
    await expect(deepl.locator('.btn-success')).toBeVisible();
    rejectKey = true;
    await deepl.locator('input').fill('rejected-private-key:fx');
    await deepl.getByRole('button', { name: text.test, exact: true }).click();
    await expect(deepl.getByText(text.failed, { exact: true })).toBeVisible();

    expect(externalRequests).toEqual([
        'https://api-free.deepl.com/v2/usage', 'https://api-free.deepl.com/v2/usage',
    ]);
    expect(diagnostics.join('\n')).not.toMatch(/private-key|preserved-local-key|preserved-sync-key|obsolete-identity/);
});
