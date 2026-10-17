/**
 * E2E Tests for i18n Support
 *
 * Verifies that internationalization works correctly in the options page.
 *
 * @module tests/e2e/i18n.spec
 */

import { test, expect } from './fixtures';

test.describe('i18n Support', () => {
    test('displays the active extension locale', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const messages = await page.evaluate(() => ({
            extName: chrome.i18n.getMessage('extName'),
            settings: chrome.i18n.getMessage('settings'),
            sectionDefaultLanguages: chrome.i18n.getMessage('sectionDefaultLanguages'),
            sectionRegionalDialects: chrome.i18n.getMessage('sectionRegionalDialects'),
            sectionTranslationServices: chrome.i18n.getMessage('sectionTranslationServices'),
            sectionPrivacy: chrome.i18n.getMessage('sectionPrivacy'),
            labelSource: chrome.i18n.getMessage('labelSource'),
            regionalDialectsDesc: chrome.i18n.getMessage('regionalDialectsDesc'),
            footerUsage: chrome.i18n.getMessage('footerUsage'),
        }));
        await expect(page).toHaveTitle(`${messages.extName} ${messages.settings}`);
        await expect(page.locator('.section-title')).toHaveText([
            messages.sectionDefaultLanguages, messages.sectionRegionalDialects,
            messages.sectionTranslationServices, messages.sectionPrivacy,
        ]);
        await expect(page.locator('label', { hasText: messages.labelSource }).first()).toBeVisible();
        await expect(page.getByText(messages.regionalDialectsDesc, { exact: true })).toBeVisible();
        // Strip markup with the browser so localized emphasis remains meaningful.
        const footer = await page.evaluate(html => {
            const element = document.createElement('div');
            element.innerHTML = html;
            return element.textContent;
        }, messages.footerUsage);
        await expect(page.locator('.footer')).toHaveText(footer!);
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
});
