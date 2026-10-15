/**
 * Offscreen Document - Clipboard Operations
 *
 * Handles clipboard write operations for the service worker.
 * Offscreen documents provide DOM access in MV3 extensions.
 *
 * @module entrypoints/offscreen
 */

import type { CopyToClipboardMessage } from '@/src/types';

/**
 * Handle messages from the service worker.
 */
chrome.runtime.onMessage.addListener(
    (
        message: CopyToClipboardMessage,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: { success: boolean; error?: string }) => void
    ) => {
        if (message.type === 'COPY_TO_CLIPBOARD') {
            copyToClipboard(message.text)
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch(() => {
                    console.error('[Offscreen] Clipboard write failed');
                    sendResponse({ success: false, error: 'Clipboard copy failed' });
                });

            // Return true to indicate we'll respond asynchronously
            return true;
        }
    }
);

/**
 * Write text to clipboard using the Clipboard API.
 */
async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Offscreen documents cannot be focused, so use DOM copy if the Clipboard API rejects.
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();

        try {
            if (!document.execCommand('copy')) {
                throw new Error('Clipboard copy failed');
            }
        } finally {
            document.body.removeChild(textArea);
        }
    }
}
