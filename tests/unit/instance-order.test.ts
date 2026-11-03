import { describe, expect, it, vi } from 'vitest';
import { createDefaultSetup, validateSetup } from '@/utils/instances';
import { addEditedInstance, moveInstance, reorderEnabledInstances, toggleInstance } from '@/entrypoints/options/components/instance-model';
import type { TranslationSetup } from '@/src/types';

function legacy(): TranslationSetup {
    return { schemaVersion: 2, copyEnabled: false,
        preferences: { defaultSourceLang: 'auto', defaultTargetLang: 'en', languageOverrides: {}, fallbackOrder: ['lingva', 'google-web'] },
        instances: [{ id: 'google-web', providerId: 'google-web' }, { id: 'lingva', providerId: 'lingva' }, { id: 'work', providerId: 'deepl', name: 'Work', credential: { key: 'secret', validated: false } }],
    };
}

describe('stable configured service order', () => {
    it('migrates legacy active priority followed by inactive accounts without losing their settings', () => {
        const previous = legacy();
        const next = validateSetup(previous);
        expect(next.instanceOrder).toEqual(['lingva', 'google-web', 'work']);
        expect(next.instances).toEqual(previous.instances);
        expect(next.preferences).toEqual(previous.preferences);
        expect(validateSetup(next)).toEqual(next);
    });
    it('starts a fresh setup with only Google configured', () => {
        expect(createDefaultSetup().instances).toEqual([{ id: 'google-web', providerId: 'google-web' }]);
    });
    it.each([['work'], ['lingva', 'google-web', 'work', 'work'], ['lingva', 'google-web', 'missing']].map(instanceOrder => ({ instanceOrder })))('rejects damaged persisted order $instanceOrder', ({ instanceOrder }) => {
        expect(() => validateSetup({ ...legacy(), instanceOrder })).toThrow();
    });
    it('rejects an explicit display order that contradicts enabled fallback priority', () => {
        expect(() => validateSetup({ ...legacy(), instanceOrder: ['google-web', 'lingva', 'work'] }))
            .toThrow();
    });
    it('retains concurrent additions and never resurrects a deleted row from a drag snapshot', () => {
        const current = validateSetup(legacy());
        const added = addEditedInstance(current, { id: 'new', providerId: 'deepl', name: 'New' }).setup;
        const reordered = reorderEnabledInstances(added, ['work', 'deleted', 'google-web', 'lingva']);
        expect(reordered.instanceOrder).toEqual(['google-web', 'lingva', 'work', 'new']);
        expect(reordered.preferences.fallbackOrder).toEqual(['google-web', 'lingva']);
    });
    it('preserves the off account slot while reordering enabled services and restoring it', async () => {
        const current = validateSetup({ ...legacy(), instanceOrder: ['lingva', 'work', 'google-web'] });
        const moved = moveInstance(current, 'lingva', 1);
        expect(moved.instanceOrder).toEqual(['google-web', 'work', 'lingva']);
        expect(moved.preferences.fallbackOrder).toEqual(['google-web', 'lingva']);
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        const enabled = await toggleInstance(moved, moved.instances[2]!, true);
        expect(enabled.preferences.fallbackOrder).toEqual(['google-web', 'work', 'lingva']);
        const disabled = await toggleInstance(enabled, enabled.instances[2]!, false);
        expect(disabled.instanceOrder).toEqual(moved.instanceOrder);
    });
    it('does not reorder a disabled service through an obsolete arrow event', () => {
        const current = validateSetup(legacy());
        expect(moveInstance(current, 'work', -1)).toBe(current);
    });
    it('retains concurrently enabled services when an older enabled drag finishes', () => {
        const current = validateSetup({ ...legacy(), instanceOrder: ['lingva', 'work', 'google-web'],
            preferences: { ...legacy().preferences, fallbackOrder: ['lingva', 'work', 'google-web'] } });
        const reordered = reorderEnabledInstances(current, ['google-web', 'deleted', 'lingva']);
        expect(reordered.instanceOrder).toEqual(['google-web', 'lingva', 'work']);
        expect(reordered.preferences.fallbackOrder).toEqual(['google-web', 'lingva', 'work']);
    });
    it('moves past a hidden untouched legacy DeepL slot in one visible step', () => {
        const current = legacy();
        current.instances[2] = { id: 'deepl', providerId: 'deepl', name: 'DeepL' };
        current.instanceOrder = ['lingva', 'deepl', 'google-web'];
        const moved = moveInstance(current, 'lingva', 1);
        expect(moved.instanceOrder).toEqual(['google-web', 'deepl', 'lingva']);
        expect(moved.preferences.fallbackOrder).toEqual(['google-web', 'lingva']);
    });
    it('appends a newly saved inactive account without moving existing accounts', () => {
        const current = validateSetup(legacy());
        const next = addEditedInstance(current, { id: 'personal', providerId: 'deepl', name: 'Personal' }).setup;
        expect(next.instanceOrder).toEqual(['lingva', 'google-web', 'work', 'personal']);
        expect(next.preferences.fallbackOrder).toEqual(current.preferences.fallbackOrder);
    });
});
