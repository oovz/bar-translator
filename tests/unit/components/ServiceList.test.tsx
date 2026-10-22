/** @vitest-environment jsdom */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/preact';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { DEFAULT_PREFERENCES } from '@/src/types';
import type { PreferenceUpdate } from '@/entrypoints/options/hooks/usePreferences';
import type { TranslationService, UserPreferences } from '@/src/types';

// Mock SortableJS since it needs DOM access
vi.mock('sortablejs', () => ({
    default: {
        create: vi.fn(() => ({
            destroy: vi.fn(),
        })),
    },
}));

describe('ServiceList Component', () => {
    let savedPreferences: UserPreferences;
    beforeEach(() => {
        vi.clearAllMocks();
        savedPreferences = { ...DEFAULT_PREFERENCES, fallbackOrder: [...DEFAULT_PREFERENCES.fallbackOrder] };
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        vi.mocked(chrome.permissions.request).mockImplementation(async () => true);
    });
    const mockServices: TranslationService[] = [
        {
            id: 'google-web',
            name: 'Google Translate (Web)',
            type: 'web',
            requiresApiKey: false,
            authMethod: 'none',
            httpMethod: 'GET',
        },
        {
            id: 'deepl',
            name: 'DeepL',
            type: 'api',
            requiresApiKey: true,
            authMethod: 'header-auth-key',
            httpMethod: 'POST',
        },
    ];

    const mockProps = {
        services: mockServices,
        preferences: DEFAULT_PREFERENCES,
        apiKeys: {}, // StoredApiKeys
        updatePreferences: vi.fn(async (update: PreferenceUpdate) => {
            const patch = typeof update === 'function' ? update(savedPreferences) : update;
            savedPreferences = { ...savedPreferences, ...patch };
            return true;
        }),
        saveApiKey: vi.fn(),
        updateKeyValidation: vi.fn(),
    };

    it('enabling DeepL requests both domains before saving, even without a key', async () => {
        const { getAllByTitle } = render(<ServiceList {...mockProps} />);
        const enableButtons = getAllByTitle('Enable service');
        fireEvent.click(enableButtons[0]!);

        expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
        await waitFor(() => expect(savedPreferences.fallbackOrder).toEqual(['google-web', 'deepl']));
    });

    it('shows api key input when expanded', () => {
        const { getAllByText, getByPlaceholderText } = render(<ServiceList {...mockProps} />);
        const apiKeyButtons = getAllByText('apiKeyLabel');
        fireEvent.click(apiKeyButtons[0]!); // Expand DeepL

        expect(getByPlaceholderText('enterApiKey')).toBeTruthy();
    });
    it('keeps a denied provider disabled and preserves the error after access refresh', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => false);
        const view = render(<ServiceList {...mockProps} />);
        fireEvent.click(view.getByTitle('Enable service'));
        await view.findByRole('alert');
        expect(mockProps.updatePreferences).not.toHaveBeenCalled();
        const listener = vi.mocked(chrome.permissions.onAdded.addListener).mock.calls.at(-1)![0];
        listener({});
        await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    });

    it('treats an unvalidated nonempty key as ready and disables testing after access revocation', async () => {
        const props = { ...mockProps, preferences: { ...DEFAULT_PREFERENCES, fallbackOrder: ['deepl'] as const }, apiKeys: { deepl: { key: 'untested', validated: false } } };
        const view = render(<ServiceList {...props} preferences={{ ...props.preferences, fallbackOrder: ['deepl'] }} />);
        await view.findByLabelText('providerReady');
        fireEvent.click(view.getByText('apiKeyLabel'));
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false);
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls.at(-1)![0]({});
        await view.findByText('providerPermissionRequired');
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        expect(view.queryByLabelText('providerReady')).toBeNull();
    });

    it('offers access repair for an enabled provider and keeps credentials editable while disabled', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        const view = render(<ServiceList {...mockProps} />);
        await view.findByText('providerPermissionRequired');
        fireEvent.click(view.getByText('grantAccess'));
        await view.findByLabelText('providerReady');
        fireEvent.click(view.getByText('apiKeyLabel'));
        expect((view.getByPlaceholderText('enterApiKey') as HTMLInputElement).disabled).toBe(false);
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
    });

    it('removes a disabled provider domain and saves selection', async () => {
        const view = render(<ServiceList {...mockProps} />);
        await view.findByLabelText('providerReady');
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        fireEvent.click(within(view.getByText('Google Translate (Web)').closest('li')!).getByTitle('Disable service'));
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://translate.google.com/*'] }));
        await waitFor(() => expect(savedPreferences.fallbackOrder).toEqual([]));
    });

    it('saves a disabled provider even if its access cannot be removed, and reports the retained grant', async () => {
        vi.mocked(chrome.permissions.remove).mockRejectedValueOnce(new Error('Browser refused removal'));
        const view = render(<ServiceList {...mockProps} />);
        fireEvent.click(view.getByTitle('Disable service'));
        await view.findByText('permissionRemoveFailed');
        expect(savedPreferences.fallbackOrder).toEqual([]);
    });

    it('rechecks access before an explicit key test and never sends a key after revocation', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        const view = render(<ServiceList {...mockProps} preferences={{ ...DEFAULT_PREFERENCES, fallbackOrder: ['deepl'] }} apiKeys={{ deepl: { key: 'untested', validated: false } }} />);
        await view.findByLabelText('providerReady');
        fireEvent.click(view.getByText('apiKeyLabel'));
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('keyTestFailed');
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it('allows retained access to be removed while the provider stays disabled', async () => {
        const view = render(<ServiceList {...mockProps} />);
        const deepl = within(view.getByText('DeepL').closest('li')!);
        fireEvent.click(await deepl.findByText('removeAccess'));
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] }));
        await waitFor(() => expect(deepl.queryByText('removeAccess')).toBeNull());
        expect(mockProps.updatePreferences).not.toHaveBeenCalled();
    });

    it('does not label an externally replaced key as tested', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
        const preferences = { ...DEFAULT_PREFERENCES, fallbackOrder: ['deepl'] as import('@/src/types').ServiceId[] };
        const view = render(<ServiceList {...mockProps} preferences={preferences} apiKeys={{ deepl: { key: 'original', validated: false } }} />);
        await view.findByLabelText('providerReady');
        fireEvent.click(view.getByText('apiKeyLabel'));
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('valid');
        view.rerender(<ServiceList {...mockProps} preferences={preferences} apiKeys={{ deepl: { key: 'replacement', validated: false } }} />);
        expect(view.queryByText('valid')).toBeNull();
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false);
        fetchMock.mockRestore();
    });

    it('keeps a newer key test result when an older test finishes later', async () => {
        let finishOld!: (response: Response) => void;
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
            .mockResolvedValueOnce(new Response('{}'));
        const preferences = { ...DEFAULT_PREFERENCES, fallbackOrder: ['deepl'] as import('@/src/types').ServiceId[] };
        const view = render(<ServiceList {...mockProps} preferences={preferences} apiKeys={{ deepl: { key: 'original', validated: false } }} />);
        await view.findByLabelText('providerReady');
        fireEvent.click(view.getByText('apiKeyLabel'));
        fireEvent.click(view.getByText('testKey'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        view.rerender(<ServiceList {...mockProps} preferences={preferences} apiKeys={{ deepl: { key: 'replacement', validated: false } }} />);
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('valid');
        finishOld(new Response('', { status: 403 }));
        await waitFor(() => expect(mockProps.updateKeyValidation).toHaveBeenCalledExactlyOnceWith('deepl', 'replacement', true));
        expect(view.getByText('valid')).toBeTruthy();
        fetchMock.mockRestore();
    });

    it('allows a disabled provider with only one domain granted to release that partial access', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async permissions => {
            const origins = permissions.origins ?? [];
            return origins.length === 1 && origins[0] === 'https://api-free.deepl.com/*';
        });
        const view = render(<ServiceList {...mockProps} />);
        const deepl = within(view.getByText('DeepL').closest('li')!);
        fireEvent.click(await deepl.findByText('removeAccess'));
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] }));
        await waitFor(() => expect(deepl.queryByText('removeAccess')).toBeNull());
        expect(mockProps.updatePreferences).not.toHaveBeenCalled();
    });

});
