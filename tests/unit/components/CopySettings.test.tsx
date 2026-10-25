/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { CopySettings } from '@/entrypoints/options/components/CopySettings';
import { createDefaultSetup } from '@/utils/instances';
import type { SetupUpdate } from '@/entrypoints/options/hooks/usePreferences';

vi.mock('@/utils/storage', () => ({
    getSetup: vi.fn(async () => ({ ...createDefaultSetup(), copyEnabled: enabled })),
    reconcileSetupAccess: vi.fn(async () => {
        if (!enabled) await (await import('@/utils/permissions')).removeCopyAccess();
    }),
}));

let enabled: boolean;
let granted: boolean;
const update = vi.fn();
function Harness() {
    const [intent, setIntent] = useState(enabled);
    return <CopySettings copyEnabled={intent} updateSetup={async (updater: SetupUpdate) => {
        update();
        const next = await updater({ ...createDefaultSetup(), copyEnabled: enabled });
        enabled = next.copyEnabled;
        setIntent(enabled);
        return true;
    }} />;
}
beforeEach(() => {
    vi.clearAllMocks();
    enabled = false;
    granted = false;
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => granted);
    vi.mocked(chrome.permissions.request).mockImplementation(async () => { granted = true; return true; });
    vi.mocked(chrome.permissions.remove).mockImplementation(async () => { granted = false; return true; });
});

describe('copy preference and device permissions', () => {
    it('requests both permissions during the click before persisting enabled intent', async () => {
        const view = render(<Harness />);
        fireEvent.click(view.getByLabelText('enableCopy'));
        expect(chrome.permissions.request).toHaveBeenCalledWith({ permissions: ['clipboardWrite', 'offscreen'] });
        await waitFor(() => expect(enabled).toBe(true));
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(true);
    });

    it('keeps copying off if cleanup removes access while enablement waits to save', async () => {
        const view = render(<CopySettings copyEnabled={false} updateSetup={async updater => {
            granted = false;
            try {
                enabled = (await updater(createDefaultSetup())).copyEnabled;
                return true;
            } catch { return false; }
        }} />);
        fireEvent.click(view.getByLabelText('enableCopy'));
        await view.findByRole('alert');
        expect(enabled).toBe(false);
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(false);
    });


    it('keeps the keyboard toggle focused while saving and ignores repeated activation until it finishes', async () => {
        let finish!: (saved: boolean) => void;
        const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
        const view = render(<CopySettings copyEnabled={false} updateSetup={save} />);
        const checkbox = view.getByLabelText('enableCopy') as HTMLInputElement;
        const user = userEvent.setup();
        checkbox.focus();
        await user.keyboard('[Space]');
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        expect(document.activeElement).toBe(checkbox);
        await user.keyboard('[Space]');
        expect(save).toHaveBeenCalledTimes(1);
        finish(true);
        await waitFor(() => expect(checkbox.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(checkbox);
    });

    it('does not move focus back to the toggle if the user tabs elsewhere while saving', async () => {
        let finish!: (saved: boolean) => void;
        const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
        const view = render(<div><CopySettings copyEnabled={false} updateSetup={save} /><button>Continue</button></div>);
        const checkbox = view.getByLabelText('enableCopy') as HTMLInputElement;
        const user = userEvent.setup();
        checkbox.focus();
        await user.keyboard('[Space]');
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        await user.tab();
        const next = view.getByText('Continue');
        expect(document.activeElement).toBe(next);
        finish(true);
        await waitFor(() => expect(checkbox.getAttribute('aria-busy')).toBe('false'));
        expect(document.activeElement).toBe(next);
    });

    it('leaves copying off after denial and keeps the error through a grant refresh', async () => {
        vi.mocked(chrome.permissions.request).mockImplementation(async () => false);
        const view = render(<Harness />);
        fireEvent.click(view.getByLabelText('enableCopy'));
        await view.findByRole('alert');
        expect(enabled).toBe(false);
        expect(update).not.toHaveBeenCalled();
        vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls.at(-1)![0]({});
        await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    });


    it('releases a new grant if enabled intent cannot be saved', async () => {
        const view = render(<CopySettings copyEnabled={false} updateSetup={async () => false} />);
        fireEvent.click(view.getByLabelText('enableCopy'));
        await view.findByRole('alert');
        expect(granted).toBe(false);
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(false);
    });

    it('shows enabled synced intent needing access and repairs only this device grant', async () => {
        enabled = true;
        const view = render(<Harness />);
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(true);
        fireEvent.click(await view.findByText('grantAccess'));
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        expect(update).not.toHaveBeenCalled();
        expect(enabled).toBe(true);
    });

    it('persists disabled intent before releasing permissions', async () => {
        enabled = true;
        granted = true;
        const view = render(<Harness />);
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        vi.mocked(chrome.permissions.remove).mockImplementation(async () => { expect(enabled).toBe(false); granted = false; return true; });
        fireEvent.click(view.getByLabelText('enableCopy'));
        await waitFor(() => expect(chrome.permissions.remove).toHaveBeenCalledWith({ permissions: ['clipboardWrite', 'offscreen'] }));
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(false);
    });

    it('refreshes revoked access without changing shared intent and removes listeners', async () => {
        enabled = true;
        granted = true;
        const view = render(<Harness />);
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        const listener = vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls.at(-1)![0];
        granted = false;
        listener({});
        await view.findByText('grantAccess');
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(true);
        expect(update).not.toHaveBeenCalled();
        view.unmount();
        await waitFor(() => expect(chrome.permissions.onRemoved.removeListener).toHaveBeenCalledWith(listener));
    });
});
