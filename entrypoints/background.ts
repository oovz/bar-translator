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
import type { UserPreferences, StoredApiKeys } from '@/src/types';

const DEBOUNCE_DELAY = 300;

interface TranslationRequest {
    context: string;
    controller: AbortController;
    translation?: string;
}

interface Interaction {
    input: string;
    committed: boolean;
    request?: TranslationRequest;
}

function languageContext(preferences: Partial<UserPreferences> = {}) {
    return [preferences.defaultSourceLang, preferences.defaultTargetLang, preferences.languageOverrides];
}

function translationContext(input: string, preferences: UserPreferences, apiKeys: StoredApiKeys) {
    const parsed = parseOmniboxInput(input, preferences);
    if (parsed.isLanguageQuery) return;
    const params = {
        text: parsed.text,
        sourceLang: parsed.sourceLang || 'auto',
        targetLang: parsed.targetLang || preferences.defaultTargetLang,
    };
    return {
        params,
        identity: JSON.stringify([params, languageContext(preferences), preferences.fallbackOrder, apiKeys]),
    };
}

export default defineBackground(() => {
    let current: Interaction | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

    void getPreferences().catch(() => {
        console.error('[Background] Could not load preferences');
    });

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

    function showError(error: unknown) {
        browser.omnibox.setDefaultSuggestion({
            description: formatErrorDescription(error instanceof Error ? error.message : String(error)),
        });
    }

    async function preview(interaction: Interaction) {
        try {
            const preferences = await getPreferences();
            const apiKeys = await getApiKeys();
            if (current !== interaction) return;
            const context = translationContext(interaction.input, preferences, apiKeys);
            if (!context) {
                showPrompt();
                return;
            }
            const request: TranslationRequest = {
                context: context.identity,
                controller: new AbortController(),
            };
            interaction.request = request;
            const result = await translateWithFallback({
                ...context.params, signal: request.controller.signal,
            }, preferences, apiKeys);
            if (!interaction.committed && isCurrent(interaction, request)) {
                request.translation = result.translation;
                browser.omnibox.setDefaultSuggestion({
                    description: formatSuggestionDescription(result.translation, context.params.targetLang),
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
        const interaction = current;
        if (interaction?.committed) return;
        const request = interaction?.request;
        const translation = request?.translation;
        if (!interaction || interaction.input !== input || !request || translation === undefined) {
            invalidate();
            return;
        }
        interaction.committed = true;
        try {
            const preferences = await getPreferences();
            const apiKeys = await getApiKeys();
            if (!isCurrent(interaction, request)) return;
            if (translationContext(input, preferences, apiKeys)?.identity !== request.context) {
                invalidate();
                showPrompt();
                return;
            }
            const copied = await copyToClipboard(translation, request.controller.signal);
            if (!isCurrent(interaction, request)) return;
            if (!copied) throw new Error(t('omniboxCopyFailed'));
            browser.omnibox.setDefaultSuggestion({ description: t('omniboxCopied', [escapeXml(translation)]) });
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
                        message: t('omniboxCopyFailed'),
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
            JSON.stringify(previousPreferences?.fallbackOrder) !== JSON.stringify(nextPreferences?.fallbackOrder)
        );
        const credentialsChanged = (area === 'sync' && changes.apiKeys) || (area === 'local' && changes.apiKeys_local);
        const storageSelectionChanged = area === 'local' && changes.credentialStorageType;
        if (current && (contextChanged || credentialsChanged || storageSelectionChanged)) {
            if (current.committed) {
                invalidate();
                showPrompt();
            } else {
                inputChanged(current.input);
            }
        }
    });
});
