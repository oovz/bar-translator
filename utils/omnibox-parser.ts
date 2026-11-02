/**
 * Omnibox Input Parser
 *
 * Parses user input from the Chrome omnibox to extract language codes and text.
 *
 * Format: [source>]target text
 * Examples:
 *   - "fr Hello world" → target=fr, source=auto, text="Hello world"
 *   - "en>fr Bonjour" → target=fr, source=en, text="Bonjour"
 *   - "Hello world" → uses defaults
 *
 * @module utils/omnibox-parser
 */

import type { ParsedOmniboxInput, UserPreferences } from '@/src/types';
import { isValidLanguageCode, resolveLanguageCode } from './languages';

/**
 * Parse omnibox input string.
 *
 * @param input - Raw user input from omnibox
 * @param defaults - Default preferences for fallback values
 * @returns Parsed input with language codes and text
 */
type ParserDefaults = Pick<UserPreferences, 'defaultTargetLang' | 'defaultSourceLang' | 'languageOverrides'>;

function languagePair(token: string, overrides?: Record<string, string>): Pick<ParsedOmniboxInput, 'sourceLang' | 'targetLang'> | undefined {
    const [source, target] = token.split('>');
    if (!source || !target || !isValidLanguageCode(source) || !isValidLanguageCode(target)) return;
    return {
        sourceLang: resolveLanguageCode(source, overrides),
        targetLang: resolveLanguageCode(target, overrides),
    };
}

function defaultText(text: string, defaults?: ParserDefaults): ParsedOmniboxInput {
    return {
        targetLang: defaults?.defaultTargetLang,
        sourceLang: defaults?.defaultSourceLang,
        text,
        isLanguageQuery: false,
    };
}

function languageQuery(token: string, defaults?: ParserDefaults): ParsedOmniboxInput {
    const pair = languagePair(token, defaults?.languageOverrides);
    if (pair) return { ...pair, text: '', isLanguageQuery: true };
    if (isValidLanguageCode(token)) {
        return {
            targetLang: resolveLanguageCode(token, defaults?.languageOverrides),
            text: '',
            isLanguageQuery: true,
        };
    }
    return defaultText(token, defaults);
}

export function parseOmniboxInput(input: string, defaults?: ParserDefaults): ParsedOmniboxInput {
    const trimmed = input.trim();
    if (!trimmed) return { text: '', isLanguageQuery: true };
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) return languageQuery(trimmed, defaults);

    const token = trimmed.substring(0, spaceIndex);
    const text = trimmed.substring(spaceIndex + 1).trim();
    const pair = languagePair(token, defaults?.languageOverrides);
    if (pair) return { ...pair, text, isLanguageQuery: text.length === 0 };
    if (isValidLanguageCode(token)) {
        return {
            targetLang: resolveLanguageCode(token, defaults?.languageOverrides),
            sourceLang: defaults?.defaultSourceLang,
            text,
            isLanguageQuery: text.length === 0,
        };
    }
    return defaultText(trimmed, defaults);
}

/**
 * Format translation result for omnibox suggestion description.
 * Uses XML-like tags supported by Chrome omnibox.
 *
 * @param translation - Translated text
 */
export function formatSuggestionDescription(translation: string): string {
    return `<match>${escapeXml(translation)}</match>`;
}

/**
 * Format error state for omnibox.
 */
export function formatErrorDescription(errorMessage: string): string {
    return `<dim>Error: ${escapeXml(errorMessage)}</dim>`;
}

/**
 * Escape special characters for XML (omnibox description).
 */
export function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Convert our escaped Chromium descriptions to Firefox's plain-text format. */
export function browserDescription(description: string): string {
    if (!import.meta.env.FIREFOX) return description;
    // Strip only formatting we emit, before decoding literal user/provider text.
    return description.replace(/<\/?(?:match|dim|url)>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
