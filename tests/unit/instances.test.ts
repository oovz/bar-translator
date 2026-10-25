import { describe, expect, it } from 'vitest';
import { createDefaultSetup, createInstance, getInstanceName, normalizeEndpoint, supportsMultipleInstances, validateSetup } from '@/utils/instances';

describe('translation instances', () => {
    it('gives multiple configurations distinct identities while singleton labels remain fixed', () => {
        const first = createInstance('deepl');
        const second = createInstance('deepl');
        expect(first.id).not.toBe(second.id);
        const setup = createDefaultSetup();
        expect(setup.instances.filter(item => !supportsMultipleInstances(item.providerId)).map(getInstanceName))
            .toEqual(['Google Web', 'Lingva']);
        expect(supportsMultipleInstances('libretranslate')).toBe(true);
        expect(supportsMultipleInstances('google-web')).toBe(false);
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

    it('rejects a singleton custom name rather than accepting a hidden name setting', () => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, instances: [{ ...setup.instances[0], name: 'Custom' }, ...setup.instances.slice(1)] }))
            .toThrow('fixed instance');
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

    it('rejects repeated identities and repeated entries in the enabled sequence', () => {
        const setup = createDefaultSetup();
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, setup.instances[0]] })).toThrow('unique');
        expect(() => validateSetup({ ...setup, preferences: { ...setup.preferences, fallbackOrder: ['google-web', 'google-web'] } }))
            .toThrow('repeated');
    });

    it('does not treat an arbitrary server as the managed LibreTranslate service', () => {
        const setup = createDefaultSetup();
        const instance = createInstance('libretranslate');
        expect(() => validateSetup({ ...setup, instances: [...setup.instances, { ...instance, endpoint: 'https://other.example' }] }))
            .toThrow('official endpoint');
    });
});
