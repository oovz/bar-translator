/**
 * Unit Tests for DeepL Service
 *
 * @module tests/unit/services/deepl.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeepLTranslationService } from '@/services/deepl';
import { getServiceDefinition } from '@/services/base';
import type { ApiCredential } from '@/src/types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('DeepLTranslationService', () => {
    let service: DeepLTranslationService;
    const definition = getServiceDefinition('deepl');
    const validKey: ApiCredential = { key: 'valid-key:fx', validated: true, tier: 'free' };

    beforeEach(() => {
        service = new DeepLTranslationService(definition);
        vi.clearAllMocks();
    });

    describe('translate', () => {
        it('uses free endpoint for :fx keys', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    translations: [{ text: 'Hola', detected_source_language: 'EN' }]
                })
            });

            await service.translate({
                text: 'Hello',
                sourceLang: 'en',
                targetLang: 'es',
                apiKey: validKey.key,
                tier: validKey.tier
            });

            const url = fetchMock.mock.calls[0][0];
            expect(url).toContain('api-free.deepl.com');
        });

        it('uses pro endpoint for non-fx keys', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    translations: [{ text: 'Hola', detected_source_language: 'EN' }]
                })
            });

            await service.translate({
                text: 'Hello',
                sourceLang: 'en',
                targetLang: 'es',
                apiKey: 'pro-key',
                tier: 'pro'
            });

            const url = fetchMock.mock.calls[0][0];
            expect(url).toContain('api.deepl.com');
        });

        it('throws AUTH_ERROR if key is missing', async () => {
            await expect(service.translate({
                text: 'Hello',
                sourceLang: 'en',
                targetLang: 'es'
            })).rejects.toThrow('API key required');
        });

        it('throws QUOTA_EXCEEDED on 456', async () => {
            fetchMock.mockResolvedValue({
                ok: false,
                status: 456
            });

            await expect(service.translate({
                text: 'Hello',
                sourceLang: 'en',
                targetLang: 'es',
                apiKey: validKey.key
            })).rejects.toThrow('DeepL Quota Exceeded');
        });
    });

    describe('validateApiKey', () => {
        it('returns valid: true on 200 OK', async () => {
            fetchMock.mockResolvedValue({ ok: true });
            const result = await service.validateApiKey('test:fx');
            expect(result.valid).toBe(true);
            expect(result.tier).toBe('free');
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('usage'),
                expect.objectContaining({ method: 'GET' })
            );
        });

        it('returns valid: false on error', async () => {
            fetchMock.mockResolvedValue({ ok: false, statusText: 'Unauthorized' });
            const result = await service.validateApiKey('bad-key');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unauthorized');
        });
    });
});
