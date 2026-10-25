/**
 * Error Types and Handling
 *
 * Defines error codes, structured errors, and error classification utilities.
 *
 * @module utils/errors
 */

import type { TranslationErrorCode, ServiceId, InstanceId, TranslationWarning } from '@/src/types';
import { isRetryableError, shouldFallback } from '@/src/types';

/**
 * Custom error class for translation failures.
 */
export class TranslationError extends Error {
    readonly code: TranslationErrorCode;
    readonly serviceId?: ServiceId;
    readonly instanceId?: InstanceId;
    readonly instanceName?: string;
    readonly retryable: boolean;
    readonly httpStatus?: number;
    readonly warnings: readonly TranslationWarning[];

    constructor(
        code: TranslationErrorCode,
        message: string,
        options?: {
            serviceId?: ServiceId;
            instanceId?: InstanceId;
            instanceName?: string;
            httpStatus?: number;
            warnings?: readonly TranslationWarning[];
        }
    ) {
        super(message);
        this.name = 'TranslationError';
        this.code = code;
        this.serviceId = options?.serviceId;
        this.instanceId = options?.instanceId;
        this.instanceName = options?.instanceName;
        this.httpStatus = options?.httpStatus;
        this.warnings = options?.warnings ?? [];
        this.retryable = isRetryableError(code);
    }

    /**
     * Check if this error should trigger fallback to next service.
     */
    shouldTriggerFallback(): boolean {
        return shouldFallback(this.code);
    }

    /**
     * Create user-friendly error message.
     */
    getUserMessage(): string {
        switch (this.code) {
            case 'PERMISSION_REQUIRED':
                return 'Provider access required. Please check your settings.';
            case 'API_KEY_REQUIRED':
                return 'API key required. Please check your settings.';
            case 'NO_SERVICES_ENABLED':
                return 'No translation services enabled. Enable at least one service in settings.';
            case 'TIMEOUT':
                return 'Translation timed out. Please try again.';
            case 'NETWORK_ERROR':
                return 'Network error. Please check your connection.';
            case 'INVALID_API_KEY':
                return 'Invalid API key. Please check your settings.';
            case 'QUOTA_EXCEEDED':
                return 'Translation quota exceeded. Try a different service.';
            case 'RATE_LIMITED':
                return 'Too many requests. Please wait a moment.';
            case 'SERVICE_UNAVAILABLE':
                return 'Translation service is temporarily unavailable.';
            case 'INSTANCE_TEXT_TOO_LONG':
                return 'This translation instance cannot accept this much text.';
            case 'INSTANCE_LANGUAGE_UNSUPPORTED':
                return 'This translation instance does not support the requested language pair.';
            case 'INVALID_LANGUAGE':
                return 'Unsupported language code.';
            case 'TEXT_TOO_LONG':
                return 'Text is too long for translation.';
            case 'WEB_REQUEST_FAILED':
                return 'Translation failed. Try an API-based service.';
            case 'AUTH_METHOD_DEPRECATED':
                return 'Authentication method outdated. Please update the extension.';
            case 'ALL_SERVICES_FAILED':
                return 'All translation services failed.';
            default:
                return this.message || 'Translation failed.';
        }
    }
}

/**
 * Create TranslationError from HTTP response.
 */
export function createErrorFromResponse(
    status: number,
    serviceId: ServiceId
): TranslationError {
    switch (status) {
        case 401:
        case 403:
            return new TranslationError('INVALID_API_KEY', 'Authentication failed', {
                serviceId,
                httpStatus: status,
            });
        case 429:
            return new TranslationError('RATE_LIMITED', 'Rate limit exceeded', {
                serviceId,
                httpStatus: status,
            });
        case 456: // DeepL quota exceeded
            return new TranslationError('QUOTA_EXCEEDED', 'Quota exceeded', {
                serviceId,
                httpStatus: status,
            });
        case 500:
        case 502:
        case 503:
        case 504:
            return new TranslationError(
                'SERVICE_UNAVAILABLE',
                'Service unavailable',
                {
                    serviceId,
                    httpStatus: status,
                }
            );
        default:
            return new TranslationError(
                'SERVICE_UNAVAILABLE',
                `HTTP error ${status}`,
                {
                    serviceId,
                    httpStatus: status,
                }
            );
    }
}

/**
 * Create TranslationError from network failure.
 */
export function createNetworkError(
    error: Error,
    serviceId?: ServiceId
): TranslationError {
    return new TranslationError('NETWORK_ERROR', error.message, { serviceId });
}

/**
 * Re-export type utilities from contracts.
 */
export { isRetryableError, shouldFallback };
