/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/preact';
import { usePreferences } from '@/entrypoints/options/hooks/usePreferences';
import { createDefaultSetup } from '@/utils/instances';
import { getSetupState, retrySetupMigration, switchSetupStorage, updateSetup } from '@/utils/storage';
import type { SetupState } from '@/src/types';

vi.mock('@/utils/storage', () => ({
    getSetupState: vi.fn(), retrySetupMigration: vi.fn(), switchSetupStorage: vi.fn(),
    updateSetup: vi.fn(), isSetupStorageChange: vi.fn(() => true),
}));

function state(target: string): SetupState {
    const setup = createDefaultSetup();
    setup.preferences.defaultTargetLang = target;
    return { setup, storageType: 'local' };
}

function pending<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSetupState).mockResolvedValue(state('en'));
});
afterEach(async () => { await act(() => cleanup()); });

describe('preferences request ownership', () => {
    it('reports loading until the initial stored setup arrives', async () => {
        const read = pending<SetupState>();
        vi.mocked(getSetupState).mockReturnValueOnce(read.promise);
        const { result } = renderHook(usePreferences);
        expect(result.current.loading).toBe(true);
        expect(result.current.ready).toBe(false);
        await waitFor(() => expect(getSetupState).toHaveBeenCalledOnce());
        expect(result.current.loading).toBe(true);
        await act(async () => { read.resolve(state('fr')); await read.promise; });
        expect(result.current.loading).toBe(false);
        expect(result.current.ready).toBe(true);
        expect(result.current.preferences.defaultTargetLang).toBe('fr');
    });

    it('does not let an older read replace a newer saved setup', async () => {
        const read = pending<SetupState>();
        vi.mocked(getSetupState).mockReturnValueOnce(read.promise);
        const saved = state('fr').setup;
        vi.mocked(updateSetup).mockResolvedValueOnce(saved);
        const { result } = renderHook(usePreferences);
        await waitFor(() => expect(getSetupState).toHaveBeenCalledOnce());
        await act(async () => {
            expect(await result.current.updateSetup(() => saved)).toBe(true);
            read.resolve(state('de'));
            await read.promise;
        });
        expect(result.current.setup.preferences.defaultTargetLang).toBe('fr');
    });

    it('keeps the latest refresh when earlier reads finish later', async () => {
        const { result } = renderHook(usePreferences);
        await waitFor(() => expect(result.current.ready).toBe(true));
        const earlier = pending<SetupState>();
        vi.mocked(getSetupState).mockReturnValueOnce(earlier.promise).mockResolvedValueOnce(state('fr'));
        await act(async () => {
            const old = result.current.reload();
            await result.current.reload();
            earlier.resolve(state('de'));
            await old;
        });
        expect(result.current.preferences.defaultTargetLang).toBe('fr');
        expect(result.current.error).toBeNull();
    });

    it('returns false for a failed save and keeps the last loaded setup', async () => {
        const { result } = renderHook(usePreferences);
        await waitFor(() => expect(result.current.ready).toBe(true));
        vi.mocked(updateSetup).mockRejectedValueOnce(new Error('Write failed'));
        await act(async () => expect(await result.current.updateSetup(current => current)).toBe(false));
        expect(result.current.error).toBe('settingsSaveFailed');
        expect(result.current.preferences.defaultTargetLang).toBe('en');
    });

    it('reloads authoritative state after a late storage-switch failure and rejects the command', async () => {
        const { result } = renderHook(usePreferences);
        await waitFor(() => expect(result.current.ready).toBe(true));
        vi.mocked(switchSetupStorage).mockRejectedValueOnce(new Error('Late error'));
        vi.mocked(getSetupState).mockResolvedValueOnce({ ...state('fr'), storageType: 'sync' });
        await act(async () => {
            await expect(result.current.changeStorageType('sync')).rejects.toThrow('storageChangeFailed');
        });
        expect(result.current.storageType).toBe('sync');
        expect(result.current.preferences.defaultTargetLang).toBe('fr');
        expect(result.current.changingStorage).toBe(false);
    });

    it('retries migration through the explicit command', async () => {
        const { result } = renderHook(usePreferences);
        await waitFor(() => expect(result.current.ready).toBe(true));
        vi.mocked(retrySetupMigration).mockResolvedValueOnce(state('fr'));
        await act(async () => { await result.current.retryMigration(); });
        expect(retrySetupMigration).toHaveBeenCalledOnce();
        expect(result.current.preferences.defaultTargetLang).toBe('fr');
    });

    it('isolates pending work from a later mounted settings view', async () => {
        const oldRead = pending<SetupState>();
        vi.mocked(getSetupState).mockReturnValueOnce(oldRead.promise);
        const first = renderHook(usePreferences);
        await waitFor(() => expect(getSetupState).toHaveBeenCalledOnce());
        const listener = vi.mocked(chrome.storage.onChanged.addListener).mock.calls.at(-1)![0];
        first.unmount();
        await waitFor(() => expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener));
        const second = renderHook(usePreferences);
        await waitFor(() => expect(second.result.current.ready).toBe(true));
        await act(async () => { oldRead.resolve(state('de')); await oldRead.promise; });
        expect(second.result.current.preferences.defaultTargetLang).toBe('en');
    });
});
