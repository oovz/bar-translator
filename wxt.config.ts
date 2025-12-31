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
        name: '__MSG_extName__',
        description: '__MSG_extDescription__',
        default_locale: 'en',
        permissions: ['storage', 'clipboardWrite', 'offscreen'],
        icons: {
            16: '/icons/icon-16.png',
            32: '/icons/icon-32.png',
            48: '/icons/icon-48.png',
            96: '/icons/icon-96.png',
            128: '/icons/icon-128.png',
        },
        action: {
            default_icon: {
                16: '/icons/icon-16.png',
                32: '/icons/icon-32.png',
                48: '/icons/icon-48.png',
                96: '/icons/icon-96.png',
                128: '/icons/icon-128.png',
            },
        },
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
