/**
 * Translation Service Registry and Orchestrator
 *
 * Manages available services, handles fallback logic, and provides
 * the main translation entry point.
 *
 * @module services/index
 */

import type {
    TranslationServiceHandler,
    TranslateParams,
    TranslateResult,
    TranslateResultWithMeta,
    ServiceId,
    UserPreferences,
    StoredApiKeys,
} from '@/src/types';
import { TranslationError } from '@/utils/errors';
import { getServiceDefinition, getAllServiceDefinitions } from './base';
import type { TranslationService } from './base';

import { GoogleScraperService } from './google-scraper';
import { DeepLTranslationService } from './deepl';
import { LingvaTranslationService } from './lingva';

// Service implementations will be registered here
const serviceRegistry = new Map<ServiceId, TranslationServiceHandler>();

// Register default services
const googleDefinition = getServiceDefinition('google-scraper');
registerService(new GoogleScraperService(googleDefinition));

const lingvaDefinition = getServiceDefinition('lingva');
registerService(new LingvaTranslationService(lingvaDefinition));

const deeplDefinition = getServiceDefinition('deepl');
registerService(new DeepLTranslationService(deeplDefinition));

/**
 * Register a translation service handler.
 */
export function registerService(handler: TranslationServiceHandler): void {
    serviceRegistry.set(handler.service.id, handler);
}

/**
 * Get a registered service handler by ID.
 */
export function getService(id: ServiceId): TranslationServiceHandler | undefined {
    return serviceRegistry.get(id);
}

/**
 * Get all registered service handlers.
 */
export function getRegisteredServices(): TranslationServiceHandler[] {
    return Array.from(serviceRegistry.values());
}

/**
 * Check if a service is registered.
 */
export function isServiceRegistered(id: ServiceId): boolean {
    return serviceRegistry.has(id);
}

/**
 * Get service definition (static metadata).
 */
export { getServiceDefinition, getAllServiceDefinitions };

/**
 * Check if a service can be used (registered and has valid API key if required).
 */
export async function isServiceAvailable(
    id: ServiceId,
    apiKeys: StoredApiKeys
): Promise<boolean> {
    const handler = serviceRegistry.get(id);
    if (!handler) return false;

    const service = handler.service;
    if (!service.requiresApiKey) return true;

    // Check if we have a validated API key
    const storageKey = getStorageKeyForService(id);
    if (!storageKey) return true;

    const credential = apiKeys[storageKey];
    return credential?.validated === true;
}

/**
 * Get storage key for a service's API key.
 */
function getStorageKeyForService(id: ServiceId): keyof StoredApiKeys | null {
    switch (id) {
        case 'deepl':
            return 'deepl';
        case 'google-cloud':
            return 'googleCloud';
        case 'yandex':
            return 'yandex';
        case 'microsoft':
            return 'microsoft';
        case 'baidu':
            return 'baidu';
        case 'youdao':
            return 'youdao';
        case 'google-scraper':
        case 'lingva':
        default:
            return null;
    }
}

/**
 * Translate with fallback support.
 *
 * Uses preferences.fallbackOrder as the ordered list of enabled services.
 * First service = primary, rest = fallbacks (tried in order on failure).
 */
export async function translateWithFallback(
    params: TranslateParams,
    preferences: UserPreferences,
    apiKeys: StoredApiKeys
): Promise<TranslateResultWithMeta> {
    // fallbackOrder IS the complete list of enabled services
    const enabledServices = preferences.fallbackOrder;

    console.log('[Translate] Starting translation request:', {
        text: params.text.substring(0, 50) + (params.text.length > 50 ? '...' : ''),
        sourceLang: params.sourceLang,
        targetLang: params.targetLang,
        enabledServices: enabledServices,
    });

    if (enabledServices.length === 0) {
        console.error('[Translate] No services enabled!');
        throw new TranslationError(
            'ALL_SERVICES_FAILED',
            'No translation services enabled. Enable at least one service in settings.'
        );
    }

    // Filter to services that are registered and available (have API key if needed)
    const availableServices: ServiceId[] = [];
    for (const id of enabledServices) {
        const isAvail = await isServiceAvailable(id, apiKeys);
        console.log(`[Translate] Service ${id}: registered=${isServiceRegistered(id)}, available=${isAvail}`);
        if (isAvail) {
            availableServices.push(id);
        }
    }

    if (availableServices.length === 0) {
        console.error('[Translate] No available services (all need API keys?)');
        throw new TranslationError(
            'ALL_SERVICES_FAILED',
            'No translation services available. Check API key configuration.'
        );
    }
    let lastError: TranslationError | null = null;

    for (let i = 0; i < availableServices.length; i++) {
        const serviceId = availableServices[i];
        const handler = serviceRegistry.get(serviceId);
        if (!handler) {
            console.warn(`[Translate] Service ${serviceId} not registered, skipping`);
            continue;
        }

        const isFallback = i > 0;
        console.log(`[Translate] Trying service: ${serviceId}${isFallback ? ' (fallback)' : ' (primary)'}`);

        try {
            // Get API key if needed
            const storageKey = getStorageKeyForService(serviceId);
            const apiKey = storageKey ? apiKeys[storageKey]?.key : undefined;
            const tier = storageKey ? apiKeys[storageKey]?.tier : undefined;

            console.log(`[Translate] Sending to ${serviceId}:`, {
                text: params.text,
                sourceLang: params.sourceLang,
                targetLang: params.targetLang,
                hasApiKey: !!apiKey,
            });

            const result = await handler.translate({
                ...params,
                apiKey,
                tier,
            });

            console.log(`[Translate] SUCCESS from ${serviceId}:`, {
                translation: result.translation.substring(0, 100) + (result.translation.length > 100 ? '...' : ''),
                detectedLang: result.detectedSourceLang,
            });

            return {
                ...result,
                usedFallback: isFallback,
                cached: false,
            };
        } catch (error) {
            console.error(`[Translate] FAILED from ${serviceId}:`, error);

            if (error instanceof TranslationError) {
                lastError = error;

                // Don't fallback for certain errors (e.g., invalid input)
                if (!error.shouldTriggerFallback()) {
                    throw error;
                }

                console.warn(`[Translate] ${serviceId} failed, trying next service...`);
            } else {
                lastError = new TranslationError(
                    'SERVICE_UNAVAILABLE',
                    String(error),
                    { serviceId }
                );
            }

            // If this was the last service, throw
            if (i === availableServices.length - 1) {
                throw lastError;
            }
        }
    }

    throw lastError ?? new TranslationError('ALL_SERVICES_FAILED', 'All services failed');
}

/**
 * Direct translation with a specific service (no fallback).
 */
export async function translateDirect(
    serviceId: ServiceId,
    params: TranslateParams,
    apiKeys: StoredApiKeys
): Promise<TranslateResult> {
    const handler = serviceRegistry.get(serviceId);
    if (!handler) {
        throw new TranslationError(
            'SERVICE_UNAVAILABLE',
            `Service ${serviceId} not registered`
        );
    }

    const storageKey = getStorageKeyForService(serviceId);
    const apiKey = storageKey ? apiKeys[storageKey]?.key : undefined;
    const tier = storageKey ? apiKeys[storageKey]?.tier : undefined;

    return handler.translate({
        ...params,
        apiKey,
        tier,
    });
}

// Re-export types for convenience
export type { TranslationService, TranslationServiceHandler };
