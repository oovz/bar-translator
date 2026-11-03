import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { t } from '@/utils/i18n';
import { getInstanceName, supportsMultipleInstances } from '@/utils/instances';
import { getInstanceOrigins } from '@/utils/permissions';
import type { DeepLInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import { InstanceEditor } from './InstanceEditor';
import { needsCredential, instanceTier } from './instance-model';
import type { ConfigurableInstance, FocusRequest, ServiceListProps } from './instance-model';

export interface ServiceRowView {
    setup: TranslationSetup;
    drafts: Partial<Record<'deepl' | 'libretranslate', ConfigurableInstance>>;
    configured: TranslationInstance[];
    access: Record<string, boolean>;
    anyAccess: Record<string, boolean>;
    enabled: TranslationInstance[];
    expandedIds: Record<string, boolean>;
    busy: string | null;
    blockedIds: Record<string, boolean>;
    replacedDefault: DeepLInstance | undefined;
}

export interface ServiceRowActions {
    releaseAccess: (instance: TranslationInstance) => Promise<void>;
    grantAccess: (instance: TranslationInstance) => void;
    move: (id: string, offset: number) => void;
    add: (provider: 'deepl' | 'libretranslate') => void;
    setExpanded: (id: string, expanded: boolean) => void;
    toggle: (instance: TranslationInstance) => void;
    remove: (instance: TranslationInstance) => Promise<void>;
    setBlocked: (id: string, blocked: boolean) => void;
    closeDraft: (provider: 'deepl' | 'libretranslate') => void;
    requestFocus: (request: FocusRequest) => void;
    updateSetup: ServiceListProps['updateSetup'];
}

interface ServiceRowProps {
    instance: TranslationInstance;
    index?: number;
    view: ServiceRowView;
    actions: ServiceRowActions;
}

export function DisclosureChevron({ expanded }: { expanded: boolean }) {
    return <span class="disclosure-chevron" aria-hidden="true" data-expanded={expanded}>
        <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
            <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    </span>;
}

export function ServiceRow({ instance, index, view, actions }: ServiceRowProps) {
    const { setup, access, enabled, expandedIds, busy } = view;
    const { setExpanded } = actions;
    const { confirming, setConfirming, deleteTrigger, dismissConfirmation } = useDeleteConfirmation();
    const isEnabled = setup.preferences.fallbackOrder.includes(instance.id);
    const configurable = supportsMultipleInstances(instance.providerId);
    const name = getInstanceName(instance);
    const ready = Boolean(access[instance.id]) && !needsCredential(instance);
    const sharedGrant = enabled.some(other => getInstanceOrigins(other).some(origin => getInstanceOrigins(instance).includes(origin)));
    const presentation = { instance, index, isEnabled, name, ready };
    return <li key={instance.id} tabIndex={-1} class={`service-item ${isEnabled ? 'enabled' : 'disabled-item'}`} data-id={instance.id} data-provider={instance.providerId}>
        <div class="service-row">
            {index !== undefined && <><span class="drag-handle" title={t('dragToReorder')}>⋮⋮</span><span class="service-index">{index + 1}</span></>}
            {configurable
                ? <button class="service-disclosure" aria-label={t('showServiceDetails', [name])} aria-expanded={Boolean(expandedIds[instance.id])}
                    aria-controls={`instance-panel-${instance.id}`} aria-describedby={`instance-summary-${instance.id}`} disabled={catalogOwns(instance.id, view) || busy === instance.id}
                    onClick={() => setExpanded(instance.id, !expandedIds[instance.id])}>
                    <ServiceInfo {...presentation} view={view} />
                    <DisclosureChevron expanded={Boolean(expandedIds[instance.id])} />
                </button>
                : <ServiceInfo {...presentation} view={view} />}
            <ServiceActions {...presentation} view={view} actions={actions} sharedGrant={sharedGrant}
                confirming={confirming} setConfirming={setConfirming} deleteTrigger={deleteTrigger} />
        </div>
        {confirming && <DeleteConfirmation instance={instance} name={name} view={view}
            onCancel={dismissConfirmation}
            onConfirm={() => { dismissConfirmation(); void actions.remove(instance); }} />}
        {configurable && <ServiceDetailsPanel instance={instance} view={view} actions={actions} />}
    </li>;
}

function useDeleteConfirmation() {
    const [confirming, setConfirming] = useState(false);
    const deleteTrigger = useRef<HTMLButtonElement>(null);
    const returnDeleteFocus = useRef(false);
    useLayoutEffect(() => {
        if (confirming || !returnDeleteFocus.current) return;
        returnDeleteFocus.current = false;
        deleteTrigger.current?.focus();
    }, [confirming]);
    const dismissConfirmation = () => { returnDeleteFocus.current = true; setConfirming(false); };
    return { confirming, setConfirming, deleteTrigger, dismissConfirmation };
}

function ServiceDetailsPanel({ instance, view, actions }: ServiceRowProps) {
    const reportBlocked = useCallback((blocked: boolean) => actions.setBlocked(instance.id, blocked), [instance.id, actions.setBlocked]);
    if (!('name' in instance) || catalogOwns(instance.id, view)) {
        return <div id={`instance-panel-${instance.id}`} hidden />;
    }
    return <div id={`instance-panel-${instance.id}`} hidden={!view.expandedIds[instance.id]}>
        {Object.hasOwn(view.expandedIds, instance.id) && <InstanceEditor instance={instance} enabled={view.setup.preferences.fallbackOrder.includes(instance.id)}
            allowed={Boolean(view.access[instance.id])} isNew={false} transitioning={view.busy === instance.id}
            onTransitionBlockedChange={reportBlocked} onCancel={() => actions.setExpanded(instance.id, false)} updateSetup={actions.updateSetup} />}
    </div>;
}

interface RowPresentation {
    instance: TranslationInstance;
    index: number | undefined;
    isEnabled: boolean;
    name: string;
    ready: boolean;
}

type ServiceInfoProps = RowPresentation & { view: ServiceRowView };

function ServiceInfo(props: ServiceInfoProps) {
    return <span class="service-info" id={`instance-summary-${props.instance.id}`}>
        <ServiceHeading {...props} />
        <InstanceDescription {...props} />
        <EndpointWarning {...props} />
        <InstanceStatus {...props} />
    </span>;
}

function ServiceHeading({ name, index }: ServiceInfoProps) {
    return <span class="service-heading"><span class="service-name">{name}</span>
        {index === 0 && <span class="badge badge-primary">{t('primary')}</span>}
    </span>;
}

function InstanceDescription({ instance }: ServiceInfoProps) {
    if ('name' in instance) return <ConfiguredDescription instance={instance} />;
    return <span class="setting-hint">{t(instance.providerId === 'google-web' ? 'googleProviderDescription' : 'lingvaProviderDescription')}</span>;
}

function ConfiguredDescription({ instance }: { instance: ConfigurableInstance }) {
    const detail = instance.providerId === 'libretranslate'
        ? `LibreTranslate · ${safeEndpointSummary(instance.endpoint)}`
        : `DeepL · API ${instanceTier(instance) === 'pro' ? 'Pro' : 'Free'}`;
    return <span class="setting-hint">{detail}</span>;
}

/** Show the recipient address without credentials, query strings or fragments. */
function safeEndpointSummary(endpoint: string) {
    try {
        const url = new URL(endpoint);
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch { return t('instanceEndpointInvalid'); }
}

function EndpointWarning({ instance, view }: ServiceInfoProps) {
    if (instance.providerId !== 'libretranslate' || !instance.endpoint.startsWith('http:') || view.expandedIds[instance.id]) return null;
    return <span class="setting-hint http-warning">{t('httpEndpointWarning')}</span>;
}

function InstanceStatus({ instance, isEnabled, ready }: ServiceInfoProps) {
    if (needsCredential(instance)) return <span class="setting-hint service-status">{t('keyNeeded')}</span>;
    if (!isEnabled) return <span class="setting-hint">{t('serviceOff')}</span>;
    if (!ready) return <span class="setting-hint service-status">{t('providerPermissionRequired')}</span>;
    if (!('credential' in instance)) return <span class="setting-hint">{t('providerReady')}</span>;
    return <span class="setting-hint">{instance.credential?.validated ? t('valid') : t('serviceNotTested')}</span>;
}

type ServiceActionsProps = RowPresentation & {
    view: ServiceRowView;
    actions: ServiceRowActions;
    sharedGrant: boolean;
    confirming: boolean;
    setConfirming: (confirming: boolean) => void;
    deleteTrigger: RefObject<HTMLButtonElement | null>;
};

function ServiceActions(props: ServiceActionsProps) {
    return <div class="service-actions">
        <AccessActions {...props} />
        <ReorderActions {...props} />
        {supportsMultipleInstances(props.instance.providerId) && <ToggleAction {...props} />}
        <DeleteAction {...props} />
    </div>;
}

function AccessActions({ instance, isEnabled, name, view, actions, sharedGrant }: ServiceActionsProps) {
    const { anyAccess, access, busy } = view;
    if (!isEnabled) return anyAccess[instance.id] && !sharedGrant
        ? <button class="btn btn-sm" disabled={busy !== null || catalogOwns(instance.id, view) || view.blockedIds[instance.id]} onClick={() => void actions.releaseAccess(instance)}>{t('removeAccess')}</button>
        : null;
    if (access[instance.id]) return null;
    return <button class="btn btn-sm" disabled={busy !== null || catalogOwns(instance.id, view) || view.blockedIds[instance.id]}
        data-action="grant-access" aria-label={t('grantInstanceAccess', [name])}
        onClick={() => actions.grantAccess(instance)}>{t('grantAccess')}</button>;
}

function ReorderActions({ instance, isEnabled, name, view, actions }: ServiceActionsProps) {
    if (!isEnabled) return null;
    const position = view.enabled.findIndex(candidate => candidate.id === instance.id);
    return <>
        <button class="btn btn-sm" aria-label={t('moveInstanceUp', [name])} disabled={position === 0 || view.busy !== null || view.blockedIds[instance.id]} onClick={() => actions.move(instance.id, -1)}>↑</button>
        <button class="btn btn-sm" aria-label={t('moveInstanceDown', [name])} disabled={position === view.enabled.length - 1 || view.busy !== null || view.blockedIds[instance.id]} onClick={() => actions.move(instance.id, 1)}>↓</button>
    </>;
}


function ToggleAction({ instance, isEnabled, name, view, actions }: ServiceActionsProps) {
    return <button class="btn btn-sm" aria-label={t(isEnabled ? 'disableInstance' : 'enableInstance', [name])}
        data-action={isEnabled ? 'disable-instance' : 'enable-instance'}
        disabled={view.busy !== null || catalogOwns(instance.id, view) || view.blockedIds[instance.id]}
        onClick={() => actions.toggle(instance)}>{t(isEnabled ? 'disable' : 'enable')}</button>;
}

function DeleteAction({ instance, name, view, confirming, setConfirming, deleteTrigger }: ServiceActionsProps) {
    if (confirming) return null;
    const blocked = view.busy !== null || catalogOwns(instance.id, view) || view.blockedIds[instance.id];
    return <button ref={deleteTrigger} class="btn btn-sm" data-action="delete-instance"
        aria-label={t('deleteNamedInstance', [name])} disabled={blocked}
        onClick={() => setConfirming(true)}>{t('deleteInstance')}</button>;
}

function DeleteConfirmation({ instance, name, view, onCancel, onConfirm }: {
    instance: TranslationInstance;
    name: string;
    view: ServiceRowView;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const confirm = useRef<HTMLButtonElement>(null);
    useLayoutEffect(() => { confirm.current?.focus(); }, []);
    const warningId = `delete-warning-${instance.id}`;
    const blocked = view.busy !== null || catalogOwns(instance.id, view) || view.blockedIds[instance.id];
    return <div class="delete-confirmation" role="group" aria-label={t('deleteConfirmationLabel', [name])}>
        <span id={warningId} class="delete-confirmation-text">{t('deleteConfirmation', [name])}</span>
        <span class="delete-confirmation-actions">
            <button class="btn btn-sm" data-action="cancel-delete" disabled={view.busy !== null} onClick={onCancel}>{t('cancel')}</button>
            <button ref={confirm} class="btn btn-sm btn-danger" data-action="confirm-delete"
                aria-describedby={warningId} disabled={blocked} onClick={onConfirm}>{t('deleteInstance')}</button>
        </span>
    </div>;
}

function catalogOwns(id: string, view: ServiceRowView) {
    return Object.values(view.drafts).some(draft => draft.id === id);
}
