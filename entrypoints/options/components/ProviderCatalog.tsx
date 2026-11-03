import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import { getProviderName, supportsMultipleInstances } from '@/utils/instances';
import { requestInstanceAccess } from '@/utils/permissions';
import { SERVICE_IDS, type ServiceId, type SingletonInstance } from '@/src/types';
import { InstanceEditor } from './InstanceEditor';
import { addEnabledSingleton } from '../hooks/enableSavedInstance';
import { DisclosureChevron, ServiceRow } from './ServiceRow';
import type { ConfigurableInstance } from './instance-model';
import type { ServiceRowView, ServiceRowActions } from './ServiceRow';

const providerDescriptions: Record<ServiceId, string> = {
    'google-web': 'googleProviderDescription',
    lingva: 'lingvaProviderDescription',
    deepl: 'deepLProviderDescription',
    libretranslate: 'libreProviderDescription',
};

const providers: readonly Provider[] = SERVICE_IDS.map(id => ({ id, name: getProviderName(id), description: providerDescriptions[id] }));

interface CatalogProps { view: ServiceRowView; actions: ServiceRowActions; }
interface Provider { id: ServiceId; name: string; description: string; }

export function ProviderCatalog({ view, actions }: CatalogProps) {
    const { pending, error, clearError, addFixedProvider } = useFixedProviderActivation(actions);
    const addProvider = (provider: Provider) => {
        clearError();
        if (supportsMultipleInstances(provider.id)) actions.add(provider.id);
        else void addFixedProvider(provider.id);
    };
    return <div class="provider-catalog">
        {error && <div class="feedback feedback-error" role="alert">{error}</div>}
        <ul class="service-list" id="available-providers" aria-labelledby="available-providers-heading">
            {view.configured.filter(instance => !view.setup.preferences.fallbackOrder.includes(instance.id)).map(instance =>
                <ServiceRow key={`saved:${instance.id}`} instance={instance} view={view} actions={actions} />)}
            {providers.filter(provider => supportsMultipleInstances(provider.id) ||
                !view.setup.preferences.fallbackOrder.includes(provider.id)).map(provider =>
                <ProviderChoice key={`provider:${provider.id}`} provider={provider} view={view} actions={actions}
                    pending={pending !== null} onAdd={() => addProvider(provider)} />)}
        </ul>
    </div>;
}

function useFixedProviderActivation(actions: ServiceRowActions) {
    const [pending, setPending] = useState<ServiceId | null>(null);
    const [error, setError] = useState('');
    const pendingRequest = useRef<AbortController | null>(null);
    useLayoutEffect(() => () => pendingRequest.current?.abort(), []);
    const addFixedProvider = async (providerId: 'google-web' | 'lingva') => {
        if (pendingRequest.current) return;
        const instance: SingletonInstance = { id: providerId, providerId };
        const controller = new AbortController();
        pendingRequest.current = controller;
        setPending(providerId);
        try {
            // Request access in the click's gesture, before awaiting storage.
            const permission = requestFixedProviderAccess(instance);
            await addEnabledSingleton(instance, permission, actions.updateSetup, controller.signal);
            if (!controller.signal.aborted) actions.requestFocus({ id: instance.id });
        } catch (reason) {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('settingsSaveFailed'));
        } finally {
            pendingRequest.current = null;
            if (!controller.signal.aborted) setPending(null);
        }
    };
    return { pending, error, clearError: () => setError(''), addFixedProvider };
}

function requestFixedProviderAccess(instance: SingletonInstance) {
    try { return requestInstanceAccess(instance); }
    catch { throw new Error(t('permissionDenied')); }
}

function ProviderChoice({ provider, view, actions, pending, onAdd }: CatalogProps & {
    provider: Provider; pending: boolean; onAdd: () => void;
}) {
    const multiple = supportsMultipleInstances(provider.id);
    const draft = supportsMultipleInstances(provider.id) ? view.drafts[provider.id] : undefined;
    const instances = view.configured.filter(instance => instance.providerId === provider.id);
    const expanded = Boolean(draft && view.expandedIds[draft.id]);
    return <li class="service-item" data-provider={provider.id} data-catalog-provider={provider.id}>
        <ProviderChoiceHeading provider={provider} draft={draft} count={instances.length} multiple={multiple}
            expanded={expanded} pending={pending} onAdd={onAdd} setExpanded={actions.setExpanded} />
        {multiple && <div id={`provider-setup-${provider.id}`} role="group" aria-label={provider.name} hidden={!expanded}>
            {draft && <DraftEditor draft={draft} view={view} actions={actions} />}
        </div>}
    </li>;
}

function ProviderChoiceHeading({ provider, draft, count, multiple, expanded, pending, onAdd, setExpanded }: {
    provider: Provider; draft: ConfigurableInstance | undefined; count: number; multiple: boolean;
    expanded: boolean; pending: boolean; onAdd: () => void; setExpanded: ServiceRowActions['setExpanded'];
}) {
    const hint = count ? t('providerConfiguredCount', [String(count)]) : '';
    return <div class="service-row">
        {draft
            ? <button class="service-disclosure" aria-label={t('showServiceDetails', [provider.name])} aria-expanded={expanded}
                aria-controls={`provider-setup-${provider.id}`} onClick={() => setExpanded(draft.id, !expanded)}>
                <span class="service-info"><ProviderSummary provider={provider} hint={hint} /></span>
                <DisclosureChevron expanded={expanded} />
            </button>
            : <span class="service-info"><ProviderSummary provider={provider} hint={hint} /></span>}
        <button class="btn btn-sm" data-action="add-provider" disabled={pending}
            aria-controls={multiple ? `provider-setup-${provider.id}` : undefined}
            onClick={onAdd}>{t(count ? 'addAnother' : 'addProvider')}</button>
    </div>;
}

function ProviderSummary({ provider, hint }: { provider: Provider; hint: string }) {
    return <>
        <span class="service-name">{provider.name}</span>
        <span class="setting-hint">{t(provider.description)}</span>
        {hint && <span class="setting-hint">{hint}</span>}
    </>;
}

function DraftEditor({ draft, view, actions }: CatalogProps & { draft: ConfigurableInstance }) {
    const reportBlocked = useCallback((blocked: boolean) => actions.setBlocked(draft.id, blocked), [actions.setBlocked, draft.id]);
    const saved = view.setup.instances.find(instance => instance.id === draft.id);
    const instance = saved && 'name' in saved ? saved : draft;
    const close = () => actions.closeDraft(draft.providerId);
    return <InstanceEditor instance={instance} isAdding isNew={!saved} replaces={!saved && draft.providerId === 'deepl' ? view.replacedDefault : undefined}
        enabled={view.setup.preferences.fallbackOrder.includes(instance.id)} allowed={Boolean(view.access[instance.id])}
        transitioning={view.busy === instance.id} onTransitionBlockedChange={reportBlocked}
        onCancel={close} updateSetup={actions.updateSetup} />;
}

