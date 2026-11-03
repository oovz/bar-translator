import { vi } from 'vitest';

const browserMock = {
    permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        getAll: vi.fn(async () => ({ permissions: [], origins: [] })),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    i18n: {
        getMessage: vi.fn((key: string) => key),
    },
    storage: {
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
        sync: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn(),
        },
        local: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn(),
        },
    },
    runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getContexts: vi.fn(async () => []),
        sendMessage: vi.fn(),
        onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
        },
    },
};

vi.stubGlobal('browser', browserMock);
vi.stubGlobal('chrome', browserMock);

// Exclusive locks wait for the current owner to finish.
let credentialLock = Promise.resolve();
Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
        request: (_name: string, callback: () => Promise<unknown>) => {
            const result = credentialLock.then(callback);
            credentialLock = result.then(() => undefined, () => undefined);
            return result;
        },
    },
});
