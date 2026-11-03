/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/preact';
import { PrivacySettings } from '@/entrypoints/options/components/PrivacySettings';
import { createLegacySetup } from '@/tests/fixtures/legacy-setup';
import type { CredentialStorageType, SetupConflict } from '@/src/types';

function props() {
    return { storageType: 'local' as const, changingStorage: false, changeStorageType: vi.fn().mockResolvedValue(undefined) };
}
function conflict(): SetupConflict {
    const source = createLegacySetup();
    source.instances.push({ id: 'secret', providerId: 'deepl', name: 'Work', credential: { key: 'never-display-this', validated: false } });
    const destination = createLegacySetup();
    destination.preferences.defaultTargetLang = 'fr';
    return { token: 'opaque', source, destination, destinationStorage: 'sync', reason: 'switch' };
}

describe('whole-setup storage settings', () => {
    it('shows failure, preserves the selected source, and lets the user retry', async () => {
        const options = props();
        options.changeStorageType.mockRejectedValueOnce(new Error('Storage unavailable'));
        const view = render(<PrivacySettings {...options} />);
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'sync' } });
        await view.findByRole('alert');
        expect(select.value).toBe('local');
        expect(options.changeStorageType).toHaveBeenCalledWith('sync', undefined);
        fireEvent.click(view.getByText('retry'));
        await vi.waitFor(() => expect(view.queryByRole('alert')).toBeNull());
        expect(options.changeStorageType).toHaveBeenCalledTimes(2);
    });

    it('disables storage selection while a change is pending', () => {
        const view = render(<PrivacySettings {...props()} changingStorage />);
        expect((view.getByLabelText('labelStorage') as HTMLSelectElement).disabled).toBe(true);
    });

    it.each(['use-destination', 'replace-destination'] as const)('requires an explicit %s decision without exposing credentials', choice => {
        const options = props();
        const value = conflict();
        const view = render(<PrivacySettings {...options} conflict={value} />);
        expect(options.changeStorageType).not.toHaveBeenCalled();
        expect(view.container.textContent).not.toContain('never-display-this');
        fireEvent.click(view.getByText(choice === 'use-destination' ? 'useSavedSetup' : 'replaceSavedSetup'));
        expect(options.changeStorageType).toHaveBeenCalledWith('sync', { token: 'opaque', choice });
    });

    it('uses the refreshed comparison token when a conflict is updated', () => {
        const options = props();
        const value = conflict();
        const view = render(<PrivacySettings {...options} conflict={value} />);
        view.rerender(<PrivacySettings {...options} conflict={{ ...value, token: 'new-revision' }} />);
        fireEvent.click(view.getByText('useSavedSetup'));
        expect(options.changeStorageType).toHaveBeenCalledWith('sync', { token: 'new-revision', choice: 'use-destination' });
    });
    it('distinguishes current and saved language pairs and ordered provider identities in the comparison', () => {
        const value = conflict();
        value.source.preferences.defaultSourceLang = 'en';
        value.source.preferences.defaultTargetLang = 'ja';
        value.source.preferences.fallbackOrder = ['secret', 'google-web'];
        value.destination.preferences.defaultSourceLang = 'auto';
        value.destination.preferences.defaultTargetLang = 'fr';
        value.destination.preferences.fallbackOrder = ['lingva', 'deepl'];
        const view = render(<PrivacySettings {...props()} conflict={value} />);
        const current = within(view.getByText('currentSetup').parentElement!);
        const saved = within(view.getByText('savedSetup').parentElement!);
        expect(current.getByText('en → ja')).toBeTruthy();
        expect(current.getByText('Work → Google Web')).toBeTruthy();
        expect(saved.getByText('auto → fr')).toBeTruthy();
        expect(saved.getByText('Lingva → DeepL')).toBeTruthy();
        expect(current.queryByText('Lingva → DeepL')).toBeNull();
        expect(saved.queryByText('Work → Google Web')).toBeNull();
        expect(view.container.textContent).not.toContain('never-display-this');
    });

    it('shows the selected storage mode warning as the user switches between local and sync', async () => {
        function StorageSelection() {
            const [mode, setMode] = useState<CredentialStorageType>('local');
            return <PrivacySettings storageType={mode} changingStorage={false} changeStorageType={async next => { setMode(next); }} />;
        }
        const view = render(<StorageSelection />);
        const user = userEvent.setup();
        expect(view.getByText('storageLocalHint')).toBeTruthy();
        expect(view.queryByText('storageSyncWarning')).toBeNull();
        await user.selectOptions(view.getByLabelText('labelStorage'), 'sync');
        expect(view.getByText('storageSyncWarning')).toBeTruthy();
        expect(view.queryByText('storageLocalHint')).toBeNull();
        await user.selectOptions(view.getByLabelText('labelStorage'), 'local');
        expect(view.getByText('storageLocalHint')).toBeTruthy();
        expect(view.queryByText('storageSyncWarning')).toBeNull();
    });

    it('tabs directly to the storage control rather than making the section an extra stop', async () => {
        const view = render(<div><button>Before</button><PrivacySettings {...props()} /><button>After</button></div>);
        const user = userEvent.setup();
        await user.tab();
        expect(document.activeElement).toBe(view.getByText('Before'));
        await user.tab();
        expect(document.activeElement).toBe(view.getByLabelText('labelStorage'));
        await user.tab();
        expect(document.activeElement).toBe(view.getByText('After'));
    });

});
