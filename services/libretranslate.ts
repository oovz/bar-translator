import { BaseTranslationService } from './base';
import { TranslationError } from '@/utils/errors';
import { MANAGED_LIBRETRANSLATE_ENDPOINT, normalizeEndpoint } from '@/utils/instances';
import type { TranslationService, TranslateParams, TranslateResult, ValidationResult } from '@/src/types';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

interface SupportedLanguage {
    code: string;
    name: string;
    targets: string[];
}

function providerError(code: ConstructorParameters<typeof TranslationError>[0], httpStatus?: number): TranslationError {
    return new TranslationError(code, 'LibreTranslate could not complete the request.', {
        serviceId: 'libretranslate', httpStatus,
    });
}

/** Equivalent public codes documented by LibreTranslate's language alias table. */
function toLibreLanguage(code: string): string {
    const normalized = code.toLowerCase();
    const aliases: Record<string, string> = {
        zh: 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-hans': 'zh-Hans',
        'zh-tw': 'zh-Hant', 'zh-hant': 'zh-Hant',
        'pt-br': 'pt-BR',
    };
    return aliases[normalized] ?? normalized;
}

function fromLibreLanguage(code: string): string {
    switch (code.toLowerCase()) {
        case 'zh-hans': return 'zh-CN';
        case 'zh-hant': return 'zh-TW';
        case 'pt-br': return 'pt-BR';
        default: return code.toLowerCase();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Bound untrusted response bodies, including chunked responses without Content-Length. */
async function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const reader = response.body?.getReader();
    if (!reader) throw new SyntaxError('Missing JSON body');
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
                throw providerError('SERVICE_UNAVAILABLE', response.status);
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

function responseError(status: number, data: unknown): TranslationError {
    // Interpret only documented English error forms; never surface server text or URLs.
    const message = isRecord(data) && typeof data.error === 'string' && data.error.length <= 4096 ? data.error : '';
    if (status === 401 || (status === 403 && /^Invalid API key\.?$/i.test(message))) {
        return providerError('INVALID_API_KEY', status);
    }
    if (status === 429 || (status === 403 && /^Too many request limits violations\.?$/i.test(message))) {
        return providerError('RATE_LIMITED', status);
    }
    if (status === 400) {
        if (/^(Please contact the server operator|Visit .+) to get an API key\.?$/i.test(message)) {
            return providerError('API_KEY_REQUIRED', status);
        }
        if (/^Invalid request: request \(\d+\) exceeds text limit \(\d+\)$/i.test(message)) {
            return providerError('INSTANCE_TEXT_TOO_LONG', status);
        }
        if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})* is not supported$/i.test(message) ||
            /^.+ \([a-z]{2,3}(?:-[a-z0-9]{2,8})*\) is not available as a target language from .+ \([a-z]{2,3}(?:-[a-z0-9]{2,8})*\)$/i.test(message) ||
            message === 'auto is not supported') {
            return providerError('INSTANCE_LANGUAGE_UNSUPPORTED', status);
        }
    }
    return providerError('SERVICE_UNAVAILABLE', status);
}

async function requestJson(
    endpoint: string,
    path: 'translate' | 'languages',
    signal?: AbortSignal,
    body?: Record<string, string>,
): Promise<unknown> {
    signal?.throwIfAborted();
    try {
        const response = await fetch(`${normalizeEndpoint(endpoint)}/${path}`, {
            method: body ? 'POST' : 'GET',
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'en',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal,
            credentials: 'omit',
            redirect: 'error',
        });
        signal?.throwIfAborted();
        if (!response.ok) {
            let data: unknown;
            try { data = await readJson(response, signal); }
            catch (error) {
                signal?.throwIfAborted();
                if (!(error instanceof SyntaxError)) throw error;
            }
            throw responseError(response.status, data);
        }
        return await readJson(response, signal);
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof TranslationError) throw error;
        if (error instanceof SyntaxError) throw providerError('SERVICE_UNAVAILABLE');
        throw providerError('NETWORK_ERROR');
    }
}

function translationResult(data: unknown): TranslateResult {
    if (!isRecord(data) || typeof data.translatedText !== 'string' || !data.translatedText.trim()) {
        throw providerError('SERVICE_UNAVAILABLE');
    }
    let detectedSourceLang: string | undefined;
    if (data.detectedLanguage !== undefined) {
        const detected = data.detectedLanguage;
        if (!isRecord(detected) || typeof detected.language !== 'string' || !LANGUAGE_CODE.test(detected.language) ||
            (detected.confidence !== undefined && (typeof detected.confidence !== 'number' ||
                !Number.isFinite(detected.confidence) || detected.confidence < 0 || detected.confidence > 100))) {
            throw providerError('SERVICE_UNAVAILABLE');
        }
        detectedSourceLang = fromLibreLanguage(detected.language);
    }
    return { translation: data.translatedText, detectedSourceLang, serviceId: 'libretranslate' };
}

async function translate(endpoint: string, params: TranslateParams): Promise<TranslateResult> {
    const data = await requestJson(endpoint, 'translate', params.signal, {
        q: params.text,
        source: toLibreLanguage(params.sourceLang),
        target: toLibreLanguage(params.targetLang),
        format: 'text',
        ...(params.apiKey ? { api_key: params.apiKey } : {}),
    });
    return translationResult(data);
}

export class LibreTranslateService extends BaseTranslationService {
    constructor(public readonly service: TranslationService) { super(); }

    async translate(params: TranslateParams): Promise<TranslateResult> {
        return translate(params.endpoint ?? this.service.endpoint ?? MANAGED_LIBRETRANSLATE_ENDPOINT, params);
    }
}

async function discoverLanguages(endpoint: string, signal?: AbortSignal): Promise<SupportedLanguage[]> {
    const data = await requestJson(endpoint, 'languages', signal);
    if (!Array.isArray(data) || !data.every((language): language is SupportedLanguage =>
        isRecord(language) && typeof language.code === 'string' && LANGUAGE_CODE.test(language.code) &&
        typeof language.name === 'string' && Array.isArray(language.targets) &&
        language.targets.every(target => typeof target === 'string' && LANGUAGE_CODE.test(target)))) {
        throw providerError('SERVICE_UNAVAILABLE');
    }
    return data;
}

/** First contact happens during setup, without sending credentials or translation text. */
export async function probeLibreTranslate(endpoint: string, signal?: AbortSignal): Promise<boolean> {
    const timeout = AbortSignal.timeout(4000);
    try {
        return (await discoverLanguages(endpoint, signal ? AbortSignal.any([signal, timeout]) : timeout)).length > 0;
    } catch {
        signal?.throwIfAborted();
        return false;
    }
}

/** An explicit test verifies both discovery and a real fixed-sample translation. */
export async function testLibreTranslate(endpoint: string, apiKey?: string, signal?: AbortSignal): Promise<ValidationResult> {
    try {
        const data = await discoverLanguages(endpoint, signal);
        const codes = new Set(data.map(language => language.code.toLowerCase()));
        let pair: { source: string; target: string } | undefined;
        for (const language of data) {
            const target = language.targets.find(code => code !== language.code && codes.has(code.toLowerCase())) ??
                language.targets.find(code => codes.has(code.toLowerCase()));
            if (target) { pair = { source: language.code, target }; break; }
        }
        if (!pair) throw providerError('INSTANCE_LANGUAGE_UNSUPPORTED');
        await translate(endpoint, {
            text: 'Hello', sourceLang: pair.source, targetLang: pair.target, apiKey, signal,
        });
        return { valid: true };
    } catch (error) {
        signal?.throwIfAborted();
        return { valid: false, error: error instanceof TranslationError
            ? error.getUserMessage() : 'LibreTranslate could not complete the test.' };
    }
}
