import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    hasProviderAccess, requestProviderAccess, removeProviderAccess,
    hasCopyAccess, requestCopyAccess, removeCopyAccess,
} from '@/utils/permissions';

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

afterEach(() => vi.unstubAllGlobals());

describe('provider access boundaries', () => {
    it('requires both DeepL domains and requests them directly before returning', async () => {
        origins.add('https://api-free.deepl.com/*');
        expect(await hasProviderAccess('deepl')).toBe(false);
        origins.add('https://api.deepl.com/*');
        expect(await hasProviderAccess('deepl')).toBe(true);

        const pending = requestProviderAccess('deepl');
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: [
            'https://api-free.deepl.com/*', 'https://api.deepl.com/*',
        ] });
        expect(await pending).toBe(false);
    });

    it('uses Lingva without checking, requesting or removing a host grant', async () => {
        expect(await hasProviderAccess('lingva')).toBe(true);
        expect(await requestProviderAccess('lingva')).toBe(true);
        await removeProviderAccess('lingva');
        expect(chrome.permissions.contains).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('reports a failed release when either DeepL domain remains granted', async () => {
        origins.add('https://api.deepl.com/*');
        remove.mockResolvedValue(false);
        await expect(removeProviderAccess('deepl')).rejects.toThrow('Could not release provider access');
    });

    it('accepts a release that reports false when access is already absent', async () => {
        remove.mockResolvedValue(false);
        await expect(removeProviderAccess('google-web')).resolves.toBeUndefined();
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
        await expect(removeCopyAccess()).rejects.toThrow('Document unavailable');
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
        await expect(removeCopyAccess()).rejects.toThrow('Could not release clipboard access');
    });
});
