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
export function parseOmniboxInput(
    input: string,
    defaults?: Pick<UserPreferences, 'defaultTargetLang' | 'defaultSourceLang' | 'languageOverrides'>
): ParsedOmniboxInput {
    const trimmed = input.trim();
    const overrides = defaults?.languageOverrides;

    if (!trimmed) {
        return {
            text: '',
            isLanguageQuery: true,
        };
    }

    // Split by first space
    const spaceIndex = trimmed.indexOf(' ');

    // No space - could be just a language code, source>target format, or text
    if (spaceIndex === -1) {
        // Check for source>target format (e.g., "en>fr")
        if (trimmed.includes('>')) {
            const [source, target] = trimmed.split('>');
            if (isValidLanguageCode(source) && isValidLanguageCode(target)) {
                return {
                    sourceLang: resolveLanguageCode(source, overrides),
                    targetLang: resolveLanguageCode(target, overrides),
                    text: '',
                    isLanguageQuery: true,
                };
            }
        }

        // Check if it looks like a single language code
        if (isValidLanguageCode(trimmed)) {
            return {
                targetLang: resolveLanguageCode(trimmed, overrides),
                text: '',
                isLanguageQuery: true,
            };
        }
        // Treat as text to translate
        return {
            targetLang: defaults?.defaultTargetLang,
            sourceLang: defaults?.defaultSourceLang,
            text: trimmed,
            isLanguageQuery: false,
        };
    }

    const firstPart = trimmed.substring(0, spaceIndex);
    const rest = trimmed.substring(spaceIndex + 1).trim();

    // Check for source>target format (e.g., "en>fr")
    if (firstPart.includes('>')) {
        const [source, target] = firstPart.split('>');
        if (isValidLanguageCode(source) && isValidLanguageCode(target)) {
            return {
                sourceLang: resolveLanguageCode(source, overrides),
                targetLang: resolveLanguageCode(target, overrides),
                text: rest,
                isLanguageQuery: rest.length === 0,
            };
        }
    }

    // Check if first part is a language code
    if (isValidLanguageCode(firstPart)) {
        return {
            targetLang: resolveLanguageCode(firstPart, overrides),
            sourceLang: defaults?.defaultSourceLang,
            text: rest,
            isLanguageQuery: rest.length === 0,
        };
    }

    // No language code found, use whole input as text
    return {
        targetLang: defaults?.defaultTargetLang,
        sourceLang: defaults?.defaultSourceLang,
        text: trimmed,
        isLanguageQuery: false,
    };
}

/**
 * Format translation result for omnibox suggestion description.
 * Uses XML-like tags supported by Chrome omnibox.
 *
 * @param translation - Translated text
 * @param sourceText - Original text
 * @param usedFallback - Whether fallback was used
 * @param serviceName - Name of service that translated
 */
export function formatSuggestionDescription(
    translation: string,
    sourceText: string,
    usedFallback: boolean,
    serviceName?: string
): string {
    // XML tags: <match>, <dim>, <url>
    const truncatedSource =
        sourceText.length > 30 ? sourceText.substring(0, 30) + '...' : sourceText;

    let description = `<match>${escapeXml(translation)}</match>`;

    if (usedFallback && serviceName) {
        description += ` <dim>(via ${escapeXml(serviceName)})</dim>`;
    }

    description += ` <dim>← ${escapeXml(truncatedSource)}</dim>`;

    return description;
}

/**
 * Format loading state for omnibox.
 */
export function formatLoadingDescription(text: string): string {
    const truncated = text.length > 40 ? text.substring(0, 40) + '...' : text;
    return `<dim>Translating: ${escapeXml(truncated)}...</dim>`;
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
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Normalize text for cache key generation.
 */
export function normalizeTextForCache(text: string): string {
    return text.toLowerCase().trim();
}
