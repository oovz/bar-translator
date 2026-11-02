import { useEffect, useRef, useState } from 'preact/hooks';
import Sortable from 'sortablejs';
import { t } from '@/utils/i18n';
import { createInstance } from '@/utils/instances';
import { hasInstanceAccess, hasAnyInstanceAccess } from '@/utils/permissions';
import type { DeepLInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import { groupInstances, moveInstance } from '../components/instance-model';
import type { ConfigurableInstance, ServiceListProps } from '../components/instance-model';

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

export function useInstanceSelection(setup: TranslationSetup) {
    const [expanded, setExpanded] = useState<string | null>(null);
    const [editorTransitionBlocked, setEditorTransitionBlocked] = useState(false);
    const [draft, setDraft] = useState<ConfigurableInstance | null>(null);
    const [replacedDefault, setReplacedDefault] = useState<DeepLInstance | undefined>();
    const { unusedDefault } = groupInstances(setup, draft);
    useEffect(() => {
        // Keep draft mounted until a delayed storage acknowledgement arrives.
        if (draft && setup.instances.some(instance => instance.id === draft.id)) setDraft(null);
    }, [draft, setup.instances]);
    const add = (providerId: 'deepl' | 'libretranslate') => {
        if (draft) return;
        const instance = createInstance(providerId);
        setReplacedDefault(providerId === 'deepl' && unusedDefault?.providerId === 'deepl' ? unusedDefault : undefined);
        setDraft(instance);
        setExpanded(instance.id);
    };
    return { expanded, setExpanded, editorTransitionBlocked, setEditorTransitionBlocked, draft, setDraft, replacedDefault, setReplacedDefault, add };
}

export function useInstancePriority(enabledIds: string[], updateSetup: ServiceListProps['updateSetup']) {
    const serviceListRef = useRef<HTMLUListElement>(null);
    const move = (id: string, offset: number) => {
        void updateSetup(current => moveInstance(current, id, offset));
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

    return { serviceListRef, move };
}

interface RemovalContext {
    setup: TranslationSetup;
    updateSetup: ServiceListProps['updateSetup'];
    setBusy: (id: string | null) => void;
    setError: (error: string) => void;
    cleanAccess: (previous: TranslationSetup) => Promise<void>;
    expanded: string | null;
    setExpanded: (id: string | null) => void;
}
export async function removeConfiguredInstance(instance: ConfigurableInstance, context: RemovalContext) {
    const { setup, updateSetup, setBusy, setError, cleanAccess, expanded, setExpanded } = context;
    setBusy(instance.id);
    setError('');
    const saved = await updateSetup(current => ({ ...current,
        instances: current.instances.filter(candidate => candidate.id !== instance.id),
        preferences: { ...current.preferences, fallbackOrder: current.preferences.fallbackOrder.filter(id => id !== instance.id) },
    }));
    if (saved) { await cleanAccess(setup); if (expanded === instance.id) setExpanded(null); }
    setBusy(null);
}
