import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type DeepLInstance, type TranslationSetup } from '@/src/types';
import { createInstance } from '@/utils/instances';

type Values = Record<string, unknown>;
let local: Values;
let sync: Values;
let api: typeof import('@/utils/storage');
let copyGranted: boolean;

function memoryArea(data: () => Values, enforceSyncQuota = false) {
    return {
        get: vi.fn(async (keys: string | string[] | null) => {
            const values = data();
            const names = keys === null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys];
            return structuredClone(Object.fromEntries(names.filter(name => name in values).map(name => [name, values[name]])));
        }),
        set: vi.fn(async (items: Values) => {
            if (enforceSyncQuota) {
                const size = ([key, value]: [string, unknown]) => new TextEncoder().encode(key + JSON.stringify(value)).length;
                if (Object.entries(items).some(entry => size(entry) > 8192) ||
                    Object.entries({ ...data(), ...items }).reduce((total, entry) => total + size(entry), 0) > 102400) {
                    throw new Error('QUOTA_BYTES exceeded');
                }
            }
            Object.assign(data(), structuredClone(items));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete data()[key];
        }),
    };
}

let localArea: ReturnType<typeof memoryArea>;
let syncArea: ReturnType<typeof memoryArea>;

function deepL(setup: TranslationSetup): DeepLInstance {
    const instance = setup.instances.find(item => item.providerId === 'deepl');
    if (!instance || instance.providerId !== 'deepl') throw new Error('Missing test instance');
    return instance;
}

async function changeTarget(target: string) {
    return api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, defaultTargetLang: target } }));
}

function occupySyncQuota() {
    // Valid individual sync items, collectively leaving too little room for
    // another complete setup snapshot.
    Object.assign(sync, Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`quota-${index}`, 'x'.repeat(5990)])));
}

function releaseSyncQuota() {
    for (const key of Object.keys(sync)) if (key.startsWith('quota-')) delete sync[key];
}

/** Publish an internally consistent external snapshot, as another device would. */
function installSnapshot(setup: TranslationSetup, overrides: Values = {}, parts = 1, bytes?: Uint8Array) {
    const serialized = JSON.stringify(setup);
    const encoded = Buffer.from(bytes ?? Buffer.from(serialized)).toString('base64');
    const manifest = {
        schemaVersion: 2, revision: 'external', chunkCount: parts,
        hash: createHash('sha256').update(serialized).digest('hex'), ...overrides,
    };
    local[api.SETUP_STORAGE_KEYS.MANIFEST] = manifest;
    for (let i = 0; i < parts; i++) {
        local[`${api.SETUP_STORAGE_KEYS.CHUNK_PREFIX}${manifest.revision}:${i}`] =
            encoded.slice(Math.floor(i * encoded.length / parts), Math.floor((i + 1) * encoded.length / parts));
    }
}

beforeEach(async () => {
    vi.resetModules();
    local = {};
    sync = {};
    copyGranted = false;
    localArea = memoryArea(() => local);
    syncArea = memoryArea(() => sync, true);
    vi.stubGlobal('chrome', {
        storage: { local: localArea, sync: syncArea },
        permissions: { contains: vi.fn(async (query: chrome.permissions.Permissions) => !query.origins?.length && copyGranted) },
    });
    api = await import('@/utils/storage');
});

describe('whole-setup migration', () => {
    it('starts a fresh device locally with copying off', async () => {
        const state = await api.getSetupState();
        expect(state.storageType).toBe('local');
        expect(state.setup.copyEnabled).toBe(false);
        expect(sync).toEqual({});
    });

    it.each(['local', 'sync'] as const)('imports %s credentials and all current preferences without touching legacy or inactive data', async mode => {
        const localKey = { key: 'device:fx', tier: 'free', validated: true, lastValidated: 123 };
        const syncedKey = { key: 'shared', tier: 'pro', validated: false };
        local = { credentialStorageType: mode, apiKeys_local: { deepl: localKey, microsoft: { key: 'hidden' } }, unrelated: 'local' };
        sync = {
            preferences: {
                ...DEFAULT_PREFERENCES, defaultSourceLang: 'fr', defaultTargetLang: 'ja',
                languageOverrides: { zh: 'zh-TW' }, fallbackOrder: ['deepl', 'lingva'],
                distinctId: 'retired', telemetryEnabled: true,
            },
            apiKeys: { deepl: syncedKey, googleCloud: { key: 'inactive' } }, unrelated: 'shared',
        };
        const beforeLocal = structuredClone(local);
        const beforeSync = structuredClone(sync);
        copyGranted = true;
        const state = await api.getSetupState();
        expect(state.storageType).toBe(mode);
        expect(state.setup.copyEnabled).toBe(true);
        expect(deepL(state.setup).credential).toEqual(mode === 'local' ? localKey : syncedKey);
        expect(state.setup.preferences).toEqual({
            defaultSourceLang: 'fr', defaultTargetLang: 'ja',
            languageOverrides: { zh: 'zh-TW' }, fallbackOrder: ['deepl', 'lingva'],
        });
        for (const [key, value] of Object.entries(beforeLocal)) expect(local[key]).toEqual(value);
        for (const [key, value] of Object.entries(beforeSync)) expect(sync[key]).toEqual(value);
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'de' };
        local.apiKeys_local = { deepl: { key: 'old-version-edit' } };
        sync.apiKeys = { deepl: { key: 'old-synced-edit' } };
        expect(await api.getSetup()).toEqual(state.setup);
    });

    it.each([[], ['unknown'], null])('preserves disabled legacy selection %j', async fallbackOrder => {
        sync.preferences = { ...DEFAULT_PREFERENCES, fallbackOrder };
        expect((await api.getSetup()).preferences.fallbackOrder).toEqual([]);
    });

    it('preserves supported legacy order and removes duplicate or unsupported legacy recipients', async () => {
        sync.preferences = { ...DEFAULT_PREFERENCES, fallbackOrder: ['microsoft', 'deepl', 'google-web', 'deepl', 'lingva'] };
        expect((await api.getSetup()).preferences.fallbackOrder).toEqual(['deepl', 'google-web', 'lingva']);
    });

    it('preserves current local values when previously synced language preferences later change', async () => {
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr' };
        await api.getSetup();
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'de' };
        expect((await api.getSetup()).preferences.defaultTargetLang).toBe('fr');
        expect(api.isSetupStorageChange({ preferences: { newValue: sync.preferences } }, 'sync')).toBe(false);
    });

    it('keeps the legacy setup usable when saving the migration selection fails and retries idempotently', async () => {
        local.apiKeys_local = { deepl: { key: 'preserved', validated: true } };
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr', fallbackOrder: ['deepl', 'lingva'] };
        copyGranted = true;
        const originalSet = localArea.set.getMockImplementation()!;
        localArea.set.mockImplementation(async items => {
            if (api.SETUP_STORAGE_KEYS.SELECTION in items) throw new Error('Selection unavailable');
            return originalSet(items);
        });
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        expect(pending.setup.copyEnabled).toBe(true);
        expect(pending.setup.preferences.defaultTargetLang).toBe('fr');
        expect(pending.setup.preferences.fallbackOrder).toEqual(['deepl', 'lingva']);
        expect(await api.getSetup()).toEqual(pending.setup);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        expect(local.apiKeys_local).toEqual({ deepl: { key: 'preserved', validated: true } });
        localArea.set.mockImplementation(originalSet);
        const state = await api.retrySetupMigration();
        expect(state.migrationError).toBeUndefined();
        expect(deepL(state.setup).credential?.key).toBe('preserved');
        expect(state.setup.instances.filter(item => item.providerId === 'deepl')).toHaveLength(1);
    });

    it('keeps live legacy settings usable after the first migration write fails without an automatic write loop', async () => {
        local.apiKeys_local = { deepl: { key: 'device:fx', validated: true, tier: 'free' } };
        sync.preferences = {
            ...DEFAULT_PREFERENCES, defaultSourceLang: 'fr', defaultTargetLang: 'ja',
            fallbackOrder: ['deepl', 'lingva'], languageOverrides: { zh: 'zh-TW' },
        };
        copyGranted = true;
        const originalSet = localArea.set.getMockImplementation()!;
        localArea.set.mockRejectedValue(new Error('Write unavailable'));
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        expect(localArea.set).toHaveBeenCalledTimes(1);
        expect(pending.setup.preferences).toEqual(sync.preferences);
        expect(deepL(pending.setup).credential?.key).toBe('device:fx');
        expect(pending.setup.copyEnabled).toBe(true);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        const writes = localArea.set.mock.calls.length;
        expect(await api.getSetup()).toEqual(pending.setup);
        expect((await api.getSetupState()).migrationError).toBeTruthy();
        expect(localArea.set.mock.calls).toHaveLength(writes);
        await expect(changeTarget('de')).rejects.toThrow();
        localArea.set.mockImplementation(originalSet);
        const retried = await api.retrySetupMigration();
        expect(retried.migrationError).toBeUndefined();
        expect(retried.setup).toEqual(pending.setup);
        expect(await api.getSetup()).toEqual(pending.setup);
    });

    it('retries a transient destination read failure without caching it as a failed migration write', async () => {
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr' };
        const read = localArea.get.getMockImplementation()!;
        let failRead = true;
        localArea.get.mockImplementation(async keys => {
            if (keys === api.SETUP_STORAGE_KEYS.MANIFEST && failRead) {
                failRead = false;
                throw new Error('Storage temporarily unavailable');
            }
            return read(keys);
        });
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        expect(pending.setup.preferences.defaultTargetLang).toBe('fr');
        const recovered = await api.getSetupState();
        expect(recovered.migrationError).toBeUndefined();
        expect(recovered.setup).toEqual(pending.setup);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeDefined();
    });

    it('reloads changed legacy settings before completing their first migration', async () => {
        const write = localArea.set.getMockImplementation()!;
        let changeLegacy = true;
        localArea.set.mockImplementation(async items => {
            await write(items);
            if (changeLegacy && Object.keys(items).some(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX))) {
                changeLegacy = false;
                sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr' };
            }
        });
        const migrated = await api.getSetupState();
        expect(migrated.migrationError).toBeUndefined();
        expect(migrated.setup.preferences.defaultTargetLang).toBe('fr');
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeDefined();
        expect(await api.getSetup()).toEqual(migrated.setup);
    });

    it('retains malformed access recovery data instead of accepting a non-URL origin', async () => {
        const setup = await api.getSetup();
        const access = { origins: ['not a URL'], copyEnabled: false };
        local.translationSetupAccess_v2 = access;
        await expect(api.reconcileSetupAccess()).rejects.toThrow();
        expect(local.translationSetupAccess_v2).toEqual(access);
        expect(await api.getSetup()).toEqual(setup);
    });

    it.each([
        { origins: [42], copyEnabled: false },
        { origins: ['https://host.example/custom/*'], copyEnabled: false },
        { origins: [`https://${'a'.repeat(4096)}/*`], copyEnabled: false },
        { origins: [], copyEnabled: 'yes' },
    ])('rejects malformed retained access ownership before saving an edit: %j', async access => {
        const setup = await api.getSetup();
        local.translationSetupAccess_v2 = access;
        await expect(changeTarget('fr')).rejects.toThrow();
        expect(local.translationSetupAccess_v2).toEqual(access);
        expect(await api.getSetup()).toEqual(setup);
    });

    it('does not invent clipboard cleanup ownership when saving a non-copying setup', async () => {
        await api.getSetup();
        await changeTarget('fr');
        const remove = vi.fn(async () => true);
        Object.assign(chrome.permissions, { remove });
        await api.reconcileSetupAccess();
        expect(remove).not.toHaveBeenCalled();
        expect((await api.getSetup()).copyEnabled).toBe(false);
    });

    it('does not repeat unchanged access-ownership writes during reconciliation', async () => {
        await api.getSetup();
        await api.reconcileSetupAccess();
        expect(local.translationSetupAccess_v2).toEqual({ origins: ['https://translate.googleapis.com/*'], copyEnabled: false });
        const writes = localArea.set.mock.calls.length;
        await api.reconcileSetupAccess();
        expect(localArea.set.mock.calls).toHaveLength(writes);
    });

    it('retains newly enabled provider ownership so disabling it releases its grants', async () => {
        sync.preferences = structuredClone(DEFAULT_PREFERENCES); // Existing installation with historical provider slots.
        await api.getSetup();
        const remove = vi.fn(async () => true);
        Object.assign(chrome.permissions, { remove });
        await api.reconcileSetupAccess();
        await api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['google-web', 'deepl'] } }));
        await api.reconcileSetupAccess();
        await api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['google-web'] } }));
        await api.reconcileSetupAccess();
        expect(remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
    });

    it.each([
        { schemaVersion: 3 },
        { revision: 'bad:revision' },
        { chunkCount: 1.5 },
    ])('rejects an invalid manifest even when its snapshot payload is intact: %j', async metadata => {
        const setup = await api.getSetup();
        installSnapshot(setup, metadata);
        const before = structuredClone(local);
        await expect(api.getSetup()).rejects.toThrow();
        expect(local).toEqual(before);
    });

    it('accepts the supported chunk-count limit but rejects a snapshot exceeding it', async () => {
        const setup = await api.getSetup();
        installSnapshot(setup, {}, 64);
        expect(await api.getSetup()).toEqual(setup);
        installSnapshot(setup, {}, 65);
        await expect(api.getSetup()).rejects.toThrow();
    });

    it('rejects invalid UTF-8 rather than silently replacing bytes in a saved account name', async () => {
        sync.preferences = structuredClone(DEFAULT_PREFERENCES); // Existing installation with historical provider slots.
        const setup = await api.getSetup();
        deepL(setup).name = 'Work\ufffd';
        const serialized = Buffer.from(JSON.stringify(setup));
        const offset = serialized.indexOf(Buffer.from('\ufffd'));
        const damaged = Buffer.concat([serialized.subarray(0, offset), Buffer.from([255]), serialized.subarray(offset + 3)]);
        installSnapshot(setup, {}, 1, damaged);
        await expect(api.getSetup()).rejects.toThrow();
    });

    it('saves and loads a setup at the supported serialized byte limit', async () => {
        const setup = await api.getSetup();
        const accounts = Array.from({ length: 32 }, (_, i) => ({
            id: `account-${i}`, providerId: 'deepl' as const, name: `Account ${i}`,
            credential: { key: '', validated: false },
        }));
        setup.instances.push(...accounts);
        setup.instanceOrder!.push(...accounts.map(account => account.id));
        let remaining = 262144 - Buffer.byteLength(JSON.stringify(setup));
        for (const account of accounts) {
            const length = Math.min(remaining, 8192);
            account.credential.key = 'a'.repeat(length);
            remaining -= length;
        }
        expect(remaining).toBe(0);
        expect(await api.updateSetup(() => setup)).toEqual(setup);
        expect(await api.getSetup()).toEqual(setup);
    });

    it('removes unpublished destination chunks after a manifest commit fails', async () => {
        const setup = await api.getSetup();
        const write = syncArea.set.getMockImplementation()!;
        syncArea.set.mockImplementation(async items => {
            if (api.SETUP_STORAGE_KEYS.MANIFEST in items) throw new Error('Commit failed');
            await write(items);
        });
        await expect(api.switchSetupStorage('sync')).rejects.toThrow('Commit failed');
        expect(Object.keys(sync).filter(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX))).toEqual([]);
        expect(await api.getSetup()).toEqual(setup);
    });

    it('rejects a non-string snapshot chunk even when coercion would decode valid settings', async () => {
        const setup = await api.getSetup();
        installSnapshot(setup);
        const key = `${api.SETUP_STORAGE_KEYS.CHUNK_PREFIX}external:0`;
        local[key] = [local[key]];
        await expect(api.getSetup()).rejects.toThrow();
    });

    it('rejects an oversized individual chunk even when the overall setup is valid', async () => {
        sync.preferences = structuredClone(DEFAULT_PREFERENCES); // Existing installation with historical provider slots.
        const setup = await api.getSetup();
        deepL(setup).credential = { key: 'a'.repeat(5000), validated: false };
        installSnapshot(setup);
        await expect(api.getSetup()).rejects.toThrow();
    });

    it('removes obsolete chunks once a replacement setup is committed', async () => {
        await api.getSetup();
        const oldChunks = Object.keys(local).filter(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX));
        await changeTarget('fr');
        expect(oldChunks.every(key => !(key in local))).toBe(true);
        expect((await api.getSetup()).preferences.defaultTargetLang).toBe('fr');
    });

    it.each([{ schemaVersion: 3 }, { revision: 42 }])('rejects an invalid persisted storage selector: %j', async patch => {
        await api.getSetup();
        const value = local[api.SETUP_STORAGE_KEYS.SELECTION];
        local[api.SETUP_STORAGE_KEYS.SELECTION] = { ...(value as Values), ...patch };
        await expect(api.getSetupState()).rejects.toThrow();
    });

    it('releases legacy Google ownership without inventing clipboard ownership', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async query => query.origins?.[0] === 'https://translate.google.com/*');
        const remove = vi.fn(async () => true);
        Object.assign(chrome.permissions, { remove });
        await api.getSetup();
        await api.reconcileSetupAccess();
        expect(remove).toHaveBeenCalledExactlyOnceWith({ origins: ['https://translate.google.com/*'] });
    });

    it('ignores provider-era storage events after completing whole-setup migration', async () => {
        expect(api.isSetupStorageChange({ preferences: { newValue: {} } }, 'sync')).toBe(true);
        await api.getSetup();
        expect(api.isSetupStorageChange({ preferences: { newValue: {} } }, 'sync')).toBe(false);
        expect(api.isSetupStorageChange({ [api.SETUP_STORAGE_KEYS.MANIFEST]: { newValue: {} } }, 'local')).toBe(true);
    });

    it('replaces unusable legacy language values and filters invalid legacy overrides', async () => {
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultSourceLang: '', defaultTargetLang: 42, languageOverrides: { zh: 'zh-TW', broken: 42 } };
        const setup = await api.getSetup();
        expect(setup.preferences.defaultSourceLang).toBe(DEFAULT_PREFERENCES.defaultSourceLang);
        expect(setup.preferences.defaultTargetLang).toBe(DEFAULT_PREFERENCES.defaultTargetLang);
        expect(setup.preferences.languageOverrides).toEqual({ zh: 'zh-TW' });
    });

    it('discards a non-finite legacy validation time while retaining the supplied key', async () => {
        local.apiKeys_local = { deepl: { key: 'retained', validated: true, lastValidated: Infinity } };
        expect(deepL(await api.getSetup()).credential).toEqual({ key: 'retained', validated: true });
    });

    it('leaves migration pending after repeated concurrent changes rather than retrying without a bound', async () => {
        const write = localArea.set.getMockImplementation()!;
        let attempts = 0;
        localArea.set.mockImplementation(async items => {
            await write(items);
            if (Object.keys(items).some(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX)) && ++attempts <= 2) {
                sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: attempts === 1 ? 'fr' : 'de' };
            }
        });
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        expect(pending.setup.preferences.defaultTargetLang).toBe('de');
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        expect(attempts).toBe(2);
    });

    it('filters storage notifications by ownership, area and migration state', async () => {
        const changed = (key: string, area: string) => api.isSetupStorageChange({ [key]: { newValue: 'changed' } }, area);
        expect(changed('unrelated', 'local')).toBe(false);
        expect(changed('preferences', 'sync')).toBe(true);
        await api.getSetup();
        expect(changed(api.SETUP_STORAGE_KEYS.SELECTION, 'local')).toBe(true);
        expect(changed(api.SETUP_STORAGE_KEYS.SELECTION, 'sync')).toBe(false);
        expect(changed(api.SETUP_STORAGE_KEYS.MANIFEST, 'session')).toBe(false);
        expect(changed(api.SETUP_STORAGE_KEYS.MANIFEST, 'sync')).toBe(true);
        expect(changed(`${api.SETUP_STORAGE_KEYS.CHUNK_PREFIX}external:0`, 'local')).toBe(true);
        expect(changed('unrelated', 'local')).toBe(false);
        expect(changed('preferences', 'sync')).toBe(false);
    });

    it('retains an origin at the recovery-record length limit while saving an unrelated preference', async () => {
        await api.getSetup();
        const prefix = 'https://';
        const suffix = '/*';
        const origin = prefix + 'a'.repeat(4096 - prefix.length - suffix.length) + suffix;
        local.translationSetupAccess_v2 = { origins: [origin], copyEnabled: false };
        expect((await changeTarget('fr')).preferences.defaultTargetLang).toBe('fr');
        expect(local.translationSetupAccess_v2).toMatchObject({ origins: expect.arrayContaining([origin]) });
    });

    it('recovers after a malformed destination pointer is observed and then removed', async () => {
        const write = localArea.set.getMockImplementation()!;
        localArea.set.mockRejectedValue(new Error('Write temporarily unavailable'));
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        localArea.set.mockImplementation(write);
        local[api.SETUP_STORAGE_KEYS.MANIFEST] = false;
        expect((await api.getSetupState()).migrationError).toBeTruthy();
        delete local[api.SETUP_STORAGE_KEYS.MANIFEST];
        const recovered = await api.getSetupState();
        expect(recovered.migrationError).toBeUndefined();
        expect(recovered.setup).toEqual(pending.setup);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeDefined();
    });

    it('does not restart the retry budget after a rejected selector write and a concurrently removed selector', async () => {
        const write = localArea.set.getMockImplementation()!;
        const read = localArea.get.getMockImplementation()!;
        let recoveryRead = 0;
        let lostSelection = false;
        let changedLegacy = false;
        let rejectSelection = true;
        localArea.set.mockImplementation(async items => {
            await write(items);
            if (api.SETUP_STORAGE_KEYS.SELECTION in items && rejectSelection) {
                rejectSelection = false;
                recoveryRead = 1;
                throw new Error('Selector persisted before the API rejected');
            }
            if (lostSelection && !changedLegacy && Object.keys(items).some(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX))) {
                changedLegacy = true;
                sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr' };
            }
        });
        localArea.get.mockImplementation(async keys => {
            if (keys === api.SETUP_STORAGE_KEYS.SELECTION && recoveryRead === 1) {
                recoveryRead = 2;
                return read(keys);
            }
            if (keys === api.SETUP_STORAGE_KEYS.SELECTION && recoveryRead === 2) {
                recoveryRead = 0;
                lostSelection = true;
                delete local[api.SETUP_STORAGE_KEYS.SELECTION];
                delete local[api.SETUP_STORAGE_KEYS.MANIFEST];
            }
            return read(keys);
        });
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        expect(pending.setup.preferences.defaultTargetLang).toBe('fr');
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        expect(await api.getSetupState()).toEqual(pending);
    });

    it('lets a quota-blocked legacy Sync user explicitly recover to Local without losing settings', async () => {
        local.credentialStorageType = 'sync';
        sync.preferences = { ...DEFAULT_PREFERENCES, defaultTargetLang: 'fr', fallbackOrder: ['deepl'] };
        sync.apiKeys = { deepl: { key: 'shared', validated: true } };
        occupySyncQuota();
        const legacy = structuredClone(sync);
        const pending = await api.getSetupState();
        expect(pending.migrationError).toBeTruthy();
        expect(pending.storageType).toBe('sync');
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        expect(await api.getSetup()).toEqual(pending.setup);
        const recovered = await api.switchSetupStorage('local');
        expect(recovered.storageType).toBe('local');
        expect(recovered.migrationError).toBeUndefined();
        expect(recovered.setup).toEqual(pending.setup);
        expect(await api.getSetup()).toEqual(pending.setup);
        expect(sync).toEqual(legacy);
    });

    it('notices a destination committed by another context after a cached migration failure', async () => {
        local.credentialStorageType = 'sync';
        occupySyncQuota();
        expect((await api.getSetupState()).migrationError).toBeTruthy();
        releaseSyncQuota();
        const original = api;
        vi.resetModules();
        const otherContext = await import('@/utils/storage');
        const originalSet = localArea.set.getMockImplementation()!;
        localArea.set.mockImplementation(async items => {
            if (api.SETUP_STORAGE_KEYS.SELECTION in items) throw new Error('Selection unavailable');
            return originalSet(items);
        });
        expect((await otherContext.getSetupState()).migrationError).toBeTruthy();
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        expect(sync[api.SETUP_STORAGE_KEYS.MANIFEST]).toBeDefined();
        localArea.set.mockImplementation(originalSet);
        const recovered = await original.getSetupState();
        expect(recovered.migrationError).toBeUndefined();
        expect(recovered.storageType).toBe('sync');
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeDefined();
    });

    it('keeps a usable legacy view until a different upgraded shared setup is explicitly chosen', async () => {
        await api.getSetup();
        await changeTarget('fr');
        await api.switchSetupStorage('sync');
        const firstDevice = local;
        local = { credentialStorageType: 'sync', apiKeys_local: { deepl: { key: 'inactive' } } };
        const pending = await api.getSetupState();
        expect(pending.conflict?.reason).toBe('migration');
        expect(pending.setup.preferences.defaultTargetLang).toBe('en');
        expect((await api.getSetup()).preferences.defaultTargetLang).toBe('en');
        await expect(changeTarget('de')).rejects.toThrow();
        const chosen = await api.switchSetupStorage('sync', { token: pending.conflict!.token, choice: 'use-destination' });
        expect(chosen.setup.preferences.defaultTargetLang).toBe('fr');
        expect(chosen.conflict).toBeUndefined();
        expect(local.apiKeys_local).toEqual({ deepl: { key: 'inactive' } });
        local = firstDevice;
        expect((await api.getSetup()).preferences.defaultTargetLang).toBe('fr');
    });
});

describe('storage choices and recovery', () => {
    it.each(['old-key', 'new-key'])('clears credentials on an endpoint edit even if the edit supplies %s', async key => {
        await api.getSetup();
        const instance = { ...createInstance('libretranslate'), hosting: 'custom' as const, endpoint: 'http://localhost:5000', credential: { key: 'old-key', validated: false } };
        await api.updateSetup(setup => ({ ...setup, instances: [...setup.instances, instance], instanceOrder: [...setup.instanceOrder!, instance.id] }));
        const changed = await api.updateSetup(setup => ({
            ...setup, instances: setup.instances.map(item => item.id === instance.id
                ? { ...instance, endpoint: 'http://192.168.1.10:5000', credential: { key, validated: false } } : item),
        }));
        expect(changed.instances.find(item => item.id === instance.id)).toEqual({
            id: instance.id, name: instance.name, providerId: 'libretranslate', hosting: 'custom', endpoint: 'http://192.168.1.10:5000',
        });
    });

    it('keeps a newly entered endpoint-bound key during rename, storage switch and reload', async () => {
        await api.getSetup();
        const instance = { ...createInstance('libretranslate'), hosting: 'custom' as const, endpoint: 'http://localhost:5000' };
        await api.updateSetup(setup => ({ ...setup, instances: [...setup.instances, instance], instanceOrder: [...setup.instanceOrder!, instance.id] }));
        const configured = await api.updateSetup(setup => ({
            ...setup, instances: setup.instances.map(item => item.id === instance.id
                ? { ...instance, name: 'Home', credential: { key: 'endpoint-key', validated: false } } : item),
        }));
        expect(configured.instances.find(item => item.id === instance.id)).toMatchObject({
            name: 'Home', credential: { key: 'endpoint-key', validated: false },
        });
        await api.switchSetupStorage('sync');
        expect(await api.getSetup()).toEqual(configured);
    });

    it('moves the entire setup to an empty destination and preserves the shared copy when choosing Local later', async () => {
        await api.getSetup();
        const named = createInstance('libretranslate');
        const configured = await api.updateSetup(setup => ({
            ...setup, copyEnabled: true, instances: [...setup.instances, named], instanceOrder: [named.id, ...setup.instanceOrder!],
            preferences: { ...setup.preferences, defaultTargetLang: 'fr', fallbackOrder: [named.id, 'google-web'] },
        }));
        expect((await api.switchSetupStorage('sync')).setup).toEqual(configured);
        const synced = structuredClone(sync);
        const back = await api.switchSetupStorage('local');
        expect(back.setup).toEqual(configured);
        expect(back.storageType).toBe('local');
        expect(sync).toEqual(synced);
    });

    it.each(['chunks', 'manifest', 'selection'])('keeps the active setup usable after a failed %s write and recovers on retry', async stage => {
        const original = await api.getSetup();
        const originalSyncSet = syncArea.set.getMockImplementation()!;
        const originalLocalSet = localArea.set.getMockImplementation()!;
        const writeError = new Error('Write unavailable');
        syncArea.set.mockImplementation(async items => {
            if ((stage === 'chunks' && !(api.SETUP_STORAGE_KEYS.MANIFEST in items)) ||
                (stage === 'manifest' && api.SETUP_STORAGE_KEYS.MANIFEST in items)) throw writeError;
            return originalSyncSet(items);
        });
        localArea.set.mockImplementation(async items => {
            if (stage === 'selection' && api.SETUP_STORAGE_KEYS.SELECTION in items) throw writeError;
            return originalLocalSet(items);
        });
        await expect(api.switchSetupStorage('sync')).rejects.toBe(writeError);
        expect((await api.getSetupState()).storageType).toBe('local');
        expect(await api.getSetup()).toEqual(original);
        syncArea.set.mockImplementation(originalSyncSet);
        localArea.set.mockImplementation(originalLocalSet);
        expect((await api.switchSetupStorage('sync')).setup).toEqual(original);
    });

    it('does not replace the active snapshot when a settings edit fails before commit', async () => {
        const original = await api.getSetup();
        const originalSet = localArea.set.getMockImplementation()!;
        const commitError = new Error('Commit unavailable');
        localArea.set.mockImplementation(async items => {
            if (api.SETUP_STORAGE_KEYS.MANIFEST in items) throw commitError;
            return originalSet(items);
        });
        await expect(changeTarget('fr')).rejects.toBe(commitError);
        expect(await api.getSetup()).toEqual(original);
    });

    it('rejects an edit when another context publishes a different snapshot before its write', async () => {
        const first = await api.getSetup();
        const earlierSnapshot = structuredClone(local);
        await changeTarget('fr');
        await expect(api.updateSetup(setup => {
            local = earlierSnapshot;
            return { ...setup, copyEnabled: true };
        })).rejects.toThrow();
        expect(await api.getSetup()).toEqual(first);
    });

    it('keeps the new committed setup usable when obsolete chunk cleanup fails', async () => {
        await api.getSetup();
        localArea.remove.mockRejectedValue(new Error('Cleanup unavailable'));
        const changed = await changeTarget('fr');
        expect(changed.preferences.defaultTargetLang).toBe('fr');
        expect(await api.getSetup()).toEqual(changed);
    });

    it.each(['use-destination', 'replace-destination'] as const)('requires an explicit %s choice for differing setups without merging them', async choice => {
        await api.getSetup();
        await changeTarget('fr');
        await api.switchSetupStorage('sync');
        await changeTarget('de');
        const pending = await api.switchSetupStorage('local');
        expect(pending.storageType).toBe('sync');
        expect(pending.conflict?.source.preferences.defaultTargetLang).toBe('de');
        expect(pending.conflict?.destination.preferences.defaultTargetLang).toBe('fr');
        const chosen = await api.switchSetupStorage('local', { token: pending.conflict!.token, choice });
        expect(chosen.storageType).toBe('local');
        expect(chosen.setup.preferences.defaultTargetLang).toBe(choice === 'use-destination' ? 'fr' : 'de');
    });

    it('refreshes a conflict when the source changes while the choice is open', async () => {
        await api.getSetup();
        await changeTarget('fr');
        await api.switchSetupStorage('sync');
        await changeTarget('de');
        const pending = await api.switchSetupStorage('local');
        await api.updateSetup(setup => ({ ...setup, copyEnabled: true }));
        const stale = await api.switchSetupStorage('local', { token: pending.conflict!.token, choice: 'replace-destination' });
        expect(stale.storageType).toBe('sync');
        expect(stale.setup.copyEnabled).toBe(true);
        expect(stale.conflict!.token).not.toBe(pending.conflict!.token);
        expect(stale.conflict!.source.copyEnabled).toBe(true);
    });

    it('refreshes a conflict when another device changes the destination', async () => {
        await api.getSetup();
        await changeTarget('fr');
        await api.switchSetupStorage('sync');
        const syncedSelection = structuredClone(local[api.SETUP_STORAGE_KEYS.SELECTION]);
        await changeTarget('de');
        let pending = await api.switchSetupStorage('local');
        await api.switchSetupStorage('local', { token: pending.conflict!.token, choice: 'use-destination' });
        pending = await api.switchSetupStorage('sync');
        const firstDevice = local;
        local = { [api.SETUP_STORAGE_KEYS.SELECTION]: syncedSelection };
        await changeTarget('ja');
        local = firstDevice;
        const stale = await api.switchSetupStorage('sync', { token: pending.conflict!.token, choice: 'replace-destination' });
        expect(stale.storageType).toBe('local');
        expect(stale.conflict!.destination.preferences.defaultTargetLang).toBe('ja');
        expect(stale.conflict!.token).not.toBe(pending.conflict!.token);
        expect(stale.setup.preferences.defaultTargetLang).toBe('fr');
    });

    it('refreshes the conflict when an active Sync snapshot is republished during a Local replacement', async () => {
        await api.getSetup();
        await changeTarget('fr');
        await api.switchSetupStorage('sync');
        await changeTarget('de');
        const originalSync = structuredClone(sync);
        await changeTarget('ja');
        const republishedSync = structuredClone(sync);
        sync = originalSync;
        const pending = await api.switchSetupStorage('local');
        const write = localArea.set.getMockImplementation()!;
        const read = syncArea.get.getMockImplementation()!;
        let sourceGap = false;
        localArea.set.mockImplementation(async items => {
            await write(items);
            if (Object.keys(items).some(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX))) sourceGap = true;
        });
        syncArea.get.mockImplementation(async keys => {
            if (keys === api.SETUP_STORAGE_KEYS.MANIFEST && sourceGap) {
                sourceGap = false;
                sync = structuredClone(republishedSync);
                return {};
            }
            return read(keys);
        });
        const refreshed = await api.switchSetupStorage('local', { token: pending.conflict!.token, choice: 'replace-destination' });
        expect(refreshed.storageType).toBe('sync');
        expect(refreshed.setup.preferences.defaultTargetLang).toBe('ja');
        expect(refreshed.conflict?.source.preferences.defaultTargetLang).toBe('ja');
        expect(refreshed.conflict?.destination.preferences.defaultTargetLang).toBe('fr');
        expect(await api.getSetup()).toEqual(refreshed.setup);
    });

    it('refreshes the conflict rather than overwriting a source changed during destination publication', async () => {
        const first = await api.getSetup();
        await api.switchSetupStorage('sync');
        await api.switchSetupStorage('local');
        const firstLocal = structuredClone(local);
        await changeTarget('fr');
        const pending = await api.switchSetupStorage('sync');
        const write = syncArea.set.getMockImplementation()!;
        syncArea.set.mockImplementation(async items => {
            await write(items);
            if (Object.keys(items).some(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX))) {
                local = structuredClone(firstLocal);
            }
        });
        const refreshed = await api.switchSetupStorage('sync', { token: pending.conflict!.token, choice: 'replace-destination' });
        expect(refreshed.storageType).toBe('local');
        expect(refreshed.setup).toEqual(first);
        expect(refreshed.conflict?.source).toEqual(first);
        expect(await api.getSetup()).toEqual(first);
    });

    it.each([false, true])('rechecks a changed destination before selecting it (pointer temporarily absent: %s)', async missingPointer => {
        const first = await api.getSetup();
        const firstLocal = structuredClone(local);
        await changeTarget('fr');
        await api.switchSetupStorage('sync');
        await changeTarget('de');
        const pending = await api.switchSetupStorage('local');
        const read = localArea.get.getMockImplementation()!;
        let manifestReads = 0;
        localArea.get.mockImplementation(async keys => {
            if (keys === api.SETUP_STORAGE_KEYS.MANIFEST && ++manifestReads === 3) {
                const selection = local[api.SETUP_STORAGE_KEYS.SELECTION];
                local = { ...structuredClone(firstLocal), [api.SETUP_STORAGE_KEYS.SELECTION]: selection };
                if (missingPointer) return {};
            }
            return read(keys);
        });
        const refreshed = await api.switchSetupStorage('local', { token: pending.conflict!.token, choice: 'use-destination' });
        expect(refreshed.storageType).toBe('sync');
        expect(refreshed.setup.preferences.defaultTargetLang).toBe('de');
        expect(refreshed.conflict?.destination).toEqual(first);
        expect(refreshed.conflict?.token).not.toBe(pending.conflict!.token);
    });

    it('serializes a key edit that overlaps a storage switch', async () => {
        sync.preferences = structuredClone(DEFAULT_PREFERENCES); // Existing installation with historical provider slots.
        await api.getSetup();
        let release!: () => void;
        let begin!: () => void;
        const started = new Promise<void>(resolve => { begin = resolve; });
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const originalSet = localArea.set.getMockImplementation()!;
        localArea.set.mockImplementationOnce(async items => { begin(); await blocked; return originalSet(items); });
        const edit = api.updateSetup(setup => ({
            ...setup, instances: setup.instances.map(instance => instance.providerId === 'deepl'
                ? { ...instance, credential: { key: 'edited:fx', validated: false, tier: 'free' } } : instance),
        }));
        await started;
        const switching = api.switchSetupStorage('sync');
        release();
        await Promise.all([edit, switching]);
        expect(deepL(await api.getSetup()).credential?.key).toBe('edited:fx');
        expect((await api.getSetupState()).storageType).toBe('sync');
    });

    it('round-trips a multi-item Unicode setup within the real sync item limit', async () => {
        await api.getSetup();
        const instances = Array.from({ length: 8 }, () => {
            const instance = createInstance('deepl');
            if (instance.providerId !== 'deepl') throw new Error('Wrong test provider');
            return { ...instance, name: '日本語の翻訳', credential: { key: 'x'.repeat(1200), validated: false } };
        });
        const expected = await api.updateSetup(setup => ({ ...setup, instances: [...setup.instances, ...instances], instanceOrder: [...setup.instanceOrder!, ...instances.map(instance => instance.id)] }));
        expect((await api.switchSetupStorage('sync')).setup).toEqual(expected);
        expect(await api.getSetup()).toEqual(expected);
        expect(Object.keys(sync).length).toBeGreaterThan(2);
    });

    it('persists off-row positions across reload and a whole-setup storage switch', async () => {
        sync.preferences = structuredClone(DEFAULT_PREFERENCES);
        const existing = await api.getSetup();
        const expected = await api.updateSetup(() => ({ ...existing,
            instanceOrder: ['deepl', 'google-web', 'lingva'],
            preferences: { ...existing.preferences, fallbackOrder: ['google-web'] },
        }));
        expect((await api.getSetup()).instanceOrder).toEqual(['deepl', 'google-web', 'lingva']);
        expect((await api.switchSetupStorage('sync')).setup).toEqual(expected);
        expect((await api.getSetup()).preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('reports sync quota failure without changing the active selection or local setup', async () => {
        const original = await api.getSetup();
        occupySyncQuota();
        const occupied = structuredClone(sync);
        await expect(api.switchSetupStorage('sync')).rejects.toThrow();
        expect((await api.getSetupState()).storageType).toBe('local');
        expect(await api.getSetup()).toEqual(original);
        expect(sync).toEqual(occupied);
    });

    it('reports incomplete selected sync data without resetting defaults or overwriting recovery records', async () => {
        await api.getSetup();
        await api.switchSetupStorage('sync');
        const chunk = Object.keys(sync).find(key => key.startsWith(api.SETUP_STORAGE_KEYS.CHUNK_PREFIX))!;
        delete sync[chunk];
        const saved = structuredClone(sync);
        await expect(api.getSetup()).rejects.toThrow();
        expect(sync).toEqual(saved);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeDefined();
    });

    it('rejects broken instance references instead of silently changing the fallback recipients', async () => {
        const original = await api.getSetup();
        await expect(api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['missing'] } })))
            .rejects.toThrow();
        expect(await api.getSetup()).toEqual(original);
    });
});
