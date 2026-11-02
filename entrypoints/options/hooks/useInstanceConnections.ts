import { useEffect, useRef, useState, type Dispatch, type StateUpdater } from 'preact/hooks';
import { t } from '@/utils/i18n';
import { reconcileSetupAccess } from '@/utils/storage';
import { getInstanceName } from '@/utils/instances';
import { hasInstanceAccess, hasAnyInstanceAccess, requestInstanceAccess } from '@/utils/permissions';
import { probeLibreTranslate } from '@/services/libretranslate';
import type { TranslationInstance, TranslationSetup } from '@/src/types';
import { toggleInstance, usesCustomServer } from '../components/instance-model';
import type { ServiceListProps } from '../components/instance-model';

interface ConnectionView {
    expanded: string | null;
    editorTransitionBlocked: boolean;
    setError: (error: string) => void;
    setAccess: Dispatch<StateUpdater<Record<string, boolean>>>;
    setAnyAccess: Dispatch<StateUpdater<Record<string, boolean>>>;
}
interface ConnectionContext extends ConnectionView {
    setup: TranslationSetup;
    updateSetup: ServiceListProps['updateSetup'];
    busy: string | null;
    setBusy: (id: string | null) => void;
    connection: { current: AbortController | null };
    setConnectionFeedback: (feedback: { name: string; connected: boolean } | null) => void;
}

export function useInstanceConnections(setup: TranslationSetup, updateSetup: ServiceListProps['updateSetup'], view: ConnectionView) {
    const [busy, setBusy] = useState<string | null>(null);
    const [connectionFeedback, setConnectionFeedback] = useState<{ name: string; connected: boolean } | null>(null);
    const connection = useRef<AbortController | null>(null);
    useEffect(() => () => connection.current?.abort(), []);
    const context = { ...view, setup, updateSetup, busy, setBusy, connection, setConnectionFeedback };
    return {
        busy, setBusy, connectionFeedback,
        toggle: (instance: TranslationInstance) => toggleConnection(context, instance),
        grantAccess: (instance: TranslationInstance) => grantConnection(context, instance),
        releaseAccess: (instance: TranslationInstance) => releaseConnection(context, instance),
        cleanAccess: (previous: TranslationSetup) => cleanAccess(context, previous),
    };
}

function beginConnection(context: ConnectionContext, id: string) {
    const controller = new AbortController();
    context.connection.current?.abort();
    context.connection.current = controller;
    context.setBusy(id);
    context.setError('');
    context.setConnectionFeedback(null);
    return controller;
}

function finishConnection(context: ConnectionContext, controller: AbortController) {
    if (context.connection.current === controller) {
        context.connection.current = null;
        context.setBusy(null);
    }
}

async function cleanAccess(context: ConnectionContext, previous: TranslationSetup) {
    try { await reconcileSetupAccess(previous); }
    catch { context.setError(t('permissionRemoveFailed')); }
}

function toggleConnection(context: ConnectionContext, instance: TranslationInstance) {
    if (context.busy !== null || (context.expanded === instance.id && context.editorTransitionBlocked)) return;
    const enabling = !context.setup.preferences.fallbackOrder.includes(instance.id);
    // Request optional permission synchronously within the user's click gesture.
    const grant = enabling ? requestInstanceAccess(instance) : undefined;
    const controller = beginConnection(context, instance.id);
    const attempt = { granted: false };
    void applyToggle(context, instance, enabling, grant, controller, attempt)
        .catch(reason => recoverToggle(context, instance, controller, attempt.granted, reason))
        .finally(() => finishConnection(context, controller));
}

async function applyToggle(context: ConnectionContext, instance: TranslationInstance, enabling: boolean,
    grant: Promise<boolean> | undefined, controller: AbortController, attempt: { granted: boolean }) {
    if (enabling) {
        attempt.granted = !!await grant;
        if (!attempt.granted) throw new Error(t('permissionDenied'));
    }
    controller.signal.throwIfAborted();
    const connected = enabling && usesCustomServer(instance)
        ? await probeLibreTranslate(instance.endpoint, controller.signal) : undefined;
    controller.signal.throwIfAborted();
    const saved = await context.updateSetup(current => toggleInstance(current, instance, enabling));
    if (!saved) throw new Error(t('settingsSaveFailed'));
    if (!enabling) await cleanAccess(context, context.setup);
    announceConnection(context, instance, connected);
    const actual = await hasInstanceAccess(instance);
    context.setAccess(previous => ({ ...previous, [instance.id]: actual }));
}

async function recoverToggle(context: ConnectionContext, instance: TranslationInstance, controller: AbortController, granted: boolean, reason: unknown) {
    if (granted) await cleanAccess(context, withInstanceEnabled(context.setup, instance.id));
    if (!controller.signal.aborted) context.setError(reason instanceof Error ? reason.message : t('permissionChangeFailed'));
}

function grantConnection(context: ConnectionContext, instance: TranslationInstance) {
    const operation = requestInstanceAccess(instance);
    const controller = beginConnection(context, instance.id);
    void operation.then(granted => applyGrant(context, instance, controller, granted)).catch(async () => {
        await cleanAccess(context, context.setup);
        if (!controller.signal.aborted) context.setError(t('permissionDenied'));
    }).finally(() => finishConnection(context, controller));
}

async function applyGrant(context: ConnectionContext, instance: TranslationInstance, controller: AbortController, granted: boolean) {
    if (!granted) throw new Error(t('permissionDenied'));
    controller.signal.throwIfAborted();
    const connected = usesCustomServer(instance) ? await probeLibreTranslate(instance.endpoint, controller.signal) : undefined;
    controller.signal.throwIfAborted();
    await reconcileSetupAccess(context.setup);
    const actual = await hasInstanceAccess(instance);
    context.setAccess(previous => ({ ...previous, [instance.id]: actual }));
    if (!actual) throw new Error(t('permissionDenied'));
    announceConnection(context, instance, connected);
}

function announceConnection(context: ConnectionContext, instance: TranslationInstance, connected: boolean | undefined) {
    if (connected !== undefined) context.setConnectionFeedback({ name: getInstanceName(instance), connected });
}

async function releaseConnection(context: ConnectionContext, instance: TranslationInstance) {
    context.setBusy(instance.id);
    context.setError('');
    try {
        await cleanAccess(context, withInstanceEnabled(context.setup, instance.id));
        const [all, any] = await Promise.all([hasInstanceAccess(instance), hasAnyInstanceAccess(instance)]);
        context.setAccess(previous => ({ ...previous, [instance.id]: all }));
        context.setAnyAccess(previous => ({ ...previous, [instance.id]: any }));
    } catch { context.setError(t('permissionCheckFailed')); }
    finally { context.setBusy(null); }
}

function withInstanceEnabled(setup: TranslationSetup, id: string) {
    return { ...setup, preferences: { ...setup.preferences, fallbackOrder: [...setup.preferences.fallbackOrder, id] } };
}
