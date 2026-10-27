/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/preact';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { createDefaultSetup } from '@/utils/instances';
import { testInstance } from '@/services';
import type { SetupUpdate } from '@/entrypoints/options/hooks/usePreferences';
import type { TranslationSetup } from '@/src/types';

vi.mock('sortablejs', () => ({ default: { create: vi.fn(() => ({ destroy: vi.fn() })) } }));
vi.mock('@/utils/storage', () => ({
    reconcileSetupAccess: vi.fn(async (previous: TranslationSetup) => {
        const { releaseUnusedInstanceAccess } = await import('@/utils/permissions');
        await releaseUnusedInstanceAccess(previous, saved);
    }),
}));
vi.mock('@/services', () => ({ testInstance: vi.fn() }));

let saved: TranslationSetup;
let saveFails = false;
let origins: Set<string>;
function Harness() {
    const [setup, setSetup] = useState(saved);
    const updateSetup = async (updater: SetupUpdate) => {
        if (saveFails) return false;
        try {
            saved = await updater(structuredClone(saved));
            setSetup(saved);
            return true;
        } catch { return false; }
    };
    return <ServiceList setup={setup} updateSetup={updateSetup} />;
}
function row(view: ReturnType<typeof render>, id: string) {
    return within(view.container.querySelector(`[data-id="${id}"]`)! as HTMLElement);
}

beforeEach(() => {
    vi.clearAllMocks();
    saved = createDefaultSetup();
    saved.instances = saved.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: 'Saved account' } : instance);
    saveFails = false;
    origins = new Set(['https://translate.googleapis.com/*', 'https://api-free.deepl.com/*', 'https://api.deepl.com/*']);
    vi.mocked(chrome.permissions.contains).mockImplementation(async value => (value.origins ?? []).every(origin => origins.has(origin)));
    vi.mocked(chrome.permissions.request).mockImplementation(async value => { value.origins?.forEach(origin => origins.add(origin)); return true; });
    vi.mocked(chrome.permissions.remove).mockImplementation(async value => { value.origins?.forEach(origin => origins.delete(origin)); return true; });
    vi.mocked(testInstance).mockResolvedValue({ valid: true });
});

afterEach(() => vi.restoreAllMocks());

describe('translation instances', () => {
    it('keeps custom-server intent and credentials when first contact cannot be confirmed', async () => {
        const credential = { key: 'saved-key', validated: true, lastValidated: 123 };
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://192.168.1.4:5000', credential });
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Local network access not ready'));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByRole('button', { name: 'connectInstance' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toContain('home'));
        expect(saved.instances.find(instance => instance.id === 'home')).toMatchObject({ credential });
        await view.findByText('customConnectionFailed');
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('preserves a migrated Pro credential and its routing when only the name changes', async () => {
        const credential = { key: 'synthetic-pro-key', validated: true, lastValidated: 123 };
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential } : instance);
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByText('configureInstance'));
        expect((view.getByLabelText('deepLTier') as HTMLSelectElement).value).toBe('pro');
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Renamed account' } });
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(saved.instances.find(instance => instance.id === 'deepl')).toEqual({
            id: 'deepl', providerId: 'deepl', name: 'Renamed account', credential,
        });
    });

    it.each(['deepl', 'libretranslate'] as const)('uses the same cancellable setup and explicit activation for fresh %s', async provider => {
        saved = createDefaultSetup();
        const initial = structuredClone(saved);
        const view = render(<Harness />);
        const activated = view.getByRole('list', { name: 'activatedInstances' });
        const available = view.getByRole('list', { name: 'availableProviders' });
        expect(row(view, 'google-web').queryByText('configureInstance')).toBeNull();
        expect(row(view, 'lingva').queryByText('configureInstance')).toBeNull();
        const choice = () => view.container.querySelector(`[data-provider="${provider}"]`)! as HTMLElement;
        expect(within(choice()).getAllByRole('button')).toHaveLength(1);
        expect(within(choice()).getByRole('button', { name: 'configureNamedInstance' })).toBeTruthy();
        fireEvent.click(within(choice()).getByRole('button'));
        await view.findByLabelText('instanceName');
        expect(saved).toEqual(initial);
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        fireEvent.click(view.getByText('cancel'));
        expect(view.queryByLabelText('instanceName')).toBeNull();
        expect(saved).toEqual(initial);
        fireEvent.click(within(choice()).getByRole('button'));
        fireEvent.input(await view.findByLabelText('instanceName'), { target: { value: '<Home account>' } });
        saveFails = true;
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('settingsSaveFailed');
        expect(saved).toEqual(initial);
        expect(view.getByText('cancel')).toBeTruthy();
        saveFails = false;
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(view.container.querySelector('Home')).toBeNull();
        const added = saved.instances.find(instance => instance.providerId === provider)!;
        expect(saved.instances.filter(instance => instance.providerId === provider)).toHaveLength(1);
        expect(added.id).not.toBe('deepl');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
        expect(available.contains(view.container.querySelector(`[data-id="${added.id}"]`))).toBe(true);
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(testInstance).not.toHaveBeenCalled();
        await waitFor(() => expect(view.container.querySelectorAll(`[data-provider="${provider}"] [data-action="add-provider"]`)).toHaveLength(1));
        fireEvent.click(row(view, added.id).getByRole('button', { name: 'enableInstance' }));
        expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: provider === 'deepl'
            ? ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] : ['https://libretranslate.com/*'] });
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web', added.id]));
        expect(activated.contains(view.container.querySelector(`[data-id="${added.id}"]`))).toBe(true);
    });

    it.each(['renamed', 'credentialed', 'activated'] as const)('preserves a default DeepL slot %s by another page during setup', async change => {
        saved = createDefaultSetup();
        const view = render(<Harness />);
        fireEvent.click(view.container.querySelector('[data-provider="deepl"] [data-action="add-provider"]')!);
        fireEvent.input(await view.findByLabelText('instanceName'), { target: { value: 'New account' } });
        const original = saved.instances.find(instance => instance.id === 'deepl')!;
        if (original.providerId !== 'deepl') throw new Error('Expected the default DeepL slot');
        if (change === 'renamed') original.name = 'Changed elsewhere';
        if (change === 'credentialed') original.credential = { key: 'external-fixture', validated: true };
        if (change === 'activated') saved.preferences.fallbackOrder.push('deepl');
        const retained = structuredClone(original);
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(saved.instances.find(instance => instance.id === 'deepl')).toEqual(retained);
        expect(saved.instances.filter(instance => instance.providerId === 'deepl')).toHaveLength(2);
        expect(saved.preferences.fallbackOrder).toEqual(change === 'activated' ? ['google-web', 'deepl'] : ['google-web']);
        expect(row(view, 'deepl').getByText('configureInstance')).toBeTruthy();
    });

    it('keeps a denied instance disabled without submitting its configuration', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => false);
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        await view.findByRole('alert');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('keeps an instance disabled if access is removed before its enablement can be saved', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => { origins.clear(); return true; });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        await view.findByRole('alert');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('releases a newly granted origin when enablement fails to save', async () => {
        saveFails = true;
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        await view.findByRole('alert');
        expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('retains a shared DeepL grant until its last enabled instance is disabled', async () => {
        saved.instances.push({ id: 'work', providerId: 'deepl', name: 'Work' });
        saved.preferences.fallbackOrder = ['deepl', 'work'];
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'disableInstance' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['work']));
        expect(chrome.permissions.remove).not.toHaveBeenCalled();
        await waitFor(() => expect((row(view, 'work').getByRole('button', { name: 'disableInstance' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(row(view, 'work').getByRole('button', { name: 'disableInstance' }));
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] }));
        expect(saved.preferences.fallbackOrder).toEqual([]);
    });

    it('allows disabling even when grant removal fails, and reports the retained permission', async () => {
        vi.mocked(chrome.permissions.remove).mockRejectedValue(new Error('Denied'));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'disableInstance' }));
        await view.findByText('permissionRemoveFailed');
        expect(saved.preferences.fallbackOrder).toEqual([]);
    });

    it('can remove a partial grant retained for a disabled instance', async () => {
        origins.delete('https://api.deepl.com/*');
        const view = render(<Harness />);
        fireEvent.click(await row(view, 'deepl').findByText('removeAccess'));
        await waitFor(() => expect(origins.has('https://api-free.deepl.com/*')).toBe(false));
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('preserves ports and prefixes, warns for HTTP, and never carries a key to a changed endpoint', async () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', endpoint: 'https://old.example/libre', hosting: 'custom', credential: { key: 'old-key', validated: false } });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByText('configureInstance'));
        fireEvent.input(view.getByLabelText('instanceEndpoint'), { target: { value: 'http://192.168.1.4:5000/libre/' } });
        expect((view.getByLabelText('optionalApiKey') as HTMLInputElement).value).toBe('');
        expect((view.getByLabelText('optionalApiKey') as HTMLInputElement).disabled).toBe(true);
        expect(view.getByText('httpEndpointWarning')).toBeTruthy();
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(saved.instances.find(instance => instance.id === 'home')).toEqual({ id: 'home', providerId: 'libretranslate', name: 'Home', endpoint: 'http://192.168.1.4:5000/libre', hosting: 'custom', credential: undefined });
        expect(testInstance).not.toHaveBeenCalled();
        await waitFor(() => expect((view.getByLabelText('optionalApiKey') as HTMLInputElement).disabled).toBe(false));
        fireEvent.input(view.getByLabelText('optionalApiKey'), { target: { value: 'old-key' } });
        fireEvent.click(view.getByText('saveInstance'));
        await waitFor(() => expect(saved.instances.find(instance => instance.id === 'home')).toMatchObject({ credential: { key: 'old-key', validated: false } }));
    });

    it('does not test disabled or unsaved configurations and leaves a failed test enabled', async () => {
        const deepL = saved.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') deepL.credential = { key: 'key:fx', tier: 'free', validated: false };
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByText('configureInstance'));
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Pending account' } });
        expect((row(view, 'deepl').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        expect(saved.preferences.fallbackOrder).not.toContain('deepl');
        expect((view.getByLabelText('instanceName') as HTMLInputElement).value).toBe('Pending account');
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(false));
        let finishGrant!: (granted: boolean) => void;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => new Promise(resolve => { finishGrant = resolve; }));
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        expect((view.getByLabelText('instanceName') as HTMLInputElement).disabled).toBe(true);
        finishGrant(true);
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Changed' } });
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        expect((row(view, 'deepl').getByRole('button', { name: 'disableInstance' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        vi.mocked(testInstance).mockResolvedValueOnce({ valid: false });
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('keyTestFailed');
        expect(saved.preferences.fallbackOrder).toContain('deepl');
        expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ credential: { validated: false } });
    });

    it('ignores an older test after the stored key is replaced', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        const deepL = saved.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') deepL.credential = { key: 'original', tier: 'pro', validated: false };
        let finish!: (value: { valid: boolean }) => void;
        vi.mocked(testInstance).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const update = vi.fn(async (updater: SetupUpdate) => { saved = await updater(saved); return true; });
        const view = render(<ServiceList setup={saved} updateSetup={update} />);
        fireEvent.click(row(view, 'deepl').getByText('configureInstance'));
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(view.getByText('testKey'));
        const replacement = structuredClone(saved);
        const current = replacement.instances.find(instance => instance.providerId === 'deepl')!;
        if (current.providerId === 'deepl') current.credential = { key: 'replacement', validated: false, tier: 'pro' };
        saved = replacement;
        view.rerender(<ServiceList setup={replacement} updateSetup={update} />);
        finish({ valid: true });
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        expect(update).not.toHaveBeenCalled();
        expect(view.queryByText('valid')).toBeNull();
    });


    it('treats an untested key as ready and disables testing after access is revoked', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        const deepL = saved.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') deepL.credential = { key: 'untested', validated: false, tier: 'pro' };
        const view = render(<Harness />);
        await view.findByLabelText('providerReady');
        fireEvent.click(row(view, 'deepl').getByText('configureInstance'));
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false);
        origins.clear();
        const listeners = vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls;
        listeners.at(-1)![0]({});
        await view.findByText('providerPermissionRequired');
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        expect(saved.preferences.fallbackOrder).toEqual(['deepl']);
    });

    it('clears a successful test status when another page replaces the key', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        const deepL = saved.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') deepL.credential = { key: 'original', validated: false, tier: 'pro' };
        const update = vi.fn(async (updater: SetupUpdate) => { saved = await updater(saved); return true; });
        const view = render(<ServiceList setup={saved} updateSetup={update} />);
        fireEvent.click(row(view, 'deepl').getByText('configureInstance'));
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('valid');
        const replacement = structuredClone(saved);
        const current = replacement.instances.find(instance => instance.providerId === 'deepl')!;
        if (current.providerId === 'deepl') current.credential = { key: 'replacement', validated: false, tier: 'pro' };
        view.rerender(<ServiceList setup={replacement} updateSetup={update} />);
        await waitFor(() => expect(view.queryByText('valid')).toBeNull());
        expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).value).toBe('replacement');
    });

    it('reorders instances without deduplicating their provider and deletes only the chosen configuration', async () => {
        saved.instances.push({ id: 'work', providerId: 'deepl', name: 'Work' });
        saved.preferences.fallbackOrder = ['deepl', 'work'];
        const view = render(<Harness />);
        fireEvent.click(row(view, 'work').getByRole('button', { name: 'moveInstanceUp' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['work', 'deepl']));
        fireEvent.click(row(view, 'work').getByRole('button', { name: 'deleteNamedInstance' }));
        await waitFor(() => expect(saved.instances.some(instance => instance.id === 'work')).toBe(false));
        expect(saved.preferences.fallbackOrder).toEqual(['deepl']);
        expect(saved.instances.some(instance => instance.id === 'deepl')).toBe(true);
    });
});
