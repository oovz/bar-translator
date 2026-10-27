/**
 * Unit Tests for DeepL Service
 *
 * @module tests/unit/services/deepl.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { DeepLTranslationService } from '@/services/deepl';
import { getServiceDefinition } from '@/services/base';
import type { ApiCredential } from '@/src/types';

let fetchMock: MockedFunction<typeof fetch>;

afterEach(() => vi.restoreAllMocks());

describe('DeepLTranslationService', () => {
    let service: DeepLTranslationService;
    const definition = getServiceDefinition('deepl');
    const validKey: ApiCredential = { key: 'valid-key:fx', validated: true, tier: 'free' };

    beforeEach(() => {
        service = new DeepLTranslationService(definition);
        vi.clearAllMocks();
        fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request'));
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    });

    describe('translate', () => {
        it.each([
            { key: 'free-key:fx', tier: undefined, endpoint: 'api-free.deepl.com', source: 'auto' },
            { key: 'pro-key', tier: 'pro' as const, endpoint: 'api.deepl.com', source: 'en' },
        ])('sends the documented request to $endpoint with source $source', async ({ key, tier, endpoint, source }) => {
            fetchMock.mockResolvedValue(Response.json({
                translations: [{ text: 'Hola', detected_source_language: 'EN' }],
            }));

            expect(await service.translate({
                text: 'Hello', sourceLang: source, targetLang: 'es', apiKey: key, tier,
            })).toEqual({ translation: 'Hola', detectedSourceLang: 'en', serviceId: 'deepl' });
            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, request] = fetchMock.mock.calls[0]!;
            expect(url).toBe(`https://${endpoint}/v2/translate`);
            expect(request).toMatchObject({
                method: 'POST',
                headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            });
            expect(Object.fromEntries(request!.body as URLSearchParams)).toEqual({
                text: 'Hello', target_lang: 'ES', ...(source === 'auto' ? {} : { source_lang: 'EN' }),
            });
        });

        it('reports INVALID_API_KEY without sending a request when a key is missing', async () => {
            await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es' }))
                .rejects.toMatchObject({ code: 'INVALID_API_KEY', serviceId: 'deepl' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it.each([
            [403, 'INVALID_API_KEY'], [456, 'QUOTA_EXCEEDED'],
            [429, 'RATE_LIMITED'], [529, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE'],
        ])('classifies HTTP %s as %s without retrying', async (status, code) => {
            fetchMock.mockResolvedValue(new Response(null, { status }));
            await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es', apiKey: validKey.key }))
                .rejects.toMatchObject({ code, httpStatus: status, serviceId: 'deepl' });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it.each([
            null, {}, { translations: [] },
            { translations: [{ detected_source_language: 'EN' }] },
            { translations: [{ text: {}, detected_source_language: 'EN' }] },
            { translations: [{ text: '  ', detected_source_language: 'EN' }] },
            { translations: [{ text: 'Hola', detected_source_language: 42 }] },
        ])('rejects malformed translation payload %j as a provider failure', async payload => {
            fetchMock.mockResolvedValue(Response.json(payload));
            await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es', apiKey: validKey.key }))
                .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceId: 'deepl' });
        });

        it('reports malformed JSON as a provider response failure', async () => {
            fetchMock.mockResolvedValue(new Response('{invalid'));
            await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es', apiKey: validKey.key }))
                .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceId: 'deepl' });
        });

        it('accepts an unchanged translation', async () => {
            fetchMock.mockResolvedValue(Response.json({ translations: [{ text: '123', detected_source_language: 'EN' }] }));
            expect((await service.translate({ text: '123', sourceLang: 'en', targetLang: 'es', apiKey: validKey.key })).translation).toBe('123');
        });

        it.each(['fetch', 'body'])('preserves the caller abort reason during %s', async stage => {
            const controller = new AbortController();
            const reason = new Error('Superseded input');
            const abort = () => { controller.abort(reason); throw new DOMException('Aborted', 'AbortError'); };
            if (stage === 'fetch') fetchMock.mockImplementation(async () => abort());
            else {
                const response = new Response('{}');
                vi.spyOn(response, 'json').mockImplementation(async () => abort());
                fetchMock.mockResolvedValue(response);
            }
            await expect(service.translate({
                text: 'Hello', sourceLang: 'en', targetLang: 'es', apiKey: validKey.key, signal: controller.signal,
            })).rejects.toBe(reason);
            expect(fetchMock.mock.calls[0]![1]?.signal).toBe(controller.signal);
        });

        it('keeps a rejected fetch classified as a network failure', async () => {
            fetchMock.mockRejectedValue(new TypeError('Connection failed'));
            await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es', apiKey: validKey.key }))
                .rejects.toMatchObject({ code: 'NETWORK_ERROR', serviceId: 'deepl' });
        });
    });

    describe('validateApiKey', () => {
        it('does not test or fetch when provider access is missing', async () => {
            vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
            expect(await service.validateApiKey('test:fx')).toMatchObject({ valid: false });
            expect(fetchMock).not.toHaveBeenCalled();
            expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://api-free.deepl.com/*', 'https://api.deepl.com/*'] });
        });

        it('propagates permission query failures without making a request', async () => {
            vi.mocked(chrome.permissions.contains).mockRejectedValueOnce(new Error('Permission query failed'));
            await expect(service.validateApiKey('test:fx')).rejects.toThrow();
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('does not retest a key when checking availability after a failed explicit test', async () => {
            fetchMock.mockResolvedValueOnce(new Response(null, { status: 403, statusText: 'Unauthorized' }));
            expect((await service.validateApiKey('user-key')).valid).toBe(false);
            expect(await service.isAvailable('user-key')).toBe(true);
            expect(await service.isAvailable()).toBe(false);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('returns valid: true on 200 OK', async () => {
            fetchMock.mockResolvedValue(new Response('{}'));
            const result = await service.validateApiKey('test:fx');
            expect(result.valid).toBe(true);
            expect(result.tier).toBe('free');
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('usage'),
                expect.objectContaining({ method: 'GET' })
            );
        });

        it('returns valid: false on error', async () => {
            fetchMock.mockResolvedValue(new Response(null, { status: 403, statusText: 'Unauthorized' }));
            const result = await service.validateApiKey('bad-key');
            expect(result.valid).toBe(false);
            expect(result.error).toBeTruthy();
            expect(result.error).not.toContain('Unauthorized');
        });

        it('checks a Pro key against its usage endpoint without submitting translation text', async () => {
            fetchMock.mockResolvedValue(new Response('{}'));
            expect(await service.validateApiKey('test-pro-key')).toEqual({ valid: true, tier: 'pro' });
            expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://api.deepl.com/v2/usage', {
                method: 'GET', headers: { Authorization: 'DeepL-Auth-Key test-pro-key' }, redirect: 'error', signal: expect.any(AbortSignal),
            });
        });

        it('respects the configured tier when testing a key instead of relying on its suffix', async () => {
            fetchMock.mockResolvedValue(new Response('{}'));
            expect(await service.validateApiKey('custom-free-key', 'free')).toMatchObject({ valid: true, tier: 'free' });
            expect(fetchMock).toHaveBeenCalledWith('https://api-free.deepl.com/v2/usage', expect.objectContaining({
                redirect: 'error', signal: expect.any(AbortSignal),
            }));
        });

        it('rejects an empty key without a request', async () => {
            expect((await service.validateApiKey('')).valid).toBe(false);
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });
});
