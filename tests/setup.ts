import { vi } from 'vitest';

// Mock the browser global for WXT
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

// Mock chrome global as well since some libraries might use it
vi.stubGlobal('browser', browserMock);
vi.stubGlobal('chrome', browserMock);

// Emulate the browser boundary: exclusive locks queue work until the owner settles.
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
