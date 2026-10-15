import { vi } from 'vitest';

// Mock the browser global for WXT
const browserMock = {
    i18n: {
        getMessage: vi.fn((key: string) => key),
    },
    storage: {
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
