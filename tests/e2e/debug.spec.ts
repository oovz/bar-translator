import { test } from './fixtures';

test('debug page content', async ({ context, extensionId }, testInfo) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForTimeout(2000); // Wait in case of loading

    const content = await page.content();
    await testInfo.attach('page-content.html', {
        body: content,
        contentType: 'text/html'
    });

    // Also log visible text
    const text = await page.innerText('body');
    await testInfo.attach('visible-text.txt', {
        body: text,
        contentType: 'text/plain'
    });
});
