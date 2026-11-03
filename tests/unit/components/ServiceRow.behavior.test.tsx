/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { createLegacySetup } from '@/tests/fixtures/legacy-setup';
import { validateSetup } from '@/utils/instances';
import type { TranslationSetup } from '@/src/types';
import type { SetupUpdate } from '@/entrypoints/options/hooks/usePreferences';

vi.mock('sortablejs', () => ({ default: { create: vi.fn(() => ({ destroy: vi.fn() })) } }));
vi.mock('@/utils/storage', () => ({ reconcileSetupAccess: vi.fn(async () => {}) }));
let saved: TranslationSetup;
function Harness() {
    const [setup, setSetup] = useState(saved);
    const updateSetup = async (updater: SetupUpdate) => {
        saved = validateSetup(await updater(structuredClone(saved)));
        setSetup(saved);
        return true;
    };
    return <ServiceList setup={setup} updateSetup={updateSetup} />;
}
function row(view: { container: Element }, id: string) {
    const selector = id.startsWith('available:') ? `#available-providers [data-catalog-provider="${id.slice(10)}"]` : `[data-id="${id}"]`;
    return within(view.container.querySelector<HTMLElement>(selector)!);
}
function button(scope: ReturnType<typeof within>, name: string) {
    return scope.getByRole('button', { name }) as HTMLButtonElement;
}
beforeEach(() => {
    vi.clearAllMocks();
    saved = createLegacySetup();
    saved.instances = saved.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: 'Work' } : instance);
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    vi.mocked(chrome.permissions.request).mockImplementation(async () => true);
});
afterEach(async () => { await act(() => cleanup()); });

it('numbers activated instances and disables only the unavailable reorder directions', async () => {
    saved.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
    const view = render(<Harness />);
    await waitFor(() => expect(row(view, 'google-web').getByText('providerReady')).toBeTruthy());
    const numbers = () => [...view.container.querySelectorAll('.service-index')].map(element => element.textContent);
    expect(numbers()).toEqual(['1', '2', '3']);
    expect(button(row(view, 'google-web'), 'moveInstanceUp').disabled).toBe(true);
    expect(button(row(view, 'google-web'), 'moveInstanceDown').disabled).toBe(false);
    expect(button(row(view, 'deepl'), 'moveInstanceUp').disabled).toBe(false);
    expect(button(row(view, 'deepl'), 'moveInstanceDown').disabled).toBe(false);
    expect(button(row(view, 'lingva'), 'moveInstanceUp').disabled).toBe(false);
    expect(button(row(view, 'lingva'), 'moveInstanceDown').disabled).toBe(true);
    fireEvent.click(button(row(view, 'deepl'), 'moveInstanceDown'));
    await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['google-web', 'lingva', 'deepl']));
    expect(numbers()).toEqual(['1', '2', '3']);
    expect(view.queryByText('draftInstance')).toBeNull();
});

it('explains available fixed providers and distinguishes their configuration choices', () => {
    saved.preferences.fallbackOrder = [];
    const view = render(<Harness />);
    expect(row(view, 'available:google-web').getByText('googleProviderDescription')).toBeTruthy();
    expect(row(view, 'available:lingva').getByText('lingvaProviderDescription')).toBeTruthy();
    expect(row(view, 'available:google-web').getByRole('button', { name: 'addProvider' })).toBeTruthy();
    expect(row(view, 'available:lingva').getByRole('button', { name: 'addProvider' })).toBeTruthy();
    expect(row(view, 'available:deepl').getByText('deepLProviderDescription')).toBeTruthy();
    expect(row(view, 'available:libretranslate').getByText('libreProviderDescription')).toBeTruthy();
    expect(view.container.querySelectorAll('.service-index')).toHaveLength(0);
    expect(view.container.querySelectorAll('#instance-priority .drag-handle')).toHaveLength(0);
    expect(view.queryByText('draftInstance')).toBeNull();
});

it('shows the saved recipient description without confusing it with an unconfigured provider', () => {
    saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'https://home.example' });
    saved.instances.push({ id: 'empty', providerId: 'deepl', name: 'DeepL' });
    saved.instances.push({ id: 'keyed', providerId: 'deepl', name: 'DeepL', credential: { key: 'secret', validated: false } });
    const view = render(<Harness />);
    expect(row(view, 'home').getByText('LibreTranslate · https://home.example')).toBeTruthy();
    expect(row(view, 'deepl').getByText('DeepL · API Free')).toBeTruthy();
    expect(row(view, 'empty').getByText('keyNeeded')).toBeTruthy();
    expect(row(view, 'keyed').queryByText('keyNeeded')).toBeNull();
});

it('keeps a single HTTP warning visible when opening and closing a custom editor', () => {
    saved.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://localhost:5000' });
    const view = render(<Harness />);
    expect(row(view, 'home').getAllByText('httpEndpointWarning').filter(element => !element.closest('[hidden]'))).toHaveLength(1);
    fireEvent.click(button(row(view, 'home'), 'showServiceDetails'));
    expect(row(view, 'home').getAllByText('httpEndpointWarning').filter(element => !element.closest('[hidden]'))).toHaveLength(1);
    fireEvent.click(button(row(view, 'home'), 'showServiceDetails'));
    expect(row(view, 'home').getAllByText('httpEndpointWarning').filter(element => !element.closest('[hidden]'))).toHaveLength(1);
});

it('does not permit deleting a provider choice or an unsaved draft', () => {
    const view = render(<Harness />);
    const choice = within(view.container.querySelector<HTMLElement>('#available-providers [data-catalog-provider="libretranslate"]')!);
    expect(choice.queryByRole('button', { name: 'deleteNamedInstance' })).toBeNull();
    fireEvent.click(button(choice, 'addProvider'));
    expect(view.getByLabelText('instanceName')).toBeTruthy();
    const editor = view.getByLabelText('instanceName').closest('li')!;
    expect(within(editor).queryByRole('button', { name: 'deleteNamedInstance' })).toBeNull();
    expect(button(row(view, 'deepl'), 'showServiceDetails').disabled).toBe(false);
    expect(button(within(view.container.querySelector<HTMLElement>('#available-providers [data-catalog-provider="deepl"]')!), 'addAnother').disabled).toBe(false);
    fireEvent.click(view.getByText('cancel'));
    expect(view.queryByText('draftInstance')).toBeNull();
    expect(button(row(view, 'deepl'), 'showServiceDetails').disabled).toBe(false);
});

it('locks conflicting access operations while leaving independent setup available', async () => {
    saved.preferences.fallbackOrder = ['google-web', 'lingva'];
    saved.instances = saved.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential: { key: 'saved:fx', validated: false } } : instance);
    let finish!: (granted: boolean) => void;
    vi.mocked(chrome.permissions.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Harness />);
    await row(view, 'deepl').findByText('removeAccess');
    expect(button(row(view, 'deepl'), 'removeAccess').disabled).toBe(false);
    expect(button(row(view, 'deepl'), 'deleteNamedInstance').disabled).toBe(false);
    fireEvent.click(row(view, 'deepl').getByRole('button', { name: 'enableInstance' }));
    expect(button(row(view, 'deepl'), 'removeAccess').disabled).toBe(true);
    expect(button(row(view, 'deepl'), 'deleteNamedInstance').disabled).toBe(true);
    expect(button(row(view, 'deepl'), 'showServiceDetails').disabled).toBe(true);
    expect(button(row(view, 'google-web'), 'moveInstanceDown').disabled).toBe(true);
    expect(button(row(view, 'lingva'), 'moveInstanceUp').disabled).toBe(true);
    expect(button(within(view.container.querySelector<HTMLElement>('#available-providers [data-catalog-provider="deepl"]')!), 'addAnother').disabled).toBe(false);
    finish(true);
    await waitFor(() => expect(button(row(view, 'deepl'), 'showServiceDetails').disabled).toBe(false));
});
