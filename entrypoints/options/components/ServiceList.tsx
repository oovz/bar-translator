import { useCallback, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import type { TranslationInstance } from '@/src/types';
import { groupInstances } from './instance-model';
import type { FocusRequest, ServiceListProps } from './instance-model';
import { ServiceRow } from './ServiceRow';
import { ProviderCatalog } from './ProviderCatalog';
import { useInstanceAccess, useInstanceSelection, useInstancePriority, removeConfiguredInstance, useInstanceFocus, useUnsavedChangesGuard } from '../hooks/useServiceList';
import { useInstanceConnections } from '../hooks/useInstanceConnections';

export function ServiceList({ setup, updateSetup }: ServiceListProps) {
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
    const requestFocus = useCallback((request: FocusRequest) => setFocusRequest(request), []);
    const announce = useCallback((message: string) => setStatus(message), []);
    const selection = useInstanceSelection(setup, requestFocus);
    const { expandedIds, setExpanded, blockedIds, setBlocked, drafts, closeDraft, replacedDefault, add } = selection;
    const { access, setAccess, anyAccess, setAnyAccess } = useInstanceAccess(setup.instances, setError);
    const { busy, setBusy, connectionFeedback, toggle, grantAccess, releaseAccess, cleanAccess } = useInstanceConnections(setup, updateSetup,
        { blockedIds, setError, setAccess, setAnyAccess, requestFocus, announce });
    const { enabledIds, enabled, configured } = groupInstances(setup);
    const { serviceListRef, move } = useInstancePriority(enabledIds, updateSetup);
    const remove = (instance: TranslationInstance) => removeConfiguredInstance(instance,
        { setup, updateSetup, setBusy, setError, cleanAccess, requestFocus, announce, expanded: expandedIds[instance.id] ? instance.id : null,
            setExpanded: () => setExpanded(instance.id, false) });

    useInstanceFocus(focusRequest, setFocusRequest, setup, busy);
    const hasUnsavedChanges = Object.keys(drafts).length > 0 || Object.values(blockedIds).some(Boolean);
    useUnsavedChangesGuard(hasUnsavedChanges);

    const view = { setup, drafts, configured, access, anyAccess, enabled, expandedIds, busy, blockedIds, replacedDefault };
    const actions = { releaseAccess, grantAccess, move, add, setExpanded, toggle, remove, setBlocked, closeDraft, requestFocus, updateSetup };
    const row = (instance: TranslationInstance, index?: number) =>
        <ServiceRow key={instance.id} instance={instance} index={index} view={view} actions={actions} />;

    return <div class="section" id="providers" tabIndex={-1}>
        <div class="section-title">{t('sectionTranslationServices')}</div>
        <div class="section-description">{t('servicesWorkflowDesc')}</div>
        {status && <div class="sr-only" aria-live="polite" aria-atomic="true">{status}</div>}
        {error && <div class="feedback feedback-error" role="alert">{error}</div>}
        {connectionFeedback && <ConnectionFeedback {...connectionFeedback} />}
        <h3 class="service-group-title" id="activated-instances-heading">{t('activatedInstances')}</h3>
        <ul class="service-list" id="instance-priority" aria-labelledby="activated-instances-heading" ref={serviceListRef}>
            {enabled.map((instance, index) => row(instance, index))}
        </ul>
        {!enabled.length && <div class="feedback feedback-warning">{t('noServicesEnabled')}</div>}
        <h3 class="service-group-title" id="available-providers-heading">{t('availableProviders')}</h3>
        <ProviderCatalog view={view} actions={actions} />
    </div>;
}

function ConnectionFeedback({ connected, name }: { connected: boolean; name: string }) {
    return <div class={`feedback ${connected ? 'feedback-success' : 'feedback-warning'}`} role="status">
        {t(connected ? 'instanceConnected' : 'customConnectionFailed', [name])}
    </div>;
}
