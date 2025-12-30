/**
 * Unit Tests for Google Scraper Service
 *
 * @module tests/unit/services/google-scraper.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleScraperService } from '@/services/google-scraper';
import { getServiceDefinition } from '@/services/base';
import { TranslationError } from '@/utils/errors';

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('GoogleScraperService', () => {
    let service: GoogleScraperService;
    const definition = getServiceDefinition('google-scraper');

    beforeEach(() => {
        service = new GoogleScraperService(definition);
        vi.clearAllMocks();
    });

    describe('translate', () => {
        it('successfully parses translation from valid HTML', async () => {
            const mockHtml = `
        <!DOCTYPE html>
        <html>
        <body>
          <div class="result-container">Hello world</div>
        </body>
        </html>
      `;

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(mockHtml),
            });

            const result = await service.translate({
                text: 'Bonjour le monde',
                sourceLang: 'fr',
                targetLang: 'en',
            });

            expect(result.translation).toBe('Hello world');
            expect(result.serviceId).toBe('google-scraper');
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('translate.google.com/m'),
                expect.anything()
            );
        });

        it('handles auto-detect source language', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve('<div class="result-container">Translated</div>'),
            });

            await service.translate({
                text: 'Test',
                sourceLang: 'auto',
                targetLang: 'en',
            });

            const url = new URL(fetchMock.mock.calls[0][0]);
            expect(url.searchParams.get('sl')).toBe('auto');
        });

        it('decodes HTML entities in result', async () => {
            const mockHtml = '<div class="result-container">You &amp; Me</div>';

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(mockHtml),
            });

            const result = await service.translate({
                text: 'Toi et Moi',
                sourceLang: 'fr',
                targetLang: 'en',
            });

            expect(result.translation).toBe('You & Me');
        });

        it('parses translation from t0 class (alternative pattern)', async () => {
            const mockHtml = '<div class="t0">Bonjour</div>';

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(mockHtml),
            });

            const result = await service.translate({
                text: 'Hello',
                sourceLang: 'en',
                targetLang: 'fr',
            });

            expect(result.translation).toBe('Bonjour');
        });

        it('parses translation from lang span (alternative pattern)', async () => {
            const mockHtml = '<html><body><span lang="fr">Bonjour monde</span></body></html>';

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(mockHtml),
            });

            const result = await service.translate({
                text: 'Hello world',
                sourceLang: 'en',
                targetLang: 'fr',
            });

            expect(result.translation).toBe('Bonjour monde');
        });

        it('parses translation from generic result class', async () => {
            const mockHtml = '<div class="translation-result">Hola</div>';

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve(mockHtml),
            });

            const result = await service.translate({
                text: 'Hello',
                sourceLang: 'en',
                targetLang: 'es',
            });

            expect(result.translation).toBe('Hola');
        });

        it('throws SERVICE_UNAVAILABLE on non-200 response', async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
            });

            await expect(
                service.translate({
                    text: 'test',
                    sourceLang: 'en',
                    targetLang: 'fr',
                })
            ).rejects.toThrow(TranslationError);

            try {
                await service.translate({
                    text: 'test',
                    sourceLang: 'en',
                    targetLang: 'fr',
                });
            } catch (e) {
                if (e instanceof TranslationError) {
                    expect(e.code).toBe('SERVICE_UNAVAILABLE');
                }
            }
        });

        it('throws SCRAPING_FAILED when missing result container', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                text: () => Promise.resolve('<html>No result here</html>'),
            });

            await expect(
                service.translate({
                    text: 'test',
                    sourceLang: 'en',
                    targetLang: 'fr',
                })
            ).rejects.toThrow(TranslationError);

            try {
                await service.translate({
                    text: 'test',
                    sourceLang: 'en',
                    targetLang: 'fr',
                });
            } catch (e) {
                if (e instanceof TranslationError) {
                    expect(e.code).toBe('SCRAPING_FAILED');
                }
            }
        });

        it('handles network errors', async () => {
            fetchMock.mockRejectedValue(new Error('Network error'));

            await expect(
                service.translate({
                    text: 'test',
                    sourceLang: 'en',
                    targetLang: 'fr',
                })
            ).rejects.toThrow(TranslationError);
        });
    });
});
