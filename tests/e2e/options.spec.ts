import { test, expect } from './fixtures';
import { addInstance, languageInput, message, openSettings, chooseLanguage, observeSettings } from './setup-ui';

test('opens first-install setup in a dedicated extension tab', async ({ context, extensionId }) => {
    const url = `chrome-extension://${extensionId}/options.html`;
    await expect.poll(() => context.pages().map(page => page.url())).toContain(url);
    const setup = context.pages().find(page => page.url() === url)!;
    await expect(setup.locator('#providers')).toBeVisible();
});

test('persists source and target language choices in the local setup', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId);
    await chooseLanguage(page, 'source', 'French');
    await chooseLanguage(page, 'target', 'Spanish');
    await page.reload();
    await expect(await languageInput(page, 'source')).toHaveValue('French');
    await expect(await languageInput(page, 'target')).toHaveValue('Spanish');
});

test('persists regional language overrides', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId);
    const section = page.locator('.section', { hasText: await message(page, 'sectionRegionalDialects') });
    const chinese = section.locator('.form-group', { hasText: `${await message(page, 'lang_zh')} (zh)` }).locator('select');
    await chinese.selectOption('zh-TW');
    await observeSettings(page, async observer => {
        const otherSection = observer.locator('.section', { hasText: await message(observer, 'sectionRegionalDialects') });
        await expect(otherSection.locator('.form-group', { hasText: `${await message(observer, 'lang_zh')} (zh)` }).locator('select')).toHaveValue('zh-TW');
    });
    await page.reload();
    await expect(chinese).toHaveValue('zh-TW');
});

test('keeps copy intent after access revocation and offers repair through the mocked permission boundary', async ({ context, extensionId }) => {
    const page = await openSettings(context, extensionId, true);
    const copy = page.locator('#copy input[type="checkbox"]');
    await expect(copy).not.toBeChecked();
    await copy.click();
    await expect(copy).toBeChecked();
    expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([
        { permissions: ['clipboardWrite', 'offscreen'] },
    ]);

    await page.evaluate(() => window.settingsPermissionMock.revoke({ permissions: ['clipboardWrite'] }));
    await expect(copy).toBeChecked();
    const grant = page.locator('#copy').getByRole('button', { name: await message(page, 'grantAccess'), exact: true });
    await expect(grant).toBeVisible();
    await grant.click();
    await expect(grant).toHaveCount(0);
    await copy.click();
    await expect(copy).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([
        { permissions: ['clipboardWrite', 'offscreen'] },
    ]);
    await page.reload();
    await expect(copy).not.toBeChecked();
});

for (const colorScheme of ['light', 'dark'] as const) {
    test(`keeps configuration and copying keyboard-usable on a narrow ${colorScheme} page`, async ({ context, extensionId }, testInfo) => {
        const page = await openSettings(context, extensionId, true);
        await page.setViewportSize({ width: 360, height: 840 });
        await page.emulateMedia({ colorScheme });
        const { row: deepl } = await addInstance(page, 'deepl');
        await expect(deepl.getByLabel(await message(page, 'instanceName'), { exact: true })).toBeVisible();

        const copy = page.getByRole('checkbox', { name: await message(page, 'enableCopy'), exact: true });
        await copy.focus();
        await copy.press('Space');
        await expect(copy).toBeChecked();
        await expect(copy).toBeFocused();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await copy.press('Space');
        await expect(copy).not.toBeChecked();
        await page.screenshot({ path: testInfo.outputPath(`narrow-${colorScheme}.png`), fullPage: true });
    });
}
