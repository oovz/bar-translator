/**
 * Unit Tests for Translation Orchestration
 *
 * Tests translateWithFallback in services/index.ts
 *
 * @module tests/unit/services/fallback.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { translateWithFallback, registerService } from '@/services/index';
import type {
    UserPreferences,
    StoredApiKeys,
    TranslateParams,
    TranslationServiceHandler,
} from '@/src/types';

// Mock console to keep output clean
vi.spyOn(console, 'log').mockImplementation(() => { });
vi.spyOn(console, 'warn').mockImplementation(() => { });
vi.spyOn(console, 'error').mockImplementation(() => { });

// Mock services
const mockGoogleTranslate = vi.fn();
const mockDeepLTranslate = vi.fn();

const mockGoogleHandler: TranslationServiceHandler = {
    service: {
        id: 'google-scraper',
        name: 'Google',
        requiresApiKey: false,
        type: 'api',
        maxTextLength: 5000,
        authMethod: 'none',
        httpMethod: 'POST'
    },
    translate: mockGoogleTranslate,
};

const mockDeepLHandler: TranslationServiceHandler = {
    service: {
        id: 'deepl',
        name: 'DeepL',
        requiresApiKey: true,
        type: 'api',
        maxTextLength: 5000,
        authMethod: 'header-auth-key',
        httpMethod: 'POST'
    },
    translate: mockDeepLTranslate,
    validateApiKey: vi.fn(),
};

describe('Translation Orchestration', () => {
    const defaultParams: TranslateParams = {
        text: 'Hello',
        sourceLang: 'en',
        targetLang: 'es',
    };

    const defaultPrefs: UserPreferences = {
        preferredServiceId: 'google-scraper',
        fallbackOrder: ['google-scraper', 'deepl'],
        fallbackEnabled: true,
        defaultTargetLang: 'es',
        defaultSourceLang: 'auto',
        storageType: 'local',
        telemetryEnabled: false,
        distinctId: 'test-id',
    };

    const validApiKeys: StoredApiKeys = {
        deepl: { key: 'valid-key', validated: true, tier: 'free' },
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Overwrite registered services with mocks
        registerService(mockGoogleHandler);
        registerService(mockDeepLHandler);
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('uses the first enabled service (primary)', async () => {
        mockGoogleTranslate.mockResolvedValue({
            translation: 'Hola',
            detectedSourceLang: 'en',
            serviceId: 'google-scraper',
        });

        const result = await translateWithFallback(
            defaultParams,
            { ...defaultPrefs, fallbackOrder: ['google-scraper'] },
            {}
        );

        expect(result.translation).toBe('Hola');
        expect(result.serviceId).toBe('google-scraper');
        expect(result.usedFallback).toBe(false);
        expect(mockGoogleTranslate).toHaveBeenCalled();
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('falls back to second service if primary fails', async () => {
        mockGoogleTranslate.mockRejectedValue(new Error('Network error'));
        mockDeepLTranslate.mockResolvedValue({
            translation: 'Hola (DeepL)',
            detectedSourceLang: 'en',
            serviceId: 'deepl',
        });

        const result = await translateWithFallback(
            defaultParams,
            { ...defaultPrefs, fallbackOrder: ['google-scraper', 'deepl'] },
            validApiKeys
        );

        expect(result.translation).toBe('Hola (DeepL)');
        expect(result.serviceId).toBe('deepl');
        expect(result.usedFallback).toBe(true);
        expect(mockGoogleTranslate).toHaveBeenCalled();
        expect(mockDeepLTranslate).toHaveBeenCalled();
    });

    it('skips services without required API keys', async () => {
        // Setup Google mock to succeed
        mockGoogleTranslate.mockResolvedValue({
            translation: 'Success',
            detectedSourceLang: 'en',
            serviceId: 'google-scraper',
        });

        // DeepL requires key but none provided
        const result = await translateWithFallback(
            defaultParams,
            { ...defaultPrefs, fallbackOrder: ['deepl', 'google-scraper'] },
            {} // No keys
        );

        // Should skip DeepL and use Google
        expect(result.serviceId).toBe('google-scraper');
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
        expect(mockGoogleTranslate).toHaveBeenCalled();
    });

    it('throws if no services are enabled', async () => {
        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: [] },
                {}
            )
        ).rejects.toThrow('No translation services enabled');
    });

    it('throws if all enabled services fail', async () => {
        mockGoogleTranslate.mockRejectedValue(new Error('Fail 1'));
        mockDeepLTranslate.mockRejectedValue(new Error('Fail 2'));

        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: ['google-scraper', 'deepl'] },
                validApiKeys
            )
        ).rejects.toThrow('Fail 2'); // Should throw last error
    });

    it('throws if no enabled services have keys', async () => {
        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: ['deepl'] },
                {} // No keys
            )
        ).rejects.toThrow('No translation services available');
    });

    it('handles unexpected errors gracefully', async () => {
        mockGoogleTranslate.mockRejectedValue('String error');

        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: ['google-scraper'] },
                {}
            )
        ).rejects.toThrow('String error');
    });
});
