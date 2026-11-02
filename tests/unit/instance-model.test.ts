import { describe, expect, it, vi } from 'vitest';
import { createDefaultSetup } from '@/utils/instances';
import {
    configurationIdentity, editedInstance, recordInstanceTest, replaceEditedInstance, draftChanged, moveInstance, needsCredential, toggleInstance,
    type ConfigurableInstance, type InstanceDraft,
} from '@/entrypoints/options/components/instance-model';
import type { DeepLInstance, LibreTranslateInstance, TranslationInstance } from '@/src/types';

const account: DeepLInstance = {
    id: 'work', providerId: 'deepl', name: 'Work',
    credential: { key: 'secret:fx', tier: 'free', validated: false },
};
function setupWith(instance: ConfigurableInstance) {
    const setup = createDefaultSetup();
    setup.instances.push(structuredClone(instance));
    return setup;
}
function draft(name: string): InstanceDraft {
    return { name, key: '', tier: 'free', endpoint: '', hosting: 'managed' };
}

describe('editing and validating configured instances', () => {
    it.each(['', '   ', 'x'.repeat(129)])('rejects an invalid display name before preparing an edited instance: %j', name => {
        expect(() => editedInstance(account, draft(name), false)).toThrow('instanceNameInvalid');
    });

    it('accepts a trimmed display name at the full 128-character limit', () => {
        const name = 'x'.repeat(128);
        expect(editedInstance(account, draft(` ${name} `), false)).toMatchObject({ id: account.id, name });
    });

    it('refuses an edit of an account removed by another settings page', () => {
        const setup = createDefaultSetup();
        expect(() => replaceEditedInstance(setup, account, { ...account, name: 'Renamed' }, 'free')).toThrow('instanceChanged');
        expect(setup.instances.some(instance => instance.id === account.id)).toBe(false);
    });

    it('does not overwrite a concurrent rename with a stale editor draft', () => {
        const setup = setupWith({ ...account, name: 'Changed elsewhere' });
        const before = structuredClone(setup);
        expect(() => replaceEditedInstance(setup, account, { ...account, name: 'My stale name' }, 'free')).toThrow('instanceChanged');
        expect(setup).toEqual(before);
    });

    it('renames an account with no credential without manufacturing a credential record', () => {
        const keyless: DeepLInstance = { id: 'keyless', providerId: 'deepl', name: 'Keyless' };
        const setup = setupWith(keyless);
        const next = editedInstance(keyless, draft('Renamed keyless'), false);
        const result = replaceEditedInstance(setup, keyless, next, 'free');
        expect(result.instance).toEqual({ ...keyless, name: 'Renamed keyless', credential: undefined });
        expect(result.setup.instances.find(instance => instance.id === keyless.id)).toEqual(result.instance);
        expect(setup.instances.find(instance => instance.id === keyless.id)).toEqual(keyless);
    });

    it('records a completed test only on its intended account and leaves every other instance intact', () => {
        const setup = setupWith(account);
        const result = recordInstanceTest(setup, account.id, configurationIdentity(account), true);
        expect(result.instances.find(instance => instance.id === account.id)).toMatchObject({
            ...account, credential: { ...account.credential, validated: true, lastValidated: expect.any(Number) },
        });
        expect(result.instances.filter(instance => instance.id !== account.id)).toEqual(setup.instances.filter(instance => instance.id !== account.id));
        expect(setup.instances.find(instance => instance.id === account.id)).toEqual(account);
    });

    it('rejects a completed test after the account was removed', () => {
        expect(() => recordInstanceTest(createDefaultSetup(), account.id, configurationIdentity(account), true)).toThrow('keyChangedDuringTest');
    });

    it('rejects a completed test for a credential replaced while the request was running', () => {
        const current = setupWith({ ...account, credential: { key: 'replacement', tier: 'pro', validated: false } });
        const before = structuredClone(current);
        expect(() => recordInstanceTest(current, account.id, configurationIdentity(account), true)).toThrow('keyChangedDuringTest');
        expect(current).toEqual(before);
    });

    it.each(['endpoint', 'hosting'] as const)('rejects an old server test after the deployment %s changes', field => {
        const original: LibreTranslateInstance = {
            id: 'server', providerId: 'libretranslate', name: 'Server', hosting: field === 'endpoint' ? 'custom' : 'managed',
            endpoint: 'https://libretranslate.com', credential: { key: 'server-secret', validated: false },
        };
        const replacement: LibreTranslateInstance = field === 'endpoint'
            ? { ...original, endpoint: 'https://libretranslate.com/nested' }
            : { ...original, hosting: 'custom' };
        const setup = setupWith(replacement);
        const before = structuredClone(setup);
        expect(() => recordInstanceTest(setup, original.id, configurationIdentity(original), true)).toThrow('keyChangedDuringTest');
        expect(setup).toEqual(before);
    });
    it.each(['endpoint', 'hosting'] as const)('recognizes a draft changing only its %s as unsaved', field => {
        const server: LibreTranslateInstance = { id: 'server', providerId: 'libretranslate', name: 'Server', hosting: 'custom', endpoint: 'https://libretranslate.com' };
        const edited: InstanceDraft = { name: server.name, key: '', tier: 'free', hosting: server.hosting, endpoint: server.endpoint };
        if (field === 'endpoint') edited.endpoint = 'https://libretranslate.com/other';
        else edited.hosting = 'managed';
        expect(draftChanged(server, edited, 'free')).toBe(true);
    });

    it('moves the first provider down without losing or duplicating any other instance', () => {
        const setup = createDefaultSetup();
        setup.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
        expect(moveInstance(setup, 'google-web', 1).preferences.fallbackOrder).toEqual(['deepl', 'google-web', 'lingva']);
        expect(setup.preferences.fallbackOrder).toEqual(['google-web', 'deepl', 'lingva']);
    });

    it('ignores a reorder request for an account removed since the user started reordering', () => {
        const setup = createDefaultSetup();
        setup.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
        expect(moveInstance(setup, 'removed-account', 1)).toEqual(setup);
    });

    it('does not wrap the first provider around the list when asked to move upward', () => {
        const setup = createDefaultSetup();
        setup.preferences.fallbackOrder = ['google-web', 'deepl', 'lingva'];
        expect(moveInstance(setup, 'google-web', -1).preferences.fallbackOrder).toEqual(['google-web', 'deepl', 'lingva']);
    });

    it.each<{ instance: TranslationInstance; required: boolean }>([
        { instance: { id: 'deepl', providerId: 'deepl', name: 'DeepL' }, required: true },
        { instance: account, required: false },
        { instance: { id: 'managed', providerId: 'libretranslate', name: 'Managed', hosting: 'managed', endpoint: 'https://libretranslate.com' }, required: true },
        { instance: { id: 'custom', providerId: 'libretranslate', name: 'Custom', hosting: 'custom', endpoint: 'https://home.example' }, required: false },
        { instance: { id: 'google-web', providerId: 'google-web' }, required: false },
        { instance: { id: 'lingva', providerId: 'lingva' }, required: false },
    ])('reports whether $instance.id still requires a credential to be ready', ({ instance, required }) => {
        expect(needsCredential(instance)).toBe(required);
    });

    it('does not enable a server whose path changed while its permission request was open', async () => {
        const original: LibreTranslateInstance = { id: 'server', providerId: 'libretranslate', name: 'Server', hosting: 'custom', endpoint: 'https://host.example/old' };
        const current = setupWith({ ...original, endpoint: 'https://host.example/new' });
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
        await expect(toggleInstance(current, original, true)).rejects.toThrow('instanceChanged');
        expect(current.preferences.fallbackOrder).not.toContain(original.id);
    });

    it('reports a removed account rather than failing internally when an enable request completes', async () => {
        await expect(toggleInstance(createDefaultSetup(), account, true)).rejects.toThrow('instanceChanged');
    });

});
