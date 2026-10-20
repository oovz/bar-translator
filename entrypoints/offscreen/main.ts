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
            try {
                copyToClipboard(message.text);
                sendResponse({ success: true });
            } catch {
                console.error('[Offscreen] Clipboard write failed');
                sendResponse({ success: false, error: 'Clipboard copy failed' });
            }
        }
    }
);

/**
 * Chrome's offscreen clipboard sample uses DOM copying because the document
 * cannot receive focus: https://developer.chrome.com/docs/extensions/reference/api/offscreen
 */
function copyToClipboard(text: string): void {
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
        textArea.remove();
    }
}
