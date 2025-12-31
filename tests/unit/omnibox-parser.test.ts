/**
 * Unit Tests for Omnibox Parser
 *
 * @module tests/unit/omnibox-parser.test
 */

import { describe, it, expect } from 'vitest';
import {
    parseOmniboxInput,
    formatSuggestionDescription,
    formatLoadingDescription,
    formatErrorDescription,
    normalizeTextForCache,
} from '@/utils/omnibox-parser';

// Mock browser global for i18n
(global as any).browser = {
    i18n: {
        getMessage: (key: string) => {
            const messages: Record<string, string> = {
                'lang_fr': 'French',
                // Add others if needed
            };
            return messages[key] || key;
        },
    },
};

describe('parseOmniboxInput', () => {
    describe('empty input', () => {
        it('handles empty string', () => {
            const result = parseOmniboxInput('');
            expect(result.text).toBe('');
            expect(result.isLanguageQuery).toBe(true);
        });

        it('handles whitespace only', () => {
            const result = parseOmniboxInput('   ');
            expect(result.text).toBe('');
            expect(result.isLanguageQuery).toBe(true);
        });
    });



    describe('single language code', () => {
        it('parses single language code as target', () => {
            const result = parseOmniboxInput('fr');
            expect(result.targetLang).toBe('fr');
            expect(result.text).toBe('');
            expect(result.isLanguageQuery).toBe(true);
        });

        it('normalizes language code to lowercase', () => {
            const result = parseOmniboxInput('FR');
            expect(result.targetLang).toBe('fr');
        });
    });

    describe('language code with text', () => {
        it('parses "fr Hello world"', () => {
            const result = parseOmniboxInput('fr Hello world');
            expect(result.targetLang).toBe('fr');
            expect(result.text).toBe('Hello world');
            expect(result.isLanguageQuery).toBe(false);
        });

        it('parses regional codes "en-US Hello"', () => {
            const result = parseOmniboxInput('en-US Hello');
            expect(result.targetLang).toBe('en-us');
            expect(result.text).toBe('Hello');
        });
    });

    describe('source>target format', () => {
        it('parses "en>fr Bonjour"', () => {
            const result = parseOmniboxInput('en>fr Bonjour');
            expect(result.sourceLang).toBe('en');
            expect(result.targetLang).toBe('fr');
            expect(result.text).toBe('Bonjour');
            expect(result.isLanguageQuery).toBe(false);
        });

        it('parses "en>fr" without text', () => {
            const result = parseOmniboxInput('en>fr');
            expect(result.sourceLang).toBe('en');
            expect(result.targetLang).toBe('fr');
            expect(result.text).toBe('');
            expect(result.isLanguageQuery).toBe(true);
        });
    });

    describe('no language code (uses defaults)', () => {
        it('uses defaults when no language code', () => {
            const defaults = {
                defaultTargetLang: 'en',
                defaultSourceLang: 'auto' as const,
                languageOverrides: {} // Fix lint error
            };
            const result = parseOmniboxInput('Hello world', defaults);
            expect(result.targetLang).toBe('en');
            expect(result.sourceLang).toBe('auto');
            expect(result.text).toBe('Hello world');
            expect(result.isLanguageQuery).toBe(false);
        });

        it('handles text that looks like invalid language code', () => {
            const result = parseOmniboxInput('xyz test');
            // "xyz" is not a valid 2-char code, should treat whole thing as text
            expect(result.text).toBe('xyz test');
            expect(result.isLanguageQuery).toBe(false);
        });
    });

    describe('edge cases', () => {
        it('handles text starting with number', () => {
            const result = parseOmniboxInput('123 test');
            expect(result.text).toBe('123 test');
        });

        it('handles single word', () => {
            const result = parseOmniboxInput('hello');
            expect(result.text).toBe('hello');
        });
    });

    describe('ISO 639-1 to BCP 47 conversion', () => {
        it('converts "zh" to BCP 47 "zh-CN"', () => {
            const result = parseOmniboxInput('zh Hello');
            expect(result.targetLang).toBe('zh-CN');
            expect(result.text).toBe('Hello');
        });

        it('converts "no" to BCP 47 "nb" for Norwegian', () => {
            const result = parseOmniboxInput('no Hei verden');
            expect(result.targetLang).toBe('nb');
            expect(result.text).toBe('Hei verden');
        });

        it('preserves already-BCP47 codes', () => {
            const result = parseOmniboxInput('zh-TW Hello');
            // Should normalize to lowercase but preserve the code
            expect(result.targetLang).toBe('zh-tw');
            expect(result.text).toBe('Hello');
        });

        it('converts source>target with ISO 639-1 codes', () => {
            const result = parseOmniboxInput('en>zh Test');
            expect(result.sourceLang).toBe('en');
            expect(result.targetLang).toBe('zh-CN');
            expect(result.text).toBe('Test');
        });

        it('handles case-insensitive ISO 639-1 input', () => {
            const result = parseOmniboxInput('ZH Test');
            expect(result.targetLang).toBe('zh-CN');
        });
    });
});

describe('formatSuggestionDescription', () => {
    it('formats basic translation', () => {
        const result = formatSuggestionDescription(
            'Bonjour le monde',
            'fr'
        );
        // Format: <dim>= </dim> <match>Translation</match> <dim> in </dim> <url>Language</url>
        expect(result).toContain('<match>Bonjour le monde</match>');
        expect(result).toContain('<url>French</url>');
        expect(result).toContain('<dim>= </dim>');
        expect(result).toContain('<dim> in </dim>');
    });

    it('escapes XML special characters', () => {
        const result = formatSuggestionDescription(
            '<test> & "quotes"',
            'fr'
        );
        expect(result).toContain('&lt;test&gt;');
        expect(result).toContain('&amp;');
        expect(result).toContain('&quot;');
    });
});

describe('formatLoadingDescription', () => {
    it('formats loading state', () => {
        const result = formatLoadingDescription('Hello world');
        expect(result).toContain('<dim>');
        expect(result).toContain('Translating:');
        expect(result).toContain('Hello world');
    });

    it('truncates long text', () => {
        const longText = 'A'.repeat(50);
        const result = formatLoadingDescription(longText);
        expect(result).toContain('...');
    });
});

describe('formatErrorDescription', () => {
    it('formats error message', () => {
        const result = formatErrorDescription('Network error');
        expect(result).toBe('<dim>Error: Network error</dim>');
    });
});

describe('normalizeTextForCache', () => {
    it('lowercases text', () => {
        expect(normalizeTextForCache('Hello World')).toBe('hello world');
    });

    it('trims whitespace', () => {
        expect(normalizeTextForCache('  hello  ')).toBe('hello');
    });
});
