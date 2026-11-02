/** @vitest-environment jsdom */
import Sortable from 'sortablejs';
import { useState } from 'preact/hooks';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceList } from '@/entrypoints/options/components/ServiceList';
import { createDefaultSetup } from '@/utils/instances';
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
        saved = await updater(structuredClone(saved));
        setSetup(saved);
        return true;
    };
    return <ServiceList setup={setup} updateSetup={updateSetup} />;
}
function row(view: { container: Element }, id: string) {
    return within(view.container.querySelector<HTMLElement>(`[data-id="${id}"]`)!);
}
function button(scope: ReturnType<typeof within>, name: string) {
    return scope.getByRole('button', { name }) as HTMLButtonElement;
}
beforeEach(() => {
    vi.clearAllMocks();
    writes = 0;
    saved = createDefaultSetup();
    saved.instances = saved.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: 'Work' } : instance);
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    vi.mocked(chrome.permissions.request).mockImplementation(async () => true);
});
afterEach(async () => { await act(() => cleanup()); });

it('keeps another account editor open when deleting an unrelated configuration', async () => {
    saved.instances.push({ id: 'other', providerId: 'deepl', name: 'Other' });
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'deepl'), 'configureNamedInstance'));
    await act(async () => { fireEvent.click(button(row(view, 'other'), 'deleteNamedInstance')); });
    await waitFor(() => expect(saved.instances.some(instance => instance.id === 'other')).toBe(false));
    expect((view.getByLabelText('instanceName') as HTMLInputElement).value).toBe('Work');
});

it('keeps the latest permission refresh when an earlier check finishes late', async () => {
    const view = render(<Harness />);
    await row(view, 'google-web').findByLabelText('providerReady');
    const refresh = vi.mocked(chrome.permissions.onAdded.addListener).mock.calls.at(-1)![0];
    let finish!: (granted: boolean) => void;
    vi.mocked(chrome.permissions.contains).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => {
        const old = refresh({ origins: ['https://translate.googleapis.com/*'] });
        await refresh({ origins: ['https://translate.googleapis.com/*'] });
        finish(false);
        await old;
    });
    expect(row(view, 'google-web').getByLabelText('providerReady')).toBeTruthy();
    expect(row(view, 'google-web').queryByText('grantAccess')).toBeNull();
});

it('moves a dragged last account to the front without displacing the intervening account', async () => {
    saved.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
    render(<Harness />);
    const options = vi.mocked(Sortable.create).mock.calls.at(-1)![1]!;
    options.onEnd?.({ oldDraggableIndex: 2, newDraggableIndex: 0 } as Sortable.SortableEvent);
    await waitFor(() => expect(saved.preferences.fallbackOrder).toEqual(['lingva', 'google-web', 'deepl']));
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
    saved = createDefaultSetup();
    const original = structuredClone(saved.instances.find(instance => instance.id === 'deepl'));
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'available:libretranslate'), 'configureNamedInstance'));
    fireEvent.click(view.getByText('saveInstance'));
    await view.findByText('instanceSaved');
    expect(saved.instances.find(instance => instance.id === 'deepl')).toEqual(original);
    expect(saved.instances.some(instance => instance.providerId === 'libretranslate')).toBe(true);
});

it('adds another DeepL account when the original slot is already configured', async () => {
    const view = render(<Harness />);
    fireEvent.click(button(row(view, 'available:deepl'), 'addProviderInstance'));
    fireEvent.input(view.getByLabelText('instanceName'), { target: { value: 'Second' } });
    fireEvent.click(view.getByText('saveInstance'));
    await view.findByText('instanceSaved');
    expect(saved.instances.filter(instance => instance.providerId === 'deepl').map(instance => instance.name)).toEqual(['Work', 'Second']);
});
