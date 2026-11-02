import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getSetupState, retrySetupMigration, isSetupStorageChange, switchSetupStorage, updateSetup as persistSetup } from '@/utils/storage';
import { createDefaultSetup } from '@/utils/instances';
import type { CredentialStorageType, SetupResolution, SetupState, TranslationSetup, UserPreferences } from '@/src/types';
import { t } from '@/utils/i18n';

export type PreferenceUpdate = Partial<UserPreferences> | ((current: UserPreferences) => Partial<UserPreferences>);
export type SetupUpdate = (current: TranslationSetup) => TranslationSetup | Promise<TranslationSetup>;

interface PreferencesView {
    state: SetupState;
    changingStorage: boolean;
    loading: boolean;
    ready: boolean;
    error: string | null;
}

/** Reads and writes share one generation so an older operation cannot replace a newer setup. */
class PreferencesSession {
    private revision = 0;
    private active = true;

    constructor(private view: PreferencesView, private readonly publish: (view: PreferencesView) => void) {}

    activate(): void { this.active = true; }
    dispose(): void { this.active = false; ++this.revision; }

    private apply(patch: Partial<PreferencesView>): void {
        this.view = { ...this.view, ...patch };
        this.publish(this.view);
    }

    private applyCurrent(request: number, patch: Partial<PreferencesView>): void {
        if (this.active && request === this.revision) this.apply(patch);
    }

    async refresh(retryMigration = false): Promise<void> {
        const request = ++this.revision;
        try {
            const state = await (retryMigration ? retrySetupMigration() : getSetupState());
            this.applyCurrent(request, { state, ready: true, error: null });
        } catch {
            this.applyCurrent(request, { error: t('settingsLoadFailed') });
        } finally {
            this.applyCurrent(request, { loading: false });
        }
    }

    async updateSetup(updater: SetupUpdate): Promise<boolean> {
        this.apply({ error: null });
        const request = ++this.revision;
        try {
            const setup = await persistSetup(updater);
            this.applyCurrent(request, { state: { ...this.view.state, setup } });
            return true;
        } catch {
            if (this.active) this.apply({ error: t('settingsSaveFailed') });
            return false;
        }
    }

    async changeStorageType(nextType: CredentialStorageType, resolution?: SetupResolution): Promise<void> {
        this.apply({ changingStorage: true, error: null });
        const request = ++this.revision;
        try {
            const state = await switchSetupStorage(nextType, resolution);
            this.applyCurrent(request, { state });
        } catch {
            // A read may recover a committed selection after a late write error.
            await this.refresh();
            throw new Error(t('storageChangeFailed'));
        } finally {
            if (this.active) this.apply({ changingStorage: false });
        }
    }
}

function initialView(): PreferencesView {
    return {
        state: { setup: createDefaultSetup(), storageType: 'local' },
        changingStorage: false, loading: true, ready: false, error: null,
    };
}

export function usePreferences() {
    const [view, publish] = useState(initialView);
    const sessionRef = useRef<PreferencesSession | null>(null);
    if (!sessionRef.current) sessionRef.current = new PreferencesSession(view, publish);
    const session = sessionRef.current;
    const refresh = useCallback((retryMigration = false) => session.refresh(retryMigration), [session]);
    const updateSetup = useCallback((updater: SetupUpdate) => session.updateSetup(updater), [session]);
    const changeStorageType = useCallback((nextType: CredentialStorageType, resolution?: SetupResolution) =>
        session.changeStorageType(nextType, resolution), [session]);

    useEffect(() => {
        session.activate();
        void refresh();
        const changed = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
            if (isSetupStorageChange(changes, areaName)) void refresh();
        };
        chrome.storage.onChanged.addListener(changed);
        return () => {
            session.dispose();
            chrome.storage.onChanged.removeListener(changed);
        };
    }, [refresh, session]);

    const updatePreferences = useCallback((updates: PreferenceUpdate) => updateSetup(current => ({
        ...current,
        preferences: {
            ...current.preferences,
            ...(typeof updates === 'function' ? updates(current.preferences) : updates),
        },
    })), [updateSetup]);

    return {
        setup: view.state.setup,
        preferences: view.state.setup.preferences,
        storageType: view.state.storageType,
        conflict: view.state.conflict,
        migrationError: view.state.migrationError,
        changingStorage: view.changingStorage,
        changeStorageType,
        loading: view.loading,
        ready: view.ready,
        reload: refresh,
        retryMigration: () => refresh(true),
        error: view.error,
        updateSetup,
        updatePreferences,
    };
}
