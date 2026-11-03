import assert from 'node:assert/strict';
import { By, until } from 'selenium-webdriver';
import test from 'node:test';
import { launchFirefox } from './browser.mjs';
import { CURRENT_TRANSLATION, LITERAL_TRANSLATION, OVERRIDE_TRANSLATION, STALE_TRANSLATION, startAllowlistProxy, startLibreFixture } from './network.mjs';

test('grants provider access and translates through the Firefox address bar', { timeout: 120_000 }, async t => {
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
        const choice = `#available-providers [data-catalog-provider="${provider}"]`;
        assert.equal((await driver.findElements(By.css(`${choice} button`))).length, 1);
        const draft = await browser.addInstance(provider);
        assert.equal((await driver.findElements(By.css(rowSelector(draft.id)))).length, 0,
            'unsaved draft must not be a configured service');
        await (await element(`${draft.catalog} [data-action="cancel-instance"]`)).click();
        await wait(async () => !(await driver.findElements(By.css(`${draft.catalog} .instance-editor`))).length,
            'cancelled provider draft remained visible');
        assert.deepEqual((await permissions()).origins, []);
        assertRequests(0, []);
    }
    const initialEnabled = await driver.findElements(By.css('.service-item.enabled'));
    for (const row of initialEnabled) {
        const id = await row.getAttribute('data-id');
        await browser.remove(id);
        await wait(async () => !(await driver.findElements(By.css(rowSelector(id)))).length, 'initial instance was not removed');
    }
    diagnostics.phase = 'fixed provider native permission';
    const fixedTemplate = '#available-providers [data-catalog-provider="google-web"]';
    const fixedAdd = async () => (await element(`${fixedTemplate} [data-action="add-provider"]`)).click();
    await fixedAdd();
    await browser.nativePermission(false);
    await wait(async () => !(await driver.findElements(By.css(rowSelector('google-web')))).length,
        'denied fixed provider was added');
    assert.equal((await driver.findElements(By.css(fixedTemplate))).length, 1, 'denied fixed provider lost its Add choice');
    await fixedAdd();
    await browser.nativePermission(true);
    await wait(async () => (await driver.findElements(By.css(rowSelector('google-web')))).length === 1,
        'granted fixed provider was not added');
    assert.equal(await browser.enabled('google-web'), true);
    assert.equal((await driver.findElements(By.css(`${rowSelector('google-web')} button[data-action="enable-instance"], ${rowSelector('google-web')} button[data-action="disable-instance"]`))).length, 0,
        'fixed provider offered an activation switch');
    assert.equal((await driver.findElements(By.css(`${rowSelector('google-web')} .service-disclosure`))).length, 0,
        'fixed provider offered a configuration disclosure');
    assert.deepEqual((await permissions()).origins, ['https://translate.googleapis.com/*']);
    await browser.remove('google-web');
    await wait(async () => !(await driver.findElements(By.css(rowSelector('google-web')))).length,
        'fixed provider was not removed');
    await wait(async () => !(await permissions()).origins.length, 'removing the fixed provider did not release its access');
    const { id, catalog } = await browser.addInstance('libretranslate');
    const scope = rowSelector(id);
    const name = 'Firefox loopback';
    await browser.fill(`instance-name-${id}`, name);
    await (await driver.findElement(By.id(`instance-hosting-${id}`))).findElement(By.css('option[value="custom"]')).click();
    await browser.fill(`instance-endpoint-${id}`, `${fixture.origin}/libre`);
    await clickMessage('saveForLater', catalog);
    await wait(until.elementLocated(By.css(scope)), 'saved service did not appear');
    await wait(async () => !(await driver.findElements(By.css(`${catalog} .instance-editor`))).length,
        'save for later did not close inline setup');
    assert.deepEqual((await permissions()).origins, [], 'save for later requested host access');
    assert.equal(await browser.enabled(id), false);
    assert.equal((await driver.findElements(By.css(`#instance-priority [data-id="${id}"]`))).length, 0);
    assert.equal((await driver.findElements(By.css(`#available-providers [data-id="${id}"]`))).length, 1);
    assert.ok((await (await element(scope)).getText()).includes(`${fixture.origin}/libre`), 'disabled configuration lost its endpoint summary');
    assert.equal((await driver.findElements(By.css('#available-providers [data-id="google-web"]'))).length, 0, 'removed singleton remained as a saved row');
    assert.equal((await driver.findElements(By.css('#available-providers [data-catalog-provider="google-web"]'))).length, 1, 'removed singleton did not offer its Add choice');
    assertRequests(0, []);
    await browser.reload();
    assert.equal(await (await element(`${scope} .service-name`)).getText(), name);
    assert.equal(await browser.enabled(id), false);

    diagnostics.phase = 'native permission denial';
    await browser.toggle(id);
    await browser.nativePermission(false);
    await wait(until.elementIsEnabled(await element(`${scope} [data-action="enable-instance"]`)));
    assert.equal(await browser.enabled(id), false);
    assert.deepEqual((await permissions()).origins, []);
    assertRequests(0, []);

    diagnostics.phase = 'native permission grant';
    await browser.toggle(id);
    await browser.nativePermission(true);
    await wait(() => browser.enabled(id), 'granted instance did not become enabled');
    assert.deepEqual((await permissions()).origins, ['http://127.0.0.1/*']);
    assertRequests(1, []);
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
    // Revoke through the browser API; repair uses the native prompt.
    assert.equal(await driver.executeScript('return browser.permissions.remove({origins: ["http://127.0.0.1/*"]});'), true);
    await wait(async () => !(await permissions()).origins.length, 'host revocation did not take effect');
    await browser.reload();
    assert.equal(await browser.enabled(id), true, 'revocation unexpectedly erased saved enabled intent');
    await (await element(`${scope} [data-action="grant-access"]`)).click();
    await browser.nativePermission(true);
    await wait(async () => (await permissions()).origins.includes('http://127.0.0.1/*'), 'repair did not restore host permission');
    await wait(() => fixture.requests.filter(request => request.method === 'GET').length === 3, 'repair did not probe discovery');
    assertRequests(3, ['Hello', 'hello firefox', 'language override', 'stale firefox', 'current firefox']);

    diagnostics.phase = 'disable persistence and host cleanup';
    await browser.toggle(id);
    await wait(async () => !await browser.enabled(id) && !(await permissions()).origins.length,
        'disabling did not release the real host grant');
    await browser.reload();
    assert.equal(await browser.enabled(id), false);
    assert.equal((await driver.findElements(By.css(`#available-providers [data-id="${id}"]`))).length, 1);
    assert.equal((await driver.findElements(By.css(`#instance-priority [data-id="${id}"]`))).length, 0);
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
