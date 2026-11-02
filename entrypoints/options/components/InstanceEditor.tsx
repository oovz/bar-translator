import { useRef, useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { t } from '@/utils/i18n';
import { MANAGED_LIBRETRANSLATE_ENDPOINT } from '@/utils/instances';
import { testInstance } from '@/services';
import type { DeepLInstance } from '@/src/types';
import { needsCredential, configurationIdentity, editedInstance, addEditedInstance, replaceEditedInstance, recordInstanceTest, instanceTier, effectiveEndpoint, draftChanged } from './instance-model';
import type { ConfigurableInstance, InstanceDraft, ServiceListProps } from './instance-model';

export function InstanceEditor({ instance, enabled, allowed, isNew, replaces, transitioning, onTransitionBlockedChange, onCancel, updateSetup }: {
    instance: ConfigurableInstance;
    enabled: boolean;
    allowed: boolean;
    isNew: boolean;
    replaces?: DeepLInstance;
    transitioning: boolean;
    onTransitionBlockedChange: (blocked: boolean) => void;
    onCancel: () => void;
    updateSetup: ServiceListProps['updateSetup'];
}) {
    const { name, key, tier, endpoint, hosting, busy, testing, feedback, success, savedTier, ownSaveIdentity, testRevision, dirty, endpointChanged, changedEndpoint, changeHosting, setName, setKey, setTier, setFeedback, feedbackState } = useInstanceEditorState(instance, isNew);
    const locked = busy || testing || transitioning;
    useTransitionBlock(dirty, busy, testing, onTransitionBlockedChange);

    const save = () => saveInstanceDraft(instance, { name, key, tier, endpoint, hosting }, {
        isNew, replaces, endpointChanged, savedTier, ownSaveIdentity, updateSetup, ...feedbackState,
    });
    const test = () => testSavedInstance(instance, updateSetup, testRevision, feedbackState);

    return <div class="api-key-section instance-editor" id={`instance-${instance.id}`}>
        <div class="form-group">
            <label htmlFor={`instance-name-${instance.id}`}>{t('instanceName')}</label>
            <input id={`instance-name-${instance.id}`} class="input" value={name} maxLength={128} disabled={locked} autoFocus={isNew}
                onInput={event => { setName(event.currentTarget.value); setFeedback(''); }} />
        </div>
        <EndpointFields instance={instance} hosting={hosting} endpoint={endpoint} locked={locked} endpointChanged={endpointChanged}
            changeHosting={changeHosting} changedEndpoint={changedEndpoint} />
        <CredentialFields instance={instance} hosting={hosting} apiKey={key} tier={tier} locked={locked} endpointChanged={endpointChanged}
            setKey={setKey} setTier={setTier} setFeedback={setFeedback} />
        <EditorActions instance={instance} locked={locked} dirty={dirty} isNew={isNew} busy={busy} transitioning={transitioning}
            enabled={enabled} allowed={allowed} testing={testing} save={save} test={test} onCancel={onCancel} />
        <EditorHints instance={instance} hosting={hosting} isNew={isNew} dirty={dirty} feedback={feedback} success={success} />
    </div>;
}

interface EditorFeedback {
    setBusy: (busy: boolean) => void;
    setFeedback: (message: string) => void;
    setSuccess: (success: boolean) => void;
    setTesting: (testing: boolean) => void;
}

interface SaveInstanceOptions extends EditorFeedback {
    isNew: boolean;
    replaces?: DeepLInstance;
    endpointChanged: boolean;
    savedTier: 'free' | 'pro';
    ownSaveIdentity: { current: string | null };
    updateSetup: ServiceListProps['updateSetup'];
}

async function saveInstanceDraft(instance: ConfigurableInstance, draft: InstanceDraft, options: SaveInstanceOptions) {
    const { isNew, replaces, endpointChanged, savedTier, ownSaveIdentity, updateSetup, setBusy, setFeedback, setSuccess } = options;
    setBusy(true);
    setFeedback('');
    setSuccess(false);
    try {
        const next = editedInstance(instance, draft, endpointChanged);
        const saved = await updateSetup(current => {
            const updated = isNew
                ? addEditedInstance(current, next, replaces)
                : replaceEditedInstance(current, instance, next, savedTier);
            ownSaveIdentity.current = `${configurationIdentity(updated.instance)}:${updated.instance.name}`;
            return updated.setup;
        });
        if (!saved) { ownSaveIdentity.current = null; throw new Error(t('settingsSaveFailed')); }
        setSuccess(true);
        setFeedback(t('instanceSaved'));
    } catch (reason) {
        setFeedback(reason instanceof Error ? reason.message : t('settingsSaveFailed'));
    } finally { setBusy(false); }
}

async function testSavedInstance(instance: ConfigurableInstance, updateSetup: ServiceListProps['updateSetup'], testRevision: { current: number }, feedback: EditorFeedback) {
    const { setTesting, setFeedback, setSuccess } = feedback;
    const attempt = ++testRevision.current;
    setTesting(true);
    setFeedback('');
    setSuccess(false);
    try {
        const captured = configurationIdentity(instance);
        const result = await testInstance(instance);
        if (attempt !== testRevision.current) return;
        if (instance.credential) {
            const saved = await updateSetup(current => recordInstanceTest(current, instance.id, captured, result.valid));
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
}

interface EndpointFieldsProps {
    instance: ConfigurableInstance;
    hosting: 'managed' | 'custom';
    endpoint: string;
    locked: boolean;
    endpointChanged: boolean;
    changeHosting: (value: 'managed' | 'custom') => void;
    changedEndpoint: (value: string) => void;
}

function EndpointFields({ instance, hosting, endpoint, locked, endpointChanged, changeHosting, changedEndpoint }: EndpointFieldsProps) {
    return (
        instance.providerId === 'libretranslate' && <>
            <div class="form-group">
                <label htmlFor={`instance-hosting-${instance.id}`}>{t('libreHosting')}</label>
                <select id={`instance-hosting-${instance.id}`} class="select" value={hosting} disabled={locked}
                    onChange={event => changeHosting(event.currentTarget.value as 'managed' | 'custom')}>
                    <option value="managed">{t('libreManaged')}</option>
                    <option value="custom">{t('libreCustom')}</option>
                </select>
            </div>
            <div class="form-group">
                <label htmlFor={`instance-endpoint-${instance.id}`}>{t('instanceEndpoint')}</label>
                <input id={`instance-endpoint-${instance.id}`} class="input" type="url" value={endpoint} disabled={locked || hosting === 'managed'}
                    maxLength={2048} autoComplete="off" spellcheck={false} onInput={event => changedEndpoint(event.currentTarget.value)} />
                <div class="setting-hint">{t('endpointDescription')}</div>
                {endpoint.toLowerCase().startsWith('http:') && <div class="feedback feedback-warning">{t('httpEndpointWarning')}</div>}
                {endpointChanged && <div class="setting-hint">{t('endpointKeyReset')}</div>}
            </div>
        </>
    );
}

interface CredentialFieldsProps {
    instance: ConfigurableInstance;
    hosting: 'managed' | 'custom';
    apiKey: string;
    tier: 'free' | 'pro';
    locked: boolean;
    endpointChanged: boolean;
    setKey: (key: string) => void;
    setTier: (tier: 'free' | 'pro') => void;
    setFeedback: (feedback: string) => void;
}

function CredentialFields({ instance, hosting, apiKey, tier, locked, endpointChanged, setKey, setTier, setFeedback }: CredentialFieldsProps) {
    const [showKey, setShowKey] = useState(false);
    return <>
        <div class="form-group">
            <label htmlFor={`instance-key-${instance.id}`}>{instance.providerId === 'libretranslate' && hosting === 'custom' ? t('optionalApiKey') : t('apiKeyLabel')}</label>
            <div class="api-key-input">
                <input id={`instance-key-${instance.id}`} {...(showKey ? { type: 'text' as const } : { type: 'password' as const })} class="input" value={apiKey}
                    disabled={locked || endpointChanged} maxLength={8192} autoComplete="off" spellcheck={false}
                    onInput={event => { setKey(event.currentTarget.value); if (instance.providerId === 'deepl') setTier(event.currentTarget.value.endsWith(':fx') ? 'free' : 'pro'); setFeedback(''); }} />
                <button class="btn btn-sm" onClick={() => setShowKey(previous => !previous)}>{showKey ? t('hide') : t('show')}</button>
            </div>
        </div>
        {instance.providerId === 'deepl' && <div class="form-group">
            <label htmlFor={`instance-tier-${instance.id}`}>{t('deepLTier')}</label>
            <select id={`instance-tier-${instance.id}`} class="select" value={tier} disabled={locked}
                onChange={event => setTier(event.currentTarget.value as 'free' | 'pro')}>
                <option value="free">DeepL API Free</option><option value="pro">DeepL API Pro</option>
            </select>
        </div>}
    </>;
}

interface EditorActionsProps {
    instance: ConfigurableInstance;
    locked: boolean;
    dirty: boolean;
    isNew: boolean;
    busy: boolean;
    transitioning: boolean;
    enabled: boolean;
    allowed: boolean;
    testing: boolean;
    save: () => Promise<void>;
    test: () => Promise<void>;
    onCancel: () => void;
}

function EditorActions({ instance, locked, dirty, isNew, busy, transitioning, enabled, allowed, testing, save, test, onCancel }: EditorActionsProps) {
    return (
        <div class="instance-editor-actions">
            <button class="btn btn-sm btn-primary" data-action="save-instance" disabled={locked || !dirty} onClick={() => void save()}>{t('saveInstance')}</button>
            {isNew && <button class="btn btn-sm" data-action="cancel-instance" disabled={busy || transitioning} onClick={onCancel}>{t('cancel')}</button>}
            <button class="btn btn-sm" disabled={locked || dirty || !enabled || !allowed ||
                needsCredential(instance)} onClick={() => void test()}>
                {testing ? t('checking') : t('testKey')}
            </button>
        </div>
    );
}

function useInstanceEditorState(instance: ConfigurableInstance, isNew: boolean) {
    const savedTier = instanceTier(instance);
    const [name, setName] = useState(instance.name);
    const [key, setKey] = useState(instance.credential?.key ?? '');
    const [tier, setTier] = useState(savedTier);
    const [endpoint, setEndpoint] = useState(instance.providerId === 'libretranslate' ? instance.endpoint : '');
    const [hosting, setHosting] = useState<'managed' | 'custom'>(instance.providerId === 'libretranslate' ? instance.hosting : 'managed');
    const [busy, setBusy] = useState(false);
    const [testing, setTesting] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [success, setSuccess] = useState(false);
    const testRevision = useRef(0);
    const ownSaveIdentity = useRef<string | null>(null);
    const feedbackState = { setBusy, setFeedback, setSuccess, setTesting };
    useDraftSynchronization(instance, savedTier,
        { setName, setKey, setTier, setEndpoint, setHosting },
        { ownSaveIdentity, testRevision, ...feedbackState });

    const changedEndpoint = (next: string) => {
        setEndpoint(next);
        if (instance.providerId === 'libretranslate' && next !== instance.endpoint) {
            setKey('');
        }
        setFeedback('');
    };
    const changeHosting = (next: 'managed' | 'custom') => {
        setHosting(next);
        changedEndpoint(hostingEndpoint(instance, next));
    };
    const endpointChanged = changedRecipient(instance, endpoint, isNew);
    const dirty = isNew || draftChanged(instance, { name, key, tier, endpoint, hosting }, savedTier);
    return { name, key, tier, endpoint, hosting, busy, testing, feedback, success, savedTier, ownSaveIdentity, testRevision, dirty, endpointChanged, changedEndpoint, changeHosting, setName, setKey, setTier, setFeedback, feedbackState };
}

interface DraftSetters {
    setName: (value: string) => void;
    setKey: (value: string) => void;
    setTier: (value: 'free' | 'pro') => void;
    setEndpoint: (value: string) => void;
    setHosting: (value: 'managed' | 'custom') => void;
}
interface DraftLifecycle extends EditorFeedback {
    ownSaveIdentity: { current: string | null };
    testRevision: { current: number };
}
function useDraftSynchronization(instance: ConfigurableInstance, savedTier: 'free' | 'pro', setters: DraftSetters, lifecycle: DraftLifecycle) {
    const { setName, setKey, setTier, setEndpoint, setHosting } = setters;
    const { ownSaveIdentity, testRevision, setFeedback, setSuccess, setTesting } = lifecycle;
    const identity = `${configurationIdentity(instance)}:${instance.name}`;
    const syncedIdentity = useRef(identity);

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

}
function hostingEndpoint(instance: ConfigurableInstance, next: 'managed' | 'custom') {
    if (next === 'managed') return MANAGED_LIBRETRANSLATE_ENDPOINT;
    return instance.providerId === 'libretranslate' && instance.hosting === 'custom' ? instance.endpoint : 'http://localhost:5000';
}
function changedRecipient(instance: ConfigurableInstance, endpoint: string, isNew: boolean) {
    return !isNew && instance.providerId === 'libretranslate' && effectiveEndpoint(endpoint) !== instance.endpoint;
}

function useTransitionBlock(dirty: boolean, busy: boolean, testing: boolean, onTransitionBlockedChange: (blocked: boolean) => void) {
    useLayoutEffect(() => {
        onTransitionBlockedChange(dirty || busy || testing);
    }, [dirty, busy, testing, onTransitionBlockedChange]);
    useLayoutEffect(() => () => onTransitionBlockedChange(false), [onTransitionBlockedChange]);

}
function EditorHints({ instance, hosting, isNew, dirty, feedback, success }: {
    instance: ConfigurableInstance; hosting: 'managed' | 'custom'; isNew: boolean; dirty: boolean; feedback: string; success: boolean;
}) {
    return <>
        <div class="setting-hint">{isNew ? t('newInstanceDescription') : dirty ? t('saveBeforeTesting') : t('instanceTestDescription')}</div>
        {instance.providerId === 'libretranslate' && hosting === 'custom' && <div class="setting-hint">{t('customConnectionDescription')}</div>}
        {feedback && <div class={`feedback ${success ? 'feedback-success' : 'feedback-error'}`} role={success ? 'status' : 'alert'}>{feedback}</div>}
    </>;
}
