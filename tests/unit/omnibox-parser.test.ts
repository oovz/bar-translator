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
});

describe('formatSuggestionDescription', () => {
    it('formats basic translation', () => {
        const result = formatSuggestionDescription(
            'Bonjour le monde',
            'Hello world',
            false
        );
        expect(result).toContain('<match>Bonjour le monde</match>');
        expect(result).toContain('<dim>← Hello world</dim>');
    });

    it('includes fallback indicator', () => {
        const result = formatSuggestionDescription(
            'Bonjour',
            'Hello',
            true,
            'DeepL'
        );
        expect(result).toContain('(via DeepL)');
    });

    it('truncates long source text', () => {
        const longText = 'This is a very long text that exceeds thirty characters';
        const result = formatSuggestionDescription('Translation', longText, false);
        expect(result).toContain('...');
    });

    it('escapes XML special characters', () => {
        const result = formatSuggestionDescription(
            '<test> & "quotes"',
            'source',
            false
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
