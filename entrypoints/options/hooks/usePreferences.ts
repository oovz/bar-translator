import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getSetupState, retrySetupMigration, isSetupStorageChange, switchSetupStorage, updateSetup as persistSetup } from '@/utils/storage';
import { createDefaultSetup } from '@/utils/instances';
import type { CredentialStorageType, SetupResolution, SetupState, TranslationSetup, UserPreferences } from '@/src/types';
import { t } from '@/utils/i18n';

export type PreferenceUpdate = Partial<UserPreferences> | ((current: UserPreferences) => Partial<UserPreferences>);
export type SetupUpdate = (current: TranslationSetup) => TranslationSetup | Promise<TranslationSetup>;

export function usePreferences() {
    const [state, setState] = useState<SetupState>({ setup: createDefaultSetup(), storageType: 'local' });
    const [changingStorage, setChangingStorage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const revision = useRef(0);
    const active = useRef(true);

    const refresh = useCallback(async (retryMigration = false) => {
        const request = ++revision.current;
        try {
            const next = await (retryMigration ? retrySetupMigration() : getSetupState());
            if (active.current && request === revision.current) { setState(next); setReady(true); setError(null); }
        } catch {
            if (active.current && request === revision.current) setError(t('settingsLoadFailed'));
        } finally {
            if (active.current && request === revision.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        active.current = true;
        void refresh();
        const changed = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
            if (isSetupStorageChange(changes, areaName)) void refresh();
        };
        chrome.storage.onChanged.addListener(changed);
        return () => {
            active.current = false;
            ++revision.current;
            chrome.storage.onChanged.removeListener(changed);
        };
    }, [refresh]);

    const updateSetup = useCallback(async (updater: SetupUpdate): Promise<boolean> => {
        setError(null);
        const request = ++revision.current;
        try {
            const setup = await persistSetup(updater);
            if (active.current && request === revision.current) setState(current => ({ ...current, setup }));
            return true;
        } catch {
            if (active.current) setError(t('settingsSaveFailed'));
            return false;
        }
    }, []);

    const updatePreferences = useCallback((updates: PreferenceUpdate) => updateSetup(current => ({
        ...current,
        preferences: {
            ...current.preferences,
            ...(typeof updates === 'function' ? updates(current.preferences) : updates),
        },
    })), [updateSetup]);

    const changeStorageType = useCallback(async (nextType: CredentialStorageType, resolution?: SetupResolution) => {
        setChangingStorage(true);
        setError(null);
        const request = ++revision.current;
        try {
            const next = await switchSetupStorage(nextType, resolution);
            if (active.current && request === revision.current) setState(next);
        } catch {
            // A read may recover a committed selection after a late write error.
            await refresh();
            throw new Error(t('storageChangeFailed'));
        } finally {
            if (active.current) setChangingStorage(false);
        }
    }, [refresh]);

    return {
        setup: state.setup,
        preferences: state.setup.preferences,
        storageType: state.storageType,
        conflict: state.conflict,
        migrationError: state.migrationError,
        changingStorage,
        changeStorageType,
        loading,
        ready,
        reload: refresh,
        retryMigration: () => refresh(true),
        error,
        updateSetup,
        updatePreferences,
    };
}
