import { useState, useEffect, useCallback } from 'preact/hooks';
import {
    getPreferences,
    setPreferences,
    getApiKeys,
    setApiKey,
    getApiKey,
    getCredentialStorageType,
    switchCredentialStorage,
} from '@/utils/storage';
import {
    DEFAULT_PREFERENCES,
    SERVICE_TO_STORAGE_KEY,
    type UserPreferences,
    type StoredApiKeys,
    type ServiceId,
    type ApiCredential,
    type CredentialStorageType,
} from '@/src/types';

export type PreferenceUpdate = Partial<UserPreferences> | ((current: UserPreferences) => Partial<UserPreferences>);

const PREFERENCES_LOCK = 'bar-translator-preferences';

export function usePreferences() {
    const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
    const [apiKeys, setApiKeysState] = useState<StoredApiKeys>({});
    const [storageType, setStorageType] = useState<CredentialStorageType>('local');
    const [changingStorage, setChangingStorage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load initial data
    useEffect(() => {
        let active = true;
        let revision = 0;
        async function loadData() {
            const current = ++revision;
            try {
                const [prefs, keys, credentialStorageType] = await Promise.all([
                    getPreferences(),
                    getApiKeys(),
                    getCredentialStorageType(),
                ]);
                if (!active || current !== revision) return;
                setPreferencesState(prefs);
                setApiKeysState(keys);
                setStorageType(credentialStorageType);
            } catch (err) {
                if (active && current === revision) setError(err instanceof Error ? err.message : 'Failed to load settings');
            } finally {
                if (active && current === revision) setLoading(false);
            }
        }
        void loadData();
        const refresh = (changes: Record<string, chrome.storage.StorageChange>) => {
            if (['preferences', 'apiKeys', 'apiKeys_local', 'credentialStorageType'].some(key => key in changes)) void loadData();
        };
        chrome.storage.onChanged.addListener(refresh);
        return () => {
            active = false;
            chrome.storage.onChanged.removeListener(refresh);
        };
    }, []);

    const changeStorageType = useCallback(async (nextType: CredentialStorageType) => {
        setChangingStorage(true);
        try {
            await switchCredentialStorage(nextType);
        } finally {
            try {
                const actualType = await getCredentialStorageType();
                setStorageType(actualType);
                const keys = await getApiKeys();
                setApiKeysState(keys);
            } finally {
                setChangingStorage(false);
            }
        }
    }, []);

    // Merge under one origin-wide lock so other settings pages and delayed
    // permission dialogs cannot overwrite newer provider or language choices.
    const updatePreferences = useCallback(async (updates: PreferenceUpdate) => {
        setError(null);
        try {
            return await navigator.locks.request(PREFERENCES_LOCK, async () => {
                const current = await getPreferences();
                const patch = typeof updates === 'function' ? updates(current) : updates;
                const next = { ...current, ...patch };
                await setPreferences(next);
                setPreferencesState(next);
                return true;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save preferences');
            return false;
        }
    }, []);

    // Save API Key
    const saveApiKey = useCallback(async (serviceId: ServiceId, key: string) => {
        try {
            const credential: ApiCredential = {
                key,
                validated: false, // Optional test status; never gates translation.
                tier: key.endsWith(':fx') ? 'free' : 'pro' // Simple DeepL heuristic
            };

            const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
            if (!storageKey) return;
            setApiKeysState(prev => ({ ...prev, [storageKey]: credential }));
            await setApiKey(serviceId, credential);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save API key');
        }
    }, []);

    // Update validation status
    const updateKeyValidation = useCallback(async (serviceId: ServiceId, key: string, isValid: boolean) => {
        const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
        const currentKey = await getApiKey(serviceId);
        if (!storageKey || !currentKey || currentKey.key !== key) {
            throw new Error('API key changed. Test the current key again.');
        }

        const updatedKey = {
            ...currentKey,
            validated: isValid,
            lastValidated: Date.now()
        };

        await setApiKey(serviceId, updatedKey);
        setApiKeysState(prev => ({ ...prev, [storageKey]: updatedKey }));
    }, []);

    return {
        preferences,
        apiKeys,
        storageType,
        changingStorage,
        changeStorageType,
        loading,
        error,
        updatePreferences,
        saveApiKey,
        updateKeyValidation
    };
}
