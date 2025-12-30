import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
    vite: () => ({
        plugins: [preact()],
        resolve: {
            alias: {
                react: 'preact/compat',
                'react-dom': 'preact/compat',
            },
        },
    }),
    manifest: {
        name: 'Bar Translator',
        description: 'Quick translations from the Chrome address bar',
        permissions: ['storage', 'clipboardWrite', 'offscreen'],
        omnibox: {
            keyword: 't',
        },
        host_permissions: [
            'https://translate.google.com/*',
            'https://translate.googleapis.com/*',
            'https://api-free.deepl.com/*',
            'https://api.deepl.com/*',
            'https://translation.googleapis.com/*',
            'https://translate.api.cloud.yandex.net/*',
        ],
    },
});
