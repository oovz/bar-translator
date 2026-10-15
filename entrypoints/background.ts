/**
 * Omnibox interaction ownership, translation previews, and submitted copies.
 */
import { translateWithFallback } from '@/services/index';
import { t } from '@/utils/i18n';
import { getPreferences, getApiKeys } from '@/utils/storage';
import {
    parseOmniboxInput,
    formatSuggestionDescription,
    formatErrorDescription,
    escapeXml,
} from '@/utils/omnibox-parser';
import { copyToClipboard } from '@/utils/clipboard';
import { initTelemetry, trackEvent, TelemetryEvents } from '@/utils/telemetry';
import type { UserPreferences, TranslateResultWithMeta } from '@/src/types';

const DEBOUNCE_DELAY = 300;

interface TranslationRequest {
    context: string;
    controller: AbortController;
    result: Promise<TranslateResultWithMeta>;
    failed?: boolean;
}

interface Interaction {
    input: string;
    committed: boolean;
    request?: TranslationRequest;
}

function languageContext(preferences: Partial<UserPreferences> = {}) {
    return [preferences.defaultSourceLang, preferences.defaultTargetLang, preferences.languageOverrides];
}

export default defineBackground(() => {
    let current: Interaction | undefined;
    let preparationVersion = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

    initTelemetry();

    function showPrompt() {
        browser.omnibox.setDefaultSuggestion({ description: t('omniboxSuggestion') });
    }

    function invalidate() {
        clearTimeout(debounceTimer);
        clearTimeout(feedbackTimer);
        current?.request?.controller.abort();
        current = undefined;
    }

    function isCurrent(interaction: Interaction, request: TranslationRequest) {
        return current === interaction && interaction.request === request && !request.controller.signal.aborted;
    }

    async function translate(interaction: Interaction) {
        const version = ++preparationVersion;
        const preferences = await getPreferences();
        const apiKeys = await getApiKeys();
        if (current !== interaction || version !== preparationVersion) return;

        const parsed = parseOmniboxInput(interaction.input, preferences);
        if (parsed.isLanguageQuery) {
            showPrompt();
            return;
        }

        const params = {
            text: parsed.text,
            sourceLang: parsed.sourceLang || 'auto',
            targetLang: parsed.targetLang || preferences.defaultTargetLang,
        };
        const context = JSON.stringify([params, languageContext(preferences), preferences.fallbackOrder, apiKeys]);
        if (interaction.request?.context !== context || interaction.request.failed) {
            interaction.request?.controller.abort();
            const controller = new AbortController();
            const startTime = Date.now();
            trackEvent(TelemetryEvents.TRANSLATION_REQUESTED, {
                sourceLang: params.sourceLang, targetLang: params.targetLang,
                textLength: params.text.length, enabledServices: preferences.fallbackOrder,
            });
            const result = translateWithFallback({ ...params, signal: controller.signal }, preferences, apiKeys)
                .then(result => {
                    trackEvent(TelemetryEvents.TRANSLATION_SUCCEEDED, {
                        serviceId: result.serviceId, usedFallback: result.usedFallback,
                        latency_ms: Date.now() - startTime,
                    });
                    return result;
                }).catch(error => {
                    if (!controller.signal.aborted) {
                        trackEvent(TelemetryEvents.TRANSLATION_FAILED, {
                            error: error instanceof Error ? error.message : String(error),
                            latency_ms: Date.now() - startTime,
                        });
                    }
                    throw error;
                });
            interaction.request = { context, controller, result };
        }
        const request = interaction.request;
        try {
            const result = await request.result;
            if (isCurrent(interaction, request)) {
                return { translation: result.translation, targetLang: params.targetLang, request };
            }
        } catch (error) {
            request.failed = true;
            if (isCurrent(interaction, request)) throw error;
        }
    }

    function showError(error: unknown) {
        browser.omnibox.setDefaultSuggestion({
            description: formatErrorDescription(error instanceof Error ? error.message : String(error)),
        });
    }

    async function preview(interaction: Interaction) {
        try {
            const result = await translate(interaction);
            if (result && !interaction.committed && isCurrent(interaction, result.request)) {
                browser.omnibox.setDefaultSuggestion({
                    description: formatSuggestionDescription(result.translation, result.targetLang),
                });
            }
        } catch (error) {
            if (current === interaction && !interaction.committed) showError(error);
        }
    }

    function inputChanged(input: string) {
        invalidate();
        if (!input.trim()) {
            showPrompt();
            return;
        }
        const interaction: Interaction = { input, committed: false };
        current = interaction;
        browser.omnibox.setDefaultSuggestion({ description: t('omniboxTranslating') });
        debounceTimer = setTimeout(() => { void preview(interaction); }, DEBOUNCE_DELAY);
    }

    showPrompt();
    browser.omnibox.onInputStarted.addListener(() => {
        invalidate();
        showPrompt();
    });
    browser.omnibox.onInputCancelled.addListener(() => {
        invalidate();
        showPrompt();
    });
    browser.omnibox.onInputChanged.addListener(inputChanged);

    browser.omnibox.onInputEntered.addListener(async input => {
        clearTimeout(debounceTimer);
        if (current?.input !== input) {
            invalidate();
            current = { input, committed: false };
        }
        const interaction = current;
        if (interaction.committed) return;
        interaction.committed = true;
        let failureMessage = t('omniboxTranslationFailed');
        try {
            const result = await translate(interaction);
            if (!result || !isCurrent(interaction, result.request)) return;
            failureMessage = t('omniboxCopyFailed');
            const copied = await copyToClipboard(result.translation, result.request.controller.signal);
            if (!isCurrent(interaction, result.request)) return;
            if (!copied) throw new Error(t('omniboxCopyFailed'));
            browser.omnibox.setDefaultSuggestion({ description: t('omniboxCopied', [escapeXml(result.translation)]) });
            feedbackTimer = setTimeout(showPrompt, 3000);
        } catch (error) {
            if (current === interaction) {
                showError(error);
                // Enter closes the omnibox, so submission failures also need visible feedback.
                try {
                    await browser.notifications.create('translation-error', {
                        type: 'basic',
                        iconUrl: 'icons/icon-128.png',
                        title: t('extName'),
                        message: failureMessage,
                    });
                } catch {
                    console.error('[Background] Could not display failure notification');
                }
            }
        } finally {
            if (current === interaction) {
                interaction.request?.controller.abort();
                current = undefined;
            }
        }
    });

    browser.storage.onChanged.addListener((changes, area) => {
        const preferenceChange = area === 'sync' ? changes.preferences : undefined;
        const previousPreferences = preferenceChange?.oldValue as Partial<UserPreferences> | undefined;
        const nextPreferences = preferenceChange?.newValue as Partial<UserPreferences> | undefined;
        const contextChanged = preferenceChange && (
            JSON.stringify(languageContext(previousPreferences)) !== JSON.stringify(languageContext(nextPreferences)) ||
            JSON.stringify(previousPreferences?.fallbackOrder) !== JSON.stringify(nextPreferences?.fallbackOrder) ||
            previousPreferences?.storageType !== nextPreferences?.storageType
        );
        const credentialsChanged = (area === 'sync' && changes.apiKeys) || (area === 'local' && changes.apiKeys_local);
        if (current && (contextChanged || credentialsChanged)) {
            if (current.committed) {
                invalidate();
                showPrompt();
            } else {
                inputChanged(current.input);
            }
        }
    });
});
