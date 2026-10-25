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

beforeEach(async () => {
    vi.resetModules();
    local = {};
    sync = {};
    copyGranted = false;
    localArea = memoryArea(() => local);
    syncArea = memoryArea(() => sync, true);
    vi.stubGlobal('chrome', {
        storage: { local: localArea, sync: syncArea },
        permissions: { contains: vi.fn(async () => copyGranted) },
    });
    api = await import('@/utils/storage');
});

describe('whole-setup migration', () => {
    it('starts a fresh device with local settings, fixed provider rows and copying off', async () => {
        const state = await api.getSetupState();
        expect(state.storageType).toBe('local');
        expect(state.setup.preferences).toEqual(DEFAULT_PREFERENCES);
        expect(state.setup.copyEnabled).toBe(false);
        expect(state.setup.instances).toEqual([
            { id: 'google-web', providerId: 'google-web' },
            { id: 'lingva', providerId: 'lingva' },
            { id: 'deepl', providerId: 'deepl', name: 'DeepL' },
        ]);
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
        expect(pending.setup.preferences).toEqual(sync.preferences);
        expect(deepL(pending.setup).credential?.key).toBe('device:fx');
        expect(pending.setup.copyEnabled).toBe(true);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeUndefined();
        const writes = localArea.set.mock.calls.length;
        expect(await api.getSetup()).toEqual(pending.setup);
        expect((await api.getSetupState()).migrationError).toBeTruthy();
        expect(localArea.set.mock.calls).toHaveLength(writes);
        await expect(changeTarget('de')).rejects.toThrow('retry migration');
        localArea.set.mockImplementation(originalSet);
        const retried = await api.retrySetupMigration();
        expect(retried.migrationError).toBeUndefined();
        expect(retried.setup).toEqual(pending.setup);
        expect(await api.getSetup()).toEqual(pending.setup);
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
        await expect(changeTarget('de')).rejects.toThrow('Choose the setup');
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
        await api.updateSetup(setup => ({ ...setup, instances: [...setup.instances, instance] }));
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
        await api.updateSetup(setup => ({ ...setup, instances: [...setup.instances, instance] }));
        const configured = await api.updateSetup(setup => ({
            ...setup, instances: setup.instances.map(item => item.id === instance.id
                ? { ...instance, name: 'Home', credential: { key: 'endpoint-key', validated: false } } : item),
        }));
        await api.switchSetupStorage('sync');
        expect(await api.getSetup()).toEqual(configured);
    });

    it('moves the entire setup to an empty destination and preserves the shared copy when choosing Local later', async () => {
        await api.getSetup();
        const named = createInstance('libretranslate');
        const configured = await api.updateSetup(setup => ({
            ...setup, copyEnabled: true, instances: [...setup.instances, named],
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
        syncArea.set.mockImplementation(async items => {
            if ((stage === 'chunks' && !(api.SETUP_STORAGE_KEYS.MANIFEST in items)) ||
                (stage === 'manifest' && api.SETUP_STORAGE_KEYS.MANIFEST in items)) throw new Error('Write unavailable');
            return originalSyncSet(items);
        });
        localArea.set.mockImplementation(async items => {
            if (stage === 'selection' && api.SETUP_STORAGE_KEYS.SELECTION in items) throw new Error('Write unavailable');
            return originalLocalSet(items);
        });
        await expect(api.switchSetupStorage('sync')).rejects.toThrow('Write unavailable');
        expect((await api.getSetupState()).storageType).toBe('local');
        expect(await api.getSetup()).toEqual(original);
        syncArea.set.mockImplementation(originalSyncSet);
        localArea.set.mockImplementation(originalLocalSet);
        expect((await api.switchSetupStorage('sync')).setup).toEqual(original);
    });

    it('does not replace the active snapshot when a settings edit fails before commit', async () => {
        const original = await api.getSetup();
        const originalSet = localArea.set.getMockImplementation()!;
        localArea.set.mockImplementation(async items => {
            if (api.SETUP_STORAGE_KEYS.MANIFEST in items) throw new Error('Commit unavailable');
            return originalSet(items);
        });
        await expect(changeTarget('fr')).rejects.toThrow('Commit unavailable');
        expect(await api.getSetup()).toEqual(original);
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

    it('serializes a key edit that overlaps a storage switch', async () => {
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
        const expected = await api.updateSetup(setup => ({ ...setup, instances: [...setup.instances, ...instances] }));
        expect((await api.switchSetupStorage('sync')).setup).toEqual(expected);
        expect(await api.getSetup()).toEqual(expected);
        expect(Object.keys(sync).length).toBeGreaterThan(2);
    });

    it('reports sync quota failure without changing the active selection or local setup', async () => {
        const original = await api.getSetup();
        occupySyncQuota();
        const occupied = structuredClone(sync);
        await expect(api.switchSetupStorage('sync')).rejects.toThrow('QUOTA_BYTES');
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
        await expect(api.getSetup()).rejects.toThrow('incomplete');
        expect(sync).toEqual(saved);
        expect(local[api.SETUP_STORAGE_KEYS.SELECTION]).toBeDefined();
    });

    it('rejects broken instance references instead of silently changing the fallback recipients', async () => {
        const original = await api.getSetup();
        await expect(api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['missing'] } })))
            .rejects.toThrow('unavailable');
        expect(await api.getSetup()).toEqual(original);
    });
});
