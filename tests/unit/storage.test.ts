/**
 * Unit Tests for Storage Wrapper
 *
 * @module tests/unit/storage.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getPreferences,
    getApiKeys,
    setApiKey,
    migrateApiKeys,
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
    });

    describe('getPreferences', () => {
        it('returns default preferences when none stored', async () => {
            mockStorageSync.get.mockResolvedValue({});

            const prefs = await getPreferences();

            expect(prefs).toMatchObject({
                ...DEFAULT_PREFERENCES,
                distinctId: expect.any(String),
            });
            expect(prefs.storageType).toBe('local'); // Default should be local now
        });

        it('returns stored preferences', async () => {
            const stored = {
                preferences: {
                    ...DEFAULT_PREFERENCES,
                    defaultTargetLang: 'fr',
                    storageType: 'sync' as const,
                },
            };
            mockStorageSync.get.mockResolvedValue(stored);

            const prefs = await getPreferences();

            expect(prefs.defaultTargetLang).toBe('fr');
            expect(prefs.storageType).toBe('sync');
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
            expect(mockStorageLocal.get).toHaveBeenCalledWith('apiKeys_local');
            expect(mockStorageSync.get).toHaveBeenCalledWith('preferences');
        });

        it('uses sync storage when configured', async () => {
            // Mock preferences to return sync
            mockStorageSync.get.mockImplementation((key) => {
                if (key === 'preferences') {
                    return Promise.resolve({
                        preferences: { ...DEFAULT_PREFERENCES, storageType: 'sync' }
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

            const keys = await getApiKeys();

            expect(keys.deepl?.key).toBe('sync-key');
            expect(mockStorageSync.get).toHaveBeenCalledWith('apiKeys');
        });
    });

    describe('setApiKey', () => {
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

    describe('migrateApiKeys', () => {
        it('migrates keys from local to sync', async () => {
            // Setup source (local)
            mockStorageLocal.get.mockResolvedValue({
                apiKeys_local: {
                    deepl: { key: 'migrating-key', validated: true }
                }
            });

            await migrateApiKeys('local', 'sync');

            // Should set in sync
            expect(mockStorageSync.set).toHaveBeenCalledWith({
                apiKeys: {
                    deepl: { key: 'migrating-key', validated: true }
                }
            });

            // Should remove from local
            expect(mockStorageLocal.remove).toHaveBeenCalledWith('apiKeys_local');
        });

        it('migrates keys from sync to local', async () => {
            // Setup source (sync)
            mockStorageSync.get.mockImplementation((key) => {
                if (key === 'apiKeys') {
                    return Promise.resolve({
                        apiKeys: {
                            deepl: { key: 'sync-key', validated: true }
                        }
                    });
                }
                return Promise.resolve({});
            });

            await migrateApiKeys('sync', 'local');

            // Should set in local
            expect(mockStorageLocal.set).toHaveBeenCalledWith({
                apiKeys_local: {
                    deepl: { key: 'sync-key', validated: true }
                }
            });

            // Should remove from sync
            expect(mockStorageSync.remove).toHaveBeenCalledWith('apiKeys');
        });

        it('does nothing if types are same', async () => {
            await migrateApiKeys('local', 'local');
            expect(mockStorageLocal.get).not.toHaveBeenCalled();
            expect(mockStorageLocal.set).not.toHaveBeenCalled();
        });
    });
});
