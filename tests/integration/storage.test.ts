/**
 * Unit Tests for Storage Wrapper
 *
 * @module tests/integration/storage.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getPreferences,
    getApiKeys,
    setApiKey,
    getCredentialStorageType,
    switchCredentialStorage,
} from '@/utils/storage';
import { DEFAULT_PREFERENCES } from '@/src/types';

// Mock chrome.storage
const mockStorageSync = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
};

const mockStorageLocal = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
};

const mockStorageSession = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
};

vi.stubGlobal('chrome', {
    storage: {
        sync: mockStorageSync,
        local: mockStorageLocal,
        session: mockStorageSession,
        onChanged: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
        },
    },
});

describe('Preferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStorageSync.get.mockResolvedValue({});
        mockStorageSync.set.mockResolvedValue(undefined);
        mockStorageLocal.get.mockResolvedValue({});
    });

    describe('getPreferences', () => {
        it('returns default preferences when none stored', async () => {
            mockStorageSync.get.mockResolvedValue({});

            const prefs = await getPreferences();

            expect(prefs).toEqual(DEFAULT_PREFERENCES);
            expect(prefs).not.toHaveProperty('distinctId');
            expect(prefs).not.toHaveProperty('telemetryEnabled');
            expect(mockStorageSync.set).not.toHaveBeenCalled();
            expect(prefs).not.toHaveProperty('storageType');
        });

        it('returns stored preferences', async () => {
            const stored = {
                preferences: {
                    ...DEFAULT_PREFERENCES,
                    defaultTargetLang: 'fr',
                },
            };
            mockStorageSync.get.mockResolvedValue(stored);

            const prefs = await getPreferences();

            expect(prefs.defaultTargetLang).toBe('fr');
            expect(prefs).not.toHaveProperty('storageType');
        });

        it('removes stored analytics fields while preserving translation settings and credentials', async () => {
            const preferences = {
                ...DEFAULT_PREFERENCES,
                defaultTargetLang: 'fr',
                fallbackOrder: [],
                languageOverrides: { zh: 'zh-TW' },
                telemetryEnabled: true,
                distinctId: 'obsolete-identity',
            };
            const apiKeys = { deepl: { key: 'preserved-key', validated: true } };
            const synced = { preferences, apiKeys, unrelated: 'keep' };
            mockStorageSync.get.mockImplementation(async key => ({ [key]: synced[key as keyof typeof synced] }));
            mockStorageSync.set.mockImplementation(async items => Object.assign(synced, items));

            const prefs = await getPreferences();

            expect(prefs).toEqual({
                ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr', fallbackOrder: [],
                languageOverrides: { zh: 'zh-TW' },
            });
            expect(synced.preferences).toEqual(prefs);
            expect(synced.apiKeys).toEqual(apiKeys);
            expect(synced.unrelated).toBe('keep');
            expect(mockStorageLocal.remove).not.toHaveBeenCalled();
            expect(mockStorageSync.remove).not.toHaveBeenCalled();
            mockStorageSync.set.mockClear();
            expect(await getPreferences()).toEqual(prefs);
            expect(mockStorageSync.set).not.toHaveBeenCalled();
        });

        it('reports a cleanup write failure and leaves the stored configuration recoverable', async () => {
            const preferences = {
                ...DEFAULT_PREFERENCES, fallbackOrder: ['deepl'],
                distinctId: 'obsolete-identity',
            };
            mockStorageSync.get.mockResolvedValue({ preferences });
            mockStorageSync.set.mockRejectedValueOnce(new Error('Storage unavailable'));

            await expect(getPreferences()).rejects.toThrow('Storage unavailable');
            expect(preferences).toEqual({
                ...DEFAULT_PREFERENCES, fallbackOrder: ['deepl'],
                distinctId: 'obsolete-identity',
            });
            expect(mockStorageSync.remove).not.toHaveBeenCalled();
            expect(mockStorageLocal.remove).not.toHaveBeenCalled();
        });

        it('keeps the ordered supported selection and removes unsupported or duplicate recipients', async () => {
            mockStorageSync.get.mockResolvedValue({ preferences: {
                ...DEFAULT_PREFERENCES,
                fallbackOrder: ['microsoft', 'lingva', 'google-cloud', 'deepl', 'lingva', 'google-web'],
            } });
            expect((await getPreferences()).fallbackOrder).toEqual(['lingva', 'deepl', 'google-web']);
        });

        it.each([[], ['microsoft'], null])('preserves a disabled selection when stored as %j', async fallbackOrder => {
            mockStorageSync.get.mockResolvedValue({ preferences: {
                ...DEFAULT_PREFERENCES, fallbackOrder,
            } });
            expect((await getPreferences()).fallbackOrder).toEqual([]);
        });
    });
});

describe('API Keys', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default preferences (local storage)
        mockStorageSync.get.mockImplementation((key) => {
            if (key === 'preferences') {
                return Promise.resolve({ preferences: DEFAULT_PREFERENCES });
            }
            return Promise.resolve({});
        });
        mockStorageLocal.get.mockResolvedValue({});
        mockStorageLocal.set.mockResolvedValue(undefined);
        mockStorageSync.set.mockResolvedValue(undefined);
        mockStorageLocal.get.mockResolvedValue({});
    });

    describe('getApiKeys', () => {
        it('uses local storage by default', async () => {
            mockStorageLocal.get.mockResolvedValue({
                apiKeys_local: {
                    deepl: { key: 'local-key', validated: true }
                }
            });

            const keys = await getApiKeys();

            expect(keys.deepl?.key).toBe('local-key');
            expect(mockStorageLocal.get).toHaveBeenCalledWith(['credentialStorageType', 'apiKeys_local']);
            expect(await getCredentialStorageType()).toBe('local');
        });

        it('uses sync storage when configured', async () => {
            // Mock preferences to return sync
            mockStorageSync.get.mockImplementation((key) => {
                if (key === 'preferences') {
                    return Promise.resolve({
                        preferences: { ...DEFAULT_PREFERENCES }
                    });
                }
                if (key === 'apiKeys') {
                    return Promise.resolve({
                        apiKeys: {
                            deepl: { key: 'sync-key', validated: true }
                        }
                    });
                }
                return Promise.resolve({});
            });

            mockStorageLocal.get.mockResolvedValue({ credentialStorageType: 'sync' });
            const keys = await getApiKeys();

            expect(keys.deepl?.key).toBe('sync-key');
            expect(mockStorageSync.get).toHaveBeenCalledWith('apiKeys');
        });
    });

    describe('setApiKey', () => {
        it('preserves stored credentials for hidden providers when updating DeepL', async () => {
            const hidden = { key: 'stored-hidden-key', validated: true };
            mockStorageLocal.get.mockResolvedValue({ apiKeys_local: { microsoft: hidden } });
            await setApiKey('deepl', { key: 'new-key:fx', validated: false, tier: 'free' });
            expect(mockStorageLocal.set).toHaveBeenCalledWith({ apiKeys_local: {
                microsoft: hidden,
                deepl: { key: 'new-key:fx', validated: false, tier: 'free' },
            } });
        });

        it('saves to local storage by default', async () => {
            mockStorageLocal.get.mockResolvedValue({ apiKeys_local: {} });

            await setApiKey('deepl', {
                key: 'new-key',
                validated: true,
                tier: 'free',
            });

            expect(mockStorageLocal.set).toHaveBeenCalledWith({
                apiKeys_local: {
                    deepl: {
                        key: 'new-key',
                        validated: true,
                        tier: 'free',
                    },
                },
            });
        });
    });

});


describe('device credential storage', () => {
    let local: Record<string, unknown>;
    let sync: Record<string, unknown>;
    const credential = { key: 'device-key:fx', validated: true, tier: 'free' as const };

    beforeEach(() => {
        vi.resetAllMocks();
        local = { apiKeys_local: { deepl: credential }, unrelated: 'keep' };
        sync = { preferences: { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr' } };
        mockStorageLocal.get.mockImplementation(async key => structuredClone(
            Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, local[name]]))
        ));
        mockStorageSync.get.mockImplementation(async key => structuredClone({ [key]: sync[key] }));
        mockStorageLocal.set.mockImplementation(async items => { Object.assign(local, structuredClone(items)); });
        mockStorageSync.set.mockImplementation(async items => { Object.assign(sync, structuredClone(items)); });
        mockStorageLocal.remove.mockImplementation(async key => { delete local[key]; });
        mockStorageSync.remove.mockImplementation(async key => { delete sync[key]; });
    });

    it('uses a device-local selection and defaults a fresh device to local keys', async () => {
        expect(await getCredentialStorageType()).toBe('local');
        local.credentialStorageType = 'sync';
        expect(await getCredentialStorageType()).toBe('sync');
    });

    it('commits usable synced keys before removing the local copy and preserves other settings', async () => {
        sync.apiKeys = { microsoft: { key: 'other-key', validated: true } };
        await switchCredentialStorage('sync');
        expect(await getCredentialStorageType()).toBe('sync');
        expect(await getApiKeys()).toEqual({ deepl: credential, microsoft: { key: 'other-key', validated: true } });
        expect(local).toEqual({ credentialStorageType: 'sync', unrelated: 'keep' });
        expect(sync.preferences).toEqual({ ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr' });
    });

    it.each(['destination', 'selection'])('preserves the active local keys after a %s write failure and recovers on retry', async failure => {
        if (failure === 'destination') {
            mockStorageSync.set.mockRejectedValueOnce(new Error('Write failed'));
        } else {
            mockStorageLocal.set.mockRejectedValueOnce(new Error('Write failed'));
        }
        await expect(switchCredentialStorage('sync')).rejects.toThrow('Write failed');
        expect(await getCredentialStorageType()).toBe('local');
        expect(await getApiKeys()).toEqual({ deepl: credential });
        expect(mockStorageLocal.remove).not.toHaveBeenCalled();
        await switchCredentialStorage('sync');
        expect(await getCredentialStorageType()).toBe('sync');
        expect(await getApiKeys()).toEqual({ deepl: credential });
    });

    it('keeps synced keys usable when local cleanup fails and retries cleanup without replacing them', async () => {
        mockStorageLocal.remove.mockRejectedValueOnce(new Error('Cleanup failed'));
        await expect(switchCredentialStorage('sync')).rejects.toThrow('Cleanup failed');
        expect(await getCredentialStorageType()).toBe('sync');
        expect(await getApiKeys()).toEqual({ deepl: credential });
        const replacement = { key: 'new-synced-key:fx', validated: false };
        await setApiKey('deepl', replacement);
        await switchCredentialStorage('sync');
        expect(await getApiKeys()).toEqual({ deepl: replacement });
        expect(local.apiKeys_local).toBeUndefined();
    });

    it('keeps device choices independent and shared keys usable when another device chooses local', async () => {
        await switchCredentialStorage('sync');
        const firstDevice = local;
        local = { unrelated: 'second-device' };
        expect(await getCredentialStorageType()).toBe('local');
        await switchCredentialStorage('sync');
        expect(await getApiKeys()).toEqual({ deepl: credential });
        await switchCredentialStorage('local');
        await setApiKey('deepl', { key: 'second-device-key:fx', validated: true });
        expect(await getCredentialStorageType()).toBe('local');
        expect(await getApiKeys()).toEqual({ deepl: { key: 'second-device-key:fx', validated: true } });
        local = firstDevice;
        expect(await getCredentialStorageType()).toBe('sync');
        expect(await getApiKeys()).toEqual({ deepl: credential });
        expect(mockStorageSync.remove).not.toHaveBeenCalled();
    });

    it.each(['destination', 'selection'])('preserves synced access after a failed switch to local at %s', async failure => {
        local = { credentialStorageType: 'sync' };
        sync.apiKeys = { deepl: credential };
        if (failure === 'selection') {
            mockStorageLocal.set.mockImplementationOnce(async items => { Object.assign(local, items); });
        }
        mockStorageLocal.set.mockRejectedValueOnce(new Error('Write failed'));
        await expect(switchCredentialStorage('local')).rejects.toThrow('Write failed');
        expect(await getCredentialStorageType()).toBe('sync');
        expect(await getApiKeys()).toEqual({ deepl: credential });
        await switchCredentialStorage('local');
        expect(await getCredentialStorageType()).toBe('local');
        expect(await getApiKeys()).toEqual({ deepl: credential });
        expect(sync.apiKeys).toEqual({ deepl: credential });
    });


    it('keeps a key edit that overlaps a storage switch', async () => {
        let finishWrite!: () => void;
        let startedWrite!: () => void;
        const started = new Promise<void>(resolve => { startedWrite = resolve; });
        const pending = new Promise<void>(resolve => { finishWrite = resolve; });
        mockStorageLocal.set.mockImplementationOnce(async items => {
            startedWrite();
            await pending;
            Object.assign(local, structuredClone(items));
        });
        const updated = { key: 'edited-key:fx', validated: false };
        const saving = setApiKey('deepl', updated);
        await started;
        const switching = switchCredentialStorage('sync');
        await Promise.race([switching, new Promise(resolve => setTimeout(resolve, 0))]);
        finishWrite();
        await Promise.all([saving, switching]);
        expect(await getApiKeys()).toEqual({ deepl: updated });
        expect(local.apiKeys_local).toBeUndefined();
    });

});
