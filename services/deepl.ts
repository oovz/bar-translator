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
import type {
    TranslationService,
    TranslateParams,
    TranslateResult,
    ValidationResult
} from '@/src/types';

interface DeepLResponse {
    translations: {
        text: string;
        detected_source_language: string;
    }[];
}

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

        const body = new URLSearchParams();
        body.append('text', text);
        body.append('target_lang', targetLang.toUpperCase());
        if (sourceLang !== 'auto') {
            body.append('source_lang', sourceLang.toUpperCase());
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
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
                    'SERVICE_UNAVAILABLE',
                    `DeepL returned status ${response.status}`,
                    { serviceId: this.service.id, httpStatus: response.status }
                );
            }

            const data = await response.json() as DeepLResponse;

            if (!data.translations || data.translations.length === 0) {
                throw new TranslationError('SERVICE_UNAVAILABLE', 'No translation returned', { serviceId: this.service.id });
            }

            const result = data.translations[0];

            return {
                translation: result.text,
                detectedSourceLang: result.detected_source_language.toLowerCase(),
                serviceId: this.service.id
            };

        } catch (error) {
            if (error instanceof TranslationError) throw error;

            throw new TranslationError(
                'NETWORK_ERROR',
                error instanceof Error ? error.message : 'Unknown network error',
                { serviceId: this.service.id }
            );
        }
    }

    async validateApiKey(apiKey: string): Promise<ValidationResult> {
        if (!apiKey) return { valid: false, error: 'Empty key' };

        // Lightweight check: Get Usage or Translate trivial text
        // Usage endpoint: GET /v2/usage
        const isFreeKey = apiKey.endsWith(':fx');
        const endpoint = isFreeKey
            ? 'https://api-free.deepl.com/v2/usage'
            : 'https://api.deepl.com/v2/usage';

        try {
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Authorization': `DeepL-Auth-Key ${apiKey}`
                }
            });

            if (response.ok) {
                return { valid: true, tier: isFreeKey ? 'free' : 'pro' };
            } else {
                return { valid: false, error: `Validation failed: ${response.statusText}`, tier: isFreeKey ? 'free' : 'pro' };
            }
        } catch (e) {
            return { valid: false, error: e instanceof Error ? e.message : 'Network error' };
        }
    }
}
