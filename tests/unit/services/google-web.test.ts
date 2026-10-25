import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { GoogleTranslationWebService } from '@/services/google-web';
import { getServiceDefinition } from '@/services/base';

const params = { text: 'Hello', sourceLang: 'en', targetLang: 'fr' };

function translationResponse(translation: string) {
    return Response.json([[[translation, 'Hello', null, null, 1]], null, 'en']);
}

describe('GoogleTranslationWebService', () => {
    let service: GoogleTranslationWebService;
    let fetchMock: MockedFunction<typeof fetch>;

    beforeEach(() => {
        service = new GoogleTranslationWebService(getServiceDefinition('google-web'));
        fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request'));
    });
    afterEach(() => vi.restoreAllMocks());

    it('joins translated segments in order while preserving text and skipping null optional output', async () => {
        fetchMock.mockResolvedValue(Response.json([[
            ['Bonjour. ', 'Hello. ', null, null, 1],
            [null, null, 'phonetic output'],
            ['<Monde> & salut\n', 'World', null, null, 1],
        ], null, 'en']));

        expect(await service.translate(params)).toEqual({
            translation: 'Bonjour. <Monde> & salut\n', serviceId: 'google-web',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, request] = fetchMock.mock.calls[0]!;
        const parsed = new URL(url.toString());
        expect(parsed.origin).toBe('https://translate.googleapis.com');
        expect(parsed.pathname).toBe('/translate_a/single');
        expect(Object.fromEntries(parsed.searchParams)).toEqual({ client: 'gtx', dt: 't', sl: 'en', tl: 'fr', q: 'Hello' });
        expect(request).toEqual({ method: 'GET', credentials: 'omit', redirect: 'manual', signal: undefined });
    });

    it('keeps requests on the fixed Google endpoint despite supplied endpoint or credential values', async () => {
        service = new GoogleTranslationWebService({ ...getServiceDefinition('google-web'), endpoint: 'https://other.example' });
        fetchMock.mockResolvedValue(translationResponse('Bonjour'));
        const text = 'private text & q=?#'.repeat(250);
        await service.translate({ ...params, text, endpoint: 'http://other.example', apiKey: 'private-key' });
        const [url, request] = fetchMock.mock.calls[0]!;
        const parsed = new URL(url.toString());
        expect(parsed.origin).toBe('https://translate.googleapis.com');
        expect(parsed.searchParams.get('q')).toBe(text);
        expect(parsed.searchParams.size).toBe(5);
        expect(request).toEqual({ method: 'GET', credentials: 'omit', redirect: 'manual', signal: undefined });
    });

    it.each([
        ['auto', 'fr', 'auto', 'fr'],
        ['en', 'zh-CN', 'en', 'zh-CN'],
        ['en', 'nb', 'en', 'no'],
    ])('maps source %s and target %s to Google language codes', async (sourceLang, targetLang, source, target) => {
        fetchMock.mockResolvedValue(translationResponse('Translated'));
        await service.translate({ ...params, sourceLang, targetLang });
        const url = new URL(fetchMock.mock.calls[0]![0].toString());
        expect(url.searchParams.get('sl')).toBe(source);
        expect(url.searchParams.get('tl')).toBe(target);
    });

    it('accepts unchanged translations and does not decode JSON text as HTML', async () => {
        fetchMock.mockResolvedValue(translationResponse('123 &amp;'));
        expect((await service.translate({ ...params, text: '123 &amp;' })).translation).toBe('123 &amp;');
    });

    it('decodes a translated Unicode character split across response chunks', async () => {
        const bytes = new TextEncoder().encode(JSON.stringify([[['你好']]]));
        fetchMock.mockResolvedValue(new Response(new ReadableStream({
            start(controller) {
                for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                controller.close();
            },
        })));
        expect((await service.translate(params)).translation).toBe('你好');
    });

    it('stops opaque redirects without reading or exposing the redirected page', async () => {
        const response = new Response(null, { status: 302 });
        Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
        const read = vi.spyOn(response, 'text');
        fetchMock.mockResolvedValue(response);
        await expect(service.translate(params)).rejects.toMatchObject({
            code: 'SERVICE_UNAVAILABLE', serviceId: 'google-web',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(read).not.toHaveBeenCalled();
        expect(response.bodyUsed).toBe(false);
    });

    it.each([[429, 'RATE_LIMITED'], [302, 'SERVICE_UNAVAILABLE'], [503, 'SERVICE_UNAVAILABLE']])(
        'reports HTTP %s as %s without reading server diagnostics or retrying', async (status, code) => {
            const cancel = vi.fn();
            const response = new Response(new ReadableStream({
                start(controller) { controller.enqueue(new TextEncoder().encode('private text and private-key')); },
                cancel,
            }), { status });
            fetchMock.mockResolvedValue(response);
            await expect(service.translate(params)).rejects.toMatchObject({
                code, serviceId: 'google-web', httpStatus: status,
                message: expect.not.stringMatching(/private/),
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(cancel).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        null, { translation: 'Bonjour' }, [], [null], [[]], [[[]]],
        [[[42]]], [[['Bonjour'], ['invalid segment'], {}]],
        [[[null]]], [[[' \n']]],
    ])('rejects a malformed or empty translation response', async payload => {
        fetchMock.mockResolvedValue(Response.json(payload));
        await expect(service.translate(params)).rejects.toMatchObject({
            code: 'WEB_REQUEST_FAILED', serviceId: 'google-web',
        });
    });

    it.each(['<html><div class="result-container">Challenge text</div></html>', '[[["private text"]]'])(
        'rejects non-JSON and truncated JSON without exposing the body', async body => {
            fetchMock.mockResolvedValue(new Response(body));
            await expect(service.translate(params)).rejects.toMatchObject({
                code: 'WEB_REQUEST_FAILED', message: expect.not.stringMatching(/Challenge text|private text/),
            });
        },
    );

    it('bounds a chunked response regardless of its claimed length and cancels the body', async () => {
        const cancel = vi.fn();
        fetchMock.mockResolvedValue(new Response(new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
            cancel,
        }), { headers: { 'Content-Length': '1' } }));
        await expect(service.translate(params)).rejects.toMatchObject({ code: 'WEB_REQUEST_FAILED' });
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it.each([TypeError, SyntaxError])('sanitizes transport diagnostics without reclassifying rejected fetches (%s)', async ErrorType => {
        fetchMock.mockRejectedValue(new ErrorType('Request to https://translate.googleapis.com/?q=private-text failed'));
        await expect(service.translate({ ...params, text: 'private-text' })).rejects.toMatchObject({
            code: 'NETWORK_ERROR', serviceId: 'google-web',
            message: expect.not.stringMatching(/https:|private-text/),
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
});
