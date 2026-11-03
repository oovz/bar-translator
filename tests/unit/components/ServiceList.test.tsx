/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import Sortable from 'sortablejs';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/preact';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { createDefaultSetup, validateSetup } from '@/utils/instances';
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
            saved = validateSetup(await updater(structuredClone(saved)));
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
    saved.instances.push({ id: 'lingva', providerId: 'lingva' }, { id: 'deepl', providerId: 'deepl', name: 'Saved account', credential: { key: 'saved:fx', tier: 'free', validated: false } });
    delete saved.instanceOrder;
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
    it('opens saved provider details through its main row and keeps unrelated editors independent', async () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'https://home.example' });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        fireEvent.input(row(view, 'deepl').getByLabelText('instanceName'), { target: { value: 'Unsaved account' } });
        const other = row(view, 'home').getByRole('button', { name: 'showServiceDetails' });
        expect((other as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(other);
        expect(row(view, 'home').getByLabelText('instanceName')).toBeTruthy();
        expect((row(view, 'deepl').getByLabelText('instanceName') as HTMLInputElement).value).toBe('Unsaved account');
        expect((row(view, 'deepl').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(true);
        expect((row(view, 'home').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('preserves unsaved values and same-account lock when saved details collapse and reopen', async () => {
        const view = render(<Harness />);
        const details = row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' });
        fireEvent.click(details);
        fireEvent.input(row(view, 'deepl').getByLabelText('instanceName'), { target: { value: 'Unsaved name' } });
        fireEvent.click(details);
        expect(details.getAttribute('aria-expanded')).toBe('false');
        expect((row(view, 'deepl').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(details);
        expect((row(view, 'deepl').getByLabelText('instanceName') as HTMLInputElement).value).toBe('Unsaved name');
        expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ name: 'Saved account' });
    });

    it('shows fixed providers without a configuration disclosure or activation switch', async () => {
        const view = render(<Harness />);
        expect(row(view, 'google-web').queryByRole('button', { name: 'showServiceDetails' })).toBeNull();
        expect(row(view, 'google-web').queryByLabelText('instanceName')).toBeNull();
        expect(row(view, 'google-web').getByText('googleProviderDescription')).toBeTruthy();
        await waitFor(() => expect(row(view, 'google-web').getByText('providerReady')).toBeTruthy());
        expect(row(view, 'google-web').queryByRole('button', { name: /^(enableInstance|disableInstance)$/ })).toBeNull();
    });

    it('serializes fixed-provider activation while an access request is pending', async () => {
        saved = createDefaultSetup();
        saved.instances = []; saved.instanceOrder = []; saved.preferences.fallbackOrder = [];
        const grant = Promise.withResolvers<boolean>();
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => grant.promise);
        const view = render(<Harness />);
        const google = within(view.container.querySelector('[data-catalog-provider="google-web"]')! as HTMLElement);
        const lingva = within(view.container.querySelector('[data-catalog-provider="lingva"]')! as HTMLElement);
        const googleAdd = google.getByRole('button', { name: 'addProvider' }) as HTMLButtonElement;
        const lingvaAdd = lingva.getByRole('button', { name: 'addProvider' }) as HTMLButtonElement;
        fireEvent.click(googleAdd);
        await waitFor(() => expect(googleAdd.disabled).toBe(true));
        expect(lingvaAdd.disabled).toBe(true);
        fireEvent.click(lingvaAdd);
        expect(saved.instances).toEqual([]);
        grant.resolve(true);
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web']));
        await waitFor(() => expect(lingvaAdd.disabled).toBe(false));
        fireEvent.click(lingvaAdd);
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web', 'lingva']));
        expect(view.container.querySelector('[data-catalog-provider="lingva"]')).toBeNull();
    });

    it('keeps two provider setup drafts independent and allows cancelling only one', async () => {
        saved = createDefaultSetup();
        const view = render(<Harness />);
        const deepl = within(view.container.querySelector('[data-catalog-provider="deepl"]')! as HTMLElement);
        const libre = within(view.container.querySelector('[data-catalog-provider="libretranslate"]')! as HTMLElement);
        fireEvent.click(deepl.getByRole('button', { name: 'addProvider' }));
        fireEvent.input(deepl.getByLabelText('instanceName'), { target: { value: 'My account' } });
        expect((libre.getByRole('button', { name: 'addProvider' }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(libre.getByRole('button', { name: 'addProvider' }));
        fireEvent.input(libre.getByLabelText('instanceName'), { target: { value: 'My server' } });
        fireEvent.click(deepl.getByText('cancel'));
        expect(deepl.queryByLabelText('instanceName')).toBeNull();
        expect((libre.getByLabelText('instanceName') as HTMLInputElement).value).toBe('My server');
        expect(saved.instances).toHaveLength(1);
        expect(deepl.getByRole('button', { name: 'addProvider' })).toBeTruthy();
    });

    it('lists only enabled services above saved inactive accounts and provider choices', async () => {
        const view = render(<Harness />);
        const active = view.getByRole('list', { name: 'activatedInstances' });
        const available = view.getByRole('list', { name: 'availableProviders' });
        expect(Array.from(active.querySelectorAll('[data-id]')).map(node => node.getAttribute('data-id'))).toEqual(['google-web']);
        expect(available.querySelector('[data-id="deepl"]')).not.toBeNull();
        expect(available.querySelector('[data-id="lingva"]')).toBeNull();
        expect(available.querySelector('[data-provider="google-web"]')).toBeNull();
        expect(available.querySelectorAll('[data-provider="lingva"]')).toHaveLength(1);
        expect(within(available.querySelector('[data-provider="lingva"]')! as HTMLElement).getByRole('button', { name: 'addProvider' })).toBeTruthy();
        expect(row(view, 'deepl').getByText('Saved account')).toBeTruthy();
        expect(row(view, 'deepl').getByText('DeepL · API Free')).toBeTruthy();
        expect(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }).textContent).toBe('enable');
        expect(view.queryByRole('switch')).toBeNull();
        expect(row(view, 'google-web').queryByRole('button', { name: /^(enableInstance|disableInstance)$/ })).toBeNull();
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteNamedInstance' }));
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteInstance' }));
        await waitFor(() => expect(available.querySelector('[data-catalog-provider="google-web"]')).not.toBeNull());
        expect(available.querySelector('[data-id="google-web"]')).toBeNull();
        expect(available.querySelectorAll('[data-provider="google-web"]')).toHaveLength(1);
    });

    it('retains the DeepL provider template when a legacy same-ID account moves between sections', async () => {
        const view = render(<Harness />);
        const template = () => view.container.querySelector('[data-catalog-provider="deepl"]')! as HTMLElement;
        expect(within(template()).getByText('addAnother')).toBeTruthy();
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: 'disableInstance' }) as HTMLButtonElement).disabled).toBe(false));
        expect(within(template()).getByText('addAnother')).toBeTruthy();
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'disableInstance' }));
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(false));
        expect(view.container.querySelectorAll('[data-id="deepl"]')).toHaveLength(1);
        expect(view.container.querySelectorAll('[data-catalog-provider="deepl"]')).toHaveLength(1);
        fireEvent.click(within(template()).getByText('addAnother'));
        expect(await view.findByLabelText('instanceName')).toBeTruthy();
    });

    it('hides query parameters and keys from saved server summaries', () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'https://home.example/private?token=sensitive', credential: { key: 'hidden-key', validated: false } });
        const view = render(<Harness />);
        const summary = row(view, 'home').getByText('LibreTranslate · https://home.example/private');
        expect(summary.textContent).not.toMatch(/secret|token|sensitive|hidden-key/);
    });

    it('keeps a newly saved account owned by inline setup while activation is pending', async () => {
        saved = createDefaultSetup();
        let finish!: (granted: boolean) => void;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<Harness />);
        fireEvent.click(view.container.querySelector('[data-catalog-provider="deepl"] [data-action="add-provider"]')!);
        fireEvent.input(await view.findByLabelText('apiKeyLabel'), { target: { value: 'new:fx' } });
        fireEvent.click(view.getByText('addAndEnable'));
        await waitFor(() => expect(saved.instances.some(instance => instance.providerId === 'deepl')).toBe(true));
        const added = saved.instances.find(instance => instance.providerId === 'deepl')!;
        for (const control of [row(view, added.id).getByRole('button', { name: /^(enableInstance|disableInstance)$/ }), row(view, added.id).getByRole('button', { name: 'showServiceDetails' }), row(view, added.id).getByRole('button', { name: 'deleteNamedInstance' })]) {
            expect((control as HTMLButtonElement).disabled).toBe(true);
        }
        finish(false);
        await view.findByText('permissionDenied');
        expect((row(view, added.id).getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLInputElement).disabled).toBe(true);
        fireEvent.click(view.getByText('cancel'));
        expect((row(view, added.id).getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLInputElement).disabled).toBe(false);
    });

    it('keeps a fixed-provider Add action usable when the browser throws synchronously requesting permission', async () => {
        saved = createDefaultSetup();
        saved.instances = []; saved.instanceOrder = []; saved.preferences.fallbackOrder = [];
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => { throw new Error('Browser request unavailable'); });
        const view = render(<Harness />);
        const add = within(view.container.querySelector('[data-catalog-provider="google-web"]')! as HTMLElement).getByRole('button', { name: 'addProvider' }) as HTMLButtonElement;
        fireEvent.click(add);
        expect((await view.findByRole('alert')).textContent).toBe('permissionDenied');
        expect(saved.instances).toEqual([]);
        expect(saved.preferences.fallbackOrder).toEqual([]);
        expect(add.disabled).toBe(false);
        fireEvent.click(add);
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web']));
    });

    it('does not add a fixed provider after its Add request unmounts while permission is pending', async () => {
        saved = createDefaultSetup();
        saved.instances = []; saved.instanceOrder = []; saved.preferences.fallbackOrder = [];
        const grant = Promise.withResolvers<boolean>();
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => grant.promise);
        const view = render(<Harness />);
        fireEvent.click(within(view.container.querySelector('[data-catalog-provider="google-web"]')! as HTMLElement).getByRole('button', { name: 'addProvider' }));
        view.unmount();
        grant.resolve(true);
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://translate.googleapis.com/*'] }));
        expect(saved.instances).toEqual([]);
        expect(saved.preferences.fallbackOrder).toEqual([]);
    });

    it('removes a fixed provider without an activation switch and offers its Add choice again', async () => {
        const view = render(<Harness />);
        expect(row(view, 'google-web').queryByRole('button', { name: /^(enableInstance|disableInstance)$/ })).toBeNull();
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteNamedInstance' }));
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteInstance' }));
        await waitFor(() => expect(saved.instances.some(instance => instance.id === 'google-web')).toBe(false));
        expect(within(view.container.querySelector('[data-catalog-provider="google-web"]')! as HTMLElement).getByRole('button', { name: 'addProvider' })).toBeTruthy();
    });

    it('adds and enables a fixed provider from the catalog without network', async () => {
        saved = createDefaultSetup();
        const fetch = vi.spyOn(globalThis, 'fetch');
        const view = render(<Harness />);
        const catalog = view.container.querySelector('[data-catalog-provider="lingva"]')! as HTMLElement;
        fireEvent.click(within(catalog).getByRole('button', { name: 'addProvider' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toContain('lingva'));
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(view.container.querySelector('[data-catalog-provider="lingva"]')).toBeNull();
        expect(row(view, 'lingva').queryByRole('button', { name: /^(enableInstance|disableInstance)$/ })).toBeNull();
        await waitFor(() => expect(row(view, 'lingva').getByText('providerReady')).toBeTruthy());
    });

    it('keeps a fixed provider available after denied access and retries from its Add choice', async () => {
        saved = createDefaultSetup();
        saved.instances = [];
        saved.instanceOrder = [];
        saved.preferences.fallbackOrder = [];
        vi.mocked(chrome.permissions.request).mockImplementationOnce(async () => false);
        const view = render(<Harness />);
        const add = within(view.container.querySelector('[data-catalog-provider="google-web"]')! as HTMLElement).getByRole('button', { name: 'addProvider' }) as HTMLButtonElement;
        fireEvent.click(add);
        expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
        await view.findByText('permissionDenied');
        expect(saved.instances).toEqual([]);
        expect(saved.preferences.fallbackOrder).toEqual([]);
        expect(view.container.querySelectorAll('[data-id="google-web"]')).toHaveLength(0);
        expect(view.container.querySelector('[data-catalog-provider="google-web"]')).not.toBeNull();
        expect(add.disabled).toBe(false);
        fireEvent.click(add);
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web']));
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('retains off service positions across disable and enable without offering off-row reorder', async () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'managed', endpoint: 'https://libretranslate.com' });
        saved.instanceOrder = ['google-web', 'deepl', 'lingva', 'home'];
        const credentials = structuredClone(saved.instances);
        const view = render(<Harness />);
        expect(row(view, 'deepl').queryByRole('button', { name: 'moveInstanceUp' })).toBeNull();
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web', 'deepl']));
        const list = view.getByRole('list', { name: 'activatedInstances' });
        expect(Array.from(list.querySelectorAll('.service-index')).map(node => node.textContent)).toEqual(['1', '2']);
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: 'disableInstance' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'disableInstance' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web']));
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web', 'deepl']));
        expect(saved.instanceOrder).toEqual(['google-web', 'deepl', 'lingva', 'home']);
        expect(saved.instances).toEqual(credentials);
    });

    it.each(['deepl', 'libretranslate'] as const)('enables saved %s without a key and keeps its test unavailable', async provider => {
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential: undefined } : instance);
        if (provider === 'libretranslate') saved.instances.push({ id: provider, providerId: provider, name: 'Managed', hosting: 'managed', endpoint: 'https://libretranslate.com' });
        const view = render(<Harness />);
        const enable = row(view, provider).getByRole('button', { name: 'enableInstance' }) as HTMLButtonElement;
        expect(enable.disabled).toBe(false);
        fireEvent.click(enable);
        expect(chrome.permissions.request).toHaveBeenCalledExactlyOnceWith({ origins: provider === 'deepl'
            ? ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] : ['https://libretranslate.com/*'] });
        await waitFor(() => expect(saved.preferences.fallbackOrder).toContain(provider));
        expect(row(view, provider).getByText('keyNeeded')).toBeTruthy();
        await waitFor(() => expect((row(view, provider).getByRole('button', { name: 'showServiceDetails' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(row(view, provider).getByRole('button', { name: 'showServiceDetails' }));
        expect(await view.findByLabelText('apiKeyLabel')).toBeTruthy();
        expect((row(view, provider).getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('clears a new server draft key when its recipient changes and accepts a key after saving the endpoint', async () => {
        const view = render(<Harness />);
        fireEvent.click(within(view.container.querySelector('[data-catalog-provider="libretranslate"]')! as HTMLElement).getByRole('button', { name: 'addProvider' }));
        fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'managed-only-key' } });
        fireEvent.change(view.getByLabelText('libreHosting'), { target: { value: 'custom' } });
        const key = view.getByLabelText('optionalApiKey') as HTMLInputElement;
        expect(key.value).toBe('');
        expect(key.disabled).toBe(true);
        fireEvent.input(view.getByLabelText('instanceEndpoint'), { target: { value: 'https://home.example/libre' } });
        fireEvent.click(view.getByText('saveForLater'));
        await waitFor(() => expect(view.queryByLabelText('instanceName')).toBeNull());
        const server = saved.instances.find(instance => instance.providerId === 'libretranslate')!;
        expect(server).toMatchObject({ endpoint: 'https://home.example/libre' });
        expect(server.credential).toBeUndefined();
        fireEvent.click(row(view, server.id).getByRole('button', { name: 'showServiceDetails' }));
        const savedKey = view.getByLabelText('optionalApiKey') as HTMLInputElement;
        expect(savedKey.disabled).toBe(false);
        fireEvent.input(savedKey, { target: { value: 'new-recipient-key' } });
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(saved.instances.find(instance => instance.id === server.id)).toMatchObject({ endpoint: 'https://home.example/libre', credential: { key: 'new-recipient-key' } });
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('keeps custom-server intent and credentials when first contact cannot be confirmed', async () => {
        const credential = { key: 'saved-key', validated: true, lastValidated: 123 };
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://192.168.1.4:5000', credential });
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Local network access not ready'));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
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
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        expect((view.getByLabelText('deepLTier') as HTMLSelectElement).value).toBe('pro');
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Renamed account' } });
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(view.getByRole('status').textContent).toBe('instanceSaved');
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
        expect(view.container.querySelector('[data-id="lingva"]')).toBeNull();
        const choice = () => view.container.querySelector(`[data-catalog-provider="${provider}"]`)! as HTMLElement;
        expect(within(choice()).getAllByRole('button')).toHaveLength(1);
        expect(within(choice()).getByRole('button', { name: 'addProvider' })).toBeTruthy();
        fireEvent.click(within(choice()).getByRole('button', { name: 'addProvider' }));
        await view.findByLabelText('instanceName');
        expect(saved).toEqual(initial);
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        fireEvent.click(view.getByText('cancel'));
        expect(view.queryByLabelText('instanceName')).toBeNull();
        expect(saved).toEqual(initial);
        fireEvent.click(within(choice()).getByRole('button', { name: 'addProvider' }));
        fireEvent.input(await view.findByLabelText('instanceName'), { target: { value: '<Home account>' } });
        fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'saved:fx' } });
        saveFails = true;
        fireEvent.click(view.getByText('saveForLater'));
        await view.findByText('settingsSaveFailed');
        expect(saved).toEqual(initial);
        expect(view.getByText('cancel')).toBeTruthy();
        saveFails = false;
        fireEvent.click(view.getByText('saveForLater'));
        await waitFor(() => expect(view.queryByLabelText('instanceName')).toBeNull());
        expect(view.queryByText('<Home account>')).toBeTruthy();
        expect(view.container.querySelector('home')).toBeNull();
        const added = saved.instances.find(instance => instance.providerId === provider)!;
        expect(saved.instances.filter(instance => instance.providerId === provider)).toHaveLength(1);
        expect(added.id).not.toBe('deepl');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
        expect(available.contains(view.container.querySelector(`[data-id="${added.id}"]`))).toBe(true);
        expect(chrome.permissions.request).not.toHaveBeenCalled();
        expect(testInstance).not.toHaveBeenCalled();
        await waitFor(() => expect(view.container.querySelectorAll(`[data-provider="${provider}"] [data-action="add-provider"]`)).toHaveLength(1));
        fireEvent.click(row(view, added.id).getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: provider === 'deepl'
            ? ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] : ['https://libretranslate.com/*'] });
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web', added.id]));
        expect(activated.contains(view.container.querySelector(`[data-id="${added.id}"]`))).toBe(true);
    });

    it.each(['renamed', 'credentialed', 'activated'] as const)('preserves a default DeepL slot %s by another page during setup', async change => {
        saved = createDefaultSetup();
        saved.instances.push({ id: 'deepl', providerId: 'deepl', name: 'DeepL' });
        delete saved.instanceOrder;
        const view = render(<Harness />);
        fireEvent.click(view.container.querySelector('[data-catalog-provider="deepl"] [data-action="add-provider"]')!);
        fireEvent.input(await view.findByLabelText('instanceName'), { target: { value: 'New account' } });
        const original = saved.instances.find(instance => instance.id === 'deepl')!;
        if (original.providerId !== 'deepl') throw new Error('Expected the default DeepL slot');
        if (change === 'renamed') original.name = 'Changed elsewhere';
        if (change === 'credentialed') original.credential = { key: 'external-fixture', validated: true };
        if (change === 'activated') saved.preferences.fallbackOrder.push('deepl');
        const retained = structuredClone(original);
        fireEvent.click(view.getByText('saveForLater'));
        await waitFor(() => expect(view.queryByLabelText('instanceName')).toBeNull());
        expect(saved.instances.find(instance => instance.id === 'deepl')).toEqual(retained);
        expect(saved.instances.filter(instance => instance.providerId === 'deepl')).toHaveLength(2);
        expect(saved.preferences.fallbackOrder).toEqual(change === 'activated' ? ['google-web', 'deepl'] : ['google-web']);
        expect(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' })).toBeTruthy();
    });

    it('keeps a denied instance disabled without submitting its configuration', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => false);
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        await view.findByRole('alert');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('preserves previously retained access when a new enablement request rejects before granting anything', async () => {
        origins.delete('https://api.deepl.com/*');
        vi.mocked(chrome.permissions.request).mockRejectedValueOnce(new Error('Browser request interrupted'));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        await view.findByText('Browser request interrupted');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
        expect(origins.has('https://api-free.deepl.com/*')).toBe(true);
        expect(chrome.permissions.remove).not.toHaveBeenCalled();
    });

    it('keeps an instance disabled if access is removed before its enablement can be saved', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => { origins.clear(); return true; });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        await view.findByRole('alert');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('releases a newly granted origin when enablement fails to save', async () => {
        saveFails = true;
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        await view.findByRole('alert');
        expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('retains a shared DeepL grant until its last enabled instance is disabled', async () => {
        saved.instances.push({ id: 'work', providerId: 'deepl', name: 'Work' });
        saved.preferences.fallbackOrder = ['deepl', 'work'];
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['work']));
        expect(chrome.permissions.remove).not.toHaveBeenCalled();
        await waitFor(() => expect((row(view, 'work').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(row(view, 'work').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] }));
        expect(saved.preferences.fallbackOrder).toEqual([]);
    });

    it('allows disabling even when grant removal fails, and reports the retained permission', async () => {
        saved.preferences.fallbackOrder = ['google-web', 'deepl'];
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'saved:fx', tier: 'free', validated: true } } : instance);
        vi.mocked(chrome.permissions.remove).mockRejectedValue(new Error('Denied'));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'disableInstance' }));
        await view.findByText('permissionRemoveFailed');
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('retries failed removal of a disabled instance grant without announcing success early', async () => {
        origins.delete('https://api.deepl.com/*');
        vi.mocked(chrome.permissions.remove).mockRejectedValueOnce(new Error('Browser unavailable'));
        const view = render(<Harness />);
        fireEvent.click(await row(view, 'deepl').findByText('removeAccess'));
        await view.findByText('permissionRemoveFailed');
        await waitFor(() => expect((row(view, 'deepl').getByText('removeAccess') as HTMLButtonElement).disabled).toBe(false));
        expect(origins.has('https://api-free.deepl.com/*')).toBe(true);
        expect(view.queryByText('instanceAccessRemovedStatus')).toBeNull();
        fireEvent.click(row(view, 'deepl').getByText('removeAccess'));
        await waitFor(() => expect(origins.has('https://api-free.deepl.com/*')).toBe(false));
        await view.findByText('instanceAccessRemovedStatus');
        expect(view.queryByRole('alert')).toBeNull();
        expect(saved.preferences.fallbackOrder).toEqual(['google-web']);
    });

    it('preserves ports and prefixes, warns for HTTP, and never carries a key to a changed endpoint', async () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', endpoint: 'https://old.example/libre', hosting: 'custom', credential: { key: 'old-key', validated: false } });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByRole('button', { name: 'showServiceDetails' }));
        fireEvent.input(view.getByLabelText('instanceEndpoint'), { target: { value: 'http://192.168.1.4:5000/libre/' } });
        expect((view.getByLabelText('optionalApiKey') as HTMLInputElement).value).toBe('');
        expect((view.getByLabelText('optionalApiKey') as HTMLInputElement).disabled).toBe(true);
        expect(view.getByText('httpEndpointWarning')).toBeTruthy();
        expect(view.getByText('endpointKeyReset')).toBeTruthy();
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
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Pending account' } });
        expect((row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        expect(saved.preferences.fallbackOrder).not.toContain('deepl');
        expect((view.getByLabelText('instanceName') as HTMLInputElement).value).toBe('Pending account');
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLButtonElement).disabled).toBe(false));
        let finishGrant!: (granted: boolean) => void;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => new Promise(resolve => { finishGrant = resolve; }));
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }));
        expect((view.getByLabelText('instanceName') as HTMLInputElement).disabled).toBe(true);
        finishGrant(true);
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Changed' } });
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(true);
        expect((row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLButtonElement).disabled).toBe(true);
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
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
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


    it('keeps test status separate from enablement and disables testing after access is revoked', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        const deepL = saved.instances.find(instance => instance.providerId === 'deepl')!;
        if (deepL.providerId === 'deepl') deepL.credential = { key: 'untested', validated: false, tier: 'pro' };
        const view = render(<Harness />);
        await waitFor(() => expect(row(view, 'deepl').getByText('serviceNotTested')).toBeTruthy());
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        expect(row(view, 'deepl').getByText('serviceNotTested')).toBeTruthy();
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
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
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
        fireEvent.click(row(view, 'work').getByRole('button', { name: 'deleteInstance' }));
        await waitFor(() => expect(saved.instances.some(instance => instance.id === 'work')).toBe(false));
        expect(saved.preferences.fallbackOrder).toEqual(['deepl']);
        expect(saved.instances.some(instance => instance.id === 'deepl')).toBe(true);
    });
    it('persists a drag reorder while preserving accounts enabled after the drag started', async () => {
        saved.instances.push({ id: 'work', providerId: 'deepl', name: 'Work' });
        saved.preferences.fallbackOrder = ['google-web', 'deepl'];
        const view = render(<Harness />);
        const options = vi.mocked(Sortable.create).mock.calls.at(-1)![1]!;
        // Another page enables an account after this list's drag snapshot was rendered.
        saved.preferences.fallbackOrder.push('work');
        options.onEnd?.({ oldDraggableIndex: 0, newDraggableIndex: 1 } as Sortable.SortableEvent);
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['deepl', 'google-web', 'work']));
        expect(within(view.getByRole('list', { name: 'activatedInstances' })).getAllByRole('listitem')
            .map(item => item.getAttribute('data-id'))).toEqual(['deepl', 'google-web', 'work']);
    });

    it('switches between managed and custom hosting without forwarding credentials to a different recipient', async () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', endpoint: 'https://home.example/libre', hosting: 'custom', credential: { key: 'secret', validated: true } });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByRole('button', { name: 'showServiceDetails' }));
        fireEvent.change(view.getByLabelText('libreHosting'), { target: { value: 'managed' } });
        expect((view.getByLabelText('instanceEndpoint') as HTMLInputElement).value).toBe('https://libretranslate.com');
        expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).value).toBe('');
        fireEvent.change(view.getByLabelText('libreHosting'), { target: { value: 'custom' } });
        expect((view.getByLabelText('instanceEndpoint') as HTMLInputElement).value).toBe('https://home.example/libre');
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        const savedHome = saved.instances.find(instance => instance.id === 'home');
        expect(savedHome).toMatchObject({ endpoint: 'https://home.example/libre' });
        expect(savedHome).not.toHaveProperty('credential');
    });

    it('uses a local endpoint when changing a new managed deployment to custom hosting', async () => {
        const view = render(<Harness />);
        fireEvent.click(within(view.container.querySelector('[data-catalog-provider="libretranslate"]')! as HTMLElement).getByRole('button', { name: 'addProvider' }));
        fireEvent.change(await view.findByLabelText('libreHosting'), { target: { value: 'custom' } });
        expect((view.getByLabelText('instanceEndpoint') as HTMLInputElement).value).toBe('http://localhost:5000');
        fireEvent.click(view.getByText('saveForLater'));
        await waitFor(() => expect(view.queryByLabelText('instanceName')).toBeNull());
        expect(saved.instances.find(instance => instance.providerId === 'libretranslate')).toMatchObject({ endpoint: 'http://localhost:5000', hosting: 'custom' });
    });

    it('repairs permission for an already enabled account without changing its priority', async () => {
        saved.preferences.fallbackOrder = ['deepl', 'google-web'];
        origins.clear();
        const view = render(<Harness />);
        fireEvent.click(await row(view, 'deepl').findByText('grantAccess'));
        await waitFor(() => expect(row(view, 'deepl').queryByText('grantAccess')).toBeNull());
        expect(origins.has('https://api-free.deepl.com/*')).toBe(true);
        expect(origins.has('https://api.deepl.com/*')).toBe(true);
        expect(saved.preferences.fallbackOrder).toEqual(['deepl', 'google-web']);
        await waitFor(() => expect((row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLButtonElement).disabled).toBe(false));
        expect(view.queryByRole('alert')).toBeNull();
    });

    it('reports a rejected key test and unlocks the unchanged account for another attempt', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'secret:fx', tier: 'free', validated: false } } : instance);
        vi.mocked(testInstance).mockRejectedValueOnce(new Error('Network unavailable'));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('keyTestFailed');
        expect(view.getByRole('alert').textContent).toBe('keyTestFailed');
        expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('valid');
        expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ credential: { key: 'secret:fx', validated: true } });
    });

    it('shows a credential on request and invalidates prior validation when its key or tier changes', async () => {
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'old:fx', tier: 'free', validated: true, lastValidated: 123 } } : instance);
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        fireEvent.click(view.getByText('show'));
        expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).type).toBe('text');
        fireEvent.input(view.getByLabelText('apiKeyLabel'), { target: { value: 'replacement' } });
        expect((view.getByLabelText('deepLTier') as HTMLSelectElement).value).toBe('pro');
        fireEvent.click(view.getByText('hide'));
        expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).type).toBe('password');
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ credential: { key: 'replacement', tier: 'pro', validated: false } });
        fireEvent.change(view.getByLabelText('deepLTier'), { target: { value: 'free' } });
        fireEvent.click(view.getByText('saveInstance'));
        await waitFor(() => expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ credential: { key: 'replacement', tier: 'free', validated: false } }));
    });

    it('preserves validated credentials when renaming an unchanged custom recipient', async () => {
        const credential = { key: 'secret', validated: true, lastValidated: 123 };
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'https://home.example', credential });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByRole('button', { name: 'showServiceDetails' }));
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Renamed home' } });
        fireEvent.click(view.getByText('saveInstance'));
        await view.findByText('instanceSaved');
        expect(saved.instances.find(instance => instance.id === 'home')).toMatchObject({ name: 'Renamed home', credential });
    });

    it('does not display validation success when recording the result fails', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'secret:fx', tier: 'free', validated: false } } : instance);
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        saveFails = true;
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('keyTestFailed');
        expect(view.queryByText('valid')).toBeNull();
        expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ credential: { validated: false } });
    });

    it('tests a keyless custom deployment without adding a credential record', async () => {
        saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'https://home.example' });
        saved.preferences.fallbackOrder = ['home'];
        origins.add('https://home.example/*');
        const view = render(<Harness />);
        fireEvent.click(row(view, 'home').getByRole('button', { name: 'showServiceDetails' }));
        await waitFor(() => expect((view.getByText('testKey') as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(view.getByText('testKey'));
        await view.findByText('valid');
        expect(saved.instances.find(instance => instance.id === 'home')).not.toHaveProperty('credential');
        expect(saved.preferences.fallbackOrder).toEqual(['home']);
    });

    it.each(['denied', 'rejected'])('keeps an enabled account and its configuration when permission repair is %s', async outcome => {
        saved.preferences.fallbackOrder = ['deepl', 'google-web'];
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'saved:fx', tier: 'free', validated: true } } : instance);
        const before = structuredClone(saved);
        origins.clear();
        if (outcome === 'denied') vi.mocked(chrome.permissions.request).mockImplementationOnce(async () => false);
        else vi.mocked(chrome.permissions.request).mockRejectedValueOnce(new Error('Browser refused request'));
        const view = render(<Harness />);
        const grant = await row(view, 'deepl').findByText('grantAccess');
        fireEvent.click(grant);
        await view.findByRole('alert');
        expect(view.getByText('permissionDenied')).toBeTruthy();
        expect(saved).toEqual(before);
        expect(origins.size).toBe(0);
        expect((grant as HTMLButtonElement).disabled).toBe(false);
        expect(testInstance).not.toHaveBeenCalled();
    });

    it('keeps a new draft mounted and locked until its pending save finishes', async () => {
        let finish!: (saved: boolean) => void;
        const update = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
        const view = render(<ServiceList setup={saved} updateSetup={update} />);
        fireEvent.click(view.container.querySelector('[data-catalog-provider="libretranslate"] [data-action="add-provider"]')!);
        const name = await view.findByLabelText('instanceName') as HTMLInputElement;
        fireEvent.input(name, { target: { value: 'Pending server' } });
        fireEvent.click(view.getByText('saveForLater'));
        await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
        expect(name.disabled).toBe(true);
        expect((view.getByText('saveForLater') as HTMLButtonElement).disabled).toBe(true);
        expect((view.getByText('cancel') as HTMLButtonElement).disabled).toBe(true);
        await userEvent.setup().click(view.getByText('cancel'));
        expect(view.getByLabelText('instanceName')).toBe(name);
        finish(false);
        expect((await view.findByRole('alert')).textContent).toBe('settingsSaveFailed');
        expect(name.disabled).toBe(false);
        expect((view.getByText('cancel') as HTMLButtonElement).disabled).toBe(false);
        expect(saved.instances.some(instance => 'name' in instance && instance.name === 'Pending server')).toBe(false);
    });

    it('reports invalid draft names as errors without saving or presenting successful status', async () => {
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        expect(view.queryByRole('alert')).toBeNull();
        fireEvent.input(view.getByLabelText('instanceName'), { target: { value: '   ' } });
        fireEvent.click(view.getByText('saveInstance'));
        expect((await view.findByRole('alert')).textContent).toBe('instanceNameInvalid');
        expect(view.queryByRole('status')).toBeNull();
        expect(saved.instances.find(instance => instance.id === 'deepl')).toMatchObject({ name: 'Saved account' });
    });

    it('locks a saved account and its activation while its explicit test is pending', async () => {
        saved.preferences.fallbackOrder = ['deepl'];
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'secret:fx', tier: 'free', validated: false } } : instance);
        let finish!: (result: { valid: boolean }) => void;
        vi.mocked(testInstance).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' }));
        const test = view.getByText('testKey') as HTMLButtonElement;
        await waitFor(() => expect(test.disabled).toBe(false));
        fireEvent.click(test);
        await view.findByText('checking');
        expect((view.getByLabelText('instanceName') as HTMLInputElement).disabled).toBe(true);
        expect(test.disabled).toBe(true);
        expect((row(view, 'deepl').getByRole('button', { name: /^(enableInstance|disableInstance)$/ }) as HTMLButtonElement).disabled).toBe(true);
        finish({ valid: true });
        expect((await view.findByRole('status')).textContent).toBe('valid');
        expect(test.disabled).toBe(false);
    });

    it.each(['deepl', 'managed', 'custom'] as const)('shows connection guidance only for custom hosting: %s', async kind => {
        let id = 'deepl';
        if (kind !== 'deepl') {
            id = 'server';
            saved.instances.push({ id, providerId: 'libretranslate', name: 'Server', hosting: kind,
                endpoint: kind === 'managed' ? 'https://libretranslate.com' : 'https://home.example' });
        }
        const view = render(<Harness />);
        fireEvent.click(row(view, id).getByRole('button', { name: 'showServiceDetails' }));
        if (kind === 'custom') expect(view.getByText('customConnectionDescription')).toBeTruthy();
        else expect(view.queryByText('customConnectionDescription')).toBeNull();
        if (kind !== 'deepl') expect((view.getByLabelText('instanceEndpoint') as HTMLInputElement).disabled).toBe(kind === 'managed');
        expect(view.queryByText('endpointKeyReset')).toBeNull();
    });

    it('loads an externally changed custom recipient into the open editor without retaining its old key', async () => {
        saved.instances.push({ id: 'server', providerId: 'libretranslate', name: 'Server', hosting: 'custom',
            endpoint: 'https://old.example', credential: { key: 'old-key', validated: false } });
        const update = vi.fn(async () => true);
        const view = render(<ServiceList setup={saved} updateSetup={update} />);
        fireEvent.click(row(view, 'server').getByRole('button', { name: 'showServiceDetails' }));
        const next = structuredClone(saved);
        next.instances = next.instances.map(instance => instance.id === 'server'
            ? { id: 'server', providerId: 'libretranslate', name: 'Server', hosting: 'managed', endpoint: 'https://libretranslate.com' } : instance);
        view.rerender(<ServiceList setup={next} updateSetup={update} />);
        await waitFor(() => expect((view.getByLabelText('instanceEndpoint') as HTMLInputElement).value).toBe('https://libretranslate.com'));
        expect((view.getByLabelText('libreHosting') as HTMLSelectElement).value).toBe('managed');
        expect((view.getByLabelText('apiKeyLabel') as HTMLInputElement).value).toBe('');
        expect(update).not.toHaveBeenCalled();
    });

    it('preserves a custom server key when an endpoint input event does not change its recipient', async () => {
        const credential = { key: 'secret', validated: true };
        saved.instances.push({ id: 'server', providerId: 'libretranslate', name: 'Server', hosting: 'custom', endpoint: 'https://home.example', credential });
        const view = render(<Harness />);
        fireEvent.click(row(view, 'server').getByRole('button', { name: 'showServiceDetails' }));
        fireEvent.input(view.getByLabelText('instanceEndpoint'), { target: { value: 'https://home.example' } });
        expect((view.getByLabelText('optionalApiKey') as HTMLInputElement).value).toBe('secret');
        expect((view.getByText('saveInstance') as HTMLButtonElement).disabled).toBe(true);
        expect(saved.instances.find(instance => instance.id === 'server')).toMatchObject({ credential });
    });

    it('keeps the provider section out of sequential keyboard navigation while permitting direct focus', async () => {
        const view = render(<><button>Before providers</button><Harness /></>);
        await waitFor(() => expect(row(view, 'google-web').getByRole('button', { name: 'deleteNamedInstance' })).toBeTruthy());
        const user = userEvent.setup();
        await user.tab();
        expect(document.activeElement).toBe(view.getByText('Before providers'));
        await user.tab();
        expect(document.activeElement).toBe(row(view, 'google-web').getByRole('button', { name: 'deleteNamedInstance' }));
        const section = view.container.querySelector<HTMLElement>('#providers')!;
        section.focus();
        expect(document.activeElement).toBe(section);
    });

    it('asks for inline confirmation before deleting a configuration', async () => {
        const view = render(<Harness />);
        const trigger = () => view.container.querySelector<HTMLButtonElement>('.service-item[data-id="google-web"] [data-action="delete-instance"]');
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteNamedInstance' }));
        expect(row(view, 'google-web').getByText('deleteConfirmation')).toBeTruthy();
        expect(trigger()).toBeNull();
        const confirm = row(view, 'google-web').getByRole('button', { name: 'deleteInstance' }) as HTMLButtonElement;
        expect(confirm.getAttribute('aria-describedby')).toBe('delete-warning-google-web');
        await waitFor(() => expect(document.activeElement).toBe(confirm));
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'cancel' }));
        expect(saved.instances.some(instance => instance.id === 'google-web')).toBe(true);
        await waitFor(() => expect(document.activeElement).toBe(trigger()));
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteNamedInstance' }));
        fireEvent.click(row(view, 'google-web').getByRole('button', { name: 'deleteInstance' }));
        await waitFor(() => expect(saved.instances.some(instance => instance.id === 'google-web')).toBe(false));
    });

    it('focuses the disabled account and announces its status', async () => {
        saved.preferences.fallbackOrder = ['google-web', 'deepl'];
        saved.instances = saved.instances.map(instance => instance.providerId === 'deepl'
            ? { ...instance, credential: { key: 'saved:fx', tier: 'free', validated: false } } : instance);
        const view = render(<Harness />);
        fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'disableInstance' }));
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web']));
        await waitFor(() => expect(document.activeElement).toBe(row(view, 'deepl').getByRole('button', { name: 'showServiceDetails' })));
        expect(view.container.textContent).toContain('instanceDisabledStatus');
    });

    it('guards closing while an add-dialog draft is unsaved', async () => {
        const view = render(<Harness />);
        const clean = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);
        fireEvent.click(view.container.querySelector('[data-catalog-provider="deepl"] [data-action="add-provider"]')! as HTMLElement);
        const dirty = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);
        fireEvent.click(view.getByText('cancel'));
        const cleanAgain = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanAgain);
        expect(cleanAgain.defaultPrevented).toBe(false);
    });

});
