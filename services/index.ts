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
import { SERVICE_TO_STORAGE_KEY } from '@/src/types';
import { getServiceDefinition, getAllServiceDefinitions } from './base';
import type { TranslationService } from './base';

import { GoogleTranslationWebService } from './google-web';
import { DeepLTranslationService } from './deepl';
import { LingvaTranslationService } from './lingva';

// Service implementations will be registered here
const serviceRegistry = new Map<ServiceId, TranslationServiceHandler>();

// Register default services
const googleDefinition = getServiceDefinition('google-web');
registerService(new GoogleTranslationWebService(googleDefinition));

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
    const storageKey = SERVICE_TO_STORAGE_KEY[id];
    if (!storageKey) return true;

    const credential = apiKeys[storageKey];
    return credential?.validated === true;
}

const ATTEMPT_TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 10000;

async function translateAttempt(
    handler: TranslationServiceHandler,
    params: TranslateParams,
    deadline: number
): Promise<TranslateResult> {
    params.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = params.signal
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal;
    let rejectAborted!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
    const onAbort = () => rejectAborted(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = () => {
        controller.abort(new TranslationError('TIMEOUT', 'Translation timed out. Please try again.', {
            serviceId: handler.service.id,
        }));
    };
    const timer = setTimeout(timeout, deadline - performance.now());

    try {
        // Settle even if the provider ignores cancellation; abort also stops fetch/body reads.
        const result = await Promise.race([handler.translate({ ...params, signal }), aborted]);
        if (performance.now() >= deadline) timeout();
        signal.throwIfAborted();
        return result;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
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
    params.signal?.throwIfAborted();
    const deadline = performance.now() + TOTAL_TIMEOUT_MS;
    // fallbackOrder IS the complete list of enabled services
    const enabledServices = [...new Set(preferences.fallbackOrder)];

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
        params.signal?.throwIfAborted();
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) {
            throw new TranslationError('TIMEOUT', 'Translation timed out. Please try again.');
        }
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
            const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
            const apiKey = storageKey ? apiKeys[storageKey]?.key : undefined;
            const tier = storageKey ? apiKeys[storageKey]?.tier : undefined;

            console.log(`[Translate] Sending to ${serviceId}:`, {
                text: params.text,
                sourceLang: params.sourceLang,
                targetLang: params.targetLang,
                hasApiKey: !!apiKey,
            });

            const result = await translateAttempt(handler, {
                ...params,
                apiKey,
                tier,
            }, Math.min(deadline, performance.now() + ATTEMPT_TIMEOUT_MS));

            params.signal?.throwIfAborted();
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
            params.signal?.throwIfAborted();
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

    const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
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
