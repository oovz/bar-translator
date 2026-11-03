/** Keyless, best-effort Google Translate integration using its unofficial GTX route. */
import { readBoundedJson } from './response-json';
import { TranslationError } from '@/utils/errors';
import { toGoogleLanguage } from '@/utils/languages';
import type { TranslationService, TranslationServiceHandler, TranslateParams, TranslateResult } from '@/src/types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
    return readBoundedJson(response, 'Missing Google translation body',
        () => new SyntaxError('Google translation body is too large'), signal);
}

function translatedSegment(segment: unknown): string | null {
    if (!Array.isArray(segment) || (typeof segment[0] !== 'string' && segment[0] !== null)) {
        throw new SyntaxError('Invalid Google translation segment');
    }
    // Optional phonetic segments can have null translated output.
    return segment[0];
}

/** GTX places translated strings in the first field of its ordered segment array. */
function parseTranslation(data: unknown): string {
    if (!Array.isArray(data) || !Array.isArray(data[0]) || !data[0].length) {
        throw new SyntaxError('Invalid Google translation segments');
    }
    const segments: unknown[] = data[0];
    const translation = segments.map(translatedSegment).join('');
    if (!translation.trim()) throw new SyntaxError('Missing Google translation');
    return translation;
}

function checkResponse(response: Response, serviceId: TranslationService['id']): void {
    // An opaque redirect exposes neither its destination nor its cause.
    if (response.type === 'opaqueredirect') {
        throw new TranslationError('SERVICE_UNAVAILABLE',
            'Google Translate redirected instead of returning a translation', { serviceId });
    }
    if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new TranslationError(response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE',
            `Google Translate returned status ${response.status}`, { serviceId, httpStatus: response.status });
    }
}

async function responseTranslation(response: Response, serviceId: TranslationService['id'], signal?: AbortSignal): Promise<string> {
    try {
        return parseTranslation(await readJson(response, signal));
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new TranslationError('WEB_REQUEST_FAILED',
            'Google Translate returned an invalid translation response.', { serviceId });
    }
}

export class GoogleTranslationWebService implements TranslationServiceHandler {
    constructor(public readonly service: TranslationService) {}

    async translate(params: TranslateParams): Promise<TranslateResult> {
        params.signal?.throwIfAborted();
        const url = new URL(ENDPOINT);
        url.searchParams.set('client', 'gtx');
        url.searchParams.set('dt', 't');
        url.searchParams.set('sl', toGoogleLanguage(params.sourceLang));
        url.searchParams.set('tl', toGoogleLanguage(params.targetLang));
        url.searchParams.set('q', params.text);

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                credentials: 'omit',
                signal: params.signal,
                redirect: 'manual',
            });

            checkResponse(response, this.service.id);
            const translation = await responseTranslation(response, this.service.id, params.signal);
            return { translation, serviceId: this.service.id };
        } catch (error) {
            params.signal?.throwIfAborted();
            if (error instanceof TranslationError) throw error;
            throw new TranslationError(
                'NETWORK_ERROR',
                'Google Translate could not complete the request.',
                { serviceId: this.service.id },
            );
        }
    }
}
