import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import Sortable from 'sortablejs';
import { t } from '@/utils/i18n';
import { createInstance, getInstanceName, getInstanceOrder } from '@/utils/instances';
import { hasInstanceAccess, hasAnyInstanceAccess } from '@/utils/permissions';
import type { DeepLInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import { groupInstances, moveInstance, reorderEnabledInstances } from '../components/instance-model';
import type { ConfigurableInstance, FocusRequest, ServiceListProps } from '../components/instance-model';

export function useInstanceFocus(request: FocusRequest | null, setRequest: (request: FocusRequest | null) => void,
    setup: TranslationSetup, busy: string | null) {
    useEffect(() => {
        if (!request) return;
        const target = instanceFocusTarget(request);
        if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
        target.focus();
        setRequest(null);
    }, [request, setup, busy]);
}

function instanceFocusTarget(request: FocusRequest) {
    if (request.editorId) return document.getElementById(`instance-name-${request.editorId}`);
    const row = [...document.querySelectorAll<HTMLElement>('[data-id]')].find(element => element.dataset.id === request.id);
    if (row) return row.querySelector<HTMLElement>('.service-disclosure') ?? row;
    return request.provider
        ? document.querySelector<HTMLElement>(`#available-providers [data-catalog-provider="${request.provider}"] [data-action="add-provider"]`)
        : null;
}

export function useUnsavedChangesGuard(dirty: boolean) {
    useEffect(() => {
        if (!dirty) return;
        const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [dirty]);
}

export function useInstanceAccess(instances: TranslationInstance[], setError: (error: string) => void) {
    const [access, setAccess] = useState<Record<string, boolean>>({});
    const [anyAccess, setAnyAccess] = useState<Record<string, boolean>>({});
    const accessRevision = useRef(0);
    useEffect(() => {
        let active = true;
        const refresh = async () => {
            const request = ++accessRevision.current;
            try {
                const grants = await Promise.all(instances.map(async instance => ({ id: instance.id,
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
    }, [instances]);

    return { access, setAccess, anyAccess, setAnyAccess };
}

export function useInstanceSelection(setup: TranslationSetup, requestFocus: (request: FocusRequest) => void) {
    const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
    const [blockedIds, setBlockedIds] = useState<Record<string, boolean>>({});
    const [drafts, setDrafts] = useState<Partial<Record<'deepl' | 'libretranslate', ConfigurableInstance>>>({});
    const [replacedDefault, setReplacedDefault] = useState<DeepLInstance | undefined>();
    const { unusedDefault } = groupInstances(setup);
    const setExpanded = useCallback((id: string, expanded: boolean) => {
        setExpandedIds(current => current[id] === expanded ? current : { ...current, [id]: expanded });
    }, []);
    const setBlocked = useCallback((id: string, blocked: boolean) => {
        setBlockedIds(current => Boolean(current[id]) === blocked ? current : { ...current, [id]: blocked });
    }, []);
    const closeDraft = (providerId: 'deepl' | 'libretranslate') => {
        const id = drafts[providerId]?.id;
        if (id) {
            setExpandedIds(current => { const next = { ...current }; delete next[id]; return next; });
            setBlocked(id, false);
        }
        setDrafts(current => { const next = { ...current }; delete next[providerId]; return next; });
        if (providerId === 'deepl') setReplacedDefault(undefined);
        requestFocus({ id, provider: providerId });
    };
    const add = (providerId: 'deepl' | 'libretranslate') => {
        const draft = drafts[providerId];
        if (draft) {
            setExpanded(draft.id, true);
            requestFocus({ editorId: draft.id });
            return;
        }
        const instance = createInstance(providerId);
        if (providerId === 'deepl') setReplacedDefault(unusedDefault);
        setDrafts(current => ({ ...current, [providerId]: instance }));
        setExpanded(instance.id, true);
    };
    return { expandedIds, setExpanded, blockedIds, setBlocked, drafts, closeDraft, replacedDefault, add };
}

export function useInstancePriority(enabledIds: string[], updateSetup: ServiceListProps['updateSetup']) {
    const serviceListRef = useRef<HTMLUListElement>(null);
    const move = (id: string, offset: number) => {
        void updateSetup(current => moveInstance(current, id, offset));
    };

    useEffect(() => {
        if (!serviceListRef.current) return;
        const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const sortable = Sortable.create(serviceListRef.current, {
            animation: reduceMotion ? 0 : 150, handle: '.drag-handle', ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
            draggable: '.service-item.enabled',
            onEnd(event) {
                const from = event.oldDraggableIndex;
                const to = event.newDraggableIndex;
                if (from === undefined || to === undefined || from === to) return;
                const snapshot = [...enabledIds];
                const [moved] = snapshot.splice(from, 1);
                if (!moved) return;
                snapshot.splice(to, 0, moved);
                void updateSetup(current => reorderEnabledInstances(current, snapshot));
            },
        });
        return () => sortable.destroy();
    }, [enabledIds, updateSetup]);

    return { serviceListRef, move };
}

interface RemovalContext {
    setup: TranslationSetup;
    updateSetup: ServiceListProps['updateSetup'];
    setBusy: (id: string | null) => void;
    setError: (error: string) => void;
    cleanAccess: (previous: TranslationSetup) => Promise<void>;
    requestFocus: (request: FocusRequest) => void;
    announce: (message: string) => void;
    expanded: string | null;
    setExpanded: (id: string | null) => void;
}
export async function removeConfiguredInstance(instance: TranslationInstance, context: RemovalContext) {
    const { setup, updateSetup, setBusy, setError, cleanAccess, requestFocus, announce, expanded, setExpanded } = context;
    setBusy(instance.id);
    setError('');
    const saved = await updateSetup(current => ({ ...current,
        instances: current.instances.filter(candidate => candidate.id !== instance.id),
        instanceOrder: getInstanceOrder(current).filter(id => id !== instance.id),
        preferences: { ...current.preferences, fallbackOrder: current.preferences.fallbackOrder.filter(id => id !== instance.id) },
    }));
    if (saved) {
        await cleanAccess(setup);
        if (expanded === instance.id) setExpanded(null);
        announce(t('instanceDeletedStatus', [getInstanceName(instance)]));
        requestFocus({ provider: instance.providerId });
    }
    setBusy(null);
}
