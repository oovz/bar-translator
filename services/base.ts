/**
 * Base Service Interface and Types
 *
 * Defines the core interface that all translation services must implement.
 *
 * @module services/base
 */

import type {
    TranslationService,
    TranslationServiceHandler,
    TranslateParams,
    TranslateResult,
    ValidationResult,
    LanguageInfo,
    ServiceId,
    ServiceType,
    AuthMethod,
    HttpMethod,
} from '@/src/types';

/**
 * Re-export types for convenience.
 */
export type {
    TranslationService,
    TranslationServiceHandler,
    TranslateParams,
    TranslateResult,
    ValidationResult,
    LanguageInfo,
    ServiceId,
    ServiceType,
    AuthMethod,
    HttpMethod,
};

/**
 * Base class for translation service implementations.
 * Provides common functionality and enforces interface.
 */
export abstract class BaseTranslationService implements TranslationServiceHandler {
    abstract readonly service: TranslationService;

    /**
     * Perform translation. Must be implemented by subclasses.
     */
    abstract translate(params: TranslateParams): Promise<TranslateResult>;

    /**
     * Validate API key. Override in services that require API keys.
     */
    async validateApiKey?(_apiKey: string): Promise<ValidationResult> {
        return { valid: true };
    }

    /**
     * Get supported languages. Override to provide service-specific list.
     */
    async getSupportedLanguages?(): Promise<LanguageInfo[]> {
        return [];
    }

    /**
     * Check if service is available (has valid API key if required).
     */
    async isAvailable(apiKey?: string): Promise<boolean> {
        if (!this.service.requiresApiKey) return true;
        if (!apiKey) return false;
        if (this.validateApiKey) {
            const result = await this.validateApiKey(apiKey);
            return result.valid;
        }
        return true;
    }

    /**
     * Get appropriate endpoint based on tier.
     */
    getEndpoint(tier?: 'free' | 'pro'): string {
        if (tier === 'free' && this.service.freeEndpoint) {
            return this.service.freeEndpoint;
        }
        if (tier === 'pro' && this.service.proEndpoint) {
            return this.service.proEndpoint;
        }
        return this.service.endpoint ?? '';
    }

    /**
     * Build authorization header based on auth method.
     */
    buildAuthHeader(apiKey: string): Record<string, string> {
        switch (this.service.authMethod) {
            case 'header-auth-key':
                return { Authorization: `DeepL-Auth-Key ${apiKey}` };
            case 'header-bearer':
                return { Authorization: `Bearer ${apiKey}` };
            case 'api-key-header':
                return { 'X-API-Key': apiKey };
            case 'none':
            default:
                return {};
        }
    }
}

/**
 * Static service definitions for all supported translation services.
 */
export const TRANSLATION_SERVICES: readonly TranslationService[] = [
    {
        id: 'google-web',
        name: 'Google Translate (Web)',
        type: 'web',
        requiresApiKey: false,
        authMethod: 'none',
        httpMethod: 'GET',
        endpoint: 'https://translate.google.com/m',
        maxTextLength: 5000,
    },
    {
        id: 'lingva',
        name: 'Lingva (Google Proxy)',
        type: 'web',
        requiresApiKey: false,
        authMethod: 'none',
        httpMethod: 'GET',
        endpoint: 'https://lingva.ml/api/v1',
        maxTextLength: 5000,
    },
    {
        id: 'deepl',
        name: 'DeepL',
        type: 'api',
        requiresApiKey: true,
        authMethod: 'header-auth-key',
        httpMethod: 'POST',
        freeEndpoint: 'https://api-free.deepl.com/v2/translate',
        proEndpoint: 'https://api.deepl.com/v2/translate',
        maxTextLength: 5000,
    },
    {
        id: 'microsoft',
        name: 'Microsoft Translator',
        type: 'api',
        requiresApiKey: true,
        authMethod: 'api-key-header',
        httpMethod: 'POST',
        endpoint: 'https://api.cognitive.microsofttranslator.com/translate',
        maxTextLength: 50000,
    },
    {
        id: 'yandex',
        name: 'Yandex Translate',
        type: 'api',
        requiresApiKey: true,
        authMethod: 'header-bearer',
        httpMethod: 'POST',
        endpoint: 'https://translate.api.cloud.yandex.net/translate/v2/translate',
        maxTextLength: 10000,
    },
    {
        id: 'baidu',
        name: 'Baidu Translate (百度翻译)',
        type: 'api',
        requiresApiKey: true,
        authMethod: 'none', // Uses appid+salt+sign in body
        httpMethod: 'POST',
        endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
        maxTextLength: 6000,
    },
    {
        id: 'youdao',
        name: 'Youdao Translate (有道翻译)',
        type: 'api',
        requiresApiKey: true,
        authMethod: 'none', // Uses appKey+salt+sign in body
        httpMethod: 'POST',
        endpoint: 'https://openapi.youdao.com/api',
        maxTextLength: 5000,
    },
    {
        id: 'google-cloud',
        name: 'Google Cloud Translation',
        type: 'api',
        requiresApiKey: true,
        authMethod: 'header-bearer',
        httpMethod: 'POST',
        endpoint:
            'https://translation.googleapis.com/v3/projects/-/locations/global:translateText',
        maxTextLength: 30000,
    },
] as const;

/**
 * Get service definition by ID.
 */
export function getServiceDefinition(id: ServiceId): TranslationService {
    const service = TRANSLATION_SERVICES.find((s) => s.id === id);
    if (!service) throw new Error(`Unknown service: ${id}`);
    return service;
}

/**
 * Get all service definitions.
 */
export function getAllServiceDefinitions(): readonly TranslationService[] {
    return TRANSLATION_SERVICES;
}
