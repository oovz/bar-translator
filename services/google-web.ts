/** Keyless, best-effort Google Translate integration using its unofficial GTX route. */
import { BaseTranslationService } from './base';
import { TranslationError } from '@/utils/errors';
import { toGoogleLanguage } from '@/utils/languages';
import type { TranslationService, TranslateParams, TranslateResult } from '@/src/types';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Bound untrusted JSON, including chunked bodies without a reliable Content-Length. */
async function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const reader = response.body?.getReader();
    if (!reader) throw new SyntaxError('Missing Google translation body');
    const chunks: Uint8Array[] = [];
    let length = 0;
    const cancel = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            const { done, value } = await reader.read();
            signal?.throwIfAborted();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_RESPONSE_BYTES) {
                void reader.cancel().catch(() => undefined);
                throw new SyntaxError('Google translation body is too large');
            }
            chunks.push(value);
        }
    } finally {
        signal?.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

/** GTX places translated strings in the first field of its ordered segment array. */
function parseTranslation(data: unknown): string {
    if (!Array.isArray(data) || !Array.isArray(data[0]) || !data[0].length) {
        throw new SyntaxError('Invalid Google translation segments');
    }
    const segments: unknown[] = data[0];
    const translated: string[] = [];
    for (const segment of segments) {
        if (!Array.isArray(segment) || (typeof segment[0] !== 'string' && segment[0] !== null)) {
            throw new SyntaxError('Invalid Google translation segment');
        }
        // Optional phonetic segments can have null translated output.
        if (typeof segment[0] === 'string') translated.push(segment[0]);
    }
    const translation = translated.join('');
    if (!translation.trim()) throw new SyntaxError('Missing Google translation');
    return translation;
}

export class GoogleTranslationWebService extends BaseTranslationService {
    constructor(public readonly service: TranslationService) {
        super();
    }

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

            // An opaque redirect exposes neither its destination nor its cause.
            if (response.type === 'opaqueredirect') {
                throw new TranslationError(
                    'SERVICE_UNAVAILABLE',
                    'Google Translate redirected instead of returning a translation',
                    { serviceId: this.service.id },
                );
            }
            if (!response.ok) {
                void response.body?.cancel().catch(() => undefined);
                throw new TranslationError(
                    response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE',
                    `Google Translate returned status ${response.status}`,
                    { serviceId: this.service.id, httpStatus: response.status },
                );
            }
            let translation: string;
            try {
                translation = parseTranslation(await readJson(response, params.signal));
            } catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
                throw new TranslationError(
                    'WEB_REQUEST_FAILED',
                    'Google Translate returned an invalid translation response.',
                    { serviceId: this.service.id },
                );
            }
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
