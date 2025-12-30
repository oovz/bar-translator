/**
 * Clipboard Helper
 *
 * Service worker side utilities for clipboard operations.
 * Uses the offscreen document for actual clipboard access.
 *
 * @module utils/clipboard
 */

import type { CopyToClipboardMessage } from '@/src/types';

/**
 * Ensure offscreen document exists.
 */
async function ensureOffscreenDocument(): Promise<void> {
    // Check if we already have an offscreen document
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
        return;
    }

    // Create offscreen document
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: [chrome.offscreen.Reason.CLIPBOARD],
            justification: 'Copy translation result to clipboard',
        });
    } catch (error) {
        // Document might already exist (race condition)
        if (!String(error).includes('Only a single offscreen')) {
            throw error;
        }
    }
}

/**
 * Copy text to clipboard using offscreen document.
 *
 * @param text - Text to copy
 * @returns Promise that resolves when copy is complete
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await ensureOffscreenDocument();

        const message: CopyToClipboardMessage = {
            type: 'COPY_TO_CLIPBOARD',
            text,
        };

        const response = await chrome.runtime.sendMessage(message);

        if (response?.success) {
            return true;
        }

        console.error('[Clipboard] Copy failed:', response?.error);
        return false;
    } catch (error) {
        console.error('[Clipboard] Error:', error);
        return false;
    }
}

/**
 * Close offscreen document to free resources.
 * Call this after clipboard operations if you want to clean up.
 */
export async function closeOffscreenDocument(): Promise<void> {
    try {
        await chrome.offscreen.closeDocument();
    } catch {
        // Ignore if document doesn't exist
    }
}
