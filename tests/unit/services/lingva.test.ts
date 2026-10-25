import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { LingvaTranslationService } from '@/services/lingva';
import { getServiceDefinition } from '@/services/base';

let fetchMock: MockedFunction<typeof fetch>;
beforeEach(() => { fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request')); });
afterEach(() => vi.restoreAllMocks());

describe('Lingva translation', () => {
    const service = new LingvaTranslationService(getServiceDefinition('lingva'));

    it('translates without credentials and encodes text within the configured endpoint', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({
            translation: 'Bonjour / ami?', info: { detectedSource: 'en' },
        })));
        const result = await service.translate({ text: 'Hello / friend?', sourceLang: 'auto', targetLang: 'fr' });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://lingva.ml/api/v1/auto/fr/Hello%20%2F%20friend%3F', {
            method: 'GET', headers: { Accept: 'application/json' }, signal: undefined, redirect: 'error',
        });
        expect(result).toEqual({ translation: 'Bonjour / ami?', detectedSourceLang: 'en', serviceId: 'lingva' });
    });

    it('reports provider failure when a response has no translation', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Unavailable' })));
        await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'fr' }))
            .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceId: 'lingva' });
    });

    it.each([null, {}, { translation: [] }, { translation: { text: 'Hola' } }, { translation: 123 }, { translation: '  ' }])(
        'rejects malformed translation payload %j as a provider failure', async payload => {
            fetchMock.mockResolvedValue(Response.json(payload));
            await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es' }))
                .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceId: 'lingva' });
        },
    );

    it('reports malformed JSON as a provider response failure', async () => {
        fetchMock.mockResolvedValue(new Response('{invalid'));
        await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es' }))
            .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', serviceId: 'lingva' });
    });

    it('accepts unchanged translations and ignores malformed optional detection metadata', async () => {
        fetchMock.mockResolvedValue(Response.json({ translation: '123', info: { detectedSource: { language: 'en' } } }));
        expect(await service.translate({ text: '123', sourceLang: 'en', targetLang: 'es' }))
            .toEqual({ translation: '123', serviceId: 'lingva', detectedSourceLang: undefined });
    });

    it('reports an unavailable service without retrying', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
        await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es' }))
            .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', httpStatus: 503, serviceId: 'lingva' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
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
        await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es', signal: controller.signal }))
            .rejects.toBe(reason);
        expect(fetchMock.mock.calls[0]![1]?.signal).toBe(controller.signal);
    });

    it('keeps a rejected fetch classified as a network failure', async () => {
        fetchMock.mockRejectedValue(new TypeError('Connection failed'));
        await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'es' }))
            .rejects.toMatchObject({ code: 'NETWORK_ERROR', serviceId: 'lingva' });
    });
});
