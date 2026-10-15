/**
 * Chrome Storage Wrapper
 *
 * Type-safe utilities for Chrome storage operations.
 * - Preferences: always stored in sync storage
 * - API Keys: stored in sync OR local based on this device's selection
 * - Cache: stored in session storage
 *
 * @module utils/storage
 */

import type {
    UserPreferences,
    StoredApiKeys,
    CacheBackup,
    ApiCredential,
    ServiceId,
    CredentialStorageType,
} from '@/src/types';
import {
    DEFAULT_PREFERENCES,
    SERVICE_IDS,
    SYNC_STORAGE_KEYS,
    LOCAL_STORAGE_KEYS,
    SESSION_STORAGE_KEYS,
    SERVICE_TO_STORAGE_KEY,
} from '@/src/types';

// Coordinate edits and switches across settings pages and the background worker.
const CREDENTIAL_STORAGE_LOCK = 'credential-storage';

// =============================================================================
// Preferences (always sync storage)
// =============================================================================

/**
 * Get user preferences with defaults applied.
 */
export async function getPreferences(): Promise<UserPreferences> {
    const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.PREFERENCES);
    const stored = result[SYNC_STORAGE_KEYS.PREFERENCES] as Partial<UserPreferences> | undefined;
    const cleaned = { ...stored };
    const hasAnalytics = 'telemetryEnabled' in cleaned || 'distinctId' in cleaned;
    delete (cleaned as Record<string, unknown>).telemetryEnabled;
    delete (cleaned as Record<string, unknown>).distinctId;
    if (hasAnalytics) {
        await chrome.storage.sync.set({ [SYNC_STORAGE_KEYS.PREFERENCES]: cleaned });
    }
    const { fallbackOrder, defaultTargetLang, defaultSourceLang, languageOverrides } = {
        ...DEFAULT_PREFERENCES, ...cleaned,
    };
    const prefs: UserPreferences = { fallbackOrder, defaultTargetLang, defaultSourceLang, languageOverrides };
    // Stored selections may contain unsupported providers or malformed values.
    prefs.fallbackOrder = Array.isArray(prefs.fallbackOrder)
        ? [...new Set(prefs.fallbackOrder.filter(id => SERVICE_IDS.some(supported => supported === id)))]
        : [];

    return prefs;
}

/**
 * Save user preferences to sync storage.
 */
export async function setPreferences(prefs: UserPreferences): Promise<void> {
    await chrome.storage.sync.set({ [SYNC_STORAGE_KEYS.PREFERENCES]: prefs });
}

/**
 * Update specific preference fields.
 */
export async function updatePreferences(
    updates: Partial<UserPreferences>
): Promise<UserPreferences> {
    const current = await getPreferences();
    const updated = { ...current, ...updates };
    await setPreferences(updated);
    return updated;
}

// =============================================================================
// API Keys (selected independently on each device)
// =============================================================================

/**
 * Get this device's credential storage selection.
 */
export async function getCredentialStorageType(): Promise<CredentialStorageType> {
    const result = await chrome.storage.local.get(LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE);
    return (result[LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE] as CredentialStorageType | undefined) ?? 'local';
}

function apiKeysStorageArea(storageType: CredentialStorageType): {
    storage: chrome.storage.StorageArea;
    key: string;
} {
    if (storageType === 'sync') {
        return { storage: chrome.storage.sync, key: SYNC_STORAGE_KEYS.API_KEYS };
    }
    return { storage: chrome.storage.local, key: LOCAL_STORAGE_KEYS.API_KEYS };
}

/**
 * Get all stored API keys.
 */
export async function getApiKeys(): Promise<StoredApiKeys> {
    // Read local selection and keys together so a switch cannot remove a copy
    // between selecting its storage area and reading its contents.
    const local = await chrome.storage.local.get([
        LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE, LOCAL_STORAGE_KEYS.API_KEYS,
    ]);
    if (local[LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE] === 'sync') {
        const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.API_KEYS);
        return (result[SYNC_STORAGE_KEYS.API_KEYS] as StoredApiKeys) ?? {};
    }
    return (local[LOCAL_STORAGE_KEYS.API_KEYS] as StoredApiKeys) ?? {};
}

/**
 * Get API key for a specific service.
 */
export async function getApiKey(
    serviceId: ServiceId
): Promise<ApiCredential | undefined> {
    const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
    if (!storageKey) return undefined;

    const apiKeys = await getApiKeys();
    return apiKeys[storageKey];
}

/**
 * Save API key for a specific service.
 */
export async function setApiKey(
    serviceId: ServiceId,
    credential: ApiCredential
): Promise<void> {
    return navigator.locks.request(CREDENTIAL_STORAGE_LOCK, async () => {
        const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
        if (!storageKey) {
            throw new Error(`Service ${serviceId} does not require an API key`);
        }

        const { storage, key } = apiKeysStorageArea(await getCredentialStorageType());
        const result = await storage.get(key);
        const apiKeys = (result[key] as StoredApiKeys) ?? {};
        apiKeys[storageKey] = credential;
        await storage.set({ [key]: apiKeys });
    });
}

/**
 * Remove API key for a specific service.
 */
export async function removeApiKey(serviceId: ServiceId): Promise<void> {
    return navigator.locks.request(CREDENTIAL_STORAGE_LOCK, async () => {
        const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
        if (!storageKey) return;

        const { storage, key } = apiKeysStorageArea(await getCredentialStorageType());
        const result = await storage.get(key);
        const apiKeys = (result[key] as StoredApiKeys) ?? {};
        delete apiKeys[storageKey];
        await storage.set({ [key]: apiKeys });
    });
}

/**
 * Check if a service has a validated API key.
 */
export async function hasValidApiKey(serviceId: ServiceId): Promise<boolean> {
    const credential = await getApiKey(serviceId);
    return credential?.validated === true;
}

/** Switch this device after the destination contains its credentials. */
export async function switchCredentialStorage(toType: CredentialStorageType): Promise<void> {
    return navigator.locks.request(CREDENTIAL_STORAGE_LOCK, async () => {
        const fromType = await getCredentialStorageType();
        if (fromType !== toType) {
            const source = apiKeysStorageArea(fromType);
            const destination = apiKeysStorageArea(toType);
            const sourceData = await source.storage.get(source.key);
            const destinationData = await destination.storage.get(destination.key);
            await destination.storage.set({
                [destination.key]: {
                    ...(destinationData[destination.key] as StoredApiKeys),
                    ...(sourceData[source.key] as StoredApiKeys),
                },
            });
            await chrome.storage.local.set({ [LOCAL_STORAGE_KEYS.CREDENTIAL_STORAGE_TYPE]: toType });
        }

        // Shared keys may still be used by another device. Only clean up local keys.
        // Repeating a synced selection also retries a failed cleanup.
        if (toType === 'sync') {
            await chrome.storage.local.remove(LOCAL_STORAGE_KEYS.API_KEYS);
        }
    });
}

// =============================================================================
// Cache Backup (Session Storage)
// =============================================================================

/**
 * Get cache backup from session storage.
 */
export async function getCacheBackup(): Promise<CacheBackup | null> {
    const result = await chrome.storage.session.get(
        SESSION_STORAGE_KEYS.CACHE_BACKUP
    );
    const backup = result[SESSION_STORAGE_KEYS.CACHE_BACKUP] as
        | CacheBackup
        | undefined;
    return backup ?? null;
}

/**
 * Save cache backup to session storage.
 */
export async function setCacheBackup(backup: CacheBackup): Promise<void> {
    await chrome.storage.session.set({
        [SESSION_STORAGE_KEYS.CACHE_BACKUP]: backup,
    });
}

/**
 * Clear cache backup from session storage.
 */
export async function clearCacheBackup(): Promise<void> {
    await chrome.storage.session.remove(SESSION_STORAGE_KEYS.CACHE_BACKUP);
}

// =============================================================================
// Storage Change Listener
// =============================================================================

export type StorageChangeCallback = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
) => void;

/**
 * Add listener for storage changes.
 */
export function addStorageListener(callback: StorageChangeCallback): void {
    chrome.storage.onChanged.addListener(callback);
}

/**
 * Remove storage change listener.
 */
export function removeStorageListener(callback: StorageChangeCallback): void {
    chrome.storage.onChanged.removeListener(callback);
}
