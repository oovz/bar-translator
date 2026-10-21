/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { CopySettings } from '@/entrypoints/options/components/CopySettings';

describe('copy permissions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        vi.mocked(chrome.permissions.request).mockImplementation(async () => true);
        vi.mocked(chrome.permissions.remove).mockImplementation(async () => true);
    });

    it('requests both permissions from a click and displays the resulting grant', async () => {
        const view = render(<CopySettings />);
        const checkbox = view.getByLabelText('enableCopy') as HTMLInputElement;
        await waitFor(() => expect(chrome.permissions.contains).toHaveBeenCalled());
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        fireEvent.click(checkbox);
        expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['clipboardWrite', 'offscreen'] });
        await waitFor(() => expect(checkbox.checked).toBe(true));
    });

    it('leaves copying off and shows a persistent alert after denial', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => false);
        const view = render(<CopySettings />);
        fireEvent.click(view.getByLabelText('enableCopy'));
        await view.findByRole('alert');
        expect(view.getByText('permissionDenied')).toBeTruthy();
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(false);
        vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls.at(-1)![0]({});
        await waitFor(() => expect(view.getByRole('alert').textContent).toBe('permissionDenied'));
    });

    it('removes both permissions when disabled', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        const view = render(<CopySettings />);
        const checkbox = view.getByLabelText('enableCopy') as HTMLInputElement;
        await waitFor(() => expect(checkbox.checked).toBe(true));
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        fireEvent.click(checkbox);
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ permissions: ['clipboardWrite', 'offscreen'] }));
        await waitFor(() => expect(checkbox.checked).toBe(false));
    });

    it('refreshes revoked access and removes listeners on unmount', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        const view = render(<CopySettings />);
        const checkbox = view.getByLabelText('enableCopy') as HTMLInputElement;
        await waitFor(() => expect(checkbox.checked).toBe(true));
        const listener = vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls.at(-1)![0];
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        listener({});
        await waitFor(() => expect(checkbox.checked).toBe(false));
        view.unmount();
        await waitFor(() => expect(chrome.permissions.onRemoved.removeListener).toHaveBeenCalledWith(listener));
    });
});
