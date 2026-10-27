/** @vitest-environment jsdom */
import { createHash, webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { useState } from 'preact/hooks';
import { render, fireEvent, within, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TranslationSetup } from '@/src/types';
import type { SetupUpdate } from '@/entrypoints/options/hooks/usePreferences';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { CopySettings } from '@/entrypoints/options/components/CopySettings';

vi.mock('sortablejs', () => ({ default: { create: () => ({ destroy() {} }) } }));

function event<Args extends unknown[]>() {
    const listeners: ((...args: Args) => unknown)[] = [];
    return {
        addListener: (listener: (...args: Args) => unknown) => listeners.push(listener),
        removeListener: () => {},
        clear: () => { listeners.length = 0; },
        fire: (...args: Args) => Promise.all(listeners.map(listener => listener(...args))),
    };
}

let api: typeof import('@/utils/storage');
let origins: Set<string>;
let permissions: Set<string>;
let changes: [Record<string, chrome.storage.StorageChange>, string][];
let storageChanged: ReturnType<typeof event<[Record<string, chrome.storage.StorageChange>, string]>>;
let local: Record<string, unknown>;
let sync: Record<string, unknown>;

function area(values: Record<string, unknown>, name: string) {
    return {
        get: vi.fn(async (keys: string | string[] | null) => structuredClone(Object.fromEntries(
            (keys === null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys])
                .filter(key => key in values).map(key => [key, values[key]]),
        ))),
        set: vi.fn(async (items: Record<string, unknown>) => {
            changes.push([Object.fromEntries(Object.entries(items).map(([key, value]) =>
                [key, { oldValue: structuredClone(values[key]), newValue: structuredClone(value) }])), name]);
            Object.assign(values, structuredClone(items));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        }),
    };
}

async function startBackground() {
    const { default: background } = await import('@/entrypoints/background');
    (background as unknown as () => void)();
    // A subsequent read settles after startup's serialized setup work.
    await api.getSetup();
}

beforeEach(async () => {
    vi.resetModules();
    origins = new Set();
    permissions = new Set();
    local = {};
    sync = {};
    changes = [];
    storageChanged = event();
    vi.stubGlobal('crypto', {
        randomUUID: () => webcrypto.randomUUID(),
        subtle: { digest: async (_algorithm: string, bytes: Uint8Array) =>
            Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer },
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
        { code: 'en', name: 'English', targets: ['fr'] },
        { code: 'fr', name: 'French', targets: ['en'] },
    ])));
    const browser = {
        storage: { local: area(local, 'local'), sync: area(sync, 'sync'), onChanged: storageChanged },
        permissions: {
            contains: vi.fn(async (query: chrome.permissions.Permissions) =>
                (query.origins ?? []).every(origin => origins.has(origin)) &&
                (query.permissions ?? []).every(permission => permissions.has(permission))),
            request: vi.fn(async (query: chrome.permissions.Permissions) => {
                query.origins?.forEach(origin => origins.add(origin));
                query.permissions?.forEach(permission => permissions.add(permission));
                return true;
            }),
            remove: vi.fn(async (query: chrome.permissions.Permissions) => {
                query.origins?.forEach(origin => origins.delete(origin));
                query.permissions?.forEach(permission => permissions.delete(permission));
                return true;
            }),
            onAdded: event(), onRemoved: event(),
        },
        omnibox: {
            setDefaultSuggestion: vi.fn(async () => {}),
            onInputStarted: event(), onInputChanged: event(), onInputEntered: event(), onInputCancelled: event(),
        },
        runtime: { onInstalled: event(), getContexts: vi.fn(async () => [{}]), ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' } },
        offscreen: { closeDocument: vi.fn(async () => {}) },
        i18n: { getMessage: (key: string) => key },
    };
    vi.stubGlobal('chrome', browser);
    vi.stubGlobal('browser', browser);
    vi.stubGlobal('defineBackground', (callback: () => void) => callback);
    api = await import('@/utils/storage');
});

afterEach(async () => {
    // Drain queued storage-event work before replacing the browser boundary.
    await api.getSetup().catch(() => undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function configuredSetup() {
    await api.getSetup();
    origins = new Set(['http://old.example/*', 'http://shared.example/*', 'http://new.example/*']);
    permissions = new Set(['clipboardWrite', 'offscreen']);
    return api.updateSetup(setup => ({
        ...setup, copyEnabled: true,
        instances: [...setup.instances,
            { id: 'old', providerId: 'libretranslate', name: 'Old', hosting: 'custom', endpoint: 'http://old.example' },
            { id: 'shared', providerId: 'libretranslate', name: 'Shared', hosting: 'custom', endpoint: 'http://shared.example' },
        ],
        preferences: { ...setup.preferences, fallbackOrder: ['old', 'shared'] },
    } satisfies TranslationSetup));
}

it('releases the former Google grant on direct migration without v2 ownership', async () => {
    sync.preferences = { fallbackOrder: ['google-web'], defaultSourceLang: 'auto', defaultTargetLang: 'fr', languageOverrides: {} };
    origins.add('https://translate.google.com/*');
    await startBackground();
    expect((await api.getSetup()).preferences.fallbackOrder).toEqual(['google-web']);
    expect(origins.has('https://translate.google.com/*')).toBe(false);
    expect(origins.has('https://translate.googleapis.com/*')).toBe(false);
    expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('retains the former Google host when the chosen migration destination has another owner', async () => {
    await api.getSetup();
    await api.updateSetup(setup => ({
        ...setup,
        instances: [...setup.instances, { id: 'shared', providerId: 'libretranslate', name: 'Shared', hosting: 'custom', endpoint: 'https://translate.google.com/libre' }],
        preferences: { ...setup.preferences, fallbackOrder: ['shared'] },
    }));
    await api.switchSetupStorage('sync');
    for (const key of Object.keys(local)) delete local[key];
    local.credentialStorageType = 'sync';
    sync.preferences = { fallbackOrder: ['google-web'], defaultSourceLang: 'auto', defaultTargetLang: 'fr', languageOverrides: {} };
    origins.add('https://translate.google.com/*');
    const pending = await api.getSetupState();
    expect(pending.conflict?.reason).toBe('migration');
    await api.switchSetupStorage('sync', { token: pending.conflict!.token, choice: 'use-destination' });
    await api.reconcileSetupAccess();
    expect((await api.getSetup()).preferences.fallbackOrder).toEqual(['shared']);
    expect(origins.has('https://translate.google.com/*')).toBe(true);
    expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('releases obsolete host and copy access after a worker restarts during a setup change', async () => {
    await configuredSetup();
    await startBackground();
    storageChanged.clear();
    vi.resetModules();
    api = await import('@/utils/storage');
    changes = [];
    await api.updateSetup(setup => ({
        ...setup, copyEnabled: false,
        instances: setup.instances.map(instance => instance.id === 'old' && instance.providerId === 'libretranslate'
            ? { ...instance, endpoint: 'http://new.example' } : instance),
    }));
    await startBackground();
    for (const [delta, name] of [...changes]) await storageChanged.fire(delta, name);
    await vi.waitFor(() => expect(origins.has('http://old.example/*')).toBe(false));
    expect(origins).toEqual(new Set(['http://shared.example/*', 'http://new.example/*']));
    expect(permissions.size).toBe(0);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
});

it('releases a provider grant when its synced selection is disabled', async () => {
    await api.getSetup();
    await api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['google-web', 'deepl'] } }));
    await api.switchSetupStorage('sync');
    await startBackground();
    origins = new Set(['https://translate.googleapis.com/*', 'https://api-free.deepl.com/*', 'https://api.deepl.com/*']);
    changes = [];
    await api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['google-web'] } }));
    for (const [delta, name] of [...changes]) await storageChanged.fire(delta, name);
    await vi.waitFor(() => expect(origins).toEqual(new Set(['https://translate.googleapis.com/*'])));
});

it.each([false, true])('reconciles recorded Google mobile access while preserving other owners (%s)', async shared => {
    await api.getSetup();
    if (shared) {
        await api.updateSetup(setup => ({
            ...setup,
            instances: [...setup.instances, {
                id: 'shared-google-host', providerId: 'libretranslate', name: 'Shared host',
                hosting: 'custom', endpoint: 'https://translate.google.com',
            }],
            preferences: { ...setup.preferences, fallbackOrder: ['google-web', 'shared-google-host'] },
        }));
    }
    // Simulate ownership persisted by the previous adapter before this worker started.
    local.translationSetupAccess_v2 = { origins: ['https://translate.google.com/*'], copyEnabled: false };
    origins = new Set(['https://translate.google.com/*', 'https://translate.googleapis.com/*', 'https://unrelated.example/*']);
    await api.reconcileSetupAccess();
    expect(origins.has('https://translate.google.com/*')).toBe(shared);
    expect(origins.has('https://translate.googleapis.com/*')).toBe(true);
    expect(origins.has('https://unrelated.example/*')).toBe(true);
    expect(chrome.permissions.request).not.toHaveBeenCalled();
});

it('preserves a newly granted host while its enablement has not yet been saved', async () => {
    await configuredSetup();
    await api.reconcileSetupAccess();
    origins.add('http://pending.example/*');
    await api.reconcileSetupAccess();
    expect(origins.has('http://pending.example/*')).toBe(true);
});

it('retains failed cleanup obligations for retry after another worker restart', async () => {
    await configuredSetup();
    await api.reconcileSetupAccess();
    await api.updateSetup(setup => ({ ...setup, copyEnabled: false, preferences: { ...setup.preferences, fallbackOrder: ['shared'] } }));
    const removalError = new Error('Temporarily unavailable');
    vi.mocked(chrome.permissions.remove).mockRejectedValueOnce(removalError);
    await expect(api.reconcileSetupAccess()).rejects.toBe(removalError);
    expect(origins.has('http://old.example/*')).toBe(true);
    vi.resetModules();
    api = await import('@/utils/storage');
    await api.reconcileSetupAccess();
    expect(origins.has('http://old.example/*')).toBe(false);
    expect(origins.has('http://shared.example/*')).toBe(true);
    expect(permissions.size).toBe(0);
});

it('does not release access when the active setup cannot be loaded intact', async () => {
    await configuredSetup();
    await api.reconcileSetupAccess();
    local[api.SETUP_STORAGE_KEYS.MANIFEST] = { schemaVersion: 2, revision: 'incomplete' };
    vi.mocked(chrome.permissions.remove).mockClear();
    await expect(api.reconcileSetupAccess()).rejects.toThrow();
    expect(chrome.permissions.remove).not.toHaveBeenCalled();
    expect(origins.has('http://old.example/*')).toBe(true);
    expect(permissions.has('clipboardWrite')).toBe(true);
});

it('remembers newly enabled ownership if sync disables it before the worker observes it', async () => {
    await api.getSetup();
    await api.updateSetup(setup => ({ ...setup, preferences: { ...setup.preferences, fallbackOrder: [] } }));
    await api.switchSetupStorage('sync');
    const disabled = structuredClone(sync);
    origins.add('http://new.example/*');
    permissions = new Set(['clipboardWrite', 'offscreen']);
    await api.updateSetup(setup => ({
        ...setup, copyEnabled: true,
        instances: [...setup.instances, { id: 'new', providerId: 'libretranslate', name: 'New', hosting: 'custom', endpoint: 'http://new.example' }],
        preferences: { ...setup.preferences, fallbackOrder: ['new'] },
    }));
    // A different device delivers a complete disabled snapshot before this worker runs.
    Object.assign(sync, disabled);
    vi.resetModules();
    api = await import('@/utils/storage');
    await api.reconcileSetupAccess();
    expect(origins.has('http://new.example/*')).toBe(false);
    expect(permissions.size).toBe(0);
});

async function save(updater: SetupUpdate) {
    try { return await api.updateSetup(updater); }
    catch { return undefined; }
}

function InstanceSettings({ initial }: { initial: TranslationSetup }) {
    const [setup, setSetup] = useState(initial);
    return <ServiceList setup={setup} updateSetup={async updater => {
        const next = await save(updater);
        if (!next) return false;
        setSetup(next);
        return true;
    }} />;
}

it('serializes shared-host cleanup with enablement from a second settings page', async () => {
    await configuredSetup();
    const setup = await api.updateSetup(current => ({
        ...current,
        instances: [...current.instances, { id: 'b', providerId: 'libretranslate', name: 'B', hosting: 'custom', endpoint: 'http://old.example:8000' }],
    }));
    await api.reconcileSetupAccess();
    let finish!: () => void;
    vi.mocked(chrome.permissions.remove).mockImplementationOnce(query => new Promise(resolve => {
        finish = () => {
            query.origins?.forEach(origin => origins.delete(origin));
            resolve(true);
        };
    }));
    const first = render(<InstanceSettings initial={setup} />);
    const second = render(<InstanceSettings initial={setup} />);
    fireEvent.click(within(first.container.querySelector('[data-id="old"]')! as HTMLElement).getByRole('button', { name: 'disableInstance' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(within(second.container.querySelector('[data-id="b"]')! as HTMLElement).getByRole('button', { name: 'connectInstance' }));
    await waitFor(() => expect(chrome.permissions.request).toHaveBeenCalled());
    // Drain ready browser/storage promises while the removal boundary remains paused.
    await setImmediate();
    finish();
    await within(second.container as HTMLElement).findByRole('alert');
    expect((await api.getSetup()).preferences.fallbackOrder).not.toContain('b');
});

it('serializes copy cleanup with enablement from a second settings page', async () => {
    await configuredSetup();
    await api.reconcileSetupAccess();
    let finish!: () => void;
    vi.mocked(chrome.permissions.remove).mockImplementationOnce(query => new Promise(resolve => {
        finish = () => { query.permissions?.forEach(permission => permissions.delete(permission)); resolve(true); };
    }));
    const update = async (updater: SetupUpdate) => !!await save(updater);
    const first = render(<CopySettings copyEnabled={true} updateSetup={update} />);
    const second = render(<CopySettings copyEnabled={false} updateSetup={update} />);
    fireEvent.click(within(first.container as HTMLElement).getByRole('checkbox'));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(within(second.container as HTMLElement).getByRole('checkbox'));
    await waitFor(() => expect(chrome.permissions.request).toHaveBeenCalled());
    await setImmediate();
    finish();
    await within(second.container as HTMLElement).findByRole('alert');
    expect((await api.getSetup()).copyEnabled).toBe(false);
});
