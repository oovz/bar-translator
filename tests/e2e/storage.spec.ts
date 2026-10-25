import { test, expect } from './fixtures';
import { addInstance, chooseLanguage, configure, instanceRow, languageInput, message, nameAndKey, openSettings, saveInstance } from './setup-ui';

test('switches complete setups with explicit use and replace choices instead of merging them', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const selector = page.getByRole('combobox', { name: await message(page, 'labelStorage'), exact: true });
    await expect(selector).toHaveValue('local');
    const deepl = instanceRow(page, 'deepl');
    await nameAndKey(page, deepl, 'Local account', 'local-account-fixture:fx');
    await chooseLanguage(page, 'target', 'French');
    const privateService = await addInstance(page, 'libretranslate');
    await privateService.row.getByLabel(await message(page, 'instanceName'), { exact: true }).fill('Private service');
    await saveInstance(page, privateService.row);
    const copy = page.locator('#copy input[type="checkbox"]');
    await copy.click();
    await expect(copy).toBeChecked();

    await selector.selectOption('sync');
    await expect(selector).toHaveValue('sync');
    await expect(page.getByRole('region', { name: await message(page, 'setupConflictTitle'), exact: true })).toHaveCount(0);
    await nameAndKey(page, deepl, 'Shared account', 'shared-account-fixture');
    await chooseLanguage(page, 'target', 'Spanish');
    await copy.click();
    await expect(copy).not.toBeChecked();
    await privateService.row.getByRole('button', { name: await message(page, 'deleteNamedInstance', ['Private service']), exact: true }).click();
    await expect(privateService.row).toHaveCount(0);

    await selector.selectOption('local');
    const conflict = page.getByRole('region', { name: await message(page, 'setupConflictTitle'), exact: true });
    await expect(conflict).toBeVisible();
    await expect(selector).toHaveValue('sync');
    await expect(await languageInput(page, 'target')).toHaveValue('Spanish');
    await expect(deepl.locator('.service-name')).toHaveText('Shared account');
    await expect(conflict).not.toContainText('local-account-fixture');
    await expect(conflict).not.toContainText('shared-account-fixture');
    await conflict.getByRole('button', { name: await message(page, 'useSavedSetup'), exact: true }).click();
    await expect(selector).toHaveValue('local');
    await expect(conflict).toHaveCount(0);
    await expect(deepl.locator('.service-name')).toHaveText('Local account');
    await expect(privateService.row.locator('.service-name')).toHaveText('Private service');
    await expect(await languageInput(page, 'target')).toHaveValue('French');
    await expect(copy).toBeChecked();

    await selector.selectOption('sync');
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: await message(page, 'replaceSavedSetup'), exact: true }).click();
    await expect(selector).toHaveValue('sync');
    await expect(conflict).toHaveCount(0);
    await page.reload();
    await expect(selector).toHaveValue('sync');
    await expect(deepl.locator('.service-name')).toHaveText('Local account');
    await expect(privateService.row.locator('.service-name')).toHaveText('Private service');
    await expect(await languageInput(page, 'target')).toHaveValue('French');
    await expect(copy).toBeChecked();
    await expect(page.locator('#copy').getByRole('button', { name: await message(page, 'grantAccess'), exact: true })).toBeVisible();
    await configure(page, deepl);
    await expect(deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('local-account-fixture:fx');
});

for (const stage of ['destination', 'selection'] as const) {
    test(`keeps the local setup usable after a ${stage} write failure and retries safely`, async ({ context, extensionId }) => {
        const page = await openSettings(context, extensionId);
        const deepl = instanceRow(page, 'deepl');
        await nameAndKey(page, deepl, 'Recoverable account', 'recoverable-fixture:fx');
        await chooseLanguage(page, 'target', 'French');
        await page.evaluate(failure => {
            const area = failure === 'destination' ? chrome.storage.sync : chrome.storage.local;
            const original = area.set;
            Reflect.set(area, 'set', async () => {
                Reflect.set(area, 'set', original);
                throw new Error('Storage unavailable');
            });
        }, stage);
        const selector = page.getByRole('combobox', { name: await message(page, 'labelStorage'), exact: true });
        await selector.selectOption('sync');
        await expect(page.getByRole('alert').first()).toBeVisible();
        await expect(selector).toHaveValue('local');
        await expect(deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('recoverable-fixture:fx');
        await expect(await languageInput(page, 'target')).toHaveValue('French');
        await page.getByRole('button', { name: await message(page, 'retry'), exact: true }).click();
        await expect(selector).toHaveValue('sync');
        await expect(page.getByRole('alert')).toHaveCount(0);
        await page.reload();
        await expect(selector).toHaveValue('sync');
        await expect(deepl.locator('.service-name')).toHaveText('Recoverable account');
        await expect(await languageInput(page, 'target')).toHaveValue('French');
        await configure(page, deepl);
        await expect(deepl.getByLabel(await message(page, 'apiKeyLabel'), { exact: true })).toHaveValue('recoverable-fixture:fx');
    });
}
