/**
 * Unit Tests for Translation Cache
 *
 * @module tests/unit/cache.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TranslationCache } from '@/utils/cache';
import type { CacheEntry } from '@/src/types';

// Mock chrome.storage
const mockStorageSession = {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
};

vi.stubGlobal('chrome', {
    storage: {
        session: mockStorageSession,
    },
});

describe('TranslationCache', () => {
    let cache: TranslationCache;

    beforeEach(() => {
        cache = new TranslationCache({ maxSize: 5, ttl: 1000 });
        vi.clearAllMocks();
        mockStorageSession.get.mockResolvedValue({});
        mockStorageSession.set.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('generateKey', () => {
        it('generates consistent cache keys', () => {
            const key = cache.generateKey('deepl', 'en', 'fr', 'Hello');
            expect(key).toBe('deepl:en:fr:hello');
        });

        it('normalizes text to lowercase', () => {
            const key1 = cache.generateKey('deepl', 'en', 'fr', 'Hello World');
            const key2 = cache.generateKey('deepl', 'en', 'fr', 'hello world');
            expect(key1).toBe(key2);
        });

        it('trims whitespace from text', () => {
            const key1 = cache.generateKey('deepl', 'en', 'fr', '  hello  ');
            const key2 = cache.generateKey('deepl', 'en', 'fr', 'hello');
            expect(key1).toBe(key2);
        });
    });

    describe('set and get', () => {
        it('stores and retrieves entries', () => {
            const key = 'test:key';
            cache.set(key, 'Bonjour', 'google-scraper');

            const entry = cache.get(key);
            expect(entry).not.toBeNull();
            expect(entry?.result).toBe('Bonjour');
            expect(entry?.serviceId).toBe('google-scraper');
        });

        it('returns null for missing keys', () => {
            expect(cache.get('nonexistent')).toBeNull();
        });

        it('includes timestamp in entries', () => {
            const now = Date.now();
            cache.set('key', 'value', 'deepl');

            const entry = cache.get('key');
            expect(entry?.timestamp).toBeGreaterThanOrEqual(now);
        });

        it('stores detected language', () => {
            cache.set('key', 'value', 'deepl', 'en');

            const entry = cache.get('key');
            expect(entry?.detectedLang).toBe('en');
        });
    });

    describe('TTL expiration', () => {
        it('returns null for expired entries', async () => {
            vi.useFakeTimers();
            cache.set('key', 'value', 'deepl');

            // Advance time past TTL
            vi.advanceTimersByTime(1001);

            expect(cache.get('key')).toBeNull();
        });

        it('returns entry within TTL', () => {
            vi.useFakeTimers();
            cache.set('key', 'value', 'deepl');

            // Advance time but stay within TTL
            vi.advanceTimersByTime(500);

            expect(cache.get('key')).not.toBeNull();
        });
    });

    describe('LRU eviction', () => {
        it('evicts oldest entry when at capacity', () => {
            cache.set('key1', 'value1', 'deepl');
            cache.set('key2', 'value2', 'deepl');
            cache.set('key3', 'value3', 'deepl');
            cache.set('key4', 'value4', 'deepl');
            cache.set('key5', 'value5', 'deepl');

            // Adding 6th entry should evict key1
            cache.set('key6', 'value6', 'deepl');

            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key6')).not.toBeNull();
        });

        it('moves accessed entries to end', () => {
            cache.set('key1', 'value1', 'deepl');
            cache.set('key2', 'value2', 'deepl');
            cache.set('key3', 'value3', 'deepl');
            cache.set('key4', 'value4', 'deepl');
            cache.set('key5', 'value5', 'deepl');

            // Access key1 to move it to end
            cache.get('key1');

            // Add new entries to trigger eviction
            cache.set('key6', 'value6', 'deepl');

            // key2 should be evicted, not key1
            expect(cache.get('key1')).not.toBeNull();
            expect(cache.get('key2')).toBeNull();
        });
    });

    describe('has', () => {
        it('returns true for existing entries', () => {
            cache.set('key', 'value', 'deepl');
            expect(cache.has('key')).toBe(true);
        });

        it('returns false for missing entries', () => {
            expect(cache.has('nonexistent')).toBe(false);
        });

        it('returns false for expired entries', () => {
            vi.useFakeTimers();
            cache.set('key', 'value', 'deepl');
            vi.advanceTimersByTime(1001);
            expect(cache.has('key')).toBe(false);
        });
    });

    describe('delete', () => {
        it('removes entry from cache', () => {
            cache.set('key', 'value', 'deepl');
            expect(cache.delete('key')).toBe(true);
            expect(cache.get('key')).toBeNull();
        });

        it('returns false for missing key', () => {
            expect(cache.delete('nonexistent')).toBe(false);
        });
    });

    describe('clear', () => {
        it('removes all entries', () => {
            cache.set('key1', 'value1', 'deepl');
            cache.set('key2', 'value2', 'deepl');

            cache.clear();

            expect(cache.size).toBe(0);
        });
    });

    describe('size', () => {
        it('returns current entry count', () => {
            expect(cache.size).toBe(0);

            cache.set('key1', 'value1', 'deepl');
            expect(cache.size).toBe(1);

            cache.set('key2', 'value2', 'deepl');
            expect(cache.size).toBe(2);
        });
    });

    describe('prune', () => {
        it('removes expired entries', () => {
            vi.useFakeTimers();

            cache.set('key1', 'value1', 'deepl');
            vi.advanceTimersByTime(500);

            cache.set('key2', 'value2', 'deepl');
            vi.advanceTimersByTime(600);

            // key1 is now expired, key2 is not
            const pruned = cache.prune();

            expect(pruned).toBe(1);
            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key2')).not.toBeNull();
        });
    });

    describe('backup and restore', () => {
        it('backs up cache to session storage', async () => {
            cache.set('key1', 'value1', 'deepl');
            cache.set('key2', 'value2', 'deepl');

            await cache.backup();

            expect(mockStorageSession.set).toHaveBeenCalled();
            const call = mockStorageSession.set.mock.calls[0][0];
            expect(call.cacheBackup).toBeDefined();
            expect(call.cacheBackup.entries.length).toBe(2);
        });

        it('restores cache from session storage', async () => {
            const entries: [string, CacheEntry][] = [
                [
                    'key1',
                    {
                        result: 'value1',
                        timestamp: Date.now(),
                        serviceId: 'deepl',
                    },
                ],
            ];

            mockStorageSession.get.mockResolvedValue({
                cacheBackup: { entries, lastBackup: Date.now() },
            });

            const restored = await cache.restore();

            expect(restored).toBe(1);
            expect(cache.get('key1')?.result).toBe('value1');
        });

        it('skips expired entries during restore', async () => {
            vi.useFakeTimers();
            const oldTimestamp = Date.now() - 2000;

            const entries: [string, CacheEntry][] = [
                [
                    'old',
                    {
                        result: 'expired',
                        timestamp: oldTimestamp,
                        serviceId: 'deepl',
                    },
                ],
                [
                    'new',
                    {
                        result: 'valid',
                        timestamp: Date.now(),
                        serviceId: 'deepl',
                    },
                ],
            ];

            mockStorageSession.get.mockResolvedValue({
                cacheBackup: { entries, lastBackup: Date.now() },
            });

            const restored = await cache.restore();

            expect(restored).toBe(1);
            expect(cache.get('old')).toBeNull();
            expect(cache.get('new')).not.toBeNull();
        });
    });
});
