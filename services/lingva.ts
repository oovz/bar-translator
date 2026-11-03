/** Lingva API: https://github.com/thedaviddelta/lingva-translate */

import { TranslationError } from '@/utils/errors';
import { toLingvaLanguage } from '@/utils/languages';
import type {
    TranslationService,
    TranslationServiceHandler,
    TranslateParams,
    TranslateResult
} from '@/src/types';

function detectedLanguage(info: unknown): string | undefined {
    return info && typeof info === 'object' && 'detectedSource' in info && typeof info.detectedSource === 'string'
        ? info.detectedSource : undefined;
}

function translationResult(data: unknown, serviceId: TranslationService['id']): TranslateResult {
    if (!data || typeof data !== 'object' ||
        !('translation' in data) || typeof data.translation !== 'string' || !data.translation.trim()) {
        throw new TranslationError('SERVICE_UNAVAILABLE',
            'Could not get translation from Lingva response', { serviceId });
    }
    return {
        translation: data.translation,
        serviceId,
        detectedSourceLang: detectedLanguage('info' in data ? data.info : undefined),
    };
}

export class LingvaTranslationService implements TranslationServiceHandler {
    constructor(public readonly service: TranslationService) {}

    async translate(params: TranslateParams): Promise<TranslateResult> {
        const { text, sourceLang, targetLang } = params;

        const sl = toLingvaLanguage(sourceLang);
        const tl = toLingvaLanguage(targetLang);

        const baseUrl = this.service.endpoint || 'https://lingva.ml/api/v1';
        const encodedText = encodeURIComponent(text);
        const url = `${baseUrl}/${sl}/${tl}/${encodedText}`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                redirect: 'error',
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

            return translationResult(await response.json(), this.service.id);

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
