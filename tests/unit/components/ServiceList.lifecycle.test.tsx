/** @vitest-environment jsdom */
import Sortable from 'sortablejs';
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
let writes = 0;
function Harness() {
    const [setup, setSetup] = useState(saved);
    const updateSetup = async (updater: SetupUpdate) => {
        ++writes;
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
    writes = 0;
    saved = createLegacySetup();
    saved.instances = saved.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: 'Work' } : instance);
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    vi.mocked(chrome.permissions.request).mockImplementation(async () => true);
});
afterEach(async () => { await act(() => cleanup()); });

it('keeps another account editor open when deleting an unrelated configuration', async () => {
    saved.instances.push({ id: 'other', providerId: 'deepl', name: 'Other' });
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'deepl'), 'showServiceDetails'));
    fireEvent.click(button(row(view, 'other'), 'deleteNamedInstance'));
    await waitFor(() => expect(button(row(view, 'other'), 'deleteInstance')).toBeTruthy());
    await act(async () => { fireEvent.click(button(row(view, 'other'), 'deleteInstance')); });
    await waitFor(() => expect(saved.instances.some(instance => instance.id === 'other')).toBe(false));
    expect((view.getByLabelText('instanceName') as HTMLInputElement).value).toBe('Work');
});

it('keeps the latest permission refresh when an earlier check finishes late', async () => {
    const view = render(<Harness />);
    await row(view, 'google-web').findByText('providerReady');
    const refresh = vi.mocked(chrome.permissions.onAdded.addListener).mock.calls.at(-1)![0];
    let finish!: (granted: boolean) => void;
    vi.mocked(chrome.permissions.contains).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => {
        const old = refresh({ origins: ['https://translate.googleapis.com/*'] });
        await refresh({ origins: ['https://translate.googleapis.com/*'] });
        finish(false);
        await old;
    });
    expect(row(view, 'google-web').getByText('providerReady')).toBeTruthy();
    expect(row(view, 'google-web').queryByText('grantAccess')).toBeNull();
});

it('moves a dragged last account to the front without displacing the intervening account', async () => {
    saved.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
    render(<Harness />);
    const options = vi.mocked(Sortable.create).mock.calls.at(-1)![1]!;
    options.onEnd?.({ oldDraggableIndex: 2, newDraggableIndex: 0 } as Sortable.SortableEvent);
    await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['lingva', 'google-web', 'deepl']));
});

it('disables drag animation for reduced motion while preserving reordering', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) });
    try {
        saved.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
        const view = render(<Harness />);
        const options = vi.mocked(Sortable.create).mock.calls.at(-1)![1]!;
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
        expect(options.animation).toBe(0);
        options.onEnd?.({ oldDraggableIndex: 2, newDraggableIndex: 0 } as Sortable.SortableEvent);
        await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['lingva', 'google-web', 'deepl']));
        expect(Array.from(view.container.querySelectorAll('#instance-priority [data-id]')).map(element => element.getAttribute('data-id')))
            .toEqual(['lingva', 'google-web', 'deepl']);
    } finally {
        if (original) Object.defineProperty(window, 'matchMedia', original);
        else Reflect.deleteProperty(window, 'matchMedia');
    }
});

it.each([
    { oldDraggableIndex: undefined, newDraggableIndex: 1 },
    { oldDraggableIndex: 0, newDraggableIndex: undefined },
    { oldDraggableIndex: 0, newDraggableIndex: 0 },
])('ignores a drag completion without a changed pair of sortable indices: %j', async event => {
    saved.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
    const before = structuredClone(saved);
    render(<Harness />);
    const options = vi.mocked(Sortable.create).mock.calls.at(-1)![1]!;
    await act(async () => { options.onEnd?.(event as Sortable.SortableEvent); });
    expect(saved).toEqual(before);
    expect(writes).toBe(0);
});

it('preserves an untouched DeepL slot when saving a new LibreTranslate configuration', async () => {
    saved = createLegacySetup();
    const original = structuredClone(saved.instances.find(instance => instance.id === 'deepl'));
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'available:libretranslate'), 'addProvider'));
    fireEvent.click(view.getByText('saveForLater'));
    await waitFor(() => expect(writes).toBeGreaterThan(0));
    expect(saved.instances.find(instance => instance.id === 'deepl')).toEqual(original);
    expect(saved.instances.some(instance => instance.providerId === 'libretranslate')).toBe(true);
});

it('adds another DeepL account when the original slot is already configured', async () => {
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'available:deepl'), 'addAnother'));
    fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Second' } });
    fireEvent.click(view.getByText('saveForLater'));
    await waitFor(() => expect(writes).toBeGreaterThan(0));
    expect(saved.instances.filter(instance => instance.providerId === 'deepl').map(instance => instance.name)).toEqual(['Work', 'Second']);
});

it('replaces the untouched DeepL default when another provider draft is also open', async () => {
    saved = createLegacySetup();
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'available:deepl'), 'addProvider'));
    fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Personal' } });
    fireEvent.click(button(row(view, 'available:libretranslate'), 'addProvider'));
    fireEvent.click(row(view, 'available:deepl').getByText('saveForLater'));
    await waitFor(() => expect(saved.instances.filter(instance => instance.providerId === 'deepl').map(instance => instance.name)).toEqual(['Personal']));
    expect(row(view, 'available:libretranslate').getByLabelText('instanceName')).toBeTruthy();
});

it.each(['deepl', 'libretranslate'] as const)('uses Add to reopen and focus the existing %s draft without replacing its values', async provider => {
    const view = render(<Harness />);
    const scope = row(view, `available:${provider}`);
    const addLabel = provider === 'deepl' ? 'addAnother' : 'addProvider';
    fireEvent.click(button(scope, addLabel));
    const name = scope.getByLabelText('instanceName') as HTMLInputElement;
    const key = scope.getByLabelText('apiKeyLabel') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Unfinished account' } });
    fireEvent.input(key, { target: { value: 'draft-only-key' } });
    expect(button(scope, addLabel).disabled).toBe(false);
    fireEvent.click(button(scope, addLabel));
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.value).toBe('Unfinished account');
    expect(key.value).toBe('draft-only-key');
    const disclosure = button(scope, 'showServiceDetails');
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button(scope, addLabel));
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(scope.getAllByLabelText('instanceName')).toHaveLength(1);
    expect(name.value).toBe('Unfinished account');
    expect(key.value).toBe('draft-only-key');
    expect(writes).toBe(0);
    expect(chrome.permissions.request).not.toHaveBeenCalled();
});
