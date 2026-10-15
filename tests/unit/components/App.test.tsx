import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/preact';
import App from '@/entrypoints/options/App';
import { DEFAULT_PREFERENCES, type StoredApiKeys, type UserPreferences, type CredentialStorageType } from '@/src/types';

declare const jsdom: { window: Window };

let storedPreferences: UserPreferences;
let storedKeys: StoredApiKeys;
let syncedKeys: StoredApiKeys;
let storageType: CredentialStorageType;

beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: jsdom.window.localStorage });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: jsdom.window.sessionStorage });
    window.localStorage.clear();
    window.sessionStorage.clear();
    storedPreferences = { ...DEFAULT_PREFERENCES, fallbackOrder: [] };
    storedKeys = { deepl: { key: 'test-key:fx', validated: false, tier: 'free' } };
    syncedKeys = {};
    storageType = 'local';
    vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({ preferences: storedPreferences, apiKeys: structuredClone(syncedKeys) }));
    vi.mocked(chrome.storage.sync.set).mockImplementation(async items => {
        const { preferences } = items as { preferences?: UserPreferences };
        if (preferences) storedPreferences = structuredClone(preferences);
        if ('apiKeys' in items) syncedKeys = structuredClone(items.apiKeys as StoredApiKeys);
    });
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ apiKeys_local: structuredClone(storedKeys), credentialStorageType: storageType }));
    vi.mocked(chrome.storage.local.set).mockImplementation(async items => {
        const { apiKeys_local } = items as { apiKeys_local: StoredApiKeys };
        if (apiKeys_local) storedKeys = structuredClone(apiKeys_local);
        if ('credentialStorageType' in items) storageType = items.credentialStorageType as CredentialStorageType;
    });
    vi.mocked(chrome.storage.local.remove).mockImplementation(async () => { storedKeys = {}; });
});

afterEach(() => vi.restoreAllMocks());

describe('provider settings', () => {
    it('clears obsolete analytics browser storage and preserves unrelated data when settings open', async () => {
        const token = 'phc_yI0ofU7zKrbDyBlCEwGTfsT5EkfcGnmmUE2XRewGg3h';
        const keys = [
            `ph_${token}_posthog`, `__ph_opt_in_out_${token}`,
            `ph_${token}_window_id`, `ph_${token}_primary_window_exists`,
        ];
        for (const storage of [window.localStorage, window.sessionStorage]) {
            for (const key of keys) storage.setItem(key, 'obsolete-identity');
            storage.setItem('unrelated', 'preserved');
        }

        const view = render(<App />);
        await view.findByText('privacyDesc');

        for (const storage of [window.localStorage, window.sessionStorage]) {
            for (const key of keys) expect(storage.getItem(key)).toBeNull();
            expect(storage.getItem('unrelated')).toBe('preserved');
            storage.clear();
        }
    });

    it('preserves disable-all across settings visits and allows re-enabling a provider', async () => {
        const first = render(<App />);
        await first.findByText('noServicesEnabled');
        await waitFor(() => expect(storedPreferences.fallbackOrder).toEqual([]));
        first.unmount();

        const reopened = render(<App />);
        await reopened.findByText('noServicesEnabled');
        const lingva = reopened.getByText('Lingva (Google Proxy)').closest('li')!;
        fireEvent.click(within(lingva).getByTitle('Enable service'));
        await waitFor(() => expect(storedPreferences.fallbackOrder).toEqual(['lingva']));
        reopened.unmount();

        const enabled = render(<App />);
        await enabled.findByText('primary');
        expect(enabled.queryByText('noServicesEnabled')).toBeNull();
        fireEvent.click(enabled.getByTitle('Disable service'));
        await enabled.findByText('noServicesEnabled');
        await waitFor(() => expect(storedPreferences.fallbackOrder).toEqual([]));
    });

    it('offers exactly the implemented providers', async () => {
        const view = render(<App />);
        await view.findByText('Google Translate (Web)');
        expect(Array.from(view.container.querySelectorAll('.service-name'), node => node.textContent)).toEqual([
            'Google Translate (Web)', 'Lingva (Google Proxy)', 'DeepL',
        ]);
    });

    it('validates a DeepL key without enabling a disabled provider', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ character_count: 0, character_limit: 500000 })));
        vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
        const view = render(<App />);
        await view.findByText('DeepL');
        fireEvent.click(view.getByText('API Key'));
        fireEvent.click(view.getByText('Test'));
        await view.findByText('valid');
        expect(storedKeys.deepl?.validated).toBe(true);
        expect(storedPreferences.fallbackOrder).toEqual([]);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://api-free.deepl.com/v2/usage', {
            method: 'GET', headers: { Authorization: 'DeepL-Auth-Key test-key:fx' },
        });
    });

    it('shows a validation save error and leaves the provider disabled', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
        vi.mocked(chrome.storage.local.set).mockImplementationOnce(async () => { throw new Error('Unable to save validation'); });
        const view = render(<App />);
        await view.findByText('DeepL');
        fireEvent.click(view.getByText('API Key'));
        fireEvent.click(view.getByText('Test'));
        await view.findByText('Unable to save validation');
        expect(view.queryByText('valid')).toBeNull();
        expect(storedKeys.deepl?.validated).toBe(false);
        expect(storedPreferences.fallbackOrder).toEqual([]);
    });

    it.each(['rejected', 'offline'])('reports %s credentials without validating or enabling DeepL', async failure => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        if (failure === 'rejected') {
            fetchMock.mockResolvedValue(new Response('', { status: 403, statusText: 'Forbidden' }));
        } else {
            fetchMock.mockRejectedValue(new Error('Network unavailable'));
        }
        const view = render(<App />);
        await view.findByText('DeepL');
        fireEvent.click(view.getByText('API Key'));
        fireEvent.click(view.getByText('Test'));
        await view.findByText(failure === 'rejected' ? 'Validation failed: Forbidden' : 'Network unavailable');
        expect(storedKeys.deepl?.validated).toBe(false);
        expect(storedPreferences.fallbackOrder).toEqual([]);
        expect(view.queryByText('valid')).toBeNull();
    });

    it('does not validate a replacement key when an earlier key check completes', async () => {
        let finish!: (response: Response) => void;
        vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const view = render(<App />);
        await view.findByText('DeepL');
        fireEvent.click(view.getByText('API Key'));
        fireEvent.click(view.getByText('Test'));
        await view.findByText('checking');
        storedKeys = { deepl: { key: 'replacement-key:fx', validated: false, tier: 'free' } };
        finish(new Response('{}'));
        await view.findByText('API key changed. Test the current key again.');
        expect(storedKeys.deepl?.key).toBe('replacement-key:fx');
        expect(storedKeys.deepl?.validated).toBe(false);
        expect(storedPreferences.fallbackOrder).toEqual([]);
    });
});


describe('credential storage settings', () => {
    it.each(['destination', 'selection', 'cleanup'])('shows the committed selection after %s failure and recovers on retry', async failure => {
        if (failure === 'destination') vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('Write failed'));
        if (failure === 'selection') vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Write failed'));
        if (failure === 'cleanup') vi.mocked(chrome.storage.local.remove).mockRejectedValueOnce(new Error('Cleanup failed'));
        const view = render(<App />);
        await view.findByText('privacyDesc');
        fireEvent.click(view.getByText('API Key'));
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        const keyInput = view.container.querySelector('input[type="password"]') as HTMLInputElement;
        fireEvent.change(select, { target: { value: 'sync' } });
        await view.findByRole('alert');
        expect(select.value).toBe(failure === 'cleanup' ? 'sync' : 'local');
        expect(keyInput.value).toBe('test-key:fx');
        fireEvent.click(view.getByText('retry'));
        await waitFor(() => {
            expect(view.queryByRole('alert')).toBeNull();
            expect(select.value).toBe('sync');
        });
        expect(storageType).toBe('sync');
        expect(storedKeys).toEqual({});
        expect(syncedKeys.deepl?.key).toBe('test-key:fx');
        expect(storedPreferences).toEqual({ ...DEFAULT_PREFERENCES, fallbackOrder: [] });
        view.unmount();
        const reopened = render(<App />);
        await reopened.findByText('privacyDesc');
        expect((reopened.getByLabelText('labelStorage') as HTMLSelectElement).value).toBe('sync');
        fireEvent.click(reopened.getByText('API Key'));
        expect((reopened.container.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('test-key:fx');
    });

    it('shows the committed storage selection when refreshing its keys fails and can retry', async () => {
        vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async items => {
            syncedKeys = (items as { apiKeys: StoredApiKeys }).apiKeys;
            vi.mocked(chrome.storage.sync.get).mockRejectedValueOnce(new Error('Read failed'));
        });
        const view = render(<App />);
        await view.findByText('privacyDesc');
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'sync' } });
        await view.findByRole('alert');
        expect(storageType).toBe('sync');
        expect(select.value).toBe('sync');
        expect(storedKeys).toEqual({});
        fireEvent.click(view.getByText('retry'));
        await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
        expect(select.value).toBe('sync');
        expect(syncedKeys.deepl?.key).toBe('test-key:fx');
    });

    it('waits for storage completion before showing success or enabling key editing', async () => {
        let finish!: () => void;
        const pending = new Promise<void>(resolve => { finish = resolve; });
        vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async items => {
            await pending;
            syncedKeys = (items as { apiKeys: StoredApiKeys }).apiKeys;
        });
        const view = render(<App />);
        await view.findByText('privacyDesc');
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'sync' } });
        await waitFor(() => expect(select.disabled).toBe(true));
        expect(select.value).toBe('local');
        expect(view.container.querySelector('fieldset')?.disabled).toBe(true);
        finish();
        await waitFor(() => {
            expect(select.value).toBe('sync');
            expect(select.disabled).toBe(false);
        });
        expect(view.container.querySelector('fieldset')?.disabled).toBe(false);
    });
});
