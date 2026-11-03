import type { SingletonInstance, TranslationInstance, TranslationSetup } from '@/src/types';
import { createDefaultSetup } from '@/utils/instances';
import { reconcileSetupAccess } from '@/utils/storage';
import { t } from '@/utils/i18n';
import { addSingletonInstance, configurationIdentity, toggleInstance } from '../components/instance-model';
import type { ServiceListProps } from '../components/instance-model';

/** Add a fixed provider and make it active once the click's access request is granted. */
export async function addEnabledSingleton(instance: SingletonInstance, permission: Promise<boolean>,
    updateSetup: ServiceListProps['updateSetup'], signal: AbortSignal): Promise<boolean> {
    const grant = permission.then(allowed => allowed, () => false);
    let granted = false;
    let enabled = false;
    try {
        granted = await grant;
        signal.throwIfAborted();
        if (!granted) throw new Error(t('permissionDenied'));
        enabled = await updateSetup(current => addSingletonInstance(current, instance, signal));
        if (!enabled) throw new Error(t('settingsSaveFailed'));
        return true;
    } finally {
        // A late or unused grant must not outlive a cancelled add.
        if (!enabled && (granted || await grant)) await releaseGrantedInstance(instance);
    }
}

/** Finish a user-initiated permission request without activating a stale recipient. */
export async function enableSavedInstance(instance: TranslationInstance, permission: Promise<boolean>, save: Promise<boolean>,
    updateSetup: ServiceListProps['updateSetup'], signal: AbortSignal): Promise<boolean> {
    // Observe a rejected permission promise immediately while persistence is pending.
    const grant = permission.then(allowed => allowed, () => false);
    let granted = false;
    let enabled = false;
    try {
        const saved = await save;
        granted = await grant;
        if (!saved) return false;
        signal.throwIfAborted();
        if (!granted) throw new Error(t('permissionDenied'));
        enabled = await updateSetup(current => activateUnchanged(current, instance, signal));
        if (!enabled) throw new Error(t('settingsSaveFailed'));
        return true;
    } finally {
        // Even an aborted or failed save must wait for a late grant and release unused hosts.
        if (!enabled && (granted || await grant)) await releaseGrantedInstance(instance);
    }
}

async function activateUnchanged(current: TranslationSetup, instance: TranslationInstance, signal: AbortSignal) {
    signal.throwIfAborted();
    const latest = current.instances.find(candidate => candidate.id === instance.id);
    if (!latest || !sameConfiguration(latest, instance)) throw new Error(t('instanceChanged'));
    const next = await toggleInstance(current, latest, true);
    signal.throwIfAborted();
    return next;
}

function sameConfiguration(latest: TranslationInstance, captured: TranslationInstance) {
    if (latest.providerId !== captured.providerId) return false;
    if (!('name' in latest) || !('name' in captured)) return true;
    return configurationIdentity(latest) === configurationIdentity(captured);
}

/** Release a grant that no enabled recipient owns, preserving hosts shared with the active setup. */
export async function releaseGrantedInstance(instance: TranslationInstance) {
    const ownership = createDefaultSetup();
    try {
        await reconcileSetupAccess({ ...ownership, instances: [instance], instanceOrder: [instance.id],
            preferences: { ...ownership.preferences, fallbackOrder: [instance.id] } });
    } catch { throw new Error(t('permissionRemoveFailed')); }
}
