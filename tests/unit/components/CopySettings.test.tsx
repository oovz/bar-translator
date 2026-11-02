/** @vitest-environment jsdom */
import { useState } from 'preact/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { CopySettings } from '@/entrypoints/options/components/CopySettings';
import { createDefaultSetup } from '@/utils/instances';
import type { TranslationSetup } from '@/src/types';
import type { SetupUpdate } from '@/entrypoints/options/hooks/usePreferences';

vi.mock('@/utils/storage', () => ({
    getSetup: vi.fn(async () => ({ ...createDefaultSetup(), copyEnabled: enabled })),
    reconcileSetupAccess: vi.fn(async (previous: TranslationSetup) => {
        if (previous.copyEnabled && !enabled) await (await import('@/utils/permissions')).removeCopyAccess();
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
        await waitFor(() => expect(view.getByLabelText('enableCopy').getAttribute('aria-busy')).toBe('false'));
        expect(view.queryByRole('alert')).toBeNull();
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
    it('keeps the section out of sequential keyboard navigation while retaining its usable toggle', async () => {
        const view = render(<div><button>Before</button><Harness /><button>After</button></div>);
        const user = userEvent.setup();
        await user.tab();
        expect(document.activeElement).toBe(view.getByText('Before'));
        await user.tab();
        expect(document.activeElement).toBe(view.getByLabelText('enableCopy'));
        await user.tab();
        expect(document.activeElement).toBe(view.getByText('After'));
    });

    it('shows missing device access while its initial check is pending and allows requesting it', async () => {
        enabled = true;
        let finishCheck!: (value: boolean) => void;
        vi.mocked(chrome.permissions.contains).mockImplementationOnce(() => new Promise(resolve => { finishCheck = resolve; }));
        const view = render(<Harness />);
        expect(view.getByText('providerPermissionRequired')).toBeTruthy();
        await userEvent.setup().click(view.getByText('grantAccess'));
        expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        expect(view.queryByText('providerPermissionRequired')).toBeNull();
        expect(view.queryByRole('alert')).toBeNull();
        await act(() => finishCheck(true));
    });

    it('does not show a permission warning while copy is disabled, even with a retained grant', async () => {
        granted = true;
        const view = render(<Harness />);
        await act(async () => {});
        expect(view.queryByText('providerPermissionRequired')).toBeNull();
        expect(view.queryByText('grantAccess')).toBeNull();
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(false);
    });

    it('prevents repeated permission repair clicks while the browser request is pending', async () => {
        enabled = true;
        let finish!: (value: boolean) => void;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const view = render(<Harness />);
        const button = await view.findByText('grantAccess');
        const user = userEvent.setup();
        await user.click(button);
        await user.click(button);
        expect(chrome.permissions.request).toHaveBeenCalledTimes(1);
        granted = true;
        await act(() => finish(true));
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        expect(view.queryByRole('alert')).toBeNull();
    });

    it.each([
        { reported: false, actual: true },
        { reported: true, actual: false },
    ])('rejects permission repair unless both the request and actual grant agree: %j', async ({ reported, actual }) => {
        enabled = true;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(async () => { granted = actual; return reported; });
        const view = render(<Harness />);
        await userEvent.setup().click(await view.findByText('grantAccess'));
        await view.findByText('permissionDenied');
        expect(enabled).toBe(true);
        expect(update).not.toHaveBeenCalled();
    });

    it('allows repairing access again after denial, then disabling copy after success', async () => {
        enabled = true;
        vi.mocked(chrome.permissions.request).mockImplementationOnce(async () => false);
        const view = render(<Harness />);
        const user = userEvent.setup();
        await user.click(await view.findByText('grantAccess'));
        await view.findByText('permissionDenied');
        await user.click(view.getByText('grantAccess'));
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        expect(chrome.permissions.request).toHaveBeenCalledTimes(2);
        expect(view.queryByRole('alert')).toBeNull();
        await user.click(view.getByLabelText('enableCopy'));
        await waitFor(() => expect(enabled).toBe(false));
        expect(granted).toBe(false);
    });

    it('keeps the latest permission refresh when an older check completes afterward', async () => {
        enabled = true;
        let finishOld!: (value: boolean) => void;
        vi.mocked(chrome.permissions.contains).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
        const view = render(<Harness />);
        const listener = vi.mocked(chrome.permissions.onRemoved.addListener).mock.calls.at(-1)![0];
        granted = false;
        await act(async () => { listener({}); });
        await view.findByText('grantAccess');
        await act(async () => { finishOld(true); });
        expect(view.getByText('grantAccess')).toBeTruthy();
        expect(view.getByText('providerPermissionRequired')).toBeTruthy();
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(true);
    });

    it('reports permissions that remain granted after the saved preference is disabled', async () => {
        enabled = true;
        granted = true;
        vi.mocked(chrome.permissions.remove).mockImplementationOnce(async () => true);
        const view = render(<Harness />);
        await waitFor(() => expect(view.queryByText('grantAccess')).toBeNull());
        await userEvent.setup().click(view.getByLabelText('enableCopy'));
        await view.findByText('permissionRemoveFailed');
        expect(enabled).toBe(false);
        expect(granted).toBe(true);
        expect((view.getByLabelText('enableCopy') as HTMLInputElement).checked).toBe(false);
    });

});
