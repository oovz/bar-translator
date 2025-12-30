/**
 * Chrome Storage Wrapper
 *
 * Type-safe utilities for Chrome storage operations.
 * - Preferences: always stored in sync storage
 * - API Keys: stored in sync OR local based on user preference
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
} from '@/src/types';
import {
    DEFAULT_PREFERENCES,
    SYNC_STORAGE_KEYS,
    SESSION_STORAGE_KEYS,
    SERVICE_TO_STORAGE_KEY,
} from '@/src/types';

// Local key for API keys when using local storage
const LOCAL_API_KEYS_KEY = 'apiKeys_local';

// =============================================================================
// Preferences (always sync storage)
// =============================================================================



/**
 * Get user preferences with defaults applied.
 * Handles auto-generation of distinctId if missing.
 */
export async function getPreferences(): Promise<UserPreferences> {
    try {
        // Original implementation used chrome.storage.sync directly
        const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.PREFERENCES);
        const stored = result[SYNC_STORAGE_KEYS.PREFERENCES] as
            | Partial<UserPreferences>
            | undefined;

        const prefs = { ...DEFAULT_PREFERENCES, ...stored };

        // Auto-generate distinctId if missing
        if (!prefs.distinctId) {
            prefs.distinctId = crypto.randomUUID();
            await setPreferences(prefs); // Save the newly generated ID
        }

        return prefs;
    } catch (error) {
        console.error('Failed to get preferences:', error);
        return DEFAULT_PREFERENCES;
    }
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
// API Keys (sync or local based on preference)
// =============================================================================

/**
 * Get the storage area for API keys based on user preference.
 */
async function getApiKeysStorageArea(): Promise<{
    storage: chrome.storage.StorageArea;
    key: string;
}> {
    const prefs = await getPreferences();
    if (prefs.storageType === 'sync') {
        return { storage: chrome.storage.sync, key: SYNC_STORAGE_KEYS.API_KEYS };
    }
    return { storage: chrome.storage.local, key: LOCAL_API_KEYS_KEY };
}

/**
 * Get all stored API keys.
 */
export async function getApiKeys(): Promise<StoredApiKeys> {
    const { storage, key } = await getApiKeysStorageArea();
    const result = await storage.get(key);
    return (result[key] as StoredApiKeys) ?? {};
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
    const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
    if (!storageKey) {
        throw new Error(`Service ${serviceId} does not require an API key`);
    }

    const { storage, key } = await getApiKeysStorageArea();
    const apiKeys = await getApiKeys();
    apiKeys[storageKey] = credential;
    await storage.set({ [key]: apiKeys });
}

/**
 * Remove API key for a specific service.
 */
export async function removeApiKey(serviceId: ServiceId): Promise<void> {
    const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
    if (!storageKey) return;

    const { storage, key } = await getApiKeysStorageArea();
    const apiKeys = await getApiKeys();
    delete apiKeys[storageKey];
    await storage.set({ [key]: apiKeys });
}

/**
 * Check if a service has a validated API key.
 */
export async function hasValidApiKey(serviceId: ServiceId): Promise<boolean> {
    const credential = await getApiKey(serviceId);
    return credential?.validated === true;
}

/**
 * Migrate API keys when storage type changes.
 */
export async function migrateApiKeys(
    fromType: 'sync' | 'local',
    toType: 'sync' | 'local'
): Promise<void> {
    if (fromType === toType) return;

    // Get keys from old location
    const fromStorage = fromType === 'sync' ? chrome.storage.sync : chrome.storage.local;
    const fromKey = fromType === 'sync' ? SYNC_STORAGE_KEYS.API_KEYS : LOCAL_API_KEYS_KEY;
    const result = await fromStorage.get(fromKey);
    const apiKeys = (result[fromKey] as StoredApiKeys) ?? {};

    // Save to new location
    const toStorage = toType === 'sync' ? chrome.storage.sync : chrome.storage.local;
    const toKey = toType === 'sync' ? SYNC_STORAGE_KEYS.API_KEYS : LOCAL_API_KEYS_KEY;
    await toStorage.set({ [toKey]: apiKeys });

    // Clear old location
    await fromStorage.remove(fromKey);

    console.log(`[Storage] Migrated API keys from ${fromType} to ${toType}`);
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
