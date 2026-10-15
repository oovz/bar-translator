import { afterEach, describe, expect, it, vi } from 'vitest';
import { LingvaTranslationService } from '@/services/lingva';
import { getServiceDefinition } from '@/services/base';

afterEach(() => vi.restoreAllMocks());

describe('Lingva translation', () => {
    const service = new LingvaTranslationService(getServiceDefinition('lingva'));

    it('translates without credentials and encodes text within the configured endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            translation: 'Bonjour / ami?', info: { detectedSource: 'en' },
        })));
        const result = await service.translate({ text: 'Hello / friend?', sourceLang: 'auto', targetLang: 'fr' });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://lingva.ml/api/v1/auto/fr/Hello%20%2F%20friend%3F', {
            method: 'GET', headers: { Accept: 'application/json' }, signal: undefined,
        });
        expect(result).toEqual({ translation: 'Bonjour / ami?', detectedSourceLang: 'en', serviceId: 'lingva' });
    });

    it('reports provider failure when a response has no translation', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Unavailable' })));
        await expect(service.translate({ text: 'Hello', sourceLang: 'en', targetLang: 'fr' }))
            .rejects.toThrow('Could not get translation from Lingva response');
    });
});
