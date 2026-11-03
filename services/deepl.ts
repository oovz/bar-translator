import { TranslationError } from '@/utils/errors';
import { hasProviderAccess } from '@/utils/permissions';
import { toDeepLLanguage, toDeepLSourceLanguage, fromDeepLLanguage } from '@/utils/languages';
import type {
    TranslationService,
    TranslationServiceHandler,
    TranslateParams,
    TranslateResult,
    ValidationResult,
    ApiTier
} from '@/src/types';

function keyTier(apiKey: string, tier?: ApiTier): ApiTier {
    return tier === 'free' || (!tier && apiKey.endsWith(':fx')) ? 'free' : 'pro';
}

function translationBody(params: TranslateParams): URLSearchParams {
    const body = new URLSearchParams();
    body.append('text', params.text);
    body.append('target_lang', toDeepLLanguage(params.targetLang));
    if (params.sourceLang !== 'auto') body.append('source_lang', toDeepLSourceLanguage(params.sourceLang));
    return body;
}

function responseError(status: number, serviceId: TranslationService['id']): TranslationError {
    if (status === 403) return new TranslationError('INVALID_API_KEY', 'Invalid DeepL API Key', { serviceId, httpStatus: status });
    if (status === 456) return new TranslationError('QUOTA_EXCEEDED', 'DeepL Quota Exceeded', { serviceId, httpStatus: status });
    return new TranslationError(status === 429 || status === 529 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE',
        `DeepL returned status ${status}`, { serviceId, httpStatus: status });
}

function invalidResponse(serviceId: TranslationService['id']): TranslationError {
    return new TranslationError('SERVICE_UNAVAILABLE', 'Invalid DeepL translation response', { serviceId });
}

function firstTranslation(data: unknown): unknown {
    return data && typeof data === 'object' && 'translations' in data && Array.isArray(data.translations)
        ? data.translations[0] : undefined;
}

function nonemptyString(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value.trim());
}

function translationResult(data: unknown, serviceId: TranslationService['id']): TranslateResult {
    const result = firstTranslation(data);
    if (!result || typeof result !== 'object' ||
        !('text' in result) || !nonemptyString(result.text) ||
        !('detected_source_language' in result) || !nonemptyString(result.detected_source_language)) {
        throw invalidResponse(serviceId);
    }
    return {
        translation: result.text,
        detectedSourceLang: fromDeepLLanguage(result.detected_source_language),
        serviceId,
    };
}

export class DeepLTranslationService implements TranslationServiceHandler {
    constructor(public readonly service: TranslationService) {}

    async translate(params: TranslateParams): Promise<TranslateResult> {
        if (!params.apiKey) {
            throw new TranslationError(
                'INVALID_API_KEY',
                'API key required for DeepL',
                { serviceId: this.service.id }
            );
        }

        const { apiKey } = params;
        const endpoint = keyTier(apiKey, params.tier) === 'free'
            ? 'https://api-free.deepl.com/v2/translate'
            : 'https://api.deepl.com/v2/translate';
        const body = translationBody(params);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                redirect: 'error',
                signal: params.signal,
                headers: {
                    'Authorization': `DeepL-Auth-Key ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body
            });

            if (!response.ok) throw responseError(response.status, this.service.id);
            return translationResult(await response.json(), this.service.id);

        } catch (error) {
            params.signal?.throwIfAborted();
            if (error instanceof TranslationError) throw error;
            if (error instanceof SyntaxError) {
                throw invalidResponse(this.service.id);
            }

            throw new TranslationError(
                'NETWORK_ERROR',
                error instanceof Error ? error.message : 'Unknown network error',
                { serviceId: this.service.id }
            );
        }
    }

    async validateApiKey(apiKey: string, tier?: ApiTier, signal = AbortSignal.timeout(4000)): Promise<ValidationResult> {
        if (!apiKey) return { valid: false, error: 'Empty key' };
        if (!await hasProviderAccess(this.service.id)) {
            return { valid: false, error: 'DeepL access required. Allow provider access in settings before testing.' };
        }

        const resolvedTier = keyTier(apiKey, tier);
        const endpoint = resolvedTier === 'free'
            ? 'https://api-free.deepl.com/v2/usage'
            : 'https://api.deepl.com/v2/usage';

        try {
            const response = await fetch(endpoint, {
                method: 'GET',
                redirect: 'error',
                signal,
                headers: {
                    'Authorization': `DeepL-Auth-Key ${apiKey}`
                }
            });

            if (response.ok) {
                return { valid: true, tier: resolvedTier };
            } else {
                return { valid: false, error: 'DeepL rejected the test request.', tier: resolvedTier };
            }
        } catch {
            return { valid: false, error: 'Could not complete the DeepL test.' };
        }
    }
}
