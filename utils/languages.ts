import type { LanguageInfo } from '@/src/types';

export const COMMON_LANGUAGES: readonly LanguageInfo[] = [
    { code: 'auto', name: 'Auto-detect' },
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

const ISO_TO_BCP47: Record<string, string> = {
    'zh': 'zh-CN',
    'pt': 'pt',
    'no': 'nb',
};

/** Expand short aliases; other codes retain their region in lowercase. */
export function fromUserInput(code: string): string {
    const normalized = code.toLowerCase();
    return ISO_TO_BCP47[normalized] ?? normalized;
}

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

export function resolveLanguageCode(code: string, overrides: Record<string, string> = {}): string {
    const lower = code.toLowerCase();

    if (overrides[lower]) {
        return overrides[lower];
    }

    return fromUserInput(code);
}

const GOOGLE_LANG_MAP: Record<string, string> = {
    'zh-cn': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh': 'zh-CN',
    'pt': 'pt-PT',
    'pt-br': 'pt-BR',
    'pt-pt': 'pt-PT',
    'nb': 'no',
    'no': 'no',
};

export function toGoogleLanguage(code: string): string {
    if (code === 'auto') return 'auto';
    const normalized = code.toLowerCase();
    return GOOGLE_LANG_MAP[normalized] ?? code;
}

const DEEPL_LANG_MAP: Record<string, string> = {
    'en': 'EN',
    'en-us': 'EN-US',
    'en-gb': 'EN-GB',
    'pt': 'PT-PT',
    'pt-br': 'PT-BR',
    'pt-pt': 'PT-PT',
    'zh-cn': 'ZH-HANS',
    'zh-tw': 'ZH-HANT',
    'zh': 'ZH-HANS',
    'nb': 'NB',
    'no': 'NB',
};

/** Convert a target language, retaining its regional variant. */
export function toDeepLLanguage(code: string): string {
    if (code === 'auto') return code; // DeepL auto-detects when source_lang is omitted
    const normalized = code.toLowerCase();
    return DEEPL_LANG_MAP[normalized] ?? code.toUpperCase();
}

/** DeepL accepts regional variants as targets; source languages use the base code. */
export function toDeepLSourceLanguage(code: string): string {
    const language = normalizeLanguageCode(code);
    return language === 'no' ? 'NB' : language.toUpperCase();
}

export function fromDeepLLanguage(code: string): string {
    const upper = code.toUpperCase();
    if (upper === 'ZH-HANS' || upper === 'ZH') return 'zh-CN';
    if (upper === 'ZH-HANT') return 'zh-TW';
    if (upper === 'PT-PT' || upper === 'PT') return 'pt';
    if (upper === 'PT-BR') return 'pt-BR';
    if (upper === 'NB') return 'nb';
    return normalizeLanguageCode(code);
}

export const toLingvaLanguage = toGoogleLanguage;

/** Accept auto-detection or a two-letter code with an optional region or script. */
export function isValidLanguageCode(code: string): boolean {
    if (code.toLowerCase() === 'auto') return true;
    return /^[a-z]{2}(-[a-z]{2,4})?$/i.test(code);
}

export function getTargetLanguages(): LanguageInfo[] {
    return COMMON_LANGUAGES.filter((lang) => lang.code !== 'auto');
}

export function getSourceLanguages(): LanguageInfo[] {
    return [...COMMON_LANGUAGES];
}

export function normalizeLanguageCode(code: string): string {
    const separator = code.indexOf('-');
    return (separator === -1 ? code : code.slice(0, separator)).toLowerCase();
}
