/** Omnibox previews, permission feedback, and explicitly selected actions. */
import { translateWithFallback } from '@/services/index';
import { getServiceDefinition } from '@/services/base';
import { t } from '@/utils/i18n';
import { getPreferences, getApiKeys } from '@/utils/storage';
import { parseOmniboxInput, formatSuggestionDescription, formatErrorDescription, escapeXml } from '@/utils/omnibox-parser';
import { copyToClipboard } from '@/utils/clipboard';
import { hasCopyAccess, hasProviderAccess, removeCopyAccess, removeProviderAccess, COPY_PERMISSIONS } from '@/utils/permissions';
import { TranslationError } from '@/utils/errors';
import type { UserPreferences, StoredApiKeys, ServiceId, TranslationWarning, TranslationErrorCode } from '@/src/types';

const DEBOUNCE_DELAY = 300;

type Suggest = (suggestions: chrome.omnibox.SuggestResult[]) => void;
interface CompletedTranslation {
    input: string;
    context: string;
    translation: string;
    serviceId: ServiceId;
}
interface Interaction {
    input: string;
    committed: boolean;
    controller: AbortController;
    suggest?: Suggest;
    presented?: boolean;
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
function needsSettings(issue: TranslationWarning) {
    return ['PERMISSION_REQUIRED', 'API_KEY_REQUIRED', 'INVALID_API_KEY', 'NO_SERVICES_ENABLED'].includes(issue.code);
}
function issueMessage(issue: TranslationWarning): string {
    const keys: Partial<Record<TranslationErrorCode, string>> = {
        PERMISSION_REQUIRED: 'providerPermissionRequired',
        API_KEY_REQUIRED: 'providerMissingKey',
        INVALID_API_KEY: 'providerInvalidKey',
        NO_SERVICES_ENABLED: 'omniboxNoProviders',
        QUOTA_EXCEEDED: 'providerQuotaExceeded',
        TIMEOUT: 'providerTimedOut',
        NETWORK_ERROR: 'providerNetworkError',
        SERVICE_UNAVAILABLE: 'providerUnavailable',
        RATE_LIMITED: 'providerUnavailable',
        WEB_REQUEST_FAILED: 'providerResponseError',
    };
    const message = t(keys[issue.code] ?? 'omniboxAllFailed');
    return issue.serviceId ? `${getServiceDefinition(issue.serviceId).name}: ${message}` : message;
}

export default defineBackground(() => {
    let current: Interaction | undefined;
    let completed: CompletedTranslation | undefined;
    let defaultSettingsInput: string | undefined;
    const actions = new Map<string, 'copy' | 'settings' | 'none'>();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

    void getPreferences().catch(() => console.error('[Background] Could not load preferences'));

    function showPrompt() {
        return browser.omnibox.setDefaultSuggestion({ description: t('omniboxSuggestion') });
    }
    function clearResults() {
        completed = undefined;
        defaultSettingsInput = undefined;
        actions.clear();
    }
    function invalidate() {
        clearTimeout(debounceTimer);
        clearTimeout(feedbackTimer);
        const interaction = current;
        current = undefined;
        interaction?.controller.abort();
    }
    function isCurrent(interaction: Interaction) {
        return current === interaction && !interaction.controller.signal.aborted;
    }
    function actionRow(kind: 'copy' | 'settings' | 'none', label: string): chrome.omnibox.SuggestResult {
        // Chrome also displays content in the address bar when a row is selected.
        // Keep it readable, and dispatch only actions issued for this preview.
        let content = label;
        while (content === current?.input || actions.has(content)) content = `${t('extName')}: ${content}`;
        actions.set(content, kind);
        return { content, description: `<dim>${escapeXml(label)}</dim>` };
    }
    function warningRows(warnings: readonly TranslationWarning[]) {
        return warnings.map(warning => {
            const label = t('omniboxWarning', [issueMessage(warning)]);
            const description = needsSettings(warning)
                ? `${label} — ${t('omniboxSettingsAction')}` : label;
            return actionRow(needsSettings(warning) ? 'settings' : 'none', description);
        });
    }
    function sendSuggestions(interaction: Interaction, rows: chrome.omnibox.SuggestResult[]) {
        // Chrome accepts one set per input request, including an empty set.
        interaction.suggest?.(rows);
        interaction.suggest = undefined;
        interaction.presented = true;
    }
    async function showError(error: unknown, interaction?: Interaction) {
        const issue = error instanceof TranslationError ? error : undefined;
        await browser.omnibox.setDefaultSuggestion({
            description: formatErrorDescription(issue ? issueMessage(issue) : t(interaction ? 'omniboxAllFailed' : 'omniboxCopyFailed')),
        });
        if (interaction && isCurrent(interaction)) {
            if (issue && needsSettings(issue)) defaultSettingsInput = interaction.input;
            const warnings = issue?.warnings ?? [];
            const rows = warningRows(warnings.filter(warning => warning.code !== issue?.code || warning.serviceId !== issue?.serviceId));
            if (issue && needsSettings(issue)) rows.unshift(actionRow('settings', t('omniboxSettingsAction')));
            sendSuggestions(interaction, rows);
        }
    }
    async function preview(interaction: Interaction) {
        try {
            const preferences = await getPreferences();
            const apiKeys = await getApiKeys();
            if (!isCurrent(interaction)) return;
            const context = translationContext(interaction.input, preferences, apiKeys);
            if (!context) {
                await showPrompt();
                if (isCurrent(interaction)) sendSuggestions(interaction, []);
                return;
            }
            const result = await translateWithFallback({ ...context.params, signal: interaction.controller.signal }, preferences, apiKeys);
            const canCopy = await hasCopyAccess();
            if (isCurrent(interaction) && !interaction.committed) {
                await browser.omnibox.setDefaultSuggestion({ description: formatSuggestionDescription(result.translation) });
                if (!isCurrent(interaction)) return;
                completed = { input: interaction.input, context: context.identity, translation: result.translation, serviceId: result.serviceId };
                sendSuggestions(interaction, [
                    actionRow(canCopy ? 'copy' : 'settings', t(canCopy ? 'omniboxCopyAction' : 'omniboxCopyOff')),
                    ...warningRows(result.warnings),
                ]);
            }
        } catch (error) {
            if (isCurrent(interaction) && !interaction.committed) await showError(error, interaction);
        }
    }
    function inputChanged(input: string, suggest?: Suggest) {
        clearResults();
        invalidate();
        const interaction: Interaction = { input, committed: false, controller: new AbortController(), suggest };
        current = interaction;
        if (!input.trim()) {
            void Promise.resolve(showPrompt()).then(() => { if (isCurrent(interaction)) sendSuggestions(interaction, []); });
            return;
        }
        browser.omnibox.setDefaultSuggestion({ description: t('omniboxTranslating') });
        debounceTimer = setTimeout(() => { void preview(interaction); }, DEBOUNCE_DELAY);
    }

    showPrompt();
    browser.omnibox.onInputStarted.addListener(() => { clearResults(); invalidate(); showPrompt(); });
    browser.omnibox.onInputCancelled.addListener(() => {
        // Chrome may cancel keyword mode before delivering the accepted result/action.
        invalidate();
        showPrompt();
    });
    browser.omnibox.onInputChanged.addListener(inputChanged);
    browser.omnibox.onInputEntered.addListener(async input => {
        clearTimeout(debounceTimer);
        if (current?.committed) return;
        const action = actions.get(input) ?? (defaultSettingsInput === input ? 'settings' : undefined);
        const result = completed;
        clearResults();
        invalidate();
        if (action === 'settings') { await chrome.runtime.openOptionsPage(); return; }
        if (action === 'none' || !result || (action !== 'copy' && result.input !== input)) return;
        const interaction: Interaction = { input: result.input, committed: true, controller: new AbortController() };
        current = interaction;
        try {
            const preferences = await getPreferences();
            const apiKeys = await getApiKeys();
            if (!isCurrent(interaction)) return;
            if (translationContext(result.input, preferences, apiKeys)?.identity !== result.context) {
                invalidate(); showPrompt(); return;
            }
            const [canCopy, canUseProvider] = await Promise.all([hasCopyAccess(), hasProviderAccess(result.serviceId)]);
            if (!isCurrent(interaction) || !canCopy || !canUseProvider) return;
            const copied = await copyToClipboard(result.translation, interaction.controller.signal);
            if (!isCurrent(interaction)) return;
            if (!copied) throw new Error(t('omniboxCopyFailed'));
            browser.omnibox.setDefaultSuggestion({ description: t('omniboxCopied', [escapeXml(result.translation)]) });
            feedbackTimer = setTimeout(showPrompt, 3000);
        } catch (error) {
            if (current === interaction) await showError(error);
        } finally {
            if (current === interaction) { interaction.controller.abort(); current = undefined; }
        }
    });

    function refreshPreview() {
        const interaction = current;
        clearResults();
        if (!interaction) return;
        // Once Chrome accepts the rows, it cannot replace them for this request.
        // Never prepare a different, invisible result behind an already shown row.
        if (interaction.committed || interaction.presented) { invalidate(); showPrompt(); }
        else inputChanged(interaction.input, interaction.suggest);
    }
    browser.permissions.onAdded.addListener(refreshPreview);
    browser.permissions.onRemoved.addListener(async removed => {
        refreshPreview();
        if (removed.permissions?.some(permission => COPY_PERMISSIONS.includes(permission)) && !await hasCopyAccess()) {
            try { await removeCopyAccess(); }
            catch { console.error('[Background] Could not release clipboard access'); }
        }
    });
    browser.storage.onChanged.addListener((changes, area) => {
        const preferenceChange = area === 'sync' ? changes.preferences : undefined;
        const previousPreferences = preferenceChange?.oldValue as Partial<UserPreferences> | undefined;
        const nextPreferences = preferenceChange?.newValue as Partial<UserPreferences> | undefined;
        if (preferenceChange) {
            const removed = previousPreferences?.fallbackOrder?.filter(id => !nextPreferences?.fallbackOrder?.includes(id)) ?? [];
            void Promise.all(removed.map(removeProviderAccess)).catch(() => console.error('[Background] Could not release provider access'));
        }
        const contextChanged = preferenceChange && (
            JSON.stringify(languageContext(previousPreferences)) !== JSON.stringify(languageContext(nextPreferences)) ||
            JSON.stringify(previousPreferences?.fallbackOrder) !== JSON.stringify(nextPreferences?.fallbackOrder)
        );
        const credentialsChanged = (area === 'sync' && changes.apiKeys) || (area === 'local' && changes.apiKeys_local);
        const storageSelectionChanged = area === 'local' && changes.credentialStorageType;
        if (contextChanged || credentialsChanged || storageSelectionChanged) refreshPreview();
    });
    chrome.runtime.onInstalled.addListener(async details => {
        if (details.reason === 'install') await chrome.runtime.openOptionsPage();
    });
});
