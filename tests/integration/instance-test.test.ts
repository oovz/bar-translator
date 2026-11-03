import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testConfiguredInstance, testInstance } from '@/services';
import { createLegacySetup } from '@/tests/fixtures/legacy-setup';
import * as storage from '@/utils/storage';
import type { TranslationInstance } from '@/src/types';

const account: TranslationInstance = {
    id: 'account', providerId: 'deepl', name: 'Work',
    credential: { key: 'work-key', tier: 'pro', validated: false },
};
const server: TranslationInstance = {
    id: 'server', providerId: 'libretranslate', name: 'Home',
    hosting: 'custom', endpoint: 'http://localhost:5000/libre', credential: undefined,
};

function savedInstance(instance: TranslationInstance) {
    const setup = createLegacySetup();
    setup.instances = setup.instances.filter(candidate => candidate.id !== instance.id);
    setup.instances.push(structuredClone(instance));
    setup.preferences.fallbackOrder = [instance.id];
    vi.spyOn(storage, 'getSetup').mockResolvedValue(setup);
    return setup;
}

beforeEach(() => {
    vi.mocked(chrome.permissions.contains).mockImplementation(async () => true);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request'));
});
afterEach(() => vi.restoreAllMocks());

describe('explicit saved instance test', () => {
    it('checks a saved DeepL account against its configured tier without translating user text', async () => {
        savedInstance(account);
        vi.mocked(fetch).mockResolvedValue(new Response('{}'));
        expect(await testInstance(account)).toEqual({ valid: true, tier: 'pro' });
        expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.deepl.com/v2/usage', expect.objectContaining({
            method: 'GET', headers: { Authorization: 'DeepL-Auth-Key work-key' },
        }));
    });

    it('checks a saved custom server by discovering languages and translating the fixed sample', async () => {
        savedInstance(server);
        vi.mocked(fetch).mockResolvedValueOnce(Response.json([{ code: 'en', name: 'English', targets: ['en'] }]))
            .mockResolvedValueOnce(Response.json({ translatedText: 'Hello' }));
        expect(await testInstance(server)).toEqual({ valid: true });
        expect(fetch).toHaveBeenNthCalledWith(1, `${server.endpoint}/languages`, expect.objectContaining({ method: 'GET' }));
        expect(fetch).toHaveBeenNthCalledWith(2, `${server.endpoint}/translate`, expect.objectContaining({
            body: JSON.stringify({ q: 'Hello', source: 'en', target: 'en', format: 'text' }),
        }));
    });

    it('accepts a saved fixed provider without making a network request', async () => {
        const instance: TranslationInstance = { id: 'google-web', providerId: 'google-web' };
        savedInstance(instance);
        expect(await testInstance(instance)).toEqual({ valid: true });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refuses an unsaved instance before permission or network checks', async () => {
        vi.spyOn(storage, 'getSetup').mockResolvedValue(createLegacySetup());
        expect(await testInstance(account)).toEqual({ valid: false, error: expect.any(String) });
        expect(chrome.permissions.contains).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refuses a disabled saved instance before permission or network checks', async () => {
        const setup = savedInstance(account);
        setup.preferences.fallbackOrder = [];
        expect(await testInstance(account)).toEqual({ valid: false, error: expect.any(String) });
        expect(chrome.permissions.contains).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        { ...account, credential: { ...account.credential!, key: 'changed-key' } },
        { ...account, credential: { ...account.credential!, tier: 'free' as const } },
        { ...server, endpoint: 'http://localhost:9000/libre' },
        { ...server, hosting: 'managed' as const },
    ])('refuses changed recipient or credentials until saved', async changed => {
        savedInstance(changed.id === account.id ? account : server);
        expect(await testInstance(changed)).toMatchObject({ valid: false });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not treat a display-name edit as a change of recipient', async () => {
        savedInstance(account);
        vi.mocked(fetch).mockResolvedValue(new Response('{}'));
        expect(await testInstance({ ...account, name: 'Renamed account' })).toEqual({ valid: true, tier: 'pro' });
    });

    it('reports missing provider access without contacting the recipient', async () => {
        savedInstance(account);
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        expect(await testInstance(account)).toEqual({ valid: false, error: expect.any(String) });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reports a missing DeepL key without contacting the recipient', async () => {
        const empty: TranslationInstance = { id: 'empty', providerId: 'deepl', name: 'Empty' };
        savedInstance(empty);
        expect(await testInstance(empty)).toEqual({ valid: false, error: expect.any(String) });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('explicit add-dialog preflight', () => {
    it('checks an unsaved draft after access is granted without requiring enablement', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('{}'));
        expect(await testConfiguredInstance(account)).toEqual({ valid: true, tier: 'pro' });
    });

    it('refuses a draft without browser access before contacting the recipient', async () => {
        vi.mocked(chrome.permissions.contains).mockImplementation(async () => false);
        expect(await testConfiguredInstance(account)).toEqual({ valid: false, error: expect.any(String) });
        expect(fetch).not.toHaveBeenCalled();
    });
});
