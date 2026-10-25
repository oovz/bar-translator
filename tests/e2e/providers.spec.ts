import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, launchExtension } from './fixtures';
import { addInstance, configure, enabledIds, instanceRow, message, nameAndKey, openSettings, saveInstance, setEnabled } from './setup-ui';

test('starts without optional access and keeps single-instance provider names fixed', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId);
    const providerColor = await instanceRow(page, 'google-web').locator('.service-name').evaluate(element => getComputedStyle(element).color);
    await expect(instanceRow(page, 'lingva').locator('.service-name')).toHaveCSS('color', providerColor);
    expect(await page.evaluate(() => chrome.permissions.getAll())).toEqual({ permissions: ['storage'], origins: [] });
    await expect(instanceRow(page, 'google-web').getByRole('button', { name: await message(page, 'grantAccess'), exact: true })).toBeVisible();
    await expect(page.locator('#copy input[type="checkbox"]')).not.toBeChecked();
    for (const id of ['google-web', 'lingva']) {
        const row = instanceRow(page, id);
        await expect(row.getByText(await message(page, 'configureInstance'), { exact: true })).toHaveCount(0);
        await expect(row.locator('input')).toHaveCount(0);
    }
    await configure(page, instanceRow(page, 'deepl'));
    await expect(instanceRow(page, 'deepl').getByLabel(await message(page, 'instanceName'), { exact: true })).toBeVisible();
});

test('keeps two DeepL configurations distinct and tests only explicitly enabled instances through the mocked permission boundary', async ({ context, extensionId }) => {
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
    const first = instanceRow(page, 'deepl');
    await nameAndKey(page, first, 'Personal account', 'personal-fixture:fx');
    const second = await addInstance(page, 'deepl');
    await nameAndKey(page, second.row, 'Work account', 'work-rejected-fixture');
    const priorityList = page.getByRole('list', { name: await message(page, 'sectionTranslationServices'), exact: true });
    await expect(priorityList.locator('[data-id="deepl"]')).toBeVisible();
    await expect(priorityList.locator(`[data-id="${second.id}"]`)).toBeVisible();
    await expect(priorityList.locator('[data-id="lingva"]')).toBeVisible();
    const testLabel = await message(page, 'testKey');
    await expect(second.row.getByRole('button', { name: testLabel, exact: true })).toBeDisabled();
    expect(checks).toEqual([]);

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
    await expect(second.row.getByLabel(await message(page, 'providerReady'), { exact: true })).toBeVisible();
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

test('configures a custom LibreTranslate base path, tests it explicitly and clears credentials when its endpoint changes', async ({ context, extensionId }) => {
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
    await row.getByLabel(await message(page, 'libreHosting'), { exact: true }).selectOption('custom');
    const endpoint = row.getByLabel(await message(page, 'instanceEndpoint'), { exact: true });
    await endpoint.fill('http://127.0.0.1:5100/libre/');
    const key = row.getByLabel(await message(page, 'optionalApiKey'), { exact: true });
    await expect(key).toBeEnabled();
    await expect(row.getByText(await message(page, 'httpEndpointWarning'), { exact: true })).toBeVisible();
    await key.fill('private-instance-fixture');
    await saveInstance(page, row);
    await expect(endpoint).toHaveValue('http://127.0.0.1:5100/libre');
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
    await expect(second.row).toHaveCount(0);
    expect(await page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([{ origins: ['http://192.168.1.50/*'] }]);
    await expect(first.row).toHaveClass(/\bdisabled-item\b/);
});

test('persists successive instance reorders', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    await page.setViewportSize({ width: 1100, height: 1000 });
    await setEnabled(instanceRow(page, 'lingva'), true);
    await setEnabled(instanceRow(page, 'deepl'), true);
    const handle = instanceRow(page, 'deepl').locator('.drag-handle');
    await handle.hover();
    const origin = await handle.boundingBox();
    const preceding = await page.locator('.service-item.enabled').nth(1).boundingBox();
    if (!origin || !preceding) throw new Error('Both reorder targets must be visible.');
    await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, preceding.y + 5, { steps: 30 });
    await expect(page.locator('.service-item.enabled').nth(1)).toHaveAttribute('data-id', 'deepl');
    await page.mouse.up();
    await expect.poll(() => enabledIds(page)).toEqual(['google-web', 'deepl', 'lingva']);
    const lingva = instanceRow(page, 'lingva');
    await lingva.getByRole('button', { name: await message(page, 'moveInstanceUp', ['Lingva']), exact: true }).click();
    await expect.poll(() => enabledIds(page)).toEqual(['google-web', 'lingva', 'deepl']);
    await page.reload();
    await expect.poll(() => enabledIds(page)).toEqual(['google-web', 'lingva', 'deepl']);
});

test('keeps disable-all after closing and restarting the browser', async ({ headless }) => {
    const profile = await mkdtemp(path.join(tmpdir(), 'bar-instance-restart-'));
    let extension = await launchExtension(profile, headless);
    try {
        const background = extension.context.serviceWorkers()[0] ?? await extension.context.waitForEvent('serviceworker');
        const extensionId = new URL(background.url()).hostname;
        const page = await openSettings(extension.context, extensionId);
        await setEnabled(instanceRow(page, 'google-web'), false);
        await page.reload();
        await expect(page.locator('.service-item.enabled')).toHaveCount(0);
        await extension.close();
        extension = await launchExtension(profile, headless);
        const worker = extension.context.serviceWorkers()[0] ?? await extension.context.waitForEvent('serviceworker');
        await worker.evaluate(() => chrome.runtime.openOptionsPage());
        const url = `chrome-extension://${extensionId}/options.html`;
        await expect.poll(() => extension.context.pages().map(page => page.url())).toContain(url);
        const reopened = extension.context.pages().find(page => page.url() === url)!;
        await expect(reopened.locator('.service-item.enabled')).toHaveCount(0);
    } finally {
        await extension.close();
        await rm(profile, { recursive: true, force: true });
    }
});

test('keeps a denied instance disabled and preserves its saved name and key through reload', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const deepl = instanceRow(page, 'deepl');
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

test('shows partial DeepL access revocation without disabling the instance or discarding its untested key', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const deepl = instanceRow(page, 'deepl');
    await nameAndKey(page, deepl, 'Office', 'untested-fixture:fx');
    await setEnabled(deepl, true);
    const testButton = deepl.getByRole('button', { name: await message(page, 'testKey'), exact: true });
    await expect(testButton).toBeEnabled();
    await page.evaluate(() => window.settingsPermissionMock.revoke({ origins: ['https://api.deepl.com/*'] }));
    await expect(testButton).toBeDisabled();
    await expect(deepl.getByLabel(await message(page, 'providerReady'), { exact: true })).toHaveCount(0);
    await expect(deepl).toHaveClass(/\benabled\b/);
    await expect(deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('untested-fixture:fx');
    await deepl.getByRole('button', { name: await message(page, 'grantAccess'), exact: true }).click();
    await expect(testButton).toBeEnabled();
    await expect(deepl.getByLabel(await message(page, 'providerReady'), { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toHaveLength(2);
});
