import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { Builder, By, Key, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const artifactDirectory = path.resolve('test-results/firefox');
const buildDirectory = path.resolve('.output/firefox-mv3');
const WAIT = 10_000;

export async function launchFirefox(t, proxy) {
    await rm(artifactDirectory, { recursive: true, force: true });
    const temporary = await mkdtemp(path.join(tmpdir(), 'bar-firefox-'));
    const profiles = path.join(temporary, 'profiles');
    let driver, extension, profile;
    const diagnostics = { phase: 'launch', failed: true, cleanup: {} };
    t.after(async () => {
        const failures = [];
        if (t.signal.aborted || diagnostics.failed) {
            await mkdir(artifactDirectory, { recursive: true });
            if (driver) {
                try {
                    const screenshot = await driver.takeScreenshot();
                    await writeFile(path.join(artifactDirectory, 'failure.png'), screenshot, 'base64');
                } catch { diagnostics.screenshotUnavailable = true; }
            }
        }
        if (driver && extension) {
            try {
                await driver.uninstallWebExtension(extension);
                diagnostics.cleanup.uninstalled = true;
            } catch { failures.push(new Error('Could not uninstall the temporary Firefox extension')); }
        }
        if (driver) {
            try {
                await driver.quit();
                diagnostics.cleanup.quit = true;
            } catch { failures.push(new Error('Could not close the disposable Firefox session')); }
        }
        if (profile) diagnostics.cleanup.profileRemoved = await stat(profile).then(() => false, () => true);
        await rm(temporary, { recursive: true, force: true });
        diagnostics.cleanup.temporaryRootRemoved = true;
        if (profile && !diagnostics.cleanup.profileRemoved) failures.push(new Error('Firefox did not remove its disposable profile on quit'));
        if (t.signal.aborted || diagnostics.failed || failures.length) {
            await mkdir(artifactDirectory, { recursive: true });
            // No input, paths, queries, bodies, headers, credentials, or browser logs.
            await writeFile(path.join(artifactDirectory, 'diagnostics.json'), JSON.stringify({
                ...diagnostics, network: proxy.attempts,
            }, null, 2));
        }
        if (failures.length) throw new AggregateError(failures, 'Firefox cleanup failed');
        if (driver && extension) t.diagnostic(`Firefox ${diagnostics.browserVersion}; geckodriver ${diagnostics.driverVersion}; temporary add-on, browser, and profile cleaned`);
    });
    await mkdir(profiles);

    process.env.SE_AVOID_STATS ??= 'true';
    const options = new firefox.Options().addArguments('-headless').windowSize({ width: 1280, height: 1100 });
    if (process.env.FIREFOX_EXECUTABLE_PATH) options.setBinary(process.env.FIREFOX_EXECUTABLE_PATH);
    else if (process.env.SE_FIREFOX_VERSION) options.setBrowserVersion(process.env.SE_FIREFOX_VERSION);
    const proxyPort = Number(new URL(proxy.origin).port);
    for (const [key, value] of Object.entries({
        'network.proxy.type': 1,
        'network.proxy.http': '127.0.0.1',
        'network.proxy.http_port': proxyPort,
        'network.proxy.ssl': '127.0.0.1',
        'network.proxy.ssl_port': proxyPort,
        'network.proxy.no_proxies_on': '',
        'network.proxy.allow_hijacking_localhost': true,
        'network.proxy.failover_direct': false,
        'network.dns.disablePrefetch': true,
        'network.prefetch-next': false,
        'network.http.speculative-parallel-limit': 0,
        'network.http.http3.enable': false,
        'browser.urlbar.suggest.searches': false,
        'browser.search.suggest.enabled': false,
        'intl.locale.requested': 'en-US',
    })) options.setPreference(key, value);
    // Firefox >=138 requires this flag for native permission prompts and urlbar.
    // https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html
    const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH)
        .addArguments('--allow-system-access', '--profile-root', profiles).setStdio('ignore');
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: WAIT, script: WAIT });
    const capabilities = await driver.getCapabilities();
    profile = capabilities.get('moz:profile');
    diagnostics.browserVersion = capabilities.getBrowserVersion();
    diagnostics.driverVersion = capabilities.get('moz:geckodriverVersion');
    if (process.env.SE_FIREFOX_VERSION) assert.equal(diagnostics.browserVersion, process.env.SE_FIREFOX_VERSION);
    if (process.env.SE_GECKODRIVER_VERSION) assert.equal(diagnostics.driverVersion, process.env.SE_GECKODRIVER_VERSION);

    const content = () => driver.setContext(firefox.Context.CONTENT);
    const chrome = () => driver.setContext(firefox.Context.CHROME);
    const wait = (condition, message) => driver.wait(condition, WAIT, message, 50);
    const element = selector => driver.findElement(By.css(selector));
    const message = (key, substitutions = []) => driver.executeScript(
        'return browser.i18n.getMessage(arguments[0], arguments[1]);', key, substitutions);
    const permissions = () => driver.executeScript('return browser.permissions.getAll();');
    const rowSelector = id => `.service-item[data-id="${id}"]`;
    const button = async (key, scope, substitutions) => {
        const label = await message(key, substitutions);
        const root = scope ? await element(scope) : driver;
        return root.findElement(By.xpath(`.//button[normalize-space(.)=${JSON.stringify(label)} or @aria-label=${JSON.stringify(label)}]`));
    };
    const clickMessage = async (key, scope, substitutions) => {
        const control = await button(key, scope, substitutions);
        await wait(until.elementIsEnabled(control), 'settings action stayed disabled');
        await control.click();
    };
    const enabled = async id => (await (await element(rowSelector(id))).getAttribute('class')).split(/\s+/).includes('enabled');
    const ready = async () => {
        await wait(until.elementLocated(By.css('#providers')));
        await wait(async () => (await driver.findElements(By.css('.service-item'))).length > 0, 'settings did not load');
    };
    const configure = async (id, name) => {
        const selector = `${rowSelector(id)} .instance-editor`;
        const editors = await driver.findElements(By.css(selector));
        if (!editors.length || !await editors[0].isDisplayed()) await clickMessage('configureNamedInstance', rowSelector(id), [name]);
        await wait(until.elementIsVisible(await element(selector)));
    };
    const fill = async (id, value) => {
        // Generated instance IDs contain colons; By.id avoids CSS escaping traps.
        const field = await driver.findElement(By.id(id));
        await field.clear();
        await field.sendKeys(value);
    };
    const nativePermission = async allow => {
        await chrome();
        try {
            await wait(() => driver.executeScript('return document.getElementById("notification-popup")?.state === "open";'),
                'native Firefox host permission prompt did not open');
            const control = await element(`#notification-popup .popup-notification-${allow ? 'primary' : 'secondary'}-button`);
            // Firefox 158 uses native moz-button controls that WebElement.click
            // cannot scroll. DOM activation still exercises the genuine prompt.
            await driver.executeScript('arguments[0].click();', control);
        } catch (error) {
            diagnostics.nativePrompt = await driver.executeScript(`return {
                windowType: document.documentElement.getAttribute('windowtype'),
                popupState: document.getElementById('notification-popup')?.state,
                tabCount: gBrowser.tabs.length,
                selectedTabIsExtension: gBrowser.selectedBrowser.currentURI.scheme === 'moz-extension',
                notificationIds: [...document.querySelectorAll('#notification-popup popupnotification')].map(item => item.id)
            };`);
            throw error;
        } finally { await content(); }
    };
    const modifier = capabilities.getPlatform() === 'mac' ? Key.COMMAND : Key.CONTROL;
    const typeOmnibox = async input => {
        await chrome();
        const bar = await element('#urlbar-input');
        await bar.sendKeys(Key.chord(modifier, 'l'));
        await bar.sendKeys(input);
    };
    const omniboxRows = () => driver.executeScript(`return [...gURLBar.view.panel.querySelectorAll('.urlbarView-row')]
        .filter(row => !row.hidden).map(row => ({ text: row.textContent,
            title: row.querySelector('.urlbarView-title')?.textContent ?? '' }));`);
    const closeOmnibox = async () => {
        await (await element('#urlbar-input')).sendKeys(Key.ESCAPE);
        await content();
    };

    diagnostics.phase = 'network isolation';
    // Exercise the real browser's loopback proxy setting before the add-on exists.
    await driver.get(`${proxy.fixtureOrigin}/proxy-proof?sample=synthetic`);
    await wait(() => proxy.attempts.some(attempt => attempt.origin === proxy.fixtureOrigin && !attempt.allowed),
        'Firefox bypassed the launch-time loopback proxy');
    diagnostics.phase = 'install';
    const manifest = JSON.parse(await readFile(path.join(buildDirectory, 'manifest.json'), 'utf8'));
    const extensionId = manifest.browser_specific_settings.gecko.id;
    extension = await driver.installWebExtension(buildDirectory, { permanent: false });
    await chrome();
    const uuid = await driver.executeScript(
        'return JSON.parse(Services.prefs.getStringPref("extensions.webextensions.uuids"))[arguments[0]];', extensionId);
    await content();
    const settingsUrl = `moz-extension://${uuid}/options.html`;
    await driver.get(settingsUrl);
    await ready();
    // onInstalled opens its own options tab. Keep one selected WebDriver tab so
    // the genuine permission doorhanger belongs to the page being clicked.
    const currentHandle = await driver.getWindowHandle();
    for (const handle of await driver.getAllWindowHandles()) {
        if (handle !== currentHandle) {
            await driver.switchTo().window(handle);
            await driver.close();
        }
    }
    await driver.switchTo().window(currentHandle);

    return {
        driver, diagnostics, content, chrome, wait, element, message, permissions, rowSelector, button, clickMessage,
        enabled, ready, configure, fill, nativePermission, typeOmnibox, omniboxRows, closeOmnibox,
        async reload() { await driver.navigate().refresh(); await ready(); },
        async observeSaved(check) {
            const original = await driver.getWindowHandle();
            await driver.switchTo().newWindow('tab');
            try {
                await driver.get(settingsUrl);
                await ready();
                await wait(check, 'saved settings did not reach another options tab');
            } finally {
                await driver.close();
                await driver.switchTo().window(original);
            }
        },
    };
}
