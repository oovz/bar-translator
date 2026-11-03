import { t } from '@/utils/i18n';
import { getInstanceOrder, normalizeEndpoint, supportsMultipleInstances, MANAGED_LIBRETRANSLATE_ENDPOINT } from '@/utils/instances';
import { getInstanceOrigins, hasInstanceAccess } from '@/utils/permissions';
import type { ApiCredential, DeepLInstance, LibreTranslateInstance, ServiceId, SingletonInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import type { SetupUpdate } from '../hooks/usePreferences';

export interface ServiceListProps {
    readonly setup: TranslationSetup;
    readonly updateSetup: (updater: SetupUpdate) => Promise<boolean>;
}

export interface FocusRequest {
    id?: string;
    provider?: ServiceId;
    editorId?: string;
}

export type ConfigurableInstance = DeepLInstance | LibreTranslateInstance;

export function isUnusedDefaultDeepL(instance: TranslationInstance, enabledIds: readonly string[]): instance is DeepLInstance {
    return instance.id === 'deepl' && instance.providerId === 'deepl' && instance.name === 'DeepL' &&
        instance.credential === undefined && !enabledIds.includes(instance.id);
}

export function usesCustomServer(instance: TranslationInstance): instance is LibreTranslateInstance {
    return instance.providerId === 'libretranslate' && instance.hosting === 'custom';
}

export function configurationIdentity(instance: ConfigurableInstance): string {
    return JSON.stringify({
        providerId: instance.providerId,
        endpoint: instance.providerId === 'libretranslate' ? instance.endpoint : undefined,
        hosting: instance.providerId === 'libretranslate' ? instance.hosting : undefined,
        key: instance.credential?.key,
        tier: instance.credential?.tier,
    });
}

export interface InstanceDraft {
    name: string;
    key: string;
    tier: 'free' | 'pro';
    endpoint: string;
    hosting: 'managed' | 'custom';
}

export function editedInstance(instance: ConfigurableInstance, draft: InstanceDraft, endpointChanged: boolean): ConfigurableInstance {
    const name = draft.name.trim();
    if (!name || name.length > 128) throw new Error(t('instanceNameInvalid'));
    const credential: ApiCredential | undefined = draft.key.trim() && !endpointChanged ? {
        key: draft.key.trim(), validated: false,
        ...(instance.providerId === 'deepl' ? { tier: draft.tier } : {}),
    } : undefined;
    if (instance.providerId === 'deepl') return { ...instance, name, credential };
    let endpoint: string;
    try { endpoint = normalizeEndpoint(draft.hosting === 'managed' ? MANAGED_LIBRETRANSLATE_ENDPOINT : draft.endpoint); }
    catch { throw new Error(t('instanceEndpointInvalid')); }
    return { ...instance, name, endpoint, hosting: draft.hosting, credential };
}

export function addEditedInstance(current: TranslationSetup, next: ConfigurableInstance, replaces?: DeepLInstance) {
    if (current.instances.some(candidate => candidate.id === next.id)) throw new Error(t('instanceChanged'));
    // Do not remove the untouched default if another page configured it meanwhile.
    const instances = current.instances.filter(candidate => !isReplacedDefault(candidate, current, replaces));
    const instanceOrder = getInstanceOrder(current).filter(id => instances.some(instance => instance.id === id));
    return { instance: next, setup: { ...current, instances: [...instances, next], instanceOrder: [...instanceOrder, next.id] } };
}

function isReplacedDefault(candidate: TranslationInstance, current: TranslationSetup, replaces?: DeepLInstance) {
    return replaces && candidate.id === replaces.id && JSON.stringify(candidate) === JSON.stringify(replaces) &&
        isUnusedDefaultDeepL(candidate, current.preferences.fallbackOrder);
}

export function replaceEditedInstance(current: TranslationSetup, previous: ConfigurableInstance, draft: ConfigurableInstance, savedTier: 'free' | 'pro') {
    const existing = current.instances.find(candidate => candidate.id === previous.id);
    if (!existing || existing.providerId !== previous.providerId || !('name' in existing) ||
        JSON.stringify(existing) !== JSON.stringify(previous)) throw new Error(t('instanceChanged'));
    const credential = canPreserveCredential(existing, draft, savedTier) ? existing.credential : draft.credential;
    const next = { ...draft, credential };
    return { instance: next, setup: { ...current, instances: current.instances.map(candidate => candidate.id === next.id ? next : candidate) } };
}

function canPreserveCredential(existing: ConfigurableInstance, draft: ConfigurableInstance, savedTier: 'free' | 'pro') {
    if (existing.credential?.key !== draft.credential?.key) return false;
    if (existing.providerId === 'libretranslate' && draft.providerId === 'libretranslate') return existing.endpoint === draft.endpoint;
    return savedTier === (draft.credential?.tier ?? savedTier);
}

export function recordInstanceTest(current: TranslationSetup, id: string, identity: string, valid: boolean) {
    const existing = current.instances.find(candidate => candidate.id === id);
    if (!existing || !('name' in existing) || configurationIdentity(existing) !== identity) throw new Error(t('keyChangedDuringTest'));
    return { ...current, instances: current.instances.map(candidate => candidate.id === existing.id ? {
        ...existing,
        credential: { ...existing.credential!, validated: valid, lastValidated: Date.now() },
    } : candidate) };
}

export function groupInstances(setup: TranslationSetup) {
    const enabledIds = setup.preferences.fallbackOrder;
    const enabled = enabledIds.map(id => setup.instances.find(instance => instance.id === id)).filter(instance => instance !== undefined);
    const unusedDefault = setup.instances.find(instance => isUnusedDefaultDeepL(instance, enabledIds));
    // Inactive fixed providers appear in the catalog.
    const configured = getInstanceOrder(setup).map(id => setup.instances.find(instance => instance.id === id))
        .filter((instance): instance is TranslationInstance => instance !== undefined && instance !== unusedDefault &&
            (supportsMultipleInstances(instance.providerId) || enabledIds.includes(instance.id)));
    return { enabledIds, enabled, unusedDefault, configured };
}

export function addSingletonInstance(current: TranslationSetup, instance: SingletonInstance, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const existing = current.instances.find(candidate => candidate.providerId === instance.providerId);
    const order = getInstanceOrder(current);
    const base = existing
        ? current
        : { ...current, instances: [...current.instances, instance],
            instanceOrder: order.includes(instance.id) ? order : [...order, instance.id] };
    if (base.preferences.fallbackOrder.includes(instance.id)) return base;
    const enabled = new Set([...base.preferences.fallbackOrder, instance.id]);
    return { ...base, preferences: { ...base.preferences, fallbackOrder: getInstanceOrder(base).filter(id => enabled.has(id)) } };
}

export async function toggleInstance(current: TranslationSetup, instance: TranslationInstance, enabling: boolean) {
    const latest = unchangedRecipient(current, instance, enabling);
    if (enabling && !await hasInstanceAccess(latest)) throw new Error(t('permissionDenied'));
    const order = current.preferences.fallbackOrder.filter(id => id !== instance.id);
    if (enabling) order.push(instance.id);
    return { ...current, preferences: { ...current.preferences, fallbackOrder: getInstanceOrder(current).filter(id => order.includes(id)) } };
}

export function instanceTier(instance: ConfigurableInstance): 'free' | 'pro' {
    return instance.credential?.tier ?? (instance.credential?.key && !instance.credential.key.endsWith(':fx') ? 'pro' : 'free');
}

export function effectiveEndpoint(endpoint: string): string {
    try { return normalizeEndpoint(endpoint); }
    catch { return endpoint; } // The save action explains an invalid URL.
}

export function draftChanged(instance: ConfigurableInstance, draft: InstanceDraft, savedTier: 'free' | 'pro') {
    if (draft.name !== instance.name || draft.key !== (instance.credential?.key ?? '')) return true;
    if (instance.providerId === 'deepl') return draft.tier !== savedTier;
    return effectiveEndpoint(draft.endpoint) !== instance.endpoint || draft.hosting !== instance.hosting;
}

export function needsCredential(instance: TranslationInstance) {
    const required = instance.providerId === 'deepl' || (instance.providerId === 'libretranslate' && instance.hosting === 'managed');
    return required && !instance.credential?.key;
}

export function draftNeedsCredential(instance: ConfigurableInstance, draft: InstanceDraft) {
    const required = instance.providerId === 'deepl' || (instance.providerId === 'libretranslate' && draft.hosting === 'managed');
    return required && !draft.key.trim();
}
/** Reorder enabled slots only; disabled accounts retain their saved positions. */
export function reorderEnabledInstances(current: TranslationSetup, snapshot: readonly string[]) {
    const active = current.preferences.fallbackOrder;
    // Ignore deleted/disabled rows from an old drag and retain concurrently enabled accounts.
    const requested = [...new Set(snapshot)].filter(id => active.includes(id));
    const fallbackOrder = [...requested, ...active.filter(id => !requested.includes(id))];
    let index = 0;
    const instanceOrder = getInstanceOrder(current).map(id => active.includes(id) ? fallbackOrder[index++]! : id);
    return { ...current, instanceOrder, preferences: { ...current.preferences, fallbackOrder } };
}

export function moveInstance(current: TranslationSetup, id: string, offset: number) {
    const order = [...current.preferences.fallbackOrder];
    const index = order.indexOf(id);
    if (index < 0 || index + offset < 0 || index + offset >= order.length) return current;
    order.splice(index, 1);
    order.splice(index + offset, 0, id);
    return reorderEnabledInstances(current, order);
}

function unchangedRecipient(current: TranslationSetup, instance: TranslationInstance, enabling: boolean) {
    const latest = current.instances.find(candidate => candidate.id === instance.id);
    if (!latest || JSON.stringify(getInstanceOrigins(latest)) !== JSON.stringify(getInstanceOrigins(instance))) throw new Error(t('instanceChanged'));
    if (enabling && usesCustomServer(instance) &&
        (latest.providerId !== 'libretranslate' || latest.endpoint !== instance.endpoint)) throw new Error(t('instanceChanged'));
    return latest;
}
