import { vi } from 'vitest';

// Mock the browser global for WXT
(globalThis as any).browser = {
    i18n: {
        getMessage: vi.fn((key: string) => key),
    },
    storage: {
        sync: {
            get: vi.fn(),
            set: vi.fn(),
        },
        local: {
            get: vi.fn(),
            set: vi.fn(),
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
(globalThis as any).chrome = (globalThis as any).browser;
