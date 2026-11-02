import { t } from '@/utils/i18n';
import { getInstanceName } from '@/utils/instances';
import { getInstanceOrigins } from '@/utils/permissions';
import type { DeepLInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import { InstanceEditor } from './InstanceEditor';
import { usesCustomServer, needsCredential } from './instance-model';
import type { ConfigurableInstance, ServiceListProps } from './instance-model';

interface ServiceRowView {
    setup: TranslationSetup;
    draft: ConfigurableInstance | null;
    placeholderIds: Set<string>;
    configured: TranslationInstance[];
    access: Record<string, boolean>;
    anyAccess: Record<string, boolean>;
    enabled: TranslationInstance[];
    expanded: string | null;
    busy: string | null;
    editorTransitionBlocked: boolean;
    replacedDefault: DeepLInstance | undefined;
}

interface ServiceRowActions {
    releaseAccess: (instance: TranslationInstance) => Promise<void>;
    grantAccess: (instance: TranslationInstance) => void;
    move: (id: string, offset: number) => void;
    add: (provider: 'deepl' | 'libretranslate') => void;
    setExpanded: (id: string | null) => void;
    toggle: (instance: TranslationInstance) => void;
    remove: (instance: ConfigurableInstance) => Promise<void>;
    setEditorTransitionBlocked: (blocked: boolean) => void;
    setDraft: (instance: ConfigurableInstance | null) => void;
    setReplacedDefault: (instance: DeepLInstance | undefined) => void;
    updateSetup: ServiceListProps['updateSetup'];
}

interface ServiceRowProps {
    instance: TranslationInstance;
    index?: number;
    view: ServiceRowView;
    actions: ServiceRowActions;
}

export function ServiceRow({ instance, index, view, actions }: ServiceRowProps) {
    const { setup, draft, placeholderIds, configured, access, enabled, expanded, busy, replacedDefault } = view;
    const { setExpanded, setEditorTransitionBlocked, setDraft, setReplacedDefault, updateSetup } = actions;
    const isEnabled = index !== undefined;
    const configurable = 'name' in instance;
    const isNew = draft?.id === instance.id && !setup.instances.some(saved => saved.id === instance.id);
    const isPlaceholder = placeholderIds.has(instance.id);
    const hasConfiguration = configured.some(saved => saved.providerId === instance.providerId);
    const name = getInstanceName(instance);
    const needsKey = needsCredential(instance);
    const ready = Boolean(access[instance.id]) && !needsKey;
    const sharedGrant = enabled.some(other => getInstanceOrigins(other).some(origin => getInstanceOrigins(instance).includes(origin)));
    const presentation = { instance, index, isEnabled, configurable, isNew, isPlaceholder, name, ready };
    return <li key={instance.id} class={`service-item ${isEnabled ? 'enabled' : 'disabled-item'}`} data-id={instance.id} data-provider={instance.providerId}>
        <div class="service-row">
            {isEnabled && <><span class="drag-handle" title={t('dragToReorder')}>⋮⋮</span><span class="service-index">{index + 1}</span></>}
            <ServiceInfo {...presentation} view={view} />
            <ServiceActions {...presentation} view={view} actions={actions} sharedGrant={sharedGrant} hasConfiguration={hasConfiguration} />
        </div>
        {configurable && expanded === instance.id && <InstanceEditor instance={instance} enabled={isEnabled} allowed={Boolean(access[instance.id])}
            isNew={isNew} replaces={isNew ? replacedDefault : undefined}
            transitioning={busy === instance.id} onTransitionBlockedChange={setEditorTransitionBlocked}
            onCancel={() => { setDraft(null); setReplacedDefault(undefined); setExpanded(null); }} updateSetup={updateSetup} />}
    </li>;

}

interface RowPresentation {
    instance: TranslationInstance;
    index: number | undefined;
    isEnabled: boolean;
    configurable: boolean;
    isNew: boolean;
    isPlaceholder: boolean;
    name: string;
    ready: boolean;
}

type ServiceInfoProps = RowPresentation & { view: ServiceRowView };

function ServiceInfo(props: ServiceInfoProps) {
    return <div class="service-info">
        <ServiceHeading {...props} />
        <InstanceDescription {...props} />
        <EndpointWarning {...props} />
        <InstanceStatus {...props} />
    </div>;
}

function ServiceHeading({ name, isNew, index, isEnabled, ready }: ServiceInfoProps) {
    return <div class="service-heading"><span class="service-name">{name}</span>
        {isNew && <span class="badge badge-muted">{t('draftInstance')}</span>}
        {index === 0 && <span class="badge badge-primary">{t('primary')}</span>}
        {isEnabled && ready && <span class="badge badge-success" aria-label={t('providerReady')}>✓</span>}
    </div>;
}

function InstanceDescription({ instance, isPlaceholder, isEnabled, name }: ServiceInfoProps) {
    if (isPlaceholder) return <div class="setting-hint">{t(instance.providerId === 'deepl' ? 'deepLProviderDescription' : 'libreProviderDescription')}</div>;
    if ('name' in instance) return <ConfiguredDescription instance={instance} name={name} />;
    if (isEnabled) return null;
    return <div class="setting-hint">{t(instance.providerId === 'google-web' ? 'googleProviderDescription' : 'lingvaProviderDescription')}</div>;
}

function ConfiguredDescription({ instance, name }: { instance: ConfigurableInstance; name: string }) {
    if (instance.providerId === 'libretranslate') return <div class="setting-hint">{`LibreTranslate · ${instance.endpoint}`}</div>;
    if (name !== 'DeepL') return <div class="setting-hint">DeepL</div>;
    return !instance.credential?.key ? <div class="setting-hint">{t('keyNeeded')}</div> : null;
}

function EndpointWarning({ instance, isPlaceholder, view }: ServiceInfoProps) {
    if (isPlaceholder || instance.providerId !== 'libretranslate' || !instance.endpoint.startsWith('http:') || view.expanded === instance.id) return null;
    return <div class="setting-hint http-warning">{t('httpEndpointWarning')}</div>;
}

function InstanceStatus({ instance, isEnabled, ready, view }: ServiceInfoProps) {
    if (!isEnabled || ready) return null;
    return <div class="setting-hint service-status">{!view.access[instance.id] ? t('providerPermissionRequired') : t('keyNeeded')}</div>;
}

type ServiceActionsProps = RowPresentation & {
    view: ServiceRowView;
    actions: ServiceRowActions;
    sharedGrant: boolean;
    hasConfiguration: boolean;
};

function ServiceActions(props: ServiceActionsProps) {
    return <div class="service-actions">
        <AccessActions {...props} />
        <ReorderActions {...props} />
        <ConfigureAction {...props} />
        <ToggleAction {...props} />
        <DeleteAction {...props} />
    </div>;
}

function AccessActions({ instance, isEnabled, name, view, actions, sharedGrant }: ServiceActionsProps) {
    const { anyAccess, access, busy } = view;
    if (!isEnabled) return anyAccess[instance.id] && !sharedGrant
        ? <button class="btn btn-sm" disabled={busy !== null} onClick={() => void actions.releaseAccess(instance)}>{t('removeAccess')}</button>
        : null;
    if (access[instance.id]) return null;
    const custom = usesCustomServer(instance);
    return <button class="btn btn-sm" disabled={busy !== null}
        data-action={custom ? 'connect-instance' : 'grant-access'}
        aria-label={custom ? t('connectInstance', [name]) : undefined}
        onClick={() => actions.grantAccess(instance)}>{t(custom ? 'connect' : 'grantAccess')}</button>;
}

function ReorderActions({ instance, index, isEnabled, name, view, actions }: ServiceActionsProps) {
    if (!isEnabled) return null;
    return <>
        <button class="btn btn-sm" aria-label={t('moveInstanceUp', [name])} disabled={index === 0 || view.busy !== null} onClick={() => actions.move(instance.id, -1)}>↑</button>
        <button class="btn btn-sm" aria-label={t('moveInstanceDown', [name])} disabled={index === view.enabled.length - 1 || view.busy !== null} onClick={() => actions.move(instance.id, 1)}>↓</button>
    </>;
}

function ConfigureAction(props: ServiceActionsProps) {
    const { instance, isPlaceholder, isNew, name, view, actions, hasConfiguration } = props;
    if (!('name' in instance)) return null;
    if (isPlaceholder) return <button class="btn btn-sm btn-primary" data-action="add-provider"
        aria-label={t(hasConfiguration ? 'addProviderInstance' : 'configureNamedInstance', [name])} disabled={view.busy !== null || view.draft !== null}
        onClick={() => actions.add(instance.providerId)}>{t(hasConfiguration ? 'addInstance' : 'configureInstance')}</button>;
    if (isNew) return null;
    return <ExistingConfigurationAction {...props} />;
}

function ExistingConfigurationAction({ instance, name, view, actions }: ServiceActionsProps) {
    const expanded = view.expanded === instance.id;
    return <button class="btn btn-sm" aria-label={t('configureNamedInstance', [name])} aria-expanded={expanded} aria-controls={`instance-${instance.id}`}
        disabled={view.busy !== null || (view.draft !== null && view.draft.id !== instance.id)}
        onClick={() => actions.setExpanded(expanded ? null : instance.id)}>{t('configureInstance')}</button>;
}

function ToggleAction({ instance, isNew, isPlaceholder, isEnabled, name, view, actions }: ServiceActionsProps) {
    if (isNew || isPlaceholder) return null;
    const labels = toggleLabels(instance, isEnabled);
    return <button class={`btn btn-sm ${!isEnabled ? 'btn-primary' : ''}`}
        data-action={labels.action} aria-label={t(labels.label, [name])}
        disabled={view.busy !== null || (view.expanded === instance.id && view.editorTransitionBlocked)}
        onClick={() => actions.toggle(instance)}>{labels.text}</button>;
}

function toggleLabels(instance: TranslationInstance, isEnabled: boolean) {
    if (isEnabled) return { action: 'disable-instance', label: 'disableInstance', text: '✕' };
    return usesCustomServer(instance)
        ? { action: 'connect-instance', label: 'connectInstance', text: t('connect') }
        : { action: 'enable-instance', label: 'enableInstance', text: '+' };
}

function DeleteAction({ instance, isNew, isPlaceholder, name, view, actions }: ServiceActionsProps) {
    if (!('name' in instance) || isNew || isPlaceholder) return null;
    return <button class="btn btn-sm" aria-label={t('deleteNamedInstance', [name])} disabled={view.busy !== null}
        onClick={() => void actions.remove(instance)}>{t('deleteInstance')}</button>;
}
