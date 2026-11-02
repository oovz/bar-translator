/**
 * Error Types and Handling
 *
 * Defines error codes, structured errors, and error classification utilities.
 *
 * @module utils/errors
 */

import type { TranslationErrorCode, ServiceId, InstanceId, TranslationWarning } from '@/src/types';
import { isRetryableError, shouldFallback } from '@/src/types';

const USER_MESSAGES: Record<TranslationErrorCode, string> = {
    PERMISSION_REQUIRED: 'Provider access required. Please check your settings.',
    API_KEY_REQUIRED: 'API key required. Please check your settings.',
    NO_SERVICES_ENABLED: 'No translation services enabled. Enable at least one service in settings.',
    TIMEOUT: 'Translation timed out. Please try again.',
    NETWORK_ERROR: 'Network error. Please check your connection.',
    INVALID_API_KEY: 'Invalid API key. Please check your settings.',
    QUOTA_EXCEEDED: 'Translation quota exceeded. Try a different service.',
    RATE_LIMITED: 'Too many requests. Please wait a moment.',
    SERVICE_UNAVAILABLE: 'Translation service is temporarily unavailable.',
    INSTANCE_TEXT_TOO_LONG: 'This translation instance cannot accept this much text.',
    INSTANCE_LANGUAGE_UNSUPPORTED: 'This translation instance does not support the requested language pair.',
    INVALID_LANGUAGE: 'Unsupported language code.',
    TEXT_TOO_LONG: 'Text is too long for translation.',
    WEB_REQUEST_FAILED: 'Translation failed. Try an API-based service.',
    AUTH_METHOD_DEPRECATED: 'Authentication method outdated. Please update the extension.',
    ALL_SERVICES_FAILED: 'All translation services failed.',
};

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
        return USER_MESSAGES[this.code];
    }
}

/**
 * Re-export type utilities from contracts.
 */
export { isRetryableError, shouldFallback };
