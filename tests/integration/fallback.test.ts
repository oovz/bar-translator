/**
 * Integration Tests for Translation Orchestration
 *
 * Tests translateWithFallback in services/index.ts
 *
 * @module tests/integration/fallback.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { translateWithFallback as translateSetupWithFallback, translateDirect as translateInstanceDirect, isInstanceAvailable, testInstance, registerService, getService } from '@/services/index';
import { GoogleTranslationWebService } from '@/services/google-web';
import { getServiceDefinition } from '@/services/base';
import { TranslationError } from '@/utils/errors';
import { createDefaultSetup } from '@/utils/instances';
import * as storage from '@/utils/storage';
import type {
    UserPreferences,
    StoredApiKeys,
    TranslateParams,
    TranslationServiceHandler,
    ServiceId,
    TranslationInstance,
} from '@/src/types';

// These fixtures use the legacy provider IDs as stable migrated instance IDs.
function configuredSetup(preferences: UserPreferences, apiKeys: StoredApiKeys = {}) {
    const setup = createDefaultSetup();
    setup.preferences = structuredClone(preferences);
    const deepl = setup.instances.find(instance => instance.providerId === 'deepl')!;
    if (deepl.providerId === 'deepl' && apiKeys.deepl) deepl.credential = apiKeys.deepl;
    return setup;
}
function translateWithFallback(params: TranslateParams, preferences: UserPreferences, apiKeys: StoredApiKeys) {
    return translateSetupWithFallback(params, configuredSetup(preferences, apiKeys));
}
function fixtureInstance(serviceId: ServiceId, apiKeys: StoredApiKeys): TranslationInstance {
    return configuredSetup({ fallbackOrder: [], defaultSourceLang: 'auto', defaultTargetLang: 'es', languageOverrides: {} }, apiKeys)
        .instances.find(instance => instance.providerId === serviceId)!;
}
function translateDirect(serviceId: ServiceId, params: TranslateParams, apiKeys: StoredApiKeys) {
    return translateInstanceDirect(fixtureInstance(serviceId, apiKeys), params);
}
function isServiceAvailable(serviceId: ServiceId, apiKeys: StoredApiKeys) {
    return isInstanceAvailable(fixtureInstance(serviceId, apiKeys));
}

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
                warnings: [{ code: 'SERVICE_UNAVAILABLE', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' }],
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
        expect(result.warnings).toEqual([{ code: 'API_KEY_REQUIRED', serviceId: 'deepl', instanceId: 'deepl', instanceName: 'DeepL' }]);
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
            warnings: [{ code: 'PERMISSION_REQUIRED', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' }],
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
                { code: 'NETWORK_ERROR', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' },
                { code: 'PERMISSION_REQUIRED', serviceId: 'deepl', instanceId: 'deepl', instanceName: 'DeepL' },
            ],
        });
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('treats a permission API failure as an operational failure and falls back', async () => {
        vi.mocked(chrome.permissions.contains).mockRejectedValueOnce(new Error('Permission query failed'));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const result = await translateWithFallback(defaultParams, defaultPrefs, validApiKeys);
        expect(mockGoogleTranslate).not.toHaveBeenCalled();
        expect(result.warnings).toEqual([{ code: 'SERVICE_UNAVAILABLE', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' }]);
    });

    it('attaches failed provider warnings while preserving the final classification', async () => {
        mockGoogleTranslate.mockRejectedValue(new TranslationError('NETWORK_ERROR', 'Offline'));
        mockDeepLTranslate.mockRejectedValue(new TranslationError('INVALID_API_KEY', 'Rejected', { httpStatus: 403, serviceId: 'deepl' }));
        await expect(translateWithFallback(defaultParams, defaultPrefs, validApiKeys)).rejects.toMatchObject({
            code: 'INVALID_API_KEY', httpStatus: 403, serviceId: 'deepl',
            warnings: [
                { code: 'NETWORK_ERROR', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' },
                { code: 'INVALID_API_KEY', serviceId: 'deepl', instanceId: 'deepl', instanceName: 'DeepL' },
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
            warnings: [{ code: 'TIMEOUT', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' }],
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
                    { code: 'TIMEOUT', serviceId: 'google-web', instanceId: 'google-web', instanceName: 'Google Web' },
                    { code: 'TIMEOUT', serviceId: 'lingva', instanceId: 'lingva', instanceName: 'Lingva' },
                    { code: 'TIMEOUT', serviceId: 'deepl', instanceId: 'deepl', instanceName: 'DeepL' },
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
        await expect(translateWithFallback(defaultParams, defaultPrefs, validApiKeys)).rejects.toMatchObject({ code, serviceId: 'google-web', instanceId: 'google-web' });
        expect(mockDeepLTranslate).not.toHaveBeenCalled();
    });

    it('throws if no services are enabled', async () => {
        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: [] },
                {}
            )
        ).rejects.toMatchObject({ code: 'NO_SERVICES_ENABLED' });
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
        ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceId: 'deepl', instanceId: 'deepl', instanceName: 'DeepL' });
    });

    it('throws if no enabled services have keys', async () => {
        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: ['deepl'] },
                {} // No keys
            )
        ).rejects.toMatchObject({ code: 'API_KEY_REQUIRED', warnings: [{ code: 'API_KEY_REQUIRED', serviceId: 'deepl', instanceId: 'deepl', instanceName: 'DeepL' }] });
    });

    it('handles unexpected errors gracefully', async () => {
        mockGoogleTranslate.mockRejectedValue('String error');

        await expect(
            translateWithFallback(
                defaultParams,
                { ...defaultPrefs, fallbackOrder: ['google-web'] },
                {}
            )
        ).rejects.toThrow();
    });
    it('attempts two enabled DeepL accounts independently without carrying credentials', async () => {
        const setup = configuredSetup(defaultPrefs);
        setup.instances.push(
            { id: 'personal', providerId: 'deepl', name: 'Personal', credential: { key: 'personal:fx', tier: 'free', validated: false } },
            { id: 'work', providerId: 'deepl', name: 'Work', credential: { key: 'work-key', tier: 'pro', validated: false } },
        );
        setup.preferences.fallbackOrder = ['personal', 'work'];
        mockDeepLTranslate.mockRejectedValueOnce(new TranslationError('QUOTA_EXCEEDED', 'Limit reached'))
            .mockResolvedValueOnce({ translation: 'Hola', serviceId: 'deepl' });
        const result = await translateSetupWithFallback(defaultParams, setup);
        expect(mockDeepLTranslate).toHaveBeenNthCalledWith(1, expect.objectContaining({ apiKey: 'personal:fx', tier: 'free' }));
        expect(mockDeepLTranslate).toHaveBeenNthCalledWith(2, expect.objectContaining({ apiKey: 'work-key', tier: 'pro' }));
        expect(result).toMatchObject({ instanceId: 'work', instanceName: 'Work', usedFallback: true,
            warnings: [{ code: 'QUOTA_EXCEEDED', instanceId: 'personal', instanceName: 'Personal' }] });
    });

    it('advances after an instance-specific model failure without changing global language input', async () => {
        const original = getService('libretranslate')!;
        const translate = vi.fn().mockRejectedValue(new TranslationError('INSTANCE_LANGUAGE_UNSUPPORTED', 'Model unavailable'));
        registerService({ service: getServiceDefinition('libretranslate'), translate });
        const setup = configuredSetup(defaultPrefs);
        setup.instances.push({ id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://localhost:5000/libre' });
        setup.preferences.fallbackOrder = ['home', 'google-web'];
        mockGoogleTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'google-web' });
        try {
            const result = await translateSetupWithFallback(defaultParams, setup);
            expect(translate).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:5000/libre', apiKey: undefined }));
            expect(mockGoogleTranslate).toHaveBeenCalledWith(expect.objectContaining({ endpoint: undefined, apiKey: undefined }));
            expect(result.warnings).toEqual([{ code: 'INSTANCE_LANGUAGE_UNSUPPORTED', serviceId: 'libretranslate', instanceId: 'home', instanceName: 'Home' }]);
        } finally { registerService(original); }
    });

    it('requires a managed LibreTranslate key but allows a custom server without one', async () => {
        const original = getService('libretranslate')!;
        const translate = vi.fn().mockResolvedValue({ translation: 'Hola', serviceId: 'libretranslate' });
        registerService({ service: getServiceDefinition('libretranslate'), translate });
        const setup = configuredSetup(defaultPrefs);
        setup.instances.push(
            { id: 'managed', providerId: 'libretranslate', name: 'Managed', hosting: 'managed', endpoint: 'https://libretranslate.com' },
            { id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://localhost:5000' },
        );
        setup.preferences.fallbackOrder = ['managed', 'home'];
        try {
            const result = await translateSetupWithFallback(defaultParams, setup);
            expect(translate).toHaveBeenCalledTimes(1);
            expect(translate).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://localhost:5000', apiKey: undefined }));
            expect(result).toMatchObject({ instanceId: 'home', usedFallback: true,
                warnings: [{ code: 'API_KEY_REQUIRED', instanceId: 'managed' }] });
        } finally { registerService(original); }
    });

    it('does not explicitly test a disabled or changed instance from a stale settings page', async () => {
        const instance: TranslationInstance = { id: 'home', providerId: 'libretranslate', name: 'Home', hosting: 'custom', endpoint: 'http://localhost:5000' };
        const setup = configuredSetup(defaultPrefs);
        setup.instances.push(instance);
        setup.preferences.fallbackOrder = [];
        const read = vi.spyOn(storage, 'getSetup').mockResolvedValue(setup);
        const fetch = vi.spyOn(globalThis, 'fetch');
        try {
            expect((await testInstance(instance)).valid).toBe(false);
            setup.preferences.fallbackOrder = ['home'];
            setup.instances = setup.instances.map(candidate => candidate.id === 'home'
                ? { ...instance, endpoint: 'http://localhost:9000' } : candidate);
            expect((await testInstance(instance)).valid).toBe(false);
            expect(fetch).not.toHaveBeenCalled();
        } finally { read.mockRestore(); fetch.mockRestore(); }
    });

    it('includes a stalled permission check in the finite attempt budget', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        vi.mocked(chrome.permissions.contains).mockImplementationOnce(() => new Promise(() => {}));
        mockDeepLTranslate.mockResolvedValue({ translation: 'Hola', serviceId: 'deepl' });
        const pending = translateWithFallback(defaultParams, defaultPrefs, validApiKeys);
        await vi.advanceTimersByTimeAsync(4000);
        expect(await pending).toMatchObject({ instanceId: 'deepl', warnings: [{ code: 'TIMEOUT', instanceId: 'google-web' }] });
        expect(mockGoogleTranslate).not.toHaveBeenCalled();
        expect(mockDeepLTranslate).toHaveBeenCalledTimes(1);
    });

});
