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
        title: `${chrome.i18n.getMessage('extName')} ${chrome.i18n.getMessage('settings')}`,
        sectionDefaultLanguages: chrome.i18n.getMessage('sectionDefaultLanguages'),
        sectionRegionalDialects: chrome.i18n.getMessage('sectionRegionalDialects'),
        sectionTranslationServices: chrome.i18n.getMessage('sectionTranslationServices'),
        sectionCopy: chrome.i18n.getMessage('sectionCopy'),
        sectionPrivacy: chrome.i18n.getMessage('sectionPrivacy'),
        lang_zh: chrome.i18n.getMessage('lang_zh'),
        primary: chrome.i18n.getMessage('primary'),
        labelStorage: chrome.i18n.getMessage('labelStorage'),
        storageDesc: chrome.i18n.getMessage('storageDesc'),
        apiKey: chrome.i18n.getMessage('apiKeyLabel'),
        testKey: chrome.i18n.getMessage('testKey'),
    }));
}

test.describe('Options Page', () => {
    test('loads and displays settings', async ({ context, extensionId }) => {
        const page = await context.newPage();

        await page.setViewportSize({ width: 1000, height: 800 });
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const text = await messages(page);

        // Check title
        await expect(page).toHaveTitle(text.title);

        // Header should be gone (refactoring requirement)
        await expect(page.locator('h1', { hasText: 'Bar Translate Settings' })).not.toBeVisible();

        // Check for sections
        await expect(page.locator('.section-title', { hasText: text.sectionDefaultLanguages })).toBeVisible();
        await expect(page.locator('.section-title', { hasText: text.sectionRegionalDialects })).toBeVisible();
        await expect(page.locator('.section-title', { hasText: text.sectionTranslationServices })).toBeVisible();
        await expect(page.locator('.section-title', { hasText: text.sectionCopy })).toBeVisible();
        await expect(page.locator('.section-title', { hasText: text.sectionPrivacy })).toBeVisible();
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
        const text = await messages(page);

        const serviceList = page.locator('.service-list').first();
        await expect(serviceList).toBeVisible();

        // Check primary badge on first item
        await expect(serviceList.locator('li').first()).toContainText(text.primary);
        await expect(serviceList.locator('li').first()).toContainText('Google Translate (Web)');

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

    test('shows security warning tooltip', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        const text = await messages(page);

        const label = page.locator('.setting-label', { hasText: text.labelStorage });
        await expect(label).toBeVisible();
        const tooltip = label.locator('span');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveAttribute('title', text.storageDesc);
    });
});
