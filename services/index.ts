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
    TranslationWarning,
} from '@/src/types';
import { TranslationError } from '@/utils/errors';
import { hasProviderAccess } from '@/utils/permissions';
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
 * Check prerequisites without testing credentials or requesting access.
 */
export async function isServiceAvailable(
    id: ServiceId,
    apiKeys: StoredApiKeys
): Promise<boolean> {
    const handler = serviceRegistry.get(id);
    if (!handler) return false;

    return await getPrerequisiteError(handler, apiKeys) === undefined;
}

async function getPrerequisiteError(
    handler: TranslationServiceHandler,
    apiKeys: StoredApiKeys
): Promise<TranslationError | undefined> {
    const serviceId = handler.service.id;
    if (!await hasProviderAccess(serviceId)) {
        return new TranslationError('PERMISSION_REQUIRED', 'Provider access required. Check settings.', { serviceId });
    }
    const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
    if (handler.service.requiresApiKey && (!storageKey || !apiKeys[storageKey]?.key)) {
        return new TranslationError('API_KEY_REQUIRED', 'API key required. Check settings.', { serviceId });
    }
}

function withWarnings(error: TranslationError, warnings: readonly TranslationWarning[]): TranslationError {
    return new TranslationError(error.code, error.message, {
        serviceId: error.serviceId,
        httpStatus: error.httpStatus,
        warnings,
    });
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

    if (enabledServices.length === 0) {
        throw new TranslationError(
            'NO_SERVICES_ENABLED',
            'No translation services enabled. Enable at least one service in settings.'
        );
    }

    const warnings: TranslationWarning[] = [];
    let lastError: TranslationError | null = null;

    for (const [i, serviceId] of enabledServices.entries()) {
        params.signal?.throwIfAborted();
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) {
            throw new TranslationError('TIMEOUT', 'Translation timed out. Please try again.', { warnings });
        }
        const handler = serviceRegistry.get(serviceId);
        if (!handler) {
            lastError = new TranslationError('SERVICE_UNAVAILABLE', 'Translation service not registered.', { serviceId });
            warnings.push({ code: lastError.code, serviceId });
            continue;
        }

        const isFallback = i > 0;

        try {
            // Check immediately before this provider's attempt, including revoked grants.
            const prerequisiteError = await getPrerequisiteError(handler, apiKeys);
            params.signal?.throwIfAborted();
            if (prerequisiteError) throw prerequisiteError;
            if (performance.now() >= deadline) {
                throw new TranslationError('TIMEOUT', 'Translation timed out. Please try again.', { serviceId });
            }

            // Get API key if needed
            const storageKey = SERVICE_TO_STORAGE_KEY[serviceId];
            const apiKey = storageKey ? apiKeys[storageKey]?.key : undefined;
            const tier = storageKey ? apiKeys[storageKey]?.tier : undefined;

            const result = await translateAttempt(handler, {
                ...params,
                apiKey,
                tier,
            }, Math.min(deadline, performance.now() + ATTEMPT_TIMEOUT_MS));

            params.signal?.throwIfAborted();

            return {
                ...result,
                usedFallback: isFallback,
                cached: false,
                warnings,
            };
        } catch (error) {
            params.signal?.throwIfAborted();

            if (error instanceof TranslationError) {
                lastError = error;

                // Don't fallback for certain errors (e.g., invalid input)
                if (!error.shouldTriggerFallback()) {
                    throw error;
                }
            } else {
                lastError = new TranslationError(
                    'SERVICE_UNAVAILABLE',
                    String(error),
                    { serviceId }
                );
            }

            warnings.push({ code: lastError.code, serviceId });
        }
    }

    throw lastError
        ? withWarnings(lastError, warnings)
        : new TranslationError('ALL_SERVICES_FAILED', 'All services failed', { warnings });
}

/**
 * Direct translation with a specific service (no fallback).
 */
export async function translateDirect(
    serviceId: ServiceId,
    params: TranslateParams,
    apiKeys: StoredApiKeys
): Promise<TranslateResult> {
    params.signal?.throwIfAborted();
    const handler = serviceRegistry.get(serviceId);
    if (!handler) {
        throw new TranslationError(
            'SERVICE_UNAVAILABLE',
            `Service ${serviceId} not registered`
        );
    }

    const prerequisiteError = await getPrerequisiteError(handler, apiKeys);
    params.signal?.throwIfAborted();
    if (prerequisiteError) throw prerequisiteError;

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
