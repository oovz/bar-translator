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

interface CompletedTranslation {
    input: string;
    context: string;
    translation: string;
}

interface Interaction {
    input: string;
    committed: boolean;
    controller: AbortController;
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
    let completed: CompletedTranslation | undefined;
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
        const interaction = current;
        // Release ownership before abort callbacks can settle the old preview.
        current = undefined;
        interaction?.controller.abort();
    }

    function isCurrent(interaction: Interaction) {
        return current === interaction && !interaction.controller.signal.aborted;
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
            const result = await translateWithFallback({
                ...context.params, signal: interaction.controller.signal,
            }, preferences, apiKeys);
            if (!interaction.committed && isCurrent(interaction)) {
                completed = {
                    input: interaction.input,
                    context: context.identity,
                    translation: result.translation,
                };
                browser.omnibox.setDefaultSuggestion({
                    description: formatSuggestionDescription(result.translation, context.params.targetLang),
                });
            }
        } catch (error) {
            if (current === interaction && !interaction.committed) showError(error);
        }
    }

    function inputChanged(input: string) {
        completed = undefined;
        invalidate();
        if (!input.trim()) {
            showPrompt();
            return;
        }
        const interaction: Interaction = { input, committed: false, controller: new AbortController() };
        current = interaction;
        browser.omnibox.setDefaultSuggestion({ description: t('omniboxTranslating') });
        debounceTimer = setTimeout(() => { void preview(interaction); }, DEBOUNCE_DELAY);
    }

    showPrompt();
    browser.omnibox.onInputStarted.addListener(() => {
        completed = undefined;
        invalidate();
        showPrompt();
    });
    browser.omnibox.onInputCancelled.addListener(() => {
        // Chrome can close keyword mode before dispatching the accepted input.
        invalidate();
        showPrompt();
    });
    browser.omnibox.onInputChanged.addListener(inputChanged);

    browser.omnibox.onInputEntered.addListener(async input => {
        clearTimeout(debounceTimer);
        if (current?.committed) return;
        const result = completed;
        completed = undefined;
        invalidate();
        if (!result || result.input !== input) return;
        const interaction: Interaction = { input, committed: true, controller: new AbortController() };
        current = interaction;
        try {
            const preferences = await getPreferences();
            const apiKeys = await getApiKeys();
            if (!isCurrent(interaction)) return;
            if (translationContext(input, preferences, apiKeys)?.identity !== result.context) {
                invalidate();
                showPrompt();
                return;
            }
            const copied = await copyToClipboard(result.translation, interaction.controller.signal);
            if (!isCurrent(interaction)) return;
            if (!copied) throw new Error(t('omniboxCopyFailed'));
            browser.omnibox.setDefaultSuggestion({ description: t('omniboxCopied', [escapeXml(result.translation)]) });
            feedbackTimer = setTimeout(showPrompt, 3000);
        } catch (error) {
            if (current === interaction) {
                showError(error);
            }
        } finally {
            if (current === interaction) {
                interaction.controller.abort();
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
        if (contextChanged || credentialsChanged || storageSelectionChanged) {
            completed = undefined;
            if (!current) return;
            if (current.committed) {
                invalidate();
                showPrompt();
            } else {
                inputChanged(current.input);
            }
        }
    });
});
