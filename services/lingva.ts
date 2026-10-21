/**
 * Lingva Translation Service
 *
 * Lingva is a free, open-source Google Translate proxy. Public deployment
 * availability varies. It requires no API key.
 *
 * @see https://github.com/thedaviddelta/lingva-translate
 * @module services/lingva
 */

import { BaseTranslationService } from './base';
import { TranslationError } from '@/utils/errors';
import { toLingvaLanguage } from '@/utils/languages';
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

        // Convert to Lingva's expected format (same as Google Translate)
        const sl = toLingvaLanguage(sourceLang);
        const tl = toLingvaLanguage(targetLang);

        // Lingva API: /api/v1/{source}/{target}/{text}
        // Use lingva.ml as default, but can be self-hosted
        const baseUrl = this.service.endpoint || 'https://lingva.ml/api/v1';
        const encodedText = encodeURIComponent(text);
        const url = `${baseUrl}/${sl}/${tl}/${encodedText}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: params.signal,
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

            const data: unknown = await response.json();

            if (!data || typeof data !== 'object' ||
                !('translation' in data) || typeof data.translation !== 'string' || !data.translation.trim()) {
                throw new TranslationError(
                    'SERVICE_UNAVAILABLE',
                    'Could not get translation from Lingva response',
                    { serviceId: this.service.id }
                );
            }

            const info = 'info' in data ? data.info : undefined;
            const detectedSourceLang = info && typeof info === 'object' &&
                'detectedSource' in info && typeof info.detectedSource === 'string'
                ? info.detectedSource : undefined;

            return {
                translation: data.translation,
                serviceId: this.service.id,
                detectedSourceLang
            };

        } catch (error) {
            params.signal?.throwIfAborted();
            if (error instanceof TranslationError) throw error;
            if (error instanceof SyntaxError) {
                throw new TranslationError('SERVICE_UNAVAILABLE', 'Invalid Lingva translation response', { serviceId: this.service.id });
            }

            throw new TranslationError(
                'NETWORK_ERROR',
                error instanceof Error ? error.message : 'Unknown network error',
                { serviceId: this.service.id }
            );
        }
    }
}
