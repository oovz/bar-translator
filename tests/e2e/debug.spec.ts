import { test, expect } from './fixtures';

test('debug page content', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForTimeout(2000); // Wait in case of loading
    const content = await page.content();
    console.log('--- PAGE CONTENT ---');
    console.log(content);
    console.log('--- END CONTENT ---');

    // Also log visible text
    const text = await page.innerText('body');
    console.log('--- VISIBLE TEXT ---');
    console.log(text);
    console.log('--- END TEXT ---');
});
