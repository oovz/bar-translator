import { describe, it, expect } from 'vitest';
import {
    parseOmniboxInput,
    formatSuggestionDescription,
} from '@/utils/omnibox-parser';

describe('parseOmniboxInput', () => {
    it('keeps source implicit for a target-only query but uses the default when text follows', () => {
        const defaults = { defaultSourceLang: 'de', defaultTargetLang: 'en', languageOverrides: {} };
        expect(parseOmniboxInput('fr', defaults)).toEqual({ targetLang: 'fr', text: '', isLanguageQuery: true });
        expect(parseOmniboxInput('fr Hello', defaults)).toEqual({
            sourceLang: 'de', targetLang: 'fr', text: 'Hello', isLanguageQuery: false,
        });
    });

    it('reads the first language pair when an input contains extra separators', () => {
        expect(parseOmniboxInput('en>fr>de Hello')).toEqual({
            sourceLang: 'en', targetLang: 'fr', text: 'Hello', isLanguageQuery: false,
        });
    });

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
                languageOverrides: {}
            };
            const result = parseOmniboxInput('Hello world', defaults);
            expect(result.targetLang).toBe('en');
            expect(result.sourceLang).toBe('auto');
            expect(result.text).toBe('Hello world');
            expect(result.isLanguageQuery).toBe(false);
        });

        it('handles text that looks like invalid language code', () => {
            const result = parseOmniboxInput('xyz test');
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
    it('escapes XML special characters', () => {
        const result = formatSuggestionDescription(
            '<test> & "quotes"'
        );
        expect(result).toContain('&lt;test&gt;');
        expect(result).toContain('&amp;');
        expect(result).toContain('&quot;');
    });
});

describe('single-character translation text', () => {
    it.each(['en>fr X', 'fr X'])('treats %s as text to translate, not a language query', input => {
        const parsed = parseOmniboxInput(input);
        expect(parsed.text).toBe('X');
        expect(parsed.targetLang).toBe('fr');
        expect(parsed.isLanguageQuery).toBe(false);
    });
});

describe('invalid language pairs remain ordinary text', () => {
    it.each(['invalid>fr Hello', 'en>invalid Hello'])('does not consume a partially valid pair in %s', input => {
        const defaults = { defaultSourceLang: 'auto', defaultTargetLang: 'de', languageOverrides: {} };
        expect(parseOmniboxInput(input, defaults)).toEqual({
            text: input, sourceLang: 'auto', targetLang: 'de', isLanguageQuery: false,
        });
    });
});
