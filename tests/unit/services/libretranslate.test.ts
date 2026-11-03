import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { LibreTranslateService, probeLibreTranslate, testLibreTranslate } from '@/services/libretranslate';
import type { TranslationService } from '@/src/types';

const definition: TranslationService = {
    id: 'libretranslate', name: 'LibreTranslate', endpoint: 'https://libretranslate.com',
};
const params = { text: 'Hello', sourceLang: 'en', targetLang: 'es' };
const languages = [
    { code: 'en', name: 'English', targets: ['es'] },
    { code: 'es', name: 'Spanish', targets: ['en'] },
];

describe('LibreTranslateService', () => {
    let fetchMock: MockedFunction<typeof fetch>;
    let service: LibreTranslateService;

    beforeEach(() => {
        service = new LibreTranslateService(definition);
        fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request'));
    });
    afterEach(() => vi.restoreAllMocks());

    it('connects to a custom server without sending a key or translation text', async () => {
        fetchMock.mockResolvedValue(Response.json(languages));
        expect(await probeLibreTranslate('http://127.0.0.1:5000/libre')).toBe(true);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:5000/libre/languages', expect.objectContaining({
            method: 'GET', credentials: 'omit', redirect: 'error', body: undefined,
        }));
    });

    it('sends managed translation text and a supplied key through the documented JSON API', async () => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: 'Hola' }));

        expect(await service.translate({ ...params, apiKey: 'user-key' })).toMatchObject({
            translation: 'Hola', serviceId: 'libretranslate',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, request] = fetchMock.mock.calls[0]!;
        expect(url).toBe('https://libretranslate.com/translate');
        expect(request).toMatchObject({
            method: 'POST', credentials: 'omit', redirect: 'error',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        });
        expect(JSON.parse(request!.body as string)).toEqual({
            q: 'Hello', source: 'en', target: 'es', format: 'text', api_key: 'user-key',
        });
    });

    it('preserves a custom HTTP port and deployment prefix without sending an absent key', async () => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: '你好' }));
        await service.translate({
            text: '您好', sourceLang: 'zh-TW', targetLang: 'zh-CN',
            endpoint: 'http://192.168.1.4:5000/libre/',
        });
        const [url, request] = fetchMock.mock.calls[0]!;
        expect(url).toBe('http://192.168.1.4:5000/libre/translate');
        expect(JSON.parse(request!.body as string)).toEqual({
            q: '您好', source: 'zh-Hant', target: 'zh-Hans', format: 'text',
        });
    });

    it.each([
        ['pt-BR', 'pt-BR'], ['pt-PT', 'pt-pt'], ['en-GB', 'en-gb'],
    ])('preserves the meaning of target %s in its public LibreTranslate code %s', async (targetLang, expected) => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: 'sample' }));
        await service.translate({ ...params, targetLang });
        expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).target).toBe(expected);
    });

    it('supports auto detection and maps the detected script back to the common language vocabulary', async () => {
        fetchMock.mockResolvedValue(Response.json({
            translatedText: 'Hello', detectedLanguage: { language: 'zh-Hant', confidence: 90 },
        }));
        expect(await service.translate({ text: '您好', sourceLang: 'auto', targetLang: 'en' })).toEqual({
            translation: 'Hello', detectedSourceLang: 'zh-TW', serviceId: 'libretranslate',
        });
        expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).source).toBe('auto');
    });

    it.each([
        ['zh-Hans', 'zh-CN'], ['zh-Hant', 'zh-TW'], ['pt-BR', 'pt-BR'], ['EN', 'en'],
    ])('maps detected language %s to %s', async (language, expected) => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: 'Hola', detectedLanguage: { language } }));
        expect(await service.translate(params)).toMatchObject({ translation: 'Hola', detectedSourceLang: expected });
    });

    it.each([[4096, 'API_KEY_REQUIRED'], [4097, 'SERVICE_UNAVAILABLE']])(
        'interprets documented server errors only within the %s-character boundary', async (length, code) => {
            const prefix = 'Visit https://server.example/';
            const suffix = ' to get an API key.';
            const error = prefix + 'x'.repeat(Number(length) - prefix.length - suffix.length) + suffix;
            fetchMock.mockResolvedValue(Response.json({ error }, { status: 400 }));
            await expect(service.translate(params)).rejects.toMatchObject({ code, httpStatus: 400 });
        },
    );

    it.each([0, 100])('accepts detected-language confidence at boundary %s', async confidence => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: 'Hola', detectedLanguage: { language: 'en', confidence } }));
        expect(await service.translate(params)).toMatchObject({ translation: 'Hola', detectedSourceLang: 'en' });
    });

    it.each([-1, '90', null])('rejects invalid detected-language confidence %j', async confidence => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: 'Hola', detectedLanguage: { language: 'en', confidence } }));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('accepts unchanged translations without claiming a provider failure', async () => {
        fetchMock.mockResolvedValue(Response.json({ translatedText: '123' }));
        expect((await service.translate({ ...params, text: '123' })).translation).toBe('123');
    });

    it.each([
        [400, 'Please contact the server operator to get an API key', 'API_KEY_REQUIRED'],
        [400, 'Visit https://operator.example/keys to get an API key', 'API_KEY_REQUIRED'],
        [403, 'Invalid API key', 'INVALID_API_KEY'],
        [403, 'Too many request limits violations', 'RATE_LIMITED'],
        [429, 'Slowdown: 10 per minute', 'RATE_LIMITED'],
        [400, 'en-gb is not supported', 'INSTANCE_LANGUAGE_UNSUPPORTED'],
        [400, 'auto is not supported', 'INSTANCE_LANGUAGE_UNSUPPORTED'],
        [400, 'Spanish (es) is not available as a target language from English (en)', 'INSTANCE_LANGUAGE_UNSUPPORTED'],
        [400, 'Invalid request: request (600) exceeds text limit (500)', 'INSTANCE_TEXT_TOO_LONG'],
        [403, 'Request denied by upstream proxy', 'SERVICE_UNAVAILABLE'],
        [400, 'An unrelated request-validation error', 'SERVICE_UNAVAILABLE'],
        [503, 'Temporarily unavailable', 'SERVICE_UNAVAILABLE'],
    ])('classifies HTTP %s (%s) as %s without retrying', async (status, error, code) => {
        fetchMock.mockResolvedValue(Response.json({ error }, { status }));
        await expect(service.translate(params)).rejects.toMatchObject({
            code, httpStatus: status, serviceId: 'libretranslate',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not expose a server error body containing translation text or credentials', async () => {
        fetchMock.mockResolvedValue(Response.json({ error: 'private-text private-key' }, { status: 400 }));
        await expect(service.translate({ ...params, text: 'private-text', apiKey: 'private-key' }))
            .rejects.toMatchObject({ message: expect.not.stringMatching(/private-text|private-key/) });
    });

    it.each([
        null, { translatedText: ['Hola'] }, { translatedText: ' ' },
        { translatedText: 'Hola', detectedLanguage: null },
        { translatedText: 'Hola', detectedLanguage: { language: ['en'] } },
        { translatedText: 'Hola', detectedLanguage: { language: 42 } },
        { translatedText: 'Hola', detectedLanguage: { language: 'en', confidence: 101 } },
    ])('rejects malformed translation data as an instance failure', async payload => {
        fetchMock.mockResolvedValue(Response.json(payload));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('rejects a successful non-JSON response as a provider failure', async () => {
        fetchMock.mockResolvedValue(new Response('<html>unavailable</html>'));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('preserves a known rate-limit status even when a proxy supplies non-JSON diagnostics', async () => {
        fetchMock.mockResolvedValue(new Response('<html>slow down</html>', { status: 429 }));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
    });

    it('rejects a successful response with no body as a provider failure', async () => {
        fetchMock.mockResolvedValue(new Response(null));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('bounds a chunked response and cancels reading an oversized body', async () => {
        const cancel = vi.fn();
        fetchMock.mockResolvedValue(new Response(new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024)); },
            cancel,
        })));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('keeps network diagnostics containing the endpoint or key out of the error message', async () => {
        fetchMock.mockRejectedValue(new TypeError('Request to http://private-host with secret-key failed'));
        await expect(service.translate(params)).rejects.toMatchObject({
            code: 'NETWORK_ERROR', message: expect.not.stringMatching(/private-host|secret-key/),
        });
    });

    it('does not start a request that was already cancelled', async () => {
        const controller = new AbortController();
        const reason = new Error('Superseded');
        controller.abort(reason);
        await expect(service.translate({ ...params, signal: controller.signal })).rejects.toBe(reason);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preserves the caller cancellation reason when fetch rejects', async () => {
        const controller = new AbortController();
        const reason = new Error('Superseded');
        fetchMock.mockImplementation(async () => {
            controller.abort(reason);
            throw new DOMException('Aborted', 'AbortError');
        });
        await expect(service.translate({ ...params, signal: controller.signal })).rejects.toBe(reason);
    });

    it('cancels a pending body read and preserves the caller cancellation reason', async () => {
        const controller = new AbortController();
        const reason = new Error('Superseded');
        let beganReading!: () => void;
        const reading = new Promise<void>(resolve => { beganReading = resolve; });
        const cancel = vi.fn();
        fetchMock.mockResolvedValue(new Response(new ReadableStream({
            pull() { beganReading(); }, cancel,
        }, { highWaterMark: 0 })));
        const operation = service.translate({ ...params, signal: controller.signal });
        await reading;
        controller.abort(reason);
        await expect(operation).rejects.toBe(reason);
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('requires at least one well-formed advertised language to confirm a connection', async () => {
        fetchMock.mockResolvedValueOnce(Response.json([]))
            .mockResolvedValueOnce(Response.json([{ code: 'en', name: 'English', targets: ['en'] }]));
        expect(await probeLibreTranslate('http://localhost:5000')).toBe(false);
        expect(await probeLibreTranslate('http://localhost:5000')).toBe(true);
    });

    it.each([
        [null],
        [{ code: 42, name: 'English', targets: ['en'] }],
        [{ code: 'not a code', name: 'English', targets: ['en'] }],
        [{ code: 'en', name: 42, targets: ['en'] }],
        [{ code: 'en', name: 'English', targets: 'en' }],
        [{ code: 'en', name: 'English', targets: [42] }],
        [{ code: 'en', name: 'English', targets: ['not a code'] }],
    ].map(payload => [payload]))('does not confirm a connection from malformed language discovery %j', async payload => {
        fetchMock.mockResolvedValue(Response.json(payload));
        expect(await probeLibreTranslate('http://localhost:5000')).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    describe('explicit connection test', () => {
        it('chooses an advertised language pair and verifies a fixed translation after discovery', async () => {
            fetchMock.mockResolvedValueOnce(Response.json(languages.map(language => language.code === 'en'
                ? { ...language, targets: ['en', 'es'] } : language)))
                .mockResolvedValueOnce(Response.json({ translatedText: 'Hola' }));
            expect(await testLibreTranslate('http://localhost:5000/libre', 'test-key')).toEqual({ valid: true });
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:5000/libre/languages');
            const [url, request] = fetchMock.mock.calls[1]!;
            expect(url).toBe('http://localhost:5000/libre/translate');
            expect(JSON.parse(request!.body as string)).toMatchObject({
                q: expect.any(String), source: 'en', target: 'es', api_key: 'test-key', format: 'text',
            });
        });

        it('does not treat successful language discovery as API-key validation', async () => {
            fetchMock.mockResolvedValueOnce(Response.json(languages))
                .mockResolvedValueOnce(Response.json({ error: 'Invalid API key' }, { status: 403 }));
            expect(await testLibreTranslate('https://libretranslate.com', 'bad-key')).toMatchObject({ valid: false });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it.each([
            {}, [{ code: 'en', name: 'English', targets: [42] }],
            [{ code: 'en', name: 'English', targets: ['xx'] }],
        ])('does not submit a sample when discovery is malformed or has no installed target', async payload => {
            fetchMock.mockResolvedValueOnce(Response.json(payload));
            expect(await testLibreTranslate('http://localhost:5000')).toMatchObject({ valid: false });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('preserves cancellation rather than reporting an ordinary failed test', async () => {
            const controller = new AbortController();
            const reason = new Error('Settings changed');
            fetchMock.mockImplementation(async () => {
                controller.abort(reason);
                throw new DOMException('Aborted', 'AbortError');
            });
            await expect(testLibreTranslate('http://localhost:5000', undefined, controller.signal)).rejects.toBe(reason);
        });
    });
});
