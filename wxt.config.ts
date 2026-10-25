import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
    manifestVersion: 3,
    vite: () => ({
        plugins: [preact()],
        resolve: {
            alias: {
                react: 'preact/compat',
                'react-dom': 'preact/compat',
            },
        },
    }),
    manifest: ({ browser }) => {
        if (browser === 'safari') {
            throw new Error('Safari is unsupported: its extension API does not provide the required omnibox workflow.');
        }
        return {
            name: '__MSG_extName__',
            description: '__MSG_extDescription__',
            default_locale: 'en',
            permissions: ['storage'],
            optional_permissions: browser === 'firefox' ? ['clipboardWrite'] : ['clipboardWrite', 'offscreen'],
            ...(browser === 'firefox' ? {
                browser_specific_settings: {
                    gecko: {
                        id: 'bar-translator@oovz',
                        strict_min_version: '140.0',
                        data_collection_permissions: { required: ['searchTerms', 'authenticationInfo'] },
                    },
                },
            } : { minimum_chrome_version: '116' }),
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
            optional_host_permissions: [
                'https://translate.google.com/*',
                'https://api-free.deepl.com/*',
                'https://api.deepl.com/*',
                'http://*/*',
                'https://*/*',
            ],
        };
    },
});
