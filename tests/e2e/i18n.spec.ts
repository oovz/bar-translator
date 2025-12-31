/**
 * E2E Tests for i18n Support
 *
 * Verifies that internationalization works correctly in the options page.
 *
 * @module tests/e2e/i18n.spec
 */

import { test, expect } from './fixtures';

test.describe('i18n Support', () => {
    test('displays default English strings', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        // Check page title translation
        // Key: extName -> "Bar Translator", settings -> "Settings"
        // App.tsx sets: t('extName') + ' ' + t('settings')
        await expect(page).toHaveTitle(/Bar Translator Settings/i);

        // Check section titles
        // Key: sectionDefaultLanguages -> "Default Languages"
        await expect(page.locator('.section-title', { hasText: 'Default Languages' })).toBeVisible();
        // Key: sectionRegionalDialects -> "Regional Dialects"
        await expect(page.locator('.section-title', { hasText: 'Regional Dialects' })).toBeVisible();

        // Check labels
        // Key: labelSource -> "Source"
        await expect(page.locator('label', { hasText: 'Source' }).first()).toBeVisible();

        // Check descriptions
        // Key: regionalDialectsDesc -> "Choose which specific variant..."
        await expect(page.locator('text=Choose which specific variant to use')).toBeVisible();

        // Check footer usage instructions
        // Key: footerUsage -> "Type ... to translate"
        await expect(page.locator('.footer')).toContainText('Type');
        await expect(page.locator('.footer')).toContainText('to translate');
    });

    test('replaces hardcoded strings with localized versions', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        // Verify that we don't see any raw __MSG_ keys that might indicate broken i18n in manifest
        // (Though manifest is checked by browser, we can check title)
        const title = await page.title();
        expect(title).not.toContain('__MSG_');

        // Verify we don't see raw keys in the UI content (assuming our t() function returns key if missing)
        // If t('missing') returns 'missing', we can't easily distinguish from purposeful text unless we know the keys.
        // But we can check that common keys are NOT displayed as keys.
        const content = await page.content();
        expect(content).not.toContain('sectionDefaultLanguages');
        expect(content).not.toContain('labelSource');
    });

    // Note: Testing other languages (like French) is difficult because it requires
    // launching Chrome with a specific locale, which persistentContext doesn't easily support
    // without potentially conflicting with the machine's installed locales or requiring specific args.
    // For now, we trust that if English works via browser.i18n.getMessage, other languages will work too
    // provided the locale files exist (which we verified in build).
});
