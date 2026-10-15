import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default defineConfig(
    { ignores: ['dist', '.wxt', '.output', 'coverage'] },
    js.configs.recommended,
    {
        extends: [
            tseslint.configs['flat/recommended'],
        ],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
);
