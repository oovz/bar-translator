import { describe, expect, it } from 'vitest';
import { createDefaultSetup, createInstance, getInstanceName, normalizeEndpoint, validateSetup } from '@/utils/instances';

describe('translation instances', () => {
    it('starts a new setup without clipboard copying and preserves an explicit opt-in', () => {
        expect(createDefaultSetup().copyEnabled).toBe(false);
        expect(createDefaultSetup(true).copyEnabled).toBe(true);
    });

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
    ])('rejects an endpoint outside the accepted recipient contract: %s', value => {
        expect(() => normalizeEndpoint(value)).toThrow();
    });

    it('accepts the maximum endpoint length but rejects a longer recipient', () => {
        const prefix = 'https://host.example/';
        const endpoint = prefix + 'a'.repeat(2048 - prefix.length);
        expect(normalizeEndpoint(endpoint)).toBe(endpoint);
        expect(() => normalizeEndpoint(endpoint + 'a')).toThrow('too long');
    });

    it.each(['Work\u0001', 'Work\u007f'])('rejects control characters in an account label: %j', name => {
        const setup = createDefaultSetup();
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name } : instance);
        expect(() => validateSetup({ ...setup, instances })).toThrow('provider or name is invalid');
    });

    it.each(['', 'a'.repeat(33)])('rejects a saved language outside its length contract: %j', defaultSourceLang => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, defaultSourceLang } }))
            .toThrow('language or fallback settings are invalid');
    });

    it('rejects an array where a saved language-override map is required', () => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, languageOverrides: [] } }))
            .toThrow('language or fallback settings are invalid');
    });

    it('preserves an account label at the maximum supported length', () => {
        const setup = createDefaultSetup();
        const name = 'a'.repeat(128);
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name } : instance);
        expect(validateSetup({ ...setup, instances }).instances.at(-1)).toMatchObject({ name });
    });

    it('preserves a supplied credential at the supported length limit', () => {
        const setup = createDefaultSetup();
        const credential = { key: 'a'.repeat(8192), validated: false };
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential } : instance);
        expect(validateSetup({ ...setup, instances }).instances.at(-1)).toMatchObject({ credential });
    });

    it('rejects a fixed provider stored under a configurable account identity', () => {
        const setup = createDefaultSetup();
        const instances = [{ ...setup.instances[0], id: 'google-account' }, ...setup.instances.slice(1)];
        expect(() => validateSetup({ ...setup, instances, preferences: { ...setup.preferences, fallbackOrder: [] } })).toThrow('one fixed instance');
    });

    it('rejects credentials attached to a fixed public provider', () => {
        const setup = createDefaultSetup();
        const instances = [{ ...setup.instances[0], credential: { key: 'secret', validated: false } }, ...setup.instances.slice(1)];
        expect(() => validateSetup({ ...setup, instances })).toThrow('one fixed instance');
    });

    it('rejects an unknown LibreTranslate hosting mode rather than persisting an invalid account', () => {
        const setup = createDefaultSetup();
        const instance = { ...createInstance('libretranslate'), hosting: 'unknown' };
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, instance] })).toThrow('endpoint is invalid');
    });

    it.each(['   ', 'a'.repeat(129)])('rejects an unusable saved account label: %j', name => {
        const setup = createDefaultSetup();
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name } : instance);
        expect(() => validateSetup({ ...setup, instances })).toThrow('provider or name is invalid');
    });

    it('rejects a saved language override with an empty language key', () => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, languageOverrides: { '': 'pt-BR' } } }))
            .toThrow('language override is invalid');
    });

    it('allows a parsed language override to be edited and removed like other setup preferences', () => {
        const setup = createDefaultSetup();
        const parsed = validateSetup({ ...setup, preferences: { ...setup.preferences, languageOverrides: { zh: 'zh-TW' } } });
        parsed.preferences.languageOverrides.zh = 'zh-CN';
        expect(parsed.preferences.languageOverrides.zh).toBe('zh-CN');
        delete parsed.preferences.languageOverrides.zh;
        expect(parsed.preferences.languageOverrides).toEqual({});
    });

    it('rejects an empty saved target language even when the enabled order is valid', () => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, defaultTargetLang: '' } }))
            .toThrow('language or fallback settings are invalid');
    });

    it('rejects an unsupported saved setup schema instead of relabeling it as version two', () => {
        expect(() => validateSetup({ ...createDefaultSetup(), schemaVersion: 3 })).toThrow('saved setup is invalid');
    });

    it('rejects a non-boolean saved clipboard preference rather than treating it as opt-in', () => {
        expect(() => validateSetup({ ...createDefaultSetup(), copyEnabled: 'yes' })).toThrow('saved setup is invalid');
    });

    it('rejects a singleton custom name rather than accepting a hidden name setting', () => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, instances: [{ ...setup.instances[0], name: 'Custom' }, ...setup.instances.slice(1)] }))
            .toThrow();
    });

    it('preserves editable names and a paused enabled order without using labels as identity', () => {
        const instance = createInstance('libretranslate');
        const setup = createDefaultSetup();
        const next = validateSetup({
            ...setup, instances: [...setup.instances, { ...instance, name: '<Work & Home>' }],
            preferences: { ...setup.preferences, fallbackOrder: [] },
        });
        expect(next.preferences.fallbackOrder).toEqual([]);
        expect(next.instances.at(-1)?.id).toBe(instance.id);
        expect(getInstanceName(next.instances.at(-1)!)).toBe('<Work & Home>');
    });

    it('rejects a configurable account with an empty saved identity', () => {
        const setup = createDefaultSetup();
        const instances = [...setup.instances, { ...createInstance('deepl'), id: '' }];
        expect(() => validateSetup({ ...setup, instances })).toThrow('unique identities');
    });

    it.each(['google-web', 'lingva'])('requires the fixed %s instance even while all providers are paused', providerId => {
        const setup = createDefaultSetup();
        const instances = setup.instances.filter(instance => instance.providerId !== providerId);
        expect(() => validateSetup({ ...setup, instances, preferences: { ...setup.preferences, fallbackOrder: [] } }))
            .toThrow('missing a fixed provider instance');
    });

    it('rejects repeated identities and repeated entries in the enabled sequence', () => {
        const setup = createDefaultSetup();
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
        const setup = createDefaultSetup();
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, credential } : instance);
        expect(() => validateSetup({ ...setup, instances })).toThrow('credential is invalid');
        expect(setup.instances.at(-1)).not.toHaveProperty('credential');
    });

    it('normalizes names and preserves validated credential metadata and language overrides', () => {
        const setup = createDefaultSetup();
        const credential = { key: '', validated: false, tier: 'free', lastValidated: 0 };
        const instances = setup.instances.map(instance => instance.providerId === 'deepl' ? { ...instance, name: ' Work ', credential } : instance);
        const next = validateSetup({ ...setup, instances, preferences: { ...setup.preferences, languageOverrides: { pt: 'pt-BR' } } });
        expect(next.instances.at(-1)).toEqual({ id: 'deepl', providerId: 'deepl', name: 'Work', credential });
        expect(next.preferences.languageOverrides).toEqual({ pt: 'pt-BR' });
    });

    it('does not treat an arbitrary server as the managed LibreTranslate service', () => {
        const setup = createDefaultSetup();
        const instance = createInstance('libretranslate');
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, { ...instance, endpoint: 'https://other.example' }] }))
            .toThrow();
    });
});
