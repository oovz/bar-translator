import { test, expect } from './fixtures';
import { addInstance, chooseLanguage, languageInput, message, nameAndKey, openSettings, saveInstance, setEnabled } from './setup-ui';

test('keeps current configuration separate from legacy recovery data and avoids sensitive diagnostics', async ({ context, extensionId }) => {
    const requests: string[] = [];
    const diagnostics: string[] = [];
    context.on('request', request => {
        if (/^https?:/.test(request.url()) && request.method() !== 'OPTIONS') requests.push(request.url());
    });
    const page = await openSettings(context, extensionId, true);
    page.on('console', event => diagnostics.push(event.text()));
    await chooseLanguage(page, 'target', 'Spanish');
    await page.evaluate(async () => {
        await chrome.storage.sync.set({
            preferences: { fallbackOrder: [], defaultTargetLang: 'fr', defaultSourceLang: 'auto', languageOverrides: {} },
            apiKeys: { microsoft: { key: 'preserved-sync-recovery', validated: true } },
        });
        await chrome.storage.local.set({ apiKeys_local: { deepl: { key: 'preserved-local-recovery:fx', validated: false } } });
        const token = 'phc_yI0ofU7zKrbDyBlCEwGTfsT5EkfcGnmmUE2XRewGg3h';
        for (const storage of [localStorage, sessionStorage]) {
            storage.setItem(`ph_${token}_posthog`, 'obsolete-identity');
            storage.setItem(`__ph_opt_in_out_${token}`, '1');
            storage.setItem('unrelated', 'preserved');
        }
    });
    await page.reload();
    await expect(await languageInput(page, 'target')).toHaveValue('Spanish');
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({
        local: { unrelated: 'preserved' }, session: { unrelated: 'preserved' },
    });

    const { row: deepl } = await addInstance(page, 'deepl');
    const alias = '<script>account & one</script>';
    await nameAndKey(page, deepl, alias, 'private-current-fixture:fx');
    await expect(deepl.locator('.service-name')).toHaveText(alias);
    await expect(deepl.locator('.service-name script')).toHaveCount(0);
    expect(requests).toEqual([]);
    let rejected = false;
    await context.route('https://api-free.deepl.com/v2/usage', route => route.fulfill(route.request().method() === 'OPTIONS' ? {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization', 'Access-Control-Allow-Methods': 'GET' },
    } : {
        status: rejected ? 403 : 200,
        contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(rejected ? { error: 'sensitive-server-body-marker' } : { character_count: 0, character_limit: 500000 }),
    }));
    await expect(deepl.getByRole('button', { name: await message(page, 'testKey'), exact: true })).toBeDisabled();
    await setEnabled(deepl, true);
    expect(requests).toEqual([]);
    await deepl.getByRole('button', { name: await message(page, 'testKey'), exact: true }).click();
    await expect(deepl.getByRole('status')).toHaveText(await message(page, 'valid'));
    rejected = true;
    await deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true }).fill('private-rejected-fixture:fx');
    await saveInstance(page, deepl);
    await deepl.getByRole('button', { name: await message(page, 'testKey'), exact: true }).click();
    await expect(deepl.getByRole('alert')).toBeVisible();
    expect(requests).toEqual(['https://api-free.deepl.com/v2/usage', 'https://api-free.deepl.com/v2/usage']);
    expect(diagnostics.join('\n')).not.toMatch(/private-current-fixture|private-rejected-fixture|preserved-local-recovery|preserved-sync-recovery|obsolete-identity|sensitive-server-body-marker/);
    expect(await page.evaluate(async () => ({
        sync: (await chrome.storage.sync.get('apiKeys')).apiKeys,
        local: (await chrome.storage.local.get('apiKeys_local')).apiKeys_local,
    }))).toEqual({
        sync: { microsoft: { key: 'preserved-sync-recovery', validated: true } },
        local: { deepl: { key: 'preserved-local-recovery:fx', validated: false } },
    });
});
