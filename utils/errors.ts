import type { TranslationErrorCode, ServiceId, InstanceId, TranslationWarning } from '@/src/types';

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
    ALL_SERVICES_FAILED: 'All translation services failed.',
};

export class TranslationError extends Error {
    readonly code: TranslationErrorCode;
    readonly serviceId?: ServiceId;
    readonly instanceId?: InstanceId;
    readonly instanceName?: string;
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
    }

    shouldTriggerFallback(): boolean {
        return this.code !== 'INVALID_LANGUAGE' && this.code !== 'TEXT_TOO_LONG';
    }

    getUserMessage(): string {
        return USER_MESSAGES[this.code];
    }
}
