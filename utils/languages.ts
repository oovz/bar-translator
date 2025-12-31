/**
 * Language Code Constants and Utilities
 *
 * This module provides language code handling for the extension:
 * - Internal representation uses BCP 47 codes (e.g., 'zh-CN', 'pt-BR')
 * - User input accepts ISO 639-1 codes (e.g., 'zh', 'pt') for convenience
 * - Service-specific mapping functions handle API requirements
 *
 * @module utils/languages
 */

import type { LanguageInfo } from '@/src/types';

// ============================================================================
// BCP 47 Language Definitions
// ============================================================================

/**
 * Common languages supported by translation services.
 * Uses BCP 47 codes internally; user-facing display uses short codes.
 */
export const COMMON_LANGUAGES: readonly LanguageInfo[] = [
    { code: 'auto', name: 'Auto-detect', supportsAutoDetect: true },
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'es', name: 'Spanish', nativeName: 'Español' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский' },
    { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
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
    { code: 'nb', name: 'Norwegian', nativeName: 'Norsk' },
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
    COMMON_LANGUAGES.map((lang) => [lang.code.toLowerCase(), lang])
);

// ============================================================================
// ISO 639-1 to BCP 47 Mapping (User Input → Internal)
// ============================================================================

/**
 * Maps user-friendly ISO 639-1 codes to BCP 47 codes.
 * Users can type 'zh' in omnibox, internally we use 'zh-CN'.
 */
const ISO_TO_BCP47: Record<string, string> = {
    'zh': 'zh-CN',      // Chinese defaults to Simplified
    'pt': 'pt',         // Portuguese defaults to Portugal (pt-PT for services)
    'no': 'nb',         // Norwegian defaults to Bokmål
};

/**
 * Convert ISO 639-1 user input to internal BCP 47 code.
 * For codes not in the mapping, returns the input normalized to lowercase.
 *
 * @param code - User input language code (e.g., 'zh', 'en', 'pt-br')
 * @returns BCP 47 code for internal use (e.g., 'zh-CN', 'en', 'pt-BR')
 */
export function fromUserInput(code: string): string {
    const normalized = code.toLowerCase();
    return ISO_TO_BCP47[normalized] ?? normalized;
}

// ============================================================================
// Service-Specific Language Code Mappings
// ============================================================================

/**
 * Languages with regional variants that users might want to configure.
 */
export const OVERRIDABLE_LANGUAGES = {
    'zh': {
        name: 'Chinese',
        options: [
            { code: 'zh-CN', name: 'Simplified (zh-CN)' },
            { code: 'zh-TW', name: 'Traditional (zh-TW)' }
        ]
    },
    'pt': {
        name: 'Portuguese',
        options: [
            { code: 'pt-PT', name: 'Portugal (pt-PT)' },
            { code: 'pt-BR', name: 'Brazil (pt-BR)' }
        ]
    },
    'en': {
        name: 'English',
        options: [
            { code: 'en-US', name: 'US (en-US)' },
            { code: 'en-GB', name: 'UK (en-GB)' }
        ]
    }
} as const;

/**
 * Resolve language code using user preferences.
 * Handles overrides for ambiguous codes (e.g., 'zh' -> 'zh-TW').
 *
 * @param code - Input language code
 * @param overrides - User preference overrides
 * @returns Resolved BCP 47 code
 */
export function resolveLanguageCode(code: string, overrides: Record<string, string> = {}): string {
    const lower = code.toLowerCase();

    // Check for explicit override
    if (overrides[lower]) {
        return overrides[lower];
    }

    return fromUserInput(code);
}

/**
 * Google Translate language code mapping.
 * Google's API requires specific codes for certain languages.
 */
const GOOGLE_LANG_MAP: Record<string, string> = {
    'zh-cn': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh': 'zh-CN',          // Fallback for bare 'zh'
    'pt': 'pt-PT',
    'pt-br': 'pt-BR',
    'pt-pt': 'pt-PT',
    'nb': 'no',             // Google uses 'no' for Norwegian
    'no': 'no',
};

/**
 * Convert BCP 47 code to Google Translate format.
 *
 * @param code - Internal BCP 47 code
 * @returns Google Translate API code
 */
export function toGoogleLanguage(code: string): string {
    if (code === 'auto') return 'auto';
    const normalized = code.toLowerCase();
    return GOOGLE_LANG_MAP[normalized] ?? code;
}

/**
 * DeepL language code mapping.
 * DeepL uses uppercase codes with some special requirements.
 */
const DEEPL_LANG_MAP: Record<string, string> = {
    'en': 'EN',
    'en-us': 'EN-US',
    'en-gb': 'EN-GB',
    'pt': 'PT-PT',          // DeepL requires regional variant for Portuguese
    'pt-br': 'PT-BR',
    'pt-pt': 'PT-PT',
    'zh-cn': 'ZH-HANS',     // DeepL uses HANS/HANT for Chinese
    'zh-tw': 'ZH-HANT',
    'zh': 'ZH-HANS',        // Default to Simplified
    'nb': 'NB',             // Norwegian Bokmål
    'no': 'NB',
};

/**
 * Convert BCP 47 code to DeepL API format.
 *
 * @param code - Internal BCP 47 code
 * @returns DeepL API code (uppercase with regional variants)
 */
export function toDeepLLanguage(code: string): string {
    if (code === 'auto') return code; // DeepL auto-detects when source_lang is omitted
    const normalized = code.toLowerCase();
    return DEEPL_LANG_MAP[normalized] ?? code.toUpperCase();
}

/**
 * Convert DeepL API response code to internal BCP 47 format.
 *
 * @param code - DeepL response language code (e.g., 'EN', 'ZH-HANS')
 * @returns BCP 47 code
 */
export function fromDeepLLanguage(code: string): string {
    const upper = code.toUpperCase();
    // Map DeepL-specific codes back
    if (upper === 'ZH-HANS' || upper === 'ZH') return 'zh-CN';
    if (upper === 'ZH-HANT') return 'zh-TW';
    if (upper === 'PT-PT' || upper === 'PT') return 'pt';
    if (upper === 'PT-BR') return 'pt-BR';
    if (upper === 'NB') return 'nb';
    // Default: lowercase the base code
    return code.toLowerCase().split('-')[0];
}

/**
 * Lingva uses the same codes as Google Translate (it's a Google Translate proxy).
 * Alias for toGoogleLanguage.
 */
export const toLingvaLanguage = toGoogleLanguage;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a language code is valid.
 * Accepts both ISO 639-1 (2 chars) and BCP 47 (2-2 format).
 */
export function isValidLanguageCode(code: string): boolean {
    if (code.toLowerCase() === 'auto') return true;
    // Match: 'en', 'zh', 'en-US', 'zh-CN', 'pt-BR'
    return /^[a-z]{2}(-[a-z]{2,4})?$/i.test(code);
}

/**
 * Get language info by code.
 * Handles both short codes ('zh') and full BCP 47 ('zh-CN').
 */
export function getLanguageInfo(code: string): LanguageInfo | undefined {
    const normalized = code.toLowerCase();
    // Try exact match first
    if (LANGUAGE_MAP.has(normalized)) {
        return LANGUAGE_MAP.get(normalized);
    }
    // Try converting from user input
    const bcp47 = fromUserInput(normalized);
    return LANGUAGE_MAP.get(bcp47.toLowerCase());
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
 * Normalize language code to base form for comparison.
 * 'zh-CN' → 'zh', 'pt-BR' → 'pt'
 */
export function normalizeLanguageCode(code: string): string {
    return code.toLowerCase().split('-')[0];
}
