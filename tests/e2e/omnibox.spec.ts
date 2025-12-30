/**
 * E2E Tests for Omnibox Flow (Basic Loading)
 *
 * Verifies that the extension loads successfully in Chrome.
 * complete omnibox UI testing requires manual verification or specialized tools
 * as Playwright cannot interact with Chrome browser UI elements like the address bar.
 *
 * @module tests/e2e/omnibox.spec
 */

import { test, expect } from './fixtures';

test('extension loads and background worker is active', async ({ context, extensionId }) => {
    // Verify extension ID is present
    expect(extensionId).toBeTruthy();
    console.log(`Extension ID: ${extensionId}`);

    // Get the service worker
    let worker = context.serviceWorkers().find(sw => sw.url().includes(extensionId));

    if (!worker) {
        // Wait for it if not immediately found
        worker = await context.waitForEvent('serviceworker');
    }

    expect(worker).toBeTruthy();

    // Verify it is running
    // We can't access internals easily without page.evaluate, but context.serviceWorkers() implies it exists.
    expect(worker?.url()).toContain(extensionId);
});
