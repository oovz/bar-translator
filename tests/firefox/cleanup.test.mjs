import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupFirefox } from './cleanup.mjs';

async function fixture(t) {
    const root = await mkdtemp(path.join(tmpdir(), 'bar-firefox-cleanup-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const temporary = path.join(root, 'session');
    const profile = path.join(temporary, 'profiles', 'disposable');
    await mkdir(profile, { recursive: true });
    await writeFile(path.join(profile, 'prefs.js'), '// synthetic test profile');
    let extensionPageOpen = true;
    let sessionEnded = false;
    let context = 'chrome';
    return {
        temporary, artifactDirectory: path.join(root, 'artifacts'),
        extension: 'synthetic-addon',
        driver: {
            async setContext(next) { context = next; },
            async get(url) {
                if (context !== 'content') throw new Error('navigation requires content context');
                if (url === 'about:blank') extensionPageOpen = false;
            },
            async uninstallWebExtension() { if (extensionPageOpen) sessionEnded = true; },
            async quit() { if (sessionEnded) throw new Error('last extension tab ended the session'); },
        },
        diagnostics: { phase: 'passed', failed: false, cleanup: {} },
        network: [], failed: false,
    };
}

test('keeps the session open through uninstall and removes the remaining disposable profile', async t => {
    const resources = await fixture(t);
    await cleanupFirefox(resources);
    await assert.rejects(stat(resources.temporary), { code: 'ENOENT' });
    assert.equal(resources.diagnostics.cleanup.quit, true);
    assert.equal(resources.diagnostics.cleanup.temporaryRootRemoved, true);
});

test('writes diagnostics and reports permanent removal failures even without a screenshot', async t => {
    const resources = await fixture(t);
    resources.failed = true;
    resources.diagnostics.failed = true;
    resources.diagnostics.phase = 'native permission grant';
    await resources.driver.setContext('content');
    await resources.driver.get('about:blank');
    resources.driver.get = async () => { throw new Error('navigation unavailable'); };
    resources.driver.takeScreenshot = async () => { throw new Error('session unavailable'); };
    const failure = await cleanupFirefox({
        ...resources,
        removeTemporary: async () => { throw Object.assign(new Error('synthetic private profile path'), { code: 'ENOTEMPTY' }); },
    }).catch(error => error);
    const diagnostics = JSON.parse(await readFile(path.join(resources.artifactDirectory, 'diagnostics.json'), 'utf8'));
    assert.equal(diagnostics.phase, 'native permission grant');
    assert.equal(diagnostics.screenshotUnavailable, true);
    assert.equal(diagnostics.cleanup.uninstalled, true);
    assert.equal(diagnostics.cleanup.quit, true);
    assert.equal(diagnostics.cleanup.temporaryRootRemoved, false);
    assert.ok(failure instanceof AggregateError);
    assert.equal(failure.errors.length, 2);
    assert.doesNotMatch(JSON.stringify(diagnostics) + failure.errors.map(error => error.message).join(), /synthetic private profile path/);
});
