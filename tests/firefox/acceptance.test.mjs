import assert from 'node:assert/strict';
import { By, until } from 'selenium-webdriver';
import test from 'node:test';
import { launchFirefox } from './browser.mjs';
import { CURRENT_TRANSLATION, LITERAL_TRANSLATION, OVERRIDE_TRANSLATION, STALE_TRANSLATION, startAllowlistProxy, startLibreFixture } from './network.mjs';

test('Firefox grants and repairs real host access for saved settings and native omnibox previews', { timeout: 120_000 }, async t => {
    const fixture = await startLibreFixture();
    let proxy;
    t.after(async () => {
        const results = await Promise.allSettled([proxy?.close(), fixture.close()]);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    });
    proxy = await startAllowlistProxy(fixture.origin);
    const browser = await launchFirefox(t, proxy);
    const { driver, diagnostics, wait, element, rowSelector, message, clickMessage, permissions } = browser;
    const assertRequests = (getCount, samples) => {
        assert.equal(fixture.requests.filter(request => request.method === 'GET').length, getCount, 'unexpected language-discovery count');
        const actual = fixture.requests.filter(request => request.method === 'POST').map(request => request.sample);
        assert.ok(JSON.stringify(actual) === JSON.stringify(samples), 'unexpected translation request sequence');
        assert.deepEqual(fixture.violations, []);
    };

    diagnostics.phase = 'saved setup';
    assert.deepEqual((await permissions()).origins, []);
    assert.ok(!(await permissions()).permissions.includes('clipboardWrite'));
    assert.equal(await (await element('#enable-copy')).isSelected(), false);
    assert.equal((await driver.findElements(By.css('#instance-priority .service-item'))).length, 1);
    assert.equal((await driver.findElements(By.css('#available-providers .service-item'))).length, 3);
    for (const provider of ['deepl', 'libretranslate']) {
        const choice = `[data-provider="${provider}"]`;
        assert.equal((await driver.findElements(By.css(`${choice} button`))).length, 1);
        await (await element(`${choice} [data-action="add-provider"]`)).click();
        const draft = await element('#available-providers .service-item:has([data-action="cancel-instance"])');
        const draftId = await draft.getAttribute('data-id');
        assert.equal(await browser.enabled(draftId), false);
        await (await element(`${rowSelector(draftId)} [data-action="cancel-instance"]`)).click();
        await wait(async () => !(await driver.findElements(By.css(rowSelector(draftId)))).length,
            'cancelled provider draft remained visible');
        assert.deepEqual((await permissions()).origins, []);
        assertRequests(0, []);
    }
    const initialEnabled = await driver.findElements(By.css('.service-item.enabled'));
    for (const row of initialEnabled) {
        const id = await row.getAttribute('data-id');
        const name = await row.findElement(By.css('.service-name')).getText();
        await clickMessage('disableInstance', rowSelector(id), [name]);
        await wait(async () => !await browser.enabled(id), 'initial instance stayed enabled');
    }
    const previousIds = await driver.executeScript('return [...document.querySelectorAll(".service-item")].map(row => row.dataset.id);');
    await (await element('[data-provider="libretranslate"] [data-action="add-provider"]')).click();
    const id = await wait(async () => {
        const ids = await driver.executeScript('return [...document.querySelectorAll(".service-item")].map(row => row.dataset.id);');
        return ids.find(candidate => !previousIds.includes(candidate));
    }, 'LibreTranslate instance editor did not open');
    const scope = rowSelector(id);
    const name = 'Firefox loopback';
    await browser.fill(`instance-name-${id}`, name);
    await (await driver.findElement(By.id(`instance-hosting-${id}`))).findElement(By.css('option[value="custom"]')).click();
    await browser.fill(`instance-endpoint-${id}`, `${fixture.origin}/libre`);
    await (await element(`${scope} [data-action="save-instance"]`)).click();
    const saved = await message('instanceSaved');
    await wait(async () => {
        const statuses = await driver.findElements(By.css(`${scope} [role="status"]`));
        return statuses.length && await statuses[0].getText() === saved;
    }, 'instance save was not confirmed');
    assert.equal(await browser.enabled(id), false);
    assertRequests(0, []);
    await browser.reload();
    assert.equal(await (await element(`${scope} .service-name`)).getText(), name);
    assert.equal(await browser.enabled(id), false);

    diagnostics.phase = 'native permission denial';
    await (await element(`${scope} [data-action="connect-instance"]`)).click();
    await browser.nativePermission(false);
    await wait(until.elementIsEnabled(await element(`${scope} [data-action="connect-instance"]`)));
    assert.equal(await browser.enabled(id), false);
    assert.deepEqual((await permissions()).origins, []);
    assertRequests(0, []);

    diagnostics.phase = 'native permission grant';
    await (await element(`${scope} [data-action="connect-instance"]`)).click();
    await browser.nativePermission(true);
    await wait(() => browser.enabled(id), 'granted instance did not become enabled');
    assert.deepEqual((await permissions()).origins, ['http://127.0.0.1/*']);
    assertRequests(1, []); // Connect probes discovery without credentials or user text.
    await browser.configure(id, name);
    await clickMessage('testKey', scope);
    const valid = await message('valid');
    await wait(async () => {
        const statuses = await driver.findElements(By.css(`${scope} [role="status"]`));
        return statuses.length && await statuses[0].getText() === valid;
    },
        'explicit LibreTranslate test did not complete');
    assertRequests(2, ['Hello']);

    diagnostics.phase = 'native omnibox literal preview';
    const prompt = await message('omniboxFirefoxPrompt');
    const copyOff = await message('omniboxCopyOff');
    await browser.typeOmnibox('t es hello firefox');
    await wait(async () => (await browser.omniboxRows()).some(row => row.title === LITERAL_TRANSLATION),
        'native Firefox omnibox did not show the literal completed translation');
    const rows = await browser.omniboxRows();
    assert.ok(rows[0].text.includes(prompt), 'Firefox default row lost its stable prompt');
    assert.ok(rows.some(row => row.text.includes(copyOff)), 'Firefox did not show the copy-off settings action');
    await browser.closeOmnibox();
    assertRequests(2, ['Hello', 'hello firefox']);

    diagnostics.phase = 'language override';
    const traditional = await driver.findElement(By.xpath('//select[option[@value="zh-TW"]]/option[@value="zh-TW"]'));
    await traditional.click();
    await browser.observeSaved(async () =>
        await (await driver.findElement(By.xpath('//select[option[@value="zh-TW"]]'))).getAttribute('value') === 'zh-TW');
    await browser.typeOmnibox('t zh language override');
    await wait(async () => (await browser.omniboxRows()).some(row => row.title === OVERRIDE_TRANSLATION),
        'language override translation did not complete');
    await browser.closeOmnibox();
    assertRequests(2, ['Hello', 'hello firefox', 'language override']);

    diagnostics.phase = 'stale preview cancellation';
    await browser.typeOmnibox('t es stale firefox');
    await wait(() => fixture.requests.some(request => request.sample === 'stale firefox'), 'slow translation was not requested');
    await browser.typeOmnibox('t es current firefox');
    await wait(async () => (await browser.omniboxRows()).some(row => row.title === CURRENT_TRANSLATION),
        'replacement translation did not complete');
    await wait(() => fixture.staleCancelled, 'Firefox left the superseded HTTP request running');
    fixture.releaseStale();
    const currentRows = await browser.omniboxRows();
    assert.ok(currentRows.some(row => row.title === CURRENT_TRANSLATION));
    assert.ok(currentRows.every(row => !row.text.includes(STALE_TRANSLATION)));
    assert.ok(currentRows[0].text.includes(prompt));
    await browser.closeOmnibox();
    assertRequests(2, ['Hello', 'hello firefox', 'language override', 'stale firefox', 'current firefox']);

    diagnostics.phase = 'revocation and native repair';
    // Use Firefox's actual permission API to simulate a device-local revocation.
    // Grant/deny always use Firefox's native prompt, never mocked permissions.
    assert.equal(await driver.executeScript('return browser.permissions.remove({origins: ["http://127.0.0.1/*"]});'), true);
    await wait(async () => !(await permissions()).origins.length, 'host revocation did not take effect');
    await browser.reload();
    assert.equal(await browser.enabled(id), true, 'revocation unexpectedly erased saved enabled intent');
    await (await element(`${scope} [data-action="connect-instance"]`)).click();
    await browser.nativePermission(true);
    await wait(async () => (await permissions()).origins.includes('http://127.0.0.1/*'), 'repair did not restore host permission');
    await wait(() => fixture.requests.filter(request => request.method === 'GET').length === 3, 'repair did not probe discovery');
    assertRequests(3, ['Hello', 'hello firefox', 'language override', 'stale firefox', 'current firefox']);

    diagnostics.phase = 'disable persistence and host cleanup';
    await clickMessage('disableInstance', scope, [name]);
    await wait(async () => !await browser.enabled(id) && !(await permissions()).origins.length,
        'disabling did not release the real host grant');
    await browser.reload();
    assert.equal(await browser.enabled(id), false);
    assert.equal(await (await element(`${scope} .service-name`)).getText(), name);
    assert.deepEqual((await permissions()).origins, []);
    assert.equal(await (await element('#enable-copy')).isSelected(), false);
    assert.ok(!(await permissions()).permissions.includes('clipboardWrite'));
    assertRequests(3, ['Hello', 'hello firefox', 'language override', 'stale firefox', 'current firefox']);
    const fixtureAttempts = proxy.attempts.filter(attempt => attempt.origin === fixture.origin && attempt.allowed);
    assert.equal(fixtureAttempts.length, fixture.requests.length, 'a fixture request bypassed the allowlist proxy');
    diagnostics.phase = 'passed';
    diagnostics.failed = false;
});
