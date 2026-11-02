/** @vitest-environment jsdom */
import { render as renderPreact } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/preact';
import App from '@/entrypoints/options/App';
import { createDefaultSetup } from '@/utils/instances';
import { getSetupState, retrySetupMigration, switchSetupStorage, updateSetup } from '@/utils/storage';
import type { SetupState, TranslationSetup } from '@/src/types';

declare const jsdom: { window: Window };
let state: SetupState;
function addProvider(view: { container: Element }) {
    return view.container.querySelector<HTMLButtonElement>('[data-provider="libretranslate"] [data-action="add-provider"]')!;
}
vi.mock('sortablejs', () => ({ default: { create: vi.fn(() => ({ destroy: vi.fn() })) } }));
vi.mock('@/services', () => ({ testInstance: vi.fn(async () => ({ valid: true })) }));
vi.mock('@/utils/storage', () => ({
    getSetupState: vi.fn(async () => structuredClone(state)),
    retrySetupMigration: vi.fn(async () => structuredClone(state)),
    getSetup: vi.fn(async () => structuredClone(state.setup)),
    reconcileSetupAccess: vi.fn(async () => {}),
    isSetupStorageChange: vi.fn(() => true),
    updateSetup: vi.fn(async (updater: (setup: TranslationSetup) => TranslationSetup | Promise<TranslationSetup>) => {
        state = { ...state, setup: await updater(structuredClone(state.setup)) };
        return structuredClone(state.setup);
    }),
    switchSetupStorage: vi.fn(async (to: 'local' | 'sync') => {
        state = { ...state, storageType: to, conflict: undefined };
        return structuredClone(state);
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: jsdom.window.localStorage });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: jsdom.window.sessionStorage });
    window.localStorage.clear();
    window.sessionStorage.clear();
    state = { setup: createDefaultSetup(), storageType: 'local' };
    state.setup.preferences.fallbackOrder = [];
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    vi.mocked(chrome.permissions.request).mockImplementation(async () => true);
    vi.mocked(chrome.permissions.remove).mockImplementation(async () => true);
});
afterEach(() => vi.restoreAllMocks());

describe('whole-setup settings application', () => {
    it('clears retired analytics data while preserving unrelated browser storage', async () => {
        const token = 'phc_yI0ofU7zKrbDyBlCEwGTfsT5EkfcGnmmUE2XRewGg3h';
        const keys = [`ph_${token}_posthog`, `__ph_opt_in_out_${token}`, `ph_${token}_window_id`, `ph_${token}_primary_window_exists`];
        for (const storage of [window.localStorage, window.sessionStorage]) {
            for (const key of keys) storage.setItem(key, 'obsolete-identity');
            storage.setItem('unrelated', 'preserved');
        }
        const view = render(<App />);
        await view.findByText('privacyDesc');
        expect(document.title).toBe('extName settings');
        for (const storage of [window.localStorage, window.sessionStorage]) {
            for (const key of keys) expect(storage.getItem(key)).toBeNull();
            expect(storage.getItem('unrelated')).toBe('preserved');
        }
    });

    it('preserves disable-all across visits and can re-enable a fixed provider', async () => {
        const first = render(<App />);
        await first.findByText('noServicesEnabled');
        first.unmount();
        const second = render(<App />);
        await second.findByText('noServicesEnabled');
        fireEvent.click(within(second.container.querySelector('[data-id="lingva"]')! as HTMLElement).getByRole('button', { name: 'enableInstance' }));
        await waitFor(() => expect(state.setup.preferences.fallbackOrder).toEqual(['lingva']));
        second.unmount();
        const third = render(<App />);
        await third.findByText('primary');
        expect(third.queryByText('noServicesEnabled')).toBeNull();
    });

    it('loads externally changed setup configuration and cleans up its listener', async () => {
        const view = render(<App />);
        await view.findByText('noServicesEnabled');
        const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
        state.setup.preferences.fallbackOrder = ['deepl'];
        const deepL = state.setup.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') { deepL.name = 'Work'; deepL.credential = { key: 'external-key', validated: false }; }
        listener({ 'setup-v2': { newValue: 'revision' } }, 'local');
        await view.findByText('Work');
        fireEvent.click(within(view.container.querySelector('[data-id="deepl"]')! as HTMLElement).getByText('configureInstance'));
        expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).value).toBe('external-key');
        view.unmount();
        await waitFor(() => expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener));
    });

    it('merges a delayed enablement with newer language and provider choices', async () => {
        state.setup.preferences.fallbackOrder = ['google-web'];
        state.setup.instances = state.setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: 'Saved account' } : instance);
        let grant!: (granted: boolean) => void;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => new Promise<boolean>(resolve => { grant = resolve; }));
        const view = render(<App />);
        await view.findByText('privacyDesc');
        fireEvent.click(within(view.container.querySelector('[data-id="deepl"]')! as HTMLElement).getByRole('button', { name: 'enableInstance' }));
        state.setup.preferences.fallbackOrder = [];
        state.setup.preferences.defaultTargetLang = 'fr';
        grant(true);
        await waitFor(() => expect(state.setup.preferences.fallbackOrder).toEqual(['deepl']));
        expect(state.setup.preferences.defaultTargetLang).toBe('fr');
    });

    it('keeps controls disabled until a storage switch finishes and then displays the committed selection', async () => {
        let finish!: (state: SetupState) => void;
        vi.mocked(switchSetupStorage).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = render(<App />);
        await view.findByText('privacyDesc');
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'sync' } });
        await waitFor(() => expect(select.disabled).toBe(true));
        expect(select.value).toBe('local');
        expect(addProvider(view).matches(':disabled')).toBe(true);
        state = { ...state, storageType: 'sync' };
        finish(structuredClone(state));
        await waitFor(() => expect(select.value).toBe('sync'));
        expect(select.disabled).toBe(false);
    });

    it('keeps an active setup usable while presenting a storage conflict without silently resolving it', async () => {
        const destination = createDefaultSetup();
        destination.preferences.defaultTargetLang = 'fr';
        vi.mocked(switchSetupStorage).mockResolvedValueOnce({ ...state, conflict: { token: 'revision', source: state.setup, destination, destinationStorage: 'sync', reason: 'switch' } });
        const view = render(<App />);
        await view.findByText('privacyDesc');
        fireEvent.change(view.getByLabelText('labelStorage'), { target: { value: 'sync' } });
        await view.findByRole('region', { name: 'setupConflictTitle' });
        expect((view.getByLabelText('labelStorage') as HTMLSelectElement).value).toBe('local');
        expect(addProvider(view).matches(':disabled')).toBe(false);
        expect(switchSetupStorage).toHaveBeenCalledTimes(1);
        fireEvent.click(view.getByText('useSavedSetup'));
        await waitFor(() => expect(switchSetupStorage).toHaveBeenLastCalledWith('sync', { token: 'revision', choice: 'use-destination' }));
    });

    it('disables edits during a pending migration while keeping its resolver active', async () => {
        state.conflict = { token: 'migration', source: state.setup, destination: createDefaultSetup(), destinationStorage: 'local', reason: 'migration' };
        const view = render(<App />);
        await view.findByRole('region', { name: 'setupConflictTitle' });
        expect(addProvider(view).matches(':disabled')).toBe(true);
        expect((view.getByText('useSavedSetup') as HTMLButtonElement).disabled).toBe(false);
        expect(updateSetup).not.toHaveBeenCalled();
    });


    it('shows legacy settings during a failed upgrade, blocks edits, and retries without replacing them with defaults', async () => {
        state.setup.preferences.fallbackOrder = ['deepl'];
        state.setup.preferences.defaultTargetLang = 'ja';
        state.setup.copyEnabled = true;
        const deepL = state.setup.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') { deepL.name = 'Existing account'; deepL.credential = { key: 'retained-key', validated: false }; }
        state.migrationError = 'quota details that should not be exposed';
        const before = structuredClone(state.setup);
        const view = render(<App />);
        await view.findByText('setupMigrationPending');
        expect(view.getByText('Existing account')).toBeTruthy();
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(true);
        const editing = addProvider(view);
        expect(editing.matches(':disabled')).toBe(true);
        expect((view.getByLabelText('labelStorage') as HTMLSelectElement).disabled).toBe(false);
        expect(view.container.textContent).not.toContain(state.migrationError);
        expect(updateSetup).not.toHaveBeenCalled();
        expect(switchSetupStorage).not.toHaveBeenCalled();
        state = { ...state, migrationError: undefined };
        fireEvent.click(view.getByText('retry'));
        await waitFor(() => expect(view.queryByText('setupMigrationPending')).toBeNull());
        expect(retrySetupMigration).toHaveBeenCalledTimes(1);
        expect(editing.matches(':disabled')).toBe(false);
        expect((view.getByLabelText('labelStorage') as HTMLSelectElement).disabled).toBe(false);
        expect(view.getByText('Existing account')).toBeTruthy();
        expect(state.setup).toEqual(before);
    });


    it('allows switching to Local to recover a failed synced upgrade', async () => {
        state.storageType = 'sync';
        state.migrationError = 'Sync quota exceeded';
        const previous = structuredClone(state.setup);
        vi.mocked(switchSetupStorage).mockImplementationOnce(async to => {
            state = { setup: previous, storageType: to };
            return structuredClone(state);
        });
        const view = render(<App />);
        await view.findByText('setupMigrationPending');
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        expect(select.disabled).toBe(false);
        fireEvent.change(select, { target: { value: 'local' } });
        await waitFor(() => expect(select.value).toBe('local'));
        expect(view.queryByText('setupMigrationPending')).toBeNull();
        expect(addProvider(view).matches(':disabled')).toBe(false);
        expect(state.setup).toEqual(previous);
        expect(switchSetupStorage).toHaveBeenCalledWith('local', undefined);
    });

    it('saves and clears a regional dialect without discarding another language override', async () => {
        state.setup.preferences.languageOverrides = { zh: 'zh-TW' };
        const view = render(<App />);
        const label = await view.findByText('lang_pt (pt)');
        const select = within(label.parentElement!).getByRole('combobox') as HTMLSelectElement;
        expect(within(select).getByRole('option', { name: 'lang_variant_brazil' })).toHaveProperty('value', 'pt-BR');
        fireEvent.change(select, { target: { value: 'pt-BR' } });
        await waitFor(() => expect(state.setup.preferences.languageOverrides).toEqual({ zh: 'zh-TW', pt: 'pt-BR' }));
        expect(select.value).toBe('pt-BR');
        fireEvent.change(select, { target: { value: '' } });
        await waitFor(() => expect(state.setup.preferences.languageOverrides).toEqual({ zh: 'zh-TW' }));
        expect(select.value).toBe('');
    });

    it('shows save failures as alerts while leaving successfully loaded settings free of error alerts', async () => {
        const view = render(<App />);
        const label = await view.findByText('lang_pt (pt)');
        expect(view.queryByRole('alert')).toBeNull();
        vi.mocked(updateSetup).mockRejectedValueOnce(new Error('Storage unavailable'));
        fireEvent.change(within(label.parentElement!).getByRole('combobox'), { target: { value: 'pt-BR' } });
        expect((await view.findByRole('alert')).textContent).toBe('settingsSaveFailed');
        expect(state.setup.preferences.languageOverrides).toEqual({});
    });

    it('ignores a settings hash change during deferred listener cleanup after page teardown', async () => {
        const previous = window.location.href;
        const errors: unknown[] = [];
        const recordError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
        window.addEventListener('error', recordError);
        try {
            window.history.replaceState(null, '', '#copy');
            const view = render(<App />);
            const checkbox = await view.findByLabelText('enableCopy');
            await waitFor(() => expect(document.activeElement).toBe(checkbox.closest('#copy')));
            // Preact removes DOM immediately but cleans passive subscriptions after paint.
            renderPreact(null, view.container);
            window.history.replaceState(null, '', '#providers');
            window.dispatchEvent(new Event('hashchange'));
            expect(errors).toEqual([]);
        } finally {
            await act(async () => {});
            window.removeEventListener('error', recordError);
            window.history.replaceState(null, '', previous);
        }
    });

    it('focuses a deep-linked section even when the host does not provide scrolling', async () => {
        const previous = window.location.href;
        try {
            window.history.replaceState(null, '', '#copy');
            const view = render(<App />);
            const checkbox = await view.findByLabelText('enableCopy');
            await waitFor(() => expect(document.activeElement).toBe(checkbox.closest('#copy')));
        } finally {
            window.history.replaceState(null, '', previous);
        }
    });

    it('reports a settings read failure rather than silently presenting fresh defaults', async () => {
        vi.mocked(getSetupState).mockRejectedValueOnce(new Error('Incomplete sync'));
        const view = render(<App />);
        await view.findByRole('alert');
        expect(view.getByText('settingsLoadFailed')).toBeTruthy();
        expect(updateSetup).not.toHaveBeenCalled();
        expect(view.container.querySelector('[data-action="add-provider"]')).toBeNull();
        fireEvent.click(view.getByText('retry'));
        await waitFor(() => expect(addProvider(view)).not.toBeNull());
        expect(view.queryByText('settingsLoadFailed')).toBeNull();
    });
    it.each(['providers', 'copy'])('focuses and scrolls to the %s section when its settings link is followed', async id => {
        const view = render(<App />);
        await view.findByText('privacyDesc');
        const section = view.container.querySelector<HTMLElement>(`#${id}`)!;
        section.scrollIntoView = vi.fn();
        const previous = window.location.href;
        try {
            window.history.replaceState(null, '', `#${id}`);
            fireEvent(window, new Event('hashchange'));
            await waitFor(() => expect(document.activeElement).toBe(section));
            expect(section.scrollIntoView).toHaveBeenCalledOnce();
        } finally {
            window.history.replaceState(null, '', previous);
        }
    });

});
