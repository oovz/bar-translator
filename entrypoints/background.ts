/** Omnibox previews, permission feedback, and explicitly selected actions. */
import { translateWithFallback } from '@/services/index';
import { getServiceDefinition } from '@/services/base';
import { t } from '@/utils/i18n';
import { getSetup, isSetupStorageChange, reconcileSetupAccess } from '@/utils/storage';
import { parseOmniboxInput, formatSuggestionDescription, formatErrorDescription, escapeXml, browserDescription } from '@/utils/omnibox-parser';
import { copyToClipboard } from '@/utils/clipboard';
import { hasCopyAccess, hasInstanceAccess, removeCopyAccess, COPY_PERMISSIONS } from '@/utils/permissions';
import { TranslationError } from '@/utils/errors';
import type { UserPreferences, TranslationSetup, TranslationWarning, TranslationErrorCode } from '@/src/types';

const DEBOUNCE_DELAY = 300;

type Suggest = (suggestions: chrome.omnibox.SuggestResult[]) => void;
interface CompletedTranslation {
    input: string;
    context: string;
    translation: string;
    instanceId: string;
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
function translationContext(input: string, setup: TranslationSetup) {
    const preferences = setup.preferences;
    const parsed = parseOmniboxInput(input, preferences);
    if (parsed.isLanguageQuery) return;
    const params = {
        text: parsed.text,
        sourceLang: parsed.sourceLang || 'auto',
        targetLang: parsed.targetLang || preferences.defaultTargetLang,
    };
    return {
        params,
        identity: JSON.stringify([params, languageContext(preferences), preferences.fallbackOrder, setup.copyEnabled,
            setup.instances.map(instance => ({
                ...instance, ...('name' in instance ? { name: undefined } : {}),
                ...('credential' in instance ? { credential: instance.credential && { key: instance.credential.key, tier: instance.credential.tier } } : {}),
            })),
        ]),
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
        INSTANCE_LANGUAGE_UNSUPPORTED: 'providerLanguageUnsupported',
        INSTANCE_TEXT_TOO_LONG: 'providerTextTooLong',
        WEB_REQUEST_FAILED: 'providerResponseError',
    };
    const message = t(keys[issue.code] ?? 'omniboxAllFailed');
    const name = issue.instanceName ?? (issue.serviceId ? getServiceDefinition(issue.serviceId).name : undefined);
    return name ? `${name}: ${message}` : message;
}

function setDefaultSuggestion(suggestion: { description: string }) {
    // Firefox does not refresh the current default row. Keep it as stable guidance;
    // completed results and errors are delivered in the single suggestion batch.
    if (import.meta.env.FIREFOX) return Promise.resolve();
    return browser.omnibox.setDefaultSuggestion({ description: browserDescription(suggestion.description) });
}

export default defineBackground(() => {
    let current: Interaction | undefined;
    let completed: CompletedTranslation | undefined;
    let defaultSettingsInput: string | undefined;
    const actions = new Map<string, 'copy' | 'settings' | 'none'>();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

    void reconcileSetupAccess().catch(() => console.error('[Background] Could not reconcile saved access'));

    function showPrompt() {
        if (import.meta.env.FIREFOX) {
            return browser.omnibox.setDefaultSuggestion({ description: t('omniboxFirefoxPrompt') });
        }
        return setDefaultSuggestion({ description: t('omniboxSuggestion') });
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
        interaction.suggest?.(rows.map(row => ({ ...row, description: browserDescription(row.description) })));
        interaction.suggest = undefined;
        interaction.presented = true;
    }
    async function showError(error: unknown, interaction?: Interaction) {
        const issue = error instanceof TranslationError ? error : undefined;
        await setDefaultSuggestion({
            description: formatErrorDescription(issue ? issueMessage(issue) : t(interaction ? 'omniboxAllFailed' : 'omniboxCopyFailed')),
        });
        if (interaction && isCurrent(interaction)) {
            if (issue && needsSettings(issue)) defaultSettingsInput = interaction.input;
            const warnings = issue?.warnings ?? [];
            const rows = warningRows(warnings.filter(warning => warning.code !== issue?.code || warning.instanceId !== issue?.instanceId));
            if (import.meta.env.FIREFOX) {
                rows.unshift(actionRow(issue && needsSettings(issue) ? 'settings' : 'none',
                    issue ? issueMessage(issue) : t('omniboxAllFailed')));
            }
            if (issue && needsSettings(issue)) rows.unshift(actionRow('settings', t('omniboxSettingsAction')));
            sendSuggestions(interaction, rows);
        }
    }
    async function preview(interaction: Interaction) {
        try {
            const setup = await getSetup();
            if (!isCurrent(interaction)) return;
            const context = translationContext(interaction.input, setup);
            if (!context) {
                await showPrompt();
                if (isCurrent(interaction)) sendSuggestions(interaction, []);
                return;
            }
            const result = await translateWithFallback({ ...context.params, signal: interaction.controller.signal }, setup);
            const canCopy = setup.copyEnabled && await hasCopyAccess();
            if (isCurrent(interaction) && !interaction.committed) {
                await setDefaultSuggestion({ description: formatSuggestionDescription(result.translation) });
                if (!isCurrent(interaction)) return;
                completed = { input: interaction.input, context: context.identity, translation: result.translation, instanceId: result.instanceId };
                sendSuggestions(interaction, [
                    ...(import.meta.env.FIREFOX ? [actionRow(canCopy ? 'copy' : 'none', result.translation)] : []),
                    actionRow(canCopy ? 'copy' : 'settings', t(canCopy ? 'omniboxCopyAction' : setup.copyEnabled ? 'omniboxCopyPermissionRequired' : 'omniboxCopyOff')),
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
        setDefaultSuggestion({ description: t('omniboxTranslating') });
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
            const setup = await getSetup();
            if (!isCurrent(interaction)) return;
            if (translationContext(result.input, setup)?.identity !== result.context) {
                invalidate(); showPrompt(); return;
            }
            const instance = setup.instances.find(candidate => candidate.id === result.instanceId);
            if (!setup.copyEnabled || !instance || !setup.preferences.fallbackOrder.includes(instance.id)) return;
            const [canCopy, canUseProvider] = await Promise.all([hasCopyAccess(), hasInstanceAccess(instance)]);
            if (!isCurrent(interaction) || !canCopy || !canUseProvider) return;
            const copied = await copyToClipboard(result.translation, interaction.controller.signal);
            if (!isCurrent(interaction)) return;
            if (!copied) throw new Error(t('omniboxCopyFailed'));
            setDefaultSuggestion({ description: t('omniboxCopied', [escapeXml(result.translation)]) });
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
        if (!isSetupStorageChange(changes, area)) return;
        // Invalidate synchronously; a slow storage read cannot leave an old copy eligible.
        refreshPreview();
        void reconcileSetupAccess().catch(() => console.error('[Background] Could not refresh settings or release access'));
    });
    chrome.runtime.onInstalled.addListener(async details => {
        if (details.reason === 'install') await chrome.runtime.openOptionsPage();
    });
});
