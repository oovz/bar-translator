import type { Page } from '@playwright/test';

declare global {
    interface Window {
        settingsPermissionMock: {
            requests: chrome.permissions.Permissions[];
            removals: chrome.permissions.Permissions[];
            restore(): void;
        };
    }
}

/**
 * Mock only this settings page's optional-permission boundary. Native permission
 * dialogs are outside Playwright's page API; these tests cover the settings flow
 * and exact requests, not Chrome's native grant UI or actual network privileges.
 * Install before navigation. Reload starts with no mocked optional grants.
 */
export async function mockOptionalPermissionsForSettings(page: Page): Promise<void> {
    await page.addInitScript(() => {
        if (!globalThis.chrome?.permissions) return;
        const api = chrome.permissions;
        const original = {
            contains: api.contains, request: api.request, remove: api.remove,
            onAdded: api.onAdded, onRemoved: api.onRemoved,
        };
        const origins = new Set<string>();
        const permissions = new Set<string>();
        type Listener = (value: chrome.permissions.Permissions) => void;
        const added = new Set<Listener>();
        const removed = new Set<Listener>();
        const event = (listeners: Set<Listener>) => ({
            addListener: (listener: Listener) => listeners.add(listener),
            removeListener: (listener: Listener) => listeners.delete(listener),
            hasListener: (listener: Listener) => listeners.has(listener),
            hasListeners: () => listeners.size > 0,
        });
        window.settingsPermissionMock = {
            requests: [], removals: [],
            restore: () => Object.assign(api, original),
        };
        Object.assign(api, {
            contains: async (value: chrome.permissions.Permissions) =>
                (value.origins ?? []).every(origin => origins.has(origin)) &&
                (value.permissions ?? []).every(permission => permissions.has(permission)),
            request: async (value: chrome.permissions.Permissions) => {
                window.settingsPermissionMock.requests.push(structuredClone(value));
                value.origins?.forEach(origin => origins.add(origin));
                value.permissions?.forEach(permission => permissions.add(permission));
                added.forEach(listener => listener(value));
                return true;
            },
            remove: async (value: chrome.permissions.Permissions) => {
                window.settingsPermissionMock.removals.push(structuredClone(value));
                value.origins?.forEach(origin => origins.delete(origin));
                value.permissions?.forEach(permission => permissions.delete(permission));
                removed.forEach(listener => listener(value));
                return true;
            },
            onAdded: event(added), onRemoved: event(removed),
        });
    });
}
