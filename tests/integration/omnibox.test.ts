/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type StoredApiKeys, type UserPreferences, type CredentialStorageType } from '@/src/types';
import messages from '@/public/_locales/en/messages.json';
import { switchCredentialStorage } from '@/utils/storage';

function event<Args extends unknown[]>() {
    const listeners: ((...args: Args) => unknown)[] = [];
    return {
        addListener: (listener: (...args: Args) => unknown) => listeners.push(listener),
        fire: (...args: Args) => Promise.all(listeners.map(listener => listener(...args))),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function googleResponse(translation: string) {
    return new Response(`<div class="result-container">${translation}</div>`);
}

let preferences: UserPreferences;
let apiKeys: StoredApiKeys;
let syncedApiKeys: StoredApiKeys;
let storageType: CredentialStorageType;
let omnibox: {
    onInputStarted: ReturnType<typeof event<[]>>;
    onInputChanged: ReturnType<typeof event<[string, (suggestions: chrome.omnibox.SuggestResult[]) => void]>>;
    onInputEntered: ReturnType<typeof event<[string, string]>>;
    onInputCancelled: ReturnType<typeof event<[]>>;
    setDefaultSuggestion: ReturnType<typeof vi.fn>;
};
let storageChanged: ReturnType<typeof event<[Record<string, chrome.storage.StorageChange>, string]>>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let copiedText: ReturnType<typeof vi.fn<(text: string) => void>>;
let execCommand: ReturnType<typeof vi.fn<(command: string) => boolean>>;
let sendMessage: ReturnType<typeof vi.fn<(message: unknown) => Promise<unknown>>>;
let permissionAdded: ReturnType<typeof event<[chrome.permissions.Permissions]>>;
let permissionRemoved: ReturnType<typeof event<[chrome.permissions.Permissions]>>;
let installed: ReturnType<typeof event<[chrome.runtime.InstalledDetails]>>;
let suggestions = vi.fn<(suggestions: chrome.omnibox.SuggestResult[]) => void>();

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    preferences = { ...DEFAULT_PREFERENCES, languageOverrides: {} };
    apiKeys = {};
    syncedApiKeys = {};
    storageType = 'local';
    omnibox = {
        onInputStarted: event<[]>(),
        onInputChanged: event<[string, (suggestions: chrome.omnibox.SuggestResult[]) => void]>(),
        onInputEntered: event<[string, string]>(),
        onInputCancelled: event<[]>(),
        setDefaultSuggestion: vi.fn(),
    };
    storageChanged = event<[Record<string, chrome.storage.StorageChange>, string]>();
    permissionAdded = event<[chrome.permissions.Permissions]>();
    permissionRemoved = event<[chrome.permissions.Permissions]>();
    installed = event<[chrome.runtime.InstalledDetails]>();
    suggestions = vi.fn<(suggestions: chrome.omnibox.SuggestResult[]) => void>();
    const onMessage = event<[unknown, chrome.runtime.MessageSender, (response: unknown) => void]>();
    sendMessage = vi.fn(message => new Promise(resolve => {
        void onMessage.fire(message, {}, resolve);
    }));
    const browser = {
        omnibox,
        permissions: {
            contains: vi.fn(async () => true),
            request: vi.fn(async () => true),
            remove: vi.fn(async () => true),
            onAdded: permissionAdded,
            onRemoved: permissionRemoved,
        },
        offscreen: { closeDocument: vi.fn(async () => {}), createDocument: vi.fn(async () => {}), Reason: { CLIPBOARD: 'CLIPBOARD' } },
        storage: {
            sync: {
                get: vi.fn(async () => ({ preferences, apiKeys: structuredClone(syncedApiKeys) })),
                set: vi.fn(async (items: { apiKeys: StoredApiKeys }) => { syncedApiKeys = items.apiKeys; }),
            },
            local: {
                get: vi.fn(async () => ({ apiKeys_local: structuredClone(apiKeys), credentialStorageType: storageType })),
                set: vi.fn(async (items: { credentialStorageType?: CredentialStorageType; apiKeys_local?: StoredApiKeys }) => {
                    if (items.credentialStorageType) storageType = items.credentialStorageType;
                    if (items.apiKeys_local) apiKeys = items.apiKeys_local;
                }),
                remove: vi.fn(async () => { apiKeys = {}; }),
            },
            onChanged: storageChanged,
        },
        runtime: {
            onInstalled: installed,
            openOptionsPage: vi.fn(async () => {}),
            id: 'test-extension', onMessage, sendMessage,
            ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
            getContexts: vi.fn(async () => [{}]),
        },
        i18n: {
            getMessage: (key: keyof typeof messages, substitutions?: string[]) => {
                let message: string = messages[key]?.message ?? key;
                substitutions?.forEach((value, index) => { message = message.replace(`$${index + 1}`, value); });
                return message;
            },
        },
    };
    vi.stubGlobal('browser', browser);
    vi.stubGlobal('chrome', browser);
    vi.stubGlobal('defineBackground', (callback: () => void) => callback);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    copiedText = vi.fn<(text: string) => void>();
    execCommand = vi.fn(() => {
        const textArea = document.querySelector('textarea');
        if (!textArea) throw new Error('No copy selection');
        copiedText(textArea.value);
        return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await import('@/entrypoints/offscreen/main');
    const { default: background } = await import('@/entrypoints/background');
    (background as unknown as () => void)();
    await omnibox.onInputStarted.fire();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function change(text: string) {
    await omnibox.onInputChanged.fire(text, suggestions);
}

function description() {
    return omnibox.setDefaultSuggestion.mock.lastCall?.[0].description as string;
}

describe('allowed translation providers', () => {
    it('sends only provider requests and keeps text, results, keys, and errors out of diagnostics', async () => {
        expect(fetchMock).not.toHaveBeenCalled();
        preferences = { ...preferences, fallbackOrder: ['deepl', 'google-web'] };
        apiKeys = { deepl: { key: 'private-credential:fx', validated: true } };
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ translations: [{
            text: 'private-result', detected_source_language: 'EN',
        }] })));
        await change('fr private-input');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr private-input', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('private-result');

        fetchMock.mockRejectedValueOnce(new Error('private-input private-credential:fx'))
            .mockResolvedValueOnce(new Response('<p>private-response-body</p>'));
        await change('fr private-failure');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain('Error');
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'api-free.deepl.com', 'api-free.deepl.com', 'translate.google.com',
        ]);

        const logs = [console.log, console.warn, console.error].flatMap(log => vi.mocked(log).mock.calls);
        expect(JSON.stringify(logs)).not.toMatch(/private-/);
    });

    it('keeps disable-all after a background restart and resumes only after explicit re-enabling', async () => {
        preferences = { ...preferences, fallbackOrder: [] };
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.omniboxNoProviders.message);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();

        Object.assign(omnibox, {
            onInputStarted: event<[]>(),
            onInputChanged: event<[string, (suggestions: chrome.omnibox.SuggestResult[]) => void]>(),
            onInputEntered: event<[string, string]>(),
            onInputCancelled: event<[]>(),
        });
        vi.resetModules();
        const { default: background } = await import('@/entrypoints/background');
        (background as unknown as () => void)();
        await omnibox.onInputStarted.fire();
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain(messages.omniboxNoProviders.message);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();

        preferences = { ...preferences, fallbackOrder: ['lingva'] };
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ translation: 'Bonjour' })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain('Bonjour');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toBe('https://lingva.ml/api/v1/auto/fr/Hello');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
    });

    it('sends text only to supported selected providers in their explicit order', async () => {
        vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({ preferences: {
            ...preferences, fallbackOrder: ['microsoft', 'lingva', 'google-cloud', 'google-web', 'deepl'],
        } }));
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockResolvedValueOnce(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'lingva.ml', 'translate.google.com',
        ]);
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
    });
});

describe('bounded sequential fallback', () => {
    it('stops after primary success when other allowed providers remain', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva'] };
        fetchMock.mockResolvedValueOnce(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain('Bonjour');
        await vi.advanceTimersByTimeAsync(20000);
        expect(description()).toContain('Bonjour');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
    });

    it('keeps loading through fallback and cancels copying when Enter arrives before completion', async () => {
        preferences = { ...preferences, fallbackOrder: ['lingva', 'google-web'] };
        const fallback = deferred<Response>();
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockReturnValueOnce(fallback.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe(messages.omniboxTranslating.message);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'lingva.ml', 'translate.google.com',
        ]);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock.mock.calls[1]![1]?.signal?.aborted).toBe(true);
        fallback.resolve(googleResponse('Bonjour'));
        await vi.advanceTimersByTimeAsync(20000);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('includes a stalled response body in the provider deadline', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva'] };
        const body = deferred<string>();
        const response = googleResponse('');
        vi.spyOn(response, 'text').mockReturnValue(body.promise);
        fetchMock.mockResolvedValueOnce(response)
            .mockResolvedValueOnce(new Response(JSON.stringify({ translation: 'Bonjour' })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(4000);
        expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
        expect(description()).toContain('Bonjour');
        body.resolve('<div class="result-container">Late body</div>');
        await vi.advanceTimersByTimeAsync(0);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['clear', 'cancel', 'restart'])('stops a pending fallback after %s', async action => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva', 'deepl'] };
        apiKeys = { deepl: { key: 'fixture:fx', validated: true, tier: 'free' } };
        const fallback = deferred<Response>();
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockReturnValueOnce(fallback.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        if (action === 'clear') await change('');
        if (action === 'cancel') await omnibox.onInputCancelled.fire();
        if (action === 'restart') await omnibox.onInputStarted.fire();
        expect(fetchMock.mock.calls[1]![1]?.signal?.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(20000);
        fallback.reject(new Error('Late failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'translate.google.com', 'lingva.ml',
        ]);
        expect(description()).toBe(messages.omniboxSuggestion.message);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('skips missing credentials and sends text only to the next allowed provider', async () => {
        preferences = { ...preferences, fallbackOrder: ['deepl', 'lingva'] };
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ translation: 'Bonjour' })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain('Bonjour');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(20000);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['lingva.ml']);
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
    });

    it('shows unavailable credentials without making a request or changing the clipboard', async () => {
        preferences = { ...preferences, fallbackOrder: ['deepl'] };
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(20000);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain(messages.providerMissingKey.message);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('shows the final failure after each allowed provider fails once', async () => {
        preferences = { ...preferences, fallbackOrder: ['lingva', 'google-web'] };
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockRejectedValueOnce(new Error('Offline'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(20000);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain(messages.providerNetworkError.message);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'lingva.ml', 'translate.google.com',
        ]);
        expect(copiedText).not.toHaveBeenCalled();
        expect(execCommand).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a response completed beyond the deadline before the timer callback runs', async () => {
        const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
        const response = deferred<Response>();
        fetchMock.mockReturnValue(response.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        clock.mockReturnValue(11000);
        response.resolve(googleResponse('Too late'));
        await vi.advanceTimersByTimeAsync(0);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain('Translation timed out');
        expect(copiedText).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('limits all preview attempts to ten seconds and preserves the clipboard on timeout', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva', 'deepl'] };
        apiKeys = { deepl: { key: 'fixture:fx', validated: true, tier: 'free' } };
        fetchMock.mockImplementation(() => new Promise(() => {}));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await vi.advanceTimersByTimeAsync(3999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(4000);
        expect(fetchMock.mock.calls[1]![1]?.signal?.aborted).toBe(true);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'translate.google.com', 'lingva.ml', 'api-free.deepl.com',
        ]);
        await vi.advanceTimersByTimeAsync(1999);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock.mock.calls[2]![1]?.signal?.aborted).toBe(true);
        expect(description()).toContain('Translation timed out');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        expect(execCommand).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20000);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('aborts a hung primary after four seconds and copies the allowed fallback', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva'] };
        const primary = deferred<Response>();
        fetchMock.mockReturnValueOnce(primary.promise)
            .mockResolvedValueOnce(new Response(JSON.stringify({ translation: 'Bonjour' })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const primarySignal = fetchMock.mock.calls[0]![1]?.signal;
        await vi.advanceTimersByTimeAsync(3999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(primarySignal?.aborted).toBe(true);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
            'translate.google.com', 'lingva.ml',
        ]);
        expect(description()).toContain('Bonjour');
        primary.resolve(googleResponse('Late primary'));
        await vi.advanceTimersByTimeAsync(0);
        expect(description()).toContain('Bonjour');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('current omnibox translation', () => {
    it('keeps the latest preview and copy when responses complete in reverse order', async () => {
        const older = deferred<Response>();
        const newer = deferred<Response>();
        fetchMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await change('fr Goodbye');
        await vi.advanceTimersByTimeAsync(300);
        newer.resolve(googleResponse('Au revoir'));
        await vi.advanceTimersByTimeAsync(0);
        older.resolve(googleResponse('Bonjour'));
        await vi.advanceTimersByTimeAsync(0);
        expect(description()).toContain('Au revoir');
        await omnibox.onInputEntered.fire('fr Goodbye', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Au revoir');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('copying completed previews', () => {
    it('copies a matching completed preview once when cancellation precedes Enter', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['clear', 'edit', 'restart'])('discards a retained completed preview on %s', async action => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        if (action === 'clear') await change('');
        if (action === 'edit') await change('fr Goodbye');
        if (action === 'restart') await omnibox.onInputStarted.fire();
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a retained completed preview when stored language settings change before Enter', async () => {
        preferences = { ...preferences, defaultTargetLang: 'fr' };
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        preferences = { ...preferences, defaultTargetLang: 'es' };
        await omnibox.onInputEntered.fire('Hello', 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('discards a retained completed preview when credential storage selection changes', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        storageType = 'sync';
        await storageChanged.fire({ credentialStorageType: { oldValue: 'local', newValue: 'sync' } }, 'local');
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('discards preview preparation that finishes reading settings after Enter', async () => {
        const keys = deferred<Record<string, unknown>>();
        vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => keys.promise);
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe(messages.omniboxTranslating.message);
        await omnibox.onInputEntered.fire('Hello', 'currentTab');
        keys.resolve({});
        await vi.advanceTimersByTimeAsync(20000);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('preserves the clipboard and cancels the scheduled preview on Enter before the pause', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(299);
        expect(description()).toBe(messages.omniboxTranslating.message);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(20000);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('keeps the clipboard unchanged when Enter is pressed while the preview is loading', async () => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValue(pending.promise);
        await change('fr Hello');
        expect(description()).toBe(messages.omniboxTranslating.message);
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe(messages.omniboxTranslating.message);
        const submitted = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        pending.resolve(googleResponse('Bonjour'));
        await submitted;
        await vi.advanceTimersByTimeAsync(20000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(execCommand).not.toHaveBeenCalled();
        expect(description()).toBe(messages.omniboxTranslating.message);
        expect(omnibox.setDefaultSuggestion).not.toHaveBeenCalledWith(
            expect.objectContaining({ description: expect.stringContaining('Error:') })
        );
    });

    it('preserves the clipboard when Enter input differs from the completed preview', async () => {
        fetchMock.mockResolvedValueOnce(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Goodbye', 'currentTab');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it.each(['pending', 'complete'])('rejects a %s translation when language defaults change before Enter', async state => {
        const older = deferred<Response>();
        fetchMock.mockReturnValueOnce(older.promise).mockResolvedValueOnce(googleResponse('Hola'));
        preferences = { ...preferences, defaultTargetLang: 'fr' };
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        if (state === 'complete') {
            older.resolve(googleResponse('Bonjour'));
            await vi.advanceTimersByTimeAsync(0);
        }
        // Enter re-reads storage even when its change event has not arrived yet.
        preferences = { ...preferences, defaultTargetLang: 'es' };
        await omnibox.onInputEntered.fire('Hello', 'currentTab');
        older.resolve(googleResponse('Bonjour'));
        await vi.advanceTimersByTimeAsync(0);
        expect(copiedText).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['providers', 'credentials'])('rejects a ready preview after %s change before the storage event arrives', async setting => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        if (setting === 'providers') preferences = { ...preferences, fallbackOrder: [] };
        else apiKeys = { deepl: { key: 'replacement:fx', validated: true } };
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('preserves explicit source syntax, automatic source detection, and regional overrides', async () => {
        preferences = { ...preferences, defaultTargetLang: 'zh-TW', languageOverrides: { zh: 'zh-TW' } };
        fetchMock.mockImplementation(async () => googleResponse('你好'));
        await change('en>zh Hello');
        await vi.advanceTimersByTimeAsync(300);
        let url = new URL(String(fetchMock.mock.lastCall?.[0]));
        expect(url.searchParams.get('sl')).toBe('en');
        expect(url.searchParams.get('tl')).toBe('zh-TW');
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        url = new URL(String(fetchMock.mock.lastCall?.[0]));
        expect(url.searchParams.get('sl')).toBe('auto');
        expect(url.searchParams.get('tl')).toBe('zh-TW');
    });

    it('copies a completed preview once when Enter repeats during clipboard preparation', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const copy = deferred<void>();
        const deliver = sendMessage.getMockImplementation()!;
        sendMessage.mockImplementationOnce(async message => { await copy.promise; return deliver(message); });
        const first = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(0);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        copy.resolve();
        await first;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
    });
});

describe('interaction invalidation', () => {
    it.each(['clear', 'cancel', 'restart'])('invalidates pending work on %s even if the network ignores cancellation', async action => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValue(pending.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const signal = fetchMock.mock.calls[0]![1]?.signal;
        if (action === 'clear') await change('');
        if (action === 'cancel') await omnibox.onInputCancelled.fire();
        if (action === 'restart') await omnibox.onInputStarted.fire();
        expect(signal?.aborted).toBe(true);
        pending.resolve(googleResponse('Bonjour'));
        await vi.advanceTimersByTimeAsync(0);
        expect(description()).toBe(messages.omniboxSuggestion.message);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('requires a fresh completed preview after an interaction ends with identical input', async () => {
        fetchMock.mockResolvedValueOnce(googleResponse('Bonjour')).mockResolvedValueOnce(googleResponse('Salut'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        await omnibox.onInputStarted.fire();
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
        await omnibox.onInputStarted.fire();
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Salut');
    });

    it('does not copy a ready preview after a new interaction starts during settings validation', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const keys = deferred<Record<string, unknown>>();
        vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => keys.promise);
        const submitted = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(0);
        await omnibox.onInputStarted.fire();
        keys.resolve({});
        await submitted;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(description()).toBe(messages.omniboxSuggestion.message);
    });

    it('prevents a cancelled provider failure from sending text to fallback providers', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva'] };
        const pending = deferred<Response>();
        fetchMock.mockReturnValue(pending.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        pending.reject(new Error('network failure'));
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('refreshes the preview when language settings change during a request', async () => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(googleResponse('Hola'));
        preferences = { ...preferences, defaultTargetLang: 'fr' };
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        const previous = preferences;
        preferences = { ...preferences, defaultTargetLang: 'es' };
        await storageChanged.fire({ preferences: { oldValue: previous, newValue: preferences } }, 'sync');
        pending.resolve(googleResponse('Bonjour'));
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain('Hola');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await omnibox.onInputEntered.fire('Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Hola');
    });

    it('does not let old copy feedback reset a new preview', async () => {
        fetchMock.mockResolvedValueOnce(googleResponse('Bonjour')).mockResolvedValueOnce(googleResponse('Au revoir'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await omnibox.onInputStarted.fire();
        await change('fr Goodbye');
        await vi.advanceTimersByTimeAsync(3000);
        expect(description()).toContain('Au revoir');
    });

    it.each(['', 'fr', 'en>fr'])('shows help and makes no request for input %j', async input => {
        await change(input);
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire(input, 'currentTab');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
        expect(description()).toBe(messages.omniboxSuggestion.message);
    });
});

describe('copy confirmation and failure feedback', () => {
    it('cancels a submitted copy that is still preparing the offscreen document', async () => {
        const contexts = deferred<chrome.runtime.ExtensionContext[]>();
        vi.mocked(chrome.runtime.getContexts).mockImplementationOnce(() => contexts.promise);
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const submitted = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(0);
        await omnibox.onInputStarted.fire();
        contexts.resolve([{ contextType: 'OFFSCREEN_DOCUMENT' } as chrome.runtime.ExtensionContext]);
        await submitted;
        expect(sendMessage).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('does not retry or copy a failed preview on Enter', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Temporary failure'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.providerNetworkError.message);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('shows translation failure and leaves the clipboard unchanged', async () => {
        fetchMock.mockRejectedValue(new Error('Provider unavailable'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain('Error:');
        expect(description()).toContain(messages.providerNetworkError.message);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('replaces a completed preview with failure feedback when the input changes', async () => {
        fetchMock.mockResolvedValueOnce(googleResponse('Bonjour')).mockRejectedValueOnce(new Error('Provider unavailable'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await change('fr Goodbye');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Goodbye', 'currentTab');
        expect(description()).toContain(messages.providerNetworkError.message);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('reports success only after the offscreen document confirms copying', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        const copy = deferred<void>();
        const deliver = sendMessage.getMockImplementation()!;
        sendMessage.mockImplementationOnce(async message => { await copy.promise; return deliver(message); });
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const submitted = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(0);
        expect(description()).not.toContain('Copied:');
        copy.resolve();
        await submitted;
        expect(description()).toContain('Copied:');
        expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    });

    it('confirms DOM copying and removes the selected text area', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        execCommand.mockReturnValue(true);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
        expect(description()).toContain('Copied:');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it.each(['false', 'throw'])('shows copy failure when DOM copy returns %s', async failure => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        if (failure === 'false') execCommand.mockReturnValue(false);
        else execCommand.mockImplementation(() => { throw new Error('Copy denied'); });
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputCancelled.fire();
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain(messages.omniboxCopyFailed.message);
        expect(description()).not.toContain('Copied:');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('shows message failure as a copy failure', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        sendMessage.mockRejectedValue(new Error('Offscreen unavailable'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(description()).toContain(messages.omniboxCopyFailed.message);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('escapes copied text in the success suggestion', async () => {
        fetchMock.mockResolvedValue(googleResponse('&lt;Bonjour&gt; &amp; salut'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('<Bonjour> & salut');
        expect(description()).toContain('&lt;Bonjour&gt; &amp; salut');
    });
});


describe('translation after credential storage changes', () => {
    it.each(['success', 'destination', 'selection', 'cleanup'])('can translate and copy after a storage switch with %s outcome', async outcome => {
        preferences = { ...preferences, fallbackOrder: ['deepl'] };
        apiKeys = { deepl: { key: 'configured-key:fx', validated: true, tier: 'free' } };
        if (outcome === 'destination') vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('Write failed'));
        if (outcome === 'selection') vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Write failed'));
        if (outcome === 'cleanup') vi.mocked(chrome.storage.local.remove).mockRejectedValueOnce(new Error('Cleanup failed'));
        if (outcome === 'success') await switchCredentialStorage('sync');
        else await expect(switchCredentialStorage('sync')).rejects.toThrow();
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ translations: [{ text: 'Bonjour', detected_source_language: 'EN' }] })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
        expect(fetchMock).toHaveBeenCalledWith('https://api-free.deepl.com/v2/translate', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'DeepL-Auth-Key configured-key:fx' }),
        }));
    });

    it('invalidates a ready copy when credential storage changes during settings validation', async () => {
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const keys = deferred<Record<string, unknown>>();
        vi.mocked(chrome.storage.local.get).mockImplementationOnce(() => keys.promise);
        const submitted = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(0);
        await storageChanged.fire({ credentialStorageType: { oldValue: 'local', newValue: 'sync' } }, 'local');
        keys.resolve({});
        await submitted;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

function suggestionRows(): chrome.omnibox.SuggestResult[] {
    return suggestions.mock.lastCall?.[0] ?? [];
}

describe('optional access and omnibox actions', () => {
    it('reports a preview storage failure as a translation error without exposing internal details', async () => {
        vi.mocked(chrome.storage.sync.get).mockRejectedValueOnce(new Error('Internal storage details'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.omniboxAllFailed.message);
        expect(description()).not.toContain(messages.omniboxCopyFailed.message);
        expect(description()).not.toContain('Internal storage details');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps translation text alone and copies the result when its separate action is selected', async () => {
        fetchMock.mockResolvedValue(googleResponse('&lt;Bonjour&gt; &amp; salut'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe('<match>&lt;Bonjour&gt; &amp; salut</match>');
        const [copy] = suggestionRows();
        expect(suggestions).toHaveBeenCalledTimes(1);
        expect(copy?.content).toBe(messages.omniboxCopyAction.message);
        expect(copy?.description).toContain(messages.omniboxCopyAction.message);
        expect(copy?.description).not.toContain('Bonjour');
        await omnibox.onInputCancelled.fire();
        await omnibox.onInputEntered.fire(copy!.content, 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('<Bonjour> & salut');
    });

    it('leaves preview-only copying off and offers a separate settings action', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async query => !query.permissions);
        fetchMock.mockImplementation(async () => googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe('<match>Bonjour</match>');
        expect(suggestionRows()[0]?.description).toContain(messages.omniboxCopyOff.message);
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        await omnibox.onInputEntered.fire(suggestionRows()[0]!.content, 'currentTab');
        expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('shows missing access without sending text or prompting, and Enter on the error opens settings', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.providerPermissionRequired.message);
        expect(suggestionRows()[0]?.description).toContain(messages.omniboxSettingsAction.message);
        expect(suggestions).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        await omnibox.onInputCancelled.fire();
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('keeps a successful fallback primary and puts missing access in a selectable warning', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva'] };
        vi.mocked(chrome.permissions.contains).mockImplementation(async query => !query.origins);
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ translation: 'Bonjour' })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe('<match>Bonjour</match>');
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['lingva.ml']);
        const warning = suggestionRows().find(row => row.description.includes(messages.providerPermissionRequired.message));
        expect(warning?.description).toContain('Warning: Google Translate (Web)');
        await omnibox.onInputEntered.fire(warning!.content, 'currentTab');
        expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('keeps malformed provider data out of the preview and copies only an allowed fallback', async () => {
        preferences = { ...preferences, fallbackOrder: ['lingva', 'google-web'] };
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            translation: { text: 'malformed-private-payload' },
        }))).mockResolvedValueOnce(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);

        expect(description()).toBe('<match>Bonjour</match>');
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname))
            .toEqual(['lingva.ml', 'translate.google.com']);
        const warning = suggestionRows().find(row => row.description.includes(messages.providerUnavailable.message));
        expect(warning?.description).toContain('Warning: Lingva');
        expect(JSON.stringify(suggestionRows())).not.toContain('malformed-private-payload');
        expect(copiedText).not.toHaveBeenCalled();
        await omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Bonjour');
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('malformed-private-payload');
    });

    it('attempts an untested key and reports rejection separately from a successful fallback', async () => {
        preferences = { ...preferences, fallbackOrder: ['deepl', 'lingva'] };
        apiKeys = { deepl: { key: 'untested:fx', validated: false } };
        fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ translation: 'Bonjour' })));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe('<match>Bonjour</match>');
        expect(suggestionRows().some(row => row.description.includes(messages.providerInvalidKey.message))).toBe(true);
        expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v2/translate', '/api/v1/auto/fr/Hello']);
        expect(apiKeys.deepl?.validated).toBe(false);
    });

    it('does not open settings for a temporary network failure or its warning', async () => {
        preferences = { ...preferences, fallbackOrder: ['google-web', 'lingva'] };
        fetchMock.mockRejectedValue(new Error('Sensitive provider response'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.providerNetworkError.message);
        expect(description()).not.toContain('Sensitive');
        const warning = suggestionRows()[0];
        expect(warning?.description).not.toContain(messages.omniboxSettingsAction.message);
        await omnibox.onInputEntered.fire(warning!.content, 'currentTab');
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
    });

    it.each(['copy', 'settings'])('rejects stale %s actions after the input changes', async kind => {
        if (kind === 'settings') vi.mocked(chrome.permissions.contains).mockImplementation(async query => !query.permissions);
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const oldAction = suggestionRows()[0]!.content;
        await change('fr Goodbye');
        await omnibox.onInputEntered.fire(oldAction, 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
    });

    it('does not treat typed action-like text as an issued settings action', async () => {
        await change('bar-translator:settings');
        await omnibox.onInputEntered.fire('bar-translator:settings', 'currentTab');
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('aborts in-flight text on revocation and replaces it with an actionable missing-access error', async () => {
        const pending = deferred<Response>();
        fetchMock.mockReturnValueOnce(pending.promise);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const signal = fetchMock.mock.calls[0]![1]?.signal;
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        await permissionRemoved.fire({ origins: ['https://translate.google.com/*'] });
        expect(signal?.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.providerPermissionRequired.message);
        pending.resolve(googleResponse('Obsolete result'));
        await vi.advanceTimersByTimeAsync(0);
        expect(description()).not.toContain('Obsolete');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(chrome.permissions.request).not.toHaveBeenCalled();
    });

    it('invalidates a submitted copy when clipboard access is revoked during preparation', async () => {
        const contexts = deferred<chrome.runtime.ExtensionContext[]>();
        vi.mocked(chrome.runtime.getContexts).mockImplementationOnce(() => contexts.promise);
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        const entered = omnibox.onInputEntered.fire('fr Hello', 'currentTab');
        await vi.advanceTimersByTimeAsync(0);
        vi.mocked(chrome.permissions.contains).mockImplementation(async query => !query.permissions);
        await permissionRemoved.fire({ permissions: ['clipboardWrite'] });
        contexts.resolve([]);
        await entered;
        expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
    });

    it('refreshes a completed missing-access preview on the next input after access is granted elsewhere', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toContain(messages.providerPermissionRequired.message);
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        await permissionAdded.fire({ origins: ['https://translate.google.com/*'] });
        expect(fetchMock).not.toHaveBeenCalled();
        await change('fr Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe('<match>Bonjour</match>');
    });

    it('never copies a new invisible result behind rows already delivered to Chrome', async () => {
        fetchMock.mockResolvedValueOnce(googleResponse('Bonjour')).mockResolvedValueOnce(googleResponse('Hola'));
        preferences = { ...preferences, defaultTargetLang: 'fr' };
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        const oldCopy = suggestionRows()[0]!.content;
        const previous = preferences;
        preferences = { ...preferences, defaultTargetLang: 'es' };
        await storageChanged.fire({ preferences: { oldValue: previous, newValue: preferences } }, 'sync');
        await vi.advanceTimersByTimeAsync(300);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await omnibox.onInputEntered.fire(oldCopy, 'currentTab');
        expect(copiedText).not.toHaveBeenCalled();
        await change('Hello');
        await vi.advanceTimersByTimeAsync(300);
        expect(description()).toBe('<match>Hola</match>');
        await omnibox.onInputEntered.fire('Hello', 'currentTab');
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Hola');
    });

    it('releases a provider grant when its synced selection is disabled', async () => {
        const previous = { ...preferences, fallbackOrder: ['google-web', 'deepl'] };
        await storageChanged.fire({ preferences: { oldValue: previous, newValue: preferences } }, 'sync');
        expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
    });

    it('opens setup on installation and leaves updates untouched', async () => {
        await installed.fire({ reason: 'install' });
        expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
        vi.mocked(chrome.runtime.openOptionsPage).mockClear();
        await installed.fire({ reason: 'update', previousVersion: '1.1.0' });
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(chrome.permissions.remove).not.toHaveBeenCalled();
    });
});

describe('remaining access cleanup', () => {
    it('releases the remaining copy permission when only clipboardWrite is revoked', async () => {
        const remaining = new Set(['offscreen']);
        vi.mocked(chrome.permissions.contains).mockImplementation(async query => (query.permissions ?? []).every(permission => remaining.has(permission)));
        vi.mocked(chrome.permissions.remove).mockImplementation(async query => {
            query.permissions?.forEach(permission => remaining.delete(permission));
            return true;
        });
        await permissionRemoved.fire({ permissions: ['clipboardWrite'] });
        expect(chrome.offscreen.closeDocument).toHaveBeenCalledTimes(1);
        expect(chrome.permissions.remove).toHaveBeenCalledWith({ permissions: ['clipboardWrite', 'offscreen'] });
        expect(remaining.size).toBe(0);
    });

    it('keeps action labels readable and distinct when the user translates the same words', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async query => !query.permissions);
        fetchMock.mockResolvedValue(googleResponse('Bonjour'));
        const input = messages.omniboxCopyOff.message;
        await change(input);
        await vi.advanceTimersByTimeAsync(300);
        expect(suggestionRows()[0]?.content).toBe(`${messages.extName.message}: ${input}`);
        await omnibox.onInputEntered.fire(input, 'currentTab');
        expect(chrome.runtime.openOptionsPage).not.toHaveBeenCalled();
        expect(copiedText).not.toHaveBeenCalled();
    });
});

describe('offscreen document creation', () => {
    it('shares pending creation while a cancelled copy yields to the next copy', async () => {
        const { copyToClipboard } = await import('@/utils/clipboard');
        const creation = deferred<void>();
        vi.mocked(chrome.runtime.getContexts).mockImplementation(async () => []);
        vi.mocked(chrome.offscreen.createDocument).mockImplementation(() => creation.promise);
        const controller = new AbortController();
        const cancelled = copyToClipboard('Old result', controller.signal);
        await vi.advanceTimersByTimeAsync(0);
        controller.abort();
        const next = copyToClipboard('Current result');
        await vi.advanceTimersByTimeAsync(0);
        expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
        expect(sendMessage).not.toHaveBeenCalled();
        creation.resolve();
        expect(await cancelled).toBe(false);
        expect(await next).toBe(true);
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Current result');
    });

    it('reports failed creation and allows a later explicit copy to create the document', async () => {
        const { copyToClipboard } = await import('@/utils/clipboard');
        vi.mocked(chrome.runtime.getContexts).mockImplementation(async () => []);
        vi.mocked(chrome.offscreen.createDocument).mockRejectedValueOnce(new Error('Creation failed'));
        expect(await copyToClipboard('First result')).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(await copyToClipboard('Next result')).toBe(true);
        expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(2);
        expect(copiedText).toHaveBeenCalledExactlyOnceWith('Next result');
    });
});
