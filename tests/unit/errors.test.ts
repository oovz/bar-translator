import { describe, expect, it } from 'vitest';
import { TranslationError } from '@/utils/errors';

describe('translation error guidance', () => {
    it.each([
        ['PERMISSION_REQUIRED', 'Provider access required. Please check your settings.'],
        ['API_KEY_REQUIRED', 'API key required. Please check your settings.'],
        ['NO_SERVICES_ENABLED', 'No translation services enabled. Enable at least one service in settings.'],
        ['TIMEOUT', 'Translation timed out. Please try again.'],
        ['NETWORK_ERROR', 'Network error. Please check your connection.'],
        ['INVALID_API_KEY', 'Invalid API key. Please check your settings.'],
        ['QUOTA_EXCEEDED', 'Translation quota exceeded. Try a different service.'],
        ['RATE_LIMITED', 'Too many requests. Please wait a moment.'],
        ['SERVICE_UNAVAILABLE', 'Translation service is temporarily unavailable.'],
        ['INSTANCE_TEXT_TOO_LONG', 'This translation instance cannot accept this much text.'],
        ['INSTANCE_LANGUAGE_UNSUPPORTED', 'This translation instance does not support the requested language pair.'],
        ['INVALID_LANGUAGE', 'Unsupported language code.'],
        ['TEXT_TOO_LONG', 'Text is too long for translation.'],
        ['WEB_REQUEST_FAILED', 'Translation failed. Try an API-based service.'],
        ['AUTH_METHOD_DEPRECATED', 'Authentication method outdated. Please update the extension.'],
        ['ALL_SERVICES_FAILED', 'All translation services failed.'],
    ] as const)('shows actionable guidance for %s instead of provider details', (code, expected) => {
        expect(new TranslationError(code, 'Private provider response').getUserMessage()).toBe(expected);
    });
});
