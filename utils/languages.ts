/**
 * Language Code Constants and Utilities
 *
 * Provides language code validation, display names, and common language lists.
 *
 * @module utils/languages
 */

import type { LanguageInfo } from '@/src/types';

/**
 * Common languages supported by most translation services.
 * ISO 639-1 codes with display names.
 */
export const COMMON_LANGUAGES: readonly LanguageInfo[] = [
    { code: 'auto', name: 'Auto-detect', supportsAutoDetect: true },
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'es', name: 'Spanish', nativeName: 'Español' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский' },
    { code: 'zh', name: 'Chinese', nativeName: '中文' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'ko', name: 'Korean', nativeName: '한국어' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
    { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
    { code: 'pl', name: 'Polish', nativeName: 'Polski' },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
    { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
    { code: 'th', name: 'Thai', nativeName: 'ไทย' },
    { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
    { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
    { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
    { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
    { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
    { code: 'da', name: 'Danish', nativeName: 'Dansk' },
    { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
    { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
    { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
    { code: 'ro', name: 'Romanian', nativeName: 'Română' },
    { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
    { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
    { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
] as const;

/**
 * Map of language codes to language info.
 */
const LANGUAGE_MAP = new Map<string, LanguageInfo>(
    COMMON_LANGUAGES.map((lang) => [lang.code, lang])
);

/**
 * Check if a language code is valid.
 */
export function isValidLanguageCode(code: string): boolean {
    if (code.toLowerCase() === 'auto') return true;
    // ISO 639-1 is 2 characters, but some services use extended codes
    // Case-insensitive match for codes like "fr", "FR", "en-US", "EN-us"
    return /^[a-z]{2}(-[a-z]{2})?$/i.test(code);
}

/**
 * Get language info by code.
 */
export function getLanguageInfo(code: string): LanguageInfo | undefined {
    return LANGUAGE_MAP.get(code.toLowerCase());
}

/**
 * Get display name for a language code.
 */
export function getLanguageName(code: string): string {
    const info = getLanguageInfo(code);
    return info?.name ?? code.toUpperCase();
}

/**
 * Get native name for a language code.
 */
export function getLanguageNativeName(code: string): string {
    const info = getLanguageInfo(code);
    return info?.nativeName ?? info?.name ?? code.toUpperCase();
}

/**
 * Get languages suitable for target selection (excludes auto-detect).
 */
export function getTargetLanguages(): LanguageInfo[] {
    return COMMON_LANGUAGES.filter((lang) => lang.code !== 'auto');
}

/**
 * Get languages suitable for source selection (includes auto-detect).
 */
export function getSourceLanguages(): LanguageInfo[] {
    return [...COMMON_LANGUAGES];
}

/**
 * Normalize language code for comparison.
 */
export function normalizeLanguageCode(code: string): string {
    return code.toLowerCase().split('-')[0];
}

/**
 * Convert language code to DeepL format (uppercase).
 */
export function toDeepLLanguage(code: string): string {
    // DeepL uses uppercase codes and some special cases
    const normalized = code.toUpperCase();
    // Handle special cases like EN-US, EN-GB
    if (normalized === 'EN') return 'EN';
    if (normalized === 'PT') return 'PT-PT'; // DeepL requires regional variant
    return normalized;
}

/**
 * Parse language code from DeepL response (lowercase).
 */
export function fromDeepLLanguage(code: string): string {
    return code.toLowerCase().split('-')[0];
}
