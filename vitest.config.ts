/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
    plugins: [preact()],
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/unit/**/*.{test,spec}.{ts,tsx}', 'tests/integration/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['node_modules', '.output', 'tests/e2e'],
    },
    resolve: {
        alias: {
            react: 'preact/compat',
            'react-dom': 'preact/compat',
            '@': path.resolve(import.meta.dirname, '.'),
        },
    },
});
