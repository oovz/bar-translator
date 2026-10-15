import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { PrivacySettings } from '@/entrypoints/options/components/PrivacySettings';

function props() {
    return { storageType: 'local' as const, changingStorage: false, changeStorageType: vi.fn().mockResolvedValue(undefined) };
}

describe('PrivacySettings Component', () => {
    it('renders an accessible local storage selector and privacy information', () => {
        const view = render(<PrivacySettings {...props()} />);
        expect((view.getByLabelText('labelStorage') as HTMLSelectElement).value).toBe('local');
        expect(view.getByText('privacyDesc')).toBeTruthy();
        expect(view.container.querySelector('input[type="checkbox"]')).toBeNull();
        expect(view.container.querySelector('span[title="storageDesc"]')).toBeTruthy();
    });

    it('shows failure, preserves the selected source, and lets the user retry', async () => {
        const options = props();
        options.changeStorageType.mockRejectedValueOnce(new Error('Storage unavailable'));
        const view = render(<PrivacySettings {...options} />);
        const select = view.getByLabelText('labelStorage') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'sync' } });
        await view.findByRole('alert');
        expect(select.value).toBe('local');
        expect(options.changeStorageType).toHaveBeenCalledWith('sync');
        fireEvent.click(view.getByText('retry'));
        await vi.waitFor(() => expect(view.queryByRole('alert')).toBeNull());
        expect(options.changeStorageType).toHaveBeenCalledTimes(2);
    });

    it('disables storage selection while a change is pending', () => {
        const view = render(<PrivacySettings {...props()} changingStorage />);
        expect((view.getByLabelText('labelStorage') as HTMLSelectElement).disabled).toBe(true);
    });
});
