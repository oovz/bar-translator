import { useState, useEffect, useCallback } from 'preact/hooks';
import {
    getPreferences,
    setPreferences,
    getApiKeys,
    setApiKey,
    getApiKey
} from '@/utils/storage';
import {
    DEFAULT_PREFERENCES,
    type UserPreferences,
    type StoredApiKeys,
    type ServiceId,
    type ApiCredential
} from '@/src/types';

export function usePreferences() {
    const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
    const [apiKeys, setApiKeysState] = useState<StoredApiKeys>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load initial data
    useEffect(() => {
        async function loadData() {
            try {
                const [prefs, keys] = await Promise.all([
                    getPreferences(),
                    getApiKeys()
                ]);
                setPreferencesState(prefs);
                setApiKeysState(keys);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load settings');
            } finally {
                setLoading(false);
            }
        }
        loadData();
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

            setApiKeysState(prev => ({ ...prev, [serviceId]: credential })); // Optimistic update
            await setApiKey(serviceId, credential);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save API key');
        }
    }, []);

    // Update validation status
    const updateKeyValidation = useCallback(async (serviceId: ServiceId, isValid: boolean, _errorMsg?: string) => {
        try {
            const currentKey = await getApiKey(serviceId);
            if (!currentKey) return;

            const updatedKey = {
                ...currentKey,
                validated: isValid,
                lastValidated: Date.now()
            };

            setApiKeysState(prev => ({ ...prev, [serviceId]: updatedKey }));
            await setApiKey(serviceId, updatedKey);
        } catch (err) {
            console.error('Failed to update key validation', err);
        }
    }, []);

    return {
        preferences,
        apiKeys,
        loading,
        error,
        updatePreferences,
        saveApiKey,
        updateKeyValidation
    };
}
