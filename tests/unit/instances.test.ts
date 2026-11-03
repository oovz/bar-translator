import { createLegacySetup } from '@/tests/fixtures/legacy-setup';
import { describe, expect, it } from 'vitest';
import { createInstance, getInstanceName, normalizeEndpoint, validateSetup } from '@/utils/instances';

describe('translation instances', () => {
    it('gives separate accounts distinct instance identities', () => {
        const first = createInstance('deepl');
        const second = createInstance('deepl');
        expect(first.id).not.toBe(second.id);
    });

    it('normalizes an explicitly configured deployment URL while preserving its port and prefix', () => {
        expect(normalizeEndpoint(' HTTP://LOCALHOST:5000/libre/ ')).toBe('http://localhost:5000/libre');
        expect(normalizeEndpoint('https://translate.example:8443/nested/prefix')).toBe('https://translate.example:8443/nested/prefix');
    });

    it.each([
        'file:///tmp/server', 'ftp://host/libre', 'localhost:5000', 'https://user:secret@host/libre',
        'https://host/libre?api_key=secret', 'https://host/libre#secret', 'https://host/libre?',
        'https://*/libre', 'https://ho\tst/libre',
    ])('rejects unsupported or credential-bearing endpoint URLs: %s', value => {
        expect(() => normalizeEndpoint(value)).toThrow();
    });

    it('accepts the maximum endpoint length but rejects a longer recipient', () => {
        const prefix = 'https://host.example/';
        const endpoint = prefix + 'a'.repeat(2048 - prefix.length);
        expect(normalizeEndpoint(endpoint)).toBe(endpoint);
        expect(() => normalizeEndpoint(endpoint + 'a')).toThrow();
    });

    it.each(['Work\u0001', 'Work\u007f'])('rejects control characters in an account label: %j', name => {
        const setup = createLegacySetup();
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name } : instance);
        expect(() => validateSetup({ ...setup, instances })).toThrow();
    });

    it.each(['', 'a'.repeat(33)])('rejects an empty or oversized saved source language: %j', defaultSourceLang => {
        const setup = createLegacySetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, defaultSourceLang } }))
            .toThrow();
    });

    it('rejects an array where a saved language-override map is required', () => {
        const setup = createLegacySetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, languageOverrides: [] } }))
            .toThrow();
    });

    it('preserves an account label at the maximum supported length', () => {
        const setup = createLegacySetup();
        const name = 'a'.repeat(128);
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name } : instance);
        expect(validateSetup({ ...setup, instances }).instances.at(-1)).toMatchObject({ name });
    });

    it('preserves a supplied credential at the supported length limit', () => {
        const setup = createLegacySetup();
        const credential = { key: 'a'.repeat(8192), validated: false };
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential } : instance);
        expect(validateSetup({ ...setup, instances }).instances.at(-1)).toMatchObject({ credential });
    });

    it('rejects a fixed provider stored under a configurable account identity', () => {
        const setup = createLegacySetup();
        const instances = [{ ...setup.instances[0], id: 'google-account' }, ...setup.instances.slice(1)];
        expect(() => validateSetup({ ...setup, instances, preferences: { ...setup.preferences, fallbackOrder: [] } })).toThrow();
    });

    it('rejects credentials attached to a fixed public provider', () => {
        const setup = createLegacySetup();
        const instances = [{ ...setup.instances[0], credential: { key: 'secret', validated: false } }, ...setup.instances.slice(1)];
        expect(() => validateSetup({ ...setup, instances })).toThrow();
    });

    it('rejects an unknown LibreTranslate hosting mode', () => {
        const setup = createLegacySetup();
        const instance = { ...createInstance('libretranslate'), hosting: 'unknown' };
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, instance] })).toThrow();
    });

    it.each(['   ', 'a'.repeat(129)])('rejects an unusable saved account label: %j', name => {
        const setup = createLegacySetup();
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name } : instance);
        expect(() => validateSetup({ ...setup, instances })).toThrow();
    });

    it('rejects a saved language override with an empty language key', () => {
        const setup = createLegacySetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, languageOverrides: { '': 'pt-BR' } } }))
            .toThrow();
    });

    it('allows a parsed language override to be edited and removed like other setup preferences', () => {
        const setup = createLegacySetup();
        const parsed = validateSetup({ ...setup, preferences: { ...setup.preferences, languageOverrides: { zh: 'zh-TW' } } });
        parsed.preferences.languageOverrides.zh = 'zh-CN';
        expect(parsed.preferences.languageOverrides.zh).toBe('zh-CN');
        delete parsed.preferences.languageOverrides.zh;
        expect(parsed.preferences.languageOverrides).toEqual({});
    });

    it('rejects an empty saved target language even when the enabled order is valid', () => {
        const setup = createLegacySetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, defaultTargetLang: '' } }))
            .toThrow();
    });

    it('rejects an unsupported saved setup schema', () => {
        expect(() => validateSetup({ ...createLegacySetup(), schemaVersion: 3 })).toThrow();
    });

    it('rejects a non-boolean saved clipboard preference', () => {
        expect(() => validateSetup({ ...createLegacySetup(), copyEnabled: 'yes' })).toThrow();
    });

    it('rejects a custom name on a fixed provider', () => {
        const setup = createLegacySetup();
        expect(() => validateSetup({ ...setup, instances: [{ ...setup.instances[0], name: 'Custom' }, ...setup.instances.slice(1)] }))
            .toThrow();
    });

    it('preserves editable names and a paused enabled order without using labels as identity', () => {
        const instance = createInstance('libretranslate');
        const setup = createLegacySetup();
        const next = validateSetup({
            ...setup, instances: [...setup.instances, { ...instance, name: '<Work & Home>' }],
            preferences: { ...setup.preferences, fallbackOrder: [] },
        });
        expect(next.preferences.fallbackOrder).toEqual([]);
        expect(next.instances.at(-1)?.id).toBe(instance.id);
        expect(getInstanceName(next.instances.at(-1)!)).toBe('<Work & Home>');
    });

    it('rejects a configurable account with an empty saved identity', () => {
        const setup = createLegacySetup();
        const instances = [...setup.instances, { ...createInstance('deepl'), id: '' }];
        expect(() => validateSetup({ ...setup, instances })).toThrow();
    });

    it.each(['google-web', 'lingva'])('allows removing the fixed %s configuration while all providers are paused', providerId => {
        const setup = createLegacySetup();
        const instances = setup.instances.filter(instance => instance.providerId !== providerId);
        expect(validateSetup({ ...setup, instances, preferences: { ...setup.preferences, fallbackOrder: [] } }).instances)
            .toEqual(instances);
    });

    it('rejects repeated identities and repeated entries in the enabled sequence', () => {
        const setup = createLegacySetup();
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, setup.instances[0]] })).toThrow();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['google-web', 'google-web'] } }))
            .toThrow();
    });

    it.each([
        { key: 42, validated: true },
        { key: 'secret', validated: true, tier: 'other' },
        { key: 'secret', validated: true, lastValidated: Infinity },
        { key: 'secret', validated: 'yes' },
    ])('rejects malformed credential metadata without changing the setup', credential => {
        const setup = createLegacySetup();
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential } : instance);
        expect(() => validateSetup({ ...setup, instances })).toThrow();
        expect(setup.instances.at(-1)).not.toHaveProperty('credential');
    });

    it('normalizes names and preserves validated credential metadata and language overrides', () => {
        const setup = createLegacySetup();
        const credential = { key: '', validated: false, tier: 'free', lastValidated: 0 };
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: ' Work ', credential } : instance);
        const next = validateSetup({ ...setup, instances, preferences: { ...setup.preferences, languageOverrides: { pt: 'pt-BR' } } });
        expect(next.instances.at(-1)).toEqual({ id: 'deepl', providerId: 'deepl', name: 'Work', credential });
        expect(next.preferences.languageOverrides).toEqual({ pt: 'pt-BR' });
    });

    it('does not treat an arbitrary server as the managed LibreTranslate service', () => {
        const setup = createLegacySetup();
        const instance = createInstance('libretranslate');
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, { ...instance, endpoint: 'https://other.example' }] }))
            .toThrow();
    });
});
