/**
 * Lingva Translation Service
 *
 * Lingva is a free, open-source Google Translate proxy that works
 * in regions where Google is blocked. It requires no API key.
 *
 * @see https://github.com/thedaviddelta/lingva-translate
 * @module services/lingva
 */

import { BaseTranslationService } from './base';
import { TranslationError } from '@/utils/errors';
import type {
    TranslationService,
    TranslateParams,
    TranslateResult
} from '@/src/types';

export class LingvaTranslationService extends BaseTranslationService {
    constructor(public readonly service: TranslationService) {
        super();
    }

    async translate(params: TranslateParams): Promise<TranslateResult> {
        const { text, sourceLang, targetLang } = params;

        // Lingva uses 'auto' for auto-detect
        const sl = sourceLang === 'auto' ? 'auto' : sourceLang;
        const tl = targetLang;

        // Lingva API: /api/v1/{source}/{target}/{text}
        // Use lingva.ml as default, but can be self-hosted
        const baseUrl = this.service.endpoint || 'https://lingva.ml/api/v1';
        const encodedText = encodeURIComponent(text);
        const url = `${baseUrl}/${sl}/${tl}/${encodedText}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                }
            });

            if (!response.ok) {
                throw new TranslationError(
                    'SERVICE_UNAVAILABLE',
                    `Lingva returned status ${response.status}`,
                    {
                        serviceId: this.service.id,
                        httpStatus: response.status
                    }
                );
            }

            const data = await response.json();

            if (!data.translation) {
                throw new TranslationError(
                    'SCRAPING_FAILED',
                    'Could not get translation from Lingva response',
                    { serviceId: this.service.id }
                );
            }

            return {
                translation: data.translation,
                serviceId: this.service.id,
                detectedSourceLang: data.info?.detectedSource
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
}
