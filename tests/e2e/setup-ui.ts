import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { mockOptionalPermissionsForSettings } from './permissions';

export async function message(page: Page, key: string, substitutions?: string[]) {
    return page.evaluate(({ key, substitutions }) => chrome.i18n.getMessage(key, substitutions), { key, substitutions });
}

export async function openSettings(context: BrowserContext, extensionId: string, mockedPermissions = false) {
    const page = await context.newPage();
    if (mockedPermissions) await mockOptionalPermissionsForSettings(page);
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#providers')).toBeVisible();
    return page;
}

export function instanceRow(page: Page, id: string) {
    return page.locator(`.service-item[data-id="${id}"], #available-providers [data-catalog-provider]:has(.instance-editor[id="instance-${id}"])`);
}

export async function configure(page: Page, row: Locator) {
    if (await row.locator('.instance-editor').isVisible()) return;
    const name = (await row.locator('.service-name').textContent())!;
    const disclosure = row.getByRole('button', { name: await message(page, 'showServiceDetails', [name]), exact: true });
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
    await expect(row.locator('.instance-editor')).toBeVisible();
}

export async function saveInstance(page: Page, row: Locator) {
    const adding = await row.locator('[data-action="add-and-enable"]').count() > 0;
    const save = row.getByRole('button', { name: await message(page, adding ? 'saveForLater' : 'saveInstance'), exact: true });
    await save.click();
    if (adding) {
        await expect(row.locator('[data-action="add-and-enable"]')).toHaveCount(0);
        await expect(row).toHaveClass(/\bdisabled-item\b/);
        // Reopen explicitly: creation closes the inline catalog form, editing does not.
        await configure(page, row);
    } else {
        await expect(save).toBeDisabled();
        await expect(row.getByRole('status')).toBeVisible();
    }
}

export async function setEnabled(row: Locator, enabled: boolean) {
    await row.locator(enabled ? '[data-action="enable-instance"]' : '[data-action="disable-instance"]').click();
    await expect(row.locator(enabled ? '[data-action="disable-instance"]' : '[data-action="enable-instance"]')).toBeVisible();
    await expect(row).toHaveClass(enabled ? /\benabled\b/ : /\bdisabled-item\b/);
}

export async function addInstance(page: Page, provider: 'deepl' | 'libretranslate') {
    const catalog = page.locator(`#available-providers [data-catalog-provider="${provider}"]`);
    await catalog.locator('[data-action="add-provider"]').click();
    const editor = catalog.locator('.instance-editor');
    await expect(editor).toBeVisible();
    const editorId = await editor.getAttribute('id');
    expect(editorId).toMatch(/^instance-.+/);
    const id = editorId!.slice('instance-'.length);
    // This locator follows the draft from the catalog to its stable configured row.
    return { id, row: instanceRow(page, id) };
}

export async function nameAndKey(page: Page, row: Locator, name: string, key: string) {
    await configure(page, row);
    await row.getByLabel(await message(page, 'instanceName'), { exact: true }).fill(name);
    await row.getByLabel(await message(page, 'apiKeyLabel'), { exact: true }).fill(key);
    await saveInstance(page, row);
}

export async function enabledIds(page: Page) {
    return page.locator('.service-item.enabled').evaluateAll(items => items.map(item => item.getAttribute('data-id')));
}

export async function languageInput(page: Page, which: 'source' | 'target') {
    return page.locator('.section', { hasText: await message(page, 'sectionDefaultLanguages') })
        .locator('.form-group input').nth(which === 'source' ? 0 : 1);
}

/** Observe persistence through another settings page before reloading the editor. */
export async function observeSettings(page: Page, check: (observer: Page) => Promise<void>) {
    const observer = await page.context().newPage();
    try {
        await observer.goto(page.url());
        await expect(observer.locator('#providers')).toBeVisible();
        await check(observer);
    } finally {
        await observer.close();
    }
}

export async function chooseLanguage(page: Page, which: 'source' | 'target', name: string) {
    const input = await languageInput(page, which);
    await input.click();
    await expect(input.locator('..').locator('.combobox-dropdown')).toBeVisible();
    await input.fill(name);
    await page.locator('.combobox-option').filter({ has: page.getByText(name, { exact: true }) }).click();
    await expect(input).toHaveValue(name);
    await observeSettings(page, async observer => {
        await expect(await languageInput(observer, which)).toHaveValue(name);
    });
}
