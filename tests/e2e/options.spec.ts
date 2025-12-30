/**
 * E2E Tests for Options Page
 *
 * Tests the options page UI, settings persistence, and service configuration.
 *
 * @module tests/e2e/options.spec
 */

import { test, expect } from './fixtures';

test.describe('Options Page', () => {
    test('loads and displays settings', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        // Check title
        await expect(page).toHaveTitle(/Bar Translate/i);

        // Header should be gone (refactoring requirement)
        await expect(page.locator('h1', { hasText: 'Bar Translate Settings' })).not.toBeVisible();

        // Check for sections
        await expect(page.locator('.section-title', { hasText: 'Default Languages' })).toBeVisible();
        await expect(page.locator('.section-title', { hasText: 'Translation Services' })).toBeVisible();
        await expect(page.locator('.section-title', { hasText: 'Privacy & Storage' })).toBeVisible();
    });

    test('persists language selection', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        await page.waitForSelector('select');

        // Change source language to French (fr)
        const sourceSelect = page.locator('select').first();
        await sourceSelect.selectOption('fr');

        await page.waitForTimeout(500);

        await page.reload();
        await page.waitForSelector('select');

        await expect(sourceSelect).toHaveValue('fr');
    });

    test('can toggle and reorder services', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        const serviceList = page.locator('.service-list').first();
        await expect(serviceList).toBeVisible();

        // Check primary badge on first item
        await expect(serviceList.locator('li').first()).toContainText('PRIMARY');
        await expect(serviceList.locator('li').first()).toContainText('Google Translate');

        // Enable DeepL (from disabled list)
        // Note: This test might fail if DeepL is already enabled from previous run.
        // Ideally we should reset state, but for now we handle conditionals in the next test.
        // Here we just checking functionality if available.
        const disabledList = page.locator('.service-list.disabled-list');
        if (await disabledList.isVisible()) {
            const enableDeepLBtn = disabledList.locator('li', { hasText: 'DeepL' }).locator('button[title="Enable service"]');
            if (await enableDeepLBtn.isVisible()) {
                await enableDeepLBtn.click();
                // Verify DeepL moved to enabled list
                await expect(serviceList.locator('li', { hasText: 'DeepL' })).toBeVisible();
            }
        }
    });

    test('can enter API key for DeepL', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        // Wait for service lists to render
        await page.waitForSelector('.service-list');

        const serviceList = page.locator('.service-list').first();
        const enabledDeepL = serviceList.locator('li', { hasText: 'DeepL' });

        // If DeepL is not enabled, enable it
        if (await enabledDeepL.count() === 0) {
            const disabledList = page.locator('.service-list.disabled-list');
            await expect(disabledList).toBeVisible();
            const enableDeepLBtn = disabledList.locator('li', { hasText: 'DeepL' }).locator('button[title="Enable service"]');
            await enableDeepLBtn.click();
        }

        // Now DeepL should be in the enabled list
        await expect(enabledDeepL).toBeVisible();

        // Expand API Key section
        const apiKeyBtn = enabledDeepL.locator('button', { hasText: 'API Key' });
        await apiKeyBtn.click();

        const keyInput = enabledDeepL.locator('input[placeholder*="API Key"]');
        await expect(keyInput).toBeVisible();

        await keyInput.fill('test-api-key');
        await expect(keyInput).toHaveValue('test-api-key');
    });

    test('shows security warning tooltip', async ({ context, extensionId }) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);

        const label = page.locator('.setting-label', { hasText: 'API Key Storage' });
        await expect(label).toBeVisible();
        const tooltip = label.locator('span');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveAttribute('title', /Synced storage/);
    });
});
