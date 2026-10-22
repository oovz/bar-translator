/**
 * E2E Tests for Options Page
 *
 * Tests the options page UI, settings persistence, and service configuration.
 *
 * @module tests/e2e/options.spec
 */

import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { UserPreferences } from '@/src/types';
import { mockOptionalPermissionsForSettings } from './permissions';

// Extension messages follow the browser's UI locale, which can differ from page locale.
async function messages(page: Page) {
    return page.evaluate(() => ({
        sectionDefaultLanguages: chrome.i18n.getMessage('sectionDefaultLanguages'),
        sectionRegionalDialects: chrome.i18n.getMessage('sectionRegionalDialects'),
        lang_zh: chrome.i18n.getMessage('lang_zh'),
        apiKey: chrome.i18n.getMessage('apiKeyLabel'),
        testKey: chrome.i18n.getMessage('testKey'),
    }));
}

test.describe('Options Page', () => {
    test('opens first-install setup in a dedicated extension tab', async ({ context, extensionId }) => {
        const url = `chrome-extension://${extensionId}/options.html`;
        await expect.poll(() => context.pages().map(page => page.url())).toContain(url);
        const setup = context.pages().find(page => page.url() === url)!;
        await expect(setup.locator('#providers')).toBeVisible();
    });

    test('persists language selection', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const text = await messages(page);

        // Locate Source Language Combobox within Default Languages section
        const defaultLangsSection = page.locator('.section', { hasText: text.sectionDefaultLanguages });
        // Source is the first form-group input
        const sourceInput = defaultLangsSection.locator('input').first();

        // Select 'French'
        await sourceInput.click();
        await sourceInput.fill('French');

        // Wait for and click the option
        const frenchOption = page.locator('.combobox-option').filter({ has: page.getByText('French', { exact: true }) });
        await frenchOption.click();

        await expect.poll(() => page.evaluate(async () => {
            const { preferences } = await chrome.storage.sync.get<{ preferences: UserPreferences }>('preferences');
            return preferences?.defaultSourceLang;
        })).toBe('fr');

        await page.reload();

        const reloadedSourceInput = page.locator('.section', { hasText: text.sectionDefaultLanguages }).locator('input').first();
        await expect(reloadedSourceInput).toHaveValue('French');
    });

    test('persists regional dialect overrides', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const text = await messages(page);

        const regionalSection = page.locator('.section', { hasText: text.sectionRegionalDialects });
        // Find Chinese (zh) select
        const zhSelect = regionalSection.locator('.form-group', { hasText: `${text.lang_zh} (zh)` }).locator('select');

        await zhSelect.scrollIntoViewIfNeeded();
        // Select 'zh-TW'
        await zhSelect.selectOption('zh-TW');

        await expect.poll(() => page.evaluate(async () => {
            const { preferences } = await chrome.storage.sync.get<{ preferences: UserPreferences }>('preferences');
            return preferences?.languageOverrides?.zh;
        })).toBe('zh-TW');

        await page.reload();

        const reloadedZhSelect = page.locator('.section', { hasText: text.sectionRegionalDialects }).locator('.form-group', { hasText: `${text.lang_zh} (zh)` }).locator('select');
        await expect(reloadedZhSelect).toHaveValue('zh-TW');
    });

    test('can enable a translation provider through a mocked permission boundary', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await mockOptionalPermissionsForSettings(page);
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        const serviceList = page.locator('.service-list').first();
        await expect(serviceList).toBeVisible();

        await page.locator('[data-id="deepl"] [title="Enable service"]').click();
        await expect(serviceList.locator('[data-id="deepl"]')).toBeVisible();
        expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([{ origins: [
            'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
        ] }]);
    });

    test('can enter a DeepL key while disabled before enabling with mocked access', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await mockOptionalPermissionsForSettings(page);
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const text = await messages(page);

        // Wait for service lists to render
        await page.waitForSelector('.service-list');

        const deepl = page.locator('[data-id="deepl"]');
        const apiKeyBtn = deepl.getByRole('button', { name: text.apiKey, exact: true });
        await apiKeyBtn.click();

        const keyInput = deepl.locator('input');
        await expect(keyInput).toBeVisible();

        await keyInput.fill('test-api-key');
        await expect(keyInput).toHaveValue('test-api-key');
        await expect(deepl.getByRole('button', { name: text.testKey, exact: true })).toBeDisabled();
        expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([]);
        await deepl.locator('[title="Enable service"]').click();
        await expect(deepl).toHaveClass(/enabled/);
        await expect(keyInput).toHaveValue('test-api-key');
        await expect(deepl.getByRole('button', { name: text.testKey, exact: true })).toBeEnabled();
    });

    test('grants and removes copy access through a mocked permission boundary', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await mockOptionalPermissionsForSettings(page);
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const copy = page.locator('#copy input[type="checkbox"]');
        await expect(copy).not.toBeChecked();
        await copy.check();
        await expect(copy).toBeChecked();
        expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([
            { permissions: ['clipboardWrite', 'offscreen'] },
        ]);
        await copy.uncheck();
        await expect(copy).not.toBeChecked();
        expect(await page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([
            { permissions: ['clipboardWrite', 'offscreen'] },
        ]);
    });

});

for (const colorScheme of ['light', 'dark'] as const) {
    test(`keeps provider setup and the copy switch usable on a narrow ${colorScheme} page`, async ({ context, extensionId }, testInfo) => {
        const page = await context.newPage();
        await page.setViewportSize({ width: 360, height: 840 });
        await page.emulateMedia({ colorScheme });
        await mockOptionalPermissionsForSettings(page);
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const labels = await page.evaluate(() => ({
            apiKey: chrome.i18n.getMessage('apiKeyLabel'),
            copy: chrome.i18n.getMessage('enableCopy'),
        }));
        const setup = page.locator('[data-id="deepl"]');
        const disclosure = setup.getByRole('button', { name: labels.apiKey, exact: true });
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await expect(setup.locator('input')).toBeVisible();

        const copy = page.getByRole('checkbox', { name: labels.copy, exact: true });
        await copy.focus();
        await copy.press('Space');
        await expect(copy).toBeChecked();
        await expect(copy).toBeFocused();
        expect(await page.evaluate(() => window.settingsPermissionMock.requests)).toEqual([
            { permissions: ['clipboardWrite', 'offscreen'] },
        ]);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await copy.press('Space');
        await expect(copy).not.toBeChecked();
        expect(await page.evaluate(() => window.settingsPermissionMock.removals)).toEqual([
            { permissions: ['clipboardWrite', 'offscreen'] },
        ]);
        await page.screenshot({ path: testInfo.outputPath(`narrow-${colorScheme}.png`), fullPage: true });
    });
}
