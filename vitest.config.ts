/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
    plugins: [preact()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/unit/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['node_modules', '.output', 'tests/e2e'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                '.output/**',
                'tests/**',
                '**/*.d.ts',
                'wxt.config.ts',
                'vitest.config.ts',
                'playwright.config.ts',
            ],
        },
    },
    resolve: {
        alias: {
            react: 'preact/compat',
            'react-dom': 'preact/compat',
            '@': path.resolve(__dirname, '.'),
        },
    },
});
