import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, launchExtension, waitForInstalledSettings } from './fixtures';
import { addInstance, configure, enabledIds, instanceRow, message, nameAndKey, openSettings, saveInstance, setEnabled } from './setup-ui';

test('starts with Google Web and offers the remaining providers', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId);
    await expect(page.locator('#instance-priority').locator('.service-item')).toHaveCount(1);
    await expect(page.getByRole('list', { name: await message(page, 'availableProviders'), exact: true }).locator('.service-item')).toHaveCount(3);
    expect(await enabledIds(page)).toEqual(['google-web']);
    expect(await page.evaluate(() => chrome.permissions.getAll())).toEqual({ permissions: ['storage'], origins: [] });
    await expect(instanceRow(page, 'google-web').getByRole('button', { name: await message(page, 'grantInstanceAccess', ['Google Web']), exact: true })).toBeVisible();
    await expect(page.locator('#copy input[type="checkbox"]')).not.toBeChecked();
    const google = instanceRow(page, 'google-web');
    await expect(google.getByRole('textbox')).toHaveCount(0);
    await expect(google.locator('button[data-action="enable-instance"], button[data-action="disable-instance"]')).toHaveCount(0);
    await expect(google.locator('.service-disclosure')).toHaveCount(0);
    await expect(google.getByRole('button', { name: await message(page, 'deleteNamedInstance', ['Google Web']), exact: true })).toBeVisible();
    for (const provider of ['deepl', 'libretranslate'] as const) {
        const choice = page.locator(`#available-providers [data-catalog-provider="${provider}"]`);
        await expect(choice.getByRole('button')).toHaveCount(1);
        await expect(choice.getByRole('button', { name: await message(page, 'addProvider'), exact: true })).toBeVisible();
        const draft = await addInstance(page, provider);
        const name = draft.row.getByLabel(await message(page, 'instanceName'), { exact: true });
        const key = draft.row.getByLabel(await message(page, 'apiKeyLabel'), { exact: true });
        await name.fill('Unfinished account');
        await key.fill('draft-only-key');
        const add = choice.getByRole('button', { name: await message(page, 'addProvider'), exact: true });
        await expect(add).toBeEnabled();
        await add.click();
        await expect(name).toBeFocused();
        await expect(key).toHaveValue('draft-only-key');
        const disclosure = choice.locator('.service-disclosure');
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await expect(disclosure.locator('.disclosure-chevron')).toBeVisible();
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await expect(name).not.toBeVisible();
        await add.click();
        await expect(name).toBeFocused();
        await expect(name).toHaveValue('Unfinished account');
        await expect(key).toHaveValue('draft-only-key');
        await expect(choice.locator('.instance-editor')).toHaveCount(1);
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await draft.row.locator('[data-action="cancel-instance"]').click();
        await expect(draft.row).toHaveCount(0);
        await expect(choice.getByRole('button', { name: await message(page, 'addProvider'), exact: true })).toBeVisible();
        expect(await enabledIds(page)).toEqual(['google-web']);
    }
    await page.reload();
    await expect(page.locator('#available-providers .service-item')).toHaveCount(3);
});

test('saves separate DeepL accounts and tests each enabled account', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const checks: { origin: string; authorization: string | undefined }[] = [];
    await context.route('https://*.deepl.com/v2/usage', async route => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: {
                'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization',
                'Access-Control-Allow-Methods': 'GET',
            } });
            return;
        }
        const authorization = route.request().headers().authorization;
        checks.push({ origin: new URL(route.request().url()).origin, authorization });
        await route.fulfill({
            status: authorization?.includes('rejected') ? 403 : 200,
            contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ character_count: 0, character_limit: 500000 }),
        });
    });
    const { id: firstId, row: first } = await addInstance(page, 'deepl');
    await nameAndKey(page, first, 'Personal account', 'personal-fixture:fx');
    const second = await addInstance(page, 'deepl');
    await nameAndKey(page, second.row, 'Work account', 'work-rejected-fixture');
    const availableList = page.locator('#available-providers');
    await expect(availableList.locator(`[data-id="${firstId}"]`)).toBeVisible();
    await expect(availableList.locator(`[data-id="${second.id}"]`)).toBeVisible();
    await expect(first.locator('.service-name')).toHaveText('Personal account');
    await expect(second.row.locator('.service-name')).toHaveText('Work account');
    await expect(first).toContainText('DeepL');
    await expect(second.row).toContainText('DeepL');
    await expect(page.locator('#instance-priority .disabled-item')).toHaveCount(0);
    await expect(page.locator('#available-providers [data-catalog-provider="deepl"]')
        .getByRole('button', { name: await message(page, 'addAnother'), exact: true })).toBeVisible();
    await expect(availableList.locator('[data-id="lingva"]')).toHaveCount(0);
    await configure(page, second.row);
    const testLabel = await message(page, 'testKey');
    await expect(second.row.getByRole('button', { name: testLabel, exact: true })).toBeDisabled();
    expect(checks).toEqual([]);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([]);

    await setEnabled(first, true);
    await setEnabled(second.row, true);
    expect(checks).toEqual([]);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([
        { origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] },
        { origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] },
    ]);
    await configure(page, first);
    await first.getByRole('button', { name: testLabel, exact: true }).click();
    await expect(first.getByRole('status')).toHaveText(await message(page, 'valid'));
    await configure(page, second.row);
    await second.row.getByRole('button', { name: testLabel, exact: true }).click();
    await expect(second.row.getByRole('alert')).toBeVisible();
    await expect(second.row).toHaveClass(/\benabled\b/);
    await expect(second.row.locator('button[data-action="disable-instance"]')).toBeVisible();
    await expect(second.row.locator('[data-action="grant-access"]')).toHaveCount(0);
    expect(checks).toEqual([
        { origin: 'https://api-free.deepl.com', authorization: 'DeepL-Auth-Key personal-fixture:fx' },
        { origin: 'https://api.deepl.com', authorization: 'DeepL-Auth-Key work-rejected-fixture' },
    ]);

    await page.reload();
    await expect(first.locator('.service-name')).toHaveText('Personal account');
    await expect(second.row.locator('.service-name')).toHaveText('Work account');
    await configure(page, first);
    await expect(first.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('personal-fixture:fx');
    await configure(page, second.row);
    await expect(second.row.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('work-rejected-fixture');
});

test('tests a custom LibreTranslate server and clears its key when the address changes', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const calls: { method: string; pathname: string; body?: Record<string, unknown> }[] = [];
    await context.route('http://127.0.0.1:5100/libre/**', async route => {
        const request = route.request();
        if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: {
                'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type',
                'Access-Control-Allow-Methods': 'GET, POST',
            } });
            return;
        }
        const pathname = new URL(request.url()).pathname;
        calls.push({ method: request.method(), pathname, ...(request.method() === 'POST' ? { body: request.postDataJSON() } : {}) });
        await route.fulfill({
            status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(pathname.endsWith('/languages')
                ? [{ code: 'en', name: 'English', targets: ['es'] }, { code: 'es', name: 'Spanish', targets: ['en'] }]
                : { translatedText: 'Hola' }),
        });
    });
    const { row } = await addInstance(page, 'libretranslate');
    await expect(row.getByLabel(await message(page, 'instanceEndpoint'), { exact: true })).toHaveValue('https://libretranslate.com');
    await row.getByLabel(await message(page, 'instanceName'), { exact: true }).fill('Home server');
    await row.getByLabel(await message(page, 'apiKeyLabel'), { exact: true }).fill('managed-only-fixture');
    await row.getByLabel(await message(page, 'libreHosting'), { exact: true }).selectOption('custom');
    const endpoint = row.getByLabel(await message(page, 'instanceEndpoint'), { exact: true });
    await endpoint.fill('http://127.0.0.1:5100/libre/');
    const key = row.getByLabel(await message(page, 'optionalApiKey'), { exact: true });
    await expect(key).toBeDisabled();
    await expect(key).toHaveValue('');
    await expect(row.getByText(await message(page, 'httpEndpointWarning'), { exact: true })).toBeVisible();
    await saveInstance(page, row);
    await expect(endpoint).toHaveValue('http://127.0.0.1:5100/libre');
    await expect(key).toBeEnabled();
    await key.fill('private-instance-fixture');
    await saveInstance(page, row);
    const testButton = row.getByRole('button', { name: await message(page, 'testKey'), exact: true });
    await expect(testButton).toBeDisabled();
    expect(calls).toEqual([]);
    await setEnabled(row, true);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([{ origins: ['http://127.0.0.1/*'] }]);
    await testButton.click();
    await expect(row.getByRole('status')).toHaveText(await message(page, 'valid'));
    expect(calls.map(({ method, pathname }) => ({ method, pathname }))).toEqual([
        { method: 'GET', pathname: '/libre/languages' },
        { method: 'GET', pathname: '/libre/languages' },
        { method: 'POST', pathname: '/libre/translate' },
    ]);
    expect(calls.find(call => call.method === 'POST')?.body).toMatchObject({ source: 'en', target: 'es', format: 'text', api_key: 'private-instance-fixture' });

    await endpoint.fill('http://127.0.0.1:5101/other');
    await expect(key).toHaveValue('');
    await saveInstance(page, row);
    await page.reload();
    await configure(page, row);
    await expect(row.getByLabel(await message(page, 'optionalApiKey'), { exact: true })).toHaveValue('');
    await expect(row.getByLabel(await message(page, 'instanceEndpoint'), { exact: true })).toHaveValue('http://127.0.0.1:5101/other');
});

test('releases a shared custom-host grant only after the final enabled instance is removed', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    await context.route('http://192.168.1.50:*/libre/languages', route => route.fulfill({
        contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([{ code: 'en', name: 'English', targets: ['es'] }]),
    }));
    const instances = [];
    for (const [index, port] of [5100, 5101].entries()) {
        const instance = await addInstance(page, 'libretranslate');
        await instance.row.getByLabel(await message(page, 'instanceName'), { exact: true }).fill(`LAN server ${index + 1}`);
        await instance.row.getByLabel(await message(page, 'libreHosting'), { exact: true }).selectOption('custom');
        await instance.row.getByLabel(await message(page, 'instanceEndpoint'), { exact: true }).fill(`http://192.168.1.50:${port}/libre`);
        await saveInstance(page, instance.row);
        await setEnabled(instance.row, true);
        instances.push(instance);
    }
    const [first, second] = instances;
    if (!first || !second) throw new Error('Both configured instances must be present.');
    await setEnabled(first.row, false);
    expect(await page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([]);
    await second.row.getByRole('button', {
        name: await message(page, 'deleteNamedInstance', ['LAN server 2']), exact: true,
    }).click();
    await second.row.locator('[data-action="confirm-delete"]').click();
    await expect(second.row).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([{ origins: ['http://192.168.1.50/*'] }]);
    await expect(first.row).toHaveClass(/\bdisabled-item\b/);
});

test('persists successive instance reorders', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    await page.setViewportSize({ width: 1100, height: 1000 });
    const lingvaCatalog = page.locator('#available-providers [data-catalog-provider="lingva"]');
    await lingvaCatalog.locator('[data-action="add-provider"]').click();
    const lingva = instanceRow(page, 'lingva');
    await expect(lingva).toHaveClass(/\benabled\b/);
    await expect(lingva.locator('button[data-action="enable-instance"], button[data-action="disable-instance"]')).toHaveCount(0);
    await expect(lingvaCatalog).toHaveCount(0);
    const deepl = await addInstance(page, 'deepl');
    await nameAndKey(page, deepl.row, 'Reordered account', 'reorder-fixture:fx');
    await setEnabled(deepl.row, true);
    const handle = deepl.row.locator('.drag-handle');
    await handle.hover();
    const origin = await handle.boundingBox();
    const preceding = await page.locator('.service-item.enabled').nth(1).boundingBox();
    if (!origin || !preceding) throw new Error('Both reorder targets must be visible.');
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, preceding.y + 5, { steps: 30 });
    await expect(page.locator('.service-item.enabled').nth(1)).toHaveAttribute('data-id', deepl.id);
    await page.mouse.up();
    await expect.poll(() => enabledIds(page)).toEqual(['google-web', deepl.id, 'lingva']);
    await lingva.getByRole('button', { name: await message(page, 'moveInstanceUp', ['Lingva']), exact: true }).click();
    await expect.poll(() => enabledIds(page)).toEqual(['google-web', 'lingva', deepl.id]);
    await page.reload();
    await expect.poll(() => enabledIds(page)).toEqual(['google-web', 'lingva', deepl.id]);
});

test('keeps an empty active list after closing and restarting the browser', async ({ headless }) => {
    const profile = await mkdtemp(path.join(tmpdir(), 'bar-instance-restart-'));
    let extension: Awaited<ReturnType<typeof launchExtension>> | undefined;
    try {
        extension = await launchExtension(profile, headless);
        const extensionId = await waitForInstalledSettings(extension.context);
        const page = await openSettings(extension.context, extensionId);
        const google = instanceRow(page, 'google-web');
        await google.getByRole('button', { name: await message(page, 'deleteNamedInstance', ['Google Web']), exact: true }).click();
        await google.locator('[data-action="confirm-delete"]').click();
        await expect(page.locator('.service-item.enabled')).toHaveCount(0);
        await page.reload();
        await expect(page.locator('.service-item.enabled')).toHaveCount(0);
        const previous = extension;
        extension = undefined;
        await previous.close();
        const restarted = await launchExtension(profile, headless);
        extension = restarted;
        const worker = restarted.context.serviceWorkers()[0] ?? await restarted.context.waitForEvent('serviceworker');
        await worker.evaluate(() => chrome.runtime.openOptionsPage());
        const url = `chrome-extension://${extensionId}/options.html`;
        await expect.poll(() => restarted.context.pages().map(page => page.url())).toContain(url);
        const reopened = restarted.context.pages().find(page => page.url() === url)!;
        await expect(reopened.locator('.service-item.enabled')).toHaveCount(0);
    } finally {
        try {
            await extension?.close();
        } finally {
            await rm(profile, { recursive: true, force: true });
        }
    }
});

test('retains a saved account when access is denied', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const { row: deepl } = await addInstance(page, 'deepl');
    await nameAndKey(page, deepl, 'Saved account', 'saved-without-grant:fx');
    await page.evaluate(() => window.settingsPermissionMock.denyNextRequest());
    await deepl.getByRole('button', { name: await message(page, 'enableInstance', ['Saved account']), exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(deepl).toHaveClass(/\bdisabled-item\b/);
    await expect(deepl.getByRole('button', { name: await message(page, 'testKey'), exact: true })).toBeDisabled();
    await page.reload();
    await configure(page, deepl);
    await expect(deepl.locator('.service-name')).toHaveText('Saved account');
    await expect(deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('saved-without-grant:fx');
    await expect(deepl).toHaveClass(/\bdisabled-item\b/);
});

test('repairs partial DeepL access while retaining the saved key', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const { row: deepl } = await addInstance(page, 'deepl');
    await nameAndKey(page, deepl, 'Office', 'untested-fixture:fx');
    await setEnabled(deepl, true);
    const testButton = deepl.getByRole('button', { name: await message(page, 'testKey'), exact: true });
    await expect(testButton).toBeEnabled();
    await page.evaluate(() => window.settingsPermissionMock.revoke({ origins: ['https://api.deepl.com/*'] }));
    await expect(testButton).toBeDisabled();
    await expect(deepl.locator('[data-action="grant-access"]')).toBeVisible();
    await expect(deepl).toHaveClass(/\benabled\b/);
    await expect(deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('untested-fixture:fx');
    await deepl.getByRole('button', { name: await message(page, 'grantInstanceAccess', ['Office']), exact: true }).click();
    await expect(testButton).toBeEnabled();
    await expect(deepl.locator('[data-action="grant-access"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toHaveLength(2);
});

test('retries a denied add and keeps the saved account when disabled', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const requests: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const draft = await addInstance(page, 'deepl');
    await draft.row.getByLabel(await message(page, 'instanceName'), { exact: true }).fill('New account');
    await draft.row.getByLabel(await message(page, 'apiKeyLabel'), { exact: true }).fill('new-account:fx');
    await page.evaluate(() => window.settingsPermissionMock.denyNextRequest());
    await draft.row.getByRole('button', { name: await message(page, 'addAndEnable'), exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    const saved = page.locator(`.service-item[data-id="${draft.id}"]`);
    await expect(saved.locator('button[data-action="enable-instance"]')).toBeVisible();
    const catalog = page.locator('#available-providers [data-catalog-provider="deepl"]');
    await expect(catalog.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('new-account:fx');
    await catalog.getByRole('button', { name: await message(page, 'addAndEnable'), exact: true }).click();
    await expect(catalog.locator('.instance-editor')).toHaveCount(0);
    await expect(saved.locator('button[data-action="disable-instance"]')).toBeVisible();
    await expect(page.locator(`#instance-priority [data-id="${draft.id}"]`)).toBeVisible();
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([
        { origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] },
        { origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] },
    ]);
    expect(requests).toEqual([]);
    await expect(catalog.getByRole('button', { name: await message(page, 'addAnother'), exact: true })).toBeVisible();
    await setEnabled(saved, false);
    await expect(page.locator('#instance-priority > li')).toHaveCount(1);
    await expect(page.locator(`#available-providers [data-id="${draft.id}"]`)).toBeVisible();
    await expect(saved.locator('.service-name')).toHaveText('New account');
    await expect(saved).toContainText('DeepL');
    await expect(catalog.getByRole('button', { name: await message(page, 'addAnother'), exact: true })).toBeVisible();
    await page.reload();
    await expect(saved.locator('button[data-action="enable-instance"]')).toBeVisible();
    await expect(page.locator(`#available-providers [data-id="${draft.id}"]`)).toBeVisible();
});

test('tests a draft key without saving it', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    await context.route('https://*.deepl.com/v2/usage', async route => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: {
                'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization',
                'Access-Control-Allow-Methods': 'GET',
            } });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ character_count: 0, character_limit: 500000 }) });
    });
    const draft = await addInstance(page, 'deepl');
    await draft.row.getByLabel(await message(page, 'instanceName'), { exact: true }).fill('Preflight account');
    await draft.row.getByLabel(await message(page, 'apiKeyLabel'), { exact: true }).fill('preflight:fx');
    await draft.row.getByRole('button', { name: await message(page, 'testKey'), exact: true }).click();
    await expect(draft.row.getByRole('status')).toHaveText(await message(page, 'valid'));
    await expect(page.locator(`.service-item[data-id="${draft.id}"]`)).toHaveCount(0);
    await expect(page.locator('#instance-priority .service-item')).toHaveCount(1);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([
        { origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] },
    ]);
});

test('adds and removes a fixed provider without enable or disable controls', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const google = instanceRow(page, 'google-web');
    const template = page.locator('#available-providers [data-catalog-provider="google-web"]');
    await expect(template).toHaveCount(0);
    await expect(google.locator('button[data-action="enable-instance"], button[data-action="disable-instance"]')).toHaveCount(0);
    await expect(google.locator('.service-disclosure')).toHaveCount(0);
    await google.getByRole('button', { name: await message(page, 'deleteNamedInstance', ['Google Web']), exact: true }).click();
    await google.locator('[data-action="confirm-delete"]').click();
    await expect(page.locator('#instance-priority [data-id="google-web"]')).toHaveCount(0);
    await expect(template).toBeVisible();
    await expect(template.getByRole('button', { name: await message(page, 'addProvider'), exact: true })).toBeVisible();
    await expect(page.locator('#available-providers [data-id="google-web"]')).toHaveCount(0);
    await page.reload();
    await expect(template).toBeVisible();
    await expect(page.locator('.service-item[data-id="google-web"]')).toHaveCount(0);
    await page.evaluate(() => window.settingsPermissionMock.denyNextRequest());
    const add = template.getByRole('button', { name: await message(page, 'addProvider'), exact: true });
    await add.click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.locator('.service-item[data-id="google-web"]')).toHaveCount(0);
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.locator('#instance-priority [data-id="google-web"]')).toBeVisible();
    await expect(page.locator('.service-item[data-id="google-web"]')).toHaveClass(/\benabled\b/);
    await expect(page.locator('.service-item[data-id="google-web"] button[data-action="enable-instance"], .service-item[data-id="google-web"] button[data-action="disable-instance"]')).toHaveCount(0);
    await expect(template).toHaveCount(0);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([
        { origins: ['https://translate.googleapis.com/*'] },
        { origins: ['https://translate.googleapis.com/*'] },
    ]);
});

test('keeps simultaneous provider drafts and saved editors independent', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const requests: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const nameLabel = await message(page, 'instanceName');
    const keyLabel = await message(page, 'apiKeyLabel');
    const deep = await addInstance(page, 'deepl');
    await deep.row.getByLabel(nameLabel, { exact: true }).fill('Personal draft');
    await deep.row.getByLabel(keyLabel, { exact: true }).fill('personal-draft:fx');
    const discarded = await addInstance(page, 'libretranslate');
    await discarded.row.getByLabel(nameLabel, { exact: true }).fill('Discard this only');
    await expect(deep.row.getByLabel(keyLabel, { exact: true })).toHaveValue('personal-draft:fx');
    await discarded.row.locator('[data-action="cancel-instance"]').click();
    await expect(discarded.row).toHaveCount(0);
    await expect(deep.row.getByLabel(nameLabel, { exact: true })).toHaveValue('Personal draft');
    const libre = await addInstance(page, 'libretranslate');
    await libre.row.getByLabel(nameLabel, { exact: true }).fill('Office service');
    await saveInstance(page, libre.row);
    await expect(deep.row.getByLabel(keyLabel, { exact: true })).toHaveValue('personal-draft:fx');
    await saveInstance(page, deep.row);
    await expect(libre.row.locator('.instance-editor')).toBeVisible();
    await expect(deep.row.locator('.instance-editor')).toBeVisible();

    await deep.row.getByLabel(keyLabel, { exact: true }).fill('unsaved-personal-edit:fx');
    const deepDisclosure = deep.row.getByRole('button', { name: await message(page, 'showServiceDetails', ['Personal draft']), exact: true });
    await deepDisclosure.click();
    await expect(deepDisclosure).toHaveAttribute('aria-expanded', 'false');
    await libre.row.getByLabel(nameLabel, { exact: true }).fill('Renamed office service');
    await saveInstance(page, libre.row);
    await deepDisclosure.click();
    await expect(deepDisclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(deep.row.getByLabel(keyLabel, { exact: true })).toHaveValue('unsaved-personal-edit:fx');
    await expect(deep.row.getByRole('button', { name: await message(page, 'saveInstance'), exact: true })).toBeEnabled();
    await saveInstance(page, deep.row);
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([]);
    expect(requests).toEqual([]);
    await page.reload();
    await configure(page, deep.row);
    await configure(page, libre.row);
    await expect(deep.row.getByLabel(keyLabel, { exact: true })).toHaveValue('unsaved-personal-edit:fx');
    await expect(libre.row.getByLabel(nameLabel, { exact: true })).toHaveValue('Renamed office service');
});

test('opens and closes account settings with the keyboard', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const deep = await addInstance(page, 'deepl');
    await nameAndKey(page, deep.row, 'Keyboard account', 'keyboard-account:fx');
    await page.reload();
    const disclosure = deep.row.getByRole('button', {
        name: await message(page, 'showServiceDetails', ['Keyboard account']), exact: true,
    });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    const panel = page.locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`);
    await expect(disclosure.locator('button, input, select')).toHaveCount(0);
    await disclosure.focus();
    await disclosure.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(deep.row.locator('.instance-editor')).toBeVisible();
    await expect(deep.row).toHaveClass(/\bdisabled-item\b/);
    await disclosure.focus();
    await disclosure.press('Space');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).not.toBeVisible();
    await expect(deep.row.locator('.instance-editor')).not.toBeVisible();
    await expect(deep.row.locator('[data-action="enable-instance"]')).toBeVisible();
    await expect(deep.row.getByRole('button', { name: await message(page, 'deleteNamedInstance', ['Keyboard account']), exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([]);
});
