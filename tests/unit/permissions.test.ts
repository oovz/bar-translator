import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getInstanceOrigins, hasInstanceAccess, requestInstanceAccess, releaseUnusedInstanceAccess,
    hasCopyAccess, requestCopyAccess, removeCopyAccess,
} from '@/utils/permissions';
import { createDefaultSetup } from '@/utils/instances';
import type { TranslationInstance } from '@/src/types';

const google = { id: 'google-web', providerId: 'google-web' } as const;
const lingva = { id: 'lingva', providerId: 'lingva' } as const;
const deepl = { id: 'deepl', providerId: 'deepl', name: 'DeepL' } as const;
function removeAccess(instance: TranslationInstance) {
    const previous = createDefaultSetup();
    previous.instances = [instance];
    previous.preferences.fallbackOrder = [instance.id];
    const next = { ...previous, preferences: { ...previous.preferences, fallbackOrder: [] } };
    return releaseUnusedInstanceAccess(previous, next);
}

let origins: Set<string>;
let permissions: Set<string>;
let closeDocument: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

beforeEach(() => {
    origins = new Set();
    permissions = new Set();
    closeDocument = vi.fn(async () => {});
    remove = vi.fn(async (query: chrome.permissions.Permissions) => {
        query.origins?.forEach(origin => origins.delete(origin));
        query.permissions?.forEach(permission => permissions.delete(permission));
        return true;
    });
    vi.stubGlobal('chrome', {
        permissions: {
            contains: vi.fn(async (query: chrome.permissions.Permissions) =>
                (query.origins ?? []).every(origin => origins.has(origin)) &&
                (query.permissions ?? []).every(permission => permissions.has(permission))),
            request: vi.fn(async () => false),
            remove,
        },
        offscreen: { closeDocument },
        runtime: {
            ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
            getContexts: vi.fn(async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }]),
        },
    });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('provider access boundaries', () => {
    it('requires the exact GTX host grant even when the former Google host is already granted', async () => {
        origins.add('https://translate.google.com/*');
        expect(await hasInstanceAccess(google)).toBe(false);

        const pending = requestInstanceAccess(google);
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({
            origins: ['https://translate.googleapis.com/*'],
        });
        expect(await pending).toBe(false);
        origins.add('https://translate.googleapis.com/*');
        expect(await hasInstanceAccess(google)).toBe(true);
    });

    it('requires both DeepL domains and requests them directly before returning', async () => {
        origins.add('https://api-free.deepl.com/*');
        expect(await hasInstanceAccess(deepl)).toBe(false);
        origins.add('https://api.deepl.com/*');
        expect(await hasInstanceAccess(deepl)).toBe(true);

        const pending = requestInstanceAccess(deepl);
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: [
            'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
        ] });
        expect(await pending).toBe(false);
    });

    it('uses Lingva without checking, requesting or removing a host grant', async () => {
        expect(await hasInstanceAccess(lingva)).toBe(true);
        expect(await requestInstanceAccess(lingva)).toBe(true);
        await removeAccess(lingva);
        expect(chrome.permissions.contains).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('reports a failed release when either DeepL domain remains granted', async () => {
        origins.add('https://api.deepl.com/*');
        remove.mockResolvedValue(false);
        await expect(removeAccess(deepl)).rejects.toThrow();
    });

    it('accepts a release that reports false when access is already absent', async () => {
        remove.mockResolvedValue(false);
        await expect(removeAccess(google)).resolves.toBeUndefined();
    });
});

describe('clipboard resource cleanup', () => {
    it('requires and requests clipboardWrite and offscreen together', async () => {
        permissions.add('clipboardWrite');
        expect(await hasCopyAccess()).toBe(false);
        permissions.add('offscreen');
        expect(await hasCopyAccess()).toBe(true);
        expect(await requestCopyAccess()).toBe(false);
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({
            permissions: ['clipboardWrite', 'offscreen'],
        });
    });

    it('closes the offscreen document before releasing the permissions it needs', async () => {
        permissions = new Set(['clipboardWrite', 'offscreen']);
        remove.mockImplementation(async () => {
            expect(closeDocument).toHaveBeenCalledExactlyOnceWith();
            permissions.clear();
            return true;
        });
        await removeCopyAccess();
        expect(remove).toHaveBeenCalledExactlyOnceWith({ permissions: ['clipboardWrite', 'offscreen'] });
        expect(await hasCopyAccess()).toBe(false);
    });

    it('preserves access and propagates a document cleanup failure', async () => {
        permissions = new Set(['clipboardWrite', 'offscreen']);
        closeDocument.mockRejectedValue(new Error('Document unavailable'));
        await expect(removeCopyAccess()).rejects.toThrow();
        expect(remove).not.toHaveBeenCalled();
        expect(await hasCopyAccess()).toBe(true);
    });

    it('releases a partial grant without using an unavailable offscreen API', async () => {
        permissions.add('clipboardWrite');
        await removeCopyAccess();
        expect(closeDocument).not.toHaveBeenCalled();
        expect(permissions.size).toBe(0);
    });

    it('reports a refused clipboard release if any permission remains', async () => {
        permissions.add('clipboardWrite');
        remove.mockResolvedValue(false);
        await expect(removeCopyAccess()).rejects.toThrow();
    });
});

describe('Firefox clipboard permission', () => {
    it('requests and releases only clipboardWrite without Chromium offscreen APIs', async () => {
        vi.stubEnv('FIREFOX', 'true');
        vi.resetModules();
        const firefox = await import('@/utils/permissions');
        permissions.add('clipboardWrite');
        expect(await firefox.hasCopyAccess()).toBe(true);
        await firefox.requestCopyAccess();
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ permissions: ['clipboardWrite'] });
        await firefox.removeCopyAccess();
        expect(chrome.runtime.getContexts).not.toHaveBeenCalled();
        expect(closeDocument).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledExactlyOnceWith({ permissions: ['clipboardWrite'] });
        expect(await firefox.hasCopyAccess()).toBe(false);
    });
});


describe('configured instance grants', () => {
    const home: TranslationInstance = { id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://localhost:5000/libre' };
    it('requests a selected local host without granting unrelated hosts or claiming port/path isolation', async () => {
        expect(getInstanceOrigins(home)).toEqual(['http://localhost/*']);
        const pending = requestInstanceAccess(home);
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: ['http://localhost/*'] });
        expect(await pending).toBe(false);
        origins.add('http://localhost/*');
        expect(await hasInstanceAccess(home)).toBe(true);
    });

    it('retains a shared host until the last enabled instance is disabled', async () => {
        origins.add('http://localhost/*');
        const other: TranslationInstance = { ...home, id: 'other', name: 'Other', endpoint: 'http://localhost:9000/another' };
        const previous = createDefaultSetup();
        previous.instances = [home, other];
        previous.preferences.fallbackOrder = ['home', 'other'];
        const next = { ...previous, preferences: { ...previous.preferences, fallbackOrder: ['other'] } };
        await releaseUnusedInstanceAccess(previous, next);
        expect(remove).not.toHaveBeenCalled();
        expect(await hasInstanceAccess(other)).toBe(true);
        await releaseUnusedInstanceAccess(next, { ...next, preferences: { ...next.preferences, fallbackOrder: [] } });
        expect(remove).toHaveBeenCalledExactlyOnceWith({ origins: ['http://localhost/*'] });
    });

    it('preserves DeepL access while another account still owns the complete grant', async () => {
        origins = new Set(['https://api-free.deepl.com/*', 'https://api.deepl.com/*']);
        const previous = createDefaultSetup();
        previous.instances = [deepl, { ...deepl, id: 'work', name: 'Work' }];
        previous.preferences.fallbackOrder = ['deepl', 'work'];
        const next = { ...previous, preferences: { ...previous.preferences, fallbackOrder: ['work'] } };
        await releaseUnusedInstanceAccess(previous, next);
        expect(remove).not.toHaveBeenCalled();
        expect(await hasInstanceAccess(deepl)).toBe(true);
    });

    it('releases an old endpoint on a setup switch while retaining an overlapping grant', async () => {
        origins = new Set(['http://localhost/*', 'https://libretranslate.com/*']);
        const managed: TranslationInstance = { ...home, id: 'managed', name: 'Managed', hosting: 'managed', endpoint: 'https://libretranslate.com' };
        const previous = createDefaultSetup();
        previous.instances = [home, managed];
        previous.preferences.fallbackOrder = ['home', 'managed'];
        const next = { ...previous, preferences: { ...previous.preferences, fallbackOrder: ['managed'] } };
        await releaseUnusedInstanceAccess(previous, next);
        expect(remove).toHaveBeenCalledExactlyOnceWith({ origins: ['http://localhost/*'] });
        expect(await hasInstanceAccess(managed)).toBe(true);
    });
});
