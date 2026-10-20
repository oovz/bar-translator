/**
 * Google Translate Web Service
 * 
 * Implements translation via the Google Translate mobile web interface.
 * Does not require an API key.
 * 
 * @module services/google-web
 */

import { BaseTranslationService } from './base';
import { TranslationError } from '@/utils/errors';
import { toGoogleLanguage } from '@/utils/languages';
import type {
    TranslationService,
    TranslateParams,
    TranslateResult
} from '@/src/types';

export class GoogleTranslationWebService extends BaseTranslationService {
    constructor(public readonly service: TranslationService) {
        super();
    }

    async translate(params: TranslateParams): Promise<TranslateResult> {
        const { text, sourceLang, targetLang } = params;

        // Convert to Google Translate's expected format
        const sl = toGoogleLanguage(sourceLang);
        const tl = toGoogleLanguage(targetLang);

        const url = new URL(this.service.endpoint || 'https://translate.google.com/m');
        url.searchParams.set('sl', sl);
        url.searchParams.set('tl', tl);
        url.searchParams.set('q', text);

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                signal: params.signal,
                redirect: 'manual',
            });

            // Redirects may lead to a challenge or consent page outside provider access.
            // An opaque redirect does not expose its destination or prove its cause.
            if (response.type === 'opaqueredirect') {
                throw new TranslationError(
                    'SERVICE_UNAVAILABLE',
                    'Google Translate mobile redirected instead of returning a translation',
                    { serviceId: this.service.id }
                );
            }

            if (!response.ok) {
                throw new TranslationError(
                    response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE',
                    `Google Translate returned status ${response.status}`,
                    {
                        serviceId: this.service.id,
                        httpStatus: response.status
                    }
                );
            }

            const html = await response.text();
            const translation = this.parseResponse(html);

            if (!translation) {
                throw new TranslationError(
                    'WEB_REQUEST_FAILED',
                    'Could not parse translation from response',
                    { serviceId: this.service.id }
                );
            }

            return {
                translation,
                serviceId: this.service.id
            };

        } catch (error) {
            params.signal?.throwIfAborted();
            if (error instanceof TranslationError) throw error;

            throw new TranslationError(
                'NETWORK_ERROR',
                error instanceof Error ? error.message : 'Unknown network error',
                { serviceId: this.service.id }
            );
        }
    }

    private parseResponse(html: string): string | null {
        // Google Translate mobile page changes its HTML structure frequently.
        // Try multiple known patterns in order of likelihood.

        // Pattern 1: result-container (historical)
        const resultContainerMatch = html.match(
            /<div[^>]*class="result-container"[^>]*>([\s\S]*?)<\/div>/
        );
        if (resultContainerMatch?.[1]) {
            return this.decodeHtml(resultContainerMatch[1].trim());
        }

        // Pattern 2: t0 class (common alternative)
        const t0Match = html.match(
            /<div[^>]*class="t0"[^>]*>([\s\S]*?)<\/div>/
        );
        if (t0Match?.[1]) {
            return this.decodeHtml(t0Match[1].trim());
        }

        // Pattern 3: result class with data attributes
        const resultMatch = html.match(
            /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        );
        if (resultMatch?.[1]) {
            const text = resultMatch[1].replace(/<[^>]+>/g, '').trim();
            if (text) return this.decodeHtml(text);
        }

        // Pattern 4: Look for translation in specific span with lang attribute
        // <span lang="fr">Bonjour</span>
        const langSpanMatch = html.match(
            /<span[^>]*lang="[^"]*"[^>]*>([^<]+)<\/span>/
        );
        if (langSpanMatch?.[1]) {
            return this.decodeHtml(langSpanMatch[1].trim());
        }

        // Pattern 5: Mobile result in after-translation div
        const afterTranslateMatch = html.match(
            /class="[^"]*after-translate[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        );
        if (afterTranslateMatch?.[1]) {
            const text = afterTranslateMatch[1].replace(/<[^>]+>/g, '').trim();
            if (text) return this.decodeHtml(text);
        }

        // Pattern 6: Any div with translation-related id/class containing substantial text
        const translationDivMatch = html.match(
            /<div[^>]*(?:id|class)="[^"]*(?:result|translation|output)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
        );
        if (translationDivMatch?.[1]) {
            const text = translationDivMatch[1].replace(/<[^>]+>/g, '').trim();
            if (text && text.length > 0 && text.length < 1000) {
                return this.decodeHtml(text);
            }
        }

        return null;
    }

    private decodeHtml(html: string): string {
        // Basic entity decoding for common chars
        return html
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }
}
