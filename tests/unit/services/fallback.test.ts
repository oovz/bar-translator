/**
 * Unit Tests for Translation Orchestration
 *
 * Tests translateWithFallback in services/index.ts
 *
 * @module tests/unit/services/fallback.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { translateWithFallback, translateDirect, isServiceAvailable, registerService, getService } from '@/services/index';
import { GoogleTranslationWebService } from '@/services/google-web';
import { getServiceDefinition } from '@/services/base';
import { TranslationError } from '@/utils/errors';
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
        id: 'google-web',
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
        fallbackOrder: ['google-web', 'deepl'],
        defaultTargetLang: 'es',
        defaultSourceLang: 'auto',
        languageOverrides: {},
    };

    const validApiKeys: StoredApiKeys = {
        deepl: { key: 'valid-key', validated: true, tier: 'free' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);

        // Overwrite registered services with mocks
        registerService(mockGoogleHandler);
        registerService(mockDeepLHandler);
    });

    afterEach(() => {
        vi.resetAllMocks();
        vi.useRealTimers();
    });

    it('uses the first enabled service (primary)', async () => {
        mockGoogleTranslate.mockResolvedValue({
            translation: 'Hola',
            detectedSourceLang: 'en',
            serviceId: 'google-web',
        });

        const result = await translateWithFallback(
            defaultParams,
            { ...defaultPrefs, fallbackOrder: ['google-web'] },
            {}
        );

        expect(result.translation).toBe('Hola');
        expect(result.serviceId).toBe('google-web');
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
            { ...defaultPrefs, fallbackOrder: ['google-web', 'deepl'] },
            validApiKeys
        );

        expect(result.translation).toBe('Hola (DeepL)');
        expect(result.serviceId).toBe('deepl');
        expect(result.usedFallback).toBe(true);
        expect(mockGoogleTranslate).toHaveBeenCalled();
        expect(mockDeepLTranslate).toHaveBeenCalled();
    });

    it('keeps a mobile redirect as a service warning when an enabled fallback succeeds', async () => {
        const redirect = new Response(null, { status: 302 });
        Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' });
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(redirect);
        registerService(new GoogleTranslationWebService(getServiceDefinition('google-web')));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });

        try {
            const result = await translateWithFallback(defaultParams, defaultPrefs, validApiKeys);
            expect(result).toMatchObject({
                translation: 'Hola', serviceId: 'deepl', usedFallback: true,
                warnings: [{ code: 'SERVICE_UNAVAILABLE', serviceId: 'google-web' }],
            });
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(mockDeepLTranslate).toHaveBeenCalledTimes(1);
        } finally {
            fetch.mockRestore();
        }
    });

    it('skips services without required API keys', async () => {
        // Setup Google mock to succeed
        mockGoogleTranslate.mockResolvedValue({
            translation: 'Success',
            detectedSourceLang: 'en',
            serviceId: 'google-web',
        });

        // DeepL requires key but none provided
        const result = await translateWithFallback(
            defaultParams,
            { ...defaultPrefs, fallbackOrder: ['deepl', 'google-web'] },
            {} // No keys
        );

        // Should skip DeepL and use Google
        expect(result.serviceId).toBe('google-web');
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
        expect(mockGoogleTranslate).toHaveBeenCalled();
        expect(result.usedFallback).toBe(true);
        expect(result.warnings).toEqual([{ code: 'API_KEY_REQUIRED', serviceId: 'deepl' }]);
    });

    it.each([false, true])('uses a supplied key regardless of its validation status (%s)', async validated => {
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const keys = { deepl: { key: 'user-supplied-key', validated } };
        expect(await isServiceAvailable('deepl', keys)).toBe(true);
        const result = await translateWithFallback(defaultParams, { ...defaultPrefs, fallbackOrder: ['deepl'] }, keys);
        expect(result.translation).toBe('Hola');
        expect(mockDeepLTranslate).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'user-supplied-key' }));
        expect(mockDeepLHandler.validateApiKey).not.toHaveBeenCalled();
    });

    it('skips denied provider access and reports it with a successful fallback', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async permission =>
            !permission.origins?.includes('https://translate.google.com/*'));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const result = await translateWithFallback(defaultParams, defaultPrefs, validApiKeys);
        expect(mockGoogleTranslate).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            usedFallback: true,
            warnings: [{ code: 'PERMISSION_REQUIRED', serviceId: 'google-web' }],
        });
    });

    it('requires every DeepL domain even for a Free key', async () => {
        const granted = ['https://api-free.deepl.com/*'];
        vi.mocked(chrome.permissions.contains).mockImplementation(async permission =>
            permission.origins?.every(origin => granted.includes(origin)) ?? true);
        await expect(translateDirect('deepl', defaultParams, validApiKeys)).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
        expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('checks revoked access when the next provider is reached', async () => {
        let deeplAccess = true;
        vi.mocked(chrome.permissions.contains).mockImplementation(async permission =>
            !permission.origins?.includes('https://api.deepl.com/*') || deeplAccess);
        mockGoogleTranslate.mockImplementation(async () => {
            deeplAccess = false;
            throw new TranslationError('NETWORK_ERROR', 'Offline');
        });
        await expect(translateWithFallback(defaultParams, defaultPrefs, validApiKeys)).rejects.toMatchObject({
            code: 'PERMISSION_REQUIRED',
            warnings: [
                { code: 'NETWORK_ERROR', serviceId: 'google-web' },
                { code: 'PERMISSION_REQUIRED', serviceId: 'deepl' },
            ],
        });
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('treats a permission API failure as an operational failure and falls back', async () => {
        vi.mocked(chrome.permissions.contains).mockRejectedValueOnce(new Error('Permission query failed'));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const result = await translateWithFallback(defaultParams, defaultPrefs, validApiKeys);
        expect(mockGoogleTranslate).not.toHaveBeenCalled();
        expect(result.warnings).toEqual([{ code: 'SERVICE_UNAVAILABLE', serviceId: 'google-web' }]);
    });

    it('attaches failed provider warnings while preserving the final classification', async () => {
        mockGoogleTranslate.mockRejectedValue(new TranslationError('NETWORK_ERROR', 'Offline'));
        mockDeepLTranslate.mockRejectedValue(new TranslationError('INVALID_API_KEY', 'Rejected', { httpStatus: 403, serviceId: 'deepl' }));
        await expect(translateWithFallback(defaultParams, defaultPrefs, validApiKeys)).rejects.toMatchObject({
            code: 'INVALID_API_KEY', httpStatus: 403, serviceId: 'deepl',
            warnings: [
                { code: 'NETWORK_ERROR', serviceId: 'google-web' },
                { code: 'INVALID_API_KEY', serviceId: 'deepl' },
            ],
        });
    });

    it('does not fetch directly when a credential is missing', async () => {
        await expect(translateDirect('deepl', defaultParams, {})).rejects.toMatchObject({ code: 'API_KEY_REQUIRED' });
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('cancels a pending attempt without starting another provider', async () => {
        const controller = new AbortController();
        mockGoogleTranslate.mockImplementation(async () => {
            controller.abort(new DOMException('Cancelled', 'AbortError'));
            return new Promise(() => {});
        });
        await expect(translateWithFallback({ ...defaultParams, signal: controller.signal }, defaultPrefs, validApiKeys)).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('advances after the four-second attempt budget', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        mockGoogleTranslate.mockImplementation(() => new Promise(() => {}));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const pending = translateWithFallback(defaultParams, defaultPrefs, validApiKeys);
        await vi.advanceTimersByTimeAsync(4000);
        expect(await pending).toMatchObject({
            translation: 'Hola',
            warnings: [{ code: 'TIMEOUT', serviceId: 'google-web' }],
        });
    });

    it('limits three provider attempts to the ten-second total budget', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        const originalLingva = getService('lingva')!;
        const pendingTranslation = vi.fn(() => new Promise<never>(() => {}));
        registerService({ service: { ...mockGoogleHandler.service, id: 'lingva' }, translate: pendingTranslation });
        mockGoogleTranslate.mockImplementation(() => new Promise(() => {}));
        mockDeepLTranslate.mockImplementation(() => new Promise(() => {}));
        try {
            const pending = translateWithFallback(defaultParams, { ...defaultPrefs, fallbackOrder: ['google-web', 'lingva', 'deepl'] }, validApiKeys);
            const rejected = expect(pending).rejects.toMatchObject({
                code: 'TIMEOUT',
                warnings: [
                    { code: 'TIMEOUT', serviceId: 'google-web' },
                    { code: 'TIMEOUT', serviceId: 'lingva' },
                    { code: 'TIMEOUT', serviceId: 'deepl' },
                ],
            });
            await vi.advanceTimersByTimeAsync(10000);
            await rejected;
            expect(performance.now()).toBe(10000);
            expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
            expect(pendingTranslation).toHaveBeenCalledTimes(1);
            expect(mockDeepLTranslate).toHaveBeenCalledTimes(1);
        } finally {
            registerService(originalLingva);
        }
    });

    it('attempts each selected provider once even when the selection repeats it', async () => {
        mockGoogleTranslate.mockRejectedValue(new Error('Primary failed'));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const result = await translateWithFallback(
            defaultParams,
            { ...defaultPrefs, fallbackOrder: ['google-web', 'google-web', 'deepl'] },
            validApiKeys
        );
        expect(result.translation).toBe('Hola');
        expect(mockGoogleTranslate).toHaveBeenCalledTimes(1);
        expect(mockDeepLTranslate).toHaveBeenCalledTimes(1);
    });

    it.each(['INVALID_LANGUAGE', 'TEXT_TOO_LONG'] as const)('stops on terminal input error %s', async code => {
        const error = new TranslationError(code, 'Invalid input');
        mockGoogleTranslate.mockRejectedValue(error);
        await expect(translateWithFallback(defaultParams, defaultPrefs, validApiKeys)).rejects.toBe(error);
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
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
                { ...defaultPrefs, fallbackOrder: ['google-web', 'deepl'] },
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
        ).rejects.toMatchObject({ code: 'API_KEY_REQUIRED', warnings: [{ code: 'API_KEY_REQUIRED', serviceId: 'deepl' }] });
    });

    it('handles unexpected errors gracefully', async () => {
        mockGoogleTranslate.mockRejectedValue('String error');

        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: ['google-web'] },
                {}
            )
        ).rejects.toThrow('String error');
    });
});
