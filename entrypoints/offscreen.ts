/**
 * Offscreen Document - Clipboard Operations
 *
 * Handles clipboard write operations for the service worker.
 * Offscreen documents provide DOM access in MV3 extensions.
 *
 * @module entrypoints/offscreen
 */

import type { CopyToClipboardMessage } from '@/src/types';

export default defineUnlistedScript(() => {
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
                    .catch((error) => {
                        console.error('[Offscreen] Clipboard write failed:', error);
                        sendResponse({ success: false, error: String(error) });
                    });

                // Return true to indicate we'll respond asynchronously
                return true;
            }
        }
    );

    console.log('[Offscreen] Document loaded and ready');
});

/**
 * Write text to clipboard using the Clipboard API.
 */
async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        console.log('[Offscreen] Text copied to clipboard');
    } catch (error) {
        // Fallback to execCommand for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
            console.log('[Offscreen] Text copied via execCommand');
        } finally {
            document.body.removeChild(textArea);
        }
    }
}
