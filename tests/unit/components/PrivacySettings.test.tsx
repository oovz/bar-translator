/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { PrivacySettings } from '@/entrypoints/options/components/PrivacySettings';
import { createDefaultSetup } from '@/utils/instances';
import type { SetupConflict } from '@/src/types';

function props() {
    return { storageType: 'local' as const, changingStorage: false, changeStorageType: vi.fn().mockResolvedValue(undefined) };
}
function conflict(): SetupConflict {
    const source = createDefaultSetup();
    source.instances.push({ id: 'secret', providerId: 'deepl', name: 'Work', credential: { key: 'never-display-this', validated: false } });
    const destination = createDefaultSetup();
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
});
