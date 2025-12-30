/**
 * Translation Cache
 *
 * LRU cache for translation results with session storage backup.
 * Persists across service worker restarts via chrome.storage.session.
 *
 * @module utils/cache
 */

import type {
    CacheEntry,
    CacheConfig,
    CacheBackup,
    ServiceId,
    CacheKey,
} from '@/src/types';
import { DEFAULT_CACHE_CONFIG, MAX_CACHE_BACKUP_ENTRIES } from '@/src/types';
import { getCacheBackup, setCacheBackup } from './storage';

/**
 * LRU Translation Cache.
 * Uses Map with "move to end" pattern for LRU eviction.
 */
export class TranslationCache {
    private cache = new Map<string, CacheEntry>();
    private config: CacheConfig;

    constructor(config: Partial<CacheConfig> = {}) {
        this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    }

    /**
     * Generate cache key from translation parameters.
     */
    generateKey(
        serviceId: ServiceId,
        sourceLang: string,
        targetLang: string,
        text: string
    ): CacheKey {
        const normalizedText = text.toLowerCase().trim();
        return `${serviceId}:${sourceLang}:${targetLang}:${normalizedText}` as CacheKey;
    }

    /**
     * Get cached translation result.
     * Returns null if not found or expired.
     */
    get(key: string): CacheEntry | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check TTL
        if (Date.now() - entry.timestamp > this.config.ttl) {
            this.cache.delete(key);
            return null;
        }

        // Move to end for LRU (delete and re-add)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry;
    }

    /**
     * Store translation result in cache.
     */
    set(
        key: string,
        result: string,
        serviceId: ServiceId,
        detectedLang?: string
    ): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.config.maxSize) {
            const oldest = this.cache.keys().next().value;
            if (oldest) {
                this.cache.delete(oldest);
            }
        }

        const entry: CacheEntry = {
            result,
            timestamp: Date.now(),
            serviceId,
            detectedLang,
        };

        this.cache.set(key, entry);
    }

    /**
     * Check if a key exists in cache (and is not expired).
     */
    has(key: string): boolean {
        return this.get(key) !== null;
    }

    /**
     * Remove entry from cache.
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get current cache size.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Backup cache to session storage.
     * Only keeps most recent entries to stay within storage limits.
     */
    async backup(): Promise<void> {
        const entries = Array.from(this.cache.entries()).slice(
            -MAX_CACHE_BACKUP_ENTRIES
        );

        const backup: CacheBackup = {
            entries,
            lastBackup: Date.now(),
        };

        await setCacheBackup(backup);
    }

    /**
     * Restore cache from session storage.
     * Filters out expired entries during restore.
     */
    async restore(): Promise<number> {
        const backup = await getCacheBackup();
        if (!backup) return 0;

        let restoredCount = 0;
        const now = Date.now();

        for (const [key, entry] of backup.entries) {
            // Skip expired entries
            if (now - entry.timestamp < this.config.ttl) {
                this.cache.set(key, entry);
                restoredCount++;
            }
        }

        return restoredCount;
    }

    /**
     * Get all entries (for debugging).
     */
    entries(): IterableIterator<[string, CacheEntry]> {
        return this.cache.entries();
    }

    /**
     * Clean up expired entries.
     */
    prune(): number {
        const now = Date.now();
        let prunedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.config.ttl) {
                this.cache.delete(key);
                prunedCount++;
            }
        }

        return prunedCount;
    }
}

// Export singleton instance for convenience
export const translationCache = new TranslationCache();
