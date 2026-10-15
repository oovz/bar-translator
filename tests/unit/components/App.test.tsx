import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/preact';
import App from '@/entrypoints/options/App';
import { DEFAULT_PREFERENCES, type StoredApiKeys, type UserPreferences } from '@/src/types';

declare const jsdom: { window: Window };

let storedPreferences: UserPreferences;
let storedKeys: StoredApiKeys;

beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: jsdom.window.localStorage });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: jsdom.window.sessionStorage });
    window.localStorage.clear();
    window.sessionStorage.clear();
    storedPreferences = { ...DEFAULT_PREFERENCES, fallbackOrder: [] };
    storedKeys = { deepl: { key: 'test-key:fx', validated: false, tier: 'free' } };
    vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({ preferences: storedPreferences }));
    vi.mocked(chrome.storage.sync.set).mockImplementation(async items => {
        const { preferences } = items as { preferences?: UserPreferences };
        if (preferences) storedPreferences = structuredClone(preferences);
    });
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ apiKeys_local: structuredClone(storedKeys) }));
    vi.mocked(chrome.storage.local.set).mockImplementation(async items => {
        const { apiKeys_local } = items as { apiKeys_local: StoredApiKeys };
        storedKeys = structuredClone(apiKeys_local);
    });
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
