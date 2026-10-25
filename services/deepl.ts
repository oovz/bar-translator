/**
 * DeepL Translation Service
 * 
 * Implements translation via the official DeepL API.
 * Supports both Free and Pro API tiers.
 * 
 * @module services/deepl
 */

import { BaseTranslationService } from './base';
import { TranslationError } from '@/utils/errors';
import { hasProviderAccess } from '@/utils/permissions';
import { toDeepLLanguage, fromDeepLLanguage } from '@/utils/languages';
import type {
    TranslationService,
    TranslateParams,
    TranslateResult,
    ValidationResult,
    ApiTier
} from '@/src/types';

export class DeepLTranslationService extends BaseTranslationService {
    constructor(public readonly service: TranslationService) {
        super();
    }

    async translate(params: TranslateParams): Promise<TranslateResult> {
        if (!params.apiKey) {
            throw new TranslationError(
                'INVALID_API_KEY',
                'API key required for DeepL',
                { serviceId: this.service.id }
            );
        }

        const { text, sourceLang, targetLang, apiKey, tier } = params;

        // Determine endpoint based on tier or key suffix
        // Use provided tier if available, otherwise guess from key
        const isFreeKey = tier === 'free' || (!tier && apiKey.endsWith(':fx'));
        const endpoint = this.getEndpoint(isFreeKey ? 'free' : 'pro');

        // Convert to DeepL's expected format (uppercase, special codes for Chinese)
        const body = new URLSearchParams();
        body.append('text', text);
        body.append('target_lang', toDeepLLanguage(targetLang));
        if (sourceLang !== 'auto') {
            body.append('source_lang', toDeepLLanguage(sourceLang));
        }

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

            if (!response.ok) {
                // Handle specific DeepL error codes
                if (response.status === 403) {
                    throw new TranslationError('INVALID_API_KEY', 'Invalid DeepL API Key', {
                        serviceId: this.service.id,
                        httpStatus: 403
                    });
                }
                if (response.status === 456) {
                    throw new TranslationError('QUOTA_EXCEEDED', 'DeepL Quota Exceeded', {
                        serviceId: this.service.id,
                        httpStatus: 456
                    });
                }

                throw new TranslationError(
                    response.status === 429 || response.status === 529 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE',
                    `DeepL returned status ${response.status}`,
                    { serviceId: this.service.id, httpStatus: response.status }
                );
            }

            const data: unknown = await response.json();
            const result: unknown = data && typeof data === 'object' &&
                'translations' in data && Array.isArray(data.translations)
                ? data.translations[0] : undefined;
            if (!result || typeof result !== 'object' ||
                !('text' in result) || typeof result.text !== 'string' || !result.text.trim() ||
                !('detected_source_language' in result) || typeof result.detected_source_language !== 'string' ||
                !result.detected_source_language.trim()) {
                throw new TranslationError('SERVICE_UNAVAILABLE', 'Invalid DeepL translation response', { serviceId: this.service.id });
            }

            return {
                translation: result.text,
                detectedSourceLang: fromDeepLLanguage(result.detected_source_language),
                serviceId: this.service.id
            };

        } catch (error) {
            params.signal?.throwIfAborted();
            if (error instanceof TranslationError) throw error;
            if (error instanceof SyntaxError) {
                throw new TranslationError('SERVICE_UNAVAILABLE', 'Invalid DeepL translation response', { serviceId: this.service.id });
            }

            throw new TranslationError(
                'NETWORK_ERROR',
                error instanceof Error ? error.message : 'Unknown network error',
                { serviceId: this.service.id }
            );
        }
    }

    override async validateApiKey(apiKey: string, tier?: ApiTier, signal = AbortSignal.timeout(4000)): Promise<ValidationResult> {
        if (!apiKey) return { valid: false, error: 'Empty key' };
        if (!await hasProviderAccess(this.service.id)) {
            return { valid: false, error: 'DeepL access required. Allow provider access in settings before testing.' };
        }

        // Lightweight check: Get Usage or Translate trivial text
        // Usage endpoint: GET /v2/usage
        const isFreeKey = tier === 'free' || (!tier && apiKey.endsWith(':fx'));
        const endpoint = isFreeKey
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
                return { valid: true, tier: isFreeKey ? 'free' : 'pro' };
            } else {
                return { valid: false, error: 'DeepL rejected the test request.', tier: isFreeKey ? 'free' : 'pro' };
            }
        } catch {
            return { valid: false, error: 'Could not complete the DeepL test.' };
        }
    }
}
