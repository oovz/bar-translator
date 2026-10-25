/** Provider adapters and bounded fallback across explicitly enabled instances. */
import type {
    TranslationServiceHandler, TranslateParams, TranslateResult, TranslateResultWithMeta,
    ServiceId, TranslationInstance, TranslationSetup, TranslationWarning, ValidationResult,
} from '@/src/types';
import { TranslationError } from '@/utils/errors';
import { getInstanceName } from '@/utils/instances';
import { hasInstanceAccess } from '@/utils/permissions';
import { getSetup } from '@/utils/storage';
import { getServiceDefinition, getAllServiceDefinitions } from './base';
import type { TranslationService } from './base';
import { GoogleTranslationWebService } from './google-web';
import { DeepLTranslationService } from './deepl';
import { LingvaTranslationService } from './lingva';
import { LibreTranslateService, testLibreTranslate } from './libretranslate';

const serviceRegistry = new Map<ServiceId, TranslationServiceHandler>();
registerService(new GoogleTranslationWebService(getServiceDefinition('google-web')));
registerService(new LingvaTranslationService(getServiceDefinition('lingva')));
registerService(new DeepLTranslationService(getServiceDefinition('deepl')));
registerService(new LibreTranslateService(getServiceDefinition('libretranslate')));

export function registerService(handler: TranslationServiceHandler): void {
    serviceRegistry.set(handler.service.id, handler);
}
export function getService(id: ServiceId): TranslationServiceHandler | undefined {
    return serviceRegistry.get(id);
}
export function getRegisteredServices(): TranslationServiceHandler[] {
    return Array.from(serviceRegistry.values());
}
export function isServiceRegistered(id: ServiceId): boolean {
    return serviceRegistry.has(id);
}
export { getServiceDefinition, getAllServiceDefinitions };

function attribution(instance: TranslationInstance) {
    return { serviceId: instance.providerId, instanceId: instance.id, instanceName: getInstanceName(instance) };
}

async function prerequisiteError(instance: TranslationInstance): Promise<TranslationError | undefined> {
    const details = attribution(instance);
    if (!await hasInstanceAccess(instance)) {
        return new TranslationError('PERMISSION_REQUIRED', 'Translation access required. Check settings.', details);
    }
    if ((instance.providerId === 'deepl' ||
        (instance.providerId === 'libretranslate' && instance.hosting === 'managed')) && !instance.credential?.key) {
        return new TranslationError('API_KEY_REQUIRED', 'API key required. Check settings.', details);
    }
}

export async function isInstanceAvailable(instance: TranslationInstance): Promise<boolean> {
    return serviceRegistry.has(instance.providerId) && await prerequisiteError(instance) === undefined;
}

function attributedError(error: unknown, instance: TranslationInstance, warnings?: readonly TranslationWarning[]) {
    return error instanceof TranslationError
        ? new TranslationError(error.code, error.message, {
            ...attribution(instance), httpStatus: error.httpStatus, warnings: warnings ?? error.warnings,
        })
        : new TranslationError('SERVICE_UNAVAILABLE', 'Translation instance unavailable.', { ...attribution(instance), warnings });
}

function instanceParams(instance: TranslationInstance, params: TranslateParams): TranslateParams {
    // Never allow a previous attempt's key or endpoint to carry to the next recipient.
    return {
        ...params,
        apiKey: 'credential' in instance ? instance.credential?.key : undefined,
        tier: instance.providerId === 'deepl' ? instance.credential?.tier : undefined,
        endpoint: instance.providerId === 'libretranslate' ? instance.endpoint : undefined,
    };
}

const ATTEMPT_TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 10000;

async function translateAttempt(handler: TranslationServiceHandler, params: TranslateParams, deadline: number): Promise<TranslateResult> {
    params.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = params.signal ? AbortSignal.any([params.signal, controller.signal]) : controller.signal;
    let rejectAborted!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
    const onAbort = () => rejectAborted(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = () => controller.abort(new TranslationError('TIMEOUT', 'Translation timed out. Please try again.'));
    const timer = setTimeout(timeout, deadline - performance.now());
    try {
        // Settle even when a provider ignores the signal; fetch/body reads receive it too.
        const result = await Promise.race([handler.translate({ ...params, signal }), aborted]);
        if (performance.now() >= deadline) timeout();
        signal.throwIfAborted();
        return result;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}

async function translateConfiguredInstance(instance: TranslationInstance, params: TranslateParams, deadline: number) {
    const handler = serviceRegistry.get(instance.providerId);
    if (!handler) throw new TranslationError('SERVICE_UNAVAILABLE', 'Provider is unavailable.', attribution(instance));
    return translateAttempt({
        service: handler.service,
        translate: async attempt => {
            const missing = await prerequisiteError(instance);
            attempt.signal?.throwIfAborted();
            if (missing) throw missing;
            return handler.translate(instanceParams(instance, attempt));
        },
    }, params, deadline);
}

/** Each enabled instance gets one attempt; same-provider instances remain distinct. */
export async function translateWithFallback(params: TranslateParams, setup: TranslationSetup): Promise<TranslateResultWithMeta> {
    params.signal?.throwIfAborted();
    const deadline = performance.now() + TOTAL_TIMEOUT_MS;
    const enabledIds = [...new Set(setup.preferences.fallbackOrder)];
    if (!enabledIds.length) {
        throw new TranslationError('NO_SERVICES_ENABLED', 'No translation instances enabled. Check settings.');
    }
    const warnings: TranslationWarning[] = [];
    let lastError: TranslationError | undefined;
    for (const [index, instanceId] of enabledIds.entries()) {
        params.signal?.throwIfAborted();
        if (performance.now() >= deadline) throw new TranslationError('TIMEOUT', 'Translation timed out.', { warnings });
        const instance = setup.instances.find(candidate => candidate.id === instanceId);
        if (!instance) {
            lastError = new TranslationError('SERVICE_UNAVAILABLE', 'Translation instance is unavailable.', { instanceId });
            warnings.push({ code: lastError.code, instanceId });
            continue;
        }
        try {
            const result = await translateConfiguredInstance(instance, params,
                Math.min(deadline, performance.now() + ATTEMPT_TIMEOUT_MS));
            params.signal?.throwIfAborted();
            return { ...result, ...attribution(instance), usedFallback: index > 0, cached: false, warnings };
        } catch (error) {
            params.signal?.throwIfAborted();
            lastError = attributedError(error, instance);
            if (!lastError.shouldTriggerFallback()) throw lastError;
            warnings.push({ code: lastError.code, ...attribution(instance) });
        }
    }
    if (lastError) throw new TranslationError(lastError.code, lastError.message, {
        serviceId: lastError.serviceId, instanceId: lastError.instanceId,
        instanceName: lastError.instanceName, httpStatus: lastError.httpStatus, warnings,
    });
    throw new TranslationError('ALL_SERVICES_FAILED', 'All translation instances failed.', { warnings });
}

/** Explicit instance operation used by callers that intentionally omit fallback. */
export async function translateDirect(instance: TranslationInstance, params: TranslateParams): Promise<TranslateResult> {
    params.signal?.throwIfAborted();
    return translateConfiguredInstance(instance, params, performance.now() + ATTEMPT_TIMEOUT_MS);
}

/** Optional user-triggered test; completion never gates later translations. */
export async function testInstance(instance: TranslationInstance): Promise<ValidationResult> {
    const setup = await getSetup();
    const saved = setup.instances.find(candidate => candidate.id === instance.id);
    const identity = (candidate: TranslationInstance) => JSON.stringify([
        candidate.providerId,
        candidate.providerId === 'libretranslate' ? [candidate.endpoint, candidate.hosting] : null,
        'credential' in candidate ? [candidate.credential?.key, candidate.credential?.tier] : null,
    ]);
    if (!saved || !setup.preferences.fallbackOrder.includes(saved.id) || identity(saved) !== identity(instance)) {
        return { valid: false, error: 'Enable and save the current instance before testing.' };
    }
    const missing = await prerequisiteError(instance);
    if (missing) return { valid: false, error: missing.getUserMessage() };
    const signal = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
    if (instance.providerId === 'deepl') {
        return new DeepLTranslationService(getServiceDefinition('deepl')).validateApiKey(
            instance.credential!.key, instance.credential?.tier, signal,
        );
    }
    if (instance.providerId === 'libretranslate') {
        return testLibreTranslate(instance.endpoint, instance.credential?.key, signal);
    }
    return { valid: true };
}

export type { TranslationService, TranslationServiceHandler };
