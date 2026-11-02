import { useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import type { TranslationInstance } from '@/src/types';
import { groupInstances } from './instance-model';
import type { ConfigurableInstance, ServiceListProps } from './instance-model';
import { ServiceRow } from './ServiceRow';
import { useInstanceAccess, useInstanceSelection, useInstancePriority, removeConfiguredInstance } from '../hooks/useServiceList';
import { useInstanceConnections } from '../hooks/useInstanceConnections';

export function ServiceList({ setup, updateSetup }: ServiceListProps) {
    const [error, setError] = useState('');
    const selection = useInstanceSelection(setup);
    const { expanded, setExpanded, editorTransitionBlocked, setEditorTransitionBlocked, draft, setDraft, replacedDefault, setReplacedDefault, add } = selection;
    const { access, setAccess, anyAccess, setAnyAccess } = useInstanceAccess(setup.instances, setError);
    const { busy, setBusy, connectionFeedback, toggle, grantAccess, releaseAccess, cleanAccess } = useInstanceConnections(setup, updateSetup,
        { expanded, editorTransitionBlocked, setError, setAccess, setAnyAccess });
    const { enabledIds, enabled, configured, inactive, placeholders, placeholderIds } = groupInstances(setup, draft);
    const { serviceListRef, move } = useInstancePriority(enabledIds, updateSetup);
    const remove = (instance: ConfigurableInstance) => removeConfiguredInstance(instance,
        { setup, updateSetup, setBusy, setError, cleanAccess, expanded, setExpanded });

    const view = { setup, draft, placeholderIds, configured, access, anyAccess, enabled, expanded, busy, editorTransitionBlocked, replacedDefault };
    const actions = { releaseAccess, grantAccess, move, add, setExpanded, toggle, remove, setEditorTransitionBlocked, setDraft, setReplacedDefault, updateSetup };
    const row = (instance: TranslationInstance, index?: number) =>
        <ServiceRow key={instance.id} instance={instance} index={index} view={view} actions={actions} />;

    return <div class="section" id="providers" tabIndex={-1}>
        <div class="section-title">{t('sectionTranslationServices')}</div>
        <div class="section-description">{t('servicesDesc')}</div>
        {error && <div class="feedback feedback-error" role="alert">{error}</div>}
        {connectionFeedback && <div class={`feedback ${connectionFeedback.connected ? 'feedback-success' : 'feedback-warning'}`} role="status">
            {t(connectionFeedback.connected ? 'instanceConnected' : 'customConnectionFailed', [connectionFeedback.name])}
        </div>}
        <h3 class="service-group-title" id="activated-instances-heading">{t('activatedInstances')}</h3>
        <ul class="service-list" id="instance-priority" aria-labelledby="activated-instances-heading" ref={serviceListRef}>
            {enabled.map((instance, index) => row(instance, index))}
        </ul>
        {!enabled.length && <div class="feedback feedback-warning">{t('noServicesEnabled')}</div>}
        <h3 class="service-group-title" id="available-providers-heading">{t('availableProviders')}</h3>
        <ul class="service-list" id="available-providers" aria-labelledby="available-providers-heading">
            {[...inactive, ...placeholders].map(instance => row(instance))}
        </ul>
    </div>;
}
