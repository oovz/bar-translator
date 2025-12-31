/**
 * Bar Translate - Background Service Worker
 *
 * Main entry point for the Chrome extension's service worker.
 * Handles omnibox events and translation orchestration.
 *
 * @module entrypoints/background
 */

import {
    translateWithFallback,
} from '@/services/index';
import { t } from '@/utils/i18n';
import {
    getPreferences,
    getApiKeys,
} from '@/utils/storage';
import {
    parseOmniboxInput,
    formatSuggestionDescription,
    formatErrorDescription,
} from '@/utils/omnibox-parser';
import { copyToClipboard } from '@/utils/clipboard';
import {
    initTelemetry,
    trackEvent,
    TelemetryEvents,
} from '@/utils/telemetry';
import type { ParsedOmniboxInput } from '@/src/types';

// Debounce timer for omnibox input
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY = 300; // ms - reduced for better UX

// Keep track of the last translation result for "Enter" key handling
let lastResult: string | null = null;

// Loading state
let isTranslating = false;

export default defineBackground(() => {
    console.log('[Background] Bar Translate extension initialized', { id: browser.runtime.id });

    // Initialize telemetry
    initTelemetry();

    // Set default suggestion
    browser.omnibox.setDefaultSuggestion({
        description: t('omniboxSuggestion'),
    });

    // ---------------------------------------------------------------------------
    // Omnibox Input Changed
    // ---------------------------------------------------------------------------
    browser.omnibox.onInputChanged.addListener((text, _suggest) => {
        if (debounceTimer) clearTimeout(debounceTimer);

        if (!text.trim()) {
            return;
        }

        // Show loading state immediately
        if (!isTranslating) {
            browser.omnibox.setDefaultSuggestion({
                description: t('omniboxTranslating'),
            });
        }

        debounceTimer = setTimeout(async () => {
            isTranslating = true;
            const startTime = Date.now();

            try {
                console.log('[Background] Omnibox input:', text);

                const preferences = await getPreferences();
                const apiKeys = await getApiKeys();

                console.log('[Background] Loaded preferences:', {
                    fallbackOrder: preferences.fallbackOrder,
                    defaultSourceLang: preferences.defaultSourceLang,
                    defaultTargetLang: preferences.defaultTargetLang,
                });

                // Parse input
                const parsed: ParsedOmniboxInput = parseOmniboxInput(text, {
                    defaultTargetLang: preferences.defaultTargetLang,
                    defaultSourceLang: preferences.defaultSourceLang,
                    languageOverrides: preferences.languageOverrides,
                });

                console.log('[Background] Parsed input:', parsed);

                if (parsed.isLanguageQuery) {
                    // TODO: Maybe show help or language info?
                    isTranslating = false;
                    return;
                }

                // Track translation request
                trackEvent(TelemetryEvents.TRANSLATION_REQUESTED, {
                    sourceLang: parsed.sourceLang || 'auto',
                    targetLang: parsed.targetLang,
                    textLength: parsed.text.length,
                    enabledServices: preferences.fallbackOrder,
                });

                // Always send to backend (no caching)
                const result = await translateWithFallback(
                    {
                        text: parsed.text,
                        sourceLang: parsed.sourceLang || 'auto',
                        targetLang: parsed.targetLang || 'en',
                    },
                    preferences,
                    apiKeys
                );

                const latency = Date.now() - startTime;

                // Track success
                trackEvent(TelemetryEvents.TRANSLATION_SUCCEEDED, {
                    serviceId: result.serviceId,
                    usedFallback: result.usedFallback,
                    latency_ms: latency,
                });

                // Update last result
                lastResult = result.translation;

                // Format and suggest
                const description = formatSuggestionDescription(
                    result.translation,
                    parsed.text,
                    result.usedFallback,
                    result.serviceId
                );

                // Update the default suggestion to the result
                browser.omnibox.setDefaultSuggestion({
                    description: description,
                });

            } catch (error) {
                console.error('[Background] Translation failed:', error);
                const latency = Date.now() - startTime;

                // Track failure
                // Track failure
                trackEvent(TelemetryEvents.TRANSLATION_FAILED, {
                    error: error instanceof Error ? error.message : String(error),
                    latency_ms: latency,
                });

                browser.omnibox.setDefaultSuggestion({
                    description: formatErrorDescription(error instanceof Error ? error.message : String(error)),
                });
                lastResult = null;
            } finally {
                isTranslating = false;
            }
        }, DEBOUNCE_DELAY);
    });

    // ---------------------------------------------------------------------------
    // Omnibox Input Entered
    // ---------------------------------------------------------------------------
    browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
        console.log('[Background] Input entered:', text, 'Disposition:', disposition);

        try {
            let translationToCopy = lastResult;

            // Re-verify if needed (e.g. if user typed fast and hit enter before debounce)
            if (!translationToCopy) {
                // ... same re-fetch logic (omitted for brevity in replacement if unchanged, but I must provide full block)
                // Wait, I should preserve re-fetch logic, and maybe track it too?
                // For safety, I'll copy the existing re-fetch block logic.
                const preferences = await getPreferences();
                const apiKeys = await getApiKeys();
                const parsed = parseOmniboxInput(text, {
                    defaultTargetLang: preferences.defaultTargetLang,
                    defaultSourceLang: preferences.defaultSourceLang,
                    languageOverrides: preferences.languageOverrides,
                });

                if (!parsed.isLanguageQuery) {
                    const result = await translateWithFallback(
                        {
                            text: parsed.text,
                            sourceLang: parsed.sourceLang || 'auto',
                            targetLang: parsed.targetLang || 'en',
                        },
                        preferences,
                        apiKeys
                    );
                    translationToCopy = result.translation;
                }
            }

            if (translationToCopy) {
                const success = await copyToClipboard(translationToCopy);
                if (success) {
                    browser.omnibox.setDefaultSuggestion({
                        description: t('omniboxCopied', [translationToCopy]),
                    });

                    // Reset after delay
                    setTimeout(() => {
                        browser.omnibox.setDefaultSuggestion({
                            description: t('omniboxSuggestion'),
                        });
                    }, 3000);
                }
            }
        } catch (error) {
            console.error('[Background] Enter handler failed:', error);
            // Telemetry restricted: do not track generic errors
        }
    });
});
