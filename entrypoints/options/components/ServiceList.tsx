import { useRef, useEffect, useState } from 'preact/hooks';
import Sortable from 'sortablejs';
import { t } from '@/utils/i18n';
import { reconcileSetupAccess } from '@/utils/storage';
import { createInstance, getInstanceName, normalizeEndpoint, MANAGED_LIBRETRANSLATE_ENDPOINT } from '@/utils/instances';
import { getInstanceOrigins, hasInstanceAccess, hasAnyInstanceAccess, requestInstanceAccess } from '@/utils/permissions';
import { testInstance } from '@/services';
import { probeLibreTranslate } from '@/services/libretranslate';
import type { ApiCredential, DeepLInstance, LibreTranslateInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import type { SetupUpdate } from '../hooks/usePreferences';

interface ServiceListProps {
    readonly setup: TranslationSetup;
    readonly updateSetup: (updater: SetupUpdate) => Promise<boolean>;
}

type ConfigurableInstance = DeepLInstance | LibreTranslateInstance;

function usesCustomServer(instance: TranslationInstance): instance is LibreTranslateInstance {
    return instance.providerId === 'libretranslate' && instance.hosting === 'custom';
}

function configurationIdentity(instance: ConfigurableInstance): string {
    return JSON.stringify({
        providerId: instance.providerId,
        endpoint: instance.providerId === 'libretranslate' ? instance.endpoint : undefined,
        hosting: instance.providerId === 'libretranslate' ? instance.hosting : undefined,
        key: instance.credential?.key,
        tier: instance.credential?.tier,
    });
}

function InstanceEditor({ instance, enabled, allowed, isNew, onCancel, updateSetup }: {
    instance: ConfigurableInstance;
    enabled: boolean;
    allowed: boolean;
    isNew: boolean;
    onCancel: () => void;
    updateSetup: ServiceListProps['updateSetup'];
}) {
    const savedTier = instance.credential?.tier ??
        (instance.credential?.key && !instance.credential.key.endsWith(':fx') ? 'pro' : 'free');
    const [name, setName] = useState(instance.name);
    const [key, setKey] = useState(instance.credential?.key ?? '');
    const [tier, setTier] = useState(savedTier);
    const [endpoint, setEndpoint] = useState(instance.providerId === 'libretranslate' ? instance.endpoint : '');
    const [hosting, setHosting] = useState<'managed' | 'custom'>(instance.providerId === 'libretranslate' ? instance.hosting : 'managed');
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [success, setSuccess] = useState(false);
    const testRevision = useRef(0);
    const identity = `${configurationIdentity(instance)}:${instance.name}`;
    const syncedIdentity = useRef(identity);
    const ownSaveIdentity = useRef<string | null>(null);

    useEffect(() => {
        if (syncedIdentity.current === identity) return;
        syncedIdentity.current = identity;
        if (ownSaveIdentity.current !== identity) { setFeedback(''); setSuccess(false); }
        ownSaveIdentity.current = null;
        setName(instance.name);
        setKey(instance.credential?.key ?? '');
        setTier(savedTier);
        if (instance.providerId === 'libretranslate') {
            setEndpoint(instance.endpoint);
            setHosting(instance.hosting);
        }
        ++testRevision.current;
        setTesting(false);
    }, [identity]);
    useEffect(() => () => { ++testRevision.current; }, []);

    const changedEndpoint = (next: string) => {
        setEndpoint(next);
        if (instance.providerId === 'libretranslate' && next !== instance.endpoint) {
            setKey('');
        }
        setFeedback('');
    };
    const changeHosting = (next: 'managed' | 'custom') => {
        setHosting(next);
        changedEndpoint(next === 'managed' ? MANAGED_LIBRETRANSLATE_ENDPOINT : instance.providerId === 'libretranslate' && instance.hosting === 'custom' ? instance.endpoint : 'http://localhost:5000');
    };
    let effectiveEndpoint = endpoint;
    try { effectiveEndpoint = normalizeEndpoint(endpoint); } catch { /* The save action explains an invalid URL. */ }
    const endpointChanged = !isNew && instance.providerId === 'libretranslate' && effectiveEndpoint !== instance.endpoint;
    const dirty = isNew || name !== instance.name || key !== (instance.credential?.key ?? '') ||
        (instance.providerId === 'deepl' && tier !== savedTier) ||
        (instance.providerId === 'libretranslate' && (endpoint !== instance.endpoint || hosting !== instance.hosting));

    const save = async () => {
        setBusy(true);
        setFeedback('');
        setSuccess(false);
        try {
            if (!name.trim() || name.trim().length > 128) throw new Error(t('instanceNameInvalid'));
            let normalized = '';
            if (instance.providerId === 'libretranslate') {
                try { normalized = normalizeEndpoint(hosting === 'managed' ? MANAGED_LIBRETRANSLATE_ENDPOINT : endpoint); }
                catch { throw new Error(t('instanceEndpointInvalid')); }
            }
            const credential: ApiCredential | undefined = key.trim() && !endpointChanged ? {
                key: key.trim(), validated: false,
                ...(instance.providerId === 'deepl' ? { tier } : {}),
            } : undefined;
            const previousIdentity = JSON.stringify(instance);
            const saved = await updateSetup(current => {
                const existing = current.instances.find(candidate => candidate.id === instance.id);
                if (isNew) {
                    if (existing) throw new Error(t('instanceChanged'));
                    const next: ConfigurableInstance = instance.providerId === 'deepl'
                        ? { ...instance, name: name.trim(), credential }
                        : { ...instance, name: name.trim(), endpoint: normalized, hosting, credential };
                    ownSaveIdentity.current = `${configurationIdentity(next)}:${next.name}`;
                    return { ...current, instances: [...current.instances, next] };
                }
                if (!existing || existing.providerId !== instance.providerId || !('name' in existing) ||
                    JSON.stringify(existing) !== previousIdentity) throw new Error(t('instanceChanged'));
                const preservedCredential = existing.credential?.key === credential?.key &&
                    (existing.providerId !== 'libretranslate' || existing.endpoint === normalized) &&
                    (existing.providerId !== 'deepl' || savedTier === tier) ? existing.credential : credential;
                const next: ConfigurableInstance = existing.providerId === 'deepl'
                    ? { ...existing, name: name.trim(), credential: preservedCredential }
                    : { ...existing, name: name.trim(), endpoint: normalized, hosting, credential: preservedCredential };
                ownSaveIdentity.current = `${configurationIdentity(next)}:${next.name}`;
                return { ...current, instances: current.instances.map(candidate => candidate.id === next.id ? next : candidate) };
            });
            if (!saved) { ownSaveIdentity.current = null; throw new Error(t('settingsSaveFailed')); }
            setSuccess(true);
            setFeedback(t('instanceSaved'));
        } catch (reason) {
            setFeedback(reason instanceof Error ? reason.message : t('settingsSaveFailed'));
        } finally { setBusy(false); }
    };

    const test = async () => {
        const attempt = ++testRevision.current;
        setTesting(true);
        setFeedback('');
        setSuccess(false);
        try {
            const captured = configurationIdentity(instance);
            const result = await testInstance(instance);
            if (attempt !== testRevision.current) return;
            if (instance.credential) {
                const saved = await updateSetup(current => {
                    const existing = current.instances.find(candidate => candidate.id === instance.id);
                    if (!existing || !('name' in existing) || configurationIdentity(existing) !== captured) throw new Error(t('keyChangedDuringTest'));
                    return { ...current, instances: current.instances.map(candidate => candidate.id === existing.id ? {
                        ...existing,
                        credential: { ...existing.credential!, validated: result.valid, lastValidated: Date.now() },
                    } : candidate) };
                });
                if (!saved) throw new Error(t('keyTestFailed'));
            }
            if (attempt !== testRevision.current) return;
            setSuccess(result.valid);
            setFeedback(result.valid ? t('valid') : t('keyTestFailed'));
        } catch {
            if (attempt === testRevision.current) setFeedback(t('keyTestFailed'));
        } finally {
            if (attempt === testRevision.current) setTesting(false);
        }
    };

    return <div class="api-key-section instance-editor" id={`instance-${instance.id}`}>
        <div class="form-group">
            <label htmlFor={`instance-name-${instance.id}`}>{t('instanceName')}</label>
            <input id={`instance-name-${instance.id}`} class="input" value={name} maxLength={128} disabled={busy || testing} autoFocus={isNew}
                onInput={event => { setName(event.currentTarget.value); setFeedback(''); }} />
        </div>
        {instance.providerId === 'libretranslate' && <>
            <div class="form-group">
                <label htmlFor={`instance-hosting-${instance.id}`}>{t('libreHosting')}</label>
                <select id={`instance-hosting-${instance.id}`} class="select" value={hosting} disabled={busy || testing}
                    onChange={event => changeHosting(event.currentTarget.value as 'managed' | 'custom')}>
                    <option value="managed">{t('libreManaged')}</option>
                    <option value="custom">{t('libreCustom')}</option>
                </select>
            </div>
            <div class="form-group">
                <label htmlFor={`instance-endpoint-${instance.id}`}>{t('instanceEndpoint')}</label>
                <input id={`instance-endpoint-${instance.id}`} class="input" type="url" value={endpoint} disabled={busy || testing || hosting === 'managed'}
                    maxLength={2048} autoComplete="off" spellcheck={false} onInput={event => changedEndpoint(event.currentTarget.value)} />
                <div class="setting-hint">{t('endpointDescription')}</div>
                {endpoint.toLowerCase().startsWith('http:') && <div class="feedback feedback-warning">{t('httpEndpointWarning')}</div>}
                {endpointChanged && <div class="setting-hint">{t('endpointKeyReset')}</div>}
            </div>
        </>}
        <div class="form-group">
            <label htmlFor={`instance-key-${instance.id}`}>{instance.providerId === 'libretranslate' && hosting === 'custom' ? t('optionalApiKey') : t('apiKeyLabel')}</label>
            <div class="api-key-input">
                <input id={`instance-key-${instance.id}`} {...(showKey ? { type: 'text' as const } : { type: 'password' as const })} class="input" value={key}
                    disabled={busy || testing || endpointChanged} maxLength={8192} autoComplete="off" spellcheck={false}
                    onInput={event => { setKey(event.currentTarget.value); if (instance.providerId === 'deepl') setTier(event.currentTarget.value.endsWith(':fx') ? 'free' : 'pro'); setFeedback(''); }} />
                <button class="btn btn-sm" onClick={() => setShowKey(previous => !previous)}>{showKey ? t('hide') : t('show')}</button>
            </div>
        </div>
        {instance.providerId === 'deepl' && <div class="form-group">
            <label htmlFor={`instance-tier-${instance.id}`}>{t('deepLTier')}</label>
            <select id={`instance-tier-${instance.id}`} class="select" value={tier} disabled={busy || testing}
                onChange={event => setTier(event.currentTarget.value as 'free' | 'pro')}>
                <option value="free">DeepL API Free</option><option value="pro">DeepL API Pro</option>
            </select>
        </div>}
        <div class="instance-editor-actions">
            <button class="btn btn-sm btn-primary" data-action="save-instance" disabled={busy || testing || !dirty} onClick={() => void save()}>{t('saveInstance')}</button>
            {isNew && <button class="btn btn-sm" data-action="cancel-instance" disabled={busy} onClick={onCancel}>{t('cancel')}</button>}
            <button class="btn btn-sm" disabled={busy || testing || dirty || !enabled || !allowed ||
                ((instance.providerId === 'deepl' || instance.hosting === 'managed') && !instance.credential?.key)} onClick={() => void test()}>
                {testing ? t('checking') : t('testKey')}
            </button>
        </div>
        <div class="setting-hint">{isNew ? t('newInstanceDescription') : dirty ? t('saveBeforeTesting') : t('instanceTestDescription')}</div>
        {instance.providerId === 'libretranslate' && hosting === 'custom' && <div class="setting-hint">{t('customConnectionDescription')}</div>}
        {feedback && <div class={`feedback ${success ? 'feedback-success' : 'feedback-error'}`} role={success ? 'status' : 'alert'}>{feedback}</div>}
    </div>;
}

export function ServiceList({ setup, updateSetup }: ServiceListProps) {
    const serviceListRef = useRef<HTMLUListElement>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [access, setAccess] = useState<Record<string, boolean>>({});
    const [anyAccess, setAnyAccess] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState<ConfigurableInstance | null>(null);
    const [choosingProvider, setChoosingProvider] = useState(false);
    const [connectionFeedback, setConnectionFeedback] = useState<{ name: string; connected: boolean } | null>(null);
    const connection = useRef<AbortController | null>(null);
    const accessRevision = useRef(0);
    const enabledIds = setup.preferences.fallbackOrder;
    const enabled = enabledIds.map(id => setup.instances.find(instance => instance.id === id)).filter(instance => instance !== undefined);
    const disabled = setup.instances.filter(instance => !enabledIds.includes(instance.id));
    const inactive = disabled.filter(instance => instance.id !== draft?.id);
    if (draft) inactive.push(setup.instances.find(instance => instance.id === draft.id) ?? draft);
    const listed = [
        ...enabled.map((instance, index) => ({ instance, index })),
        ...inactive.map(instance => ({ instance, index: undefined })),
    ];

    useEffect(() => () => connection.current?.abort(), []);
    useEffect(() => {
        // Storage events can acknowledge a save after the save callback returns.
        // Keep the draft mounted until the persisted row is available.
        if (draft && setup.instances.some(instance => instance.id === draft.id)) setDraft(null);
    }, [draft, setup.instances]);

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            const request = ++accessRevision.current;
            try {
                const grants = await Promise.all(setup.instances.map(async instance => ({ id: instance.id,
                    all: await hasInstanceAccess(instance), any: await hasAnyInstanceAccess(instance),
                })));
                if (active && request === accessRevision.current) {
                    setAccess(Object.fromEntries(grants.map(grant => [grant.id, grant.all])));
                    setAnyAccess(Object.fromEntries(grants.map(grant => [grant.id, grant.any])));
                }
            } catch {
                if (active) setError(t('permissionCheckFailed'));
            }
        };
        void refresh();
        chrome.permissions.onAdded.addListener(refresh);
        chrome.permissions.onRemoved.addListener(refresh);
        return () => {
            active = false;
            chrome.permissions.onAdded.removeListener(refresh);
            chrome.permissions.onRemoved.removeListener(refresh);
        };
    }, [setup.instances]);

    const cleanAccess = async (previous: TranslationSetup) => {
        try { await reconcileSetupAccess(previous); }
        catch { setError(t('permissionRemoveFailed')); }
    };
    const toggle = (instance: TranslationInstance) => {
        const enabling = !enabledIds.includes(instance.id);
        const grant = enabling ? requestInstanceAccess(instance) : undefined;
        const controller = new AbortController();
        connection.current?.abort();
        connection.current = controller;
        setBusy(instance.id);
        setError('');
        setConnectionFeedback(null);
        let granted = false;
        void (async () => {
            if (enabling) {
                granted = !!await grant;
                if (!granted) throw new Error(t('permissionDenied'));
            }
            controller.signal.throwIfAborted();
            const connected = enabling && usesCustomServer(instance)
                ? await probeLibreTranslate(instance.endpoint, controller.signal) : undefined;
            controller.signal.throwIfAborted();
            const saved = await updateSetup(async current => {
                const latest = current.instances.find(candidate => candidate.id === instance.id);
                if (!latest || JSON.stringify(getInstanceOrigins(latest)) !== JSON.stringify(getInstanceOrigins(instance))) throw new Error(t('instanceChanged'));
                if (enabling && usesCustomServer(instance) &&
                    (latest.providerId !== 'libretranslate' || latest.endpoint !== instance.endpoint)) throw new Error(t('instanceChanged'));
                if (enabling && !await hasInstanceAccess(latest)) throw new Error(t('permissionDenied'));
                const order = current.preferences.fallbackOrder.filter(id => id !== instance.id);
                if (enabling) order.push(instance.id);
                return { ...current, preferences: { ...current.preferences, fallbackOrder: order } };
            });
            if (!saved) throw new Error(t('settingsSaveFailed'));
            if (!enabling) await cleanAccess(setup);
            if (connected !== undefined) setConnectionFeedback({ name: getInstanceName(instance), connected });
            const actual = await hasInstanceAccess(instance);
            setAccess(previous => ({ ...previous, [instance.id]: actual }));
        })().catch(async reason => {
            if (granted) await cleanAccess({ ...setup, preferences: { ...setup.preferences, fallbackOrder: [...enabledIds, instance.id] } });
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t('permissionChangeFailed'));
        }).finally(() => {
            if (connection.current === controller) { connection.current = null; setBusy(null); }
        });
    };
    const grantAccess = (instance: TranslationInstance) => {
        const operation = requestInstanceAccess(instance);
        const controller = new AbortController();
        connection.current?.abort();
        connection.current = controller;
        setBusy(instance.id);
        setError('');
        setConnectionFeedback(null);
        void operation.then(async granted => {
            if (!granted) throw new Error(t('permissionDenied'));
            controller.signal.throwIfAborted();
            const connected = usesCustomServer(instance) ? await probeLibreTranslate(instance.endpoint, controller.signal) : undefined;
            controller.signal.throwIfAborted();
            await reconcileSetupAccess(setup);
            const actual = await hasInstanceAccess(instance);
            setAccess(previous => ({ ...previous, [instance.id]: actual }));
            if (!actual) throw new Error(t('permissionDenied'));
            if (connected !== undefined) setConnectionFeedback({ name: getInstanceName(instance), connected });
        }).catch(async () => {
            await cleanAccess(setup);
            if (!controller.signal.aborted) setError(t('permissionDenied'));
        }).finally(() => {
            if (connection.current === controller) { connection.current = null; setBusy(null); }
        });
    };
    const releaseAccess = async (instance: TranslationInstance) => {
        setBusy(instance.id);
        setError('');
        try {
            await cleanAccess({ ...setup, preferences: { ...setup.preferences, fallbackOrder: [...enabledIds, instance.id] } });
            const [all, any] = await Promise.all([hasInstanceAccess(instance), hasAnyInstanceAccess(instance)]);
            setAccess(previous => ({ ...previous, [instance.id]: all }));
            setAnyAccess(previous => ({ ...previous, [instance.id]: any }));
        } catch { setError(t('permissionCheckFailed')); }
        finally { setBusy(null); }
    };
    const remove = async (instance: ConfigurableInstance) => {
        setBusy(instance.id);
        setError('');
        const saved = await updateSetup(current => ({ ...current,
            instances: current.instances.filter(candidate => candidate.id !== instance.id),
            preferences: { ...current.preferences, fallbackOrder: current.preferences.fallbackOrder.filter(id => id !== instance.id) },
        }));
        if (saved) { await cleanAccess(setup); if (expanded === instance.id) setExpanded(null); }
        setBusy(null);
    };
    const add = (providerId: 'deepl' | 'libretranslate') => {
        if (draft) return;
        const instance = createInstance(providerId);
        setDraft(instance);
        setExpanded(instance.id);
        setChoosingProvider(false);
    };
    const move = (id: string, offset: number) => {
        void updateSetup(current => {
            const order = [...current.preferences.fallbackOrder];
            const index = order.indexOf(id);
            if (index < 0 || index + offset < 0 || index + offset >= order.length) return current;
            order.splice(index, 1);
            order.splice(index + offset, 0, id);
            return { ...current, preferences: { ...current.preferences, fallbackOrder: order } };
        });
    };

    useEffect(() => {
        if (!serviceListRef.current) return;
        const sortable = Sortable.create(serviceListRef.current, {
            animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
            draggable: '.service-item.enabled',
            onMove: event => event.related.classList.contains('enabled'),
            onEnd(event) {
                const from = event.oldDraggableIndex;
                const to = event.newDraggableIndex;
                if (from === undefined || to === undefined || from === to) return;
                const snapshot = [...enabledIds];
                const [moved] = snapshot.splice(from, 1);
                if (!moved) return;
                snapshot.splice(to, 0, moved);
                void updateSetup(current => ({ ...current, preferences: { ...current.preferences, fallbackOrder: [
                    ...snapshot.filter(id => current.preferences.fallbackOrder.includes(id)),
                    ...current.preferences.fallbackOrder.filter(id => !snapshot.includes(id)),
                ] } }));
            },
        });
        return () => sortable.destroy();
    }, [enabledIds, updateSetup]);

    const row = (instance: TranslationInstance, index?: number) => {
        const isEnabled = index !== undefined;
        const configurable = 'name' in instance;
        const isNew = draft?.id === instance.id && !setup.instances.some(saved => saved.id === instance.id);
        const name = getInstanceName(instance);
        const needsKey = (instance.providerId === 'deepl' || (instance.providerId === 'libretranslate' && instance.hosting === 'managed')) && !instance.credential?.key;
        const ready = access[instance.id] && !needsKey;
        const sharedGrant = enabled.some(other => getInstanceOrigins(other).some(origin => getInstanceOrigins(instance).includes(origin)));
        return <li key={instance.id} class={`service-item ${isEnabled ? 'enabled' : 'disabled-item'}`} data-id={instance.id}>
            <div class="service-row">
                {isEnabled && <><span class="drag-handle" title={t('dragToReorder')}>⋮⋮</span><span class="service-index">{index + 1}</span></>}
                <div class="service-info">
                    <div class="service-heading"><span class="service-name">{name}</span>
                        {isNew && <span class="badge badge-muted">{t('draftInstance')}</span>}
                        {index === 0 && <span class="badge badge-primary">{t('primary')}</span>}
                        {isEnabled && ready && <span class="badge badge-success" aria-label={t('providerReady')}>✓</span>}
                    </div>
                    {configurable && (instance.providerId !== 'deepl' || name !== 'DeepL') &&
                        <div class="setting-hint">{instance.providerId === 'deepl' ? 'DeepL' : `LibreTranslate · ${instance.endpoint}`}</div>}
                    {instance.providerId === 'deepl' && name === 'DeepL' && !instance.credential?.key &&
                        <div class="setting-hint">{t('keyNeeded')}</div>}
                    {!configurable && !isEnabled && <div class="setting-hint">{t(instance.providerId === 'google-web' ? 'googleProviderDescription' : 'lingvaProviderDescription')}</div>}
                    {instance.providerId === 'libretranslate' && instance.endpoint.startsWith('http:') && expanded !== instance.id &&
                        <div class="setting-hint http-warning">{t('httpEndpointWarning')}</div>}
                    {isEnabled && !ready && <div class="setting-hint service-status">{!access[instance.id] ? t('providerPermissionRequired') : t('keyNeeded')}</div>}
                </div>
                <div class="service-actions">
                    {!isEnabled && anyAccess[instance.id] && !sharedGrant && <button class="btn btn-sm" disabled={busy !== null} onClick={() => void releaseAccess(instance)}>{t('removeAccess')}</button>}
                    {isEnabled && !access[instance.id] && <button class="btn btn-sm" disabled={busy !== null}
                        data-action={usesCustomServer(instance) ? 'connect-instance' : 'grant-access'}
                        aria-label={usesCustomServer(instance) ? t('connectInstance', [name]) : undefined}
                        onClick={() => grantAccess(instance)}>{t(usesCustomServer(instance) ? 'connect' : 'grantAccess')}</button>}
                    {isEnabled && <>
                        <button class="btn btn-sm" aria-label={t('moveInstanceUp', [name])} disabled={index === 0 || busy !== null} onClick={() => move(instance.id, -1)}>↑</button>
                        <button class="btn btn-sm" aria-label={t('moveInstanceDown', [name])} disabled={index === enabled.length - 1 || busy !== null} onClick={() => move(instance.id, 1)}>↓</button>
                    </>}
                    {configurable && !isNew && <button class="btn btn-sm" aria-label={t('configureNamedInstance', [name])} aria-expanded={expanded === instance.id} aria-controls={`instance-${instance.id}`}
                        disabled={busy !== null} onClick={() => setExpanded(expanded === instance.id ? null : instance.id)}>{t('configureInstance')}</button>}
                    {!isNew && <button class={`btn btn-sm ${!isEnabled ? 'btn-primary' : ''}`}
                        data-action={isEnabled ? 'disable-instance' : usesCustomServer(instance) ? 'connect-instance' : 'enable-instance'}
                        aria-label={t(isEnabled ? 'disableInstance' : usesCustomServer(instance) ? 'connectInstance' : 'enableInstance', [name])}
                        disabled={busy !== null} onClick={() => toggle(instance)}>{isEnabled ? '✕' : usesCustomServer(instance) ? t('connect') : '+'}</button>}
                    {configurable && !isNew && <button class="btn btn-sm" aria-label={t('deleteNamedInstance', [name])} disabled={busy !== null} onClick={() => void remove(instance)}>{t('deleteInstance')}</button>}
                </div>
            </div>
            {configurable && expanded === instance.id && <InstanceEditor instance={instance} enabled={isEnabled} allowed={Boolean(access[instance.id])}
                isNew={isNew} onCancel={() => { setDraft(null); setExpanded(null); }} updateSetup={updateSetup} />}
        </li>;
    };

    return <div class="section" id="providers" tabIndex={-1}>
        <div class="section-title provider-heading">
            <span>{t('sectionTranslationServices')}</span>
            <button class="btn btn-sm" data-action="choose-provider" aria-expanded={choosingProvider} aria-controls="provider-chooser"
                disabled={busy !== null || draft !== null} onClick={() => setChoosingProvider(previous => !previous)}>{t('availableProviders')}</button>
        </div>
        <div class="section-description">{t('servicesDesc')}</div>
        {error && <div class="feedback feedback-error" role="alert">{error}</div>}
        {connectionFeedback && <div class={`feedback ${connectionFeedback.connected ? 'feedback-success' : 'feedback-warning'}`} role="status">
            {t(connectionFeedback.connected ? 'instanceConnected' : 'customConnectionFailed', [connectionFeedback.name])}
        </div>}
        {choosingProvider && <div id="provider-chooser">
            <ul class="service-list provider-catalog">
                {(['deepl', 'libretranslate'] as const).map(provider => {
                    const name = provider === 'deepl' ? 'DeepL' : 'LibreTranslate';
                    return <li key={provider} class="service-item provider-choice" data-provider={provider}>
                        <div class="service-row">
                            <div class="service-info">
                                <span class="service-name">{name}</span>
                                <div class="setting-hint">{t(provider === 'deepl' ? 'deepLProviderDescription' : 'libreProviderDescription')}</div>
                            </div>
                            <button class="btn btn-sm btn-primary" data-action="add-provider" aria-label={t('addProviderInstance', [name])}
                                disabled={busy !== null || draft !== null} onClick={() => add(provider)}>+</button>
                        </div>
                    </li>;
                })}
            </ul>
        </div>}
        <ul class="service-list" id="instance-priority" aria-label={t('sectionTranslationServices')} ref={serviceListRef}>
            {listed.map(({ instance, index }) => row(instance, index))}
        </ul>
        {!enabled.length && <div class="feedback feedback-warning">{t('noServicesEnabled')}</div>}
    </div>;
}
