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

export function usePreferences() {
    const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
    const [apiKeys, setApiKeysState] = useState<StoredApiKeys>({});
    const [storageType, setStorageType] = useState<CredentialStorageType>('local');
    const [changingStorage, setChangingStorage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load initial data
    useEffect(() => {
        async function loadData() {
            try {
                const [prefs, keys, credentialStorageType] = await Promise.all([
                    getPreferences(),
                    getApiKeys(),
                    getCredentialStorageType(),
                ]);
                setPreferencesState(prefs);
                setApiKeysState(keys);
                setStorageType(credentialStorageType);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load settings');
            } finally {
                setLoading(false);
            }
        }
        loadData();
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

    // Save preferences
    const updatePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
        try {
            const newPrefs = { ...preferences, ...updates };
            setPreferencesState(newPrefs);
            await setPreferences(newPrefs);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save preferences');
            // Revert on error? For now, simple optimistic UI is fine.
        }
    }, [preferences]);

    // Save API Key
    const saveApiKey = useCallback(async (serviceId: ServiceId, key: string) => {
        try {
            const credential: ApiCredential = {
                key,
                validated: false, // Must be validated explicitly
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
