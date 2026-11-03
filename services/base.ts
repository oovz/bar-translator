import type { TranslationService, ServiceId } from '@/src/types';

const TRANSLATION_SERVICES: readonly TranslationService[] = [
    {
        id: 'google-web',
        name: 'Google Translate (Web)',
        endpoint: 'https://translate.googleapis.com/translate_a/single',
    },
    {
        id: 'lingva',
        name: 'Lingva (Google Proxy)',
        endpoint: 'https://lingva.ml/api/v1',
    },
    {
        id: 'libretranslate',
        name: 'LibreTranslate',
        endpoint: 'https://libretranslate.com',
    },
    {
        id: 'deepl',
        name: 'DeepL',
    },
];

export function getServiceDefinition(id: ServiceId): TranslationService {
    const service = TRANSLATION_SERVICES.find(candidate => candidate.id === id);
    if (!service) throw new Error(`Unknown service: ${id}`);
    return service;
}
