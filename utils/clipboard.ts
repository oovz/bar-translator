/**
 * Clipboard Helper
 *
 * Firefox writes from its background document; Chromium uses an offscreen document.
 *
 * @module utils/clipboard
 */

import type { CopyToClipboardMessage } from '@/src/types';
import { hasCopyAccess } from './permissions';

let creatingDocument: Promise<void> | undefined;

/**
 * Ensure offscreen document exists.
 */
async function ensureOffscreenDocument(signal?: AbortSignal): Promise<void> {
    // Check if we already have an offscreen document
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    signal?.throwIfAborted();

    // Share creation until the document has loaded and registered its listener.
    if (existingContexts.length === 0 && !creatingDocument) {
        creatingDocument = chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: [chrome.offscreen.Reason.CLIPBOARD],
            justification: 'Copy translation result to clipboard',
        }).then(async () => {
            if (!await hasCopyAccess()) await closeOffscreenDocument();
        }).finally(() => { creatingDocument = undefined; });
    }
    await creatingDocument;
    signal?.throwIfAborted();
}

/**
 * Copy text to clipboard using offscreen document.
 *
 * @param text - Text to copy
 * @returns Promise that resolves when copy is complete
 */
export async function copyToClipboard(text: string, signal?: AbortSignal): Promise<boolean> {
    try {
        signal?.throwIfAborted();
        if (!await hasCopyAccess()) return false;
        signal?.throwIfAborted();
        if (import.meta.env.FIREFOX) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        await ensureOffscreenDocument(signal);
        signal?.throwIfAborted();

        if (!await hasCopyAccess()) return false;
        signal?.throwIfAborted();

        const message: CopyToClipboardMessage = {
            type: 'COPY_TO_CLIPBOARD',
            text,
        };

        const response = await chrome.runtime.sendMessage(message);

        if (response?.success) {
            return true;
        }

        console.error('[Clipboard] Copy failed');
        return false;
    } catch {
        console.error('[Clipboard] Copy failed');
        return false;
    }
}

/**
 * Close offscreen document to free resources.
 * Call this after clipboard operations if you want to clean up.
 */
export async function closeOffscreenDocument(): Promise<void> {
    if (import.meta.env.FIREFOX) return;
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) await chrome.offscreen.closeDocument();
}
