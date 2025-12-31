/**
 * Unit Tests for Language Code Utilities
 *
 * Tests for BCP 47 handling, ISO 639-1 user input conversion,
 * and service-specific language code mappings.
 *
 * @module tests/unit/languages.test
 */

import { describe, it, expect } from 'vitest';
import {
    isValidLanguageCode,
    fromUserInput,
    toGoogleLanguage,
    toDeepLLanguage,
    fromDeepLLanguage,
    toLingvaLanguage,
    getLanguageInfo,
    getLanguageName,
    normalizeLanguageCode,
    resolveLanguageCode,
    COMMON_LANGUAGES,
} from '@/utils/languages';

describe('Language Utilities', () => {
    describe('isValidLanguageCode', () => {
        it('accepts valid 2-letter ISO 639-1 codes', () => {
            expect(isValidLanguageCode('en')).toBe(true);
            expect(isValidLanguageCode('fr')).toBe(true);
            expect(isValidLanguageCode('zh')).toBe(true);
            expect(isValidLanguageCode('ja')).toBe(true);
        });

        it('accepts valid BCP 47 codes with region', () => {
            expect(isValidLanguageCode('en-US')).toBe(true);
            expect(isValidLanguageCode('zh-CN')).toBe(true);
            expect(isValidLanguageCode('zh-TW')).toBe(true);
            expect(isValidLanguageCode('pt-BR')).toBe(true);
        });

        it('accepts "auto" for auto-detection', () => {
            expect(isValidLanguageCode('auto')).toBe(true);
            expect(isValidLanguageCode('AUTO')).toBe(true);
        });

        it('is case-insensitive', () => {
            expect(isValidLanguageCode('EN')).toBe(true);
            expect(isValidLanguageCode('en-us')).toBe(true);
            expect(isValidLanguageCode('ZH-cn')).toBe(true);
        });

        it('rejects invalid codes', () => {
            expect(isValidLanguageCode('e')).toBe(false);      // Too short
            expect(isValidLanguageCode('eng')).toBe(false);    // ISO 639-2 (too long)
            expect(isValidLanguageCode('123')).toBe(false);    // Numbers
            expect(isValidLanguageCode('')).toBe(false);       // Empty
        });

        it('accepts extended BCP 47 codes with script', () => {
            // e.g., zh-Hans, zh-Hant
            expect(isValidLanguageCode('zh-Hans')).toBe(true);
            expect(isValidLanguageCode('zh-Hant')).toBe(true);
        });
    });

    describe('fromUserInput', () => {
        it('converts ISO 639-1 "zh" to BCP 47 "zh-CN"', () => {
            expect(fromUserInput('zh')).toBe('zh-CN');
            expect(fromUserInput('ZH')).toBe('zh-CN');
        });

        it('converts "no" to "nb" for Norwegian', () => {
            expect(fromUserInput('no')).toBe('nb');
            expect(fromUserInput('NO')).toBe('nb');
        });

        it('passes through codes that do not need mapping', () => {
            expect(fromUserInput('en')).toBe('en');
            expect(fromUserInput('fr')).toBe('fr');
            expect(fromUserInput('de')).toBe('de');
        });

        it('preserves already-BCP47 codes', () => {
            expect(fromUserInput('zh-CN')).toBe('zh-cn');
            expect(fromUserInput('pt-BR')).toBe('pt-br');
        });

        it('normalizes case to lowercase', () => {
            expect(fromUserInput('EN')).toBe('en');
            expect(fromUserInput('FR')).toBe('fr');
        });
    });

    describe('toGoogleLanguage', () => {
        it('maps Chinese codes correctly', () => {
            expect(toGoogleLanguage('zh-CN')).toBe('zh-CN');
            expect(toGoogleLanguage('zh-TW')).toBe('zh-TW');
            expect(toGoogleLanguage('zh')).toBe('zh-CN');  // Fallback
        });

        it('maps Portuguese codes correctly', () => {
            expect(toGoogleLanguage('pt')).toBe('pt-PT');
            expect(toGoogleLanguage('pt-BR')).toBe('pt-BR');
            expect(toGoogleLanguage('pt-PT')).toBe('pt-PT');
        });

        it('maps Norwegian to "no"', () => {
            expect(toGoogleLanguage('nb')).toBe('no');
            expect(toGoogleLanguage('no')).toBe('no');
        });

        it('handles auto-detect', () => {
            expect(toGoogleLanguage('auto')).toBe('auto');
        });

        it('passes through standard codes', () => {
            expect(toGoogleLanguage('en')).toBe('en');
            expect(toGoogleLanguage('fr')).toBe('fr');
            expect(toGoogleLanguage('de')).toBe('de');
        });
    });

    describe('toDeepLLanguage', () => {
        it('maps Chinese to DeepL format (ZH-HANS/ZH-HANT)', () => {
            expect(toDeepLLanguage('zh-CN')).toBe('ZH-HANS');
            expect(toDeepLLanguage('zh-TW')).toBe('ZH-HANT');
            expect(toDeepLLanguage('zh')).toBe('ZH-HANS');  // Default to Simplified
        });

        it('maps Portuguese with regional variants', () => {
            expect(toDeepLLanguage('pt')).toBe('PT-PT');
            expect(toDeepLLanguage('pt-BR')).toBe('PT-BR');
            expect(toDeepLLanguage('pt-PT')).toBe('PT-PT');
        });

        it('maps English variants', () => {
            expect(toDeepLLanguage('en')).toBe('EN');
            expect(toDeepLLanguage('en-US')).toBe('EN-US');
            expect(toDeepLLanguage('en-GB')).toBe('EN-GB');
        });

        it('maps Norwegian Bokmål', () => {
            expect(toDeepLLanguage('nb')).toBe('NB');
            expect(toDeepLLanguage('no')).toBe('NB');
        });

        it('uppercases standard codes', () => {
            expect(toDeepLLanguage('fr')).toBe('FR');
            expect(toDeepLLanguage('de')).toBe('DE');
            expect(toDeepLLanguage('ja')).toBe('JA');
        });

        it('handles auto-detect passthrough', () => {
            expect(toDeepLLanguage('auto')).toBe('auto');
        });
    });

    describe('fromDeepLLanguage', () => {
        it('converts DeepL Chinese codes to BCP 47', () => {
            expect(fromDeepLLanguage('ZH-HANS')).toBe('zh-CN');
            expect(fromDeepLLanguage('ZH-HANT')).toBe('zh-TW');
            expect(fromDeepLLanguage('ZH')).toBe('zh-CN');
        });

        it('converts DeepL Portuguese codes to BCP 47', () => {
            expect(fromDeepLLanguage('PT-PT')).toBe('pt');
            expect(fromDeepLLanguage('PT-BR')).toBe('pt-BR');
            expect(fromDeepLLanguage('PT')).toBe('pt');
        });

        it('converts DeepL Norwegian to BCP 47', () => {
            expect(fromDeepLLanguage('NB')).toBe('nb');
        });

        it('normalizes standard codes to lowercase base', () => {
            expect(fromDeepLLanguage('EN')).toBe('en');
            expect(fromDeepLLanguage('FR')).toBe('fr');
            expect(fromDeepLLanguage('DE')).toBe('de');
        });
    });

    describe('toLingvaLanguage', () => {
        it('uses same mapping as Google Translate', () => {
            // Lingva is a Google Translate proxy
            expect(toLingvaLanguage('zh-CN')).toBe(toGoogleLanguage('zh-CN'));
            expect(toLingvaLanguage('pt-BR')).toBe(toGoogleLanguage('pt-BR'));
            expect(toLingvaLanguage('auto')).toBe(toGoogleLanguage('auto'));
        });
    });

    describe('getLanguageInfo', () => {
        it('finds info by BCP 47 code', () => {
            const zhCN = getLanguageInfo('zh-CN');
            expect(zhCN).toBeDefined();
            expect(zhCN?.name).toBe('Chinese (Simplified)');
        });

        it('finds info by ISO 639-1 shortcut (via fromUserInput)', () => {
            const zh = getLanguageInfo('zh');
            expect(zh).toBeDefined();
            expect(zh?.name).toBe('Chinese (Simplified)');
        });

        it('is case-insensitive', () => {
            expect(getLanguageInfo('EN')).toEqual(getLanguageInfo('en'));
            expect(getLanguageInfo('ZH-CN')).toEqual(getLanguageInfo('zh-cn'));
        });

        it('returns undefined for unknown codes', () => {
            expect(getLanguageInfo('xyz')).toBeUndefined();
        });
    });

    describe('getLanguageName', () => {
        it('returns human-readable name for known codes', () => {
            expect(getLanguageName('en')).toBe('English');
            expect(getLanguageName('zh-CN')).toBe('Chinese (Simplified)');
            expect(getLanguageName('zh')).toBe('Chinese (Simplified)');
        });

        it('returns uppercase code for unknown codes', () => {
            expect(getLanguageName('xyz')).toBe('XYZ');
        });
    });

    describe('normalizeLanguageCode', () => {
        it('extracts base language code', () => {
            expect(normalizeLanguageCode('zh-CN')).toBe('zh');
            expect(normalizeLanguageCode('pt-BR')).toBe('pt');
            expect(normalizeLanguageCode('en-US')).toBe('en');
        });

        it('lowercases the result', () => {
            expect(normalizeLanguageCode('EN')).toBe('en');
            expect(normalizeLanguageCode('ZH-CN')).toBe('zh');
        });
    });

    describe('COMMON_LANGUAGES', () => {
        it('includes auto-detect option', () => {
            const auto = COMMON_LANGUAGES.find(l => l.code === 'auto');
            expect(auto).toBeDefined();
            expect(auto?.supportsAutoDetect).toBe(true);
        });

        it('uses BCP 47 codes for Chinese variants', () => {
            const codes = COMMON_LANGUAGES.map(l => l.code);
            expect(codes).toContain('zh-CN');
            expect(codes).toContain('zh-TW');
            expect(codes).not.toContain('zh'); // No bare 'zh' in definitions
        });

        it('uses BCP 47 codes for Portuguese variants', () => {
            const codes = COMMON_LANGUAGES.map(l => l.code);
            expect(codes).toContain('pt');
            expect(codes).toContain('pt-BR');
        });

        it('uses "nb" for Norwegian (BCP 47)', () => {
            const codes = COMMON_LANGUAGES.map(l => l.code);
            expect(codes).toContain('nb');
            expect(codes).not.toContain('no');
        });
    });
    describe('resolveLanguageCode', () => {
        it('uses fromUserInput logic by default (no overrides)', () => {
            expect(resolveLanguageCode('zh')).toBe('zh-CN');
            expect(resolveLanguageCode('pt')).toBe('pt');
            expect(resolveLanguageCode('en')).toBe('en');
        });

        it('applies overrides for exact matches', () => {
            const overrides = { 'zh': 'zh-TW' };
            expect(resolveLanguageCode('zh', overrides)).toBe('zh-TW');
        });

        it('ignores overrides that do not match input', () => {
            const overrides = { 'zh': 'zh-TW' };
            expect(resolveLanguageCode('en', overrides)).toBe('en');
        });

        it('does not apply unrelated overrides to explicit codes', () => {
            // override 'zh'->'zh-TW', but user typed 'zh-CN'
            const overrides = { 'zh': 'zh-TW' };
            // fromUserInput('zh-CN') -> 'zh-CN' (actually 'zh-cn' via normalize in test/impl details)
            // Wait - fromUserInput returns input normalized. ISO_TO_BCP47 only has short codes.
            // If I input 'zh-CN', fromUserInput returns 'zh-cn'.
            expect(resolveLanguageCode('zh-CN', overrides)).toBe('zh-cn');
        });

        it('handles case-insensitivity in overrides lookup', () => {
            const overrides = { 'pt': 'pt-BR' };
            expect(resolveLanguageCode('PT', overrides)).toBe('pt-BR');
        });
    });
});
