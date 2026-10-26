import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import firefox from 'selenium-webdriver/firefox.js';

export async function cleanupFirefox({ driver, extension, temporary, diagnostics, failed, network, artifactDirectory, removeTemporary = rm }) {
    const failures = [];
    if (failed && driver) {
        try {
            await mkdir(artifactDirectory, { recursive: true });
            const screenshot = await driver.takeScreenshot();
            await writeFile(path.join(artifactDirectory, 'failure.png'), screenshot, 'base64');
        } catch { diagnostics.screenshotUnavailable = true; }
    }
    if (driver && extension) {
        try {
            // Uninstall closes extension tabs; keep a normal page alive until quit.
            await driver.setContext(firefox.Context.CONTENT);
            await driver.get('about:blank');
        } catch { failures.push(new Error('Could not prepare the Firefox session for cleanup')); }
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
    diagnostics.cleanup.temporaryRootRemoved = false;
    try {
        // WebDriver quit does not wait for every geckodriver shutdown write.
        // Node retries transient ENOTEMPTY/EBUSY errors while removing the tree.
        await removeTemporary(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        diagnostics.cleanup.temporaryRootRemoved = true;
    } catch { failures.push(new Error('Could not remove the disposable Firefox files')); }
    if (failed || failures.length) {
        try {
            await mkdir(artifactDirectory, { recursive: true });
            // Retain only test phase, cleanup status, and proxy origins.
            await writeFile(path.join(artifactDirectory, 'diagnostics.json'), JSON.stringify({ ...diagnostics, network }, null, 2));
        } catch { failures.push(new Error('Could not write Firefox failure diagnostics')); }
    }
    if (failures.length) throw new AggregateError(failures, 'Firefox cleanup failed');
}
